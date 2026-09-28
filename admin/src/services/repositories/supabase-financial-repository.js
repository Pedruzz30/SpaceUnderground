import { getSupabaseClient } from "../../lib/supabase.js";
import { toDataError } from "../errors.js";
import { FINANCIAL_COLUMNS, mapTransactionFromDatabase, mapTransactionToDatabase } from "../mappers/financial-mapper.js";
import { t } from "../../i18n/index.js";
import { selectAll } from "./supabase-select-all.js";

const TABLE = "financial_transactions";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function unwrap(result, fallbackMessage) {
  if (result.error) throw toDataError(result.error, fallbackMessage);
  return result.data;
}

// Entries are addressed by uuid; anything else is not an entry, and asking
// Postgres would only turn it into an invalid-uuid error.
function isTransactionId(id) {
  return UUID_PATTERN.test(String(id ?? ""));
}

export const supabaseFinancialRepository = {
  // Paged: the whole ledger is summed on screen, and a response cut at
  // PostgREST's row limit would print wrong totals (supabase-select-all.js).
  async list() {
    const result = await selectAll((withCount) =>
      getSupabaseClient()
        .from(TABLE)
        .select(FINANCIAL_COLUMNS, withCount ? { count: "exact" } : undefined)
        .order("due_date", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: true }),
    );
    return unwrap(result, t("errors.data.loadTransactions")).map(mapTransactionFromDatabase);
  },

  // The entries a won deal created, so a retried win sees what is already there.
  async listByOpportunity(opportunityId) {
    if (!isTransactionId(opportunityId)) return [];
    const result = await getSupabaseClient()
      .from(TABLE)
      .select(FINANCIAL_COLUMNS)
      .eq("opportunity_id", opportunityId)
      .order("due_date", { ascending: true });
    return unwrap(result, t("errors.data.loadTransactions")).map(mapTransactionFromDatabase);
  },

  async getById(id) {
    if (!isTransactionId(id)) return null;
    const result = await getSupabaseClient().from(TABLE).select(FINANCIAL_COLUMNS).eq("id", id).maybeSingle();
    return mapTransactionFromDatabase(unwrap(result, t("errors.data.loadTransactions")));
  },

  async create(data) {
    const [created] = await this.createMany([data]);
    return created;
  },

  // One multi-row insert: Postgres applies it atomically, so a set of
  // installments is either stored whole or not at all.
  async createMany(list) {
    const result = await getSupabaseClient()
      .from(TABLE)
      .insert(list.map(mapTransactionToDatabase))
      .select(FINANCIAL_COLUMNS);
    return unwrap(result, t("errors.data.saveTransaction")).map(mapTransactionFromDatabase);
  },

  async update(id, patch) {
    if (!isTransactionId(id)) return null;
    const result = await getSupabaseClient()
      .from(TABLE)
      .update(mapTransactionToDatabase(patch))
      .eq("id", id)
      .select(FINANCIAL_COLUMNS)
      .maybeSingle();
    return mapTransactionFromDatabase(unwrap(result, t("errors.data.saveTransaction")));
  },

  async remove(id) {
    if (!isTransactionId(id)) return null;
    const result = await getSupabaseClient().from(TABLE).delete().eq("id", id).select(FINANCIAL_COLUMNS).maybeSingle();
    return mapTransactionFromDatabase(unwrap(result, t("errors.data.deleteTransaction")));
  },
};
