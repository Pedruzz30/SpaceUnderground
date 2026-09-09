import { getSupabaseClient } from "../../lib/supabase.js";
import { toDataError } from "../errors.js";

// Authentication proves who you are; the admins table decides whether you are
// allowed in. Both checks are enforced again by RLS on every query.
async function isAdminUser(supabase, userId) {
  if (!userId) return false;

  const { data, error } = await supabase.from("admins").select("user_id").eq("user_id", userId).maybeSingle();
  if (error) throw toDataError(error, "Unable to verify admin access.");
  return Boolean(data);
}

async function describeSession(supabase, session) {
  if (!session?.user) return null;

  return {
    user: { id: session.user.id, email: session.user.email },
    isAdmin: await isAdminUser(supabase, session.user.id),
  };
}

export const supabaseAuthRepository = {
  async signIn({ email, password }) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw toDataError(error, "Unable to sign in. Check your credentials.");

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
    if (error) throw toDataError(error, "Unable to sign out.");
  },

  async getSession() {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.auth.getSession();
    if (error) throw toDataError(error, "Unable to read session.");
    return describeSession(supabase, data.session);
  },

  async isAdmin() {
    const session = await this.getSession();
    return Boolean(session?.isAdmin);
  },
};
