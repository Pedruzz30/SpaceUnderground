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

Deno.serve((request: Request) =>
  handleTeamInvite(request, {
    env: (name: string) => Deno.env.get(name),
    createClient,
    log: (message: string) => console.warn(message),
  }),
);
