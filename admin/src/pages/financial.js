import { badge, badgeType } from "../components/badge.js";
import { statCard } from "../components/stat-card.js";
import { bindTabs } from "../components/tabs.js";
import { demoTransactions } from "../data/operations-demo.js";
import { financialSummary, openReceivables, settledExpenses, settledIncome } from "../utils/financial-metrics.js";
import { formatCurrency, formatDayMonth, formatSignedCurrency } from "../utils/format.js";
import { escapeHtml } from "../utils/html.js";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "income", label: "Income" },
  { id: "expenses", label: "Expenses" },
  { id: "receivables", label: "Receivables" },
  { id: "reports", label: "Reports" },
];

function renderMetrics() {
  const summary = financialSummary(demoTransactions);

  return `
    ${statCard({ label: "REVENUE", value: formatCurrency(summary.revenue), detail: "Confirmed income" })}
    ${statCard({ label: "EXPENSES", value: formatCurrency(summary.expenses), detail: "Operational costs" })}
    ${statCard({ label: "RESULT", value: formatCurrency(summary.result), detail: "Revenue minus expenses" })}
    ${statCard({ label: "TO RECEIVE", value: formatCurrency(summary.toReceive), detail: "Open receivables" })}
  `;
}

// Pending receivables are money that has not moved yet, so they stay neutral
// instead of claiming a colour the ledger reserves for settled amounts.
function amountCell(transaction) {
  if (transaction.status === "PENDING") {
    return `<span class="ops-amount ops-amount--neutral" data-label="Value">${escapeHtml(formatCurrency(Math.abs(transaction.amount)))}</span>`;
  }

  const tone = transaction.amount >= 0 ? "positive" : "negative";
  return `<span class="ops-amount ops-amount--${tone}" data-label="Value">${escapeHtml(formatSignedCurrency(transaction.amount))}</span>`;
}

function clientCell(transaction) {
  if (!transaction.client) return '<span class="ops-meta" data-label="Client" data-column="client">—</span>';
  if (!transaction.clientId) return `<span class="ops-meta" data-label="Client" data-column="client">${escapeHtml(transaction.client)}</span>`;
  return `
    <span data-label="Client" data-column="client">
      <a class="ops-link" href="#/clients/${encodeURIComponent(transaction.clientId)}">${escapeHtml(transaction.client)}</a>
    </span>
  `;
}

function transactionRow(transaction) {
  return `
    <div class="ops-row">
      <span class="ops-meta" data-label="Date">${escapeHtml(formatDayMonth(transaction.date))}</span>
      <span class="ops-meta" data-label="Type">${escapeHtml(transaction.type)}</span>
      <span class="ops-row__primary">
        <strong>${escapeHtml(transaction.description)}</strong>
      </span>
      ${clientCell(transaction)}
      <span data-label="Status">${badge(transaction.status, badgeType(transaction.status))}</span>
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
          <span>DATE</span><span>TYPE</span><span>DESCRIPTION</span><span>CLIENT</span><span>STATUS</span><span>VALUE</span>
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
  title: "Financial",
  breadcrumb: "OPERATIONS / FINANCIAL",
  render: () => {
    const income = settledIncome(demoTransactions);
    const expenses = settledExpenses(demoTransactions);
    const receivables = openReceivables(demoTransactions);

    return `
      <section class="page-heading">
        <span>FINANCIAL</span>
        <h2>Financial control.</h2>
        <p>Track revenue, expenses and receivables.</p>
      </section>

      <section class="stats-grid stats-grid--quad" aria-label="Financial summary">
        ${renderMetrics()}
      </section>

      <section data-financial>
        <div class="tabs" role="tablist" aria-label="Financial sections">
          ${TABS.map(
            (tab, index) => `
              <button type="button" role="tab" id="financial-tab-${tab.id}" aria-selected="${index === 0}"
                aria-controls="financial-panel-${tab.id}" tabindex="${index === 0 ? 0 : -1}">${tab.label}</button>
            `,
          ).join("")}
        </div>

        ${panel(
          "overview",
          `
            <h3 class="ops-subtitle">Recent transactions</h3>
            ${ledger(demoTransactions, "No transactions recorded yet.")}
          `,
        )}
        ${panel(
          "income",
          `
            ${figures([["Entries", String(income.length)], ["Total", formatCurrency(totalOf(income)), true]])}
            ${ledger(income, "No income recorded yet.")}
          `,
        )}
        ${panel(
          "expenses",
          `
            ${figures([["Entries", String(expenses.length)], ["Total", formatCurrency(totalOf(expenses)), true]])}
            ${ledger(expenses, "No expenses recorded yet.")}
          `,
        )}
        ${panel(
          "receivables",
          `
            ${figures([["Open", String(receivables.length)], ["Total", formatCurrency(totalOf(receivables)), true]])}
            ${ledger(receivables, "Nothing to receive right now.")}
          `,
        )}
        ${panel(
          "reports",
          '<p class="empty-inline">Monthly reports and exports arrive once the financial backend is in place.</p>',
        )}
      </section>

      <p class="ops-note ops-note--spaced">Presentation data · no financial records are persisted yet</p>
    `;
  },
  afterRender: () => {
    bindTabs(document.querySelector("[data-financial]"));
  },
};
