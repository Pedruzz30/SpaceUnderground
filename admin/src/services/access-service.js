import { isSupabaseMode } from "../config/env.js";
import { t } from "../i18n/index.js";
import { clearAccess, getAccess, legacyAccess, normalizeAccess, setAccess } from "../security/access.js";
import { toDataError } from "./errors.js";
import { getAccessRepository } from "./repositories/index.js";

// Asks the database what the signed-in member may do, once per session and
// again whenever something changes it (MFA, activation). The answer only
// shapes the interface; every query is authorized again by the database.

let pending = null;

const NOT_MEMBER = (session) => ({
  source: "rbac",
  member: null,
  blockedReason: session ? "NOT_MEMBER" : "UNAUTHENTICATED",
  roles: [],
  permissions: new Set(),
  projects: [],
  approvalRoutes: [],
  mfa: { required: false, enrolled: false, aal: "aal1", graceUntil: null, stepUp: false },
  settings: { stepUpMaxAgeSeconds: 600, approvalExpiryDays: 14, invitationExpiryDays: 7 },
});

export async function loadAccess(session, { force = false } = {}) {
  if (!session) {
    clearAccess();
    return null;
  }
  const current = getAccess();
  if (!force && current && current.member?.userId === session.user?.id) return current;
  if (pending && !force) return pending;

  pending = (async () => {
    try {
      const raw = await (await getAccessRepository()).myAccess();
      // Before the security migration: the legacy admins table still decides.
      const access = raw?.legacy ? legacyAccess(session) ?? NOT_MEMBER(session) : normalizeAccess(raw, isSupabaseMode() ? "rbac" : "mock") ?? NOT_MEMBER(session);
      setAccess(access);
      return access;
    } catch (error) {
      throw toDataError(error, t("errors.data.verifyAdmin"));
    } finally {
      pending = null;
    }
  })();
  return pending;
}

export function forgetAccess() {
  clearAccess();
}

async function call(method, fallbackKey, ...args) {
  try {
    return await (await getAccessRepository())[method](...args);
  } catch (error) {
    throw toDataError(error, t(fallbackKey));
  }
}

export const activateMembership = () => call("activate", "security.welcome.activateError");
// Best effort: a sign-in that cannot be recorded still signs in.
export const recordSignIn = () => call("recordSignIn", "errors.generic").catch(() => null);
export const recordMfaState = () => call("recordMfaState", "errors.generic").catch(() => null);
export const expireStaleAccess = () => call("expireStale", "errors.generic").catch(() => null);

// Names and RUs for the ids on requests and audit lines, cached per id.
const directory = new Map();

export async function resolveMembers(ids = []) {
  const missing = [...new Set(ids.filter((id) => id && !directory.has(id)))];
  if (missing.length) {
    try {
      const rows = await (await getAccessRepository()).directory(missing);
      rows.forEach((row) => directory.set(row.user_id, { userId: row.user_id, ru: row.ru, displayName: row.display_name, status: row.status ?? null }));
    } catch {
      // Unknown names render as their RU or "—"; the lists still load.
    }
  }
  return new Map(ids.filter((id) => directory.has(id)).map((id) => [id, directory.get(id)]));
}

export function forgetDirectory() {
  directory.clear();
}

/* ---- links from invitation and recovery emails, and passwords */

export const sessionFromLink = (link) => call("sessionFromLink", "security.welcome.linkError", link);
export const setOwnPassword = (password) => call("setPassword", "settings.account.passwordError", password);

export async function requestPasswordReset(email) {
  // The address is only ever confirmed to its owner, by email.
  const redirectTo = `${window.location.origin}${window.location.pathname}`;
  return call("requestPasswordReset", "login.resetError", email, redirectTo);
}
