import { getSupabaseClient } from "../../lib/supabase.js";
import { toDataError } from "../errors.js";
import { CLIENT_COLUMNS, mapClientFromDatabase, mapClientToDatabase } from "../mappers/client-mapper.js";
import { t } from "../../i18n/index.js";

const TABLE = "clients";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function unwrap(result, fallbackMessage) {
  if (result.error) throw toDataError(result.error, fallbackMessage);
  return result.data;
}

// Clients are addressed by their uuid. Anything else (an old demo link such as
// #/clients/004) is simply not a client, and asking Postgres would only turn
// that into an invalid-uuid error.
function isClientId(id) {
  return UUID_PATTERN.test(String(id ?? ""));
}

export const supabaseClientRepository = {
  async list() {
    const result = await getSupabaseClient()
      .from(TABLE)
      .select(CLIENT_COLUMNS)
      .order("updated_at", { ascending: false });
    return unwrap(result, t("errors.data.loadClients")).map(mapClientFromDatabase);
  },

  async getById(id) {
    if (!isClientId(id)) return null;
    const result = await getSupabaseClient().from(TABLE).select(CLIENT_COLUMNS).eq("id", id).maybeSingle();
    return mapClientFromDatabase(unwrap(result, t("errors.data.loadClient")));
  },

  async create(data) {
    // code, archived_at and the timestamps are owned by the database: a blank
    // code is left out so public.next_client_code() assigns one.
    const result = await getSupabaseClient().from(TABLE).insert(mapClientToDatabase(data)).select(CLIENT_COLUMNS).single();
    return mapClientFromDatabase(unwrap(result, t("errors.data.createClient")));
  },

  async update(id, patch) {
    if (!isClientId(id)) return null;
    const result = await getSupabaseClient()
      .from(TABLE)
      .update(mapClientToDatabase(patch))
      .eq("id", id)
      .select(CLIENT_COLUMNS)
      .maybeSingle();
    return mapClientFromDatabase(unwrap(result, t("errors.data.saveClient")));
  },
};
