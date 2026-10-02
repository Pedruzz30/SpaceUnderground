import { MOCK_MEMBER_SEED, MOCK_PROFILES, mockEmail, mockUserId } from "../../data/team.js";

const SESSION_KEY = "space-admin:session:v1";
const LIVE_KEY = "space-admin:auth-sessions:v1";

// Mock session. The login form picks one of the local profiles (owner by
// default), so every permission-shaped screen can be tried without Supabase.
// What each profile may do comes from the same catalog the database seeds;
// real identity and authorization are Supabase Auth and RLS.
//
// The session in sessionStorage plays the access token (sessionId,
// mfaVerifiedAt as its amr entry, issuedAt as its iat); the live sessions in
// localStorage play auth.sessions and auth.mfa_amr_claims: aal, the factor
// that raised the session to aal2, and when it last verified it.
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

function readLive() {
  try {
    return JSON.parse(localStorage.getItem(LIVE_KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

function writeLive(live) {
  localStorage.setItem(LIVE_KEY, JSON.stringify(live));
}

export function currentMockSession() {
  return readSession();
}

export function liveMockSession(sessionId) {
  return sessionId ? readLive()[sessionId] ?? null : null;
}

// A mock mfa.challengeAndVerify: the live session becomes aal2, bound to the
// factor, with a proof from now, and the token issued carries that moment.
export function markMockMfaVerified(factorId) {
  const session = readSession();
  if (!session) return;
  const now = new Date().toISOString();
  const live = readLive();
  live[session.sessionId] = { ...(live[session.sessionId] ?? { userId: session.user.id }), aal: "aal2", factorId, mfaAt: now };
  writeLive(live);
  writeSession({ ...session, mfaVerifiedAt: now });
}

// A mock mfa.unenroll: every session bound to the factor drops to aal1 with
// no factor. Tokens already issued keep their verification.
export function downgradeMockSessions(factorId) {
  const live = readLive();
  Object.values(live).forEach((entry) => {
    if (entry.factorId === factorId) Object.assign(entry, { aal: "aal1", factorId: null, mfaAt: null });
  });
  writeLive(live);
}

// A mock refreshSession: the token says what its live session says now.
export function refreshMockSession() {
  const session = readSession();
  if (!session) return;
  const live = readLive()[session.sessionId];
  writeSession({ ...session, mfaVerifiedAt: live?.aal === "aal2" ? live.mfaAt : null });
}

export const mockAuthRepository = {
  async signIn({ email, profile }) {
    const key = MOCK_PROFILES.includes(profile) ? profile : "owner";
    const seed = MOCK_MEMBER_SEED.find((item) => item.profile === key);
    const now = new Date().toISOString();
    const userId = mockUserId(seed);
    const sessionId = `mock-session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    // Profiles with MFA sign in having verified their seeded factor, as
    // Supabase would ask.
    const live = readLive();
    live[sessionId] = seed.mfa ? { userId, aal: "aal2", factorId: `factor-${userId}`, mfaAt: now } : { userId, aal: "aal1", factorId: null, mfaAt: null };
    writeLive(live);
    const session = {
      user: { id: userId, email: email || mockEmail(seed), lastSignInAt: now, createdAt: "2026-09-01T12:00:00.000Z" },
      isAdmin: true,
      role: key,
      profile: key,
      sessionId,
      mfaVerifiedAt: seed.mfa ? now : null,
      // The mock token's iat: a session ended after it no longer authorizes.
      issuedAt: now,
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
