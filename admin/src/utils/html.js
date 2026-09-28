export function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function escapeAttribute(value = "") {
  return escapeHtml(value);
}

// Plan accents are typed by hand in the editor. Only a plain hex colour may
// reach a style attribute: anything else could smuggle extra declarations in.
export function safeHexColor(value, fallback = "#c6ff00") {
  const color = String(value ?? "").trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color) ? color : fallback;
}
