// Financial V2 data layer: mapper, validation and the financial service
// running against the mock repository. No browser and no Supabase credentials.
//
//   npm test

import { strict as assert } from "node:assert";
import { beforeEach, describe, it } from "node:test";

function createStorageStub() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
  };
}

globalThis.localStorage = createStorageStub();

const { setLocale } = await import("../src/i18n/index.js");
const { clearMockFinancial, mockFinancialRepository, resetMockFinancial } = await import(
  "../src/services/repositories/mock-financial-repository.js"
);
const { resetMockActivity } = await import("../src/services/repositories/mock-activity-repository.js");
const { getActivity } = await import("../src/services/activity-service.js");
const {
  cancelTransaction,
  createTransaction,
  deleteTransaction,
  duplicateTransaction,
  getTransactions,
  getTransactionsWithStatus,
  markTransactionPaid,
  reopenTransaction,
  sanitizeTransaction,
  updateTransaction,
  validateTransaction,
} = await import("../src/services/financial-service.js");
const { mapTransactionFromDatabase, mapTransactionToDatabase, stampPaidAt } = await import(
  "../src/services/mappers/financial-mapper.js"
);
const { todayKey } = await import("../src/utils/financial-metrics.js");
const { buildSeedTransactions } = await import("../src/data/financial.js");
const { financialSummary } = await import("../src/utils/financial-metrics.js");

// Messages are asserted in English; the service resolves them at throw time.
setLocale("en", { persist: false });

const base = {
  type: "INCOME",
  status: "PENDING",
  description: "Aurora / first installment",
  category: "PROJECT",
  amount: "1.500,00",
  dueDate: "2026-10-05",
};

async function rejectsOn(field, promise) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, "validation");
    assert.equal(error.field, field);
    return true;
  });
}

beforeEach(() => {
  clearMockFinancial();
  resetMockActivity();
});

describe("financial mapper", () => {
  it("reads a PostgREST row, including numeric amounts sent as strings", () => {
    const model = mapTransactionFromDatabase({
      id: "u1",
      type: "expense",
      status: "paid",
      description: "Hosting",
      category: "infrastructure",
      amount: "90.00",
      currency: "BRL",
      due_date: "2026-09-02",
      paid_at: "2026-09-03",
      client_id: null,
      project_id: "p1",
      notes: null,
      created_at: "2026-09-01T10:00:00+00:00",
      updated_at: "2026-09-03T10:00:00+00:00",
    });
    assert.equal(model.type, "EXPENSE");
    assert.equal(model.status, "PAID");
    assert.equal(model.category, "INFRASTRUCTURE");
    assert.equal(model.amount, 90);
    assert.equal(model.paidAt, "2026-09-03");
    assert.equal(model.projectId, "p1");
    assert.equal(model.notes, "");
  });

  it("writes only the fields present, blanks as null, and no payment date unless paid", () => {
    assert.deepEqual(mapTransactionToDatabase({ notes: "  " }), { notes: null });
    assert.deepEqual(mapTransactionToDatabase({ status: "PENDING", paidAt: "2026-09-01" }), { status: "PENDING", paid_at: null });
    assert.deepEqual(mapTransactionToDatabase({ status: "PAID", paidAt: "2026-09-01" }), { status: "PAID", paid_at: "2026-09-01" });
    assert.deepEqual(mapTransactionToDatabase({ amount: 10.005 }), { amount: 10.01 });
  });

  it("stamps paid_at the way the database trigger does", () => {
    assert.equal(stampPaidAt(null, { status: "PAID", paidAt: null }, "2026-09-20"), "2026-09-20");
    assert.equal(stampPaidAt({ status: "PAID", paidAt: "2026-09-01" }, { status: "PAID", paidAt: null }, "2026-09-20"), "2026-09-01");
    assert.equal(stampPaidAt(null, { status: "PAID", paidAt: "2026-09-05" }, "2026-09-20"), "2026-09-05");
    assert.equal(stampPaidAt({ status: "PAID", paidAt: "2026-09-01" }, { status: "PENDING", paidAt: "2026-09-01" }), null);
  });
});

describe("financial validation", () => {
  it("accepts a complete entry", () => {
    assert.deepEqual(validateTransaction(sanitizeTransaction(base)), {});
  });

  it("parses the amount a person typed", () => {
    assert.equal(sanitizeTransaction({ amount: "1.500,50" }).amount, 1500.5);
  });

  it("refuses a missing description, a zero amount and a missing due date", () => {
    const errors = validateTransaction(sanitizeTransaction({ ...base, description: " ", amount: "0", dueDate: "" }));
    assert.deepEqual(Object.keys(errors).sort(), ["amount", "description", "dueDate"]);
  });

  it("refuses more than two decimals and a category from the other type", () => {
    assert.ok(validateTransaction(sanitizeTransaction({ ...base, amount: "10,005" })).amount);
    assert.ok(validateTransaction(sanitizeTransaction({ ...base, category: "TAXES" })).category);
  });

  it("refuses a payment date in the future", () => {
    const errors = validateTransaction(sanitizeTransaction({ ...base, status: "PAID", paidAt: "2999-01-01" }));
    assert.ok(errors.paidAt);
  });

  it("drops the payment date from anything that is not paid", () => {
    assert.equal(sanitizeTransaction({ status: "PENDING", paidAt: "2026-09-01" }).paidAt, null);
  });

  it("only splits pending entries, into 1 to 60 parts", () => {
    assert.ok(validateTransaction(sanitizeTransaction(base), { installments: 0 }).installments);
    assert.ok(validateTransaction(sanitizeTransaction(base), { installments: 61 }).installments);
    assert.ok(validateTransaction(sanitizeTransaction({ ...base, status: "PAID" }), { installments: 3 }).installments);
    assert.deepEqual(validateTransaction(sanitizeTransaction(base), { installments: 12 }), {});
  });
});

describe("financial service", () => {
  it("creates an entry and logs it", async () => {
    const [created] = await createTransaction(base);
    assert.equal(created.amount, 1500);
    assert.equal(created.status, "PENDING");
    assert.equal(created.paidAt, null);
    assert.equal((await getTransactions()).length, 1);
    const [log] = await getActivity();
    assert.equal(log.action, "financial.created");
    assert.equal(log.entityType, "financial");
    assert.equal(log.entityId, created.id);
  });

  it("refuses an invalid entry and stores nothing", async () => {
    await rejectsOn("amount", createTransaction({ ...base, amount: "-10" }));
    assert.equal((await getTransactions()).length, 0);
  });

  it("creates installments that split the total and are named in order", async () => {
    const created = await createTransaction({ ...base, amount: "1000" }, { installments: 3 });
    assert.deepEqual(created.map((entry) => entry.amount), [333.34, 333.33, 333.33]);
    assert.deepEqual(created.map((entry) => entry.dueDate), ["2026-10-05", "2026-11-05", "2026-12-05"]);
    assert.match(created[0].description, /\(1\/3\)$/);
    assert.ok(created.every((entry) => entry.status === "PENDING"));
    const [log] = await getActivity();
    assert.equal(log.action, "financial.installments_created");
  });

  it("settles an entry today and logs the settlement", async () => {
    const [created] = await createTransaction(base);
    const paid = await markTransactionPaid(created.id);
    assert.equal(paid.status, "PAID");
    assert.equal(paid.paidAt, todayKey());
    assert.equal((await getActivity())[0].action, "financial.paid");
  });

  it("keeps a payment date given for a settlement", async () => {
    const [created] = await createTransaction(base);
    const paid = await markTransactionPaid(created.id, "2026-09-01");
    assert.equal(paid.paidAt, "2026-09-01");
  });

  it("reopens a paid entry and clears its payment date", async () => {
    const [created] = await createTransaction(base);
    await markTransactionPaid(created.id);
    const reopened = await reopenTransaction(created.id);
    assert.equal(reopened.status, "PENDING");
    assert.equal(reopened.paidAt, null);
    assert.equal((await getActivity())[0].action, "financial.reopened");
  });

  it("cancels an entry, which then counts nowhere", async () => {
    const [created] = await createTransaction(base);
    await cancelTransaction(created.id);
    const summary = financialSummary(await getTransactions());
    assert.equal(summary.toReceive, 0);
    assert.equal((await getActivity())[0].action, "financial.cancelled");
  });

  it("moves a changed type to a category that belongs to it", async () => {
    const [created] = await createTransaction(base);
    const updated = await updateTransaction(created.id, { type: "EXPENSE" });
    assert.equal(updated.type, "EXPENSE");
    assert.equal(updated.category, "OTHER");
  });

  it("duplicates a paid entry as a pending one, so money is never counted twice", async () => {
    const [created] = await createTransaction(base);
    await markTransactionPaid(created.id);
    const copy = await duplicateTransaction(created.id);
    assert.notEqual(copy.id, created.id);
    assert.equal(copy.status, "PENDING");
    assert.equal(copy.dueDate, todayKey());
    assert.equal(financialSummary(await getTransactions()).revenue, 1500);
  });

  it("deletes an entry and logs it", async () => {
    const [created] = await createTransaction(base);
    await deleteTransaction(created.id);
    assert.equal((await getTransactions()).length, 0);
    assert.equal((await getActivity())[0].action, "financial.deleted");
  });

  it("reports an unknown entry as not found", async () => {
    await assert.rejects(updateTransaction("missing", { description: "x" }), (error) => error.code === "not_found");
    await assert.rejects(deleteTransaction("missing"), (error) => error.code === "not_found");
  });

  it("never throws from the summary read used by the Dashboard", async () => {
    const original = mockFinancialRepository.list;
    mockFinancialRepository.list = async () => {
      throw new Error("offline");
    };
    try {
      assert.deepEqual(await getTransactionsWithStatus(), { items: [], ok: false });
    } finally {
      mockFinancialRepository.list = original;
    }
  });
});

describe("financial mock seed", () => {
  it("is a valid ledger with current, overdue, pending and cancelled entries", () => {
    resetMockFinancial();
    const seed = buildSeedTransactions();
    assert.ok(seed.every((entry) => entry.amount > 0 && entry.description && entry.dueDate));
    assert.ok(seed.every((entry) => (entry.status === "PAID") === Boolean(entry.paidAt)), "paid_at matches status");
    const statuses = new Set(seed.map((entry) => entry.status));
    assert.deepEqual([...statuses].sort(), ["CANCELLED", "PAID", "PENDING"]);
  });
});
