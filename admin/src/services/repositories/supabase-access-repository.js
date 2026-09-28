import { getSupabaseClient } from "../../lib/supabase.js";

// The signed-in member's own access, and the Supabase Auth calls around it:
// MFA factors, the links sent by email, and passwords. Nothing here decides
// anything; public.my_access() only describes what the database will allow.

// PostgREST answers PGRST202 for a function it does not know, and Postgres
// 42883: the security migration has not been applied yet.
const MISSING_FUNCTION = new Set(["PGRST202", "42883"]);

export function isMissingFunction(error) {
  return MISSING_FUNCTION.has(String(error?.code ?? "")) || Number(error?.status) === 404;
}

async function rpc(name, args) {
  const { data, error } = await getSupabaseClient().rpc(name, args);
  if (error) throw error;
  return data;
}

export const supabaseAccessRepository = {
  // { legacy: true } when the database predates the security model.
  async myAccess() {
    const { data, error } = await getSupabaseClient().rpc("my_access");
    if (error) {
      if (isMissingFunction(error)) return { legacy: true };
      throw error;
    }
    return data;
  },

  activate: () => rpc("activate_my_membership"),
  recordSignIn: () => rpc("record_sign_in"),
  recordMfaState: () => rpc("record_mfa_state"),
  expireStale: () => rpc("expire_stale_access"),

  async directory(ids) {
    const unique = [...new Set((ids ?? []).filter(Boolean))];
    if (!unique.length) return [];
    return (await rpc("member_directory", { p_ids: unique })) ?? [];
  },

  /* ---- MFA, through Supabase Auth: the secret never touches our tables */

  async listFactors() {
    const { data, error } = await getSupabaseClient().auth.mfa.listFactors();
    if (error) throw error;
    return (data?.all ?? []).map((factor) => ({
      id: factor.id,
      type: factor.factor_type,
      status: factor.status,
      name: factor.friendly_name ?? "",
      createdAt: factor.created_at ?? null,
    }));
  },

  async enrollTotp(friendlyName) {
    const { data, error } = await getSupabaseClient().auth.mfa.enroll({ factorType: "totp", friendlyName });
    if (error) throw error;
    return { id: data.id, qrCode: data.totp?.qr_code ?? "", secret: data.totp?.secret ?? "", uri: data.totp?.uri ?? "" };
  },

  async verifyFactor(factorId, code) {
    const { error } = await getSupabaseClient().auth.mfa.challengeAndVerify({ factorId, code });
    if (error) throw error;
  },

  async unenroll(factorId) {
    const { error } = await getSupabaseClient().auth.mfa.unenroll({ factorId });
    if (error) throw error;
  },

  async assurance() {
    const { data, error } = await getSupabaseClient().auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) throw error;
    return {
      currentLevel: data?.currentLevel ?? "aal1",
      nextLevel: data?.nextLevel ?? "aal1",
      methods: data?.currentAuthenticationMethods ?? [],
    };
  },

  /* ---- links from invitation and recovery emails */

  async sessionFromLink(link) {
    const auth = getSupabaseClient().auth;
    if (link.tokenHash) {
      const { error } = await auth.verifyOtp({ token_hash: link.tokenHash, type: link.type });
      if (error) throw error;
      return;
    }
    const { error } = await auth.setSession({ access_token: link.accessToken, refresh_token: link.refreshToken });
    if (error) throw error;
  },

  async setPassword(password) {
    const { error } = await getSupabaseClient().auth.updateUser({ password });
    if (error) throw error;
  },

  // Supabase Auth answers the same whether or not the address exists, and
  // limits how often it sends.
  async requestPasswordReset(email, redirectTo) {
    const { error } = await getSupabaseClient().auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
  },
};
