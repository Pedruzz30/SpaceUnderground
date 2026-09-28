// Ledger rules shared by the Financial page, its reports and the Dashboard.
// Every screen derives its figures from these functions, so a divergence
// between them can only come from a bug proved here.
//
//   npm test

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  categoriesFor,
  categoryBreakdown,
  daysOverdue,
  effectiveDate,
  financialSummary,
  isOverdue,
  monthlyCashFlow,
  normalizeEntry,
  openPayables,
  openReceivables,
  parseAmount,
  pendingReceivables,
  periodRange,
  receivablesAging,
  revenueByClient,
  settledExpenses,
  settledIncome,
  signedAmount,
  splitInstallments,
  toDateKey,
  withinRange,
} from "../src/utils/financial-metrics.js";

// Local noon, so "today" is the same calendar day in every timezone.
const NOW = new Date(2026, 8, 20, 12, 0, 0);

const ledger = [
  { id: "income-paid-1", type: "INCOME", status: "PAID", amount: 1750, dueDate: "2026-09-18", paidAt: "2026-09-18", category: "PROJECT", clientId: "c1", clientName: "Aurora" },
  { id: "income-paid-2", type: "INCOME", status: "PAID", amount: 3200, dueDate: "2026-09-10", paidAt: "2026-09-12", category: "RETAINER", clientId: "c2", clientName: "Borealis" },
  { id: "income-pending-late", type: "INCOME", status: "PENDING", amount: 1000, dueDate: "2026-09-15", category: "PROJECT", clientId: "c1" },
  { id: "income-pending-future", type: "INCOME", status: "PENDING", amount: 1750, dueDate: "2026-10-10", category: "PROJECT" },
  { id: "expense-paid-1", type: "EXPENSE", status: "PAID", amount: 90, dueDate: "2026-09-02", paidAt: "2026-09-02", category: "INFRASTRUCTURE" },
  { id: "expense-paid-2", type: "EXPENSE", status: "PAID", amount: 160.5, dueDate: "2026-08-20", paidAt: "2026-08-20", category: "SOFTWARE" },
  { id: "expense-pending", type: "EXPENSE", status: "PENDING", amount: 450, dueDate: "2026-09-25", category: "FREELANCER" },
  { id: "income-cancelled", type: "INCOME", status: "CANCELLED", amount: 900, dueDate: "2026-09-01", category: "PROJECT", clientId: "c2" },
];

const ids = (entries) => entries.map((entry) => entry.id);

describe("financial summary", () => {
  it("counts only paid income as revenue", () => {
    assert.equal(financialSummary(ledger, NOW).revenue, 4950);
  });

  it("counts only paid expenses, keeping the cents", () => {
    assert.equal(financialSummary(ledger, NOW).expenses, 250.5);
  });

  it("derives the result from revenue minus expenses", () => {
    const summary = financialSummary(ledger, NOW);
    assert.equal(summary.result, summary.revenue - summary.expenses);
    assert.equal(summary.result, 4699.5);
  });

  it("keeps pending money in its own buckets and never counts it as revenue", () => {
    const summary = financialSummary(ledger, NOW);
    assert.equal(summary.toReceive, 2750);
    assert.equal(summary.toPay, 450);
  });

  it("reports what is overdue on each side", () => {
    const summary = financialSummary(ledger, NOW);
    assert.equal(summary.overdueReceivable, 1000);
    assert.equal(summary.overduePayable, 0);
    assert.equal(summary.overdueCount, 1);
  });

  it("leaves cancelled entries out of every figure", () => {
    const summary = financialSummary([ledger.at(-1)], NOW);
    assert.deepEqual([summary.revenue, summary.toReceive, summary.overdueCount], [0, 0, 0]);
  });

  it("returns zeroes for an empty ledger rather than NaN", () => {
    const summary = financialSummary([], NOW);
    assert.deepEqual(
      [summary.revenue, summary.expenses, summary.result, summary.toReceive, summary.toPay],
      [0, 0, 0, 0, 0],
    );
  });

  it("survives being called with no argument at all", () => {
    assert.equal(financialSummary().result, 0);
  });
});

describe("financial ledger groups", () => {
  it("splits the ledger into settled and open buckets with no overlap", () => {
    assert.deepEqual(ids(settledIncome(ledger)), ["income-paid-1", "income-paid-2"]);
    assert.deepEqual(ids(settledExpenses(ledger)), ["expense-paid-1", "expense-paid-2"]);
    assert.deepEqual(ids(openReceivables(ledger)), ["income-pending-late", "income-pending-future"]);
    assert.deepEqual(ids(openPayables(ledger)), ["expense-pending"]);
  });

  it("totals every pending receivable", () => {
    assert.equal(pendingReceivables(ledger), 2750);
  });
});

describe("legacy rows", () => {
  // The presentation ledger and older fixtures: RECEIVABLE type, a signed
  // amount and one `date`.
  const legacy = [
    { type: "RECEIVABLE", status: "PENDING", amount: 1000, date: "2026-09-10T15:00:00.000Z" },
    { type: "EXPENSE", status: "PAID", amount: -90, date: "2026-09-02T15:00:00.000Z" },
  ];

  it("reads a RECEIVABLE as pending income", () => {
    const entry = normalizeEntry(legacy[0]);
    assert.equal(entry.type, "INCOME");
    assert.equal(pendingReceivables(legacy), 1000);
  });

  it("takes the absolute amount and dates a settled row by its date", () => {
    const entry = normalizeEntry(legacy[1]);
    assert.equal(entry.amount, 90);
    assert.equal(entry.paidAt, entry.dueDate);
    assert.equal(signedAmount(legacy[1]), -90);
  });
});

describe("dates and overdue", () => {
  it("normalizes dates to calendar-day keys", () => {
    assert.equal(toDateKey("2026-09-20"), "2026-09-20");
    assert.equal(toDateKey(new Date(2026, 0, 5)), "2026-01-05");
    assert.equal(toDateKey(""), null);
    assert.equal(toDateKey("not a date"), null);
  });

  it("dates paid entries by payment and open ones by due date", () => {
    assert.equal(effectiveDate(ledger[1]), "2026-09-12");
    assert.equal(effectiveDate(ledger[3]), "2026-10-10");
  });

  it("flags only pending entries whose due date has passed", () => {
    assert.equal(isOverdue(ledger[2], NOW), true);
    assert.equal(isOverdue(ledger[3], NOW), false);
    assert.equal(isOverdue({ ...ledger[2], status: "PAID", paidAt: "2026-09-16" }, NOW), false);
    assert.equal(isOverdue({ ...ledger[2], dueDate: "2026-09-20" }, NOW), false, "due today is not late yet");
  });

  it("counts whole days past due", () => {
    assert.equal(daysOverdue(ledger[2], NOW), 5);
    assert.equal(daysOverdue(ledger[3], NOW), 0);
  });
});

describe("periods", () => {
  it("bounds this month and last month by calendar days", () => {
    assert.deepEqual(periodRange("this_month", NOW), ["2026-09-01", "2026-09-30"]);
    assert.deepEqual(periodRange("last_month", NOW), ["2026-08-01", "2026-08-31"]);
    assert.deepEqual(periodRange("this_year", NOW), ["2026-01-01", "2026-12-31"]);
    assert.deepEqual(periodRange("all", NOW), [null, null]);
  });

  it("rolls the 90 day window back from today", () => {
    assert.deepEqual(periodRange("last_90", NOW), ["2026-06-23", "2026-09-20"]);
  });

  it("scopes entries by their effective date", () => {
    const september = periodRange("this_month", NOW);
    assert.equal(withinRange(ledger[1], september), true, "paid on the 12th");
    assert.equal(withinRange(ledger[5], september), false, "paid in August");
    assert.equal(withinRange(ledger[3], september), false, "due in October");
    assert.equal(withinRange(ledger[5], [null, null]), true);
  });
});

describe("reports", () => {
  it("builds one bucket per month, oldest first, ending this month", () => {
    const flow = monthlyCashFlow(ledger, 3, NOW);
    assert.deepEqual(flow.map((point) => point.month), ["2026-07", "2026-08", "2026-09"]);
    assert.deepEqual(flow[2], { month: "2026-09", income: 4950, expense: 90, result: 4860 });
    assert.deepEqual(flow[1], { month: "2026-08", income: 0, expense: 160.5, result: -160.5 });
    assert.deepEqual(flow[0], { month: "2026-07", income: 0, expense: 0, result: 0 });
  });

  it("breaks paid expenses down by category, largest first, with shares", () => {
    const rows = categoryBreakdown(ledger, "EXPENSE");
    assert.deepEqual(rows.map((row) => row.category), ["SOFTWARE", "INFRASTRUCTURE"]);
    assert.equal(Math.round(rows[0].share * 1000) / 1000, 0.641);
  });

  it("ranks clients by revenue actually received", () => {
    const rows = revenueByClient(ledger);
    assert.deepEqual(rows.map((row) => [row.clientId, row.amount]), [["c2", 3200], ["c1", 1750]]);
  });

  it("ages open receivables by how late they are", () => {
    const aging = receivablesAging(
      [
        ...ledger,
        { type: "INCOME", status: "PENDING", amount: 300, dueDate: "2026-08-01" },
        { type: "INCOME", status: "PENDING", amount: 200, dueDate: "2026-06-01" },
      ],
      NOW,
    );
    assert.deepEqual(
      aging.map((bucket) => [bucket.key, bucket.amount, bucket.count]),
      [["current", 1750, 1], ["d1_30", 1000, 1], ["d31_60", 300, 1], ["d60_plus", 200, 1]],
    );
  });
});

describe("installments", () => {
  it("splits a total into monthly parts that add back to it", () => {
    const parts = splitInstallments({ amount: 1000, count: 3, dueDate: "2026-09-10" });
    assert.deepEqual(parts.map((part) => part.amount), [333.34, 333.33, 333.33]);
    assert.deepEqual(parts.map((part) => part.dueDate), ["2026-09-10", "2026-10-10", "2026-11-10"]);
    assert.equal(parts.reduce((total, part) => Math.round((total + part.amount) * 100) / 100, 0), 1000);
  });

  it("clamps the 31st to the last day of shorter months", () => {
    const parts = splitInstallments({ amount: 300, count: 3, dueDate: "2026-01-31" });
    assert.deepEqual(parts.map((part) => part.dueDate), ["2026-01-31", "2026-02-28", "2026-03-31"]);
  });
});

describe("amount parsing", () => {
  it("reads pt-BR and en number formats", () => {
    assert.equal(parseAmount("1.234,56"), 1234.56);
    assert.equal(parseAmount("1,234.56"), 1234.56);
    assert.equal(parseAmount("1234.56"), 1234.56);
    assert.equal(parseAmount("R$ 1.750"), 1750);
    assert.equal(parseAmount("99,9"), 99.9);
    assert.equal(parseAmount(42), 42);
  });

  it("rejects text that is not a number", () => {
    assert.ok(Number.isNaN(parseAmount("")));
    assert.ok(Number.isNaN(parseAmount("abc")));
    assert.ok(Number.isNaN(parseAmount("12,34,56")));
  });
});

describe("categories", () => {
  it("offers categories by type, with OTHER on both sides", () => {
    assert.ok(categoriesFor("INCOME").includes("RETAINER"));
    assert.ok(!categoriesFor("INCOME").includes("TAXES"));
    assert.ok(categoriesFor("EXPENSE").includes("TAXES"));
    assert.ok(categoriesFor("INCOME").includes("OTHER") && categoriesFor("EXPENSE").includes("OTHER"));
  });
});
