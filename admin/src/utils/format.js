// Display formatters shared by the Operations screens (Clients, Commercial,
// Financial). Presentation only: nothing here touches data sources.

import { getLocale } from "../i18n/index.js";

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
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

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

export function formatRelativeDay(value) {
  const date = toDate(value);
  if (!date) return "—";

  const diff = Date.now() - date.getTime();
  if (diff < 0) return formatDayMonth(date);
  if (diff < DAY) return getLocale() === "pt-BR" ? "hoje" : "today";
  if (diff < 2 * DAY) return getLocale() === "pt-BR" ? "ontem" : "yesterday";
  if (diff < 7 * DAY) return `${Math.round(diff / DAY)}d ago`;
  return formatDayMonth(date);
}

export function formatDayMonth(value) {
  const date = toDate(value);
  if (!date) return "—";
  if (getLocale() === "pt-BR") {
    const day = String(date.getDate()).padStart(2, "0");
    const month = date.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "").toUpperCase();
    return `${day} ${month}`;
  }
  return date.toLocaleDateString("en", { month: "short", day: "2-digit" }).toUpperCase();
}

export function formatFullDate(value) {
  const date = toDate(value);
  if (!date) return "—";
  return date.toLocaleDateString(getLocale(), { year: "numeric", month: "short", day: "2-digit" });
}
