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
const SCHEMA_MISSING = new Set(["42P01", "42703", "PGRST204", "PGRST205"]);

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
