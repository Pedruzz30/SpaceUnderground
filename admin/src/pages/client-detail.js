import { badge, badgeType } from "../components/badge.js";
import { bindTabs } from "../components/tabs.js";
import { findDemoClient, demoTransactions } from "../data/operations-demo.js";
import { formatCurrency, formatFullDate, formatRelativeDay, formatSignedCurrency, formatDayMonth } from "../utils/format.js";
import { escapeHtml } from "../utils/html.js";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "projects", label: "Projects" },
  { id: "commercial", label: "Commercial" },
  { id: "financial", label: "Financial" },
  { id: "files", label: "Files" },
  { id: "activity", label: "Activity" },
];

function figure(label, value, accent = false) {
  return `
    <div>
      <span>${escapeHtml(label)}</span>
      <strong${accent ? ' class="is-accent"' : ""}>${escapeHtml(value)}</strong>
    </div>
  `;
}

function projectRow(project) {
  return `
    <div class="ops-row">
      <span class="ops-row__primary">
        <strong>${escapeHtml(project.name)}</strong>
      </span>
      <span data-label="Status">${badge(project.status, badgeType(project.status))}</span>
    </div>
  `;
}

function projectList(client) {
  if (!client.projects.length) return '<p class="empty-inline">No projects linked to this client yet.</p>';
  return `<div class="ops-table client-projects">${client.projects.map(projectRow).join("")}</div>`;
}

function projectCounts(client) {
  const active = client.projects.filter((project) => project.status === "ACTIVE").length;
  const completed = client.projects.filter((project) => project.status === "COMPLETED").length;
  return { active, completed };
}

function activityList(client) {
  if (!client.activity.length) return '<p class="empty-inline">No activity recorded yet.</p>';
  return `
    <div class="activity-list">
      ${client.activity
        .map(
          (entry) => `
            <div>
              <span></span>
              <strong>${escapeHtml(entry.title)}</strong>
              <p>${escapeHtml(entry.detail)}</p>
              <small>${escapeHtml(formatRelativeDay(entry.at))}</small>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function amountClass(transaction) {
  if (transaction.status === "PENDING") return "ops-amount--neutral";
  return transaction.amount >= 0 ? "ops-amount--positive" : "ops-amount--negative";
}

function clientLedger(client) {
  const rows = demoTransactions.filter((transaction) => transaction.clientId === client.id);
  if (!rows.length) return '<p class="empty-inline">No transactions for this client yet.</p>';

  return `
    <div class="ops-table client-ledger">
      ${rows
        .map(
          (transaction) => `
            <div class="ops-row">
              <span class="ops-meta" data-label="Date">${escapeHtml(formatDayMonth(transaction.date))}</span>
              <span class="ops-row__primary">
                <strong>${escapeHtml(transaction.description)}</strong>
                <small>${escapeHtml(transaction.type)}</small>
              </span>
              <span data-label="Status">${badge(transaction.status, badgeType(transaction.status))}</span>
              <span class="ops-amount ${amountClass(transaction)}" data-label="Value">${escapeHtml(
                transaction.status === "PENDING"
                  ? formatCurrency(Math.abs(transaction.amount))
                  : formatSignedCurrency(transaction.amount),
              )}</span>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function tabList() {
  return `
    <div class="tabs" role="tablist" aria-label="Client sections">
      ${TABS.map(
        (tab, index) => `
          <button type="button" role="tab" id="client-tab-${tab.id}" aria-selected="${index === 0}"
            aria-controls="client-panel-${tab.id}" tabindex="${index === 0 ? 0 : -1}">${tab.label}</button>
        `,
      ).join("")}
    </div>
  `;
}

function panel(id, content) {
  const index = TABS.findIndex((tab) => tab.id === id);
  return `
    <div class="tab-panel" id="client-panel-${id}" role="tabpanel" aria-labelledby="client-tab-${id}"${index === 0 ? "" : " hidden"}>
      ${content}
    </div>
  `;
}

function overviewPanel(client) {
  const counts = projectCounts(client);

  return panel(
    "overview",
    `
      <div class="ops-panel-grid">
        <article class="panel">
          <header class="panel__head">
            <div>
              <span>CLIENT INFORMATION</span>
              <h3>Record</h3>
            </div>
          </header>
          <div class="ops-figures">
            ${figure("Reference", `CLIENT / ${client.code}`)}
            ${figure("Status", client.status)}
            ${figure("Total value", formatCurrency(client.totalValue), true)}
          </div>
        </article>

        <article class="panel">
          <header class="panel__head">
            <div>
              <span>PROJECTS</span>
              <h3>Current projects</h3>
            </div>
          </header>
          <div class="ops-figures">
            ${figure("Active", String(counts.active), true)}
            ${figure("Completed", String(counts.completed))}
          </div>
        </article>

        <article class="panel">
          <header class="panel__head">
            <div>
              <span>COMMERCIAL</span>
              <h3>Commercial summary</h3>
            </div>
          </header>
          <div class="ops-figures">
            ${figure("Contracted", formatCurrency(client.commercial.contracted), true)}
            ${figure("Open proposals", String(client.commercial.openProposals))}
          </div>
        </article>

        <article class="panel">
          <header class="panel__head">
            <div>
              <span>FINANCIAL</span>
              <h3>Financial summary</h3>
            </div>
          </header>
          <div class="ops-figures">
            ${figure("Received", formatCurrency(client.financial.received), true)}
            ${figure("Pending", formatCurrency(client.financial.pending))}
          </div>
        </article>

        <article class="panel panel--wide">
          <header class="panel__head">
            <div>
              <span>RECENT ACTIVITY</span>
              <h3>Client timeline</h3>
            </div>
          </header>
          ${activityList(client)}
        </article>
      </div>
    `,
  );
}

function renderClient(client) {
  const counts = projectCounts(client);

  return `
    <section class="page-heading page-heading--split">
      <div>
        <span>CLIENT / ${escapeHtml(client.code)}</span>
        <div class="client-heading__title">
          <h2>${escapeHtml(client.name)}</h2>
          ${badge(client.status, badgeType(client.status))}
        </div>
        <p>${escapeHtml(client.company || "Independent")} · ${counts.active} active, ${counts.completed} completed</p>
      </div>
      <div class="heading-actions">
        <a class="button" href="#/clients">All clients</a>
      </div>
    </section>

    <div class="meta-grid">
      <div><span>Email</span><strong>${escapeHtml(client.email)}</strong></div>
      <div><span>Phone</span><strong>${escapeHtml(client.phone || "—")}</strong></div>
      <div><span>Company</span><strong>${escapeHtml(client.company || "—")}</strong></div>
      <div><span>Last contact</span><strong>${escapeHtml(formatRelativeDay(client.lastContactAt))}</strong></div>
      <div><span>Client since</span><strong>${escapeHtml(client.since ? formatFullDate(client.since) : "—")}</strong></div>
    </div>

    <section class="client-detail" data-client-detail>
      ${tabList()}
      ${overviewPanel(client)}
      ${panel(
        "projects",
        `
          <div class="ops-figures">
            ${figure("Active", String(counts.active), true)}
            ${figure("Completed", String(counts.completed))}
            ${figure("Total", String(client.projects.length))}
          </div>
          ${projectList(client)}
          <p class="ops-note">Portfolio cases are managed in the CMS · projects workspace</p>
        `,
      )}
      ${panel(
        "commercial",
        `
          <div class="ops-figures">
            ${figure("Contracted", formatCurrency(client.commercial.contracted), true)}
            ${figure("Open proposals", String(client.commercial.openProposals))}
          </div>
          <p class="empty-inline">Opportunity history for this client will be listed here once the commercial backend exists.</p>
        `,
      )}
      ${panel(
        "financial",
        `
          <div class="ops-figures">
            ${figure("Received", formatCurrency(client.financial.received), true)}
            ${figure("Pending", formatCurrency(client.financial.pending))}
          </div>
          ${clientLedger(client)}
        `,
      )}
      ${panel(
        "files",
        '<p class="empty-inline">Contracts, briefings and deliverables will be attached here once client storage is defined.</p>',
      )}
      ${panel("activity", activityList(client))}
    </section>

    <p class="ops-note ops-note--spaced">Presentation data · client records are not persisted yet</p>
  `;
}

function renderMissing(id) {
  return `
    <section class="empty-state">
      <span>CLIENT / ${escapeHtml(id ?? "—")}</span>
      <h2>Client not found</h2>
      <p>This client does not exist in the operations directory.</p>
      <a class="button" href="#/clients">Back to clients</a>
    </section>
  `;
}

export const clientDetailPage = {
  title: "Client",
  breadcrumb: "OPERATIONS / CLIENTS / RECORD",
  render: ({ id }) => {
    const client = findDemoClient(id);
    return client ? renderClient(client) : renderMissing(id);
  },
  afterRender: () => {
    bindTabs(document.querySelector("[data-client-detail]"));
  },
};
