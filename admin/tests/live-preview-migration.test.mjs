import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { migrationPath } from "./helpers/migration-files.mjs";

const FOUNDATION = migrationPath("admin_foundation");
const LIVE_PREVIEW = migrationPath("project_live_preview");

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
  await db.query(`
    insert into public.projects (case_number, name, slug, category, status)
    values
      (1, 'INK Tattoo', 'ink-tattoo', 'Website', 'Live'),
      (2, 'Lucas Souza', 'lucas-souza', 'Website', 'Live'),
      (3, 'JARVIS AI', 'jarvis-ai', 'AI', 'Prototype')
  `);
  await db.exec(readFileSync(LIVE_PREVIEW, "utf8"));
});

after(async () => {
  await db?.close();
});

describe("live preview migration", () => {
  it("is idempotent", async () => {
    await db.exec(readFileSync(LIVE_PREVIEW, "utf8"));
  });

  it("adds a safe explicit live preview flag", async () => {
    const { rows } = await db.query("select case_number, live_preview_enabled from public.projects order by case_number");
    assert.deepEqual(rows, [
      { case_number: 1, live_preview_enabled: true },
      { case_number: 2, live_preview_enabled: true },
      { case_number: 3, live_preview_enabled: false },
    ]);
  });

  it("defaults new projects to disabled", async () => {
    const { rows } = await db.query(`
      insert into public.projects (case_number, name, slug, category, status)
      values (6, 'Future Case', 'future-case', 'System', 'MVP')
      returning live_preview_enabled
    `);

    assert.equal(rows[0].live_preview_enabled, false);
  });
});
