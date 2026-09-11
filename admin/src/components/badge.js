import { escapeHtml } from "../utils/html.js";

const SUCCESS = ["live", "published", "active", "paid", "won", "received"];
const WARNING = ["draft", "pilot", "prototype", "mvp"];
const WARNING_EXACT = ["lead", "pending", "proposal", "negotiation", "contacted", "high"];
const MUTED = ["archived", "inactive", "low"];

export function badge(label, type = "neutral") {
  return `<span class="badge badge--${type}">${escapeHtml(label)}</span>`;
}

export function badgeType(value) {
  const key = String(value || "").toLowerCase();
  if (SUCCESS.includes(key)) return "success";
  if (WARNING_EXACT.includes(key)) return "warning";
  if (WARNING.some((item) => key.includes(item))) return "warning";
  if (MUTED.includes(key)) return "muted";
  return "neutral";
}
