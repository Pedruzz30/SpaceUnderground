import { t } from "../i18n/index.js";
import {
  ERROR,
  FORBIDDEN,
  NOT_CONFIGURED,
  notConfiguredHintKey,
  serviceStatusKey,
  serviceStatusTone,
} from "../utils/automation-state.js";
import { escapeAttribute, escapeHtml } from "../utils/html.js";

// Shared presentation for the automation service's own state, used by the
// Dashboard, Logs, Settings and the project editor. Built from the classes the
// Admin already has (dash-dot, dash-note) so the processing layer reads as
// part of the product, not a developer tool bolted on.
//
// The dot is decorative: every state is also spelled out, so it survives a
// screen reader and a monochrome screen.

export function serviceStatusMarkup(status) {
  const key = serviceStatusKey(status);
  return `
    <span class="automation-status" data-automation-status="${escapeAttribute(status)}">
      <span class="dash-dot dash-dot--${escapeAttribute(serviceStatusTone(status))}" aria-hidden="true"></span>
      <span data-i18n="${escapeAttribute(key)}">${escapeHtml(t(key))}</span>
    </span>
  `;
}

/**
 * The one sentence that explains a state with no data: never configured,
 * configured but unreachable, or reachable and closed to this member. Empty
 * for the states that have data to show.
 */
export function serviceStateNoteKey(status) {
  if (status === NOT_CONFIGURED) return notConfiguredHintKey();
  if (status === ERROR) return "automation.offlineHint";
  if (status === FORBIDDEN) return "automation.forbiddenHint";
  return "";
}

export function serviceStateNote(status, className = "dash-note") {
  const key = serviceStateNoteKey(status);
  return key ? `<p class="${escapeAttribute(className)}" data-i18n="${escapeAttribute(key)}">${escapeHtml(t(key))}</p>` : "";
}
