import { escapeHtml } from "../utils/html.js";
import { serviceStatusKey, serviceStatusTone } from "../utils/automation-state.js";
import { t } from "../i18n/index.js";

// Shared presentation for the automation service, used by the Dashboard, the
// Logs page and Settings. Built from the classes the Admin already has --
// panel, dash-dot, ops-figures -- so the processing layer reads as part of the
// product rather than a developer tool bolted on.
//
// The dot is decorative: every state is also spelled out in text, so the status
// survives a screen reader and a monochrome screen.

export function serviceStatusMarkup(status) {
  const tone = serviceStatusTone(status);
  const key = serviceStatusKey(status);

  return `
    <span class="automation-status">
      <span class="dash-dot dash-dot--${escapeHtml(tone)}" aria-hidden="true"></span>
      <strong data-i18n="${escapeHtml(key)}">${escapeHtml(t(key))}</strong>
    </span>
  `;
}

function figure(labelKey, value) {
  return `
    <div>
      <span data-i18n="${escapeHtml(labelKey)}">${escapeHtml(t(labelKey))}</span>
      <strong>${escapeHtml(String(value))}</strong>
    </div>
  `;
}

/**
 * The operations overview, rendered only from fields the API actually returned.
 *
 * A metric the service omits is not shown as zero: the report is built to leave
 * out what the schema cannot answer, and printing a 0 would turn "unknown" into
 * a fact.
 */
export function overviewFiguresMarkup(overview) {
  const projects = overview?.projects ?? {};
  const content = overview?.content ?? {};

  const figures = [];
  if (Number.isFinite(projects.total)) figures.push(figure("operations.projects", projects.total));
  if (Number.isFinite(projects.published)) figures.push(figure("operations.published", projects.published));
  if (Number.isFinite(projects.draft)) figures.push(figure("operations.drafts", projects.draft));
  if (Number.isFinite(content.with_live_preview)) {
    figures.push(figure("operations.livePreviews", content.with_live_preview));
  }
  if (Number.isFinite(content.with_poster)) figures.push(figure("operations.posters", content.with_poster));

  if (!figures.length) {
    return `<p class="empty-inline" data-i18n="operations.noMetrics">${escapeHtml(t("operations.noMetrics"))}</p>`;
  }

  return `<div class="ops-figures">${figures.join("")}</div>`;
}

export function overviewTimestamp(overview) {
  const raw = overview?.generated_at;
  if (!raw) return "";

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleTimeString(document.documentElement.lang || undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}
