const SESSION_KEY = "space-admin:session:v1";

// Mock session. Anyone who submits the login form is treated as an authorized
// admin — real identity and authorization arrive with Supabase Auth + the
// admins table.
function readSession() {
  const stored = sessionStorage.getItem(SESSION_KEY);
  if (!stored) return null;

  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

export const mockAuthRepository = {
  async signIn({ email }) {
    const now = new Date().toISOString();
    const session = {
      user: { id: "mock-admin", email: email || "admin@spaceunderground.local", lastSignInAt: now, createdAt: "2026-09-01T12:00:00.000Z" },
      isAdmin: true,
      role: "owner",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
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
