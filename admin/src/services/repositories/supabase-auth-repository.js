import { getSupabaseClient } from "../../lib/supabase.js";
import { toDataError } from "../errors.js";
import { t } from "../../i18n/index.js";

// Authentication proves who you are; the admins table decides whether you are
// allowed in. Both checks are enforced again by RLS on every query.
async function adminMembership(supabase, userId) {
  if (!userId) return null;

  const { data, error } = await supabase.from("admins").select("user_id,role,created_at").eq("user_id", userId).maybeSingle();
  if (error) throw toDataError(error, t("errors.data.verifyAdmin"));
  return data;
}

async function describeSession(supabase, session) {
  if (!session?.user) return null;
  const membership = await adminMembership(supabase, session.user.id);

  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      lastSignInAt: session.user.last_sign_in_at ?? null,
      createdAt: session.user.created_at ?? null,
    },
    isAdmin: Boolean(membership),
    role: membership?.role ?? null,
    expiresAt: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
  };
}

export const supabaseAuthRepository = {
  async signIn({ email, password }) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw toDataError(error, t("errors.data.signInCredentials"));

    const session = await describeSession(supabase, data.session);
    if (!session?.isAdmin) {
      await supabase.auth.signOut();
      throw toDataError({ code: "unauthorized" }, "Access denied.");
    }

    return session;
  },

  async signOut() {
    const supabase = getSupabaseClient();
    const { error } = await supabase.auth.signOut();
    if (error) throw toDataError(error, t("errors.data.signOut"));
  },

  async getSession() {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.auth.getSession();
    if (error) throw toDataError(error, t("errors.data.readSession"));
    return describeSession(supabase, data.session);
  },

  async isAdmin() {
    const session = await this.getSession();
    return Boolean(session?.isAdmin);
  },

  // Supabase Auth checks the current session; it never sees the old password.
  // Projects with "secure password change" answer reauthentication_needed.
  async changePassword(password) {
    const { error } = await getSupabaseClient().auth.updateUser({ password });
    if (error) throw error;
  },

  // Revokes every refresh token of this user, on every device.
  async signOutEverywhere() {
    const { error } = await getSupabaseClient().auth.signOut({ scope: "global" });
    if (error) throw toDataError(error, t("errors.data.signOut"));
  },

  // RLS lets an admin read the roster; emails live in auth.users, which the
  // browser cannot read, so members are listed by id and role.
  async listAdmins() {
    const { data, error } = await getSupabaseClient().from("admins").select("user_id,role,created_at").order("created_at", { ascending: true });
    if (error) throw toDataError(error, t("errors.data.verifyAdmin"));
    return (data ?? []).map((row) => ({ userId: row.user_id, role: row.role, createdAt: row.created_at ?? null }));
  },
};
