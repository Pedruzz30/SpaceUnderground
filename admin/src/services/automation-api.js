import { automationApiBaseUrl, isAutomationApiConfigured, isSupabaseMode } from "../config/env.js";
import { DataError } from "./errors.js";

// The Admin's only door to the Python automation service. Every call to it goes
// through here so no page grows its own fetch() with its own error handling.
//
// Python is an additional capability, never a dependency: when
// VITE_AUTOMATION_API_URL is unset, `isAutomationApiAvailable()` is false and
// these functions throw a `not_configured` DataError that callers are expected
// to treat as "feature unavailable", not as an outage. Nothing in the Admin
// calls them yet.
//
// The division of labour is deliberate. Reading and writing a project stays on
// Supabase directly -- routing CRUD through Python would add a hop that does
// nothing. Only processing lives here: analysis, reports and automations.

// Short on purpose. These calls sit in front of a page that already works
// without them, so waiting is worse than reporting the service as unreachable.
const DEFAULT_TIMEOUT_MS = 8000;

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
  return new DataError(
    "Automation API is not configured. Set VITE_AUTOMATION_API_URL to enable it.",
    { code: "not_configured" },
  );
}

// Status codes the caller has to be able to tell apart, because each one asks
// the operator for something different: sign in again, ask for access, or wait.
const STATUS_CODES = {
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  503: "unavailable",
};

// The service answers errors as { code, message }. The code is stable and is
// what callers should branch on; the message is already safe to show.
async function readError(response) {
  const fallback = STATUS_CODES[response.status] ?? "automation_error";

  try {
    const body = await response.json();
    if (body && typeof body.code === "string") {
      // The status wins for the two cases the service reports with a generic
      // envelope: `forbidden` is a distinct outcome the Admin must not show as
      // "log in again", and the body alone does not carry it.
      const code = STATUS_CODES[response.status] ?? body.code;
      return new DataError(String(body.message || "Automation request failed."), { code });
    }
  } catch {
    // A non-JSON body means the failure came from somewhere other than the
    // service itself -- a proxy, or the wrong URL entirely.
  }

  return new DataError(`Automation request failed (${response.status}).`, { code: fallback });
}

/**
 * The signed-in operator's Supabase access token, when there is one.
 *
 * Imported lazily so mock mode never pulls the Supabase client in, and failure
 * is silent on purpose: no session simply means no Authorization header, and
 * the service decides whether that is acceptable. It is not this client's job
 * to guess the server's auth policy.
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

async function request(path, { method = "GET", body = null, timeout = DEFAULT_TIMEOUT_MS } = {}) {
  if (!isAutomationApiConfigured()) throw notConfigured();

  const headers = { Accept: "application/json" };
  if (body) headers["Content-Type"] = "application/json";

  // The operator's own access token, which the service verifies against
  // Supabase and checks against public.admins. This is the only credential the
  // Admin has, and the only one it should have: it proves who is asking, it
  // expires, and revoking their admin row revokes it.
  const token = await accessToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  // A processing call that hangs must not hang the page with it.
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

  if (!response.ok) throw await readError(response);

  return response.json();
}

/** Liveness plus which dependencies the service has configured. */
export async function getAutomationHealth() {
  return request("/api/v1/health");
}

/**
 * Operational analysis of one project.
 *
 * Server-side and deliberately distinct from the editor's `projectHealth`:
 * that one answers "is this form ready to publish?", this one answers "is the
 * stored row coherent?" -- publication consistency, demo coherence, staleness.
 *
 * @param projectId uuid or case number, the same identifiers the router uses
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
 * Workflow run history, newest first.
 *
 * Always bounded: the service clamps the limit too, but asking for an
 * unbounded list is not something this client should be able to express.
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
 * Retries a failed run.
 *
 * Creates a new run rather than replacing the old one: the failed attempt is
 * the evidence of what went wrong and is never overwritten.
 */
export async function retryAutomationRun(runId) {
  const id = String(runId ?? "").trim();
  if (!id) throw new DataError("A run id is required.", { code: "bad_request" });

  return request(`/api/v1/automations/runs/${encodeURIComponent(id)}/retry`, { method: "POST" });
}

/**
 * Dispatches an automation event.
 *
 * `dryRun` asks write-capable workflows to record planned actions only.
 */
export async function dispatchAutomation(
  event,
  { entityType, entityId, operationId, payload = {}, dryRun = false } = {},
) {
  const name = String(event ?? "").trim();
  if (!name) throw new DataError("An event name is required.", { code: "bad_request" });

  return request("/api/v1/automations/dispatch", {
    method: "POST",
    body: {
      event: name,
      entity_type: entityType || null,
      entity_id: entityId ? String(entityId) : null,
      // Collapses a double click plus a network retry into one run. A
      // deliberate later run of the same event supplies a new id.
      operation_id: operationId || null,
      payload,
      dry_run: Boolean(dryRun),
    },
  });
}
