import { getSupabaseClient } from "../../lib/supabase.js";
import { toDataError } from "../errors.js";

function mapRow(row) {
  row = row ?? {};
  return {
    siteName: row.site_name ?? "",
    siteUrl: row.site_url ?? "",
    contactEmail: row.contact_email ?? "",
    locale: row.locale ?? "",
    seoTitle: row.seo_title ?? "",
    seoDescription: row.seo_description ?? "",
    ogImagePath: row.og_image_path ?? "",
    updatedAt: row.updated_at ?? null,
    updatedBy: row.updated_by ?? null,
  };
}

function toRow(settings) {
  return {
    key: "public",
    site_name: settings.siteName || null,
    site_url: settings.siteUrl || null,
    contact_email: settings.contactEmail || null,
    locale: settings.locale || null,
    seo_title: settings.seoTitle || null,
    seo_description: settings.seoDescription || null,
    og_image_path: settings.ogImagePath || null,
  };
}

function unwrap(result, fallbackMessage) {
  if (result.error) throw toDataError(result.error, fallbackMessage);
  return result.data;
}

export const supabaseSettingsRepository = {
  async get() {
    const result = await getSupabaseClient().from("site_settings").select("*").eq("key", "public").maybeSingle();
    return mapRow(unwrap(result, "Unable to load site settings."));
  },

  async save(settings) {
    const result = await getSupabaseClient()
      .from("site_settings")
      .upsert(toRow(settings), { onConflict: "key" })
      .select("*")
      .single();
    return mapRow(unwrap(result, "Unable to save site settings."));
  },
};
