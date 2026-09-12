import { getSupabaseClient } from "../../lib/supabase.js";
import { toDataError } from "../errors.js";
import { t } from "../../i18n/index.js";

function mapRow(row) {
  return {
    id: row.id,
    title: row.title ?? "",
    detail: row.detail ?? "",
    action: row.action ?? "",
    entityType: row.entity_type ?? "",
    entityId: row.entity_id ?? "",
    time: row.created_at ?? null,
    adminUserId: row.admin_user_id ?? null,
  };
}

export const supabaseActivityRepository = {
  async list({ limit = 40 } = {}) {
    const { data, error } = await getSupabaseClient()
      .from("activity_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw toDataError(error, t("errors.data.loadActivity"));
    return (data ?? []).map(mapRow);
  },

  async add(entry) {
    const supabase = getSupabaseClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const { data, error } = await supabase
      .from("activity_log")
      .insert({
        admin_user_id: sessionData?.session?.user?.id ?? null,
        action: entry.action || "admin.event",
        entity_type: entry.entityType || "system",
        entity_id: entry.entityId || null,
        title: entry.title,
        detail: entry.detail || null,
      })
      .select("*")
      .single();
    if (error) throw toDataError(error, t("errors.data.recordActivity"));
    return mapRow(data);
  },
};
