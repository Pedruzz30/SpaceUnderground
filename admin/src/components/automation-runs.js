import { openModal } from "./modal.js";
import { t } from "../i18n/index.js";
import { escapeAttribute, escapeHtml } from "../utils/html.js";

// Presentation for workflow runs, shared by Logs and anything else that shows
// what the engine did. The vocabulary on screen is run / event / step, never
// "Python": the engine is a capability of the product.
//
// Everything printed here comes from an explicit list -- statuses, summary
// fields, action names. The service may add fields at any time, and a new
// one has to be added here deliberately before it can reach the DOM; objects
// arriving under a known key are dropped rather than stringified.

const STATUS_BADGE = {
  SUCCESS: "success",
  FAILED: "danger",
  STALE: "warning",
  SKIPPED: "muted",
  RUNNING: "neutral",
  PENDING: "neutral",
};

const STEP_TONE = { SUCCESS: "ok", SKIPPED: "warning", FAILED: "required" };
const STEP_GLYPH = { SUCCESS: "OK", SKIPPED: "–", FAILED: "!" };

const ACTION_TONE = { executed: "ok", planned: "warning", skipped: "warning", failed: "required" };

// The summary fields this screen may show, in order.
const SUMMARY_FIELDS = [
  "case_number",
  "project_id",
  "opportunity_id",
  "client_id",
  "score",
  "analysis_status",
  "ready_to_close",
  "outstanding",
  "finance_status",
  "cms_status",
  "signals",
  "checked",
  "date",
];

/** A dictionary label, or the raw value when the dictionary has none yet. */
function known(key, fallback) {
  const label = t(key);
  return label === key ? String(fallback ?? "") : label;
}

const slug = (value) => String(value ?? "").replace(/[^A-Za-z0-9]+/g, "_");

export function eventLabel(event) {
  return known(`automation.events.${slug(event)}`, event);
}

export function stepLabel(name) {
  return known(`automation.steps.${slug(name)}`, name);
}

export function sourceLabel(source) {
  return known(`automation.sources.${slug(source)}`, source);
}

export function entityLabel(run) {
  const type = run?.entity_type ? known(`automation.entityTypes.${slug(run.entity_type)}`, run.entity_type) : "";
  const id = String(run?.entity_id ?? "");
  const shown = /^[0-9a-f-]{32,36}$/i.test(id) ? `${id.slice(0, 8)}…` : id;
  return [type, shown].filter(Boolean).join(" · ");
}

/** What a run's status reads as: a RUNNING run past any step's timeout is
 * reported as interrupted, which is what it is. */
export function displayStatus(run) {
  return run?.stale ? "STALE" : String(run?.status || "PENDING").toUpperCase();
}

export function runStatusBadge(run) {
  const status = displayStatus(run);
  const type = STATUS_BADGE[status] ?? "neutral";
  return `<span class="badge badge--${type}" data-run-status="${escapeAttribute(status)}">${escapeHtml(known(`automation.runStatus.${status}`, status))}</span>`;
}

export function formatDuration(ms) {
  // Number(null) is 0, which would claim a missing duration took no time.
  if (ms === null || ms === undefined || ms === "") return "";
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0) return "";
  return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`;
}

export function formatRunTime(iso, locale = globalThis.document?.documentElement?.lang || undefined) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "medium" }).format(date);
}

export function shortRunId(runId) {
  const id = String(runId || "");
  return id ? id.slice(0, 8) : "";
}

export function runRowsMarkup(runs) {
  return runs
    .map(
      (run) => `
        <tr class="automation-run${displayStatus(run) === "FAILED" || run.stale ? " is-failing" : ""}">
          <td><time datetime="${escapeAttribute(run.created_at || run.started_at || "")}">${escapeHtml(formatRunTime(run.created_at || run.started_at))}</time></td>
          <td>
            <button type="button" class="automation-run__open" data-run-open="${escapeAttribute(run.run_id ?? "")}"${run.run_id ? "" : " disabled"}>
              ${escapeHtml(eventLabel(run.event))}
            </button>
            <small>${escapeHtml(run.event ?? "")}</small>
          </td>
          <td>${escapeHtml(entityLabel(run) || "—")}</td>
          <td>${runStatusBadge(run)}</td>
          <td class="automation-run__num">${escapeHtml(formatDuration(run.duration_ms) || "—")}</td>
          <td>${escapeHtml(sourceLabel(run.source))}</td>
        </tr>
      `,
    )
    .join("");
}

export function runTableMarkup(runs) {
  return `
    <div class="automation-table-wrap">
      <table class="automation-table">
        <thead>
          <tr>
            <th scope="col" data-i18n="automation.runs.time">${escapeHtml(t("automation.runs.time"))}</th>
            <th scope="col" data-i18n="automation.runs.event">${escapeHtml(t("automation.runs.event"))}</th>
            <th scope="col" data-i18n="automation.runs.entity">${escapeHtml(t("automation.runs.entity"))}</th>
            <th scope="col" data-i18n="automation.runs.status">${escapeHtml(t("automation.runs.status"))}</th>
            <th scope="col" class="automation-run__num" data-i18n="automation.runs.duration">${escapeHtml(t("automation.runs.duration"))}</th>
            <th scope="col" data-i18n="automation.runs.source">${escapeHtml(t("automation.runs.source"))}</th>
          </tr>
        </thead>
        <tbody>${runRowsMarkup(runs)}</tbody>
      </table>
    </div>
  `;
}

/**
 * A value this screen is willing to print: strings, finite numbers and
 * booleans. Anything else under a whitelisted key is dropped.
 */
function scalar(value) {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "boolean") return t(value ? "automation.detail.yes" : "automation.detail.no");
  return "";
}

// Status words the workflows report, shown in the reader's language.
const VALUE_FIELDS = new Set(["finance_status", "cms_status", "analysis_status"]);

function summaryValue(key, value) {
  if (key.endsWith("_id")) return idValue(value);
  const text = scalar(value);
  return VALUE_FIELDS.has(key) && text ? known(`automation.values.${slug(text)}`, text) : text;
}

function idValue(value) {
  const text = scalar(value);
  return /^[0-9a-f-]{32,36}$/i.test(text) ? `${text.slice(0, 8)}…` : text;
}

function field(labelKey, value) {
  if (!value) return "";
  return `<div><dt data-i18n="${escapeAttribute(labelKey)}">${escapeHtml(t(labelKey))}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function section(labelKey, content) {
  if (!content.trim()) return "";
  return `
    <section class="automation-detail__section">
      <h4 data-i18n="${escapeAttribute(labelKey)}">${escapeHtml(t(labelKey))}</h4>
      ${content}
    </section>
  `;
}

function summaryMarkup(summary) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return "";
  const rows = SUMMARY_FIELDS.map((key) => field(`automation.summaryFields.${key}`, summaryValue(key, summary[key]))).join("");
  const warnings = Array.isArray(summary.warnings) ? summary.warnings.map(scalar).filter(Boolean) : [];
  return `
    ${section("automation.detail.summary", rows.trim() ? `<dl class="automation-facts">${rows}</dl>` : "")}
    ${section("automation.detail.warnings", warnings.length ? `<ul class="automation-warnings">${warnings.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : "")}
  `;
}

function actionsMarkup(actions) {
  if (!Array.isArray(actions) || !actions.length) return "";
  const rows = actions
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => {
      const name = scalar(entry.action);
      const status = scalar(entry.status).toLowerCase();
      const reason = scalar(entry.reason);
      const target = idValue(entry.entity_id);
      return `
        <li class="health-check health-check--${escapeAttribute(ACTION_TONE[status] ?? "warning")}">
          <span aria-hidden="true">${status === "executed" ? "OK" : "»"}</span>
          <strong>${escapeHtml(known(`automation.actions.${slug(name)}`, name))}</strong>
          <small>${escapeHtml([known(`automation.actionStatus.${slug(status)}`, status), target].filter(Boolean).join(" · "))}</small>
          ${reason ? `<em>${escapeHtml(reason)}</em>` : ""}
        </li>
      `;
    })
    .join("");
  return section("automation.detail.actions", rows.trim() ? `<ul class="health-checks automation-list">${rows}</ul>` : "");
}

function stepsMarkup(steps) {
  if (!Array.isArray(steps) || !steps.length) return "";
  const rows = steps
    .map((step) => {
      const status = String(step?.status || "").toUpperCase();
      return `
        <li class="health-check health-check--${escapeAttribute(STEP_TONE[status] ?? "warning")}" data-step="${escapeAttribute(step?.name ?? "")}">
          <span aria-hidden="true">${escapeHtml(STEP_GLYPH[status] ?? "·")}</span>
          <strong>${escapeHtml(stepLabel(step?.name))}</strong>
          <small>${escapeHtml([known(`automation.stepStatus.${status}`, status), formatDuration(step?.duration_ms)].filter(Boolean).join(" · "))}</small>
          ${step?.error ? `<em>${escapeHtml(step.error)}</em>` : ""}
        </li>
      `;
    })
    .join("");
  return section("automation.detail.steps", `<ol class="health-checks automation-list">${rows}</ol>`);
}

function note(key, params = {}, tone = "") {
  return `<p class="automation-detail__note${tone ? ` automation-detail__note--${tone}` : ""}">${escapeHtml(t(key, params))}</p>`;
}

/**
 * Detail view for one run, as markup. Shows what the engine reported and
 * nothing else: no payload, no headers, no tokens, never the raw result.
 */
export function runDetailMarkup(run, { currentUserId = "" } = {}) {
  const result = run?.result && typeof run.result === "object" && !Array.isArray(run.result) ? run.result : {};
  const business = scalar(result.business_status).toUpperCase();
  const requestedBy = run?.requested_by ? (run.requested_by === currentUserId ? t("automation.detail.you") : idValue(run.requested_by)) : "";

  return `
    <div class="automation-detail">
      <p class="automation-detail__status">
        ${runStatusBadge(run)}
        ${business ? `<span class="badge badge--${business === "ATTENTION" ? "warning" : "success"}">${escapeHtml(known(`automation.businessStatus.${business}`, business))}</span>` : ""}
      </p>
      <dl class="automation-facts">
        ${field("automation.runs.event", eventLabel(run?.event))}
        ${field("automation.runs.entity", entityLabel(run))}
        ${field("automation.runs.source", sourceLabel(run?.source))}
        ${field("automation.detail.startedAt", formatRunTime(run?.started_at))}
        ${field("automation.detail.finishedAt", formatRunTime(run?.finished_at))}
        ${field("automation.runs.duration", formatDuration(run?.duration_ms))}
        ${field("automation.detail.requestedBy", requestedBy)}
      </dl>
      ${run?.retry_of ? note("automation.detail.retryOf", { id: shortRunId(run.retry_of) }) : ""}
      ${run?.stale ? note("automation.detail.stale", {}, "warn") : ""}
      ${run?.deduplicated ? note("automation.detail.deduplicated") : ""}
      ${run?.persisted === false ? note("automation.detail.notStored", {}, "warn") : ""}
      ${run?.redacted ? note("automation.detail.redacted") : ""}
      ${run?.error ? `<p class="automation-detail__error"><strong data-i18n="automation.detail.error">${escapeHtml(t("automation.detail.error"))}</strong> ${escapeHtml(run.error)}</p>` : ""}
      ${summaryMarkup(result.summary)}
      ${actionsMarkup(result.actions)}
      ${stepsMarkup(run?.steps)}
    </div>
  `;
}

/**
 * Opens the detail modal. A retry is offered only when the service says this
 * reader may retry this run (failed or interrupted, still registered); the
 * service checks the permission again when it is asked.
 */
export function openRunDetail(run, { onRetry, currentUserId = "" } = {}) {
  const actions = [];
  if (run?.retryable && run?.run_id && onRetry) {
    actions.push({ label: t("automation.detail.retry"), variant: "primary", role: "confirm", onSelect: () => onRetry(run) });
  }
  actions.push({ label: t("automation.detail.close"), role: "cancel" });

  openModal({
    title: t("automation.detail.title", { id: shortRunId(run?.run_id) || "—" }),
    body: runDetailMarkup(run, { currentUserId }),
    actions,
    className: "modal--wide",
  });
}
