import { t } from "../i18n/index.js";
import { SERVICE_STATUSES, isServiceStatus, serviceReadiness } from "../utils/service-health.js";
import { DataError } from "./errors.js";
import { getPlanRepository } from "./repositories/index.js";

const DIACRITIC_MARKS = new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`, "g");

export function slugifyPlan(value) {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(DIACRITIC_MARKS, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nextPosition(plans) {
  return plans.reduce((max, plan) => Math.max(max, Number(plan.position) || 0), -1) + 1;
}

function uniqueSlug(base, plans) {
  const used = new Set(plans.map((plan) => plan.slug).filter(Boolean));
  const seed = slugifyPlan(base) || "service";
  if (!used.has(seed)) return seed;
  let index = 2;
  while (used.has(`${seed}-${index}`)) index += 1;
  return `${seed}-${index}`;
}

function validateStatus(status) {
  if (!isServiceStatus(status)) {
    throw new DataError(t("services.validation.statusValid"), { code: "validation", field: "status" });
  }
}

function assertReadyToPublish(plan) {
  if (!plan.visible && plan.status !== "AVAILABLE") return;
  const readiness = serviceReadiness(plan);
  if (readiness.ok) return;
  throw new DataError(t("services.readinessBlocked"), { code: "readiness", field: "visible", cause: readiness });
}

function defaultPlan(position = 0) {
  return {
    name: "",
    slug: "",
    range: "",
    scope: "",
    scopeShort: "",
    status: "UNAVAILABLE",
    description: "",
    timeline: "",
    year: String(new Date().getFullYear()),
    accent: "#c6ff00",
    visible: false,
    position,
    features: [],
    translations: {},
  };
}

export async function getPlans() {
  return (await getPlanRepository()).list();
}

export async function getPlan(id) {
  const repository = await getPlanRepository();
  if (repository.getById) return repository.getById(id);
  return (await repository.list()).find((plan) => plan.id === id || plan.slug === id) ?? null;
}

export async function newPlanDefaults() {
  return defaultPlan(nextPosition(await getPlans()));
}

export async function createPlan(data = {}) {
  const repository = await getPlanRepository();
  if (!repository.create) throw new Error("Plan repository cannot create plans.");
  const plans = await repository.list();
  const payload = { ...defaultPlan(nextPosition(plans)), ...data };
  payload.status = payload.status || "UNAVAILABLE";
  payload.slug = payload.slug || uniqueSlug(payload.name || "service", plans);
  payload.position = Number.isFinite(Number(payload.position)) ? Number(payload.position) : nextPosition(plans);
  payload.features = Array.isArray(payload.features) ? payload.features : [];
  validateStatus(payload.status);
  assertReadyToPublish(payload);
  return repository.create(payload);
}

export async function updatePlan(id, patch) {
  const repository = await getPlanRepository();
  const existing = await getPlan(id);
  if (!existing) throw new Error("Plan not found.");
  const payload = { ...existing, ...patch };
  if (payload.status !== undefined) validateStatus(payload.status);
  assertReadyToPublish(payload);
  const updated = await repository.update(id, patch);
  if (!updated) throw new Error("Plan not found.");
  return updated;
}

export async function duplicatePlan(id) {
  const original = await getPlan(id);
  if (!original) throw new Error("Plan not found.");
  const plans = await getPlans();
  const copyName = `${original.name || t("services.untitledPlan")} Copy`;
  const payload = {
    ...clone(original),
    id: undefined,
    name: copyName,
    slug: uniqueSlug(`${original.name || original.slug || "service"}-copy`, plans),
    status: "UNAVAILABLE",
    visible: false,
    position: nextPosition(plans),
    features: (original.features || []).map((feature, index) => ({
      id: null,
      position: index,
      text: feature.text ?? "",
      translations: clone(feature.translations ?? {}),
    })),
    translations: clone(original.translations ?? {}),
  };
  return createPlan(payload);
}

export async function archivePlan(id) {
  return updatePlan(id, { status: "ARCHIVED", visible: false });
}

export async function unarchivePlan(id) {
  return updatePlan(id, { status: "UNAVAILABLE", visible: false });
}

export { SERVICE_STATUSES };
