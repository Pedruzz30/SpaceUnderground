// Applies the whole migration chain to a real Postgres engine (PGlite) and
// exercises the financial foundation: constraints, the paid_at rule, the
// optional client and project links, and row level security.
//
//   npm test
//
// No Docker, no Supabase project and no credentials required.

import { strict as assert } from "node:assert";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { applyMigrations, readMigration } from "./helpers/migration-files.mjs";
import { ADMIN_ONLY, policyMatrix, tableGrants } from "./helpers/policy-matrix.mjs";
import { ADMIN_ID, USER_ID, addVerifiedFactor, asRole as runAs, createSupabaseDb, failure as fails } from "./helpers/supabase-db.mjs";

const FINANCIAL = readMigration("financial_foundation");
const { FINANCIAL_COLUMNS } = await import("../src/services/mappers/financial-mapper.js");

let db;
let caseNumber = 500;

const asRole = (role, uid, fn) => runAs(db, role, uid, fn);
const failure = (sql, params) => fails(db, sql, params);

async function insertEntry(values = {}) {
  const row = { type: "INCOME", description: "Installment", amount: 100, due_date: "2026-09-10", ...values };
  const columns = Object.keys(row);
  const { rows } = await db.query(
    `insert into public.financial_transactions (${columns.join(", ")}) values (${columns.map((_, index) => `$${index + 1}`).join(", ")}) returning *`,
    Object.values(row),
  );
  return rows[0];
}

async function today() {
  const { rows } = await db.query("select current_date::text as day");
  return rows[0].day;
}

const dayOf = (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10));

before(async () => {
  db = await createSupabaseDb();
  // The admin is one from before the security foundation, which makes them an
  // OWNER, as it does in production, with the TOTP factor an OWNER needs.
  await applyMigrations(db, { legacyAdmins: [ADMIN_ID] });
  await addVerifiedFactor(db, ADMIN_ID);
});

after(async () => {
  await db?.close();
});

describe("financial foundation migration", () => {
  it("refuses to run before clients and projects exist", async () => {
    const empty = new PGlite();
    try {
      await assert.rejects(() => empty.exec(FINANCIAL), /financial_foundation requires/);
    } finally {
      await empty.close();
    }
  });

  it("is idempotent", async () => {
    await db.exec(FINANCIAL);
    await db.exec(FINANCIAL);
  });

  it("creates every column the admin repository selects", async () => {
    const { rows } = await db.query(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'financial_transactions'",
    );
    const existing = new Set(rows.map((row) => row.column_name));
    assert.deepEqual(FINANCIAL_COLUMNS.split(",").filter((column) => !existing.has(column)), []);
  });
});

describe("financial constraints", () => {
  it("defaults to a pending BRL entry in the OTHER category", async () => {
    const entry = await insertEntry();
    assert.equal(entry.status, "PENDING");
    assert.equal(entry.currency, "BRL");
    assert.equal(entry.category, "OTHER");
    assert.equal(entry.paid_at, null);
  });

  for (const [label, values] of [
    ["a zero amount", { amount: 0 }],
    ["a negative amount", { amount: -10 }],
    ["an unknown type", { type: "RECEIVABLE" }],
    ["an unknown status", { status: "LATE" }],
    ["an unknown category", { category: "CRYPTO" }],
    ["a blank description", { description: "   " }],
    ["another currency", { currency: "USD" }],
  ]) {
    it(`rejects ${label}`, async () => {
      await assert.rejects(() => insertEntry(values), (error) => error.code === "23514");
    });
  }

  it("requires a due date", async () => {
    await assert.rejects(() => insertEntry({ due_date: null }), (error) => error.code === "23502");
  });
});

describe("financial paid_at", () => {
  it("stamps today when an entry is created as paid without a date", async () => {
    const entry = await insertEntry({ status: "PAID" });
    assert.equal(dayOf(entry.paid_at), await today());
  });

  it("keeps a payment date that was given", async () => {
    const entry = await insertEntry({ status: "PAID", paid_at: "2026-09-01" });
    assert.equal(dayOf(entry.paid_at), "2026-09-01");
  });

  it("stamps today when a pending entry is settled, and keeps it on later edits", async () => {
    const entry = await insertEntry();
    const { rows: [paid] } = await db.query("update public.financial_transactions set status = 'PAID' where id = $1 returning *", [entry.id]);
    assert.equal(dayOf(paid.paid_at), await today());
    const { rows: [edited] } = await db.query("update public.financial_transactions set description = 'Renamed' where id = $1 returning *", [entry.id]);
    assert.equal(dayOf(edited.paid_at), dayOf(paid.paid_at));
  });

  it("clears the payment date when an entry leaves PAID, even if one is sent", async () => {
    const entry = await insertEntry({ status: "PAID", paid_at: "2026-09-01" });
    const { rows: [reopened] } = await db.query(
      "update public.financial_transactions set status = 'PENDING', paid_at = '2026-09-02' where id = $1 returning *",
      [entry.id],
    );
    assert.equal(reopened.paid_at, null);
  });

  it("moves updated_at on every edit", async () => {
    const entry = await insertEntry();
    await db.query("select pg_sleep(0.01)");
    const { rows: [edited] } = await db.query("update public.financial_transactions set notes = 'n' where id = $1 returning *", [entry.id]);
    assert.ok(new Date(edited.updated_at) > new Date(entry.updated_at));
  });
});

describe("financial links", () => {
  it("keeps the entry and drops the link when the client or project is removed", async () => {
    const { rows: [client] } = await db.query("insert into public.clients (name, status) values ('Ledger Client', 'ACTIVE') returning id");
    caseNumber += 1;
    const { rows: [project] } = await db.query(
      "insert into public.projects (case_number, name, slug) values ($1, 'Ledger Case', $2) returning id",
      [caseNumber, `ledger-case-${caseNumber}`],
    );
    const entry = await insertEntry({ client_id: client.id, project_id: project.id });

    await db.query("delete from public.clients where id = $1", [client.id]);
    await db.query("delete from public.projects where id = $1", [project.id]);

    const { rows: [kept] } = await db.query("select client_id, project_id from public.financial_transactions where id = $1", [entry.id]);
    assert.deepEqual(kept, { client_id: null, project_id: null });
  });

  it("rejects a link to a client that does not exist", async () => {
    await assert.rejects(
      () => insertEntry({ client_id: "33333333-3333-3333-3333-333333333333" }),
      (error) => error.code === "23503",
    );
  });
});

describe("financial row level security", () => {
  it("gives anonymous visitors no grant and no rows", async () => {
    await insertEntry({ description: "Private" });
    const { rows: grants } = await db.query(
      "select privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = 'financial_transactions' and grantee = 'anon'",
    );
    assert.deepEqual(grants, []);
    const error = await asRole("anon", null, () => failure("select * from public.financial_transactions"));
    assert.equal(error?.code, "42501");
  });

  it("hides every entry from an authenticated user who is not an admin", async () => {
    const { rows } = await asRole("authenticated", USER_ID, () => db.query("select * from public.financial_transactions"));
    assert.equal(rows.length, 0);
  });

  it("blocks writes from an authenticated user who is not an admin", async () => {
    const error = await asRole("authenticated", USER_ID, () =>
      failure("insert into public.financial_transactions (type, description, amount, due_date) values ('INCOME', 'Intruder', 1, '2026-09-01')"),
    );
    assert.equal(error?.code, "42501");

    const target = await insertEntry({ description: "Protected" });
    const updated = await asRole("authenticated", USER_ID, () =>
      db.query("update public.financial_transactions set amount = 1 where id = $1 returning id", [target.id]),
    );
    assert.equal(updated.rows.length, 0);
    const deleted = await asRole("authenticated", USER_ID, () =>
      db.query("delete from public.financial_transactions where id = $1 returning id", [target.id]),
    );
    assert.equal(deleted.rows.length, 0);
  });

  it("lets an admin create, settle, read and delete entries", async () => {
    const created = await asRole("authenticated", ADMIN_ID, async () => {
      const { rows } = await db.query(
        "insert into public.financial_transactions (type, description, amount, due_date) values ('EXPENSE', 'Hosting', 90, '2026-09-02') returning *",
      );
      return rows[0];
    });
    assert.equal(created.status, "PENDING");

    const paid = await asRole("authenticated", ADMIN_ID, async () => {
      const { rows } = await db.query("update public.financial_transactions set status = 'PAID' where id = $1 returning *", [created.id]);
      return rows[0];
    });
    assert.ok(paid.paid_at);

    const removed = await asRole("authenticated", ADMIN_ID, () =>
      db.query("delete from public.financial_transactions where id = $1 returning id", [created.id]),
    );
    assert.equal(removed.rows.length, 1);
  });
});

describe("financial access matrix", () => {
  it("is admin-only for every verb: anon is refused, a signed-in non-admin sees and touches nothing", async () => {
    const matrix = await policyMatrix(db, {
      table: "financial_transactions",
      seed: async () => (await insertEntry({ description: "Matrix row" })).id,
      insertSql: "insert into public.financial_transactions (type, description, amount, due_date) values ('INCOME', 'Matrix insert', 10, '2026-09-01') returning id",
      updateSet: "amount = 11",
    });
    assert.deepEqual(matrix, ADMIN_ONLY);
  });

  it("grants the table to authenticated and service_role only", async () => {
    assert.deepEqual(await tableGrants(db, "financial_transactions", "anon"), []);
    for (const grantee of ["authenticated", "service_role"]) {
      const grants = await tableGrants(db, "financial_transactions", grantee);
      for (const verb of ["DELETE", "INSERT", "SELECT", "UPDATE"]) assert.ok(grants.includes(verb), `${grantee} lacks ${verb}`);
    }
  });
});

describe("installments are stored whole or not at all", () => {
  // The Supabase repository sends a set of installments as one multi-row
  // INSERT (see supabase-repositories.test.mjs). This is what Postgres does
  // with one: a single bad row rolls the whole statement back.
  it("stores no installment when one of them is refused", async () => {
    const before = await db.query("select count(*)::int as total from public.financial_transactions where description like 'Atomic %'");
    const error = await failure(
      `insert into public.financial_transactions (type, description, amount, due_date) values
        ('INCOME', 'Atomic (1/3)', 100, '2026-10-10'),
        ('INCOME', 'Atomic (2/3)', 100, '2026-11-10'),
        ('INCOME', 'Atomic (3/3)', 0, '2026-12-10')`,
    );
    assert.equal(error?.code, "23514", "the third row breaks amount > 0");
    const after = await db.query("select count(*)::int as total from public.financial_transactions where description like 'Atomic %'");
    assert.equal(after.rows[0].total, before.rows[0].total, "the first two rows were not kept");
  });

  it("stores the whole set when every row is valid", async () => {
    const { rows } = await asRole("authenticated", ADMIN_ID, () =>
      db.query(
        `insert into public.financial_transactions (type, description, amount, due_date) values
          ('INCOME', 'Whole (1/2)', 50.01, '2026-10-10'),
          ('INCOME', 'Whole (2/2)', 49.99, '2026-11-10') returning amount`,
      ),
    );
    assert.deepEqual(rows.map((row) => Number(row.amount)), [50.01, 49.99]);
  });
});
