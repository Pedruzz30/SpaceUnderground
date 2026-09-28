import { getSupabaseClient } from "../../lib/supabase.js";
import { toDataError } from "../errors.js";
import { mapOpportunityFromDatabase, mapOpportunityToDatabase, OPPORTUNITY_COLUMNS } from "../mappers/commercial-mapper.js";
import { t } from "../../i18n/index.js";

const TABLE = "commercial_opportunities";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function unwrap(result, fallbackMessage) {
  if (result.error) throw toDataError(result.error, fallbackMessage);
  return result.data;
}

// Deals are addressed by uuid; anything else is not a deal, and asking
// Postgres would only turn it into an invalid-uuid error.
function isOpportunityId(id) {
  return UUID_PATTERN.test(String(id ?? ""));
}

export const supabaseCommercialRepository = {
  async list() {
    const result = await getSupabaseClient()
      .from(TABLE)
      .select(OPPORTUNITY_COLUMNS)
      .order("position", { ascending: true })
      .order("created_at", { ascending: false });
    return unwrap(result, t("errors.data.loadOpportunities")).map(mapOpportunityFromDatabase);
  },

  async getById(id) {
    if (!isOpportunityId(id)) return null;
    const result = await getSupabaseClient().from(TABLE).select(OPPORTUNITY_COLUMNS).eq("id", id).maybeSingle();
    return mapOpportunityFromDatabase(unwrap(result, t("errors.data.loadOpportunities")));
  },

  async create(data) {
    const result = await getSupabaseClient().from(TABLE).insert(mapOpportunityToDatabase(data)).select(OPPORTUNITY_COLUMNS).single();
    return mapOpportunityFromDatabase(unwrap(result, t("errors.data.saveOpportunity")));
  },

  async update(id, patch) {
    if (!isOpportunityId(id)) return null;
    const result = await getSupabaseClient()
      .from(TABLE)
      .update(mapOpportunityToDatabase(patch))
      .eq("id", id)
      .select(OPPORTUNITY_COLUMNS)
      .maybeSingle();
    return mapOpportunityFromDatabase(unwrap(result, t("errors.data.saveOpportunity")));
  },

  async remove(id) {
    if (!isOpportunityId(id)) return null;
    const result = await getSupabaseClient().from(TABLE).delete().eq("id", id).select(OPPORTUNITY_COLUMNS).maybeSingle();
    return mapOpportunityFromDatabase(unwrap(result, t("errors.data.deleteOpportunity")));
  },
};
