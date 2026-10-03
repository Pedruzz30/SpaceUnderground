import { automationApiBaseUrl, isAutomationApiConfigured, isSupabaseMode } from "../config/env.js";
import { DataError } from "./errors.js";

// The Admin's only door to the automation service (services/automation-api).
// Every call to it goes through here, so no page grows its own fetch() with
// its own error handling.
//
// The service is an additional capability, never a dependency. CRUD stays on
// Supabase directly -- routing it through Python would add a hop that does
// nothing. Only processing lives here: analysis, reports, workflows and their
// run history. When VITE_AUTOMATION_API_URL is unset every function throws a
// `not_configured` DataError without touching the network, and callers treat
// that as "feature off", never as an outage.

// Reads sit in front of a page that already works without them, so waiting is
// worse than reporting the service as unreachable.
const READ_TIMEOUT_MS = 8000;
// A workflow runs inside the request (one bounded step at a time, see the
// engine), so a dispatch is given the time the slowest workflow can take.
const RUN_TIMEOUT_MS = 30000;

export function isAutomationApiAvailable() {
  return isAutomationApiConfigured();
}

export function automationApiUrl(path = "") {
  const base = automationApiBaseUrl();
  if (!base) return "";

  const suffix = String(path ?? "").trim();
  return suffix ? `${base}${suffix.startsWith("/") ? "" : "/"}${suffix}` : base;
}

function notConfigured() {
  return new DataError("Automation API is not configured. Set VITE_AUTOMATION_API_URL to enable it.", {
    code: "not_configured",
  });
}

// The outcomes the operator acts on differently: sign in again, ask for
// access, or wait. The status decides those three, whatever the body says.
const STATUS_CODES = {
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  429: "rate_limited",
};

// A 503 is either "this service is missing its own configuration" or "a
// dependency is down right now". The service says which in its body, and the
// two must not collapse: one needs a deploy fix, the other only time.
const UNAVAILABLE_CODES = new Set(["not_configured", "unavailable"]);

// The service answers errors as { code, message }; the code is stable and is
// what callers branch on, the message is already safe to show.
async function readError(response) {
  let body = null;
  try {
    body = await response.json();
  } catch {
    // A non-JSON body came from something in front of the service -- a proxy,
    // a cold-starting host, or the wrong URL entirely.
  }

  const bodyCode = typeof body?.code === "string" ? body.code : "";
  let code = STATUS_CODES[response.status];
  if (!code && response.status === 503) code = UNAVAILABLE_CODES.has(bodyCode) ? bodyCode : "unavailable";
  if (!code) code = bodyCode || "automation_error";

  const message = typeof body?.message === "string" && body.message ? body.message : `Automation request failed (${response.status}).`;
  return new DataError(message, { code });
}

/**
 * The signed-in member's Supabase access token, when there is one.
 *
 * Imported lazily so mock mode never pulls the Supabase client in. No session
 * means no Authorization header; whether that is acceptable is the service's
 * decision (it refuses it in production), not this client's guess.
 */
async function accessToken() {
  if (!isSupabaseMode()) return "";

  try {
    const { getSupabaseClient } = await import("../lib/supabase.js");
    const { data } = await getSupabaseClient().auth.getSession();
    return data?.session?.access_token ?? "";
  } catch {
    return "";
  }
}

// `accept` lists error statuses whose body is the answer rather than an error
// envelope: /ready says "not ready" with a 503 and the checks that failed.
async function request(path, { method = "GET", body = null, timeout = READ_TIMEOUT_MS, accept = [] } = {}) {
  if (!isAutomationApiConfigured()) throw notConfigured();

  const headers = { Accept: "application/json" };
  if (body) headers["Content-Type"] = "application/json";

  // The member's own access token: it proves who is asking, it expires, and
  // the service checks it against the same permissions the database uses. It
  // is the only credential the Admin has, and the only one it should have.
  const token = await accessToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  let response;
  try {
    response = await fetch(automationApiUrl(path), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    throw new DataError("Automation API is unreachable.", {
      code: error?.name === "AbortError" ? "timeout" : "network_error",
      cause: error,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok && !accept.includes(response.status)) throw await readError(response);
  return response.json();
}

// Whether a failure may be retried with the same operation id: the request may
// never have arrived, and the id makes a repeat that did arrive harmless.
function isTransient(error) {
  return error?.code === "network_error" || error?.code === "timeout" || error?.code === "unavailable";
}

async function withRetry(call, { retries = 1 } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await call();
    } catch (error) {
      if (attempt >= retries || !isTransient(error)) throw error;
    }
  }
}

/** A fresh operation id: one per deliberate action, reused by its retries. */
export function newOperationId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Liveness plus which dependencies the service has configured. */
export async function getAutomationHealth() {
  return request("/api/v1/health");
}

/** Whether the service can do automation work right now, with each check.
 * "Not ready" is an answer (503 with the checks), not a failure. */
export async function getAutomationReadiness() {
  return request("/api/v1/ready", { accept: [503] });
}

/** Who the service sees, and what this member may do there. */
export async function getAutomationSession() {
  return request("/api/v1/auth/me");
}

/**
 * Operational analysis of one stored project.
 *
 * Server-side and distinct from the editor's projectHealth: that one answers
 * "is this form ready to publish?", this one "is the persisted row coherent?"
 * -- publication consistency, demo coherence, staleness.
 *
 * @param projectId uuid or case number
 */
export async function analyzeProject(projectId) {
  const id = String(projectId ?? "").trim();
  if (!id) throw new DataError("A project id is required.", { code: "bad_request" });

  return request(`/api/v1/projects/${encodeURIComponent(id)}/analyze`, { method: "POST" });
}

/** Catalogue-wide operational metrics, counted from Supabase. */
export async function getOperationsOverview() {
  return request("/api/v1/reports/overview");
}

/** Automations registered on the service, with the steps each one runs. */
export async function getRegisteredAutomations() {
  return request("/api/v1/automations");
}

/**
 * Workflow run history, newest first. Always bounded: the service clamps the
 * limit too, but an unbounded list is not something this client can express.
 */
export async function getAutomationRuns({ event, status, entityId, limit = 25 } = {}) {
  const params = new URLSearchParams();
  if (event) params.set("event", event);
  if (status) params.set("status", status);
  if (entityId) params.set("entity_id", entityId);
  params.set("limit", String(Math.max(1, Math.min(Number(limit) || 25, 100))));

  return request(`/api/v1/automations/runs?${params.toString()}`);
}

/** Counts over the recent runs, for the Dashboard. */
export async function getAutomationRunStats() {
  return request("/api/v1/automations/runs/stats");
}

/** One run, with its steps. */
export async function getAutomationRun(runId) {
  const id = String(runId ?? "").trim();
  if (!id) throw new DataError("A run id is required.", { code: "bad_request" });

  return request(`/api/v1/automations/runs/${encodeURIComponent(id)}`);
}

/**
 * Retries a failed run as a new run; the failed one is never overwritten.
 *
 * `operationId` identifies this retry: a double click or a network retry of
 * the same click comes back as the run it already created.
 */
export async function retryAutomationRun(runId, { operationId = newOperationId() } = {}) {
  const id = String(runId ?? "").trim();
  if (!id) throw new DataError("A run id is required.", { code: "bad_request" });

  return withRetry(() =>
    request(`/api/v1/automations/runs/${encodeURIComponent(id)}/retry`, {
      method: "POST",
      body: { operation_id: operationId },
      timeout: RUN_TIMEOUT_MS,
    }),
  );
}

/** Scheduled jobs registered on the service. */
export async function getAutomationJobs() {
  return request("/api/v1/jobs");
}

/**
 * Runs the scheduled jobs now, by hand (needs settings.edit on the service).
 * They only detect and record; the operation id collapses a double click.
 */
export async function runAutomationJobs({ jobs = null, operationId = newOperationId() } = {}) {
  return withRetry(() =>
    request("/api/v1/jobs/run", {
      method: "POST",
      body: { jobs, operation_id: operationId },
      timeout: RUN_TIMEOUT_MS,
    }),
  );
}

/**
 * Dispatches an automation event.
 *
 * `operationId` is the identity of the deliberate action behind the dispatch
 * (one publish click). The request is retried once on a network failure with
 * the same id, so a dispatch that did arrive is collapsed into its first run
 * rather than run twice. `dryRun` asks write-capable workflows to record the
 * actions they would take without taking them.
 */
export async function dispatchAutomation(
  event,
  { entityType, entityId, operationId = newOperationId(), payload = {}, dryRun = false, retries = 1 } = {},
) {
  const name = String(event ?? "").trim();
  if (!name) throw new DataError("An event name is required.", { code: "bad_request" });

  const body = {
    event: name,
    entity_type: entityType || null,
    entity_id: entityId ? String(entityId) : null,
    operation_id: operationId || null,
    payload,
    dry_run: Boolean(dryRun),
  };

  return withRetry(() => request("/api/v1/automations/dispatch", { method: "POST", body, timeout: RUN_TIMEOUT_MS }), {
    retries,
  });
}
