import { normalizeServiceStatus } from "../../utils/service-health.js";

const EDITABLE_TRANSLATION_FIELDS = new Map([
  ["timeline", "timeline"],
  ["scope", "scope"],
  ["scopeShort", "scope_short"],
  ["scope_short", "scope_short"],
  ["description", "description"],
]);

export function mapPlanTranslationsFromDatabase(translations = {}) {
  const result = { ...(translations ?? {}) };
  if (result.en?.scope_short !== undefined) {
    result.en = { ...result.en, scopeShort: result.en.scope_short };
  }
  return result;
}

export function mergePlanTranslations(existing = {}, editorialDraft = {}) {
  const merged = { ...(existing ?? {}) };
  const existingEn = merged.en && typeof merged.en === "object" ? merged.en : {};
  const en = { ...existingEn };

  for (const [adminField, dbField] of EDITABLE_TRANSLATION_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(editorialDraft, adminField)) continue;
    const value = String(editorialDraft[adminField] ?? "").trim();
    if (value) en[dbField] = value;
    else delete en[dbField];
    if (adminField !== dbField) delete en[adminField];
  }

  if (Object.keys(en).length) merged.en = en;
  else delete merged.en;
  return merged;
}

export function normalizePlanTranslationsForDatabase(translations = {}) {
  const result = { ...(translations ?? {}) };
  if (result.en && typeof result.en === "object") {
    result.en = { ...result.en };
    if (result.en.scopeShort !== undefined && result.en.scope_short === undefined) {
      result.en.scope_short = result.en.scopeShort;
    }
    delete result.en.scopeShort;
  }
  return result;
}

export function mapFeaturesFromDatabase(rows) {
  if (!Array.isArray(rows)) return [];
  return [...rows]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((row, index) => ({
      id: row.id ?? null,
      position: Number.isFinite(Number(row.position)) ? Number(row.position) : index,
      text: row.text ?? "",
      translations: row.translations ?? {},
    }));
}

export function mapPlanFromDatabase(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug ?? "",
    name: row.name ?? "",
    monogram: row.monogram ?? "",
    category: row.category ?? "",
    range: row.range ?? "",
    scope: row.scope ?? "",
    scopeShort: row.scope_short ?? "",
    status: normalizeServiceStatus(row.status),
    description: row.description ?? "",
    timeline: row.timeline ?? "",
    year: row.year == null ? "" : String(row.year),
    accent: row.accent ?? "",
    visible: Boolean(row.visible),
    position: Number(row.position) || 0,
    features: mapFeaturesFromDatabase(row.plan_features),
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
    translations: mapPlanTranslationsFromDatabase(row.translations ?? {}),
  };
}

export function mapPlanToDatabase(plan) {
  const row = {};
  if (plan.slug !== undefined) row.slug = plan.slug;
  if (plan.name !== undefined) row.name = plan.name;
  if (plan.monogram !== undefined) row.monogram = plan.monogram || null;
  if (plan.category !== undefined) row.category = plan.category || null;
  if (plan.range !== undefined) row.range = plan.range || null;
  if (plan.scope !== undefined) row.scope = plan.scope || null;
  if (plan.scopeShort !== undefined) row.scope_short = plan.scopeShort || null;
  if (plan.status !== undefined) row.status = normalizeServiceStatus(plan.status || "UNAVAILABLE");
  if (plan.description !== undefined) row.description = plan.description || null;
  if (plan.timeline !== undefined) row.timeline = plan.timeline || null;
  if (plan.year !== undefined) row.year = plan.year === "" ? null : Number(plan.year);
  if (plan.accent !== undefined) row.accent = plan.accent || null;
  if (plan.visible !== undefined) row.visible = Boolean(plan.visible);
  if (plan.position !== undefined) row.position = Number(plan.position) || 0;
  if (plan.translations !== undefined) row.translations = normalizePlanTranslationsForDatabase(plan.translations ?? {});
  return row;
}
