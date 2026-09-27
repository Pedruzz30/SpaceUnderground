// Client lifecycle and record quality. Pure functions: no data access, no DOM,
// so the Hub, the Editor and the tests all read the same rules.

export const CLIENT_STATUSES = ["ACTIVE", "LEAD", "INACTIVE", "ARCHIVED"];

// Values written by hand in either language resolve to the stored enum.
const STATUS_ALIASES = new Map([
  ["ACTIVE", "ACTIVE"],
  ["ATIVO", "ACTIVE"],
  ["LEAD", "LEAD"],
  ["INACTIVE", "INACTIVE"],
  ["INATIVO", "INACTIVE"],
  ["ARCHIVED", "ARCHIVED"],
  ["ARQUIVADO", "ARCHIVED"],
]);

export function normalizeClientStatus(value) {
  const key = String(value || "").trim().toUpperCase();
  return STATUS_ALIASES.get(key) || key;
}

export function isClientStatus(value) {
  return CLIENT_STATUSES.includes(normalizeClientStatus(value));
}

// Deliberately permissive: it catches typos like a missing @ or domain, not
// every address RFC 5322 allows.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value) {
  return EMAIL_PATTERN.test(String(value ?? "").trim());
}

function text(value) {
  return String(value ?? "").trim();
}

// "incomplete" checks are what a record cannot work without; "attention" ones
// are worth fixing but never block saving.
export function clientHealth(client = {}) {
  const email = text(client.email);
  const phone = text(client.phone);
  const checks = [
    { key: "name", ok: Boolean(text(client.name)), severity: "incomplete" },
    { key: "contact", ok: Boolean(email || phone), severity: "incomplete" },
    { key: "status", ok: isClientStatus(client.status), severity: "incomplete" },
    { key: "emailValid", ok: !email || isValidEmail(email), severity: "attention" },
    { key: "company", ok: Boolean(text(client.company)), severity: "attention" },
  ];

  const essentialFailures = checks.filter((check) => !check.ok && check.severity === "incomplete");
  const warnings = checks.filter((check) => !check.ok && check.severity === "attention");
  const total = checks.length;
  const score = checks.filter((check) => check.ok).length;

  return {
    status: essentialFailures.length ? "incomplete" : warnings.length ? "attention" : "healthy",
    score,
    total,
    checks,
  };
}
