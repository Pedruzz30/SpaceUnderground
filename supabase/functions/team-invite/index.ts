// Supabase Edge Function entry point. All logic lives in handler.js; see it
// for what this function may and may not do.
//
// Deploy (manual, not part of any automated flow):
//   supabase secrets set ADMIN_ALLOWED_ORIGINS=https://<admin host> ADMIN_INVITE_REDIRECT_URL=https://<admin host>/
//   supabase functions deploy team-invite
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided
// by the Edge runtime. See docs/security-architecture.md.

import { createClient } from "npm:@supabase/supabase-js@2";
import { handleTeamInvite } from "./handler.js";

const PUBLIC_DEFAULTS: Record<string, string> = {
  ADMIN_ALLOWED_ORIGINS: "https://space-underground-admin.netlify.app",
  ADMIN_INVITE_REDIRECT_URL: "https://space-underground-admin.netlify.app/",
};

Deno.serve((request: Request) =>
  handleTeamInvite(request, {
    // These two values are public deployment coordinates, not secrets. Keeping
    // safe production defaults means the function cannot boot half-configured
    // just because dashboard-only env setup was skipped. Supabase still
    // supplies URL/anon/service-role credentials through the Edge runtime.
    env: (name: string) => Deno.env.get(name) ?? PUBLIC_DEFAULTS[name],
    createClient,
    log: (message: string) => console.warn(message),
  }),
);