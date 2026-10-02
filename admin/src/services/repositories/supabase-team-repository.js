import { getSupabaseClient } from "../../lib/supabase.js";
import { mapInvitation, mapMember } from "../mappers/team-mapper.js";

// The team, read through RLS (team.read) and changed only through the
// security functions and the team-invite Edge Function. The browser never
// writes a member, role or grant row itself.

async function rows(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

async function rpc(name, args) {
  const { data, error } = await getSupabaseClient().rpc(name, args);
  if (error) throw error;
  return data;
}

// The Edge Function answers { error, message } with an HTTP status; supabase-js
// wraps that in an error whose context is the response.
async function invokeTeamInvite(body) {
  const { data, error } = await getSupabaseClient().functions.invoke("team-invite", { body });
  if (!error) return data;
  let payload = null;
  try {
    payload = await error.context?.json?.();
  } catch {
    payload = null;
  }
  const status = Number(error.context?.status ?? 0);
  if (!payload && (status === 404 || error.name === "FunctionsFetchError" || error.name === "FunctionsRelayError")) {
    throw Object.assign(new Error("team-invite is not deployed"), { code: "function_unavailable" });
  }
  throw Object.assign(new Error(payload?.message || error.message || "team-invite failed"), {
    code: payload?.error ?? "function_error",
    reason: payload?.reason ?? null,
    status,
  });
}

async function loadGrants(supabase, userIds = null) {
  let roles = supabase.from("user_roles").select("user_id,role_key,granted_at,expires_at").is("revoked_at", null);
  let projects = supabase.from("project_members").select("id,user_id,project_id,access_level,expires_at,created_at").is("revoked_at", null);
  if (userIds) {
    roles = roles.in("user_id", userIds);
    projects = projects.in("user_id", userIds);
  }
  const [roleRows, projectRows] = await Promise.all([rows(roles), rows(projects)]);
  return { roleRows, projectRows };
}

export const supabaseTeamRepository = {
  async listMembers() {
    const supabase = getSupabaseClient();
    const [members, { roleRows, projectRows }] = await Promise.all([
      rows(supabase.from("team_members").select("*").order("ru", { ascending: true })),
      loadGrants(supabase),
    ]);
    return members.map((row) => mapMember(row, roleRows, projectRows));
  },

  async getMember(userId) {
    const supabase = getSupabaseClient();
    const [member] = await rows(supabase.from("team_members").select("*").eq("user_id", userId).limit(1));
    if (!member) return null;
    const { roleRows, projectRows } = await loadGrants(supabase, [userId]);
    return mapMember(member, roleRows, projectRows);
  },

  async listInvitations() {
    const data = await rows(getSupabaseClient().from("team_invitations").select("*").order("created_at", { ascending: false }).limit(200));
    return data.map(mapInvitation);
  },

  invite: (payload) =>
    invokeTeamInvite({
      action: "invite",
      email: payload.email,
      display_name: payload.displayName,
      roles: payload.roles,
      projects: payload.projects.map((grant) => ({ project_id: grant.projectId, access_level: grant.accessLevel, expires_at: grant.expiresAt || null })),
      access_expires_at: payload.accessExpiresAt || null,
    }),

  resend: (userId) => invokeTeamInvite({ action: "resend", user_id: userId }),

  updateAccess: (userId, { roles, projects, accessExpiresAt, displayName }) =>
    rpc("update_member_access", {
      p_user: userId,
      p_roles: roles,
      p_projects: projects.map((grant) => ({ project_id: grant.projectId, access_level: grant.accessLevel, expires_at: grant.expiresAt || null })),
      p_access_expires_at: accessExpiresAt || null,
      p_display_name: displayName ?? null,
    }),

  suspend: (userId, reason) => rpc("suspend_member", { p_user: userId, p_reason: reason }),
  reactivate: (userId, accessExpiresAt) => rpc("reactivate_member", { p_user: userId, p_access_expires_at: accessExpiresAt || null }),
  offboard: (userId, reason) => rpc("offboard_member", { p_user: userId, p_reason: reason }),
  revokeSessions: (userId) => rpc("revoke_member_sessions", { p_user: userId }),
  cancelInvitation: (invitationId) => rpc("cancel_invitation", { p_invitation: invitationId }),
};
