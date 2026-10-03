// One shape for every automation request, so each page does not invent its own.
//
// The automation service is optional, so "there is no answer" has genuinely
// different meanings, and the UI must tell them apart:
//
//   not-configured  no URL is set, or the service is missing its own
//                   configuration. Nothing is broken in the Admin.
//   forbidden       the service answered, and this member may not use it.
//   error           it was asked and could not answer: unreachable, timed
//                   out, a dependency down. Offer a retry.
//   success         it answered.
//
// Plus `idle` and `loading` for the moments in between. A single "failed"
// state would show an outage to someone who simply never turned the service
// on, or to a member who only lacks the permission.

import { isAutomationApiAvailable } from "../services/automation-api.js";

export const IDLE = "idle";
export const LOADING = "loading";
export const SUCCESS = "success";
export const ERROR = "error";
export const NOT_CONFIGURED = "not-configured";
export const FORBIDDEN = "forbidden";

/** Fresh window for a cached result, in milliseconds. */
const DEFAULT_TTL_MS = 60000;

export function idleState() {
  return { status: IDLE, data: null, error: null };
}

/** Maps a failed request onto the state it means. */
export function stateForError(error) {
  const code = error?.code;
  if (code === "not_configured") return NOT_CONFIGURED;
  if (code === "forbidden" || code === "unauthorized") return FORBIDDEN;
  return ERROR;
}

// Two callers asking for the same thing at the same moment should produce one
// request, and a page that re-renders should not re-ask within the TTL. Both
// are the same concern, so one object handles them.
export function createAutomationResource(loader, { ttl = DEFAULT_TTL_MS } = {}) {
  let cached = null;
  let cachedAt = 0;
  let inFlight = null;

  function fresh(now) {
    return cached !== null && now - cachedAt < ttl;
  }

  async function read({ force = false, now = Date.now() } = {}) {
    // Asked before anything is configured: not a failure, and no request.
    if (!isAutomationApiAvailable()) {
      cached = null;
      inFlight = null;
      return { status: NOT_CONFIGURED, data: null, error: null };
    }

    if (!force && fresh(now)) return { status: SUCCESS, data: cached, error: null, cached: true };

    // A forced read is allowed to bypass a request that is already stuck.
    if (inFlight && !force) return inFlight;

    const request = (async () => {
      try {
        const data = await loader();
        cached = data;
        cachedAt = now;
        return { status: SUCCESS, data, error: null };
      } catch (error) {
        // A failed read leaves no cache behind: stale numbers beside an
        // "unavailable" badge would contradict each other.
        cached = null;
        return { status: stateForError(error), data: null, error };
      } finally {
        if (inFlight === request) inFlight = null;
      }
    })();
    inFlight = request;
    return request;
  }

  function invalidate() {
    cached = null;
    cachedAt = 0;
  }

  return { read, invalidate };
}

/**
 * The i18n key describing the service behind a state. Kept here so the
 * Dashboard, the editor, Logs and Settings share one vocabulary.
 */
export function serviceStatusKey(status) {
  if (status === SUCCESS) return "automation.online";
  if (status === ERROR) return "automation.offline";
  if (status === NOT_CONFIGURED) return "automation.notConfigured";
  if (status === FORBIDDEN) return "automation.forbidden";
  return "automation.checking";
}

/**
 * Which "not configured" this is: the Admin has no URL, or the Admin has one
 * and the service answered that its own configuration is incomplete. Telling
 * someone to set VITE_AUTOMATION_API_URL when it is already set sends them to
 * the wrong file entirely.
 */
export function notConfiguredHintKey() {
  return isAutomationApiAvailable() ? "automation.notConfiguredServer" : "automation.notConfiguredHint";
}

/** Tone for the status dot. Never the only carrier of meaning -- text is. */
export function serviceStatusTone(status) {
  if (status === SUCCESS) return "ok";
  if (status === ERROR) return "critical";
  if (status === FORBIDDEN) return "attention";
  return "normal";
}
