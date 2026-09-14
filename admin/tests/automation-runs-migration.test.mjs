import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

// The migration is applied to a real Postgres engine rather than asserted as
// text. A constraint that is merely spelled correctly is not a constraint.

const FOUNDATION = fileURLToPath(new URL("../../supabase/migrations/001_admin_foundation.sql", import.meta.url));
const AUTOMATION_RUNS = fileURLToPath(new URL("../../supabase/migrations/010_automation_runs.sql", import.meta.url));

let db;

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    grant usage on schema public to anon, authenticated;
    create schema if not exists auth;
    create table auth.users (id uuid primary key, email text);
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
  `);
  await db.exec(readFileSync(FOUNDATION, "utf8"));
  await db.exec(readFileSync(AUTOMATION_RUNS, "utf8"));
});

after(async () => {
  await db?.close();
});

const insert = (columns, values) =>
  db.query(`insert into public.automation_runs (${columns}) values (${values}) returning id, status, source`);

describe("automation runs migration", () => {
  it("is idempotent", async () => {
    await db.exec(readFileSync(AUTOMATION_RUNS, "utf8"));
  });

  it("defaults a new run to PENDING from the api", async () => {
    const { rows } = await insert("event", "'project.published'");

    assert.equal(rows[0].status, "PENDING");
    assert.equal(rows[0].source, "api");
    assert.ok(rows[0].id, "a run gets a generated id");
  });

  it("accepts every status the engine can produce", async () => {
    for (const status of ["PENDING", "RUNNING", "SUCCESS", "FAILED", "SKIPPED"]) {
      const { rows } = await insert("event, status", `'project.published', '${status}'`);
      assert.equal(rows[0].status, status);
    }
  });

  it("refuses a status outside the lifecycle", async () => {
    await assert.rejects(() => insert("event, status", "'project.published', 'ALMOST'"));
  });

  it("refuses a run with no event", async () => {
    await assert.rejects(() => insert("event", "'   '"), "a blank event must not be stored");
    await assert.rejects(() => insert("status", "'SUCCESS'"), "an event is required");
  });

  it("refuses a negative duration", async () => {
    await assert.rejects(() => insert("event, duration_ms", "'project.published', -1"));
  });

  it("stores steps as a JSONB array and reads them back in order", async () => {
    const steps = JSON.stringify([
      { name: "validate_project", status: "SUCCESS", duration_ms: 42 },
      { name: "analyze_project", status: "FAILED", error: "boom" },
    ]);

    const { rows } = await db.query(
      `insert into public.automation_runs (event, steps) values ('project.published', $1::jsonb) returning steps`,
      [steps],
    );

    assert.equal(rows[0].steps.length, 2);
    assert.equal(rows[0].steps[0].name, "validate_project");
    assert.equal(rows[0].steps[1].status, "FAILED");
  });

  it("defaults payload, steps and result to empty rather than null", async () => {
    const { rows } = await db.query(
      "insert into public.automation_runs (event) values ('project.completed') returning payload, steps, result",
    );

    assert.deepEqual(rows[0].payload, {});
    assert.deepEqual(rows[0].steps, []);
    assert.deepEqual(rows[0].result, {});
  });

  it("collapses a duplicate idempotency key", async () => {
    await insert("event, idempotency_key", "'project.published', 'op-1'");

    await assert.rejects(
      () => insert("event, idempotency_key", "'project.published', 'op-1'"),
      "a repeated dispatch of the same operation must not create a second run",
    );
  });

  it("still allows many runs with no idempotency key", async () => {
    // The unique index is partial; unkeyed runs must not collide with each other.
    await insert("event", "'project.completed'");
    await insert("event", "'project.completed'");
  });

  it("links a retry back to the run it repeats", async () => {
    const { rows: original } = await insert("event, status", "'project.published', 'FAILED'");

    const { rows } = await db.query(
      "insert into public.automation_runs (event, source, retry_of) values ('project.published', 'retry', $1) returning retry_of",
      [original[0].id],
    );

    assert.equal(rows[0].retry_of, original[0].id);
  });

  it("keeps a retry row when the original is deleted", async () => {
    const { rows: original } = await insert("event", "'project.published'");
    const { rows: retry } = await db.query(
      "insert into public.automation_runs (event, retry_of) values ('project.published', $1) returning id",
      [original[0].id],
    );

    await db.query("delete from public.automation_runs where id = $1", [original[0].id]);

    const { rows } = await db.query("select retry_of from public.automation_runs where id = $1", [retry[0].id]);
    // History must outlive what it points at.
    assert.equal(rows.length, 1);
    assert.equal(rows[0].retry_of, null);
  });

  it("survives the project it describes being deleted", async () => {
    // entity_id is text, not a foreign key, precisely so history is not cascaded away.
    await db.query(
      "insert into public.projects (case_number, name, slug, category, status) values (91, 'Temp', 'temp-91', 'Website', 'Live')",
    );
    const { rows: project } = await db.query("select id from public.projects where case_number = 91");

    await insert("event, entity_type, entity_id", `'project.published', 'project', '${project[0].id}'`);
    await db.query("delete from public.projects where case_number = 91");

    const { rows } = await db.query(
      "select count(*)::int as total from public.automation_runs where entity_id = $1",
      [project[0].id],
    );
    assert.equal(rows[0].total, 1);
  });

  it("enables row level security and grants nothing to admin clients", async () => {
    const { rows: enabled } = await db.query(
      "select relrowsecurity from pg_class where relname = 'automation_runs'",
    );
    assert.equal(enabled[0].relrowsecurity, true);

    // No policy: run history is reached through the automation API, never by
    // the Admin querying Supabase directly.
    const { rows: policies } = await db.query(
      "select policyname from pg_policies where tablename = 'automation_runs'",
    );
    assert.deepEqual(policies, []);

    const { rows: grants } = await db.query(`
      select grantee, privilege_type from information_schema.role_table_grants
      where table_name = 'automation_runs' and grantee in ('anon', 'authenticated')
    `);
    assert.deepEqual(grants, [], "anon and authenticated must have no grant on run history");
  });

  it("indexes the queries the Logs screen actually makes", async () => {
    const { rows } = await db.query(
      "select indexname from pg_indexes where tablename = 'automation_runs' order by indexname",
    );
    const names = rows.map((row) => row.indexname);

    for (const expected of [
      "automation_runs_created_idx",
      "automation_runs_event_idx",
      "automation_runs_status_idx",
      "automation_runs_entity_idx",
      "automation_runs_idempotency_key",
    ]) {
      assert.ok(names.includes(expected), `missing index ${expected} — have ${names.join(", ")}`);
    }
  });

  it("does not touch any other table", async () => {
    const sql = readFileSync(AUTOMATION_RUNS, "utf8");
    const touched = [...sql.matchAll(/\b(?:alter|drop)\s+table\s+(?:if\s+exists\s+)?(\S+)/gi)].map((m) => m[1]);

    assert.deepEqual([...new Set(touched)], ["public.automation_runs"]);
  });
});
