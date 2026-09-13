import { badge, badgeType } from "../components/badge.js";
import { statCard } from "../components/stat-card.js";
import { spaceStatus } from "../data/dashboard.js";
import { DATA_SOURCE } from "../config/env.js";
import {
  demoClients,
  demoOpportunities,
  demoPipelineStages,
  demoTransactions,
} from "../data/operations-demo.js";
import { getOperationsOverview } from "../services/automation-api.js";
import { overviewFiguresMarkup, overviewTimestamp, serviceStatusMarkup } from "../components/automation-panel.js";
import {
  ERROR,
  LOADING,
  NOT_CONFIGURED,
  SUCCESS,
  createAutomationResource,
} from "../utils/automation-state.js";
import { getActivityWithStatus } from "../services/activity-service.js";
import { getProjects } from "../services/project-service.js";
import { describeError } from "../services/errors.js";
import { onLocaleChange, statusLabel, t } from "../i18n/index.js";
import { pendingReceivables } from "../utils/financial-metrics.js";
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
import { escapeAttribute, escapeHtml } from "../utils/html.js";

// The Dashboard mixes two origins and says so on screen:
//   REAL — projects and the activity log, through the configured repository.
//   DEMO — clients, commercial and financial, from operations-demo.js.
// Nothing here queries Supabase for the demo domains, and no demo record is
// ever written back into a repository.

const DEFAULT_PERIOD = "month";

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

// All four are presentation-only: the operational domains have no backend yet.
function renderKpis() {
  return `
    ${statCard({
      label: t("dashboard.activeProjects"),
      value: activeEngagements(demoClients),
      detail: t("dashboard.activeProjectsDetail"),
    })}
    ${statCard({
      label: t("dashboard.activeClients"),
      value: activeClients(demoClients),
      detail: t("dashboard.activeClientsDetail"),
    })}
    ${statCard({
      label: t("dashboard.openOpportunities"),
      value: openOpportunities(demoOpportunities),
      detail: t("dashboard.openOpportunitiesDetail"),
    })}
    ${statCard({
      label: t("dashboard.toReceive"),
      value: escapeHtml(formatCurrency(pendingReceivables(demoTransactions))),
      detail: t("dashboard.toReceiveDetail"),
    })}
  `;
}

/* -------------------------------------------------------------- attention */

function queueItem(item) {
  return `
    <a class="dash-queue-item" href="${escapeHtml(item.href)}">
      <span class="dash-dot dash-dot--${escapeHtml(item.tone || "neutral")}" aria-hidden="true"></span>
      <span class="dash-queue-item__body">
        <span class="dash-queue-item__category">${escapeHtml(item.category)}</span>
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

// The operational half is local, so it paints immediately; the project checks
// arrive with the repository query and are merged in afterwards.
function renderAttention(projectItems, { projectsFailed = false, pending = false } = {}) {
  const items = rankAttention([
    ...operationalChecks({ transactions: demoTransactions, opportunities: demoOpportunities }),
    ...projectItems,
  ]);

  const note = pending
    ? `<p class="dash-inline-note" data-i18n="dashboard.checkingProjects">${t("dashboard.checkingProjects")}</p>`
    : projectsFailed
      ? `<p class="dash-inline-note dash-inline-note--warn" data-i18n="dashboard.projectChecksUnavailable">${t("dashboard.projectChecksUnavailable")}</p>`
      : "";

  return `${renderQueue(items, t("dashboard.nothingNeedsAttention"))}${note}`;
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

function renderPipeline() {
  const summary = pipelineSummary(demoPipelineStages, demoOpportunities);

  return `
    <div class="dash-pipeline">
      ${summary.stages
        .map(
          (stage) => `
            <div class="dash-pipeline__row${stage.id === "WON" ? " dash-pipeline__row--won" : ""}">
              <span class="dash-pipeline__label" data-status-label="${escapeAttribute(stage.id)}">${escapeHtml(statusLabel(stage.id))}</span>
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

function ledgerLine(transaction) {
  const settled = transaction.status !== "PENDING";
  const tone = !settled ? "neutral" : transaction.amount >= 0 ? "positive" : "negative";
  const value = settled ? formatSignedCurrency(transaction.amount) : formatCurrency(Math.abs(transaction.amount));

  return `
    <li>
      <span class="dash-ledger__type">${escapeHtml(transaction.type)}</span>
      <span class="dash-ledger__description">${escapeHtml(transaction.description)}</span>
      <span class="ops-amount ops-amount--${tone}">${escapeHtml(value)}</span>
    </li>
  `;
}

// Revenue, expenses and result are recomputed from the transactions inside the
// selected period — the only figures the period selector can honestly change.
// "To receive" stays a point-in-time balance and lives in the KPI strip.
function renderFinancial(periodId) {
  const totals = financialTotals(demoTransactions, periodId);
  const max = Math.max(totals.revenue, totals.expenses, 1);
  const recent = [...totals.transactions]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 3);

  return `
    <p class="dash-hero">
      <span>${t("dashboard.result")} · ${escapeHtml(periodLabel(periodId).toUpperCase())}</span>
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

/* --------------------------------------------------- operations intelligence */

// Kept at module scope so returning to the Dashboard within the TTL reuses the
// last answer instead of re-querying on every navigation.
const overviewResource = createAutomationResource(() => getOperationsOverview());

function renderOperations(state) {
  const body = () => {
    if (state.status === NOT_CONFIGURED) {
      return `<p class="empty-inline" data-i18n="automation.notConfiguredHint">${t("automation.notConfiguredHint")}</p>`;
    }
    if (state.status === ERROR) {
      return `<p class="empty-inline" data-i18n="operations.loadError">${t("operations.loadError")}</p>`;
    }
    if (state.status !== SUCCESS) {
      return `<div class="dash-skeleton"></div><div class="dash-skeleton"></div>`;
    }
    return overviewFiguresMarkup(state.data);
  };

  const time = state.status === SUCCESS ? overviewTimestamp(state.data) : "";

  return `
    <div class="automation-head">
      <span data-i18n="automation.service">${t("automation.service")}</span>
      ${serviceStatusMarkup(state.status)}
    </div>
    ${body()}
    ${time ? `<p class="dash-inline-note">${escapeHtml(t("operations.updatedAt", { time }))}</p>` : ""}
  `;
}

/* ------------------------------------------------------------------- page */

export const dashboardPage = {
  title: () => t("dashboard.title"),
  breadcrumb: () => t("dashboard.breadcrumb"),
  render: () => `
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

    <section class="stats-grid stats-grid--quad dash-kpis" aria-label="${t("dashboard.primaryIndicators")}">
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
          <a class="button button--primary" href="#/projects/new" data-i18n="dashboard.newProject">${t("dashboard.newProject")}</a>
          <a class="button" href="#/clients" data-i18n="nav.clients">${t("nav.clients")}</a>
          <a class="button" href="#/commercial" data-i18n="nav.commercial">${t("nav.commercial")}</a>
          <a class="button" href="#/financial" data-i18n="nav.financial">${t("nav.financial")}</a>
          <a class="button" href="#/cms">CMS</a>
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

      <article class="panel dash-panel--finance" aria-labelledby="dash-finance-title">
        ${panelHead(t("dashboard.financialSnapshot"), t("dashboard.revenueAgainstExpenses"), "dash-finance-title", textLink("#/financial", t("dashboard.openFinancial")))}
        <div data-finance>${renderFinancial(DEFAULT_PERIOD)}</div>
      </article>

      <article class="panel dash-panel--commercial" aria-labelledby="dash-commercial-title">
        ${panelHead(t("dashboard.commercialPipeline"), t("dashboard.opportunitiesByStage"), "dash-commercial-title", textLink("#/commercial", t("dashboard.openCommercial")))}
        ${renderPipeline()}
      </article>

      <article class="panel dash-panel--followups" aria-labelledby="dash-followups-title">
        ${panelHead(t("dashboard.followUps"), t("dashboard.peopleToContactNext"), "dash-followups-title")}
        ${renderQueue(followUps({ clients: demoClients, opportunities: demoOpportunities }), t("dashboard.noFollowUps"))}
      </article>

      <article class="panel dash-panel--activity" aria-labelledby="dash-activity-title">
        ${panelHead(t("dashboard.recentActivity"), t("dashboard.administrativeLog"), "dash-activity-title", textLink("#/logs", t("dashboard.viewAllLogs")))}
        <div class="activity-list" data-activity aria-busy="true">
          <p class="empty-inline">${t("common.loading")}...</p>
        </div>
      </article>

      <article class="panel dash-panel--operations" aria-labelledby="dash-operations-title">
        ${panelHead(t("operations.title"), t("operations.intro"), "dash-operations-title")}
        <div class="dash-operations" data-operations aria-live="polite" aria-busy="true">
          ${renderOperations({ status: LOADING, data: null, error: null })}
        </div>
      </article>

      <article class="panel dash-panel--health" aria-labelledby="dash-health-title">
        ${panelHead(t("dashboard.systemHealth"), t("dashboard.adminAndWebsiteState"), "dash-health-title", textLink("#/cms", t("dashboard.openCms")))}
        <div class="ops-figures dash-health" data-health aria-busy="true">
          ${renderHealth({ projects: [], projectsOk: false, activityOk: false })}
        </div>
      </article>
    </div>
  `,
  afterRender: async () => {
    const financeEl = document.querySelector("[data-finance]");
    const periodEl = document.querySelector("[data-dash-period]");

    periodEl?.addEventListener("change", () => {
      if (!financeEl?.isConnected) return;
      financeEl.innerHTML = renderFinancial(periodEl.value);
    });

    // One failing query must never blank the Dashboard: the demo-backed panels
    // are already on screen, and each real block resolves independently.
    const [projectsResult, activityResult] = await Promise.allSettled([
      getProjects(),
      getActivityWithStatus({ limit: 6 }),
    ]);

    const attentionEl = document.querySelector("[data-attention]");
    const pulseEl = document.querySelector("[data-pulse]");
    const activityEl = document.querySelector("[data-activity]");
    const healthEl = document.querySelector("[data-health]");
    if (!pulseEl?.isConnected) return;

    const projectsOk = projectsResult.status === "fulfilled";
    const projects = projectsOk ? projectsResult.value : [];

    // An outage and an empty log are different facts: getActivityWithStatus()
    // reports the read failure that getActivity() deliberately swallows.
    const activity = activityResult.status === "fulfilled" ? activityResult.value : { items: [], ok: false };
    const activityOk = activity.ok;
    const entries = activity.items.slice(0, 6);

    // Everything below renders from the two results already in hand. A locale
    // change replays this, so the Dashboard re-reads in the other language
    // without issuing a single new query.
    function paintData() {
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

    // The selected period is read back from the live control, so switching
    // locale keeps whatever range the user had chosen.
    onLocaleChange(pulseEl, () => {
      paintData();
      financeEl.innerHTML = renderFinancial(periodEl.value);
    });

    // The automation API is optional and slower than the local reads, so it is
    // resolved on its own. Nothing above waits for it and a failure here cannot
    // reach the rest of the Dashboard.
    const operationsEl = document.querySelector("[data-operations]");
    let operationsState = { status: LOADING, data: null, error: null };

    function paintOperations() {
      if (!operationsEl?.isConnected) return;
      operationsEl.innerHTML = renderOperations(operationsState);
      operationsEl.toggleAttribute("aria-busy", operationsState.status === LOADING);
    }

    overviewResource
      .read()
      .then((state) => {
        operationsState = state;
        paintOperations();
      })
      .catch(() => {
        operationsState = { status: ERROR, data: null, error: null };
        paintOperations();
      });

    if (operationsEl) onLocaleChange(operationsEl, paintOperations);

    attentionEl?.removeAttribute("aria-busy");
    pulseEl.removeAttribute("aria-busy");
    activityEl?.removeAttribute("aria-busy");
    healthEl?.removeAttribute("aria-busy");
  },
};
