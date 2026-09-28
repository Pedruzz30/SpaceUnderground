import { DataError, toDataError } from "./errors.js";
import { getAuthRepository } from "./repositories/index.js";
import { t } from "../i18n/index.js";
import { PASSWORD_MIN, validateNewPassword } from "../utils/settings-checks.js";

// The UI asks this service who the user is; it never knows whether the answer
// came from a mock session or from Supabase Auth.

let cachedSession = null;
let resolvedOnce = false;

export async function login(credentials) {
  try {
    const repository = await getAuthRepository();
    cachedSession = await repository.signIn(credentials);
    resolvedOnce = true;
    return cachedSession;
  } catch (error) {
    throw toDataError(error, t("errors.data.signIn"));
  }
}

export async function logout() {
  try {
    const repository = await getAuthRepository();
    await repository.signOut();
  } catch (error) {
    throw toDataError(error, t("errors.data.signOut"));
  } finally {
    cachedSession = null;
    resolvedOnce = true;
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

export async function signOutEverywhere() {
  try {
    await (await getAuthRepository()).signOutEverywhere();
  } finally {
    cachedSession = null;
    resolvedOnce = true;
  }
}

export async function getAdminRoster() {
  try {
    return await (await getAuthRepository()).listAdmins();
  } catch (error) {
    throw toDataError(error, t("errors.data.verifyAdmin"));
  }
}
