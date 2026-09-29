// The team-invite Edge Function: the one Admin operation that needs the
// service role, because only Supabase Auth's admin API can send an invitation.
//
// Every decision stays with the database, made for the person calling:
//   1. prepare_invitation / prepare_invitation_resend run with the caller's
//      own JWT, so team.invite, role rank, MFA and step-up, duplicates and
//      the hourly budget are checked for them, exactly as for any request;
//   2. only then does the service role ask Supabase Auth to send the email;
//   3. complete_invitation (service role only) records the member, roles and
//      projects, or fail_invitation records why not.
// The service key never leaves this function, the caller's token is only
// forwarded to the database, and neither is ever logged.
//
// Plain JavaScript with its dependencies passed in, so the Deno entry point
// (index.ts) stays a few lines and admin/tests can exercise this file in Node.

const CODES = {
  42501: 403, // not allowed
  SU004: 422, // invalid input
  SU005: 403, // step-up required
  SU006: 403, // MFA required
  SU007: 429, // too many invitations
  SU008: 409, // state conflict (already a member, invitation open)
  SU009: 403, // rank
  SU010: 404, // not found
  SU011: 410, // expired
  SU013: 401, // this session was ended: sign in again
};

const allowedOrigins = (env) =>
  String(env("ADMIN_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

function corsHeaders(origin, allowed) {
  if (!origin || !allowed.includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

// A database refusal, as the Admin maps it: the SQLSTATE and its message,
// never a stack or a query.
function refusal(error, cors) {
  const code = String(error?.code ?? "");
  return json(CODES[code] ?? 400, { error: code || "request_failed", message: String(error?.message ?? "").slice(0, 300) }, cors);
}

const text = (value) => (typeof value === "string" ? value.trim() : "");

export async function handleTeamInvite(request, { env, createClient, log = () => {} }) {
  const origin = request.headers.get("origin") ?? "";
  const cors = corsHeaders(origin, allowedOrigins(env));

  if (request.method === "OPTIONS") {
    return cors ? new Response(null, { status: 204, headers: cors }) : new Response(null, { status: 403 });
  }
  if (!cors) return json(403, { error: "origin_not_allowed" });
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" }, cors);

  const authorization = request.headers.get("authorization") ?? "";
  if (!/^Bearer [A-Za-z0-9._~+/=-]+$/.test(authorization)) return json(401, { error: "unauthenticated" }, cors);

  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "invalid_json" }, cors);
  }
  if (!body || typeof body !== "object") return json(400, { error: "invalid_json" }, cors);

  const url = env("SUPABASE_URL");
  const anonKey = env("SUPABASE_ANON_KEY");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  const redirectTo = env("ADMIN_INVITE_REDIRECT_URL");
  if (!url || !anonKey || !serviceKey || !redirectTo) {
    log("team-invite: missing configuration");
    return json(500, { error: "not_configured" }, cors);
  }

  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const asCaller = createClient(url, anonKey, { ...options, global: { headers: { Authorization: authorization } } });
  const service = createClient(url, serviceKey, options);

  if (body.action === "resend") {
    const userId = text(body.user_id);
    if (!userId) return json(422, { error: "SU004", message: "user_id is required" }, cors);
    const { data: prepared, error } = await asCaller.rpc("prepare_invitation_resend", { p_user: userId });
    if (error) return refusal(error, cors);
    const { error: sendError } = await service.auth.admin.inviteUserByEmail(prepared.email, { redirectTo });
    if (sendError) {
      log(`team-invite: resend failed (${sendError.code ?? sendError.status ?? "unknown"})`);
      // Supabase Auth only re-sends to someone who has not confirmed yet.
      return json(409, { error: "resend_failed", reason: String(sendError.code ?? "auth_error") }, cors);
    }
    return json(200, { user_id: prepared.user_id, invite_expires_at: prepared.invite_expires_at }, cors);
  }

  if (body.action !== undefined && body.action !== "invite") return json(400, { error: "unknown_action" }, cors);

  const { data: prepared, error: prepareError } = await asCaller.rpc("prepare_invitation", {
    p_email: text(body.email),
    p_display_name: text(body.display_name),
    p_roles: Array.isArray(body.roles) ? body.roles.map(text) : [],
    p_projects: Array.isArray(body.projects) ? body.projects : [],
    p_access_starts_at: body.access_starts_at || null,
    p_access_expires_at: body.access_expires_at || null,
  });
  if (prepareError) return refusal(prepareError, cors);

  const { data: invited, error: inviteError } = await service.auth.admin.inviteUserByEmail(prepared.email, { redirectTo });
  if (inviteError || !invited?.user?.id) {
    const reason = String(inviteError?.code ?? inviteError?.status ?? "auth_invite_failed");
    log(`team-invite: invitation not sent (${reason})`);
    await service.rpc("fail_invitation", { p_invitation: prepared.invitation_id, p_reason: reason });
    return json(409, { error: "invite_failed", reason }, cors);
  }

  const { data: completed, error: completeError } = await service.rpc("complete_invitation", {
    p_invitation: prepared.invitation_id,
    p_user: invited.user.id,
  });
  if (completeError) {
    log(`team-invite: invitation not recorded (${completeError.code ?? "unknown"})`);
    await service.rpc("fail_invitation", { p_invitation: prepared.invitation_id, p_reason: String(completeError.code ?? "complete_failed") });
    return refusal(completeError, cors);
  }

  return json(200, { invitation_id: prepared.invitation_id, user_id: completed.user_id, ru: completed.ru, status: completed.status }, cors);
}
