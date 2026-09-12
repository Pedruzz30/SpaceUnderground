import { escapeAttribute, escapeHtml } from "../utils/html.js";
import { statusLabel } from "../i18n/index.js";

const SUCCESS = ["live", "published", "active", "paid", "won", "received"];
const WARNING = ["draft", "pilot", "prototype", "mvp"];
const WARNING_EXACT = ["lead", "pending", "proposal", "negotiation", "contacted", "high"];
const MUTED = ["archived", "inactive", "low"];

// The raw enum value is kept on the node so a locale change can re-label every
// badge on the page at once, without the page re-rendering its own state.
export function badge(label, type = "neutral") {
  return `<span class="badge badge--${type}" data-status-label="${escapeAttribute(String(label ?? ""))}">${escapeHtml(statusLabel(label))}</span>`;
}

export function badgeType(value) {
  const key = String(value || "").toLowerCase();
  if (SUCCESS.includes(key)) return "success";
  if (WARNING_EXACT.includes(key)) return "warning";
  if (WARNING.some((item) => key.includes(item))) return "warning";
  if (MUTED.includes(key)) return "muted";
  return "neutral";
}
