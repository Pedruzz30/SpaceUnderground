import { badge, badgeType } from "../components/badge.js";
import { statCard } from "../components/stat-card.js";
import { spaceStatus } from "../data/dashboard.js";
import { DATA_SOURCE } from "../config/env.js";
import { getActivityWithStatus } from "../services/activity-service.js";
import { getClients } from "../services/client-service.js";
import { getOpportunitiesWithStatus } from "../services/commercial-service.js";
import { getTransactionsWithStatus } from "../services/financial-service.js";
import { getProjects } from "../services/project-service.js";
import { describeError } from "../services/errors.js";
import { onLocaleChange, statusLabel, t } from "../i18n/index.js";
import { effectiveDate, normalizeEntry, pendingReceivables, signedAmount } from "../utils/financial-metrics.js";
import { formatCurrency, formatRelativeDay, formatSignedCurrency } from "../utils/format.js";
import {
  PERIODS,
  activeClients,
  activeEngagements,
  adminDataStatus,
  barPercent,
  financialTotals,
  followUps,
  openOpportunities,
  operationalChecks,
  periodLabel,
  pipelineSummary,
  projectChecks,
  projectHealth,
  rankAttention,
} from "../utils/dashboard-metrics.js";
import { escapeHtml } from "../utils/html.js";
import { hasPermission, isSecurityModelActive } from "../security/access.js";
import { pendingApprovalCount } from "../services/approval-service.js";
import { listAuditEntries } from "../services/audit-service.js";
import { auditLine } from "./audit.js";
import { memberDashboard } from "./dashboard-member.js";

// The Dashboard mixes two origins and says so on screen:
// Every panel is real: clients, projects, the commercial pipeline, the
// financial ledger and the activity log, through the configured repository.
// Each block resolves on its own, so one failing read never blanks the rest.

const DEFAULT_PERIOD = "month";

// The ledger for the Dashboard on screen. `ledgerOk` is null while the read is
// in flight, so the financial figures read "—" instead of a zero that could be
// mistaken for a real balance. Reset on every render.
let ledgerEntries = [];
let ledgerOk = null;
// Same contract for the commercial pipeline.
let dealEntries = [];
let dealsOk = null;

/* ---------------------------------------------------------------- helpers */

function activityTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const sameDay = date.toDateString() === new Date().toDateString();
  if (sameDay) return date.toLocaleTimeString(document.documentElement.lang || undefined, { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString(document.documentElement.lang || undefined, { month: "short", day: "2-digit" });
}

function panelHead(eyebrow, title, id, action = "") {
  return `
    <header class="panel__head">
      <div>
        <span>${escapeHtml(eyebrow)}</span>
        <h3 id="${escapeHtml(id)}">${escapeHtml(title)}</h3>
      </div>
      ${action}
    </header>
  `;
}

function textLink(href, label) {
  return `<a class="text-link" href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
}

/* ------------------------------------------------------------------- KPIs */

// Every figure reads "—" until its query resolves (or if it fails).
function renderKpis({ engagements = "—", clients = "—" } = {}) {
  return `
    ${statCard({
      label: t("dashboard.activeProjects"),
      value: engagements,
      detail: t("dashboard.activeProjectsDetail"),
    })}
    ${statCard({
      label: t("dashboard.activeClients"),
      value: clients,
      detail: t("dashboard.activeClientsDetail"),
    })}
    ${statCard({
      label: t("dashboard.openOpportunities"),
      value: dealsOk ? openOpportunities(dealEntries) : "—",
      detail: t("dashboard.openOpportunitiesDetail"),
    })}
    ${statCard({
      label: t("dashboard.toReceive"),
      value: ledgerOk ? escapeHtml(formatCurrency(pendingReceivables(ledgerEntries))) : "—",
      detail: t("dashboard.toReceiveDetail"),
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

function queueItem(item) {
  return `
    <a class="dash-queue-item" href="${escapeHtml(item.href)}">
      <span class="dash-dot dash-dot--${escapeHtml(item.tone || "neutral")}" aria-hidden="true"></span>
      <span class="dash-queue-item__body">
        <span class="dash-queue-item__category">${escapeHtml(queueCategory(item.category))}</span>
        <strong>${escapeHtml(item.title)}</strong>
        <span class="dash-queue-item__detail">${escapeHtml(item.detailKey ? t(item.detailKey, item.detailParams ?? {}) : item.detail)}</span>
      </span>
      ${item.amount === undefined ? "" : `<span class="ops-amount ops-amount--neutral">${escapeHtml(formatCurrency(item.amount))}</span>`}
      <b aria-hidden="true">&rarr;</b>
    </a>
  `;
}

function renderQueue(items, emptyMessage) {
  if (!items.length) return `<p class="empty-inline">${escapeHtml(emptyMessage)}</p>`;
  return `<div class="dash-queue">${items.map(queueItem).join("")}</div>`;
}

// A queue built without a module is incomplete, not clear: "nothing needs
// attention" would be a claim the Dashboard cannot make while that read failed.
function missingModulesNote(labels) {
  const missing = labels.filter(Boolean);
  if (!missing.length) return "";
  return `<p class="dash-inline-note dash-inline-note--warn" data-checks-partial>${escapeHtml(t("dashboard.checksMissingModules", { modules: missing.join(", ") }))}</p>`;
}

// The operational half is local, so it paints immediately; the project checks
// arrive with the repository query and are merged in afterwards.
function renderAttention(projectItems, { projectsFailed = false, pending = false } = {}) {
  const items = rankAttention([
    ...operationalChecks({ transactions: ledgerEntries, opportunities: dealEntries }),
    ...projectItems,
  ]);

  const note = pending
    ? `<p class="dash-inline-note" data-i18n="dashboard.checkingProjects">${t("dashboard.checkingProjects")}</p>`
    : projectsFailed
      ? `<p class="dash-inline-note dash-inline-note--warn" data-i18n="dashboard.projectChecksUnavailable">${t("dashboard.projectChecksUnavailable")}</p>`
      : "";

  const partial = missingModulesNote([ledgerOk === false && t("nav.financial"), dealsOk === false && t("nav.commercial")]);
  return `${renderQueue(items, t("dashboard.nothingNeedsAttention"))}${note}${partial}`;
}

/* ---------------------------------------------------------- project pulse */

function pulseRow(project) {
  return `
    <a class="ops-row ops-row--link" href="#/projects/${encodeURIComponent(project.id)}" data-pulse-row>
      <span class="ops-meta" data-label="${t("dashboard.case")}">${escapeHtml(project.caseNumber)}</span>
      <span class="ops-row__primary">
        <strong>${escapeHtml(project.name || t("projects.untitled"))}</strong>
        <small>${escapeHtml(project.category || t("projects.uncategorised"))}</small>
      </span>
      <span data-label="${t("common.status")}">${badge(project.status, badgeType(project.status))}</span>
      <span data-label="${t("common.editorial")}">${badge(project.editorialStatus, badgeType(project.editorialStatus))}</span>
      <span class="ops-meta" data-label="${t("common.updated")}">${escapeHtml(formatRelativeDay(project.updatedAt))}</span>
      <span class="ops-row__arrow" aria-hidden="true">&rarr;</span>
    </a>
  `;
}

function renderPulse(projects) {
  const recent = [...projects]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5);

  if (!recent.length) return `<p class="empty-inline" data-i18n="dashboard.noProjectsYet">${t("dashboard.noProjectsYet")}</p>`;

  return `
    <div class="ops-table dash-pulse">
      <div class="ops-table__head" aria-hidden="true">
        <span data-i18n="dashboard.case">${t("dashboard.case")}</span><span data-i18n="dashboard.project">${t("dashboard.project")}</span><span>${t("common.status").toUpperCase()}</span><span>${t("common.editorial").toUpperCase()}</span><span>${t("common.updated").toUpperCase()}</span><span></span>
      </div>
      ${recent.map(pulseRow).join("")}
    </div>
  `;
}

/* ------------------------------------------------------------- commercial */

const PIPELINE_STAGES = ["NEW", "CONTACTED", "PROPOSAL", "NEGOTIATION", "WON"].map((id) => ({ id, label: id }));

function renderPipeline() {
  if (dealsOk === null) return `<p class="empty-inline">${escapeHtml(t("common.loading"))}...</p>`;
  if (dealsOk === false) return `<p class="empty-inline" data-i18n="dashboard.commercialUnavailable">${t("dashboard.commercialUnavailable")}</p>`;
  const summary = pipelineSummary(PIPELINE_STAGES, dealEntries);

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

    <div class="ops-figures dash-figures">
      <div><span data-i18n="dashboard.openOpportunities">${t("dashboard.openOpportunities")}</span><strong>${summary.open}</strong></div>
      <div><span data-i18n="status.high">${t("status.high")}</span><strong class="is-accent">${summary.highPriority}</strong></div>
    </div>
  `;
}

/* -------------------------------------------------------------- financial */

// Pending money has not moved yet, so it stays neutral instead of claiming
// the colour the ledger reserves for settled amounts.
function ledgerLine(transaction) {
  const entry = normalizeEntry(transaction);
  const settled = entry.status === "PAID";
  const tone = !settled ? "neutral" : entry.type === "INCOME" ? "positive" : "negative";
  const value = settled ? formatSignedCurrency(signedAmount(entry)) : formatCurrency(entry.amount);
  const typeLabel = entry.status === "PAID" ? t(`financial.types.${entry.type}`) : t(`financial.statuses.${entry.status}`);

  return `
    <li>
      <span class="dash-ledger__type">${escapeHtml(typeLabel.toUpperCase())}</span>
      <span class="dash-ledger__description">${escapeHtml(transaction.description)}</span>
      <span class="ops-amount ops-amount--${tone}">${escapeHtml(value)}</span>
    </li>
  `;
}

// periodLabel() is the English identity of a period; the screen reads the
// active locale's label for the same id.
function localizedPeriod(periodId) {
  const period = PERIODS.find((item) => item.id === periodId);
  return period ? t(period.labelKey) : periodLabel(periodId);
}

// Revenue, expenses and result are recomputed from the transactions inside the
// selected period — the only figures the period selector can honestly change.
// "To receive" stays a point-in-time balance and lives in the KPI strip.
function renderFinancial(periodId) {
  if (ledgerOk === null) return `<p class="empty-inline">${escapeHtml(t("common.loading"))}...</p>`;
  if (ledgerOk === false) return `<p class="empty-inline" data-i18n="dashboard.financialUnavailable">${t("dashboard.financialUnavailable")}</p>`;

  const totals = financialTotals(ledgerEntries, periodId);
  const max = Math.max(totals.revenue, totals.expenses, 1);
  const recent = totals.transactions
    .filter((transaction) => normalizeEntry(transaction).status !== "CANCELLED")
    .sort((a, b) => String(effectiveDate(b)).localeCompare(String(effectiveDate(a))))
    .slice(0, 3);

  return `
    <p class="dash-hero">
      <span>${t("dashboard.result")} · ${escapeHtml(localizedPeriod(periodId).toUpperCase())}</span>
      <strong>${escapeHtml(formatCurrency(totals.result))}</strong>
    </p>

    <div class="dash-bars">
      <div class="dash-bar">
        <span class="dash-bar__label" data-i18n="dashboard.revenue">${t("dashboard.revenue")}</span>
        <span class="dash-bar__track">
          <span class="dash-bar__fill dash-bar__fill--in" style="--dash-fill:${barPercent(totals.revenue, max)}%"></span>
        </span>
        <span class="ops-amount ops-amount--positive">${escapeHtml(formatCurrency(totals.revenue))}</span>
      </div>
      <div class="dash-bar">
        <span class="dash-bar__label" data-i18n="dashboard.expenses">${t("dashboard.expenses")}</span>
        <span class="dash-bar__track">
          <span class="dash-bar__fill dash-bar__fill--out" style="--dash-fill:${barPercent(totals.expenses, max)}%"></span>
        </span>
        <span class="ops-amount ops-amount--negative">${escapeHtml(formatCurrency(totals.expenses))}</span>
      </div>
    </div>

    ${
      recent.length
        ? `<ul class="dash-ledger">${recent.map(ledgerLine).join("")}</ul>`
        : `<p class="empty-inline" data-i18n="dashboard.noTransactionsInPeriod">${t("dashboard.noTransactionsInPeriod")}</p>`
    }
  `;
}

/* ---------------------------------------------------------- system health */

function healthTile(label, value, detail, tone = "", metric = "") {
  const classAttribute = tone ? ` class="dash-health-value--${escapeHtml(tone)}"` : "";
  const metricAttribute = metric ? ` data-health-metric="${escapeHtml(metric)}"` : "";
  return `
    <div>
      <span>${escapeHtml(label)}</span>
      <strong${classAttribute}${metricAttribute}>${escapeHtml(value)}</strong>
      <small>${escapeHtml(detail)}</small>
    </div>
  `;
}

function renderHealth({ projects, projectsOk, activityOk }) {
  const status = adminDataStatus({ projectsOk, activityOk });
  const health = projectsOk ? projectHealth(projects) : null;

  return `
    ${healthTile(t("dashboard.publicWebsite"), t("common.configured").toUpperCase(), t(spaceStatus.detailKey))}
    ${healthTile(t("dashboard.adminData"), statusLabel(status.label), t("dashboard.dataSourceSuffix", { detail: t(status.detailKey), source: DATA_SOURCE }), status.tone)}
    ${healthTile(t("dashboard.publishedCases"), health ? String(health.published) : "—", health ? t("dashboard.archivedCount", { count: health.archived }) : t("dashboard.projectDataUnavailable"), "", "published")}
    ${healthTile(t("dashboard.draftCases"), health ? String(health.drafts) : "—", health ? t("dashboard.hiddenCount", { count: health.hidden }) : t("dashboard.projectDataUnavailable"), "", "drafts")}
    ${healthTile(
      t("dashboard.contentIssues"),
      health ? String(health.issues) : "—",
      health ? (health.issues ? t("dashboard.editorialChecksPending") : t("dashboard.editorialChecksClear")) : t("dashboard.projectDataUnavailable"),
      health && health.issues ? "warn" : "",
      "issues",
    )}
  `;
}

/* ------------------------------------------------------------------- page */

// A module the member cannot read is neither queried nor shown: its panel is
// gated (data-requires) and its read is skipped, never sent to be refused.
const SKIPPED = Symbol("skipped");
const readIf = (permission, read) => (hasPermission(permission) ? read() : Promise.reject(SKIPPED));

function securityPanel() {
  if (!isSecurityModelActive() || !(hasPermission("approvals.read_all") || hasPermission("audit.read_all"))) return "";
  return `
      <article class="panel dash-panel--security" aria-labelledby="dash-security-title">
        ${panelHead(t("security.dashboard.title"), t("security.dashboard.subtitle"), "dash-security-title", textLink("#/approvals", t("security.dashboard.openApprovals")))}
        <div data-dash-security aria-busy="true"><p class="empty-inline">${t("common.loading")}...</p></div>
      </article>`;
}

async function paintSecurityPanel() {
  const node = document.querySelector("[data-dash-security]");
  if (!node) return;
  const [count, events] = await Promise.all([
    hasPermission("approvals.read_all") ? pendingApprovalCount() : Promise.resolve(null),
    hasPermission("audit.read_all") ? listAuditEntries({ limit: 5 }).catch(() => []) : Promise.resolve([]),
  ]);
  if (!node.isConnected) return;
  node.removeAttribute("aria-busy");
  node.innerHTML = `
    ${count === null ? "" : `<p class="dash-security__count"><strong>${escapeHtml(String(count))}</strong> ${escapeHtml(t("security.dashboard.pending"))}</p>`}
    ${events.length ? `<ol class="audit-list audit-list--compact">${events.map((entry) => auditLine(entry)).join("")}</ol>` : ""}
  `;
}

const fullDashboard = {
  render: () => {
    ledgerEntries = [];
    ledgerOk = null;
    dealEntries = [];
    dealsOk = null;
    return `
    <section class="page-heading page-heading--split">
      <div>
        <span data-i18n="dashboard.eyebrow">${t("dashboard.eyebrow")}</span>
        <h2 data-i18n="dashboard.heading">${t("dashboard.heading")}</h2>
        <p data-i18n="dashboard.intro">${t("dashboard.intro")}</p>
      </div>
      <div class="heading-actions">
        <label class="dash-period">
          <span data-i18n="dashboard.period">${t("dashboard.period")}</span>
          <select data-dash-period>
            ${PERIODS.map(
              (period) =>
                `<option value="${escapeHtml(period.id)}"${period.id === DEFAULT_PERIOD ? " selected" : ""}>${escapeHtml(t(period.labelKey))}</option>`,
            ).join("")}
          </select>
        </label>
      </div>
    </section>

    <section class="stats-grid stats-grid--quad dash-kpis" aria-label="${t("dashboard.primaryIndicators")}" data-dash-kpis>
      ${renderKpis()}
    </section>

    <p class="ops-note dash-legend" data-i18n="dashboard.legend">${t("dashboard.legend")}</p>

    <div class="dash-grid">
      <article class="panel dash-panel--attention" aria-labelledby="dash-attention-title">
        ${panelHead(t("dashboard.needsAttention"), t("dashboard.itemsRequiringAction"), "dash-attention-title")}
        <div data-attention aria-busy="true">
          ${renderAttention([], { pending: true })}
        </div>
      </article>

      <article class="panel dash-panel--actions" aria-labelledby="dash-actions-title">
        ${panelHead(t("dashboard.quickActions"), t("dashboard.jumpIntoWork"), "dash-actions-title")}
        <div class="dash-actions">
          <a class="button button--primary" href="#/projects/new" data-requires="projects.create" data-i18n="dashboard.newProject">${t("dashboard.newProject")}</a>
          <a class="button" href="#/clients" data-requires="clients.read" data-i18n="nav.clients">${t("nav.clients")}</a>
          <a class="button" href="#/commercial" data-requires="commercial.read" data-i18n="nav.commercial">${t("nav.commercial")}</a>
          <a class="button" href="#/financial" data-requires="finance.read" data-i18n="nav.financial">${t("nav.financial")}</a>
          <a class="button" href="#/cms" data-requires="cms.read">CMS</a>
        </div>
      </article>

      <article class="panel dash-panel--pulse" aria-labelledby="dash-pulse-title">
        ${panelHead(t("dashboard.projectPulse"), t("dashboard.currentProjectActivity"), "dash-pulse-title", textLink("#/projects", t("dashboard.viewAllProjects")))}
        <div class="ops-table-scroll" data-pulse aria-busy="true">
          <div class="dash-skeleton"></div>
          <div class="dash-skeleton"></div>
          <div class="dash-skeleton"></div>
        </div>
      </article>

      ${securityPanel()}

      <article class="panel dash-panel--finance" aria-labelledby="dash-finance-title" data-requires="finance.read">
        ${panelHead(t("dashboard.financialSnapshot"), t("dashboard.revenueAgainstExpenses"), "dash-finance-title", textLink("#/financial", t("dashboard.openFinancial")))}
        <div data-finance>${renderFinancial(DEFAULT_PERIOD)}</div>
      </article>

      <article class="panel dash-panel--commercial" aria-labelledby="dash-commercial-title" data-requires="commercial.read">
        ${panelHead(t("dashboard.commercialPipeline"), t("dashboard.opportunitiesByStage"), "dash-commercial-title", textLink("#/commercial", t("dashboard.openCommercial")))}
        <div data-pipeline>${renderPipeline()}</div>
      </article>

      <article class="panel dash-panel--followups" aria-labelledby="dash-followups-title" data-requires="clients.read|commercial.read">
        ${panelHead(t("dashboard.followUps"), t("dashboard.peopleToContactNext"), "dash-followups-title")}
        <div data-followups aria-busy="true">
          <p class="empty-inline">${t("common.loading")}...</p>
        </div>
      </article>

      <article class="panel dash-panel--activity" aria-labelledby="dash-activity-title" data-requires="logs.read">
        ${panelHead(t("dashboard.recentActivity"), t("dashboard.administrativeLog"), "dash-activity-title", textLink("#/logs", t("dashboard.viewAllLogs")))}
        <div class="activity-list" data-activity aria-busy="true">
          <p class="empty-inline">${t("common.loading")}...</p>
        </div>
      </article>

      <article class="panel dash-panel--health" aria-labelledby="dash-health-title">
        ${panelHead(t("dashboard.systemHealth"), t("dashboard.adminAndWebsiteState"), "dash-health-title", textLink("#/cms", t("dashboard.openCms")))}
        <div class="ops-figures dash-health" data-health aria-busy="true">
          ${renderHealth({ projects: [], projectsOk: false, activityOk: false })}
        </div>
      </article>
    </div>
  `;
  },
  afterRender: async () => {
    const financeEl = document.querySelector("[data-finance]");
    const periodEl = document.querySelector("[data-dash-period]");

    periodEl?.addEventListener("change", () => {
      if (!financeEl?.isConnected) return;
      financeEl.innerHTML = renderFinancial(periodEl.value);
    });

    // One failing query must never blank the Dashboard: the demo-backed panels
    // are already on screen, and each real block resolves independently.
    paintSecurityPanel();
    const [projectsResult, activityResult, clientsResult, ledgerResult, dealsResult] = await Promise.allSettled([
      getProjects(),
      readIf("logs.read", () => getActivityWithStatus({ limit: 6 })),
      readIf("clients.read", () => getClients()),
      readIf("finance.read", () => getTransactionsWithStatus()),
      readIf("commercial.read", () => getOpportunitiesWithStatus()),
    ]);

    const attentionEl = document.querySelector("[data-attention]");
    const pulseEl = document.querySelector("[data-pulse]");
    const activityEl = document.querySelector("[data-activity]");
    const healthEl = document.querySelector("[data-health]");
    const kpisEl = document.querySelector("[data-dash-kpis]");
    const followUpsEl = document.querySelector("[data-followups]");
    if (!pulseEl?.isConnected) return;

    const projectsOk = projectsResult.status === "fulfilled";
    const projects = projectsOk ? projectsResult.value : [];

    // Clients need the clients foundation migration. Until it is applied (or on any failure) the
    // two client KPIs read "—" and follow ups list only the demo pipeline.
    const clientsOk = clientsResult.status === "fulfilled";
    const clients = clientsOk ? clientsResult.value : [];

    // The ledger needs the financial foundation migration. Until it is applied
    // (or on any failure) the financial panel says so and the balance reads "—".
    const ledger = ledgerResult.status === "fulfilled" ? ledgerResult.value : { items: [], ok: false };
    const clientNames = new Map(clients.map((client) => [client.id, client.name]));
    ledgerEntries = ledger.items.map((entry) => ({ ...entry, clientName: clientNames.get(entry.clientId) ?? "" }));
    // A read skipped for lack of permission is not an outage: its panel is
    // hidden, and no "unavailable" note is shown for it.
    ledgerOk = ledgerResult.reason === SKIPPED ? null : ledger.ok;

    const deals = dealsResult.status === "fulfilled" ? dealsResult.value : { items: [], ok: false };
    dealEntries = deals.items.map((deal) => ({ ...deal, clientName: clientNames.get(deal.clientId) ?? "" }));
    dealsOk = dealsResult.reason === SKIPPED ? null : deals.ok;
    const pipelineEl = document.querySelector("[data-pipeline]");

    // An outage and an empty log are different facts: getActivityWithStatus()
    // reports the read failure that getActivity() deliberately swallows.
    const activity = activityResult.status === "fulfilled" ? activityResult.value : { items: [], ok: false };
    const activityOk = activity.ok;
    const entries = activity.items.slice(0, 6);

    // Everything below renders from the two results already in hand. A locale
    // change replays this, so the Dashboard re-reads in the other language
    // without issuing a single new query.
    function paintData() {
      kpisEl.innerHTML = renderKpis({
        engagements: projectsOk ? activeEngagements(projects) : "—",
        clients: clientsOk ? activeClients(clients) : "—",
      });
      followUpsEl.innerHTML =
        renderQueue(followUps({ clients, opportunities: dealEntries }), t("dashboard.noFollowUps")) +
        missingModulesNote([!clientsOk && clientsResult.reason !== SKIPPED && t("nav.clients"), dealsOk === false && t("nav.commercial")]);
      if (pipelineEl) pipelineEl.innerHTML = renderPipeline();

      if (projectsOk) {
        attentionEl.innerHTML = renderAttention(projectChecks(projects));
        pulseEl.innerHTML = renderPulse(projects);
      } else {
        const message = describeError(projectsResult.reason, t("dashboard.loadProjectsError"));
        attentionEl.innerHTML = renderAttention([], { projectsFailed: true });
        pulseEl.innerHTML = `<p class="empty-inline">${escapeHtml(message)}</p>`;
      }

      if (!activityOk) {
        activityEl.innerHTML = `<p class="empty-inline" data-i18n="dashboard.activityUnavailable">${t("dashboard.activityUnavailable")}</p>`;
      } else if (!entries.length) {
        activityEl.innerHTML = `<p class="empty-inline" data-i18n="dashboard.noRecentActivity">${t("dashboard.noRecentActivity")}</p>`;
      } else {
        activityEl.innerHTML = entries
          .map(
            (item) => `
              <div>
                <span></span>
                <strong>${escapeHtml(item.title || item.action || t("dashboard.administrativeEvent"))}</strong>
                <p>${escapeHtml(item.detail || t("dashboard.noAdditionalDetail"))}</p>
                <small>${escapeHtml(activityTime(item.time))}</small>
              </div>
            `,
          )
          .join("");
      }

      healthEl.innerHTML = renderHealth({ projects, projectsOk, activityOk });
    }

    paintData();
    financeEl.innerHTML = renderFinancial(periodEl.value);

    // The selected period is read back from the live control, so switching
    // locale keeps whatever range the user had chosen.
    onLocaleChange(pulseEl, () => {
      paintData();
      financeEl.innerHTML = renderFinancial(periodEl.value);
    });

    attentionEl?.removeAttribute("aria-busy");
    pulseEl.removeAttribute("aria-busy");
    activityEl?.removeAttribute("aria-busy");
    healthEl?.removeAttribute("aria-busy");
    followUpsEl?.removeAttribute("aria-busy");
  },
};

export const dashboardPage = {
  title: () => t("dashboard.title"),
  breadcrumb: () => t("dashboard.breadcrumb"),
  render: (params) => (hasPermission("projects.read") ? fullDashboard : memberDashboard).render(params),
  afterRender: (params) => (hasPermission("projects.read") ? fullDashboard : memberDashboard).afterRender(params),
};
