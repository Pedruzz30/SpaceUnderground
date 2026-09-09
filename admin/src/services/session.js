const SESSION_KEY = "space-admin:session:v1";

// Temporary mock session. Replace with Supabase Auth in a future branch.
export function isAuthenticated() {
  return sessionStorage.getItem(SESSION_KEY) === "true";
}

export function login() {
  sessionStorage.setItem(SESSION_KEY, "true");
}

export function logout() {
  sessionStorage.removeItem(SESSION_KEY);
}
