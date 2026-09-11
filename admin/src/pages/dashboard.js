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
import { getActivityWithStatus } from "../services/activity-service.js";
import { getProjects } from "../services/project-service.js";
import { describeError } from "../services/errors.js";
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
import { escapeHtml } from "../utils/html.js";

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
  if (sameDay) return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString(undefined, { month: "short", day: "2-digit" });
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
      label: "ACTIVE PROJECTS",
      value: activeEngagements(demoClients),
      detail: "Client engagements in delivery",
    })}
    ${statCard({
      label: "ACTIVE CLIENTS",
      value: activeClients(demoClients),
      detail: "Current relationships",
    })}
    ${statCard({
      label: "OPEN OPPORTUNITIES",
      value: openOpportunities(demoOpportunities),
      detail: "Still in the pipeline",
    })}
    ${statCard({
      label: "TO RECEIVE",
      value: escapeHtml(formatCurrency(pendingReceivables(demoTransactions))),
      detail: "Open receivables",
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
        <span class="dash-queue-item__detail">${escapeHtml(item.detail)}</span>
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
    ? '<p class="dash-inline-note">Checking project records…</p>'
    : projectsFailed
      ? '<p class="dash-inline-note dash-inline-note--warn">Project checks unavailable.</p>'
      : "";

  return `${renderQueue(items, "Nothing needs attention right now.")}${note}`;
}

/* ---------------------------------------------------------- project pulse */

function pulseRow(project) {
  return `
    <a class="ops-row ops-row--link" href="#/projects/${encodeURIComponent(project.id)}" data-pulse-row>
      <span class="ops-meta" data-label="Case">${escapeHtml(project.caseNumber)}</span>
      <span class="ops-row__primary">
        <strong>${escapeHtml(project.name || "Untitled project")}</strong>
        <small>${escapeHtml(project.category || "Uncategorised")}</small>
      </span>
      <span data-label="Status">${badge(project.status, badgeType(project.status))}</span>
      <span data-label="Editorial">${badge(project.editorialStatus, badgeType(project.editorialStatus))}</span>
      <span class="ops-meta" data-label="Updated">${escapeHtml(formatRelativeDay(project.updatedAt))}</span>
      <span class="ops-row__arrow" aria-hidden="true">&rarr;</span>
    </a>
  `;
}

function renderPulse(projects) {
  const recent = [...projects]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5);

  if (!recent.length) return '<p class="empty-inline">No projects yet. Create the first case to start the portfolio.</p>';

  return `
    <div class="ops-table dash-pulse">
      <div class="ops-table__head" aria-hidden="true">
        <span>CASE</span><span>PROJECT</span><span>STATUS</span><span>EDITORIAL</span><span>UPDATED</span><span></span>
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
              <span class="dash-pipeline__label">${escapeHtml(stage.label)}</span>
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
      <div><span>Open pipeline</span><strong>${summary.open}</strong></div>
      <div><span>High priority</span><strong class="is-accent">${summary.highPriority}</strong></div>
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
      <span>RESULT · ${escapeHtml(periodLabel(periodId).toUpperCase())}</span>
      <strong>${escapeHtml(formatCurrency(totals.result))}</strong>
    </p>

    <div class="dash-bars">
      <div class="dash-bar">
        <span class="dash-bar__label">Revenue</span>
        <span class="dash-bar__track">
          <span class="dash-bar__fill dash-bar__fill--in" style="--dash-fill:${barPercent(totals.revenue, max)}%"></span>
        </span>
        <span class="ops-amount ops-amount--positive">${escapeHtml(formatCurrency(totals.revenue))}</span>
      </div>
      <div class="dash-bar">
        <span class="dash-bar__label">Expenses</span>
        <span class="dash-bar__track">
          <span class="dash-bar__fill dash-bar__fill--out" style="--dash-fill:${barPercent(totals.expenses, max)}%"></span>
        </span>
        <span class="ops-amount ops-amount--negative">${escapeHtml(formatCurrency(totals.expenses))}</span>
      </div>
    </div>

    ${
      recent.length
        ? `<ul class="dash-ledger">${recent.map(ledgerLine).join("")}</ul>`
        : '<p class="empty-inline">No transactions in this period.</p>'
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
    ${healthTile("PUBLIC WEBSITE", "CONFIGURED", spaceStatus.detail)}
    ${healthTile("ADMIN DATA", status.label, `${status.detail} · ${DATA_SOURCE} source`, status.tone)}
    ${healthTile("PUBLISHED CASES", health ? String(health.published) : "—", health ? `${health.archived} archived` : "Project data unavailable", "", "published")}
    ${healthTile("DRAFT CASES", health ? String(health.drafts) : "—", health ? `${health.hidden} hidden` : "Project data unavailable", "", "drafts")}
    ${healthTile(
      "CONTENT ISSUES",
      health ? String(health.issues) : "—",
      health ? (health.issues ? "Editorial checks pending" : "Editorial checks clear") : "Project data unavailable",
      health && health.issues ? "warn" : "",
      "issues",
    )}
  `;
}

/* ------------------------------------------------------------------- page */

export const dashboardPage = {
  title: "Dashboard",
  breadcrumb: "OVERVIEW / DASHBOARD",
  render: () => `
    <section class="page-heading page-heading--split">
      <div>
        <span>COMMAND CENTER</span>
        <h2>Space Underground at a glance.</h2>
        <p>Operations, commercial activity, finance and system health in one view.</p>
      </div>
      <div class="heading-actions">
        <label class="dash-period">
          <span>Period</span>
          <select data-dash-period>
            ${PERIODS.map(
              (period) =>
                `<option value="${escapeHtml(period.id)}"${period.id === DEFAULT_PERIOD ? " selected" : ""}>${escapeHtml(period.label)}</option>`,
            ).join("")}
          </select>
        </label>
      </div>
    </section>

    <section class="stats-grid stats-grid--quad dash-kpis" aria-label="Primary indicators">
      ${renderKpis()}
    </section>

    <p class="ops-note dash-legend">Operational figures are presentation data · projects and activity come from the admin database · the period applies to the financial snapshot</p>

    <div class="dash-grid">
      <article class="panel dash-panel--attention" aria-labelledby="dash-attention-title">
        ${panelHead("NEEDS ATTENTION", "Items requiring action", "dash-attention-title")}
        <div data-attention aria-busy="true">
          ${renderAttention([], { pending: true })}
        </div>
      </article>

      <article class="panel dash-panel--actions" aria-labelledby="dash-actions-title">
        ${panelHead("QUICK ACTIONS", "Jump into work", "dash-actions-title")}
        <div class="dash-actions">
          <a class="button button--primary" href="#/projects/new">New Project</a>
          <a class="button" href="#/clients">Clients</a>
          <a class="button" href="#/commercial">Commercial</a>
          <a class="button" href="#/financial">Financial</a>
          <a class="button" href="#/cms">CMS</a>
        </div>
      </article>

      <article class="panel dash-panel--pulse" aria-labelledby="dash-pulse-title">
        ${panelHead("PROJECT PULSE", "Current project activity", "dash-pulse-title", textLink("#/projects", "View all projects"))}
        <div class="ops-table-scroll" data-pulse aria-busy="true">
          <div class="dash-skeleton"></div>
          <div class="dash-skeleton"></div>
          <div class="dash-skeleton"></div>
        </div>
      </article>

      <article class="panel dash-panel--finance" aria-labelledby="dash-finance-title">
        ${panelHead("FINANCIAL SNAPSHOT", "Revenue against expenses", "dash-finance-title", textLink("#/financial", "Open financial"))}
        <div data-finance>${renderFinancial(DEFAULT_PERIOD)}</div>
      </article>

      <article class="panel dash-panel--commercial" aria-labelledby="dash-commercial-title">
        ${panelHead("COMMERCIAL PIPELINE", "Opportunities by stage", "dash-commercial-title", textLink("#/commercial", "Open commercial"))}
        ${renderPipeline()}
      </article>

      <article class="panel dash-panel--followups" aria-labelledby="dash-followups-title">
        ${panelHead("FOLLOW UPS", "People to contact next", "dash-followups-title")}
        ${renderQueue(followUps({ clients: demoClients, opportunities: demoOpportunities }), "No follow ups queued.")}
      </article>

      <article class="panel dash-panel--activity" aria-labelledby="dash-activity-title">
        ${panelHead("RECENT ACTIVITY", "Administrative log", "dash-activity-title", textLink("#/logs", "View all logs"))}
        <div class="activity-list" data-activity aria-busy="true">
          <p class="empty-inline">Loading activity…</p>
        </div>
      </article>

      <article class="panel dash-panel--health" aria-labelledby="dash-health-title">
        ${panelHead("SYSTEM HEALTH", "Admin and website state", "dash-health-title", textLink("#/cms", "Open CMS"))}
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

    if (projectsOk) {
      attentionEl.innerHTML = renderAttention(projectChecks(projects));
      pulseEl.innerHTML = renderPulse(projects);
    } else {
      const message = describeError(projectsResult.reason, "Unable to load project data.");
      attentionEl.innerHTML = renderAttention([], { projectsFailed: true });
      pulseEl.innerHTML = `<p class="empty-inline">${escapeHtml(message)}</p>`;
    }

    // An outage and an empty log are different facts: getActivityWithStatus()
    // reports the read failure that getActivity() deliberately swallows.
    const activity = activityResult.status === "fulfilled" ? activityResult.value : { items: [], ok: false };
    const activityOk = activity.ok;
    const entries = activity.items.slice(0, 6);

    if (!activityOk) {
      activityEl.innerHTML = '<p class="empty-inline">Activity unavailable.</p>';
    } else if (!entries.length) {
      activityEl.innerHTML = '<p class="empty-inline">No recent activity yet.</p>';
    } else {
      activityEl.innerHTML = entries
        .map(
          (item) => `
            <div>
              <span></span>
              <strong>${escapeHtml(item.title || item.action || "Administrative event")}</strong>
              <p>${escapeHtml(item.detail || "No additional detail.")}</p>
              <small>${escapeHtml(activityTime(item.time))}</small>
            </div>
          `,
        )
        .join("");
    }

    healthEl.innerHTML = renderHealth({ projects, projectsOk, activityOk });

    attentionEl?.removeAttribute("aria-busy");
    pulseEl.removeAttribute("aria-busy");
    activityEl?.removeAttribute("aria-busy");
    healthEl?.removeAttribute("aria-busy");
  },
};
