// Central place for build-time configuration. Nothing secret lives here:
// only the public anon key and the data source selector are ever exposed.

const env = import.meta.env ?? {};

const VALID_DATA_SOURCES = new Set(["mock", "supabase"]);
const RAW_DATA_SOURCE = String(env.VITE_ADMIN_DATA_SOURCE ?? "").trim().toLowerCase();
const IS_PRODUCTION = Boolean(env.PROD);
const ALLOW_MOCK_BUILD = String(env.VITE_ADMIN_ALLOW_MOCK_BUILD ?? "").trim().toLowerCase() === "true";
const requestedDataSource = RAW_DATA_SOURCE || (IS_PRODUCTION ? "" : "mock");

export const DATA_SOURCE = VALID_DATA_SOURCES.has(requestedDataSource) ? requestedDataSource : "invalid";

export const SUPABASE_URL = env.VITE_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY ?? "";

const configurationProblems = [];

if (DATA_SOURCE === "invalid") {
  configurationProblems.push(
    IS_PRODUCTION
      ? "Production admin requires VITE_ADMIN_DATA_SOURCE=supabase."
      : "VITE_ADMIN_DATA_SOURCE must be either mock or supabase.",
  );
}

if (IS_PRODUCTION && DATA_SOURCE === "mock" && !ALLOW_MOCK_BUILD) {
  configurationProblems.push("Production admin cannot run in mock mode.");
}

if (DATA_SOURCE === "supabase" && !(SUPABASE_URL && SUPABASE_ANON_KEY)) {
  configurationProblems.push("Supabase mode requires VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
}

export const CONFIGURATION_ERROR = configurationProblems.join(" ");

export function isSupabaseMode() {
  return DATA_SOURCE === "supabase";
}

export function isSupabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

export function isConfigurationValid() {
  return !CONFIGURATION_ERROR;
}

export function hasAdminConfigurationError() {
  return !isConfigurationValid();
}

export function adminConfigurationErrorMessage() {
  return CONFIGURATION_ERROR;
}
