// Applies the whole migration chain to a real Postgres engine (PGlite) and
// exercises the commercial opportunities table: constraints, the stage
// bookkeeping trigger, the optional links and row level security.
//
//   npm test

import { strict as assert } from "node:assert";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { applyMigrations, readMigration } from "./helpers/migration-files.mjs";
import { ADMIN_ONLY, policyMatrix, tableGrants } from "./helpers/policy-matrix.mjs";
import { ADMIN_ID, USER_ID, addVerifiedFactor, asRole as runAs, createSupabaseDb, failure as fails } from "./helpers/supabase-db.mjs";

const COMMERCIAL = readMigration("commercial_opportunities");
const { OPPORTUNITY_COLUMNS } = await import("../src/services/mappers/commercial-mapper.js");

let db;
const asRole = (role, uid, fn) => runAs(db, role, uid, fn);
const failure = (sql, params) => fails(db, sql, params);

async function insertDeal(values = {}) {
  const row = { title: "Website", company: "Aurora", ...values };
  const columns = Object.keys(row);
  const { rows } = await db.query(
    `insert into public.commercial_opportunities (${columns.join(", ")}) values (${columns.map((_, index) => `$${index + 1}`).join(", ")}) returning *`,
    Object.values(row),
  );
  return rows[0];
}

async function updateDeal(id, set, params = []) {
  const { rows } = await db.query(`update public.commercial_opportunities set ${set} where id = $1 returning *`, [id, ...params]);
  return rows[0];
}

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

describe("commercial opportunities migration", () => {
  it("refuses to run before clients and plans exist", async () => {
    const empty = new PGlite();
    try {
      await assert.rejects(() => empty.exec(COMMERCIAL), /commercial_opportunities requires/);
    } finally {
      await empty.close();
    }
  });

  it("is idempotent", async () => {
    await db.exec(COMMERCIAL);
    await db.exec(COMMERCIAL);
  });

  it("creates every column the admin repository selects", async () => {
    const { rows } = await db.query(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'commercial_opportunities'",
    );
    const existing = new Set(rows.map((row) => row.column_name));
    assert.deepEqual(OPPORTUNITY_COLUMNS.split(",").filter((column) => !existing.has(column)), []);
  });

  it("leaves the proposals contract the automation service reads untouched", async () => {
    const { rows } = await db.query(
      "select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'commercial_proposals' and column_name in ('client_id', 'plan_id')",
    );
    assert.deepEqual(rows.map((row) => row.is_nullable), ["NO", "NO"]);
  });
});

describe("commercial constraints", () => {
  it("defaults to a new, medium priority deal from another source", async () => {
    const deal = await insertDeal();
    assert.deepEqual([deal.stage, deal.priority, deal.source, deal.closed_at], ["NEW", "MEDIUM", "OTHER", null]);
    assert.ok(deal.stage_changed_at);
  });

  for (const [label, values] of [
    ["a blank title", { title: "  " }],
    ["an unknown stage", { stage: "PAUSED" }],
    ["an unknown priority", { priority: "URGENT" }],
    ["an unknown source", { source: "TIKTOK" }],
    ["a negative value", { estimated_value: -1 }],
    ["an unknown loss reason", { stage: "LOST", lost_reason: "MOOD" }],
    ["a loss without a reason", { stage: "LOST" }],
  ]) {
    it(`rejects ${label}`, async () => {
      await assert.rejects(() => insertDeal(values), (error) => error.code === "23514");
    });
  }
});

describe("commercial stage bookkeeping", () => {
  it("restamps stage_changed_at on a stage change only", async () => {
    const deal = await insertDeal();
    await db.query("select pg_sleep(0.01)");
    const edited = await updateDeal(deal.id, "notes = 'hello'");
    assert.equal(new Date(edited.stage_changed_at).getTime(), new Date(deal.stage_changed_at).getTime());
    const moved = await updateDeal(deal.id, "stage = 'PROPOSAL'");
    assert.ok(new Date(moved.stage_changed_at) > new Date(deal.stage_changed_at));
  });

  it("ignores a stage_changed_at sent by the client", async () => {
    const deal = await insertDeal();
    const edited = await updateDeal(deal.id, "stage_changed_at = '2000-01-01'");
    assert.notEqual(new Date(edited.stage_changed_at).getUTCFullYear(), 2000);
  });

  it("stamps closed_at on a win, keeps it on edits and clears it on reopen", async () => {
    const deal = await insertDeal();
    const won = await updateDeal(deal.id, "stage = 'WON'");
    assert.ok(won.closed_at);
    const edited = await updateDeal(deal.id, "notes = 'signed'");
    assert.equal(new Date(edited.closed_at).getTime(), new Date(won.closed_at).getTime());
    const reopened = await updateDeal(deal.id, "stage = 'NEGOTIATION'");
    assert.equal(reopened.closed_at, null);
  });

  it("clears the loss reason when a lost deal is reopened", async () => {
    const deal = await insertDeal({ stage: "LOST", lost_reason: "PRICE" });
    assert.ok(deal.closed_at);
    const reopened = await updateDeal(deal.id, "stage = 'CONTACTED'");
    assert.equal(reopened.lost_reason, null);
  });
});

describe("commercial links", () => {
  it("keeps the deal and drops the link when the client or plan is removed", async () => {
    const { rows: [client] } = await db.query("insert into public.clients (name, status) values ('Deal Client', 'ACTIVE') returning id");
    const { rows: [plan] } = await db.query("select id from public.plans limit 1");
    const deal = await insertDeal({ client_id: client.id, plan_id: plan?.id ?? null });
    await db.query("delete from public.clients where id = $1", [client.id]);
    const { rows: [kept] } = await db.query("select client_id from public.commercial_opportunities where id = $1", [deal.id]);
    assert.equal(kept.client_id, null);
  });
});

describe("commercial row level security", () => {
  it("gives anonymous visitors no grant and no rows", async () => {
    await insertDeal({ title: "Private" });
    const { rows: grants } = await db.query(
      "select privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = 'commercial_opportunities' and grantee = 'anon'",
    );
    assert.deepEqual(grants, []);
    const error = await asRole("anon", null, () => failure("select * from public.commercial_opportunities"));
    assert.equal(error?.code, "42501");
  });

  it("hides every deal from an authenticated user who is not an admin", async () => {
    const { rows } = await asRole("authenticated", USER_ID, () => db.query("select * from public.commercial_opportunities"));
    assert.equal(rows.length, 0);
  });

  it("blocks writes from an authenticated user who is not an admin", async () => {
    const error = await asRole("authenticated", USER_ID, () =>
      failure("insert into public.commercial_opportunities (title, company) values ('Intruder', 'X')"),
    );
    assert.equal(error?.code, "42501");
    const target = await insertDeal({ title: "Protected" });
    const updated = await asRole("authenticated", USER_ID, () =>
      db.query("update public.commercial_opportunities set title = 'Hijacked' where id = $1 returning id", [target.id]),
    );
    assert.equal(updated.rows.length, 0);
  });

  it("lets an admin create, move, win and delete deals", async () => {
    const created = await asRole("authenticated", ADMIN_ID, async () => {
      const { rows } = await db.query("insert into public.commercial_opportunities (title, contact_name) values ('Admin deal', 'Ana') returning *");
      return rows[0];
    });
    const won = await asRole("authenticated", ADMIN_ID, async () => {
      const { rows } = await db.query("update public.commercial_opportunities set stage = 'WON' where id = $1 returning *", [created.id]);
      return rows[0];
    });
    assert.ok(won.closed_at);
    const removed = await asRole("authenticated", ADMIN_ID, () =>
      db.query("delete from public.commercial_opportunities where id = $1 returning id", [created.id]),
    );
    assert.equal(removed.rows.length, 1);
  });
});

describe("commercial access matrix", () => {
  it("is admin-only for every verb: anon is refused, a signed-in non-admin sees and touches nothing", async () => {
    const matrix = await policyMatrix(db, {
      table: "commercial_opportunities",
      seed: async () => (await insertDeal({ title: "Matrix row" })).id,
      insertSql: "insert into public.commercial_opportunities (title, company) values ('Matrix insert', 'Aurora') returning id",
      updateSet: "title = 'Matrix edit'",
    });
    assert.deepEqual(matrix, ADMIN_ONLY);
  });

  it("grants the table to authenticated and service_role only", async () => {
    assert.deepEqual(await tableGrants(db, "commercial_opportunities", "anon"), []);
    for (const grantee of ["authenticated", "service_role"]) {
      const grants = await tableGrants(db, "commercial_opportunities", grantee);
      for (const verb of ["DELETE", "INSERT", "SELECT", "UPDATE"]) assert.ok(grants.includes(verb), `${grantee} lacks ${verb}`);
    }
  });
});

describe("receivables created by a win", () => {
  it("links a ledger entry to the deal it came from, and keeps the entry when the deal is deleted", async () => {
    const deal = await insertDeal({ title: "Won deal" });
    const { rows: [entry] } = await db.query(
      "insert into public.financial_transactions (type, description, amount, due_date, opportunity_id) values ('INCOME', 'From the deal', 500, '2026-10-10', $1) returning id",
      [deal.id],
    );
    await db.query("delete from public.commercial_opportunities where id = $1", [deal.id]);
    const { rows: [kept] } = await db.query("select opportunity_id from public.financial_transactions where id = $1", [entry.id]);
    assert.equal(kept.opportunity_id, null);
  });

  it("refuses a link to a deal that does not exist", async () => {
    const error = await failure(
      "insert into public.financial_transactions (type, description, amount, due_date, opportunity_id) values ('INCOME', 'Ghost', 1, '2026-10-10', '44444444-4444-4444-4444-444444444444')",
    );
    assert.equal(error?.code, "23503");
  });

  it("adds the foreign key once, even when the migration runs again", async () => {
    await db.exec(COMMERCIAL);
    const { rows } = await db.query(
      "select confdeltype from pg_constraint where conname = 'financial_transactions_opportunity_id_fkey'",
    );
    assert.deepEqual(rows, [{ confdeltype: "n" }], "one constraint, on delete set null");
  });
});
