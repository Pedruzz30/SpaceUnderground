// Turns data-layer failures into something the UI can show without leaking
// raw SQL/PostgREST strings to the user. Messages are resolved at throw time,
// so they read in whichever locale is active when the failure happens.

import { t } from "../i18n/index.js";

export class DataError extends Error {
  constructor(message, { code = "unknown", field = null, cause = null } = {}) {
    super(message);
    this.name = "DataError";
    this.code = code;
    this.field = field;
    this.cause = cause;
  }
}

const UNIQUE_VIOLATION = "23505";

// Postgres reports unique conflicts by constraint name; map the ones we own
// back to the form field that caused them.
function uniqueViolationField(details) {
  const text = String(details).toLowerCase();
  if (text.includes("slug")) return "slug";
  if (text.includes("case_number")) return "caseNumber";
  if (text.includes("clients_code")) return "code";
  return null;
}

// A table or column the code expects but the database does not have yet: the
// migration behind the feature has not been applied. Said plainly instead of
// surfacing PostgREST's schema-cache wording.
const SCHEMA_MISSING = new Set(["42P01", "42703", "42883", "PGRST202", "PGRST204", "PGRST205"]);

// The security functions refuse with their own SQLSTATEs (see the security
// migration), and the team-invite Edge Function with its own codes. Each maps
// to a message and a stable code the pages act on (step_up_required opens the
// MFA prompt, version_conflict offers a re-base).
const SECURITY_CODES = {
  SU001: ["errors.security.versionConflict", "version_conflict"],
  SU002: ["errors.security.selfApproval", "self_approval"],
  SU003: ["errors.security.invalidState", "invalid_state"],
  SU004: ["errors.security.invalidInput", "invalid_input"],
  SU005: ["errors.security.stepUpRequired", "step_up_required"],
  SU006: ["errors.security.mfaRequired", "mfa_required"],
  SU007: ["errors.security.rateLimited", "rate_limited"],
  SU008: ["errors.security.memberState", "member_state"],
  SU009: ["errors.security.rank", "rank"],
  SU010: ["errors.notFound", "not_found"],
  SU011: ["errors.security.expired", "expired"],
  SU012: ["errors.security.requesterInactive", "requester_inactive"],
  SU013: ["errors.security.sessionRevoked", "session_revoked"],
  function_unavailable: ["errors.security.functionUnavailable", "function_unavailable"],
  invite_failed: ["errors.security.inviteFailed", "invite_failed"],
  resend_failed: ["errors.security.resendFailed", "resend_failed"],
  invalid_code: ["errors.security.invalidCode", "invalid_code"],
  mfa_verification_failed: ["errors.security.invalidCode", "invalid_code"],
};

export function toDataError(error, fallbackMessage) {
  if (error instanceof DataError) return error;

  const code = error?.code ?? "unknown";
  const details = `${error?.message ?? ""} ${error?.details ?? ""}`;

  if (code === UNIQUE_VIOLATION) {
    const field = uniqueViolationField(details);
    if (field === "slug") {
      return new DataError(t("errors.slugInUse"), { code, field, cause: error });
    }
    if (field === "caseNumber") {
      return new DataError(t("errors.caseNumberTaken"), { code, field, cause: error });
    }
    if (field === "code") {
      return new DataError(t("errors.clientCodeInUse"), { code, field, cause: error });
    }
    return new DataError(t("errors.valueInUse"), { code, cause: error });
  }

  if (SECURITY_CODES[code]) {
    const [key, stable] = SECURITY_CODES[code];
    // The session was ended elsewhere (revoked, suspended, offboarded): the
    // router re-reads the member's access and shows why, instead of leaving
    // the page to fail request by request.
    if (stable === "session_revoked" && typeof globalThis.window?.dispatchEvent === "function" && typeof CustomEvent === "function") {
      globalThis.window.dispatchEvent(new CustomEvent("space-admin:session-ended"));
    }
    return new DataError(t(key), { code: stable, cause: error });
  }

  if (code === "PGRST116" || code === "not_found") {
    return new DataError(t("errors.notFound"), { code: "not_found", cause: error });
  }

  if (SCHEMA_MISSING.has(code)) {
    return new DataError(t("errors.schemaOutdated"), { code: "schema_outdated", cause: error });
  }

  if (code === "42501" || code === "unauthorized") {
    return new DataError(t("errors.unauthorized"), { code: "unauthorized", cause: error });
  }

  if (error?.name === "TypeError" || code === "network_error") {
    return new DataError(t("errors.network"), { code: "network_error", cause: error });
  }

  return new DataError(fallbackMessage, { code, cause: error });
}

export function describeError(error, fallbackMessage) {
  return toDataError(error, fallbackMessage ?? t("errors.generic")).message;
}
