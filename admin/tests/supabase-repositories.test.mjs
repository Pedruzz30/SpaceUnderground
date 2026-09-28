// What the Supabase repositories actually send, against a fake client that
// behaves like PostgREST: a multi-row insert is one request, and every
// response is cut at the project's row limit without an error.
//
//   npm test

import { strict as assert } from "node:assert";
import { afterEach, describe, it } from "node:test";

const { setSupabaseClientForTests } = await import("../src/lib/supabase.js");
const { supabaseFinancialRepository } = await import("../src/services/repositories/supabase-financial-repository.js");
const { supabaseCommercialRepository } = await import("../src/services/repositories/supabase-commercial-repository.js");
const { selectAll } = await import("../src/services/repositories/supabase-select-all.js");

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// cap: max_rows, the most rows one response may carry.
function fakePostgrest({ tables = {}, cap = 1000, failInsert = null } = {}) {
  const requests = [];

  function execute(request) {
    const rows = (tables[request.table] ??= []);
    if (request.op === "insert") {
      if (failInsert) return { data: null, error: failInsert, count: null };
      const stored = request.rows.map((row, index) => ({ id: uuid(rows.length + index + 1), created_at: "2026-09-28T12:00:00Z", ...row }));
      rows.push(...stored);
      return { data: stored, error: null, count: null };
    }
    const matching = rows.filter((row) => request.filters.every(([column, value]) => row[column] === value));
    const [from, to] = request.range ?? [0, Number.MAX_SAFE_INTEGER];
    const page = matching.slice(from, Math.min(to + 1, from + cap));
    return { data: page, error: null, count: request.count ? matching.length : null };
  }

  function from(table) {
    const request = { table, op: "select", filters: [], orders: [], range: null, count: null, rows: null };
    const query = {
      select(columns, options) {
        if (request.op === "select") request.count = options?.count ?? null;
        return query;
      },
      insert(rows) {
        request.op = "insert";
        request.rows = rows;
        return query;
      },
      eq(column, value) {
        request.filters.push([column, value]);
        return query;
      },
      order(column, options = {}) {
        request.orders.push(`${column}.${options.ascending === false ? "desc" : "asc"}`);
        return query;
      },
      range(start, end) {
        request.range = [start, end];
        return query;
      },
      then(resolve, reject) {
        requests.push({ ...request, rows: request.rows ? [...request.rows] : null });
        return Promise.resolve(execute(request)).then(resolve, reject);
      },
    };
    return query;
  }

  return { client: { from }, requests, tables };
}

const ledgerRows = (count) =>
  Array.from({ length: count }, (_, index) => ({
    id: uuid(index + 1),
    type: "INCOME",
    status: "PENDING",
    description: `Entry ${index + 1}`,
    category: "PROJECT",
    amount: "10.00",
    due_date: "2026-10-10",
  }));

afterEach(() => setSupabaseClientForTests(null));

describe("installments reach Supabase as one write", () => {
  const parts = [1, 2, 3].map((index) => ({
    type: "INCOME",
    status: "PENDING",
    description: `Website (${index}/3)`,
    category: "PROJECT",
    amount: 1000,
    dueDate: `2026-1${index - 1}-10`,
    clientId: null,
    opportunityId: uuid(99),
  }));

  it("sends every installment in a single insert request", async () => {
    const fake = fakePostgrest();
    setSupabaseClientForTests(fake.client);
    const created = await supabaseFinancialRepository.createMany(parts);

    const inserts = fake.requests.filter((request) => request.op === "insert");
    assert.equal(inserts.length, 1, "one request, so Postgres runs one statement");
    assert.equal(inserts[0].rows.length, 3);
    assert.deepEqual(inserts[0].rows.map((row) => row.opportunity_id), [uuid(99), uuid(99), uuid(99)], "each part records its deal");
    assert.equal(created.length, 3);
  });

  it("stores nothing and reports the refusal when the insert fails", async () => {
    const fake = fakePostgrest({ failInsert: { code: "23514", message: "financial_transactions_amount_check" } });
    setSupabaseClientForTests(fake.client);
    await assert.rejects(supabaseFinancialRepository.createMany(parts));
    assert.equal(fake.requests.length, 1, "no retry, no per-row fallback");
    assert.equal((fake.tables.financial_transactions ?? []).length, 0);
  });
});

describe("full reads past PostgREST's row limit", () => {
  it("reads the whole ledger when it is larger than one response", async () => {
    const fake = fakePostgrest({ tables: { financial_transactions: ledgerRows(2500) } });
    setSupabaseClientForTests(fake.client);
    const ledger = await supabaseFinancialRepository.list();

    assert.equal(ledger.length, 2500, "a plain select would have stopped at 1000");
    assert.equal(new Set(ledger.map((entry) => entry.id)).size, 2500, "no row read twice");
    assert.equal(fake.requests[0].count, "exact", "the first page asks for the total");
    assert.ok(fake.requests.slice(1).every((request) => request.count === null), "later pages do not");
    assert.deepEqual(fake.requests[0].orders, ["due_date.desc", "created_at.desc", "id.asc"], "a total order, so pages never overlap");
  });

  it("keeps reading when the project caps responses below the page size", async () => {
    const fake = fakePostgrest({ tables: { financial_transactions: ledgerRows(2500) }, cap: 300 });
    setSupabaseClientForTests(fake.client);
    assert.equal((await supabaseFinancialRepository.list()).length, 2500);
  });

  it("reads an empty ledger with a single request", async () => {
    const fake = fakePostgrest();
    setSupabaseClientForTests(fake.client);
    assert.deepEqual(await supabaseFinancialRepository.list(), []);
    assert.equal(fake.requests.length, 1);
  });

  it("pages the pipeline too", async () => {
    const deals = Array.from({ length: 1200 }, (_, index) => ({ id: uuid(index + 1), title: `Deal ${index + 1}`, stage: "NEW", position: index }));
    const fake = fakePostgrest({ tables: { commercial_opportunities: deals } });
    setSupabaseClientForTests(fake.client);
    assert.equal((await supabaseCommercialRepository.list()).length, 1200);
  });

  it("returns the error of the page that failed", async () => {
    let calls = 0;
    const result = await selectAll(() => ({
      range: async () => (++calls === 1 ? { data: [{ id: 1 }], count: 3, error: null } : { data: null, error: { code: "57014" } }),
    }));
    assert.deepEqual(result, { data: null, error: { code: "57014" } });
  });
});

describe("a deal's receivables", () => {
  it("asks only for the rows linked to the deal", async () => {
    const rows = ledgerRows(3).map((row, index) => ({ ...row, opportunity_id: index === 1 ? uuid(50) : null }));
    const fake = fakePostgrest({ tables: { financial_transactions: rows } });
    setSupabaseClientForTests(fake.client);
    const linked = await supabaseFinancialRepository.listByOpportunity(uuid(50));
    assert.deepEqual(linked.map((entry) => entry.description), ["Entry 2"]);
    assert.deepEqual(fake.requests[0].filters, [["opportunity_id", uuid(50)]]);
  });

  it("never sends a request for something that is not a deal id", async () => {
    const fake = fakePostgrest();
    setSupabaseClientForTests(fake.client);
    assert.deepEqual(await supabaseFinancialRepository.listByOpportunity("mock-opp-1"), []);
    assert.equal(fake.requests.length, 0);
  });
});
