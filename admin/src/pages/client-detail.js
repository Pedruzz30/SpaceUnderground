import { badge, badgeType } from "../components/badge.js";
import { bindTabs } from "../components/tabs.js";
import { findDemoClient, demoTransactions } from "../data/operations-demo.js";
import { onLocaleChange, t } from "../i18n/index.js";
import { formatCurrency, formatFullDate, formatRelativeDay, formatSignedCurrency, formatDayMonth } from "../utils/format.js";
import { escapeHtml } from "../utils/html.js";

const TABS = [
  { id: "overview", labelKey: "clientDetail.tabOverview" },
  { id: "projects", labelKey: "clientDetail.tabProjects" },
  { id: "commercial", labelKey: "clientDetail.tabCommercial" },
  { id: "financial", labelKey: "clientDetail.tabFinancial" },
  { id: "files", labelKey: "clientDetail.tabFiles" },
  { id: "activity", labelKey: "clientDetail.tabActivity" },
];

// Every static label carries a data-i18n key, so a locale change is handled by
// applyStaticTranslations() alone: the panels are never re-rendered and the
// selected tab, scroll position and focus all survive untouched.
function figure(labelKey, value, accent = false) {
  return `
    <div>
      <span data-i18n="${labelKey}">${escapeHtml(t(labelKey))}</span>
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
      <span data-label="${t("common.status")}">${badge(project.status, badgeType(project.status))}</span>
    </div>
  `;
}

function projectList(client) {
  if (!client.projects.length) {
    return `<p class="empty-inline" data-i18n="clientDetail.noProjectsLinked">${t("clientDetail.noProjectsLinked")}</p>`;
  }
  return `<div class="ops-table client-projects">${client.projects.map(projectRow).join("")}</div>`;
}

function projectCounts(client) {
  const active = client.projects.filter((project) => project.status === "ACTIVE").length;
  const completed = client.projects.filter((project) => project.status === "COMPLETED").length;
  return { active, completed };
}

// Activity entries are free historical notes written by the team, so they are
// shown as recorded rather than translated.
function activityList(client) {
  if (!client.activity.length) {
    return `<p class="empty-inline" data-i18n="clientDetail.noActivity">${t("clientDetail.noActivity")}</p>`;
  }
  return `
    <div class="activity-list">
      ${client.activity
        .map(
          (entry) => `
            <div>
              <span></span>
              <strong>${escapeHtml(entry.title)}</strong>
              <p>${escapeHtml(entry.detail)}</p>
              <small data-relative-date="${escapeHtml(entry.at)}">${escapeHtml(formatRelativeDay(entry.at))}</small>
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
  if (!rows.length) {
    return `<p class="empty-inline" data-i18n="clientDetail.noTransactions">${t("clientDetail.noTransactions")}</p>`;
  }

  return `
    <div class="ops-table client-ledger">
      ${rows
        .map(
          (transaction) => `
            <div class="ops-row">
              <span class="ops-meta" data-label="${t("clientDetail.columnDate")}" data-day-month="${escapeHtml(transaction.date)}">${escapeHtml(formatDayMonth(transaction.date))}</span>
              <span class="ops-row__primary">
                <strong>${escapeHtml(transaction.description)}</strong>
                <small>${escapeHtml(transaction.type)}</small>
              </span>
              <span data-label="${t("common.status")}">${badge(transaction.status, badgeType(transaction.status))}</span>
              <span class="ops-amount ${amountClass(transaction)}" data-label="${t("clientDetail.columnValue")}" data-currency="${transaction.amount}" data-currency-mode="${transaction.status === "PENDING" ? "absolute" : "signed"}">${escapeHtml(
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
    <div class="tabs" role="tablist" aria-label="${t("clientDetail.sections")}" data-i18n-aria-label="clientDetail.sections">
      ${TABS.map(
        (tab, index) => `
          <button type="button" role="tab" id="client-tab-${tab.id}" aria-selected="${index === 0}"
            aria-controls="client-panel-${tab.id}" tabindex="${index === 0 ? 0 : -1}" data-i18n="${tab.labelKey}">${t(tab.labelKey)}</button>
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

function panelHead(eyebrowKey, headingKey) {
  return `
    <header class="panel__head">
      <div>
        <span data-i18n="${eyebrowKey}">${t(eyebrowKey)}</span>
        <h3 data-i18n="${headingKey}">${t(headingKey)}</h3>
      </div>
    </header>
  `;
}

function overviewPanel(client) {
  const counts = projectCounts(client);

  return panel(
    "overview",
    `
      <div class="ops-panel-grid">
        <article class="panel">
          ${panelHead("clientDetail.clientInformation", "clientDetail.record")}
          <div class="ops-figures">
            ${figure("clientDetail.reference", `${t("clients.clientPrefix")} / ${client.code}`)}
            ${figure("common.status", client.status)}
            ${figure("clientDetail.totalValue", formatCurrency(client.totalValue), true)}
          </div>
        </article>

        <article class="panel">
          ${panelHead("clientDetail.projects", "clientDetail.currentProjects")}
          <div class="ops-figures">
            ${figure("clientDetail.active", String(counts.active), true)}
            ${figure("clientDetail.completed", String(counts.completed))}
          </div>
        </article>

        <article class="panel">
          ${panelHead("clientDetail.commercial", "clientDetail.commercialSummary")}
          <div class="ops-figures">
            ${figure("clientDetail.contracted", formatCurrency(client.commercial.contracted), true)}
            ${figure("clientDetail.openProposals", String(client.commercial.openProposals))}
          </div>
        </article>

        <article class="panel">
          ${panelHead("clientDetail.financial", "clientDetail.financialSummary")}
          <div class="ops-figures">
            ${figure("clientDetail.received", formatCurrency(client.financial.received), true)}
            ${figure("clientDetail.pending", formatCurrency(client.financial.pending))}
          </div>
        </article>

        <article class="panel panel--wide">
          ${panelHead("clientDetail.recentActivity", "clientDetail.clientTimeline")}
          ${activityList(client)}
        </article>
      </div>
    `,
  );
}

// Client name, company, email and phone are the record itself and read the same
// in both locales.
function renderClient(client) {
  const counts = projectCounts(client);

  return `
    <section class="page-heading page-heading--split">
      <div>
        <span>${t("clients.clientPrefix")} / ${escapeHtml(client.code)}</span>
        <div class="client-heading__title">
          <h2>${escapeHtml(client.name)}</h2>
          ${badge(client.status, badgeType(client.status))}
        </div>
        <p data-client-summary>${escapeHtml(client.company || t("clientDetail.independent"))} · ${escapeHtml(
          t("clientDetail.summaryLine", { active: counts.active, completed: counts.completed }),
        )}</p>
      </div>
      <div class="heading-actions">
        <a class="button" href="#/clients" data-i18n="clientDetail.allClients">${t("clientDetail.allClients")}</a>
      </div>
    </section>

    <div class="meta-grid">
      <div><span data-i18n="clientDetail.email">${t("clientDetail.email")}</span><strong>${escapeHtml(client.email)}</strong></div>
      <div><span data-i18n="clientDetail.phone">${t("clientDetail.phone")}</span><strong>${escapeHtml(client.phone || "—")}</strong></div>
      <div><span data-i18n="clientDetail.company">${t("clientDetail.company")}</span><strong>${escapeHtml(client.company || "—")}</strong></div>
      <div><span data-i18n="clientDetail.lastContact">${t("clientDetail.lastContact")}</span><strong data-relative-date="${escapeHtml(client.lastContactAt)}">${escapeHtml(formatRelativeDay(client.lastContactAt))}</strong></div>
      <div><span data-i18n="clientDetail.clientSince">${t("clientDetail.clientSince")}</span><strong${client.since ? ` data-full-date="${escapeHtml(client.since)}"` : ""}>${escapeHtml(client.since ? formatFullDate(client.since) : "—")}</strong></div>
    </div>

    <section class="client-detail" data-client-detail>
      ${tabList()}
      ${overviewPanel(client)}
      ${panel(
        "projects",
        `
          <div class="ops-figures">
            ${figure("clientDetail.active", String(counts.active), true)}
            ${figure("clientDetail.completed", String(counts.completed))}
            ${figure("clientDetail.total", String(client.projects.length))}
          </div>
          ${projectList(client)}
          <p class="ops-note" data-i18n="clientDetail.portfolioNote">${t("clientDetail.portfolioNote")}</p>
        `,
      )}
      ${panel(
        "commercial",
        `
          <div class="ops-figures">
            ${figure("clientDetail.contracted", formatCurrency(client.commercial.contracted), true)}
            ${figure("clientDetail.openProposals", String(client.commercial.openProposals))}
          </div>
          <p class="empty-inline" data-i18n="clientDetail.commercialNote">${t("clientDetail.commercialNote")}</p>
        `,
      )}
      ${panel(
        "financial",
        `
          <div class="ops-figures">
            ${figure("clientDetail.received", formatCurrency(client.financial.received), true)}
            ${figure("clientDetail.pending", formatCurrency(client.financial.pending))}
          </div>
          ${clientLedger(client)}
        `,
      )}
      ${panel(
        "files",
        `<p class="empty-inline" data-i18n="clientDetail.filesNote">${t("clientDetail.filesNote")}</p>`,
      )}
      ${panel("activity", activityList(client))}
    </section>

    <p class="ops-note ops-note--spaced" data-i18n="clients.presentationNote">${t("clients.presentationNote")}</p>
  `;
}

function renderMissing(id) {
  return `
    <section class="empty-state">
      <span>${t("clients.clientPrefix")} / ${escapeHtml(id ?? "—")}</span>
      <h2 data-i18n="clientDetail.notFound">${t("clientDetail.notFound")}</h2>
      <p data-i18n="clientDetail.notFoundBody">${t("clientDetail.notFoundBody")}</p>
      <a class="button" href="#/clients" data-i18n="clientDetail.backToClients">${t("clientDetail.backToClients")}</a>
    </section>
  `;
}

export const clientDetailPage = {
  title: () => t("clientDetail.title"),
  breadcrumb: () => t("clientDetail.breadcrumb"),
  render: ({ id }) => {
    const client = findDemoClient(id);
    return client ? renderClient(client) : renderMissing(id);
  },
  afterRender: ({ id }) => {
    const root = document.querySelector("[data-client-detail]");
    bindTabs(root);

    const client = findDemoClient(id);
    if (!client) return;

    // Only the numeric summary line has to be rebuilt by hand; every other label
    // is marked up and handled by applyStaticTranslations().
    onLocaleChange(document.querySelector(".page-heading"), () => {
      const counts = projectCounts(client);
      const summary = document.querySelector("[data-client-summary]");
      if (summary) {
        summary.textContent = `${client.company || t("clientDetail.independent")} · ${t("clientDetail.summaryLine", {
          active: counts.active,
          completed: counts.completed,
        })}`;
      }
    });
  },
};
