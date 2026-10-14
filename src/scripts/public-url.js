// Shared URL guard for public project links and previews.
//
// Project records may use absolute URLs (external client sites) or relative
// URLs (demos shipped with this portfolio). Both are valid, but only HTTP(S)
// destinations are allowed to reach anchors, iframes or window.open.

export function resolvePublicUrl(value, baseUrl = globalThis.document?.baseURI || "http://localhost/") {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  try {
    const resolved = new URL(raw, baseUrl);
    return ["http:", "https:"].includes(resolved.protocol) ? resolved.href : "";
  } catch {
    return "";
  }
}
