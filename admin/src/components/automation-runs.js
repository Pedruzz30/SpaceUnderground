import { escapeAttribute, escapeHtml } from "../utils/html.js";
import { openModal } from "./modal.js";
import { plural, t } from "../i18n/index.js";

// Presentation for workflow runs, shared by the Logs screen and anything else
// that needs to show what the engine did.
//
// The vocabulary on screen is RUN / EVENT / STEP, not "Python": the engine is
// a capability of the product, and its implementation language is not something
// the operator should have to think about.

const STATUS_BADGE = {
  SUCCESS: "success",
  FAILED: "warning",
  SKIPPED: "muted",
  RUNNING: "neutral",
  PENDING: "neutral",
};

export function runStatusLabel(status) {
  const key = `automationRuns.status.${String(status || "PENDING").toUpperCase()}`;
  const label = t(key);
  // An unknown status from a newer service must not render as a raw key.
  return label === key ? String(status || "") : label;
}

export function runStatusBadge(status) {
  const type = STATUS_BADGE[String(status || "").toUpperCase()] ?? "neutral";
  return `<span class="badge badge--${type}">${escapeHtml(runStatusLabel(status))}</span>`;
}

export function formatDuration(ms) {
  // Number(null) is 0, which would claim a missing duration took no time at
  // all. An absent value renders as nothing instead.
  if (ms === null || ms === undefined || ms === "") return "";

  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0) return "";
  return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`;
}

function formatTime(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleTimeString(document.documentElement.lang || undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Shortened for display. The full id is always available in the detail view. */
export function shortRunId(runId) {
  const id = String(runId || "");
  return id ? id.slice(0, 8) : "";
}

export function runRowsMarkup(runs) {
  if (!runs.length) {
    return `<p class="empty-inline" data-i18n="automationRuns.empty">${escapeHtml(t("automationRuns.empty"))}</p>`;
  }

  return `
    <div class="automation-runs">
      ${runs
        .map((run) => {
          const steps = Array.isArray(run.steps) ? run.steps.length : 0;
          return `
        <button type="button" class="automation-run" data-run-open="${escapeAttribute(run.run_id ?? "")}"
                ${run.run_id ? "" : "disabled"}>
          <span class="automation-run__time">${escapeHtml(formatTime(run.created_at || run.started_at))}</span>
          <strong class="automation-run__event">${escapeHtml(run.event ?? "")}</strong>
          <span class="automation-run__meta">
            ${escapeHtml(plural("automationRuns.stepCount", steps, { count: steps }))}
            ${run.duration_ms != null ? ` · ${escapeHtml(formatDuration(run.duration_ms))}` : ""}
          </span>
          ${runStatusBadge(run.status)}
        </button>
      `;
        })
        .join("")}
    </div>
  `;
}

function stepsMarkup(steps) {
  if (!Array.isArray(steps) || !steps.length) return "";

  return `
    <div class="health-checks automation-steps">
      ${steps
        .map((step) => {
          const status = String(step.status || "").toUpperCase();
          const tone = status === "SUCCESS" ? "ok" : status === "SKIPPED" ? "warning" : "required";
          return `
        <div class="health-check health-check--${escapeAttribute(tone)}">
          <span aria-hidden="true">${status === "SUCCESS" ? "OK" : status === "SKIPPED" ? "–" : "!"}</span>
          <strong>${escapeHtml(step.name ?? "")}</strong>
          <small>${escapeHtml(formatDuration(step.duration_ms))}</small>
          ${step.error ? `<em>${escapeHtml(step.error)}</em>` : ""}
        </div>
      `;
        })
        .join("")}
    </div>
  `;
}

function field(labelKey, value) {
  if (!value) return "";
  return `
    <div>
      <span data-i18n="${escapeAttribute(labelKey)}">${escapeHtml(t(labelKey))}</span>
      <strong>${escapeHtml(String(value))}</strong>
    </div>
  `;
}

/**
 * Detail view for one run.
 *
 * Shows what the engine reported and nothing else: no payload dump, no
 * headers, no tokens. The engine already sanitises step errors, and this keeps
 * the surface narrow rather than trusting that.
 */
export function openRunDetail(run, { onRetry } = {}) {
  const canRetry = String(run.status || "").toUpperCase() === "FAILED" && Boolean(run.run_id) && onRetry;

  const body = `
    <div class="automation-detail">
      <div class="ops-figures">
        ${field("automationRuns.run", shortRunId(run.run_id))}
        ${field("automationRuns.event", run.event)}
        ${field("automationRuns.entity", run.entity_id)}
        ${field("automationRuns.source", run.source)}
        ${field("automationRuns.startedAt", formatTime(run.started_at))}
        ${field("automationRuns.finishedAt", formatTime(run.finished_at))}
        ${field("automationRuns.duration", formatDuration(run.duration_ms))}
      </div>

      <p class="automation-detail__status">${runStatusBadge(run.status)}</p>

      ${run.retry_of ? `<p class="ops-note">${escapeHtml(t("automationRuns.retryOf", { runId: shortRunId(run.retry_of) }))}</p>` : ""}

      ${stepsMarkup(run.steps)}

      ${run.error ? `<p class="automation-detail__error"><span data-i18n="automationRuns.error">${escapeHtml(t("automationRuns.error"))}</span> ${escapeHtml(run.error)}</p>` : ""}
    </div>
  `;

  const actions = [];
  if (canRetry) {
    actions.push({
      label: t("automationRuns.retry"),
      variant: "primary",
      role: "confirm",
      onSelect: () => onRetry(run.run_id),
    });
  }
  actions.push({ label: t("automationRuns.close"), role: "cancel" });

  openModal({ title: `${t("automationRuns.run")} ${shortRunId(run.run_id)}`, body, actions });
}
