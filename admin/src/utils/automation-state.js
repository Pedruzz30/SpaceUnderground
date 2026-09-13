// One shape for every automation request, so each page does not invent its own.
//
// The automation API is optional, which means "there is no answer" has three
// genuinely different meanings and the UI must tell them apart:
//
//   not-configured  no URL is set. Nothing was asked, nothing is wrong.
//   error           it was asked and could not answer. Offer a retry.
//   success         it answered.
//
// Plus `idle` and `loading` for the two moments in between. A single generic
// "failed" state would collapse the first two, and the Dashboard would show an
// outage to someone who simply never turned Python on.

import { isAutomationApiAvailable } from "../services/automation-api.js";

export const IDLE = "idle";
export const LOADING = "loading";
export const SUCCESS = "success";
export const ERROR = "error";
export const NOT_CONFIGURED = "not-configured";

/** Fresh window for a cached result, in milliseconds. */
const DEFAULT_TTL_MS = 60000;

export function idleState() {
  return { status: IDLE, data: null, error: null };
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
    // Asked before anything is configured: this is not a failure, and it must
    // not produce a request.
    if (!isAutomationApiAvailable()) {
      cached = null;
      inFlight = null;
      return { status: NOT_CONFIGURED, data: null, error: null };
    }

    if (!force && fresh(now)) {
      return { status: SUCCESS, data: cached, error: null, cached: true };
    }

    // A retry must be allowed to bypass a request that is already stuck.
    if (inFlight && !force) return inFlight;

    inFlight = (async () => {
      try {
        const data = await loader();
        cached = data;
        // Stamped from the same clock the freshness check reads, so an
        // injected `now` stays internally consistent.
        cachedAt = now;
        return { status: SUCCESS, data, error: null };
      } catch (error) {
        // A request that fails leaves no cache behind: showing stale numbers
        // beside an OFFLINE badge would contradict itself.
        cached = null;
        return { status: ERROR, data: null, error };
      } finally {
        inFlight = null;
      }
    })();

    return inFlight;
  }

  function invalidate() {
    cached = null;
    cachedAt = 0;
  }

  return { read, invalidate };
}

/**
 * Maps a state onto the i18n key describing the service behind it.
 *
 * Kept here rather than in each page so the Dashboard, the editor and Settings
 * cannot drift into three different vocabularies for the same situation.
 */
export function serviceStatusKey(status) {
  if (status === SUCCESS) return "automation.online";
  if (status === ERROR) return "automation.offline";
  if (status === NOT_CONFIGURED) return "automation.notConfigured";
  return "automation.checking";
}

/** Tone for the status dot. Never the only carrier of meaning -- text is. */
export function serviceStatusTone(status) {
  if (status === SUCCESS) return "ok";
  if (status === ERROR) return "danger";
  if (status === NOT_CONFIGURED) return "neutral";
  return "warning";
}
