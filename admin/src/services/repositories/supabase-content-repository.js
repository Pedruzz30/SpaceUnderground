import { getSupabaseClient } from "../../lib/supabase.js";
import { toDataError } from "../errors.js";

function mapRow(row) {
  return {
    key: row.key,
    content: row.content ?? {},
    updatedAt: row.updated_at ?? null,
    updatedBy: row.updated_by ?? null,
  };
}

function unwrap(result, fallbackMessage) {
  if (result.error) throw toDataError(result.error, fallbackMessage);
  return result.data;
}

export const supabaseContentRepository = {
  async list() {
    const result = await getSupabaseClient().from("site_content").select("*").order("key", { ascending: true });
    return unwrap(result, "Unable to load site content.").map(mapRow);
  },

  async upsert(entry) {
    const supabase = getSupabaseClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const result = await supabase
      .from("site_content")
      .upsert({
        key: entry.key,
        content: entry.content ?? {},
        updated_by: sessionData?.session?.user?.id ?? null,
      }, { onConflict: "key" })
      .select("*")
      .single();
    return mapRow(unwrap(result, "Unable to save site content."));
  },
};
