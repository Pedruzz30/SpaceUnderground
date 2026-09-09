// Central place for build-time configuration. Nothing secret lives here:
// only the public anon key and the data source selector are ever exposed.

const env = import.meta.env ?? {};

const RAW_DATA_SOURCE = String(env.VITE_ADMIN_DATA_SOURCE ?? "mock").toLowerCase();

export const DATA_SOURCE = RAW_DATA_SOURCE === "supabase" ? "supabase" : "mock";

export const SUPABASE_URL = env.VITE_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY ?? "";

export function isSupabaseMode() {
  return DATA_SOURCE === "supabase";
}

export function isSupabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}
