import { serviceStatusMarkup, serviceStateNote } from "../components/automation-panel.js";
import { entityLabel, eventLabel } from "../components/automation-runs.js";
import { badge, badgeType } from "../components/badge.js";
import { statCard } from "../components/stat-card.js";
import { spaceStatus } from "../data/dashboard.js";
import { DATA_SOURCE } from "../config/env.js";
import { getActivityWithStatus } from "../services/activity-service.js";
import { getAutomationRunStats, isAutomationApiAvailable } from "../services/automation-api.js";
import { pendingApprovalCount } from "../services/approval-service.js";
import { listAuditEntries } from "../services/audit-service.js";
import { getClients } from "../services/client-service.js";
import { getOpportunitiesWithStatus } from "../services/commercial-service.js";
import { getTransactionsWithStatus } from "../services/financial-service.js";
import { getProjects } from "../services/project-service.js";
import { describeError } from "../services/errors.js";
import { onLocaleChange, plural, t } from "../i18n/index.js";
import { formatCurrency, formatRelativeAge } from "../utils/format.js";
import {
  PERIODS,
  activeClients,
  activeEngagements,
  approvalChecks,
  barPercent,
  financialTotals,
  followUps,
  liveProjects,
  openOpportunities,
  operationStatus,
  operationalChecks,
  periodLabel,
  pipelineSummary,
  projectChecks,
  projectHealth,
  rankAttention,
  receivablesSummary,
  securityAlerts,
} from "../utils/dashboard-metrics.js";
import { LOADING, NOT_CONFIGURED, SUCCESS, createAutomationResource } from "../utils/automation-state.js";
import { escapeHtml } from "../utils/html.js";
import { hasPermission, isSecurityModelActive } from "../security/access.js";
import { memberDashboard } from "./dashboard-member.js";

// The command center: what needs action first, then how projects, clients,
// money and the pipeline stand, then whether anything is broken. Every panel
// is real (clients, projects, the pipeline, the ledger, the activity log, the
// approval queue and the audit trail, through the configured repository), and
// each read resolves on its own, so one failing read never blanks the rest.
//
// The page shows exceptions, not normal states: a panel with nothing to say
// (no open deal, nothing to review, every read answering) says so in a line
// and grows only when there is something to act on.

const DEFAULT_PERIOD = "month";
const RECENT_PROJECTS = 5;
const RECENT_ACTIVITY = 5;
// How far back the audit trail is read for alerts. One read; sign-ins fill
// the trail quickly, so the last handful of lines could hide a real alert.
const AUDIT_SCAN = 30;

// The ledger for the Dashboard on screen. `ledgerOk` is null while the read is
// in flight, so the financial figures read "—" instead of a zero that could be
// mistaken for a real balance. Reset on every render.
let ledgerEntries = [];
let ledgerOk = null;
// Same contract for the commercial pipeline.
let dealEntries = [];
let dealsOk = null;
// Changes waiting for review: null until counted, or when the member cannot
// review (or the count failed).
let pendingApprovals = null;

/* ---------------------------------------------------------------- helpers */

function panelHead({ titleKey, id, aside = "" }) {
  return `
    <header class="dash-head">
      <h3 id="${escapeHtml(id)}" data-i18n="${escapeHtml(titleKey)}">${escapeHtml(t(titleKey))}</h3>
      ${aside}
    </header>
  `;
}

function moreLink({ href, labelKey, requires = "" }) {
  const gate = requires ? ` data-requires="${escapeHtml(requires)}"` : "";
  return `<a class="dash-more" href="${escapeHtml(href)}"${gate}><span data-i18n="${escapeHtml(labelKey)}">${escapeHtml(t(labelKey))}</span><b aria-hidden="true">&rarr;</b></a>`;
}

const loadingNote = () => `<p class="dash-note">${escapeHtml(t("common.loading"))}...</p>`;
const skeleton = (rows = 3) => `<div class="dash-skeleton"></div>`.repeat(rows);

// Marks a panel as carrying an exception, so it stands out from the ones in
// their normal state: "danger", "warning" or "accent"; nothing clears it.
function emphasize(node, tone) {
  const panel = node?.closest(".dash-panel");
  if (!panel) return;
  if (tone) panel.dataset.emphasis = tone;
  else delete panel.dataset.emphasis;
}

/* ------------------------------------------------------------------- KPIs */

// Every figure reads "—" until its query resolves (or if it fails).
function renderKpis({ projects = null, clients = null } = {}) {
  const receivables = ledgerOk ? receivablesSummary(ledgerEntries) : null;
  const live = projects ? liveProjects(projects) : 0;
  const charges = receivables
    ? [
        receivables.count ? plural("dashboard.pendingCharges", receivables.count) : t("dashboard.noPendingCharges"),
        receivables.overdueCount ? plural("dashboard.overdueCharges", receivables.overdueCount) : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : t("dashboard.toReceiveDetail");

  return `
    ${statCard({
      label: t("dashboard.inProgress"),
      value: projects ? activeEngagements(projects) : "—",
      detail: projects && live ? `${t("dashboard.inProgressDetail")} · ${plural("dashboard.liveProjects", live)}` : t("dashboard.inProgressDetail"),
    })}
    ${statCard({
      label: t("dashboard.activeClients"),
      value: clients ? activeClients(clients) : "—",
      detail: t("dashboard.activeClientsDetail"),
    })}
    ${statCard({
      label: t("dashboard.opportunities"),
      value: dealsOk ? openOpportunities(dealEntries) : "—",
      detail: t("dashboard.opportunitiesDetail"),
    })}
    ${statCard({
      label: t("dashboard.toReceive"),
      value: receivables ? escapeHtml(formatCurrency(receivables.total)) : "—",
      detail: escapeHtml(charges),
    })}
  `;
}

/* -------------------------------------------------------------- attention */

// Categories are identities in the metrics (FINANCIAL, LEAD...); the screen
// reads their label in the active locale, falling back to the identity.
function queueCategory(category) {
  const key = `dashboard.queueCategories.${category}`;
  const label = t(key);
  return label === key ? category : label;
}

// "normal" carries no flag: only what stands out is labelled.
function priorityFlag(priority) {
  if (!priority || priority === "normal") return "";
  return `<span class="dash-flag dash-flag--${escapeHtml(priority)}">${escapeHtml(t(`dashboard.priority.${priority}`))}</span>`;
}

function contactFlag(level) {
  if (!level || level === "normal") return "";
  return `<span class="dash-flag dash-flag--${escapeHtml(level)}">${escapeHtml(t(`dashboard.contactLevel.${level}`))}</span>`;
}

function itemDetail(item) {
  if (item.detailPlural) return plural(item.detailPlural, item.detailParams?.count ?? 0, item.detailParams ?? {});
  return item.detailKey ? t(item.detailKey, item.detailParams ?? {}) : item.detail;
}

function queueItem(item) {
  const mark = item.priority ?? item.level ?? "normal";
  return `
    <li>
      <a class="dash-item" href="${escapeHtml(item.href)}">
        <span class="dash-dot dash-dot--${escapeHtml(mark)}" aria-hidden="true"></span>
        <span class="dash-item__body">
          <span class="dash-item__category">${escapeHtml(queueCategory(item.category))}${priorityFlag(item.priority)}${contactFlag(item.level)}</span>
          <strong>${escapeHtml(item.titleKey ? t(item.titleKey) : item.title)}</strong>
          <span class="dash-item__detail">${escapeHtml(itemDetail(item))}</span>
        </span>
        ${item.amount === undefined ? "" : `<span class="ops-amount ops-amount--neutral">${escapeHtml(formatCurrency(item.amount))}</span>`}
        <b aria-hidden="true">&rarr;</b>
      </a>
    </li>
  `;
}

function renderQueue(items, emptyMessage) {
  if (!items.length) return `<p class="dash-note">${escapeHtml(emptyMessage)}</p>`;
  return `<ul class="dash-list">${items.map(queueItem).join("")}</ul>`;
}

// A queue built without a module is incomplete, not clear: "nothing needs
// attention" would be a claim the Dashboard cannot make while that read failed.
function missingModulesNote(labels) {
  const missing = labels.filter(Boolean);
  if (!missing.length) return "";
  return `<p class="dash-inline-note dash-inline-note--warn" data-checks-partial>${escapeHtml(t("dashboard.checksMissingModules", { modules: missing.join(", ") }))}</p>`;
}

// Money, deals and reviews are in hand as soon as their reads answer; the
// project checks arrive with the project read and are merged in.
function renderAttention(projectItems, { projectsFailed = false, pending = false } = {}) {
  const all = [
    ...operationalChecks({ transactions: ledgerEntries, opportunities: dealEntries }),
    ...approvalChecks(pendingApprovals),
    ...projectItems,
  ];
  const items = rankAttention(all);
  const critical = all.filter((item) => item.priority === "critical").length;

  const note = pending
    ? `<p class="dash-inline-note" data-i18n="dashboard.checkingProjects">${t("dashboard.checkingProjects")}</p>`
    : projectsFailed
      ? `<p class="dash-inline-note dash-inline-note--warn" data-i18n="dashboard.projectChecksUnavailable">${t("dashboard.projectChecksUnavailable")}</p>`
      : "";
  const rest = all.length > items.length ? `<p class="dash-inline-note">${escapeHtml(t("dashboard.attentionShowing", { shown: items.length, total: all.length }))}</p>` : "";
  const partial = missingModulesNote([ledgerOk === false && t("nav.financial"), dealsOk === false && t("nav.commercial")]);

  return {
    html: `${renderQueue(items, t("dashboard.nothingNeedsAttention"))}${rest}${note}${partial}`,
    count: pending || !all.length ? "" : [plural("dashboard.attentionCount", all.length), critical ? plural("dashboard.criticalCount", critical) : ""].filter(Boolean).join(" · "),
    critical,
  };
}

/* -------------------------------------------------------- recent projects */

function projectRow(project) {
  return `
    <li>
      <a class="dash-item dash-item--project" href="#/projects/${encodeURIComponent(project.id)}" data-pulse-row>
        <span class="dash-item__body">
          <strong>${escapeHtml(project.name || t("projects.untitled"))}</strong>
          <span class="dash-item__detail">${escapeHtml([project.caseNumber, project.category || t("projects.uncategorised")].filter(Boolean).join(" · "))}</span>
        </span>
        <span class="dash-item__meta">
          ${badge(project.status, badgeType(project.status))}${badge(project.editorialStatus, badgeType(project.editorialStatus))}
          <span class="dash-item__when">${escapeHtml(t("dashboard.updatedAgo", { when: formatRelativeAge(project.updatedAt) }))}</span>
        </span>
        <b aria-hidden="true">&rarr;</b>
      </a>
    </li>
  `;
}

function renderRecentProjects(projects) {
  const recent = [...projects]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, RECENT_PROJECTS);

  if (!recent.length) return `<p class="dash-note" data-i18n="dashboard.noProjectsYet">${t("dashboard.noProjectsYet")}</p>`;
  return `<ul class="dash-list">${recent.map(projectRow).join("")}</ul>`;
}

/* ------------------------------------------------------------- commercial */

const PIPELINE_STAGES = ["NEW", "CONTACTED", "PROPOSAL", "NEGOTIATION", "WON"].map((id) => ({ id, label: id }));

// With no open deal there is no pipeline to draw: five empty bars would only
// say "zero" five times. The rail appears with the first open opportunity.
function renderPipeline() {
  if (dealsOk === null) return loadingNote();
  if (dealsOk === false) return `<p class="dash-note" data-i18n="dashboard.commercialUnavailable">${t("dashboard.commercialUnavailable")}</p>`;
  const summary = pipelineSummary(PIPELINE_STAGES, dealEntries);
  const won = summary.stages.find((stage) => stage.id === "WON")?.count ?? 0;

  if (!summary.open) {
    return `
      <div class="dash-empty" data-pipeline-empty>
        <strong data-i18n="dashboard.noOpenOpportunities">${t("dashboard.noOpenOpportunities")}</strong>
        <p data-i18n="dashboard.noOpenOpportunitiesHint">${t("dashboard.noOpenOpportunitiesHint")}</p>
        ${won ? `<p class="dash-empty__note">${escapeHtml(plural("dashboard.wonCount", won))}</p>` : ""}
        <a class="button button--compact" href="#/commercial" data-requires="commercial.edit" data-i18n="dashboard.registerOpportunity">${t("dashboard.registerOpportunity")}</a>
      </div>
    `;
  }

  return `
    <div class="dash-pipeline">
      ${summary.stages
        .map(
          (stage) => `
            <div class="dash-pipeline__row${stage.id === "WON" ? " dash-pipeline__row--won" : ""}">
              <span class="dash-pipeline__label">${escapeHtml(t(`commercial.stages.${stage.id}`))}</span>
              <span class="dash-pipeline__track">
                <span class="dash-pipeline__fill" style="--dash-fill:${barPercent(stage.count, summary.max)}%"></span>
              </span>
              <span class="dash-pipeline__count">${stage.count}</span>
            </div>
          `,
        )
        .join("")}
    </div>
    <p class="dash-summary">
      <span>${escapeHtml(plural("dashboard.openCount", summary.open))}</span>
      ${summary.highPriority ? `<span class="is-accent">${escapeHtml(plural("dashboard.highPriorityCount", summary.highPriority))}</span>` : ""}
    </p>
  `;
}

/* -------------------------------------------------------------- financial */

// periodLabel() is the English identity of a period; the screen reads the
// active locale's label for the same id.
function localizedPeriod(periodId) {
  const period = PERIODS.find((item) => item.id === periodId);
  return period ? t(period.labelKey) : periodLabel(periodId);
}

// Two different things, kept apart on screen: what is still owed (a balance
// as of now, whatever the period) and what actually moved inside the selected
// period (settled money only). "R$ 148 to receive" next to "R$ 0 this month"
// is not a contradiction once each says what it is.
function renderFinancial(periodId) {
  if (ledgerOk === null) return { html: loadingNote(), overdue: false };
  if (ledgerOk === false) {
    return { html: `<p class="dash-note" data-i18n="dashboard.financialUnavailable">${t("dashboard.financialUnavailable")}</p>`, overdue: false };
  }

  const open = receivablesSummary(ledgerEntries);
  const totals = financialTotals(ledgerEntries, periodId);
  const charges = open.count ? plural("dashboard.pendingCharges", open.count) : t("dashboard.noPendingCharges");
  const overdue = open.overdueCount > 0 || open.overduePayable > 0;

  return {
    overdue,
    html: `
      <p class="dash-figure">
        <strong>${escapeHtml(formatCurrency(open.total))}</strong>
        <span>${escapeHtml(t("dashboard.toReceiveLabel"))} · ${escapeHtml(charges)}</span>
      </p>
      ${
        open.overdueCount
          ? `<p class="dash-alert" data-fin-overdue>${escapeHtml(plural("dashboard.overdueCharges", open.overdueCount))} · ${escapeHtml(t("dashboard.overdueAmount", { amount: formatCurrency(open.overdueTotal) }))}</p>`
          : ""
      }
      ${
        open.toPay
          ? `<p class="dash-line"><span data-i18n="dashboard.toPay">${t("dashboard.toPay")}</span><b>${escapeHtml(formatCurrency(open.toPay))}</b>${
              open.overduePayable ? `<em>${escapeHtml(t("dashboard.overdueAmount", { amount: formatCurrency(open.overduePayable) }))}</em>` : ""
            }</p>`
          : ""
      }
      <h4 class="dash-sub">${escapeHtml(t("dashboard.movement", { period: localizedPeriod(periodId) }))}</h4>
      <dl class="dash-figures">
        <div><dt data-i18n="dashboard.received">${t("dashboard.received")}</dt><dd${totals.revenue > 0 ? ` class="is-in"` : ""}>${escapeHtml(formatCurrency(totals.revenue))}</dd></div>
        <div><dt data-i18n="dashboard.expenses">${t("dashboard.expenses")}</dt><dd${totals.expenses > 0 ? ` class="is-out"` : ""}>${escapeHtml(formatCurrency(totals.expenses))}</dd></div>
        <div><dt data-i18n="dashboard.result">${t("dashboard.result")}</dt><dd>${escapeHtml(formatCurrency(totals.result))}</dd></div>
      </dl>
    `,
  };
}

/* -------------------------------------------------------------- operation */

// Reports what the page verified and nothing else: whether its own reads
// answered, and what the project records say about the public cases. The
// website row is configuration, not a probe (see data/dashboard.js).
function renderOperation({ reads, projects, projectsOk }) {
  const status = operationStatus(reads);
  const health = projectsOk ? projectHealth(projects) : null;
  const tone = status.state === "ok" ? "" : status.state === "down" ? "danger" : "warning";

  const headline = status.failed.length
    ? `
      <div class="dash-status dash-status--${tone}" role="status" data-operation-problems>
        <strong><span class="dash-dot dash-dot--${tone === "danger" ? "critical" : "attention"}" aria-hidden="true"></span>${escapeHtml(plural("dashboard.operation.problems", status.failed.length))}</strong>
        <ul>${status.failed.map((id) => `<li>${escapeHtml(t("dashboard.operation.readFailed", { module: t(`nav.${id}`) }))}</li>`).join("")}</ul>
      </div>`
    : `<p class="dash-status" data-operation-ok><span class="dash-dot dash-dot--ok" aria-hidden="true"></span><span data-i18n="dashboard.operation.allResponding">${t("dashboard.operation.allResponding")}</span></p>`;

  const cases = health
    ? `
      <p class="dash-cases">
        <span><strong data-health-metric="published">${health.published}</strong> ${escapeHtml(plural("dashboard.operation.published", health.published))}</span>
        <span><strong data-health-metric="drafts">${health.drafts}</strong> ${escapeHtml(plural("dashboard.operation.drafts", health.drafts))}</span>
        <span>${escapeHtml(t("dashboard.archivedCount", { count: health.archived }))}</span>
        <span>${escapeHtml(t("dashboard.hiddenCount", { count: health.hidden }))}</span>
        <span${health.issues ? ` class="is-warn"` : ""}><strong data-health-metric="issues">${health.issues}</strong> ${escapeHtml(plural("dashboard.operation.issues", health.issues))}</span>
      </p>`
    : `<p class="dash-cases" data-i18n="dashboard.projectDataUnavailable">${t("dashboard.projectDataUnavailable")}</p>`;

  return {
    tone,
    html: `
      ${headline}
      <dl class="dash-rows">
        <div><dt data-i18n="dashboard.operation.site">${t("dashboard.operation.site")}</dt><dd title="${escapeHtml(t(spaceStatus.detailKey))}">${escapeHtml(t("common.configured"))}</dd></div>
        <div><dt data-i18n="dashboard.operation.adminData">${t("dashboard.operation.adminData")}</dt><dd class="dash-state dash-state--${escapeHtml(status.tone)}">${escapeHtml(t(`dashboard.operation.state.${status.state}`))} · ${escapeHtml(t("dashboard.operation.source", { source: DATA_SOURCE }))}</dd></div>
      </dl>
      <h4 class="dash-sub" data-i18n="dashboard.operation.content">${t("dashboard.operation.content")}</h4>
      ${cases}
    `,
  };
}

/* --------------------------------------------------------------- activity */

function renderActivity({ items, ok }) {
  if (!ok) return `<p class="dash-note" data-i18n="dashboard.activityUnavailable">${t("dashboard.activityUnavailable")}</p>`;
  if (!items.length) return `<p class="dash-note" data-i18n="dashboard.noRecentActivity">${t("dashboard.noRecentActivity")}</p>`;
  return `
    <ul class="dash-activity">
      ${items
        .map(
          (item) => `
            <li>
              <strong>${escapeHtml(item.title || item.action || t("dashboard.administrativeEvent"))}</strong>
              <span>${escapeHtml(item.detail || "")}</span>
              <time datetime="${escapeHtml(item.time ?? "")}">${escapeHtml(formatRelativeAge(item.time, { time: true }))}</time>
            </li>
          `,
        )
        .join("")}
    </ul>
  `;
}

/* ------------------------------------------------------------- automation */

// The automation service, from its own run statistics: whether it answers,
// how the recent runs went, and the runs that need a person. Optional by
// design -- "not configured" is a quiet line, not an outage, and an
// unreachable service never holds up or blanks the rest of the Dashboard.

// Shared across visits within the TTL, so returning to the Dashboard does not
// re-ask the service every time.
const automationStats = createAutomationResource(() => getAutomationRunStats());

const ATTENTION_DOT = { failed: "critical", stale: "attention", attention: "attention" };

function automationItem(item) {
  const detail = [t(`automation.reasons.${item.reason}`), entityLabel(item), item.error || ""].filter(Boolean).join(" · ");
  return `
    <li>
      <a class="dash-item" href="#/logs/automation">
        <span class="dash-dot dash-dot--${escapeHtml(ATTENTION_DOT[item.reason] ?? "attention")}" aria-hidden="true"></span>
        <span class="dash-item__body">
          <span class="dash-item__category" data-i18n="automation.title">${escapeHtml(t("automation.title"))}</span>
          <strong>${escapeHtml(eventLabel(item.event))}</strong>
          <span class="dash-item__detail">${escapeHtml(detail)}</span>
        </span>
        <span class="dash-item__when">${escapeHtml(formatRelativeAge(item.created_at, { time: true }))}</span>
        <b aria-hidden="true">&rarr;</b>
      </a>
    </li>
  `;
}

function renderAutomation(state) {
  if (state.status === LOADING) return { html: loadingNote(), tone: "" };
  if (state.status !== SUCCESS) {
    return {
      tone: "",
      html: `<p class="dash-status">${serviceStatusMarkup(state.status)}</p>${serviceStateNote(state.status)}`,
    };
  }

  const stats = state.data ?? {};
  const attention = Array.isArray(stats.attention) ? stats.attention : [];
  const failed = attention.some((item) => item.reason === "failed");
  const headline = `<p class="dash-status">${serviceStatusMarkup(SUCCESS)}<span>${escapeHtml(plural("automation.dashboard.recent", stats.total ?? 0))}</span></p>`;

  if (stats.storage_available === false) {
    return { tone: "warning", html: `${headline}<p class="dash-note" data-i18n="automation.dashboard.storageUnavailable">${t("automation.dashboard.storageUnavailable")}</p>` };
  }
  if (!stats.total) {
    return { tone: "", html: `${headline}<p class="dash-note" data-i18n="automation.dashboard.noRuns">${t("automation.dashboard.noRuns")}</p>` };
  }

  // A rate needs a sample: the service sends none below its threshold.
  const rate = Number.isFinite(stats.success_rate) ? t("automation.dashboard.rateValue", { rate: stats.success_rate }) : t("automation.dashboard.rateTooFew");
  const last = stats.last_run;

  return {
    tone: failed ? "danger" : attention.length ? "warning" : "",
    html: `
      <div class="dash-automation" data-automation-stats>
        ${headline}
        <dl class="dash-figures">
          <div><dt data-i18n="automation.dashboard.success">${t("automation.dashboard.success")}</dt><dd>${escapeHtml(stats.success ?? 0)}</dd></div>
          <div><dt data-i18n="automation.dashboard.failed">${t("automation.dashboard.failed")}</dt><dd${stats.failed ? ` class="is-out"` : ""}>${escapeHtml(stats.failed ?? 0)}</dd></div>
          <div><dt data-i18n="automation.dashboard.rate">${t("automation.dashboard.rate")}</dt><dd data-automation-rate>${escapeHtml(rate)}</dd></div>
        </dl>
        ${
          last
            ? `<p class="dash-automation__last"><span data-i18n="automation.dashboard.lastRun">${t("automation.dashboard.lastRun")}</span>: <strong>${escapeHtml(eventLabel(last.event))}</strong> · ${escapeHtml(t(`automation.runStatus.${last.status}`))} · <time datetime="${escapeHtml(last.created_at ?? "")}">${escapeHtml(formatRelativeAge(last.created_at, { time: true }))}</time></p>`
            : ""
        }
        ${
          attention.length
            ? `<h4 class="dash-sub">${escapeHtml(plural("automation.dashboard.attentionCount", attention.length))}</h4><ul class="dash-list" data-automation-attention>${attention.map(automationItem).join("")}</ul>`
            : `<p class="dash-quiet" data-automation-clear data-i18n="automation.dashboard.allClear">${t("automation.dashboard.allClear")}</p>`
        }
      </div>
    `,
  };
}

function automationPanel() {
  return `
      <article class="panel dash-panel" aria-labelledby="dash-automation-title" data-requires="logs.read">
        ${panelHead({ titleKey: "automation.title", id: "dash-automation-title", aside: moreLink({ href: "#/logs/automation", labelKey: "automation.dashboard.openRuns", requires: "logs.read" }) })}
        <div data-dash-automation aria-busy="true">${renderAutomation({ status: isAutomationApiAvailable() ? LOADING : NOT_CONFIGURED }).html}</div>
      </article>`;
}

// Resolved on its own, never awaited by the rest of the page.
async function paintAutomation() {
  const node = document.querySelector("[data-dash-automation]");
  if (!node || !hasPermission("logs.read")) return;
  const state = await automationStats.read();
  if (!node.isConnected) return;

  const paint = () => {
    const view = renderAutomation(state);
    node.innerHTML = view.html;
    node.removeAttribute("aria-busy");
    emphasize(node, view.tone);
  };
  paint();
  onLocaleChange(node, paint);
}

/* -------------------------------------------------- approvals and security */

// Nothing to review is a line, not a card with a zero in it.
function renderApprovals(count) {
  if (count === null) return { html: `<p class="dash-note" data-i18n="dashboard.approvals.unavailable">${t("dashboard.approvals.unavailable")}</p>`, pending: false };
  if (!count) {
    return {
      pending: false,
      html: `<p class="dash-quiet" data-approvals-clear><strong data-i18n="dashboard.approvals.clear">${t("dashboard.approvals.clear")}</strong> <span data-i18n="dashboard.approvals.clearDetail">${t("dashboard.approvals.clearDetail")}</span></p>`,
    };
  }
  return {
    pending: true,
    html: `
      <p class="dash-quiet" data-approvals-pending><strong>${escapeHtml(plural("dashboard.approvals.pending", count))}</strong></p>
      <a class="button button--primary button--compact" href="#/approvals" data-i18n="dashboard.approvals.open">${t("dashboard.approvals.open")}</a>
    `,
  };
}

// The trail itself stays on the Audit page. Here: whether anything that
// deserves a look happened lately (securityAlerts), and the latest of it.
function renderSecurity(entries) {
  if (entries === null) return { html: `<p class="dash-note" data-i18n="dashboard.security.unavailable">${t("dashboard.security.unavailable")}</p>`, alert: false };
  const alerts = securityAlerts(entries);
  if (!alerts.length) return { alert: false, html: `<p class="dash-quiet" data-security-clear data-i18n="dashboard.security.clear">${t("dashboard.security.clear")}</p>` };
  const [latest, ...others] = alerts;
  return {
    alert: true,
    html: `
      <p class="dash-quiet dash-quiet--stack" data-security-alert>
        <strong data-i18n="dashboard.security.recent">${t("dashboard.security.recent")}</strong>
        <span>${escapeHtml(t(`security.auditActions.${latest.action}`))} · <time datetime="${escapeHtml(latest.createdAt)}">${escapeHtml(formatRelativeAge(latest.createdAt, { time: true }))}</time></span>
      </p>
      ${others.length ? `<p class="dash-inline-note">${escapeHtml(plural("dashboard.security.more", others.length))}</p>` : ""}
    `,
  };
}

/* ------------------------------------------------------------------- page */

// A module the member cannot read is neither queried nor shown: its panel is
// gated (data-requires) and its read is skipped, never sent to be refused.
const SKIPPED = Symbol("skipped");
const readIf = (allowed, read) => (allowed ? read() : Promise.reject(SKIPPED));
// true (answered), false (failed) or null (never attempted).
const readState = (result, ok) => (result.reason === SKIPPED ? null : ok);

const canReview = () => isSecurityModelActive() && hasPermission("approvals.read_all");
const canAudit = () => isSecurityModelActive() && hasPermission("audit.read_all");

function approvalsPanel() {
  if (!canReview()) return "";
  return `
      <article class="panel dash-panel dash-panel--quiet" aria-labelledby="dash-approvals-title">
        ${panelHead({ titleKey: "nav.approvals", id: "dash-approvals-title" })}
        <div class="dash-quiet-body" data-dash-approvals aria-busy="true">${loadingNote()}</div>
      </article>`;
}

function securityPanel() {
  if (!canAudit()) return "";
  return `
      <article class="panel dash-panel dash-panel--quiet" aria-labelledby="dash-security-title">
        ${panelHead({ titleKey: "dashboard.security.title", id: "dash-security-title", aside: moreLink({ href: "#/audit", labelKey: "dashboard.security.openAudit", requires: "audit.read" }) })}
        <div class="dash-quiet-body" data-dash-security aria-busy="true">${loadingNote()}</div>
      </article>`;
}

const fullDashboard = {
  render: () => {
    ledgerEntries = [];
    ledgerOk = null;
    dealEntries = [];
    dealsOk = null;
    pendingApprovals = null;
    return `
    <section class="page-heading page-heading--split dash-heading">
      <div>
        <span data-i18n="dashboard.eyebrow">${t("dashboard.eyebrow")}</span>
        <h2 data-i18n="dashboard.heading">${t("dashboard.heading")}</h2>
      </div>
      <div class="heading-actions dash-heading__actions">
        <label class="dash-period">
          <span data-i18n="dashboard.period">${t("dashboard.period")}</span>
          <select data-dash-period>
            ${PERIODS.map(
              (period) =>
                `<option value="${escapeHtml(period.id)}" data-i18n="${escapeHtml(period.labelKey)}"${period.id === DEFAULT_PERIOD ? " selected" : ""}>${escapeHtml(t(period.labelKey))}</option>`,
            ).join("")}
          </select>
        </label>
        <a class="button button--primary dash-add" href="#/projects/new" data-requires="projects.create" data-i18n="dashboard.newProject">${t("dashboard.newProject")}</a>
        <a class="button dash-add" href="#/clients/new" data-requires="clients.create" data-i18n="clients.newClient">${t("clients.newClient")}</a>
      </div>
    </section>

    <section class="stats-grid stats-grid--quad dash-kpis" aria-label="${t("dashboard.primaryIndicators")}" data-dash-kpis>
      ${renderKpis()}
    </section>

    <div class="dash-layout">
      <article class="panel dash-panel dash-panel--attention" aria-labelledby="dash-attention-title">
        ${panelHead({ titleKey: "dashboard.needsAttention", id: "dash-attention-title", aside: `<span class="dash-head__meta" data-attention-count aria-live="polite"></span>` })}
        <div data-attention aria-busy="true">${renderAttention([], { pending: true }).html}</div>
      </article>

      <article class="panel dash-panel" aria-labelledby="dash-projects-title">
        ${panelHead({ titleKey: "dashboard.recentProjects", id: "dash-projects-title", aside: moreLink({ href: "#/projects", labelKey: "dashboard.viewAllProjects" }) })}
        <div data-pulse aria-busy="true">${skeleton()}</div>
      </article>

      <article class="panel dash-panel" aria-labelledby="dash-relationship-title" data-requires="clients.read|commercial.read">
        ${panelHead({ titleKey: "dashboard.relationship", id: "dash-relationship-title", aside: moreLink({ href: "#/clients", labelKey: "dashboard.openClients", requires: "clients.read" }) })}
        <div data-followups aria-busy="true">${skeleton(2)}</div>
      </article>

      <article class="panel dash-panel" aria-labelledby="dash-finance-title" data-requires="finance.read">
        ${panelHead({ titleKey: "dashboard.financial", id: "dash-finance-title", aside: moreLink({ href: "#/financial", labelKey: "dashboard.openFinancial" }) })}
        <div data-finance>${renderFinancial(DEFAULT_PERIOD).html}</div>
      </article>

      <article class="panel dash-panel" aria-labelledby="dash-commercial-title" data-requires="commercial.read">
        ${panelHead({ titleKey: "dashboard.commercial", id: "dash-commercial-title", aside: moreLink({ href: "#/commercial", labelKey: "dashboard.openCommercial" }) })}
        <div data-pipeline>${renderPipeline()}</div>
      </article>

      <article class="panel dash-panel" aria-labelledby="dash-health-title">
        ${panelHead({ titleKey: "dashboard.operation.title", id: "dash-health-title", aside: moreLink({ href: "#/cms", labelKey: "dashboard.operation.openCms", requires: "cms.read" }) })}
        <div data-health aria-busy="true">${loadingNote()}</div>
      </article>
      ${automationPanel()}
      ${approvalsPanel()}
      ${securityPanel()}

      <article class="panel dash-panel dash-panel--quiet" aria-labelledby="dash-activity-title" data-requires="logs.read">
        ${panelHead({ titleKey: "dashboard.recentActivity", id: "dash-activity-title", aside: moreLink({ href: "#/logs", labelKey: "dashboard.viewAllLogs" }) })}
        <div data-activity aria-busy="true">${loadingNote()}</div>
      </article>
    </div>
  `;
  },
  afterRender: async () => {
    const financeEl = document.querySelector("[data-finance]");
    const periodEl = document.querySelector("[data-dash-period]");

    const paintFinancial = () => {
      if (!financeEl?.isConnected) return;
      const finance = renderFinancial(periodEl.value);
      financeEl.innerHTML = finance.html;
      emphasize(financeEl, finance.overdue ? "danger" : "");
    };
    periodEl?.addEventListener("change", paintFinancial);

    void paintAutomation();

    // One failing query must never blank the Dashboard: each block resolves
    // independently, and the page renders from whatever answered.
    const [projectsResult, activityResult, clientsResult, ledgerResult, dealsResult, approvalsResult, auditResult] = await Promise.allSettled([
      getProjects(),
      readIf(hasPermission("logs.read"), () => getActivityWithStatus({ limit: RECENT_ACTIVITY })),
      readIf(hasPermission("clients.read"), () => getClients()),
      readIf(hasPermission("finance.read"), () => getTransactionsWithStatus()),
      readIf(hasPermission("commercial.read"), () => getOpportunitiesWithStatus()),
      // Shared with the sidebar badge (cached there), so this is no new request.
      readIf(canReview(), () => pendingApprovalCount()),
      readIf(canAudit(), () => listAuditEntries({ limit: AUDIT_SCAN })),
    ]);

    const attentionEl = document.querySelector("[data-attention]");
    const attentionCountEl = document.querySelector("[data-attention-count]");
    const pulseEl = document.querySelector("[data-pulse]");
    const activityEl = document.querySelector("[data-activity]");
    const healthEl = document.querySelector("[data-health]");
    const kpisEl = document.querySelector("[data-dash-kpis]");
    const followUpsEl = document.querySelector("[data-followups]");
    const pipelineEl = document.querySelector("[data-pipeline]");
    const approvalsEl = document.querySelector("[data-dash-approvals]");
    const securityEl = document.querySelector("[data-dash-security]");
    if (!pulseEl?.isConnected) return;

    const projectsOk = projectsResult.status === "fulfilled";
    const projects = projectsOk ? projectsResult.value : [];

    // Clients need the clients foundation migration. Until it is applied (or
    // on any failure) the client KPI reads "—" and the relationship list
    // carries only what the pipeline knows.
    const clientsOk = clientsResult.status === "fulfilled";
    const clients = clientsOk ? clientsResult.value : [];

    // The ledger needs the financial foundation migration. Until it is applied
    // (or on any failure) the financial panel says so and the balance reads "—".
    const ledger = ledgerResult.status === "fulfilled" ? ledgerResult.value : { items: [], ok: false };
    const clientNames = new Map(clients.map((client) => [client.id, client.name]));
    ledgerEntries = ledger.items.map((entry) => ({ ...entry, clientName: clientNames.get(entry.clientId) ?? "" }));
    // A read skipped for lack of permission is not an outage: its panel is
    // hidden, and no "unavailable" note is shown for it.
    ledgerOk = readState(ledgerResult, ledger.ok);

    const deals = dealsResult.status === "fulfilled" ? dealsResult.value : { items: [], ok: false };
    dealEntries = deals.items.map((deal) => ({ ...deal, clientName: clientNames.get(deal.clientId) ?? "" }));
    dealsOk = readState(dealsResult, deals.ok);

    // An outage and an empty log are different facts: getActivityWithStatus()
    // reports the read failure that getActivity() deliberately swallows.
    const activity = activityResult.status === "fulfilled" ? activityResult.value : { items: [], ok: false };
    const entries = activity.items.slice(0, RECENT_ACTIVITY);

    // pendingApprovalCount() answers null when the count failed.
    const approvalCount = approvalsResult.status === "fulfilled" ? approvalsResult.value : null;
    pendingApprovals = approvalCount;
    const auditEntries = auditResult.status === "fulfilled" ? auditResult.value : null;

    // What the Operation panel reports: the reads this page made, and how
    // each one went. A module the member may not read is left out.
    const reads = [
      { id: "projects", ok: projectsOk },
      { id: "clients", ok: readState(clientsResult, clientsOk) },
      { id: "financial", ok: ledgerOk },
      { id: "commercial", ok: dealsOk },
      { id: "logs", ok: readState(activityResult, activity.ok) },
    ];

    // Everything below renders from the results already in hand. A locale
    // change replays this, so the Dashboard re-reads in the other language
    // without issuing a single new query.
    function paintData() {
      kpisEl.innerHTML = renderKpis({ projects: projectsOk ? projects : null, clients: clientsOk ? clients : null });
      followUpsEl.innerHTML =
        renderQueue(followUps({ clients, opportunities: dealEntries }), t("dashboard.noFollowUps")) +
        missingModulesNote([!clientsOk && clientsResult.reason !== SKIPPED && t("nav.clients"), dealsOk === false && t("nav.commercial")]);
      if (pipelineEl) pipelineEl.innerHTML = renderPipeline();

      const attention = renderAttention(projectsOk ? projectChecks(projects) : [], { projectsFailed: !projectsOk });
      attentionEl.innerHTML = attention.html;
      attentionCountEl.textContent = attention.count;
      attentionCountEl.classList.toggle("is-critical", attention.critical > 0);
      pulseEl.innerHTML = projectsOk
        ? renderRecentProjects(projects)
        : `<p class="dash-note">${escapeHtml(describeError(projectsResult.reason, t("dashboard.loadProjectsError")))}</p>`;

      if (activityEl) activityEl.innerHTML = renderActivity({ items: entries, ok: activity.ok });

      const operation = renderOperation({ reads, projects, projectsOk });
      healthEl.innerHTML = operation.html;
      emphasize(healthEl, operation.tone);

      if (approvalsEl) {
        const approvals = renderApprovals(approvalCount);
        approvalsEl.innerHTML = approvals.html;
        emphasize(approvalsEl, approvals.pending ? "accent" : "");
      }
      if (securityEl) {
        const security = renderSecurity(auditEntries);
        securityEl.innerHTML = security.html;
        emphasize(securityEl, security.alert ? "warning" : "");
      }
      paintFinancial();
    }

    paintData();

    // The selected period is read back from the live control, so switching
    // locale keeps whatever range the user had chosen.
    onLocaleChange(pulseEl, paintData);

    [attentionEl, pulseEl, activityEl, healthEl, followUpsEl, approvalsEl, securityEl].forEach((node) => node?.removeAttribute("aria-busy"));
  },
};

export const dashboardPage = {
  title: () => t("dashboard.title"),
  breadcrumb: () => t("dashboard.breadcrumb"),
  render: (params) => (hasPermission("projects.read") ? fullDashboard : memberDashboard).render(params),
  afterRender: (params) => (hasPermission("projects.read") ? fullDashboard : memberDashboard).afterRender(params),
};
