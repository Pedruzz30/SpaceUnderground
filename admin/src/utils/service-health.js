export const SERVICE_STATUSES = ["AVAILABLE", "LIMITED", "ON_REQUEST", "WAITLIST", "UNAVAILABLE", "ARCHIVED"];

const STATUS_ALIASES = new Map([
  ["AVAILABLE", "AVAILABLE"],
  ["DISPONÍVEL", "AVAILABLE"],
  ["DISPONIVEL", "AVAILABLE"],
  ["LIMITED", "LIMITED"],
  ["LIMITADO", "LIMITED"],
  ["ON_REQUEST", "ON_REQUEST"],
  ["ON REQUEST", "ON_REQUEST"],
  ["SOB CONSULTA", "ON_REQUEST"],
  ["WAITLIST", "WAITLIST"],
  ["LISTA DE ESPERA", "WAITLIST"],
  ["UNAVAILABLE", "UNAVAILABLE"],
  ["INDISPONÍVEL", "UNAVAILABLE"],
  ["INDISPONIVEL", "UNAVAILABLE"],
  ["ARCHIVED", "ARCHIVED"],
  ["ARQUIVADO", "ARCHIVED"],
]);

export function normalizeServiceStatus(value) {
  const key = String(value || "").trim().toUpperCase();
  return STATUS_ALIASES.get(key) || key;
}

export function isServiceStatus(value) {
  return SERVICE_STATUSES.includes(normalizeServiceStatus(value));
}

function text(value) {
  return String(value ?? "").trim();
}

function english(plan) {
  return plan?.translations?.en ?? {};
}

function englishFeature(feature) {
  return feature?.translations?.en ?? {};
}

function percent(done, total) {
  return total ? Math.round((done / total) * 100) : 100;
}

export function contentCompleteness(plan = {}) {
  const fields = ["timeline", "scope", "scopeShort", "description"];
  const features = Array.isArray(plan.features) ? plan.features : [];
  const total = fields.length + features.length;
  const en = english(plan);
  const baseDone = fields.filter((field) => text(plan[field])).length + features.filter((feature) => text(feature.text)).length;
  const enValue = (field) => en[field] ?? (field === "scopeShort" ? en.scope_short : undefined);
  const enDone = fields.filter((field) => text(enValue(field))).length + features.filter((feature) => text(englishFeature(feature).text)).length;

  return {
    pt: { done: baseDone, total, percent: percent(baseDone, total) },
    en: { done: enDone, total, percent: percent(enDone, total) },
  };
}

export function serviceHealth(plan = {}) {
  const features = Array.isArray(plan.features) ? plan.features : [];
  const status = normalizeServiceStatus(plan.status);
  const completeness = contentCompleteness(plan);
  const checks = [
    { key: "name", ok: Boolean(text(plan.name)), severity: "incomplete" },
    { key: "range", ok: Boolean(text(plan.range)), severity: "incomplete" },
    { key: "timeline", ok: Boolean(text(plan.timeline)), severity: "incomplete" },
    { key: "descriptionPt", ok: Boolean(text(plan.description)), severity: "incomplete" },
    { key: "features", ok: features.some((feature) => text(feature.text)), severity: "incomplete" },
    { key: "publicationState", ok: isServiceStatus(status), severity: "incomplete" },
    { key: "englishCompleteness", ok: completeness.en.percent === 100, severity: "attention" },
    { key: "availableHidden", ok: !(status === "AVAILABLE" && plan.visible === false), severity: "attention" },
    { key: "archivedVisible", ok: !(status === "ARCHIVED" && plan.visible === true), severity: "attention" },
  ];
  const essentialFailures = checks.filter((check) => !check.ok && check.severity === "incomplete");
  const warnings = checks.filter((check) => !check.ok && check.severity === "attention");
  const total = checks.filter((check) => check.severity === "incomplete").length;
  const score = total - essentialFailures.length;

  return {
    status: essentialFailures.length ? "incomplete" : warnings.length ? "attention" : "healthy",
    score,
    total,
    checks,
    completeness,
  };
}

export function serviceReadiness(plan = {}) {
  const health = serviceHealth(plan);
  return {
    ok: !health.checks.some((check) => !check.ok && check.severity === "incomplete"),
    blocking: health.checks.filter((check) => !check.ok && check.severity === "incomplete"),
    warnings: health.checks.filter((check) => !check.ok && check.severity === "attention"),
    health,
  };
}
