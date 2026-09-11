// Central place for build-time configuration. Nothing secret lives here:
// only the public anon key and the data source selector are ever exposed.

const env = import.meta.env ?? {};

const RAW_DATA_SOURCE = String(env.VITE_ADMIN_DATA_SOURCE ?? "").trim().toLowerCase();
const IS_PRODUCTION = Boolean(env.PROD);
const VALID_DATA_SOURCE = ["mock", "supabase"].includes(RAW_DATA_SOURCE);

// Development keeps the historical mock default. Production never does:
// a missing or invalid selector becomes an explicit configuration error instead
// of silently booting a fake localStorage admin.
export const CONFIGURATION_ERROR = IS_PRODUCTION && !VALID_DATA_SOURCE
  ? "VITE_ADMIN_DATA_SOURCE must be explicitly configured as supabase for production."
  : "";

export const DATA_SOURCE = VALID_DATA_SOURCE
  ? RAW_DATA_SOURCE
  : IS_PRODUCTION
    ? "invalid"
    : "mock";

export const SUPABASE_URL = env.VITE_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY ?? "";

export function isSupabaseMode() {
  return DATA_SOURCE === "supabase";
}

export function isSupabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

export function hasAdminConfigurationError() {
  if (CONFIGURATION_ERROR) return true;
  if (IS_PRODUCTION && DATA_SOURCE === "supabase" && !isSupabaseConfigured()) return true;
  return false;
}

export function adminConfigurationErrorMessage() {
  if (CONFIGURATION_ERROR) return CONFIGURATION_ERROR;
  if (IS_PRODUCTION && DATA_SOURCE === "supabase" && !isSupabaseConfigured()) {
    return "Supabase production configuration is incomplete. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.";
  }
  return "";
}
