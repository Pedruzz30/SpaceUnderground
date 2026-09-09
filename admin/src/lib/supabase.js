import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from "../config/env.js";
import { DataError } from "../services/errors.js";

// Only the public anon key ever reaches this bundle. Authorization is enforced
// by row level security in Postgres, never by this client.

let client = null;

export function getSupabaseClient() {
  if (!isSupabaseConfigured()) {
    throw new DataError(
      "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, or run with VITE_ADMIN_DATA_SOURCE=mock.",
      { code: "not_configured" },
    );
  }

  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  }

  return client;
}
