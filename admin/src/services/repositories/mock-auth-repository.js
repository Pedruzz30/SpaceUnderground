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
    const session = {
      user: { id: "mock-admin", email: email || "admin@spaceunderground.local" },
      isAdmin: true,
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
};
