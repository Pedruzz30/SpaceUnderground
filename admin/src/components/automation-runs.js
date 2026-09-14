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

const BUSINESS_BADGE = {
  SUCCESS: "success",
  OK: "success",
  READY: "success",
  ATTENTION: "warning",
  FAILED: "warning",
  SKIPPED: "muted",
  NOT_ELIGIBLE: "muted",
};

// What an action did, in the vocabulary the engine uses. The glyph is
// decorative: every row also spells its status out, so a colour is never the
// only thing carrying the difference between planned and executed.
const ACTION_PRESENTATION = {
  EXECUTED: { tone: "ok", glyph: "OK" },
  PLANNED: { tone: "warning", glyph: "»" },
  SKIPPED: { tone: "warning", glyph: "–" },
  FAILED: { tone: "required", glyph: "!" },
};

// The only summary fields this screen is allowed to show. The engine's result
// is a free-form object from a service that may add fields at any time, so the
// modal renders from this list rather than from whatever arrived -- a new
// field has to be added here deliberately before it can reach the DOM.
const SUMMARY_FIELDS = [
  ["proposal_id", "automationRuns.summaryFields.proposalId"],
  ["client_id", "automationRuns.summaryFields.clientId"],
  ["service_id", "automationRuns.summaryFields.serviceId"],
  ["plan_id", "automationRuns.summaryFields.planId"],
  ["project_id", "automationRuns.summaryFields.projectId"],
  ["case_number", "automationRuns.summaryFields.caseNumber"],
];

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

/** Translated when the value is known, echoed verbatim when it is not. */
function vocabularyLabel(namespace, value) {
  const raw = String(value || "").toUpperCase();
  const key = `${namespace}.${raw}`;
  const label = t(key);
  return label === key ? raw : label;
}

export function businessStatusBadge(status) {
  const raw = String(status || "").toUpperCase();
  if (!raw) return "";

  const type = BUSINESS_BADGE[raw] ?? "neutral";
  return `<span class="badge badge--${type}">${escapeHtml(vocabularyLabel("automationRuns.businessStatusValue", raw))}</span>`;
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
 * A value this screen is willing to print.
 *
 * Strings and finite numbers only: an object or an array coming back under a
 * whitelisted key is dropped rather than stringified, so a nested structure
 * can never be flattened onto the page by accident.
 */
function safeScalar(value) {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "string") return value.trim();
  return "";
}

function truncateId(value) {
  const id = safeScalar(value);
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

function sectionMarkup(labelKey, content) {
  if (!content.trim()) return "";
  return `
    <section class="automation-detail__section">
      <h4 class="automation-detail__heading" data-i18n="${escapeAttribute(labelKey)}">${escapeHtml(t(labelKey))}</h4>
      ${content}
    </section>
  `;
}

function summaryMarkup(summary) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return "";

  const rows = SUMMARY_FIELDS.map(([key, labelKey]) => field(labelKey, safeScalar(summary[key]))).join("");
  return sectionMarkup("automationRuns.summary", rows.trim() ? `<div class="ops-figures">${rows}</div>` : "");
}

function actionsMarkup(actions) {
  if (!Array.isArray(actions) || !actions.length) return "";

  const rows = actions
    .map((entry) => {
      if (!entry || typeof entry !== "object") return "";

      const name = safeScalar(entry.action) || safeScalar(entry.type);
      const status = String(safeScalar(entry.status)).toUpperCase();
      const { tone, glyph } = ACTION_PRESENTATION[status] ?? { tone: "warning", glyph: "»" };
      const statusLabel = status ? vocabularyLabel("automationRuns.actionStatus", status) : "";
      const entityId = truncateId(entry.entity_id);
      const reason = safeScalar(entry.reason) || safeScalar(entry.message);
      if (!name && !statusLabel) return "";

      return `
        <div class="health-check health-check--${escapeAttribute(tone)}">
          <span aria-hidden="true">${escapeHtml(glyph)}</span>
          <strong>${escapeHtml(name.toUpperCase())}</strong>
          <small>${escapeHtml([statusLabel, entityId].filter(Boolean).join(" · "))}</small>
          ${reason ? `<em>${escapeHtml(reason)}</em>` : ""}
        </div>
      `;
    })
    .join("");

  return sectionMarkup(
    "automationRuns.actions",
    rows.trim() ? `<div class="health-checks automation-actions">${rows}</div>` : "",
  );
}

/**
 * The business half of a run, when the engine reported one.
 *
 * Phase 3 runs carry an empty result and simply render nothing extra, which is
 * why every block here is built from what is present rather than assumed.
 */
function businessMarkup(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return "";

  const badge = businessStatusBadge(result.business_status);
  return `
    ${badge ? sectionMarkup("automationRuns.businessStatus", `<p class="automation-detail__business">${badge}</p>`) : ""}
    ${summaryMarkup(result.summary)}
    ${actionsMarkup(result.actions)}
  `;
}

/**
 * Detail view for one run, as markup.
 *
 * Shows what the engine reported and nothing else: no payload dump, no
 * headers, no tokens, and never the result object as it arrived. Business
 * fields come from an explicit whitelist, so a service that starts returning
 * something new cannot put it on screen without a change here first.
 */
export function runDetailMarkup(run) {
  return `
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

      ${businessMarkup(run.result)}

      ${stepsMarkup(run.steps)}

      ${run.error ? `<p class="automation-detail__error"><span data-i18n="automationRuns.error">${escapeHtml(t("automationRuns.error"))}</span> ${escapeHtml(run.error)}</p>` : ""}
    </div>
  `;
}

export function openRunDetail(run, { onRetry } = {}) {
  const canRetry = String(run.status || "").toUpperCase() === "FAILED" && Boolean(run.run_id) && onRetry;
  const body = runDetailMarkup(run);

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
