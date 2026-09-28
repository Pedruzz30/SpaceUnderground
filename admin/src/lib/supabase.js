import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from "../config/env.js";
import { DataError } from "../services/errors.js";

// Only the public anon key ever reaches this bundle. Authorization is enforced
// by row level security in Postgres, never by this client.

let client = null;
let testClient = null;

// Lets a unit test hand the repositories a fake client and read exactly what
// they send. Never set by the app.
export function setSupabaseClientForTests(fake) {
  testClient = fake;
}

export function getSupabaseClient() {
  if (testClient) return testClient;
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
