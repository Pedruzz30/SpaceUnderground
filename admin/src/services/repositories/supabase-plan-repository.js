import { getSupabaseClient } from "../../lib/supabase.js";
import { toDataError } from "../errors.js";
import { mapPlanFromDatabase, mapPlanToDatabase } from "../mappers/plan-mapper.js";

const TABLE = "plans";
const FEATURES_TABLE = "plan_features";
const SELECT = "*, plan_features(*)";

function unwrap(result, fallbackMessage) {
  if (result.error) throw toDataError(result.error, fallbackMessage);
  return result.data;
}

async function syncFeatures(planId, features) {
  const supabase = getSupabaseClient();
  const existing = unwrap(await supabase.from(FEATURES_TABLE).select("id").eq("plan_id", planId), "Unable to load plan features.");
  const existingIds = new Set(existing.map((row) => row.id));
  const keptIds = new Set(features.filter((item) => item.id && existingIds.has(item.id)).map((item) => item.id));
  const removedIds = [...existingIds].filter((id) => !keptIds.has(id));

  if (removedIds.length) {
    unwrap(await supabase.from(FEATURES_TABLE).delete().in("id", removedIds), "Unable to update plan features.");
  }

  for (const [index, item] of features.entries()) {
    if (!keptIds.has(item.id)) continue;
    unwrap(await supabase.from(FEATURES_TABLE).update({ position: 100000 + index }).eq("id", item.id), "Unable to update plan features.");
  }

  for (const [index, item] of features.entries()) {
    if (!keptIds.has(item.id)) continue;
    unwrap(await supabase.from(FEATURES_TABLE).update({ position: index, text: item.text }).eq("id", item.id), "Unable to update plan features.");
  }

  const inserts = features
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !item.id || !existingIds.has(item.id))
    .map(({ item, index }) => ({ plan_id: planId, position: index, text: item.text }));

  if (inserts.length) {
    unwrap(await supabase.from(FEATURES_TABLE).insert(inserts), "Unable to save plan features.");
  }
}

export const supabasePlanRepository = {
  async list() {
    const result = await getSupabaseClient().from(TABLE).select(SELECT).order("position", { ascending: true });
    return unwrap(result, "Unable to load plans.").map(mapPlanFromDatabase);
  },

  async update(id, patch) {
    const supabase = getSupabaseClient();
    const existing = unwrap(await supabase.from(TABLE).select("id").eq("id", id).maybeSingle(), "Unable to load plan.");
    if (!existing) return null;

    unwrap(await supabase.from(TABLE).update(mapPlanToDatabase(patch)).eq("id", existing.id), "Unable to save plan.");
    if (Array.isArray(patch.features)) await syncFeatures(existing.id, patch.features);
    return mapPlanFromDatabase(unwrap(await supabase.from(TABLE).select(SELECT).eq("id", existing.id).single(), "Unable to reload plan."));
  },
};
