import { MOCK_MEMBER_SEED, MOCK_PROFILES, mockEmail, mockUserId } from "../../data/team.js";

const SESSION_KEY = "space-admin:session:v1";

// Mock session. The login form picks one of the local profiles (owner by
// default), so every permission-shaped screen can be tried without Supabase.
// What each profile may do comes from the same catalog the database seeds;
// real identity and authorization are Supabase Auth and RLS.
function readSession() {
  const stored = sessionStorage.getItem(SESSION_KEY);
  if (!stored) return null;

  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

function writeSession(session) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function currentMockSession() {
  return readSession();
}

// A mock "MFA verification": the moment the mock session last verified.
export function markMockMfaVerified() {
  const session = readSession();
  if (!session) return;
  writeSession({ ...session, mfaVerifiedAt: new Date().toISOString() });
}

export const mockAuthRepository = {
  async signIn({ email, profile }) {
    const key = MOCK_PROFILES.includes(profile) ? profile : "owner";
    const seed = MOCK_MEMBER_SEED.find((item) => item.profile === key);
    const now = new Date().toISOString();
    const session = {
      user: { id: mockUserId(seed), email: email || mockEmail(seed), lastSignInAt: now, createdAt: "2026-09-01T12:00:00.000Z" },
      isAdmin: true,
      role: key,
      profile: key,
      // Profiles with MFA sign in having verified it, as Supabase would ask.
      mfaVerifiedAt: seed.mfa ? now : null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
    writeSession(session);
    return session;
  },

  async signOut() {
    sessionStorage.removeItem(SESSION_KEY);
  },

  async getSession() {
    return readSession();
  },

  async isAdmin() {
    return Boolean(readSession());
  },

  // Mock mode has no real password to change; the rules still run in the service.
  async changePassword() {},

  async signOutEverywhere() {
    sessionStorage.removeItem(SESSION_KEY);
  },

  async listAdmins() {
    const session = readSession();
    return session ? [{ userId: session.user.id, role: session.role ?? "owner", createdAt: session.user.createdAt ?? null }] : [];
  },
};
