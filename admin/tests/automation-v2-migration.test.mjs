// The automation v2 migration, applied on top of the whole chain to a
// Supabase-shaped Postgres (PGlite): run authorship, the opportunity handoff
// and the one business write the automation service makes. Asserted against
// the real engine, with the API roles, because a constraint that is merely
// spelled correctly is not a constraint.
//
// It also pins the contract between the database and the automation service:
// every permission the service asks has_permission() about exists, and the
// roles hold them the way the service's tests assume.
//
//   npm test

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { as, code, createSecurityDb, IDS, one } from "./helpers/security-fixture.mjs";
import { readMigration } from "./helpers/migration-files.mjs";

const OPEN = "select public.automation_open_project_for_opportunity($1, $2, $3, $4, $5, $6, $7) as result";

const ids = {
  won: "c0000000-0000-4000-8000-000000000001",
  open: "c0000000-0000-4000-8000-000000000002",
  noClient: "c0000000-0000-4000-8000-000000000003",
  race: "c0000000-0000-4000-8000-000000000004",
  client: "d0000000-0000-4000-8000-000000000001",
  run: "e0000000-0000-4000-8000-000000000001",
};

let db;

async function openProject(opportunity, { category = "System", name = "Aurora Portal", slug = "aurora-portal", linkFinance = true, actor = IDS.owner, run = null } = {}) {
  const row = await one(as(db, "service", OPEN, [opportunity, category, name, slug, linkFinance, actor, run]));
  return row.result;
}

before(async () => {
  db = await createSecurityDb();
  await db.query("insert into public.clients (id, name, company, status) values ($1, 'Aurora', 'Aurora Labs', 'ACTIVE')", [ids.client]);
  await db.query(
    `insert into public.commercial_opportunities (id, title, stage, client_id, company) values
       ($1, 'Aurora Portal', 'WON', $4, 'Aurora Labs'),
       ($2, 'Still talking', 'NEGOTIATION', null, 'Talk Co'),
       ($3, 'No client yet', 'WON', null, 'Loose Co'),
       ($5, 'Race', 'WON', null, 'Race Co')`,
    [ids.won, ids.open, ids.noClient, ids.client, ids.race],
  );
  await db.query(
    `insert into public.financial_transactions (type, status, description, category, amount, due_date, opportunity_id, client_id) values
       ('INCOME', 'PENDING', 'Aurora (1/2)', 'PROJECT', 500, current_date + 30, $1, $2),
       ('INCOME', 'PENDING', 'Aurora (2/2)', 'PROJECT', 500, current_date + 60, $1, $2),
       ('INCOME', 'CANCELLED', 'Aurora old', 'PROJECT', 900, current_date - 5, $1, $2)`,
    [ids.won, ids.client],
  );
  await db.query("insert into public.automation_runs (id, event, status) values ($1, 'commercial.opportunity.won', 'RUNNING')", [ids.run]);
});

after(async () => {
  await db?.close();
});

describe("automation v2 migration", () => {
  it("is idempotent", async () => {
    await db.exec(readMigration("automation_v2"));
  });

  it("records who asked for a run, and nothing else changes for anon or members", async () => {
    const column = await one(
      db.query("select is_nullable from information_schema.columns where table_name = 'automation_runs' and column_name = 'requested_by'"),
    );
    assert.equal(column.is_nullable, "YES");

    const { rows: grants } = await db.query(
      "select grantee from information_schema.role_table_grants where table_name = 'automation_runs' and grantee in ('anon', 'authenticated')",
    );
    assert.deepEqual(grants, []);
    assert.equal(await code(as(db, "owner", "select * from public.automation_runs")), "42501");
    assert.equal(await code(as(db, "anon", "select * from public.automation_runs")), "42501");
    // The automation service still reads and writes its history.
    assert.ok((await as(db, "service", "select id from public.automation_runs")).rows.length >= 1);
  });

  it("lets only the automation service open a project", async () => {
    for (const who of ["anon", "owner", "manager", "absolute"]) {
      assert.equal(
        await code(as(db, who, OPEN, [ids.won, "System", "x", "x", false, null, null])),
        "42501",
        `${who} must not reach the function`,
      );
    }
    const { rows } = await db.query(
      "select has_function_privilege('service_role', 'public.automation_open_project_for_opportunity(uuid, text, text, text, boolean, uuid, uuid)', 'execute') as ok",
    );
    assert.equal(rows[0].ok, true);
  });

  it("opens a hidden draft for a won deal, with its handoff, client, ledger and log", async () => {
    const result = await openProject(ids.won, { run: ids.run });

    assert.equal(result.project_created, true);
    assert.equal(result.client_linked, true);
    assert.equal(result.transactions_linked, 2, "the cancelled entry stays untouched");

    const project = await one(db.query("select * from public.projects where id = $1", [result.project_id]));
    assert.equal(project.editorial_status, "DRAFT");
    assert.equal(project.visible, false);
    assert.equal(project.featured, false);
    assert.equal(project.status, "In Development");
    assert.equal(project.category, "System");
    assert.equal(project.client_id, ids.client);
    assert.equal(project.client, "Aurora Labs");
    assert.equal(project.slug, "aurora-portal");

    const handoff = await one(db.query("select * from public.commercial_project_handoffs where opportunity_id = $1", [ids.won]));
    assert.equal(handoff.project_id, result.project_id);
    assert.equal(handoff.run_id, ids.run);
    assert.equal(handoff.proposal_id, null);

    const ledger = (await db.query("select status, amount, project_id from public.financial_transactions where opportunity_id = $1 order by description", [ids.won])).rows;
    assert.deepEqual(
      ledger.map((row) => [row.status, Number(row.amount), row.project_id]),
      [
        ["PENDING", 500, result.project_id],
        ["PENDING", 500, result.project_id],
        ["CANCELLED", 900, null],
      ],
    );

    const log = (await db.query("select action, admin_user_id from public.activity_log where entity_id = $1 order by created_at, action", [result.project_id])).rows;
    assert.deepEqual(log.map((row) => row.action).sort(), ["financial.updated", "project.created"]);
    assert.ok(log.every((row) => row.admin_user_id === IDS.owner), "authored by the member who closed the deal");
  });

  it("returns the same project on every later call and creates nothing", async () => {
    const before = Number((await one(db.query("select count(*) from public.projects"))).count);
    const logs = Number((await one(db.query("select count(*) from public.activity_log"))).count);

    const first = await openProject(ids.won);
    const second = await openProject(ids.won, { slug: "something-else", name: "Other name" });

    assert.equal(first.project_created, false);
    assert.equal(second.project_created, false);
    assert.equal(first.project_id, second.project_id);
    assert.equal(second.transactions_linked, 0);
    assert.equal(Number((await one(db.query("select count(*) from public.projects"))).count), before);
    assert.equal(Number((await one(db.query("select count(*) from public.activity_log"))).count), logs);
  });

  it("links a client that was attached to the deal after the project opened", async () => {
    const first = await openProject(ids.noClient, { slug: "loose" });
    assert.equal(first.client_linked, false);
    assert.equal((await one(db.query("select client from public.projects where id = $1", [first.project_id]))).client, "Loose Co");

    await db.query("update public.commercial_opportunities set client_id = $2 where id = $1", [ids.noClient, ids.client]);
    const second = await openProject(ids.noClient, { slug: "loose" });

    assert.equal(second.project_id, first.project_id);
    assert.equal(second.client_linked, true);
    const project = await one(db.query("select client_id, client from public.projects where id = $1", [first.project_id]));
    assert.equal(project.client_id, ids.client);
    assert.equal(project.client, "Aurora Labs", "the public label follows the client linked later");
  });

  it("finds a free slug instead of failing on a taken one", async () => {
    const result = await openProject(ids.race, { slug: "aurora-portal", linkFinance: false });

    assert.equal(result.slug, "aurora-portal-2");
  });

  it("leaves the ledger alone without the finance link", async () => {
    const opportunity = "c0000000-0000-4000-8000-000000000009";
    await db.query("insert into public.commercial_opportunities (id, title, stage, company) values ($1, 'No finance', 'WON', 'NF')", [opportunity]);
    await db.query(
      "insert into public.financial_transactions (type, status, description, category, amount, due_date, opportunity_id) values ('INCOME', 'PENDING', 'NF', 'PROJECT', 10, current_date, $1)",
      [opportunity],
    );

    const result = await openProject(opportunity, { slug: "no-finance", linkFinance: false });

    assert.equal(result.transactions_linked, 0);
    assert.equal((await one(db.query("select project_id from public.financial_transactions where opportunity_id = $1", [opportunity]))).project_id, null);
  });

  it("refuses what it must not open, with its own codes", async () => {
    assert.equal(await code(as(db, "service", OPEN, [ids.open, "System", "Talk", "talk", false, null, null])), "AU002");
    assert.equal(await code(as(db, "service", OPEN, ["c0000000-0000-4000-8000-0000000000ff", "System", "x", "x", false, null, null])), "AU001");
    assert.equal(await code(as(db, "service", OPEN, [ids.won, "Marketing", "x", "x", false, null, null])), "AU003");
    assert.equal(await code(as(db, "service", OPEN, [ids.won, "System", "  ", "x", false, null, null])), "AU003");
    assert.equal(await code(as(db, "service", OPEN, [ids.won, "System", "x", "!!!", false, null, null])), "AU003");
  });

  it("writes null for an actor or run that does not exist, instead of failing", async () => {
    const opportunity = "c0000000-0000-4000-8000-00000000000a";
    await db.query("insert into public.commercial_opportunities (id, title, stage, company) values ($1, 'Ghost', 'WON', 'G')", [opportunity]);

    const result = await openProject(opportunity, { slug: "ghost", actor: "f0000000-0000-4000-8000-000000000000", run: "f0000000-0000-4000-8000-000000000001" });

    const handoff = await one(db.query("select run_id from public.commercial_project_handoffs where opportunity_id = $1", [opportunity]));
    assert.equal(handoff.run_id, null);
    const entry = await one(db.query("select admin_user_id from public.activity_log where entity_id = $1", [result.project_id]));
    assert.equal(entry.admin_user_id, null);
  });

  it("keeps one project per opportunity in the table itself, and one source per handoff", async () => {
    const { project_id: other } = await openProject("c0000000-0000-4000-8000-00000000000a", { slug: "ghost" });
    // A second handoff for an opportunity that already has one.
    assert.equal(
      await code(db.query("insert into public.commercial_project_handoffs (opportunity_id, project_id) values ($1, $2)", [ids.won, other])),
      "23505",
    );
    assert.equal(
      await code(
        db.query(
          `insert into public.commercial_project_handoffs (opportunity_id, proposal_id, project_id)
           values ($1, gen_random_uuid(), $2)`,
          [ids.open, other],
        ),
      ),
      "23514",
    );
  });

  it("keeps the handoffs readable to members with commercial.read, like before", async () => {
    const { rows } = await as(db, "manager", "select opportunity_id from public.commercial_project_handoffs where opportunity_id = $1", [ids.won]);
    assert.equal(rows.length, 1);
    assert.deepEqual((await as(db, "collaborator", "select * from public.commercial_project_handoffs")).rows, []);
  });

  it("does not drop or rename anything", () => {
    const sql = readMigration("automation_v2");
    assert.doesNotMatch(sql, /\bdrop\s+(table|column|function|policy|index|trigger)\b/i);
    assert.doesNotMatch(sql, /\brename\b/i);
    assert.doesNotMatch(sql, /\bdelete\s+from\b/i);
    assert.doesNotMatch(sql, /\btruncate\b/i);
  });
});

describe("automation service permission contract", () => {
  const PERMISSIONS_PY = readFileSync(new URL("../../services/automation-api/app/core/permissions.py", import.meta.url), "utf8");
  const keys = [...PERMISSIONS_PY.matchAll(/^[A-Z_]+ = "([a-z_]+\.[a-z_]+)"$/gm)].map((match) => match[1]);

  it("asks the database only about permissions that exist", async () => {
    assert.ok(keys.length >= 8);
    const { rows } = await db.query("select key from public.permissions where key = any($1)", [keys]);
    assert.deepEqual(rows.map((row) => row.key).sort(), [...new Set(keys)].sort());
  });

  // The role sets services/automation-api/tests/conftest.py assumes.
  const EXPECTED = {
    owner: keys,
    manager: ["logs.read", "projects.read", "projects.create", "projects.edit", "projects.publish", "commercial.read", "commercial.edit"],
    seo: ["logs.read", "projects.read", "projects.create", "projects.edit", "projects.publish"],
    collaborator: [],
  };

  for (const [who, granted] of Object.entries(EXPECTED)) {
    it(`answers has_permission for ${who} the way the service's tests assume`, async () => {
      const held = [];
      for (const key of keys) {
        const { rows } = await as(db, who, "select public.has_permission($1) as ok", [key]);
        if (rows[0].ok) held.push(key);
      }
      assert.deepEqual(held.sort(), [...new Set(granted)].sort());
    });
  }

  it("grants nothing to a session whose MFA is not current", async () => {
    // An OWNER with a verified factor on a password-only token.
    const { rows } = await as(db, "partner", "select public.has_permission('logs.read') as ok", [], "aal1");
    assert.equal(rows[0].ok, false);
  });
});
