// Central place for build-time configuration. Nothing secret lives here:
// only the public anon key and the data source selector are ever exposed.

// Vite replaces `import.meta.env` at build time; under node, where the unit
// tests run, it is undefined. The fallback is the seam those tests use to
// exercise configurations the bundle would otherwise freeze at build time. In
// a browser bundle `import.meta.env` always wins, so it is never consulted.
function readEnv() {
  return import.meta.env ?? globalThis.__SPACE_ADMIN_ENV__ ?? {};
}

const env = readEnv();

const VALID_DATA_SOURCES = new Set(["mock", "supabase"]);
const RAW_DATA_SOURCE = String(env.VITE_ADMIN_DATA_SOURCE ?? "").trim().toLowerCase();
const IS_PRODUCTION = Boolean(env.PROD);
const ALLOW_MOCK_BUILD = String(env.VITE_ADMIN_ALLOW_MOCK_BUILD ?? "").trim().toLowerCase() === "true";
const requestedDataSource = RAW_DATA_SOURCE || (IS_PRODUCTION ? "" : "mock");

export const DATA_SOURCE = VALID_DATA_SOURCES.has(requestedDataSource) ? requestedDataSource : "invalid";

export const SUPABASE_URL = env.VITE_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY ?? "";

// Optional automation service (services/automation-api). The Admin works
// without it: when the URL is unset every automation feature reports itself
// "not configured" and nothing else changes, which is why it is absent from
// configurationProblems below.
//
// Only the URL lives here, and it is not a secret. There is deliberately no
// token: anything shipped to a browser is public, so the Admin authenticates
// to the service with the signed-in member's Supabase access token instead.
// The service role key belongs to the Python process alone.
//
// Read on each call rather than frozen at module load, so the unit tests can
// cover the configured and the unconfigured Admin in one process.
export function automationApiBaseUrl() {
  return String(readEnv().VITE_AUTOMATION_API_URL ?? "").trim().replace(/\/+$/, "");
}

export function isAutomationApiConfigured() {
  return Boolean(automationApiBaseUrl());
}

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
