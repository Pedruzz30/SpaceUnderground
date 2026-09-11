// Display formatters shared by the Operations screens (Clients, Commercial,
// Financial). Presentation only: nothing here touches data sources.

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const DAY = 24 * 60 * 60 * 1000;

function toDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatCurrency(value) {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  if (Number.isNaN(amount)) return "—";
  return brl.format(amount);
}

// Signed amounts keep the sign outside the currency token ("+ R$ 1.750") so a
// ledger column stays scannable without shouting.
export function formatSignedCurrency(value) {
  const amount = Number(value);
  if (value === null || value === undefined || Number.isNaN(amount)) return "—";
  if (amount === 0) return brl.format(0);
  return `${amount > 0 ? "+" : "-"} ${brl.format(Math.abs(amount))}`;
}

export function formatRelativeDay(value) {
  const date = toDate(value);
  if (!date) return "—";

  const diff = Date.now() - date.getTime();
  if (diff < 0) return formatDayMonth(date);
  if (diff < DAY) return "today";
  if (diff < 2 * DAY) return "yesterday";
  if (diff < 7 * DAY) return `${Math.round(diff / DAY)}d ago`;
  return formatDayMonth(date);
}

// "10 SEP" — mono metadata reads better with the day first and a stable,
// locale-independent month token.
export function formatDayMonth(value) {
  const date = toDate(value);
  if (!date) return "—";
  const day = String(date.getDate()).padStart(2, "0");
  const month = date.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
  return `${day} ${month}`;
}

export function formatFullDate(value) {
  const date = toDate(value);
  if (!date) return "—";
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit" });
}
