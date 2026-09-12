import { toDataError } from "./errors.js";
import { getAuthRepository } from "./repositories/index.js";
import { t } from "../i18n/index.js";

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
