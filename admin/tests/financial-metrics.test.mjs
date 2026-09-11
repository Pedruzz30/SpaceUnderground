// Ledger rules shared by the Dashboard and the Financial page. Both screens
// derive their figures from these functions, so a divergence between them can
// only come from a bug proved here.
//
//   npm test

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { financialSummary, pendingReceivables } from "../src/utils/financial-metrics.js";

const ledger = [
  { type: "INCOME", status: "PAID", amount: 1750 },
  { type: "INCOME", status: "PAID", amount: 3200 },
  { type: "INCOME", status: "PENDING", amount: 5000 },
  { type: "EXPENSE", status: "PAID", amount: -90 },
  { type: "EXPENSE", status: "PAID", amount: -160 },
  { type: "RECEIVABLE", status: "PENDING", amount: 1000 },
  { type: "RECEIVABLE", status: "PENDING", amount: 1750 },
  { type: "RECEIVABLE", status: "PAID", amount: 900 },
];

describe("financial summary", () => {
  it("counts settled income as revenue", () => {
    assert.equal(financialSummary(ledger).revenue, 4950);
  });

  it("leaves income that has not settled out of revenue", () => {
    assert.equal(financialSummary([{ type: "INCOME", status: "PENDING", amount: 5000 }]).revenue, 0);
  });

  it("counts settled expenses, taking the absolute amount", () => {
    assert.equal(financialSummary(ledger).expenses, 250);
  });

  it("never counts a pending receivable as revenue", () => {
    const summary = financialSummary(ledger);
    assert.equal(summary.revenue, 4950, "the two paid incomes only");
    assert.equal(summary.toReceive, 2750, "the receivables stay in their own bucket");
  });

  it("derives the result from revenue minus expenses", () => {
    const summary = financialSummary(ledger);
    assert.equal(summary.result, summary.revenue - summary.expenses);
    assert.equal(summary.result, 4700);
  });

  it("returns zeroes for an empty ledger rather than NaN", () => {
    assert.deepEqual(financialSummary([]), { revenue: 0, expenses: 0, result: 0, toReceive: 0 });
  });

  it("survives being called with no argument at all", () => {
    assert.equal(financialSummary().result, 0);
  });
});

describe("open receivables", () => {
  it("totals every pending receivable", () => {
    assert.equal(pendingReceivables(ledger), 2750);
  });

  it("ignores a receivable that has already been settled", () => {
    assert.equal(pendingReceivables([{ type: "RECEIVABLE", status: "PAID", amount: 900 }]), 0);
  });

  it("ignores income and expenses entirely", () => {
    assert.equal(pendingReceivables(ledger.filter((entry) => entry.type !== "RECEIVABLE")), 0);
  });

  it("returns zero for an empty ledger", () => {
    assert.equal(pendingReceivables([]), 0);
  });

  it("agrees with the summary it feeds", () => {
    assert.equal(financialSummary(ledger).toReceive, pendingReceivables(ledger));
  });
});
