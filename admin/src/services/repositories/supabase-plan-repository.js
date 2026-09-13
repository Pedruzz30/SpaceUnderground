import { getSupabaseClient } from "../../lib/supabase.js";
import { toDataError } from "../errors.js";
import { mapPlanFromDatabase, mapPlanToDatabase, mergePlanTranslations } from "../mappers/plan-mapper.js";
import { t } from "../../i18n/index.js";

const TABLE = "plans";
const FEATURES_TABLE = "plan_features";
const SELECT = "*, plan_features(*)";

function unwrap(result, fallbackMessage) {
  if (result.error) throw toDataError(result.error, fallbackMessage);
  return result.data;
}

async function syncFeatures(planId, features) {
  const supabase = getSupabaseClient();
  const existing = unwrap(await supabase.from(FEATURES_TABLE).select("id").eq("plan_id", planId), t("errors.data.loadPlanFeatures"));
  const existingIds = new Set(existing.map((row) => row.id));
  const keptIds = new Set(features.filter((item) => item.id && existingIds.has(item.id)).map((item) => item.id));
  const removedIds = [...existingIds].filter((id) => !keptIds.has(id));

  if (removedIds.length) {
    unwrap(await supabase.from(FEATURES_TABLE).delete().in("id", removedIds), t("errors.data.updatePlanFeatures"));
  }

  for (const [index, item] of features.entries()) {
    if (!keptIds.has(item.id)) continue;
    unwrap(await supabase.from(FEATURES_TABLE).update({ position: 100000 + index }).eq("id", item.id), t("errors.data.updatePlanFeatures"));
  }

  for (const [index, item] of features.entries()) {
    if (!keptIds.has(item.id)) continue;
    unwrap(
      await supabase
        .from(FEATURES_TABLE)
        .update({ position: index, text: item.text, translations: item.translations ?? {} })
        .eq("id", item.id),
      t("errors.data.updatePlanFeatures"),
    );
  }

  const inserts = features
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !item.id || !existingIds.has(item.id))
    .map(({ item, index }) => ({ plan_id: planId, position: index, text: item.text, translations: item.translations ?? {} }));

  if (inserts.length) {
    unwrap(await supabase.from(FEATURES_TABLE).insert(inserts), t("errors.data.savePlanFeatures"));
  }
}

export const supabasePlanRepository = {
  async list() {
    const result = await getSupabaseClient().from(TABLE).select(SELECT).order("position", { ascending: true });
    return unwrap(result, t("errors.data.loadPlans")).map(mapPlanFromDatabase);
  },

  async getById(id) {
    const result = await getSupabaseClient().from(TABLE).select(SELECT).or(`id.eq.${id},slug.eq.${id}`).maybeSingle();
    const row = unwrap(result, t("errors.data.loadPlan"));
    return row ? mapPlanFromDatabase(row) : null;
  },

  async create(data) {
    const supabase = getSupabaseClient();
    const features = Array.isArray(data.features) ? data.features : [];
    const inserted = unwrap(
      await supabase.from(TABLE).insert(mapPlanToDatabase(data)).select("id").single(),
      t("errors.data.savePlan"),
    );
    if (features.length) await syncFeatures(inserted.id, features);
    return mapPlanFromDatabase(unwrap(await supabase.from(TABLE).select(SELECT).eq("id", inserted.id).single(), t("errors.data.reloadPlan")));
  },

  async update(id, patch) {
    const supabase = getSupabaseClient();
    const existing = unwrap(await supabase.from(TABLE).select("id,translations").or(`id.eq.${id},slug.eq.${id}`).maybeSingle(), t("errors.data.loadPlan"));
    if (!existing) return null;

    const dbPatch = mapPlanToDatabase(patch);
    if (patch.translations !== undefined) {
      dbPatch.translations = mergePlanTranslations(existing.translations ?? {}, patch.translations?.en ?? {});
    }
    unwrap(await supabase.from(TABLE).update(dbPatch).eq("id", existing.id), t("errors.data.savePlan"));
    if (Array.isArray(patch.features)) await syncFeatures(existing.id, patch.features);
    return mapPlanFromDatabase(unwrap(await supabase.from(TABLE).select(SELECT).eq("id", existing.id).single(), t("errors.data.reloadPlan")));
  },
};
