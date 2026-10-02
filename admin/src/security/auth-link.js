// Links in Supabase Auth emails (invitations, password recovery) come back to
// the Admin with a session in the URL fragment:
//   #access_token=…&refresh_token=…&type=invite
// or, with a customised email template, a one-time hash in the query:
//   ?token_hash=…&type=invite
// The Admin routes by the fragment too, so the link is read once at boot,
// taken out of the address bar (it must not stay in history or be copied
// around), and handed to the welcome screen.

const TYPES = new Set(["invite", "recovery", "signup", "magiclink", "email"]);

let captured = null;

export function parseAuthLink(hash = "", search = "") {
  const fragment = new URLSearchParams(String(hash).replace(/^#/, ""));
  const query = new URLSearchParams(String(search).replace(/^\?/, ""));

  const error = fragment.get("error_code") || fragment.get("error") || query.get("error_code") || query.get("error");
  if (error) return { error, description: fragment.get("error_description") || query.get("error_description") || "" };

  const type = fragment.get("type") || query.get("type") || "";
  if (fragment.get("access_token") && fragment.get("refresh_token")) {
    return { type: TYPES.has(type) ? type : "invite", accessToken: fragment.get("access_token"), refreshToken: fragment.get("refresh_token") };
  }
  if (query.get("token_hash") && TYPES.has(type)) return { type, tokenHash: query.get("token_hash") };
  return null;
}

// Reads the link from the current address once, then removes it.
export function captureAuthLink(location = window.location, history = window.history) {
  const link = parseAuthLink(location.hash, location.search);
  if (!link) return null;
  captured = link;
  const query = new URLSearchParams(location.search);
  ["token_hash", "type", "error", "error_code", "error_description"].forEach((key) => query.delete(key));
  const rest = query.toString();
  history.replaceState(null, "", `${location.pathname}${rest ? `?${rest}` : ""}#/welcome`);
  return link;
}

// The welcome screen takes it once; a reload does not replay it.
export function takeAuthLink() {
  const link = captured;
  captured = null;
  return link;
}
