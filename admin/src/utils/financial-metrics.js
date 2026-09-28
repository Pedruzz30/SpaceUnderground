// Ledger rules shared by the Financial page, its reports and the Dashboard.
//
// One entry is INCOME or EXPENSE, and PENDING, PAID or CANCELLED. Every figure
// any screen shows is derived from the entries here, never from a standing
// summary that could drift away from them:
//
//   revenue / expenses   PAID entries only (cash basis, dated by paid_at)
//   to receive / to pay  PENDING entries (dated by due_date)
//   overdue              PENDING entries whose due date has passed
//   CANCELLED            counts nowhere, but stays in the ledger for the record
//
// Rows written before Financial V2 (the presentation ledger and older tests)
// used a RECEIVABLE type, a signed amount and a single `date`. normalizeEntry
// reads both shapes, so nothing downstream has to know which one it got.

export const TRANSACTION_TYPES = ["INCOME", "EXPENSE"];
export const TRANSACTION_STATUSES = ["PENDING", "PAID", "CANCELLED"];

export const INCOME_CATEGORIES = ["PROJECT", "RETAINER", "CONSULTING", "OTHER"];
export const EXPENSE_CATEGORIES = ["INFRASTRUCTURE", "SOFTWARE", "FREELANCER", "MARKETING", "TAXES", "OFFICE", "OTHER"];
export const TRANSACTION_CATEGORIES = [...new Set([...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES])];

const DAY = 24 * 60 * 60 * 1000;

export function categoriesFor(type) {
  return type === "EXPENSE" ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
}

// "2026-09-20" or an ISO timestamp -> "2026-09-20". Dates are calendar days:
// a due date has no time of day, so comparisons never depend on the timezone.
export function toDateKey(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const text = String(value).trim();
  const plain = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (plain) return text;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : toDateKey(date);
}

export function todayKey(now = new Date()) {
  return toDateKey(now);
}

function normalizeType(type) {
  const value = String(type || "").toUpperCase();
  if (value === "RECEIVABLE") return "INCOME";
  return TRANSACTION_TYPES.includes(value) ? value : "INCOME";
}

function normalizeStatus(status) {
  const value = String(status || "").toUpperCase();
  return TRANSACTION_STATUSES.includes(value) ? value : "PENDING";
}

export function normalizeEntry(entry = {}) {
  const status = normalizeStatus(entry.status);
  const dueDate = toDateKey(entry.dueDate ?? entry.date);
  const paidAt = status === "PAID" ? toDateKey(entry.paidAt) ?? dueDate : null;
  return {
    ...entry,
    type: normalizeType(entry.type),
    status,
    amount: Math.abs(Number(entry.amount) || 0),
    dueDate,
    paidAt,
  };
}

// The day an entry belongs to: when the money moved, or when it is expected.
export function effectiveDate(entry) {
  const normalized = normalizeEntry(entry);
  return normalized.status === "PAID" ? normalized.paidAt : normalized.dueDate;
}

// Newest first by the day an entry belongs to, then by creation. The ledger
// groups by that day's month, so every list it renders must be in this order.
export function byEffectiveDateDesc(a, b) {
  return (
    String(effectiveDate(b) ?? "").localeCompare(String(effectiveDate(a) ?? "")) ||
    String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""))
  );
}

// A real calendar day in YYYY-MM-DD form: "2026-02-31" is refused, where
// toDateKey() passes any plain key through untouched.
export function isDateKey(value) {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

export function signedAmount(entry) {
  const normalized = normalizeEntry(entry);
  return normalized.type === "EXPENSE" ? -normalized.amount : normalized.amount;
}

export function isOverdue(entry, now = new Date()) {
  const normalized = normalizeEntry(entry);
  return normalized.status === "PENDING" && Boolean(normalized.dueDate) && normalized.dueDate < todayKey(now);
}

// Days past due for a pending entry; 0 when it is not late.
export function daysOverdue(entry, now = new Date()) {
  if (!isOverdue(entry, now)) return 0;
  const due = new Date(`${normalizeEntry(entry).dueDate}T00:00:00`);
  const today = new Date(`${todayKey(now)}T00:00:00`);
  return Math.round((today.getTime() - due.getTime()) / DAY);
}

function sumAmounts(entries) {
  // Rounded to cents so repeated float additions never print 0.30000000004.
  return Math.round(entries.reduce((total, entry) => total + normalizeEntry(entry).amount, 0) * 100) / 100;
}

const byTypeAndStatus = (type, status) => (transactions = []) =>
  transactions.filter((entry) => {
    const normalized = normalizeEntry(entry);
    return normalized.type === type && normalized.status === status;
  });

// Only settled money counts toward revenue.
export const settledIncome = byTypeAndStatus("INCOME", "PAID");

// Only settled money counts toward expenses.
export const settledExpenses = byTypeAndStatus("EXPENSE", "PAID");

// Money that is still owed to the studio. Pending until it is paid, and never revenue.
export const openReceivables = byTypeAndStatus("INCOME", "PENDING");

// Money the studio still has to pay.
export const openPayables = byTypeAndStatus("EXPENSE", "PENDING");

export function pendingReceivables(transactions = []) {
  return sumAmounts(openReceivables(transactions));
}

export function pendingPayables(transactions = []) {
  return sumAmounts(openPayables(transactions));
}

export function overdueEntries(transactions = [], now = new Date()) {
  return transactions.filter((entry) => isOverdue(entry, now));
}

export function financialSummary(transactions = [], now = new Date()) {
  const revenue = sumAmounts(settledIncome(transactions));
  const expenses = sumAmounts(settledExpenses(transactions));
  const overdue = overdueEntries(transactions, now);

  return {
    revenue,
    expenses,
    result: Math.round((revenue - expenses) * 100) / 100,
    toReceive: pendingReceivables(transactions),
    toPay: pendingPayables(transactions),
    overdueReceivable: sumAmounts(overdue.filter((entry) => normalizeEntry(entry).type === "INCOME")),
    overduePayable: sumAmounts(overdue.filter((entry) => normalizeEntry(entry).type === "EXPENSE")),
    overdueCount: overdue.length,
  };
}

/* --- periods --------------------------------------------------------------- */

export const FINANCIAL_PERIODS = ["this_month", "last_month", "last_90", "this_year", "all"];

// [from, to] as inclusive date keys; null means unbounded.
export function periodRange(periodId, now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth();
  switch (periodId) {
    case "this_month":
      return [toDateKey(new Date(year, month, 1)), toDateKey(new Date(year, month + 1, 0))];
    case "last_month":
      return [toDateKey(new Date(year, month - 1, 1)), toDateKey(new Date(year, month, 0))];
    case "last_90":
      return [toDateKey(new Date(now.getTime() - 89 * DAY)), todayKey(now)];
    case "this_year":
      return [toDateKey(new Date(year, 0, 1)), toDateKey(new Date(year, 11, 31))];
    default:
      return [null, null];
  }
}

export function withinRange(entry, [from, to]) {
  const date = effectiveDate(entry);
  if (!from && !to) return true;
  if (!date) return false;
  return (!from || date >= from) && (!to || date <= to);
}

/* --- reports --------------------------------------------------------------- */

function monthKey(dateKey) {
  return dateKey ? dateKey.slice(0, 7) : null;
}

// Settled income and expenses per calendar month, oldest first, ending with the
// current month. Months with no movement are kept, so the bars never skip.
export function monthlyCashFlow(transactions = [], months = 6, now = new Date()) {
  const buckets = [];
  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    buckets.push({ month: monthKey(toDateKey(date)), income: 0, expense: 0 });
  }
  const index = new Map(buckets.map((bucket) => [bucket.month, bucket]));

  transactions.forEach((entry) => {
    const normalized = normalizeEntry(entry);
    if (normalized.status !== "PAID") return;
    const bucket = index.get(monthKey(normalized.paidAt));
    if (!bucket) return;
    if (normalized.type === "INCOME") bucket.income += normalized.amount;
    else bucket.expense += normalized.amount;
  });

  return buckets.map((bucket) => ({
    ...bucket,
    income: Math.round(bucket.income * 100) / 100,
    expense: Math.round(bucket.expense * 100) / 100,
    result: Math.round((bucket.income - bucket.expense) * 100) / 100,
  }));
}

// Settled amounts per category for one type, largest first, with its share.
export function categoryBreakdown(transactions = [], type = "EXPENSE") {
  const totals = new Map();
  transactions.forEach((entry) => {
    const normalized = normalizeEntry(entry);
    if (normalized.type !== type || normalized.status !== "PAID") return;
    const category = normalized.category || "OTHER";
    totals.set(category, (totals.get(category) ?? 0) + normalized.amount);
  });
  const total = [...totals.values()].reduce((sum, value) => sum + value, 0);
  return [...totals.entries()]
    .map(([category, amount]) => ({
      category,
      amount: Math.round(amount * 100) / 100,
      share: total ? amount / total : 0,
    }))
    .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category));
}

// Settled income per client, largest first. Entries with no client are left
// out: "no client" is not a customer to rank.
export function revenueByClient(transactions = [], limit = 5) {
  const totals = new Map();
  transactions.forEach((entry) => {
    const normalized = normalizeEntry(entry);
    if (normalized.type !== "INCOME" || normalized.status !== "PAID") return;
    const key = normalized.clientId || normalized.client;
    if (!key) return;
    const current = totals.get(key) ?? { key, clientId: normalized.clientId ?? null, name: normalized.clientName || normalized.client || "", amount: 0 };
    current.amount += normalized.amount;
    totals.set(key, current);
  });
  return [...totals.values()]
    .map((item) => ({ ...item, amount: Math.round(item.amount * 100) / 100 }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

// Open receivables split by how late they are.
export const AGING_BUCKETS = ["current", "d1_30", "d31_60", "d60_plus"];

export function receivablesAging(transactions = [], now = new Date()) {
  const buckets = Object.fromEntries(AGING_BUCKETS.map((key) => [key, { key, amount: 0, count: 0 }]));
  openReceivables(transactions).forEach((entry) => {
    const late = daysOverdue(entry, now);
    const key = late === 0 ? "current" : late <= 30 ? "d1_30" : late <= 60 ? "d31_60" : "d60_plus";
    buckets[key].amount += normalizeEntry(entry).amount;
    buckets[key].count += 1;
  });
  return AGING_BUCKETS.map((key) => ({ ...buckets[key], amount: Math.round(buckets[key].amount * 100) / 100 }));
}

/* --- installments ------------------------------------------------------------ */

// Splits a total into `count` monthly entries. Cents that do not divide evenly
// go to the first installment, so the parts always add back to the total.
export function splitInstallments({ amount, count, dueDate }) {
  const parts = Math.max(1, Math.min(60, Math.trunc(Number(count) || 1)));
  const cents = Math.round(Number(amount) * 100);
  const base = Math.floor(cents / parts);
  const remainder = cents - base * parts;
  const [y, m, d] = String(toDateKey(dueDate) ?? todayKey()).split("-").map(Number);

  return Array.from({ length: parts }, (_, index) => {
    // Clamp to the last day of the month, so the 31st becomes 30/28 instead of
    // spilling into the next month.
    const lastDay = new Date(y, m - 1 + index + 1, 0).getDate();
    const due = new Date(y, m - 1 + index, Math.min(d, lastDay));
    return {
      index: index + 1,
      count: parts,
      amount: (base + (index === 0 ? remainder : 0)) / 100,
      dueDate: toDateKey(due),
    };
  });
}

// "1.234,56", "1234.56", "R$ 1.234" -> 1234.56. Returns NaN for anything else.
export function parseAmount(value) {
  if (typeof value === "number") return value;
  let text = String(value ?? "").replace(/[R$\s]/g, "").trim();
  if (!text) return Number.NaN;
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma > lastDot) {
    // Comma is the decimal separator: dots are thousands.
    text = text.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma && lastComma !== -1) {
    // Dot is the decimal separator: commas are thousands.
    text = text.replace(/,/g, "");
  } else if (lastComma === -1 && /^\d{1,3}(\.\d{3})+$/.test(text)) {
    // "1.234" with no decimals reads as pt-BR thousands.
    text = text.replace(/\./g, "");
  }
  return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : Number.NaN;
}
