import { escapeHtml } from "../utils/html.js";

export function badge(label, type = "neutral") {
  return `<span class="badge badge--${type}">${escapeHtml(label)}</span>`;
}

export function badgeType(value) {
  const key = String(value || "").toLowerCase();
  if (["live", "published"].includes(key)) return "success";
  if (["draft", "pilot", "prototype", "mvp"].some((item) => key.includes(item))) return "warning";
  if (["archived"].includes(key)) return "muted";
  return "neutral";
}
