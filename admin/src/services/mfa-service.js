import { t } from "../i18n/index.js";
import { getAccess } from "../security/access.js";
import { stepUpFresh } from "../security/policy.js";
import { toDataError } from "./errors.js";
import { getAccessRepository } from "./repositories/index.js";

// MFA through Supabase Auth only. The Admin never sees a TOTP secret after
// enrolment and never stores one; verifying upgrades the session to aal2,
// which the database reads from the token.

async function repo() {
  return getAccessRepository();
}

async function call(method, fallbackKey, ...args) {
  try {
    return await (await repo())[method](...args);
  } catch (error) {
    // Supabase Auth reports a wrong code as a 4xx with its own code.
    if (error?.code === "mfa_verification_failed" || error?.code === "invalid_code" || /invalid.*code|code.*invalid/i.test(error?.message ?? "")) {
      throw toDataError({ code: "invalid_code" }, t("errors.security.invalidCode"));
    }
    throw toDataError(error, t(fallbackKey));
  }
}

export const listFactors = () => call("listFactors", "security.mfa.loadError");
export const enrollTotp = (name) => call("enrollTotp", "security.mfa.enrollError", name);
export const verifyTotp = (factorId, code) => call("verifyFactor", "security.mfa.verifyError", factorId, String(code ?? "").trim());
// Supabase Auth leaves the current access token at aal2, with its TOTP entry,
// after the factor behind it is removed, until the session is refreshed; so
// the session is refreshed at once. Security does not depend on it: the
// database reads the member's factors on every request and refuses that
// token anyway. A refresh that fails is left to the next automatic one.
export async function removeFactor(factorId) {
  await call("unenroll", "security.mfa.removeError", factorId);
  await (await repo()).refreshSession().catch(() => null);
}
export const getAssurance = () => call("assurance", "security.mfa.loadError");

export async function verifiedTotp() {
  return (await listFactors()).find((factor) => factor.type === "totp" && factor.status === "verified") ?? null;
}

// Whether the current session verified MFA recently enough for a CRITICAL
// action. The database checks the same thing itself. The token's amr outlives
// a removed factor, so without a verified factor on record it is never fresh.
export async function hasFreshStepUp() {
  if (!getAccess()?.mfa.enrolled) return false;
  try {
    const { methods } = await getAssurance();
    return stepUpFresh(methods, getAccess()?.settings.stepUpMaxAgeSeconds ?? 600);
  } catch {
    return false;
  }
}

// Verifies the enrolled factor again: the new token carries a fresh amr entry.
export async function stepUp(code) {
  const factor = await verifiedTotp();
  if (!factor) throw toDataError({ code: "mfa_required" }, t("errors.security.mfaRequired"));
  await verifyTotp(factor.id, code);
}
