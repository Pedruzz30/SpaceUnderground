import { badge, badgeType } from "../components/badge.js";
import { statCard } from "../components/stat-card.js";
import { bindTabs } from "../components/tabs.js";
import { demoTransactions } from "../data/operations-demo.js";
import { t } from "../i18n/index.js";
import { financialSummary, openReceivables, settledExpenses, settledIncome } from "../utils/financial-metrics.js";
import { formatCurrency, formatDayMonth, formatSignedCurrency } from "../utils/format.js";
import { escapeHtml } from "../utils/html.js";

const TABS = [
  { id: "overview", labelKey: "financial.overview" },
  { id: "income", labelKey: "financial.income" },
  { id: "expenses", labelKey: "financial.expenses" },
  { id: "receivables", labelKey: "financial.receivables" },
  { id: "reports", labelKey: "financial.reports" },
];

function renderMetrics() {
  const summary = financialSummary(demoTransactions);

  return `
    ${statCard({ label: t("financial.revenue"), value: formatCurrency(summary.revenue), detail: t("financial.revenueDetail") })}
    ${statCard({ label: t("financial.expenses"), value: formatCurrency(summary.expenses), detail: t("financial.expensesDetail") })}
    ${statCard({ label: t("financial.result"), value: formatCurrency(summary.result), detail: t("financial.resultDetail") })}
    ${statCard({ label: t("financial.toReceive"), value: formatCurrency(summary.toReceive), detail: t("financial.toReceiveDetail") })}
  `;
}

// Pending receivables are money that has not moved yet, so they stay neutral
// instead of claiming a colour the ledger reserves for settled amounts.
function amountCell(transaction) {
  if (transaction.status === "PENDING") {
    return `<span class="ops-amount ops-amount--neutral" data-label="${t("financial.value")}">${escapeHtml(formatCurrency(Math.abs(transaction.amount)))}</span>`;
  }

  const tone = transaction.amount >= 0 ? "positive" : "negative";
  return `<span class="ops-amount ops-amount--${tone}" data-label="${t("financial.value")}">${escapeHtml(formatSignedCurrency(transaction.amount))}</span>`;
}

function clientCell(transaction) {
  if (!transaction.client) return `<span class="ops-meta" data-label="${t("common.client")}" data-column="client">—</span>`;
  if (!transaction.clientId) return `<span class="ops-meta" data-label="${t("common.client")}" data-column="client">${escapeHtml(transaction.client)}</span>`;
  return `
    <span data-label="${t("common.client")}" data-column="client">
      <a class="ops-link" href="#/clients/${encodeURIComponent(transaction.clientId)}">${escapeHtml(transaction.client)}</a>
    </span>
  `;
}

function transactionRow(transaction) {
  return `
    <div class="ops-row">
      <span class="ops-meta" data-label="${t("financial.date")}">${escapeHtml(formatDayMonth(transaction.date))}</span>
      <span class="ops-meta" data-label="${t("financial.type")}">${escapeHtml(transaction.type)}</span>
      <span class="ops-row__primary">
        <strong>${escapeHtml(transaction.description)}</strong>
      </span>
      ${clientCell(transaction)}
      <span data-label="${t("common.status")}">${badge(transaction.status, badgeType(transaction.status))}</span>
      ${amountCell(transaction)}
    </div>
  `;
}

function ledger(transactions, emptyMessage) {
  if (!transactions.length) return `<p class="empty-inline">${escapeHtml(emptyMessage)}</p>`;

  return `
    <div class="ops-table-scroll">
      <div class="ops-table ledger-table">
        <div class="ops-table__head" aria-hidden="true">
          <span>${t("financial.date").toUpperCase()}</span><span>${t("financial.type").toUpperCase()}</span><span>${t("financial.description").toUpperCase()}</span><span>${t("common.client").toUpperCase()}</span><span>${t("common.status").toUpperCase()}</span><span>${t("financial.value").toUpperCase()}</span>
        </div>
        ${transactions.map(transactionRow).join("")}
      </div>
    </div>
  `;
}

function panel(id, content) {
  const index = TABS.findIndex((tab) => tab.id === id);
  return `
    <div class="tab-panel" id="financial-panel-${id}" role="tabpanel" aria-labelledby="financial-tab-${id}"${index === 0 ? "" : " hidden"}>
      ${content}
    </div>
  `;
}

function totalOf(transactions) {
  return transactions.reduce((total, transaction) => total + Math.abs(transaction.amount), 0);
}

function figures(entries) {
  return `
    <div class="ops-figures">
      ${entries
        .map(
          ([label, value, accent]) => `
            <div>
              <span>${escapeHtml(label)}</span>
              <strong${accent ? ' class="is-accent"' : ""}>${escapeHtml(value)}</strong>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

export const financialPage = {
  title: () => t("financial.title"),
  breadcrumb: () => t("financial.breadcrumb"),
  render: () => {
    const income = settledIncome(demoTransactions);
    const expenses = settledExpenses(demoTransactions);
    const receivables = openReceivables(demoTransactions);

    return `
      <section class="page-heading">
        <span>${t("financial.eyebrow")}</span>
        <h2>${t("financial.heading")}</h2>
        <p>${t("financial.intro")}</p>
      </section>

      <section class="stats-grid stats-grid--quad" aria-label="${t("financial.summary")}">
        ${renderMetrics()}
      </section>

      <section data-financial>
        <div class="tabs" role="tablist" aria-label="${t("financial.sections")}">
          ${TABS.map(
            (tab, index) => `
              <button type="button" role="tab" id="financial-tab-${tab.id}" aria-selected="${index === 0}"
                aria-controls="financial-panel-${tab.id}" tabindex="${index === 0 ? 0 : -1}">${t(tab.labelKey)}</button>
            `,
          ).join("")}
        </div>

        ${panel(
          "overview",
          `
            <h3 class="ops-subtitle">${t("financial.recentTransactions")}</h3>
            ${ledger(demoTransactions, t("financial.noTransactions"))}
          `,
        )}
        ${panel(
          "income",
          `
            ${figures([[t("financial.entries"), String(income.length)], [t("financial.total"), formatCurrency(totalOf(income)), true]])}
            ${ledger(income, t("financial.noIncome"))}
          `,
        )}
        ${panel(
          "expenses",
          `
            ${figures([[t("financial.entries"), String(expenses.length)], [t("financial.total"), formatCurrency(totalOf(expenses)), true]])}
            ${ledger(expenses, t("financial.noExpenses"))}
          `,
        )}
        ${panel(
          "receivables",
          `
            ${figures([[t("financial.open"), String(receivables.length)], [t("financial.total"), formatCurrency(totalOf(receivables)), true]])}
            ${ledger(receivables, t("financial.nothingToReceive"))}
          `,
        )}
        ${panel(
          "reports",
          `<p class="empty-inline">${t("financial.reportsSoon")}</p>`,
        )}
      </section>

      <p class="ops-note ops-note--spaced">${t("financial.note")}</p>
    `;
  },
  afterRender: () => {
    bindTabs(document.querySelector("[data-financial]"));
  },
};
