// Applies supabase/migrations/001_admin_foundation.sql to a real Postgres
// engine (PGlite, Postgres compiled to WASM) and exercises the constraints,
// triggers and RLS policies.
//
//   npm test
//
// No Docker, no Supabase project and no credentials required, so the security
// rules are verified on every run instead of only after deploying.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const MIGRATION_PATH = fileURLToPath(new URL("../../supabase/migrations/001_admin_foundation.sql", import.meta.url));

const ADMIN_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";

let db;

// Runs a callback as a Postgres role with auth.uid() bound to a user, which is
// how Supabase evaluates the policies at runtime.
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

function insertProject(overrides = {}) {
  const row = {
    case_number: 1,
    name: "INK Tattoo",
    slug: "ink-tattoo",
    category: "Website",
    status: "Live",
    editorial_status: "DRAFT",
    year: 2026,
    accent: "#c6ff00",
    visible: true,
    ...overrides,
  };

  return db.query(
    `insert into public.projects (case_number, name, slug, category, status, editorial_status, year, accent, visible)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
    [row.case_number, row.name, row.slug, row.category, row.status, row.editorial_status, row.year, row.accent, row.visible],
  );
}

before(async () => {
  db = new PGlite();

  // The pieces Supabase already provides and the migration expects to exist.
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

  await db.exec(readFileSync(MIGRATION_PATH, "utf8"));
});

after(async () => {
  await db?.close();
});

describe("migration", () => {
  it("is idempotent", async () => {
    await db.exec(readFileSync(MIGRATION_PATH, "utf8"));
  });
});

describe("projects constraints", () => {
  it("assigns a uuid primary key and sane defaults", async () => {
    const { rows } = await insertProject();

    assert.match(rows[0].id, /^[0-9a-f-]{36}$/);
    assert.equal(rows[0].case_number, 1);
    assert.equal(rows[0].published_at, null);
    assert.ok(rows[0].created_at && rows[0].updated_at);
    assert.deepEqual(rows[0].tech_stack, []);
  });

  it("rejects a duplicate case number and names the column", async () => {
    const error = await failure(
      "insert into public.projects (case_number,name,slug,category,status) values (1,'Dup','dup','Website','Live')",
    );

    assert.equal(error?.code, "23505");
    assert.match(`${error.message} ${error.detail ?? ""}`, /case_number/i);
  });

  it("rejects a duplicate slug and names the column", async () => {
    // The admin turns this into an inline "This slug is already in use." error,
    // which only works because the constraint name mentions the column.
    const error = await failure(
      "insert into public.projects (case_number,name,slug,category,status) values (2,'Dup','ink-tattoo','Website','Live')",
    );

    assert.equal(error?.code, "23505");
    assert.match(`${error.message} ${error.detail ?? ""}`, /slug/i);
  });

  it("enforces the enumerated values the UI sends", async () => {
    const badCategory = await failure(
      "insert into public.projects (case_number,name,slug,category,status) values (3,'X','x1','Blog','Live')",
    );
    const badStatus = await failure(
      "insert into public.projects (case_number,name,slug,category,status) values (4,'X','x2','Website','Shipped')",
    );
    // Editorial status is upper case in the UI model; title case must not pass.
    const badEditorial = await failure(
      "insert into public.projects (case_number,name,slug,category,status,editorial_status) values (5,'X','x3','Website','Live','Published')",
    );

    assert.equal(badCategory?.code, "23514");
    assert.equal(badStatus?.code, "23514");
    assert.equal(badEditorial?.code, "23514");
  });

  it("validates accent, year and name", async () => {
    const badAccent = await failure(
      "insert into public.projects (case_number,name,slug,category,status,accent) values (6,'X','x4','Website','Live','red')",
    );
    const badYear = await failure(
      "insert into public.projects (case_number,name,slug,category,status,year) values (8,'X','x6','Website','Live',1200)",
    );
    const blankName = await failure(
      "insert into public.projects (case_number,name,slug,category,status) values (9,'   ','x7','Website','Live')",
    );
    const shortHex = await insertProject({ case_number: 7, slug: "x5", accent: "#fff" });

    assert.equal(badAccent?.code, "23514");
    assert.equal(badYear?.code, "23514");
    assert.equal(blankName?.code, "23514");
    assert.equal(shortHex.rows[0].accent, "#fff", "3-digit hex is valid in the UI too");
  });
});

describe("projects triggers", () => {
  it("bumps updated_at on every update", async () => {
    const before = await db.query("select updated_at from public.projects where case_number = 1");
    await new Promise((resolve) => setTimeout(resolve, 10));
    const after = await db.query("update public.projects set name = 'INK Tattoo v2' where case_number = 1 returning updated_at");

    assert.ok(new Date(after.rows[0].updated_at) > new Date(before.rows[0].updated_at));
  });

  it("stamps published_at once and never resets it", async () => {
    const published = await db.query(
      "update public.projects set editorial_status = 'PUBLISHED' where case_number = 1 returning published_at",
    );
    assert.ok(published.rows[0].published_at);

    const stamp = String(published.rows[0].published_at);
    const draft = await db.query(
      "update public.projects set editorial_status = 'DRAFT' where case_number = 1 returning published_at",
    );
    const again = await db.query(
      "update public.projects set editorial_status = 'PUBLISHED' where case_number = 1 returning published_at",
    );

    assert.equal(String(draft.rows[0].published_at), stamp, "unpublishing keeps the original date");
    assert.equal(String(again.rows[0].published_at), stamp, "re-publishing keeps the original date");
  });

  it("stamps published_at on an insert that is already published", async () => {
    const { rows } = await insertProject({
      case_number: 10,
      slug: "born-published",
      editorial_status: "PUBLISHED",
      visible: false,
    });

    assert.ok(rows[0].published_at);
  });
});

describe("row level security", () => {
  before(async () => {
    await db.query("insert into public.admins (user_id, role) values ($1,'owner')", [ADMIN_ID]);
    const projectId = (await db.query("select id from public.projects where case_number = 1")).rows[0].id;
    await db.query('insert into public.project_gallery (project_id, url, "position") values ($1,$2,1)', [projectId, "a.png"]);
  });

  // Landscape: case 1 is published+visible, case 7 is a draft,
  // case 10 is published but not visible.
  it("lets anonymous visitors read only published, visible projects", async () => {
    const rows = await asRole("anon", null, async () =>
      (await db.query("select case_number from public.projects order by case_number")).rows,
    );

    assert.deepEqual(rows.map((row) => row.case_number), [1]);
  });

  it("blocks every anonymous write", async () => {
    const insert = await asRole("anon", null, () =>
      failure("insert into public.projects (case_number,name,slug,category,status) values (99,'Hack','hack','Website','Live')"),
    );
    await asRole("anon", null, () => failure("delete from public.projects where case_number = 1"));

    assert.equal(insert?.code, "42501");
    assert.equal((await db.query("select count(*)::int as n from public.projects where case_number = 1")).rows[0].n, 1);
  });

  it("treats an authenticated non-admin exactly like the public", async () => {
    const rows = await asRole("authenticated", USER_ID, async () =>
      (await db.query("select case_number from public.projects order by case_number")).rows,
    );
    const insert = await asRole("authenticated", USER_ID, () =>
      failure("insert into public.projects (case_number,name,slug,category,status) values (98,'Nope','nope','Website','Live')"),
    );

    assert.deepEqual(rows.map((row) => row.case_number), [1], "authentication alone grants nothing");
    assert.equal(insert?.code, "42501");
  });

  it("gives a registered admin full control", async () => {
    const rows = await asRole("authenticated", ADMIN_ID, async () =>
      (await db.query("select case_number from public.projects order by case_number")).rows,
    );
    assert.deepEqual(rows.map((row) => row.case_number), [1, 7, 10], "admins see drafts and hidden projects");

    await asRole("authenticated", ADMIN_ID, async () => {
      await db.query("insert into public.projects (case_number,name,slug,category,status) values (20,'Admin Made','admin-made','System','MVP')");
      await db.query("update public.projects set name = 'Renamed' where case_number = 20");
      await db.query("delete from public.projects where case_number = 20");
    });

    assert.equal((await db.query("select count(*)::int as n from public.projects where case_number = 20")).rows[0].n, 0);
  });

  it("keeps the admin roster private and unwritable", async () => {
    const outsider = await asRole("authenticated", USER_ID, async () => (await db.query("select user_id from public.admins")).rows);
    const admin = await asRole("authenticated", ADMIN_ID, async () => (await db.query("select user_id from public.admins")).rows);
    const selfPromotion = await asRole("authenticated", USER_ID, () =>
      failure("insert into public.admins (user_id, role) values ($1,'admin')", [USER_ID]),
    );

    assert.equal(outsider.length, 0);
    assert.equal(admin.length, 1, "an admin can confirm their own membership, which is what isAdmin() reads");
    assert.equal(selfPromotion?.code, "42501", "promotion never happens from the client");
  });

  it("hides gallery images when the parent project is not public", async () => {
    const visible = await asRole("anon", null, async () => (await db.query("select url from public.project_gallery")).rows);
    await db.query("update public.projects set editorial_status = 'DRAFT' where case_number = 1");
    const hidden = await asRole("anon", null, async () => (await db.query("select url from public.project_gallery")).rows);

    assert.equal(visible.length, 1);
    assert.equal(hidden.length, 0);
  });

  it("cascades a project delete to its gallery", async () => {
    await db.query("delete from public.projects where case_number = 1");

    assert.equal((await db.query("select count(*)::int as n from public.project_gallery")).rows[0].n, 0);
  });
});
