// Display formatters shared by the Operations screens (Clients, Commercial,
// Financial). Presentation only: nothing here touches data sources.

import { getLocale, t } from "../i18n/index.js";

function currencyFormatter() {
  return new Intl.NumberFormat(getLocale(), {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

const DAY = 24 * 60 * 60 * 1000;

function toDate(value) {
  // new Date(null) is the epoch, not an error, so empty values are rejected up
  // front to keep a missing date rendering as an em dash rather than 1970.
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Amounts stay in BRL in both locales -- only the grouping and the currency
// token placement follow the locale. Nothing is converted.
export function formatCurrency(value) {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  if (Number.isNaN(amount)) return "—";
  return currencyFormatter().format(amount);
}

// Signed amounts keep the sign outside the currency token ("+ R$ 1.750") so a
// ledger column stays scannable without shouting.
export function formatSignedCurrency(value) {
  const amount = Number(value);
  if (value === null || value === undefined || Number.isNaN(amount)) return "—";
  if (amount === 0) return currencyFormatter().format(0);
  return `${amount > 0 ? "+" : "-"} ${currencyFormatter().format(Math.abs(amount))}`;
}

// "há 3 dias" in pt-BR, "3 days ago" in English. Intl does the wording so the
// column can never end up as a Portuguese page showing "3d ago".
export function formatRelativeDay(value) {
  const date = toDate(value);
  if (!date) return "—";

  const diff = Date.now() - date.getTime();
  if (diff < 0) return formatDayMonth(date);
  if (diff < DAY) return t("format.today");
  if (diff < 2 * DAY) return t("format.yesterday");
  if (diff < 7 * DAY) {
    const days = Math.round(diff / DAY);
    return new Intl.RelativeTimeFormat(getLocale(), { numeric: "always" }).format(-days, "day");
  }
  return formatDayMonth(date);
}

export function formatDayMonth(value) {
  const date = toDate(value);
  if (!date) return "—";
  const day = new Intl.DateTimeFormat(getLocale(), { day: "2-digit" }).format(date);
  const month = new Intl.DateTimeFormat(getLocale(), { month: "short" }).format(date).replace(".", "").toUpperCase();
  return getLocale() === "pt-BR" ? `${day} ${month}` : `${month} ${day}`;
}

export function formatFullDate(value) {
  const date = toDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat(getLocale(), { year: "numeric", month: "short", day: "2-digit" }).format(date);
}

// Re-formats values already on the page after a locale change. Pages stamp the
// raw ISO string or number on the node, so nothing has to be re-fetched or
// re-rendered to switch how a date or amount reads.
export function applyLocaleFormatting(root = globalThis.document) {
  if (!root?.querySelectorAll) return;

  root.querySelectorAll("[data-relative-date]").forEach((node) => {
    node.textContent = formatRelativeDay(node.dataset.relativeDate);
  });
  root.querySelectorAll("[data-day-month]").forEach((node) => {
    node.textContent = formatDayMonth(node.dataset.dayMonth);
  });
  root.querySelectorAll("[data-full-date]").forEach((node) => {
    node.textContent = formatFullDate(node.dataset.fullDate);
  });
  root.querySelectorAll("[data-currency]").forEach((node) => {
    const amount = Number(node.dataset.currency);
    if (Number.isNaN(amount)) return;
    node.textContent =
      node.dataset.currencyMode === "signed" ? formatSignedCurrency(amount) : formatCurrency(Math.abs(amount));
  });
}
