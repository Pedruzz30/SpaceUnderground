import { commercialPlan, plans } from "./plans-registry.js";
import { getLocale } from "./i18n/index.js";
import { normalizeServiceStatus, serviceStatusLabel } from "./service-status.js";

const FALLBACK_CATEGORY = {
  "pt-BR": "PLANO / SERVIÇO DIGITAL",
  en: "PLAN / DIGITAL SERVICE",
};

let liveRows = null;
let currentPlans = [];

function text(value) {
  return typeof value === "string" ? value.trim() : value || "";
}

function localizedFor(record, field, locale) {
  const translations = record?.translations?.[locale] ?? {};
  const translated = translations[field] ?? (field === "scopeShort" ? translations.scope_short : undefined);
  return text(translated) || text(record?.[field]) || text(record?.[field === "scopeShort" ? "scope_short" : field]);
}

function monogramFor(name) {
  return text(name)
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "SU";
}

function featureText(feature, locale) {
  return text(feature?.translations?.[locale]?.text) || text(feature?.text);
}

function fallbackPlanToViewModel(plan, index, locale = getLocale()) {
  const localized = locale === "pt-BR" ? commercialPlan(plan) : plan;
  const status = normalizeServiceStatus(plan.status);
  return {
    id: String(index + 1).padStart(3, "0"),
    key: plan.key || plan.slug,
    slug: plan.slug || plan.key,
    name: plan.name,
    monogram: plan.monogram || monogramFor(plan.name),
    category: localized.category || FALLBACK_CATEGORY[locale],
    range: localized.range || plan.range,
    scope: localized.scope || plan.scope,
    scopeShort: localized.scopeShort || plan.scopeShort,
    status,
    statusLabel: serviceStatusLabel(status, locale),
    description: localized.description || plan.description,
    timeline: localized.timeline || plan.timeline,
    year: localized.year || plan.year || String(new Date().getFullYear()),
    accent: localized.accent || plan.accent || "#c6ff00",
    code: plan.code || `${String(plan.slug || plan.key || "plan").toUpperCase()}_${String(index + 1).padStart(3, "0")}`,
    included: localized.included || plan.included || [],
    position: Number(plan.position ?? index),
  };
}

export function planRowToViewModel(row, index = 0, locale = getLocale()) {
  const slug = text(row?.slug) || `plan-${index + 1}`;
  const fallback = plans[slug.replace(/^plan-/, "")] || {};
  const status = normalizeServiceStatus(row?.status || fallback.status);
  const features = Array.isArray(row?.plan_features)
    ? [...row.plan_features].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map((feature) => featureText(feature, locale)).filter(Boolean)
    : fallback.included || [];
  const name = text(row?.name) || fallback.name || slug;

  return {
    id: String(index + 1).padStart(3, "0"),
    key: slug,
    slug,
    name,
    monogram: text(row?.monogram) || fallback.monogram || monogramFor(name),
    category: localizedFor(row, "category", locale) || fallbackPlanToViewModel(fallback, index, locale).category || FALLBACK_CATEGORY[locale],
    range: text(row?.range) || fallback.range || "",
    scope: localizedFor(row, "scope", locale) || fallback.scope || "",
    scopeShort: localizedFor(row, "scopeShort", locale) || fallback.scopeShort || "",
    status,
    statusLabel: serviceStatusLabel(status, locale),
    description: localizedFor(row, "description", locale) || fallback.description || "",
    timeline: localizedFor(row, "timeline", locale) || fallback.timeline || "",
    year: row?.year ? String(row.year) : fallback.year || String(new Date().getFullYear()),
    accent: text(row?.accent) || fallback.accent || "#c6ff00",
    code: `${slug.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_${String(index + 1).padStart(3, "0")}`,
    included: features,
    position: Number(row?.position ?? index),
  };
}

function rowsToViewModels(rows, locale = getLocale()) {
  return [...rows]
    .sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0))
    .map((row, index) => planRowToViewModel(row, index, locale));
}

function fallbackViewModels(locale = getLocale()) {
  return Object.values(plans).map((plan, index) => fallbackPlanToViewModel(plan, index, locale));
}

export function setPublicPlanRows(rows, locale = getLocale()) {
  liveRows = Array.isArray(rows) ? [...rows] : null;
  currentPlans = liveRows ? rowsToViewModels(liveRows, locale) : fallbackViewModels(locale);
  return listPublicPlans();
}

export function refreshPublicPlansForLocale(locale = getLocale()) {
  currentPlans = liveRows ? rowsToViewModels(liveRows, locale) : fallbackViewModels(locale);
  return listPublicPlans();
}

export function resetPublicPlansToFallback(locale = getLocale()) {
  liveRows = null;
  currentPlans = fallbackViewModels(locale);
  return listPublicPlans();
}

export function listPublicPlans() {
  if (!currentPlans.length && liveRows === null) resetPublicPlansToFallback();
  return currentPlans.map((plan) => ({ ...plan, included: [...(plan.included || [])] }));
}

export function getPublicPlan(key) {
  return listPublicPlans().find((plan) => plan.key === key || plan.slug === key) ?? null;
}
