// Turns data-layer failures into something the UI can show without leaking
// raw SQL/PostgREST strings to the user.

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
  return null;
}

export function toDataError(error, fallbackMessage) {
  if (error instanceof DataError) return error;

  const code = error?.code ?? "unknown";
  const details = `${error?.message ?? ""} ${error?.details ?? ""}`;

  if (code === UNIQUE_VIOLATION) {
    const field = uniqueViolationField(details);
    if (field === "slug") {
      return new DataError("This slug is already in use.", { code, field, cause: error });
    }
    if (field === "caseNumber") {
      return new DataError("That case number was just taken. Try again.", { code, field, cause: error });
    }
    return new DataError("That value is already in use.", { code, cause: error });
  }

  if (code === "PGRST116" || code === "not_found") {
    return new DataError("Record not found.", { code: "not_found", cause: error });
  }

  if (code === "42501" || code === "unauthorized") {
    return new DataError("You are not authorized to perform this action.", { code: "unauthorized", cause: error });
  }

  if (error?.name === "TypeError" || code === "network_error") {
    return new DataError("Unable to reach the server. Check your connection.", { code: "network_error", cause: error });
  }

  return new DataError(fallbackMessage, { code, cause: error });
}

export function describeError(error, fallbackMessage = "Something went wrong.") {
  return toDataError(error, fallbackMessage).message;
}
