// Applies 003_project_presentation.sql to a real Postgres engine (PGlite) and
// verifies the presentation columns, the project_modules table, its
// constraints and the row level security that governs it.
//
//   npm test
//
// No Supabase project and no credentials required, so the rules are checked
// before the migration is ever applied to a live database.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = (name) => readFileSync(fileURLToPath(new URL(`../../supabase/migrations/${name}`, import.meta.url)), "utf8");

const ADMIN_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";
const PUBLISHED_PROJECT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DRAFT_PROJECT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let db;

async function asRole(role, uid, fn) {
  await db.exec(`set role ${role};`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid ?? ""]);
  try {
    return await fn();
  } finally {
    await db.exec("reset role;");
  }
}

async function failure(sql, params = []) {
  try {
    await db.query(sql, params);
    return null;
  } catch (error) {
    return error;
  }
}

const addModule = (projectId, position, title, code = null) =>
  db.query(
    'insert into public.project_modules (project_id, "position", code, title) values ($1,$2,$3,$4) returning id',
    [projectId, position, code, title],
  );

const readableModules = async () =>
  (await db.query('select title from public.project_modules order by "position"')).rows.map((row) => row.title);

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

  await db.query("insert into auth.users (id, email) values ($1,$2), ($3,$4)", [
    ADMIN_ID,
    "admin@space.local",
    USER_ID,
    "someone@space.local",
  ]);

  await db.exec(migration("001_admin_foundation.sql"));
  await db.exec(migration("003_project_presentation.sql"));

  await db.query("insert into public.admins (user_id, role) values ($1,'owner')", [ADMIN_ID]);
  await db.query(
    `insert into public.projects (id, case_number, name, slug, category, status, editorial_status, visible)
     values ($1, 1, 'Published', 'published', 'Website', 'Live', 'PUBLISHED', true),
            ($2, 2, 'Draft', 'draft', 'Website', 'Live', 'DRAFT', true)`,
    [PUBLISHED_PROJECT, DRAFT_PROJECT],
  );
});

after(async () => {
  await db?.close();
});

describe("presentation migration", () => {
  it("is idempotent", async () => {
    await db.exec(migration("003_project_presentation.sql"));
  });

  it("adds the presentation columns with usable defaults", async () => {
    const { rows } = await db.query(
      `select presentation_system, presentation_label, presentation_address, presentation_type, origin, coordinates
       from public.projects where case_number = 1`,
    );

    assert.equal(rows[0].presentation_system, null, "existing rows are untouched");
    assert.deepEqual(rows[0].coordinates, [], "coordinates default to an empty array, never null");
  });

  it("stores coordinates as plain display strings", async () => {
    await db.query("update public.projects set coordinates = $1 where case_number = 1", [["22°54'S", "43°12'W"]]);
    const { rows } = await db.query("select coordinates from public.projects where case_number = 1");

    assert.deepEqual(rows[0].coordinates, ["22°54'S", "43°12'W"]);
  });
});

describe("project modules", () => {
  it("accepts ordered modules for a project", async () => {
    await addModule(PUBLISHED_PROJECT, 0, "DIREÇÃO DE ARTE", "01");
    await addModule(PUBLISHED_PROJECT, 1, "INTERAÇÃO", "02");

    assert.deepEqual(await readableModules(), ["DIREÇÃO DE ARTE", "INTERAÇÃO"]);
  });

  it("refuses two modules at the same position in one project", async () => {
    const error = await failure(
      'insert into public.project_modules (project_id, "position", title) values ($1, 0, $2)',
      [PUBLISHED_PROJECT, "Duplicate"],
    );

    assert.equal(error?.code, "23505", "the unique index is what makes reordering safe");
  });

  it("allows the same position in different projects", async () => {
    const { rows } = await addModule(DRAFT_PROJECT, 0, "Draft module");
    assert.ok(rows[0].id);
  });

  it("rejects a negative position and a blank title", async () => {
    const negative = await failure(
      'insert into public.project_modules (project_id, "position", title) values ($1, -1, $2)',
      [PUBLISHED_PROJECT, "Nope"],
    );
    const blank = await failure(
      'insert into public.project_modules (project_id, "position", title) values ($1, 9, $2)',
      [PUBLISHED_PROJECT, "   "],
    );

    assert.equal(negative?.code, "23514");
    assert.equal(blank?.code, "23514");
  });

  it("disappears with its project", async () => {
    const { rows: temp } = await db.query(
      `insert into public.projects (case_number, name, slug, category, status)
       values (99, 'Temp', 'temp-cascade', 'Website', 'Live') returning id`,
    );
    await addModule(temp[0].id, 0, "Temporary");
    await db.query("delete from public.projects where id = $1", [temp[0].id]);

    const { rows } = await db.query("select count(*)::int as n from public.project_modules where project_id = $1", [temp[0].id]);
    assert.equal(rows[0].n, 0);
  });
});

describe("project modules row level security", () => {
  it("lets the public read modules of published projects only", async () => {
    const anon = await asRole("anon", null, readableModules);
    const visitor = await asRole("authenticated", USER_ID, readableModules);

    assert.deepEqual(anon, ["DIREÇÃO DE ARTE", "INTERAÇÃO"], "the draft project's module stays hidden");
    assert.deepEqual(visitor, anon, "authentication alone grants nothing extra");
  });

  it("hides modules as soon as the project is unpublished", async () => {
    await db.query("update public.projects set editorial_status = 'DRAFT' where id = $1", [PUBLISHED_PROJECT]);
    const whileDraft = await asRole("anon", null, readableModules);

    await db.query("update public.projects set editorial_status = 'PUBLISHED', visible = false where id = $1", [PUBLISHED_PROJECT]);
    const whileHidden = await asRole("anon", null, readableModules);

    await db.query("update public.projects set visible = true where id = $1", [PUBLISHED_PROJECT]);

    assert.deepEqual(whileDraft, []);
    assert.deepEqual(whileHidden, []);
  });

  it("blocks writes from the public and from a non-admin", async () => {
    const anonInsert = await asRole("anon", null, () =>
      failure('insert into public.project_modules (project_id, "position", title) values ($1, 5, $2)', [
        PUBLISHED_PROJECT,
        "Hack",
      ]),
    );
    const userInsert = await asRole("authenticated", USER_ID, () =>
      failure('insert into public.project_modules (project_id, "position", title) values ($1, 6, $2)', [
        PUBLISHED_PROJECT,
        "Hack",
      ]),
    );

    assert.equal(anonInsert?.code, "42501");
    assert.equal(userInsert?.code, "42501");
  });

  it("gives an admin full control", async () => {
    await asRole("authenticated", ADMIN_ID, async () => {
      await db.query('insert into public.project_modules (project_id, "position", title) values ($1, 7, $2)', [
        PUBLISHED_PROJECT,
        "Admin module",
      ]);
      await db.query('update public.project_modules set title = $1 where "position" = 7 and project_id = $2', [
        "Renamed",
        PUBLISHED_PROJECT,
      ]);
    });

    const { rows } = await db.query('select title from public.project_modules where "position" = 7 and project_id = $1', [
      PUBLISHED_PROJECT,
    ]);
    assert.equal(rows[0].title, "Renamed");

    await asRole("authenticated", ADMIN_ID, () =>
      db.query('delete from public.project_modules where "position" = 7 and project_id = $1', [PUBLISHED_PROJECT]),
    );
    const after = await db.query('select count(*)::int as n from public.project_modules where "position" = 7 and project_id = $1', [
      PUBLISHED_PROJECT,
    ]);
    assert.equal(after.rows[0].n, 0);
  });
});
