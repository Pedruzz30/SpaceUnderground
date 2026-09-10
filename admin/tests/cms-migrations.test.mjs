import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = (name) => readFileSync(fileURLToPath(new URL(`../../supabase/migrations/${name}`, import.meta.url)), "utf8");

const ADMIN_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";
const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DRAFT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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

  for (const name of [
    "001_admin_foundation.sql",
    "003_project_presentation.sql",
    "004_plans_cms.sql",
    "005_site_content.sql",
    "006_site_settings.sql",
    "007_activity_log.sql",
  ]) {
    await db.exec(migration(name));
  }

  await db.query("insert into public.admins (user_id, role) values ($1,'owner')", [ADMIN_ID]);
  await db.query(
    `insert into public.projects
      (id, case_number, name, slug, category, status, editorial_status, visible, presentation_system, presentation_label, presentation_address, presentation_type, origin, coordinates)
     values
      ($1, 1, 'Published', 'published', 'Website', 'Live', 'PUBLISHED', true, 'SYSTEM / 01', 'LABEL', 'ADDRESS', 'TYPE', 'RJ / BR', array['22S','43W']),
      ($2, 2, 'Draft', 'draft', 'Website', 'Live', 'DRAFT', true, 'SYSTEM / 02', 'DRAFT', 'ADDRESS', 'TYPE', 'RJ / BR', array['22S','43W'])`,
    [PROJECT_ID, DRAFT_ID],
  );
});

after(async () => {
  await db?.close();
});

describe("cms migrations", () => {
  it("re-apply without error", async () => {
    for (const name of [
      "003_project_presentation.sql",
      "004_plans_cms.sql",
      "005_site_content.sql",
      "006_site_settings.sql",
      "007_activity_log.sql",
    ]) {
      await db.exec(migration(name));
    }
  });
});

describe("project presentation", () => {
  it("stores presentation fields and ordered modules", async () => {
    await db.query(
      `insert into public.project_modules (project_id, "position", code, title, description)
       values ($1,0,'01','INTELIGENCIA','IA'), ($1,1,'02','AUTOMACAO','TOOLS')`,
      [PROJECT_ID],
    );

    const { rows } = await db.query(
      `select presentation_system, presentation_label, presentation_address, presentation_type, origin, coordinates
       from public.projects where id = $1`,
      [PROJECT_ID],
    );
    assert.equal(rows[0].presentation_system, "SYSTEM / 01");
    assert.deepEqual(rows[0].coordinates, ["22S", "43W"]);

    const modules = (await db.query('select code, title from public.project_modules where project_id = $1 order by "position"', [PROJECT_ID])).rows;
    assert.deepEqual(modules.map((row) => row.title), ["INTELIGENCIA", "AUTOMACAO"]);
  });

  it("prevents duplicate module positions per project and cascades deletes", async () => {
    const duplicate = await failure(
      `insert into public.project_modules (project_id, "position", title) values ($1,0,'DUP')`,
      [PROJECT_ID],
    );
    assert.equal(duplicate?.code, "23505");

    await db.query("delete from public.projects where id = $1", [DRAFT_ID]);
    const { rows } = await db.query("select count(*)::int as n from public.project_modules where project_id = $1", [DRAFT_ID]);
    assert.equal(rows[0].n, 0);
  });

  it("lets public users read modules only through published visible parents", async () => {
    const anonRows = await asRole("anon", null, async () => (await db.query("select title from public.project_modules")).rows);
    const userInsert = await asRole("authenticated", USER_ID, () =>
      failure(`insert into public.project_modules (project_id, "position", title) values ($1,9,'NOPE')`, [PROJECT_ID]),
    );

    assert.deepEqual(anonRows.map((row) => row.title), ["INTELIGENCIA", "AUTOMACAO"]);
    assert.equal(userInsert?.code, "42501");
  });
});

describe("plans cms", () => {
  it("stores plans and features with public read/admin write", async () => {
    const plan = await asRole("authenticated", ADMIN_ID, async () =>
      (await db.query(
        `insert into public.plans (slug, name, monogram, range, visible, "position")
         values ('plan-plus','Plus','P+','R$ 800',true,0) returning id`,
      )).rows[0],
    );
    await asRole("authenticated", ADMIN_ID, () =>
      db.query(`insert into public.plan_features (plan_id, "position", text) values ($1,0,'Design'), ($1,1,'Form')`, [plan.id]),
    );

    const publicPlans = await asRole("anon", null, async () => (await db.query("select slug from public.plans")).rows);
    const publicFeatures = await asRole("anon", null, async () => (await db.query("select text from public.plan_features order by position")).rows);
    const userWrite = await asRole("authenticated", USER_ID, () =>
      failure("insert into public.plans (slug, name) values ('hack','Hack')"),
    );

    assert.deepEqual(publicPlans.map((row) => row.slug), ["plan-plus"]);
    assert.deepEqual(publicFeatures.map((row) => row.text), ["Design", "Form"]);
    assert.equal(userWrite?.code, "42501");
  });
});

describe("site content and settings", () => {
  it("allows public reads and admin-only writes", async () => {
    await asRole("authenticated", ADMIN_ID, () =>
      db.query("insert into public.site_content (key, content) values ('hero', $1)", [JSON.stringify({ headline: "Space" })]),
    );
    await asRole("authenticated", ADMIN_ID, () =>
      db.query("insert into public.site_settings (site_name, locale) values ('Space Underground', 'pt-BR')"),
    );

    const content = await asRole("anon", null, async () => (await db.query("select content from public.site_content where key = 'hero'")).rows);
    const settings = await asRole("anon", null, async () => (await db.query("select site_name from public.site_settings")).rows);
    const userContentWrite = await asRole("authenticated", USER_ID, () =>
      failure("insert into public.site_content (key, content) values ('footer', '{}')"),
    );

    assert.equal(content[0].content.headline, "Space");
    assert.equal(settings[0].site_name, "Space Underground");
    assert.equal(userContentWrite?.code, "42501");
  });
});

describe("activity log", () => {
  it("is visible only to admins and never writable by public users", async () => {
    await asRole("authenticated", ADMIN_ID, () =>
      db.query(
        "insert into public.activity_log (admin_user_id, action, entity_type, entity_id, title, detail) values ($1,'project.updated','project','1','Project updated','CASE 001')",
        [ADMIN_ID],
      ),
    );

    const adminRows = await asRole("authenticated", ADMIN_ID, async () => (await db.query("select title from public.activity_log")).rows);
    const publicRead = await asRole("anon", null, () => failure("select title from public.activity_log"));
    const userInsert = await asRole("authenticated", USER_ID, () =>
      failure("insert into public.activity_log (action, entity_type, title) values ('x','x','x')"),
    );

    assert.deepEqual(adminRows.map((row) => row.title), ["Project updated"]);
    assert.equal(publicRead?.code, "42501");
    assert.equal(userInsert?.code, "42501");
  });
});
