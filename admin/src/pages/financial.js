import { confirmModal, openModal } from "../components/modal.js";
import { bindRowMenus, closeRowMenus } from "../components/row-menu.js";
import { bindTabs } from "../components/tabs.js";
import { showToast } from "../components/toast.js";
import { getLocale, onLocaleChange, plural, t } from "../i18n/index.js";
import { getClients } from "../services/client-service.js";
import { describeError } from "../services/errors.js";
import {
  cancelTransaction,
  createTransaction,
  deleteTransaction,
  duplicateTransaction,
  getTransactions,
  markTransactionPaid,
  MAX_INSTALLMENTS,
  newTransactionDefaults,
  reopenTransaction,
  sanitizeTransaction,
  updateTransaction,
  validateTransaction,
} from "../services/financial-service.js";
import { getProjects } from "../services/project-service.js";
import { csvCell, csvNumber, csvText, downloadCsv } from "../utils/csv.js";
import {
  byEffectiveDateDesc,
  categoriesFor,
  categoryBreakdown,
  daysOverdue,
  effectiveDate,
  FINANCIAL_PERIODS,
  financialSummary,
  isOverdue,
  monthlyCashFlow,
  parseAmount,
  periodRange,
  receivablesAging,
  revenueByClient,
  signedAmount,
  splitInstallments,
  todayKey,
  TRANSACTION_CATEGORIES,
  withinRange,
} from "../utils/financial-metrics.js";
import { formatCurrency, formatSignedCurrency } from "../utils/format.js";
import { escapeAttribute, escapeHtml } from "../utils/html.js";

const VIEWS = ["all", "income", "expense", "receivable", "payable", "overdue", "cancelled"];
// These show money that is open today, so the period does not narrow them: a
// receivable due next month is still owed now.
const OPEN_VIEWS = new Set(["receivable", "payable", "overdue"]);
const DEFAULT_PERIOD = "this_month";
const CASH_FLOW_MONTHS = 6;

/* ------------------------------------------------------------ helpers */

function matchesView(entry, view, now) {
  switch (view) {
    case "income":
      return entry.type === "INCOME" && entry.status !== "CANCELLED";
    case "expense":
      return entry.type === "EXPENSE" && entry.status !== "CANCELLED";
    case "receivable":
      return entry.type === "INCOME" && entry.status === "PENDING";
    case "payable":
      return entry.type === "EXPENSE" && entry.status === "PENDING";
    case "overdue":
      return isOverdue(entry, now);
    case "cancelled":
      return entry.status === "CANCELLED";
    default:
      return true;
  }
}

function matchesQuery(entry, query) {
  if (!query) return true;
  return [entry.description, entry.clientName, entry.projectName, entry.notes, t(`financial.categories.${entry.category}`)]
    .some((value) => String(value || "").toLowerCase().includes(query));
}

// A date key read as a local calendar day, never shifted by the timezone.
function dayDate(key) {
  return new Date(`${key}T00:00:00`);
}

function formatDay(key) {
  if (!key) return "—";
  return new Intl.DateTimeFormat(getLocale(), { day: "2-digit", month: "short" }).format(dayDate(key)).replace(".", "");
}

function monthLabel(key, style = "long") {
  const [year, month] = key.split("-").map(Number);
  return new Intl.DateTimeFormat(getLocale(), style === "long" ? { month: "long", year: "numeric" } : { month: "short" })
    .format(new Date(year, month - 1, 1))
    .replace(".", "");
}

function compactCurrency(value) {
  return new Intl.NumberFormat(getLocale(), {
    style: "currency",
    currency: "BRL",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function preciseCurrency(value) {
  return new Intl.NumberFormat(getLocale(), { style: "currency", currency: "BRL", minimumFractionDigits: 2 }).format(value);
}

// Amounts keep their cents on screen: a ledger that rounds R$ 99,90 to R$ 100
// cannot be reconciled against a bank statement.
function amountText(entry) {
  const format = (value) =>
    new Intl.NumberFormat(getLocale(), { style: "currency", currency: "BRL", minimumFractionDigits: entry.amount % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(value);
  if (entry.status !== "PAID") return format(entry.amount);
  const signed = signedAmount(entry);
  return `${signed >= 0 ? "+" : "-"} ${format(Math.abs(signed))}`;
}

function stateKey(entry, now) {
  return isOverdue(entry, now) ? "OVERDUE" : entry.status;
}

function stateBadge(entry, now) {
  const key = stateKey(entry, now);
  const tone = { PAID: "success", PENDING: "neutral", CANCELLED: "muted", OVERDUE: "danger" }[key];
  return `<span class="badge badge--${tone}">${escapeHtml(t(`financial.statuses.${key}`).toUpperCase())}</span>`;
}

function stateNote(entry, now) {
  if (entry.status === "PAID") return t("financial.paidOn", { date: formatDay(entry.paidAt) });
  if (entry.status === "CANCELLED") return t("financial.cancelledNote");
  if (isOverdue(entry, now)) return plural("financial.overdueBy", daysOverdue(entry, now));
  if (entry.dueDate === todayKey(now)) return t("financial.dueToday");
  return t("financial.dueOn", { date: formatDay(entry.dueDate) });
}

/* ------------------------------------------------------------ metrics */

function metricsMarkup(entries, range, now) {
  const scoped = financialSummary(entries.filter((entry) => withinRange(entry, range)), now);
  const open = financialSummary(entries, now);
  const metrics = [
    ["financial.metricRevenue", formatCurrency(scoped.revenue), ""],
    ["financial.metricExpenses", formatCurrency(scoped.expenses), ""],
    ["financial.metricResult", formatSignedCurrency(scoped.result), scoped.result < 0 ? "is-negative" : ""],
    ["financial.metricToReceive", formatCurrency(open.toReceive), ""],
    ["financial.metricToPay", formatCurrency(open.toPay), ""],
    ["financial.metricOverdue", formatCurrency(open.overdueReceivable + open.overduePayable), open.overdueCount ? "is-warn" : ""],
  ];
  return metrics
    .map(
      ([key, value, tone]) => `
        <div class="project-metric${tone ? ` ${tone}` : ""}">
          <strong>${escapeHtml(value)}</strong>
          <span>${escapeHtml(t(key))}</span>
        </div>
      `,
    )
    .join("");
}

/* ------------------------------------------------------------- ledger */

function entryMarkup(entry, now) {
  const state = stateKey(entry, now);
  const pending = entry.status === "PENDING";
  const meta = [
    `<span>${escapeHtml(t(`financial.categories.${entry.category}`))}</span>`,
    entry.clientName
      ? `<a href="#/clients/${encodeURIComponent(entry.clientId)}">${escapeHtml(entry.clientName)}</a>`
      : "",
    entry.projectName
      ? `<a href="#/projects/${encodeURIComponent(entry.projectRoute)}">${escapeHtml(entry.projectName)}</a>`
      : "",
  ].filter(Boolean);
  const day = dayDate(effectiveDate(entry) || todayKey(now));

  return `
    <article class="fin-entry fin-entry--${entry.type.toLowerCase()} fin-entry--${state.toLowerCase()}" data-transaction-id="${escapeAttribute(entry.id)}">
      <span class="fin-entry__date" aria-hidden="true">
        <b>${escapeHtml(String(day.getDate()).padStart(2, "0"))}</b>
        <small>${escapeHtml(new Intl.DateTimeFormat(getLocale(), { month: "short" }).format(day).replace(".", ""))}</small>
      </span>
      <span class="fin-entry__main">
        <strong>${escapeHtml(entry.description)}</strong>
        <span class="fin-entry__meta">${meta.join('<i aria-hidden="true">·</i>')}</span>
      </span>
      <span class="fin-entry__state">
        ${stateBadge(entry, now)}
        <small>${escapeHtml(stateNote(entry, now))}</small>
      </span>
      <span class="fin-entry__amount" data-label="${escapeAttribute(t(`financial.types.${entry.type}`))}">
        <span class="visually-hidden">${escapeHtml(t(`financial.types.${entry.type}`))}</span>${escapeHtml(amountText(entry))}
      </span>
      <span class="fin-entry__actions">
        ${pending ? `<button class="button button--compact fin-entry__settle" type="button" data-fin-action="pay" data-id="${escapeAttribute(entry.id)}">${escapeHtml(t("financial.markPaid"))}</button>` : ""}
        <span class="row-menu" data-row-menu>
          <button class="button button--compact row-menu__toggle" type="button" data-row-menu-toggle aria-expanded="false" aria-haspopup="true" aria-label="${escapeAttribute(t("financial.actions"))}">⋯</button>
          <span class="row-menu__panel" role="menu" hidden>
            <button type="button" role="menuitem" data-fin-action="edit" data-id="${escapeAttribute(entry.id)}">${escapeHtml(t("financial.edit"))}</button>
            <button type="button" role="menuitem" data-fin-action="duplicate" data-id="${escapeAttribute(entry.id)}">${escapeHtml(t("financial.duplicate"))}</button>
            ${
              pending
                ? `<button type="button" role="menuitem" data-fin-action="cancel" data-id="${escapeAttribute(entry.id)}">${escapeHtml(t("financial.cancelEntry"))}</button>`
                : `<button type="button" role="menuitem" data-fin-action="reopen" data-id="${escapeAttribute(entry.id)}">${escapeHtml(t("financial.reopen"))}</button>`
            }
            <button type="button" role="menuitem" class="row-menu__danger" data-fin-action="delete" data-id="${escapeAttribute(entry.id)}">${escapeHtml(t("financial.delete"))}</button>
          </span>
        </span>
      </span>
    </article>
  `;
}

function ledgerMarkup(entries, now) {
  const groups = [];
  // Groups are built from consecutive entries, so the list must be ordered by
  // the same day it is grouped by. The Supabase query orders by due_date, and a
  // paid entry belongs to the month it was paid in.
  [...entries].sort(byEffectiveDateDesc).forEach((entry) => {
    const key = (effectiveDate(entry) || todayKey(now)).slice(0, 7);
    let group = groups.at(-1);
    if (!group || group.key !== key) {
      group = { key, entries: [] };
      groups.push(group);
    }
    group.entries.push(entry);
  });

  return groups
    .map((group) => {
      const live = group.entries.filter((entry) => entry.status !== "CANCELLED");
      const sum = (type) => live.filter((entry) => entry.type === type).reduce((total, entry) => total + entry.amount, 0);
      return `
        <section class="fin-month">
          <header class="fin-month__head">
            <h3>${escapeHtml(monthLabel(group.key))}</h3>
            <span>
              <b class="fin-month__in">${escapeHtml(t("financial.groupIn"))} ${escapeHtml(formatCurrency(sum("INCOME")))}</b>
              <b class="fin-month__out">${escapeHtml(t("financial.groupOut"))} ${escapeHtml(formatCurrency(sum("EXPENSE")))}</b>
            </span>
          </header>
          <div class="fin-month__entries">
            ${group.entries.map((entry) => entryMarkup(entry, now)).join("")}
          </div>
        </section>
      `;
    })
    .join("");
}

/* ------------------------------------------------------------ reports */

function niceMax(value) {
  if (value <= 0) return 1000;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * magnitude >= value);
  return step * magnitude;
}

// Top corners rounded, square on the baseline.
function columnPath(x, y, width, height, radius = 4) {
  if (height <= 0) return "";
  const r = Math.min(radius, width / 2, height);
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`;
}

function cashFlowChart(series) {
  const width = 640;
  const height = 240;
  const pad = { top: 12, right: 8, bottom: 28, left: 64 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(...series.flatMap((point) => [point.income, point.expense])));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => max * ratio);
  const band = plotW / series.length;
  const barW = Math.min(24, (band - 20) / 2);
  const y = (value) => pad.top + plotH - (value / max) * plotH;

  const grid = ticks
    .map(
      (tick) => `
        <line class="fin-chart__grid" x1="${pad.left}" x2="${width - pad.right}" y1="${y(tick)}" y2="${y(tick)}"></line>
        <text class="fin-chart__tick" x="${pad.left - 10}" y="${y(tick) + 4}" text-anchor="end">${escapeHtml(compactCurrency(tick))}</text>
      `,
    )
    .join("");

  const bars = series
    .map((point, index) => {
      const center = pad.left + band * index + band / 2;
      const month = monthLabel(point.month);
      const column = (value, offset, kind, labelKey) => {
        const top = y(value);
        const barHeight = pad.top + plotH - top;
        const x = center + offset;
        const tip = `${month} · ${t(labelKey)} · ${formatCurrency(value)}`;
        return `
          <g class="fin-chart__bar fin-chart__bar--${kind}" tabindex="0" role="img" aria-label="${escapeAttribute(tip)}" data-tip="${escapeAttribute(tip)}">
            <rect class="fin-chart__hit" x="${x - 2}" y="${pad.top}" width="${barW + 4}" height="${plotH}"></rect>
            ${value > 0 ? `<path d="${columnPath(x, top, barW, barHeight)}"></path>` : ""}
          </g>
        `;
      };
      return `
        ${column(point.income, -barW - 1, "income", "financial.legendIncome")}
        ${column(point.expense, 1, "expense", "financial.legendExpense")}
        <text class="fin-chart__label" x="${center}" y="${height - 8}" text-anchor="middle">${escapeHtml(monthLabel(point.month, "short"))}</text>
      `;
    })
    .join("");

  return `
    <div class="fin-chart" data-fin-chart>
      <ul class="fin-legend" aria-hidden="true">
        <li><i class="fin-legend__swatch fin-legend__swatch--income"></i>${escapeHtml(t("financial.legendIncome"))}</li>
        <li><i class="fin-legend__swatch fin-legend__swatch--expense"></i>${escapeHtml(t("financial.legendExpense"))}</li>
      </ul>
      <svg viewBox="0 0 ${width} ${height}" role="group" aria-label="${escapeAttribute(t("financial.chartLabel"))}">
        ${grid}
        <line class="fin-chart__axis" x1="${pad.left}" x2="${width - pad.right}" y1="${pad.top + plotH}" y2="${pad.top + plotH}"></line>
        ${bars}
      </svg>
      <div class="fin-tooltip" role="status" hidden></div>
    </div>
    <details class="fin-table">
      <summary>${escapeHtml(t("financial.viewTable"))}</summary>
      <table>
        <thead><tr><th>${escapeHtml(t("financial.tableMonth"))}</th><th>${escapeHtml(t("financial.legendIncome"))}</th><th>${escapeHtml(t("financial.legendExpense"))}</th><th>${escapeHtml(t("financial.tableResult"))}</th></tr></thead>
        <tbody>
          ${series
            .map(
              (point) => `<tr><td>${escapeHtml(monthLabel(point.month))}</td><td>${escapeHtml(formatCurrency(point.income))}</td><td>${escapeHtml(formatCurrency(point.expense))}</td><td class="${point.result < 0 ? "is-negative" : ""}">${escapeHtml(formatSignedCurrency(point.result))}</td></tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </details>
  `;
}

function barList(rows, emptyMessage) {
  if (!rows.length) return `<p class="empty-inline">${escapeHtml(emptyMessage)}</p>`;
  const max = Math.max(...rows.map((row) => row.amount), 1);
  return `
    <ul class="fin-bars">
      ${rows
        .map(
          (row) => `
            <li>
              <span class="fin-bars__label">${row.href ? `<a href="${escapeAttribute(row.href)}">${escapeHtml(row.label)}</a>` : escapeHtml(row.label)}</span>
              <span class="fin-bars__track" aria-hidden="true"><b style="width:${Math.max(2, Math.round((row.amount / max) * 100))}%"></b></span>
              <span class="fin-bars__value">${escapeHtml(formatCurrency(row.amount))}<small>${escapeHtml(row.note ?? "")}</small></span>
            </li>
          `,
        )
        .join("")}
    </ul>
  `;
}

function percent(value) {
  return new Intl.NumberFormat(getLocale(), { style: "percent", maximumFractionDigits: 0 }).format(value);
}

function reportsMarkup(entries, range, now) {
  const scoped = entries.filter((entry) => withinRange(entry, range));
  const expenses = categoryBreakdown(scoped, "EXPENSE").map((row) => ({
    label: t(`financial.categories.${row.category}`),
    amount: row.amount,
    note: t("financial.shareOfTotal", { percent: percent(row.share) }),
  }));
  const clients = revenueByClient(scoped, 6).map((row) => ({
    label: row.name || "—",
    amount: row.amount,
    href: row.clientId ? `#/clients/${encodeURIComponent(row.clientId)}` : "",
  }));
  const aging = receivablesAging(entries, now);

  return `
    <article class="panel fin-report fin-report--wide">
      <header class="panel__head"><div><span>${escapeHtml(t("financial.reportCashFlowSub"))}</span><h3>${escapeHtml(t("financial.reportCashFlow"))}</h3></div></header>
      ${cashFlowChart(monthlyCashFlow(entries, CASH_FLOW_MONTHS, now))}
    </article>
    <article class="panel fin-report">
      <header class="panel__head"><div><span>${escapeHtml(t("financial.reportExpensesSub"))}</span><h3>${escapeHtml(t("financial.reportExpenses"))}</h3></div></header>
      ${barList(expenses, t("financial.reportEmptyExpenses"))}
    </article>
    <article class="panel fin-report">
      <header class="panel__head"><div><span>${escapeHtml(t("financial.reportClientsSub"))}</span><h3>${escapeHtml(t("financial.reportClients"))}</h3></div></header>
      ${barList(clients, t("financial.reportEmptyClients"))}
    </article>
    <article class="panel fin-report fin-report--wide">
      <header class="panel__head"><div><span>${escapeHtml(t("financial.reportAgingSub"))}</span><h3>${escapeHtml(t("financial.reportAging"))}</h3></div></header>
      <div class="fin-aging">
        ${aging
          .map(
            (bucket) => `
              <div class="fin-aging__bucket fin-aging__bucket--${bucket.key}${bucket.count ? "" : " is-empty"}">
                <span><i aria-hidden="true"></i>${escapeHtml(t(`financial.aging.${bucket.key}`))}</span>
                <strong>${escapeHtml(formatCurrency(bucket.amount))}</strong>
                <small>${escapeHtml(plural("financial.agingCount", bucket.count))}</small>
              </div>
            `,
          )
          .join("")}
      </div>
    </article>
  `;
}

function bindChartTooltips(root) {
  const chart = root.querySelector("[data-fin-chart]");
  const tooltip = chart?.querySelector(".fin-tooltip");
  if (!chart || !tooltip) return;

  const show = (bar) => {
    // textContent, never innerHTML: the label carries month names and amounts
    // built from data.
    tooltip.textContent = bar.dataset.tip;
    tooltip.hidden = false;
    const box = bar.getBoundingClientRect();
    const frame = chart.getBoundingClientRect();
    const left = Math.min(Math.max(box.left - frame.left + box.width / 2, 80), frame.width - 80);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${Math.max(box.top - frame.top - 8, 0)}px`;
    chart.querySelectorAll(".fin-chart__bar").forEach((item) => item.classList.toggle("is-dim", item !== bar));
  };
  const hide = () => {
    tooltip.hidden = true;
    chart.querySelectorAll(".fin-chart__bar").forEach((item) => item.classList.remove("is-dim"));
  };

  chart.querySelectorAll(".fin-chart__bar").forEach((bar) => {
    bar.addEventListener("pointerenter", () => show(bar));
    bar.addEventListener("focus", () => show(bar));
    bar.addEventListener("pointerleave", hide);
    bar.addEventListener("blur", hide);
  });
}

/* --------------------------------------------------------------- form */

function optionList(options, selected) {
  return options
    .map(([value, label]) => `<option value="${escapeAttribute(value)}"${String(value) === String(selected ?? "") ? " selected" : ""}>${escapeHtml(label)}</option>`)
    .join("");
}

function fieldError(name) {
  return `<p class="field-error" data-error-for="${name}" hidden></p>`;
}

function formMarkup(values, { isCreate, clients, projects }) {
  const categoryOptions = categoriesFor(values.type).map((category) => [category, t(`financial.categories.${category}`)]);
  return `
    <form class="fin-form" data-fin-form novalidate>
      <div class="fin-form__type" role="radiogroup" aria-label="${escapeAttribute(t("financial.fieldType"))}">
        ${["INCOME", "EXPENSE"]
          .map(
            (type) => `
              <label class="fin-type fin-type--${type.toLowerCase()}">
                <input type="radio" name="type" value="${type}"${values.type === type ? " checked" : ""}>
                <span>${escapeHtml(t(`financial.types.${type}`))}</span>
              </label>
            `,
          )
          .join("")}
      </div>
      ${fieldError("type")}

      <div class="form-grid">
        <div class="field field--wide">
          <label for="fin-description">${escapeHtml(t("financial.fieldDescription"))}</label>
          <input id="fin-description" name="description" value="${escapeAttribute(values.description)}" maxlength="160" required>
          ${fieldError("description")}
        </div>
        <div class="field">
          <label for="fin-amount">${escapeHtml(t("financial.fieldAmount"))}</label>
          <input id="fin-amount" name="amount" inputmode="decimal" autocomplete="off" value="${escapeAttribute(values.amount === "" ? "" : String(values.amount).replace(".", getLocale() === "pt-BR" ? "," : "."))}" required>
          <p class="field-hint">${escapeHtml(t("financial.fieldAmountHint"))}</p>
          ${fieldError("amount")}
        </div>
        <div class="field">
          <label for="fin-category">${escapeHtml(t("financial.fieldCategory"))}</label>
          <select id="fin-category" name="category">${optionList(categoryOptions, values.category)}</select>
          ${fieldError("category")}
        </div>
        <div class="field">
          <label for="fin-due">${escapeHtml(t("financial.fieldDueDate"))}</label>
          <input id="fin-due" name="dueDate" type="date" value="${escapeAttribute(values.dueDate ?? "")}" required>
          ${fieldError("dueDate")}
        </div>
        <div class="field">
          <label for="fin-status">${escapeHtml(t("financial.fieldStatus"))}</label>
          <select id="fin-status" name="status">${optionList(
            ["PENDING", "PAID", "CANCELLED"].map((status) => [status, t(`financial.statuses.${status}`)]),
            values.status,
          )}</select>
          ${fieldError("status")}
        </div>
        <div class="field" data-paid-field ${values.status === "PAID" ? "" : "hidden"}>
          <label for="fin-paid">${escapeHtml(t("financial.fieldPaidAt"))}</label>
          <input id="fin-paid" name="paidAt" type="date" max="${escapeAttribute(todayKey())}" value="${escapeAttribute(values.paidAt ?? "")}">
          <p class="field-hint">${escapeHtml(t("financial.fieldPaidAtHint"))}</p>
          ${fieldError("paidAt")}
        </div>
        ${
          isCreate
            ? `
              <div class="field" data-installments-field ${values.status === "PENDING" ? "" : "hidden"}>
                <label for="fin-installments">${escapeHtml(t("financial.fieldInstallments"))}</label>
                <input id="fin-installments" name="installments" type="number" min="1" max="${MAX_INSTALLMENTS}" step="1" value="1">
                <p class="field-hint" data-installments-hint>${escapeHtml(t("financial.fieldInstallmentsHint"))}</p>
                ${fieldError("installments")}
              </div>
            `
            : ""
        }
        <div class="field">
          <label for="fin-client">${escapeHtml(t("financial.fieldClient"))}</label>
          <select id="fin-client" name="clientId">${optionList(
            [["", t("financial.noClient")], ...clients.map((client) => [client.id, client.name])],
            values.clientId,
          )}</select>
        </div>
        <div class="field">
          <label for="fin-project">${escapeHtml(t("financial.fieldProject"))}</label>
          <select id="fin-project" name="projectId">${optionList(
            [["", t("financial.noProject")], ...projects.map((project) => [project.dbId || project.id, `CASE ${project.caseNumber} · ${project.name}`])],
            values.projectId,
          )}</select>
        </div>
        <div class="field field--wide">
          <label for="fin-notes">${escapeHtml(t("financial.fieldNotes"))}</label>
          <textarea id="fin-notes" name="notes" rows="2" maxlength="1000">${escapeHtml(values.notes ?? "")}</textarea>
        </div>
      </div>
      <button type="submit" hidden></button>
    </form>
  `;
}

function readForm(form) {
  const data = new FormData(form);
  return {
    type: data.get("type") ?? "",
    description: data.get("description") ?? "",
    amount: data.get("amount") ?? "",
    category: data.get("category") ?? "",
    dueDate: data.get("dueDate") ?? "",
    status: data.get("status") ?? "",
    paidAt: data.get("paidAt") ?? "",
    clientId: data.get("clientId") ?? "",
    projectId: data.get("projectId") ?? "",
    notes: data.get("notes") ?? "",
  };
}

function showErrors(form, errors) {
  form.querySelectorAll("[data-error-for]").forEach((node) => {
    const message = errors[node.dataset.errorFor];
    node.hidden = !message;
    node.textContent = message ?? "";
    const input = form.querySelector(`[name="${node.dataset.errorFor}"]`);
    input?.setAttribute("aria-invalid", message ? "true" : "false");
  });
  const [first] = Object.keys(errors);
  form.querySelector(`[name="${first}"]`)?.focus();
}

function bindFormBehaviour(form) {
  const category = form.querySelector("[name=category]");
  const status = form.querySelector("[name=status]");
  const paidField = form.querySelector("[data-paid-field]");
  const installmentsField = form.querySelector("[data-installments-field]");
  const installments = form.querySelector("[name=installments]");
  const hint = form.querySelector("[data-installments-hint]");
  const amount = form.querySelector("[name=amount]");
  const due = form.querySelector("[name=dueDate]");

  form.querySelectorAll("[name=type]").forEach((radio) => {
    radio.addEventListener("change", () => {
      const current = category.value;
      const options = categoriesFor(radio.value);
      category.innerHTML = optionList(
        options.map((value) => [value, t(`financial.categories.${value}`)]),
        options.includes(current) ? current : options[0],
      );
    });
  });

  const refreshInstallments = () => {
    if (!installments || !hint) return;
    const count = Number(installments.value);
    const total = parseAmount(amount.value);
    if (count > 1 && Number.isFinite(total) && total > 0) {
      const [first] = splitInstallments({ amount: total, count, dueDate: due.value || todayKey() });
      hint.textContent = t("financial.installmentPreview", { count, amount: preciseCurrency(first.amount) });
    } else {
      hint.textContent = t("financial.fieldInstallmentsHint");
    }
  };

  // A field's error clears as soon as it is edited, so a corrected value never
  // keeps showing the old complaint.
  form.addEventListener("input", (event) => {
    const name = event.target?.name;
    const error = name ? form.querySelector(`[data-error-for="${name}"]`) : null;
    if (!error || error.hidden) return;
    error.hidden = true;
    error.textContent = "";
    event.target.setAttribute("aria-invalid", "false");
  });

  status.addEventListener("change", () => {
    paidField.hidden = status.value !== "PAID";
    if (installmentsField) {
      installmentsField.hidden = status.value !== "PENDING";
      if (status.value !== "PENDING") installments.value = "1";
      refreshInstallments();
    }
  });
  installments?.addEventListener("input", refreshInstallments);
  amount.addEventListener("input", refreshInstallments);
  due.addEventListener("change", refreshInstallments);
}

/* --------------------------------------------------------------- page */

function selectMarkup({ labelKey, name, options, selected }) {
  return `
    <label class="sort-field">
      <span>${escapeHtml(t(labelKey))}</span>
      <select data-fin-${name}>${optionList(options, selected)}</select>
    </label>
  `;
}

function periodOptions() {
  return FINANCIAL_PERIODS.map((period) => [period, t(`financial.periods.${period}`)]);
}

function categoryOptions() {
  return [["ALL", t("common.all")], ...TRANSACTION_CATEGORIES.map((category) => [category, t(`financial.categories.${category}`)])];
}

export const financialPage = {
  title: () => t("financial.title"),
  breadcrumb: () => t("financial.breadcrumb"),
  render: () => `
    <section class="page-heading page-heading--split">
      <div>
        <span data-i18n="financial.eyebrow">${t("financial.eyebrow")}</span>
        <h2 data-i18n="financial.heading">${t("financial.heading")}</h2>
        <p data-i18n="financial.intro">${t("financial.intro")}</p>
      </div>
      <div class="heading-actions">
        <button class="button" type="button" data-fin-export disabled data-i18n="financial.exportCsv">${t("financial.exportCsv")}</button>
        <button class="button button--primary" type="button" data-fin-new disabled data-i18n="financial.newEntry">${t("financial.newEntry")}</button>
      </div>
    </section>

    <div class="metric-strip fin-metrics" data-fin-metrics aria-label="${escapeAttribute(t("financial.summary"))}" aria-live="polite"></div>

    <div class="fin-toolbar">
      ${selectMarkup({ labelKey: "financial.period", name: "period", options: periodOptions(), selected: DEFAULT_PERIOD })}
      <label class="search-field">
        <span data-i18n="financial.search">${t("financial.search")}</span>
        <input type="search" data-fin-search placeholder="${escapeAttribute(t("financial.searchPlaceholder"))}">
      </label>
      ${selectMarkup({ labelKey: "financial.category", name: "category", options: categoryOptions(), selected: "ALL" })}
      ${selectMarkup({ labelKey: "financial.client", name: "client", options: [["ALL", t("common.all")]], selected: "ALL" })}
    </div>
    <p class="fin-period-note" data-i18n="financial.periodNote">${t("financial.periodNote")}</p>

    <section data-financial>
      <div class="tabs fin-tabs" role="tablist" aria-label="${escapeAttribute(t("financial.sections"))}">
        <button type="button" role="tab" id="financial-tab-ledger" aria-selected="true" aria-controls="financial-panel-ledger" tabindex="0" data-i18n="financial.tabLedger">${t("financial.tabLedger")}</button>
        <button type="button" role="tab" id="financial-tab-reports" aria-selected="false" aria-controls="financial-panel-reports" tabindex="-1" data-i18n="financial.tabReports">${t("financial.tabReports")}</button>
      </div>

      <div class="fin-panel" id="financial-panel-ledger" role="tabpanel" aria-labelledby="financial-tab-ledger">
        <div class="log-channels fin-views" role="group" aria-label="${escapeAttribute(t("financial.filterByView"))}" data-fin-views></div>
        <div class="log-status">
          <p class="ops-count" data-fin-count></p>
          <button class="text-link log-status__clear" type="button" data-fin-clear hidden data-i18n="financial.clearFilters">${t("financial.clearFilters")}</button>
        </div>
        <p class="fin-open-hint" data-fin-open-hint hidden data-i18n="financial.openViewsHint">${t("financial.openViewsHint")}</p>
        <div class="fin-ledger" data-fin-list aria-live="polite" aria-busy="true">
          <p class="empty-inline" data-i18n="financial.loading">${t("financial.loading")}</p>
        </div>
      </div>

      <div class="fin-panel fin-reports" id="financial-panel-reports" role="tabpanel" aria-labelledby="financial-tab-reports" hidden data-fin-reports></div>
    </section>
  `,
  afterRender: async () => {
    const root = document.querySelector("[data-financial]");
    bindTabs(root);

    const list = document.querySelector("[data-fin-list]");
    const reports = document.querySelector("[data-fin-reports]");
    const metricsRoot = document.querySelector("[data-fin-metrics]");
    const viewsRoot = document.querySelector("[data-fin-views]");
    const count = document.querySelector("[data-fin-count]");
    const clearButton = document.querySelector("[data-fin-clear]");
    const openHint = document.querySelector("[data-fin-open-hint]");
    const period = document.querySelector("[data-fin-period]");
    const search = document.querySelector("[data-fin-search]");
    const category = document.querySelector("[data-fin-category]");
    const clientFilter = document.querySelector("[data-fin-client]");
    const newButton = document.querySelector("[data-fin-new]");
    const exportButton = document.querySelector("[data-fin-export]");

    let raw = [];
    let entries = [];
    let visible = [];
    let clients = [];
    let projects = [];
    let view = "all";
    let loadFailed = false;

    // Joins the ledger to the client and project records once per load, so
    // every render, search and export reads the same names.
    function enrich() {
      const clientNames = new Map(clients.map((client) => [client.id, client.name]));
      const projectByKey = new Map(projects.flatMap((project) => [[project.dbId, project], [project.id, project]].filter(([key]) => key)));
      entries = raw.map((entry) => {
        const project = entry.projectId ? projectByKey.get(entry.projectId) : null;
        return {
          ...entry,
          clientName: entry.clientId ? clientNames.get(entry.clientId) ?? "" : "",
          projectName: project ? `CASE ${project.caseNumber} · ${project.name}` : "",
          projectRoute: project?.id ?? "",
        };
      });
    }

    const filtersActive = () =>
      view !== "all" || search.value.trim() !== "" || category.value !== "ALL" || clientFilter.value !== "ALL";

    function render() {
      const now = new Date();
      const range = periodRange(period.value, now);
      const query = search.value.trim().toLowerCase();

      metricsRoot.innerHTML = metricsMarkup(entries, range, now);

      if (loadFailed) {
        list.innerHTML = `<p class="empty-inline fin-error">${escapeHtml(t("financial.loadError"))}</p>`;
        reports.innerHTML = "";
        viewsRoot.innerHTML = "";
        count.textContent = "";
        return;
      }

      // The view tabs count what each one would show under the other filters.
      const scoped = entries.filter(
        (entry) =>
          matchesQuery(entry, query) &&
          (category.value === "ALL" || entry.category === category.value) &&
          (clientFilter.value === "ALL" || entry.clientId === clientFilter.value),
      );
      const forView = (candidate) =>
        scoped.filter((entry) => matchesView(entry, candidate, now) && (OPEN_VIEWS.has(candidate) || withinRange(entry, range)));
      visible = forView(view);

      viewsRoot.innerHTML = VIEWS.map((candidate) => ({ candidate, total: forView(candidate).length }))
        .map(({ candidate, total }) => {
          const isActive = candidate === view;
          return `
            <button type="button" class="log-channel fin-view fin-view--${candidate}${isActive ? " is-active" : ""}" data-fin-view="${candidate}" aria-pressed="${isActive}">
              <span>${escapeHtml(t(`financial.views.${candidate}`))}</span>
              <b>${escapeHtml(total)}</b>
            </button>
          `;
        })
        .join("");

      openHint.hidden = !OPEN_VIEWS.has(view);
      clearButton.hidden = !filtersActive();
      count.textContent = plural("financial.count", entries.length, { visible: visible.length, total: entries.length });
      exportButton.disabled = !visible.length;

      list.innerHTML = !entries.length
        ? `<p class="empty-inline">${escapeHtml(t("financial.empty"))}</p>`
        : visible.length
          ? ledgerMarkup(visible, now)
          : `<p class="empty-inline">${escapeHtml(t("financial.noMatch"))}</p>`;

      reports.innerHTML = reportsMarkup(entries, range, now);
      bindChartTooltips(reports);
    }

    async function load() {
      list.setAttribute("aria-busy", "true");
      try {
        raw = await getTransactions();
        loadFailed = false;
      } catch (error) {
        raw = [];
        loadFailed = true;
        showToast(describeError(error, t("financial.loadError")));
      }
      if (!list.isConnected) return;
      enrich();
      list.removeAttribute("aria-busy");
      newButton.disabled = loadFailed;
      render();
    }

    async function run(action, successKey) {
      try {
        await action();
        showToast(t(successKey));
        await load();
      } catch (error) {
        showToast(describeError(error, t("errors.data.saveTransaction")));
      }
    }

    function openForm(existing = null) {
      const isCreate = !existing;
      const values = isCreate
        ? newTransactionDefaults({ clientId: clientFilter.value !== "ALL" ? clientFilter.value : "" })
        : {
            ...existing,
            amount: existing.amount,
            paidAt: existing.paidAt ?? "",
            clientId: existing.clientId ?? "",
            projectId: existing.projectId ?? "",
          };

      openModal({
        title: t(isCreate ? "financial.formNewTitle" : "financial.formEditTitle"),
        className: "modal--wide",
        body: formMarkup(values, { isCreate, clients, projects }),
        actions: [
          { label: t("common.cancel"), role: "cancel" },
          {
            label: t(isCreate ? "financial.create" : "financial.save"),
            role: "confirm",
            variant: "primary",
            onSelect: async () => {
              const form = document.querySelector("[data-fin-form]");
              const input = readForm(form);
              const installments = isCreate ? Number(form.querySelector("[name=installments]")?.value || 1) : 1;
              const errors = validateTransaction(sanitizeTransaction(input), { installments });
              if (Object.keys(errors).length) {
                showErrors(form, errors);
                return false;
              }
              try {
                if (isCreate) {
                  const created = await createTransaction(input, { installments });
                  showToast(plural("financial.created", created.length));
                } else {
                  await updateTransaction(existing.id, input);
                  showToast(t("financial.saved"));
                }
              } catch (error) {
                if (error?.field) {
                  showErrors(form, { [error.field]: error.message });
                } else {
                  showToast(describeError(error, t("errors.data.saveTransaction")));
                }
                return false;
              }
              load();
              return true;
            },
          },
        ],
      });

      const form = document.querySelector("[data-fin-form]");
      bindFormBehaviour(form);
      // Enter in any field submits through the same validated path.
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        document.querySelector("[data-modal-confirm]")?.click();
      });
    }

    function exportVisible() {
      const header = ["due_date", "paid_at", "type", "status", "category", "description", "amount", "client", "project", "notes"];
      const rows = visible.map((entry) => [
        csvCell(entry.dueDate),
        csvCell(entry.paidAt ?? ""),
        csvCell(entry.type),
        csvCell(isOverdue(entry) ? "OVERDUE" : entry.status),
        csvCell(entry.category),
        csvCell(entry.description),
        csvNumber(signedAmount(entry)),
        csvCell(entry.clientName),
        csvCell(entry.projectName),
        csvCell(entry.notes),
      ]);
      downloadCsv(`space-underground-financeiro-${todayKey()}.csv`, csvText(header, rows));
      showToast(plural("financial.exported", visible.length));
    }

    viewsRoot.addEventListener("click", (event) => {
      const button = event.target.closest("[data-fin-view]");
      if (!button) return;
      view = button.dataset.finView;
      render();
    });

    [period, category, clientFilter].forEach((control) => control.addEventListener("change", render));
    search.addEventListener("input", render);

    clearButton.addEventListener("click", () => {
      view = "all";
      search.value = "";
      category.value = "ALL";
      clientFilter.value = "ALL";
      render();
    });

    newButton.addEventListener("click", () => openForm());
    exportButton.addEventListener("click", exportVisible);

    // Opening, closing and the document listeners (which detach once the page
    // is gone) belong to the shared row menu.
    bindRowMenus(list);

    list.addEventListener("click", async (event) => {
      if (event.target.closest("[data-row-menu-toggle]")) return;

      const button = event.target.closest("[data-fin-action]");
      if (!button) return;
      closeRowMenus(list);
      const id = button.dataset.id;
      const entry = entries.find((item) => item.id === id);
      if (!entry) return;

      switch (button.dataset.finAction) {
        case "pay":
          await run(() => markTransactionPaid(id), "financial.paid");
          break;
        case "reopen":
          await run(() => reopenTransaction(id), "financial.reopened");
          break;
        case "cancel":
          await run(() => cancelTransaction(id), "financial.cancelled");
          break;
        case "duplicate":
          await run(() => duplicateTransaction(id), "financial.duplicated");
          break;
        case "edit":
          openForm(entry);
          break;
        case "delete": {
          const confirmed = await confirmModal({
            title: t("financial.deleteTitle"),
            body: `<p>${escapeHtml(entry.description)}</p><p>${escapeHtml(t("financial.deleteBody"))}</p>`,
            confirmLabel: t("financial.deleteConfirm"),
          });
          if (confirmed) await run(() => deleteTransaction(id), "financial.deleted");
          break;
        }
        default:
          break;
      }
    });

    // Re-renders from what is already in memory: a locale switch never asks
    // for the ledger again and keeps every filter.
    onLocaleChange(list, () => {
      [...period.options].forEach((option) => {
        option.textContent = t(`financial.periods.${option.value}`);
      });
      [...category.options].forEach((option) => {
        option.textContent = option.value === "ALL" ? t("common.all") : t(`financial.categories.${option.value}`);
      });
      if (clientFilter.options[0]) clientFilter.options[0].textContent = t("common.all");
      search.placeholder = t("financial.searchPlaceholder");
      enrich();
      render();
    });

    // Clients and projects only label and link entries: if either is missing
    // (a migration not applied, an outage) the ledger still works unlinked.
    const [clientsResult, projectsResult] = await Promise.allSettled([getClients(), getProjects()]);
    clients = clientsResult.status === "fulfilled" ? clientsResult.value : [];
    projects = projectsResult.status === "fulfilled" ? projectsResult.value : [];
    clientFilter.innerHTML = optionList(
      [["ALL", t("common.all")], ...clients.map((client) => [client.id, client.name])],
      "ALL",
    );

    await load();
  },
};
