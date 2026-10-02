import { DataError, toDataError } from "./errors.js";
import { getAuthRepository } from "./repositories/index.js";
import { forgetAccess, forgetDirectory, loadAccess, recordSignIn, revokeMySessions } from "./access-service.js";
import { invalidatePendingCount } from "./approval-service.js";
import { t } from "../i18n/index.js";
import { PASSWORD_MIN, validateNewPassword } from "../utils/settings-checks.js";

// The UI asks this service who the user is; it never knows whether the answer
// came from a mock session or from Supabase Auth.

let cachedSession = null;
let resolvedOnce = false;

function forgetSession() {
  cachedSession = null;
  resolvedOnce = true;
  forgetAccess();
  forgetDirectory();
  invalidatePendingCount();
}

// Signing in is not being let in: the database says whether this account is a
// member (or, before the security migration, an admin). An account that is
// neither is signed straight back out. A member who is suspended, expired or
// still owes MFA stays signed in and is shown why they cannot go further.
export async function login(credentials) {
  try {
    const repository = await getAuthRepository();
    cachedSession = await repository.signIn(credentials);
    resolvedOnce = true;
  } catch (error) {
    throw toDataError(error, t("errors.data.signIn"));
  }

  let access = null;
  try {
    access = await loadAccess(cachedSession, { force: true });
  } catch (error) {
    await logout().catch(() => {});
    throw error;
  }
  if (!access || access.blockedReason === "NOT_MEMBER" || access.blockedReason === "UNAUTHENTICATED") {
    await logout().catch(() => {});
    throw new DataError(t("errors.unauthorized"), { code: "unauthorized" });
  }
  recordSignIn();
  return cachedSession;
}

export async function logout() {
  try {
    const repository = await getAuthRepository();
    await repository.signOut();
  } catch (error) {
    throw toDataError(error, t("errors.data.signOut"));
  } finally {
    forgetSession();
  }
}

export async function getSession() {
  try {
    const repository = await getAuthRepository();
    cachedSession = await repository.getSession();
  } catch {
    // A failed session read means "not signed in" as far as the UI cares.
    cachedSession = null;
  }

  resolvedOnce = true;
  return cachedSession;
}

export async function getCurrentUser() {
  return (await getSession())?.user ?? null;
}

export async function isAdmin() {
  return Boolean((await getSession())?.isAdmin);
}

// Sync fast-path so the router can skip the "verifying session" screen on
// navigations that happen after the first successful check.
export function getCachedSession() {
  return cachedSession;
}

export function hasResolvedSession() {
  return resolvedOnce;
}

// The rules run here, so a caller that skips the form still cannot set a weak
// password. Supabase's own refusals come back on the same field.
const PASSWORD_ERRORS = {
  same_password: "settings.account.passwordSame",
  weak_password: "settings.account.passwordWeak",
  reauthentication_needed: "settings.account.passwordReauth",
};

export async function changePassword(password, confirmation) {
  const email = cachedSession?.user?.email ?? "";
  const errors = validateNewPassword(password, confirmation, email);
  const [field] = Object.keys(errors);
  if (field) throw new DataError(t(errors[field], { min: PASSWORD_MIN }), { code: "validation", field });
  try {
    await (await getAuthRepository()).changePassword(password);
  } catch (error) {
    const key = PASSWORD_ERRORS[error?.code];
    if (key) throw new DataError(t(key), { code: "validation", field: "password", cause: error });
    throw toDataError(error, t("settings.account.passwordError"));
  }
}

// Every device: the database first refuses every token issued so far (an
// access token would otherwise live until it expires), then Supabase Auth
// revokes the refresh tokens.
export async function signOutEverywhere() {
  try {
    await revokeMySessions();
    await (await getAuthRepository()).signOutEverywhere();
  } finally {
    forgetSession();
  }
}

export async function getAdminRoster() {
  try {
    return await (await getAuthRepository()).listAdmins();
  } catch (error) {
    throw toDataError(error, t("errors.data.verifyAdmin"));
  }
}
