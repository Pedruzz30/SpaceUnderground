// What each caller can read from public.projects once the whole migration
// chain is applied: the public site (anon) keeps every column it uses and
// cannot see client_id; a signed-in user who is not an admin (sign-up is open)
// sees no project at all; an admin reads and writes everything.
//
// The public query is taken from src/scripts/supabase-public.js as written,
// so a column the site starts selecting without an anon grant fails here.
//
//   npm test

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { applyMigrations, readMigration } from "./helpers/migration-files.mjs";

const ADMIN_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";
const PUBLISHED_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const DRAFT_ID = "aaaaaaaa-0000-4000-8000-000000000002";

const publicSource = readFileSync(fileURLToPath(new URL("../../src/scripts/supabase-public.js", import.meta.url)), "utf8");
const listed = [...publicSource.match(/const PROJECT_COLUMNS = \[([\s\S]*?)\]/)[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
const PUBLIC_COLUMNS = listed.filter((column) => !column.includes("("));
const EMBEDS = listed
  .filter((column) => column.includes("("))
  .map((column) => ({ table: column.slice(0, column.indexOf("(")), columns: column.slice(column.indexOf("(") + 1, -1) }));

let db;
let clientId;

async function asRole(role, uid, fn) {
  const claims = JSON.stringify(uid ? { role, sub: uid } : { role });
  await db.query("select set_config('request.jwt.claims', $1, false)", [claims]);
  await db.exec(`set role ${role};`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role;");
    await db.query("select set_config('request.jwt.claims', '', false)");
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

// The exact request the public site sends, as SQL.
const PUBLIC_QUERY = `
  select ${PUBLIC_COLUMNS.join(", ")}
  from public.projects
  where editorial_status = 'PUBLISHED' and visible = true
  order by case_number
`;

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

    create schema if not exists auth;
    create table auth.users (id uuid primary key, email text);
    create or replace function auth.uid() returns uuid language sql stable as $$
      select coalesce(
        nullif(current_setting('request.jwt.claim.sub', true), ''),
        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
      )::uuid;
    $$;

    create schema if not exists storage;
    grant usage on schema storage to anon, authenticated;
    create table storage.buckets (id text primary key, name text not null, public boolean not null default false, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text not null, owner uuid);
    grant select on storage.objects to anon, authenticated;
    create or replace function storage.foldername(name text) returns text[] language plpgsql immutable as $$
    declare _parts text[];
    begin
      select string_to_array(name, '/') into _parts;
      return _parts[1:array_length(_parts, 1) - 1];
    end
    $$;
    alter table storage.objects enable row level security;
  `);

  // The admin is one from before the security foundation, which makes them an
  // OWNER, as it does in production.
  await db.query("insert into auth.users (id, email) values ($1, 'admin@space.local'), ($2, 'someone@space.local')", [ADMIN_ID, USER_ID]);
  await applyMigrations(db, { legacyAdmins: [ADMIN_ID] });
  const { rows } = await db.query("insert into public.clients (name, status) values ('Owner', 'ACTIVE') returning id");
  clientId = rows[0].id;
  await db.query(
    `insert into public.projects (id, case_number, name, slug, editorial_status, visible, client_id)
     values ($1, 1, 'Published', 'published', 'PUBLISHED', true, $3),
            ($2, 2, 'Draft', 'draft', 'DRAFT', false, null)`,
    [PUBLISHED_ID, DRAFT_ID, clientId],
  );
  await db.query("insert into public.project_gallery (project_id, url, position) values ($1, 'a.png', 0), ($2, 'b.png', 0)", [PUBLISHED_ID, DRAFT_ID]);
  await db.query("insert into public.project_modules (project_id, position, title) values ($1, 0, 'Module'), ($2, 0, 'Hidden')", [PUBLISHED_ID, DRAFT_ID]);
  // The project-media bucket itself comes from the media storage migration.
  await db.query(
    "insert into storage.objects (bucket_id, name) values ('project-media', $1), ('project-media', $2)",
    [`projects/${PUBLISHED_ID}/poster.png`, `projects/${DRAFT_ID}/poster.png`],
  );
});

after(async () => {
  await db?.close();
});

describe("public site (anon)", () => {
  it("parses the column list the public site sends", () => {
    assert.ok(PUBLIC_COLUMNS.length > 10);
    assert.equal(PUBLIC_COLUMNS.includes("client_id"), false);
  });

  it("runs the exact public project query and sees only the published project", async () => {
    const { rows } = await asRole("anon", null, () => db.query(PUBLIC_QUERY));
    assert.deepEqual(rows.map((row) => row.case_number), [1]);
    assert.equal("client_id" in rows[0], false);
  });

  it("still reads the embedded gallery and modules of published projects", async () => {
    for (const embed of EMBEDS) {
      const { rows } = await asRole("anon", null, () => db.query(`select ${embed.columns} from public.${embed.table}`));
      assert.equal(rows.length, 1, `${embed.table} should expose only the published project's rows`);
    }
  });

  it("still reads the media of published projects only", async () => {
    const { rows } = await asRole("anon", null, () => db.query("select name from storage.objects"));
    assert.deepEqual(rows.map((row) => row.name), [`projects/${PUBLISHED_ID}/poster.png`]);
  });

  it("cannot select client_id", async () => {
    const error = await asRole("anon", null, () => failure("select client_id from public.projects"));
    assert.equal(error?.code, "42501");
  });

  it("cannot reach client_id through select *", async () => {
    const error = await asRole("anon", null, () => failure("select * from public.projects"));
    assert.equal(error?.code, "42501");
  });

  it("cannot filter on client_id to infer ownership", async () => {
    const error = await asRole("anon", null, () => failure("select id from public.projects where client_id is not null"));
    assert.equal(error?.code, "42501");
  });
});

describe("signed-in user who is not an admin", () => {
  it("matches no project row, so client_id is never exposed", async () => {
    const { rows } = await asRole("authenticated", USER_ID, () => db.query("select id, client_id from public.projects"));
    assert.deepEqual(rows, []);
  });

  it("cannot link or unlink a project", async () => {
    const { rows } = await asRole("authenticated", USER_ID, () =>
      db.query("update public.projects set client_id = null where id = $1 returning id", [PUBLISHED_ID]),
    );
    assert.deepEqual(rows, []);
    const { rows: check } = await db.query("select client_id from public.projects where id = $1", [PUBLISHED_ID]);
    assert.equal(check[0].client_id, clientId);
  });
});

describe("admin", () => {
  it("reads client_id on every project", async () => {
    const { rows } = await asRole("authenticated", ADMIN_ID, () => db.query("select id, client_id from public.projects order by case_number"));
    assert.deepEqual(rows.map((row) => row.client_id), [clientId, null]);
  });

  it("links and unlinks with the conditional updates the Admin sends", async () => {
    const unlinked = await asRole("authenticated", ADMIN_ID, () =>
      db.query("update public.projects set client_id = null where id = $1 and client_id = $2 returning id", [PUBLISHED_ID, clientId]),
    );
    assert.equal(unlinked.rows.length, 1);
    const linked = await asRole("authenticated", ADMIN_ID, () =>
      db.query("update public.projects set client_id = $2 where id = $1 and client_id is null returning client_id", [PUBLISHED_ID, clientId]),
    );
    assert.equal(linked.rows[0].client_id, clientId);
  });
});

describe("post-review migration", () => {
  it("can run again without widening anything", async () => {
    await db.exec(readMigration("clients_post_review_hardening"));
    const { rows } = await asRole("anon", null, () => db.query(PUBLIC_QUERY));
    assert.equal(rows.length, 1);
    const error = await asRole("anon", null, () => failure("select client_id from public.projects"));
    assert.equal(error?.code, "42501");
  });

  it("adds a nullable clients.last_contact_at that admins can set and clear", async () => {
    const { rows: columns } = await db.query(
      "select data_type, is_nullable, column_default from information_schema.columns where table_schema = 'public' and table_name = 'clients' and column_name = 'last_contact_at'",
    );
    assert.deepEqual(columns[0], { data_type: "timestamp with time zone", is_nullable: "YES", column_default: null });

    const set = await asRole("authenticated", ADMIN_ID, () =>
      db.query("update public.clients set last_contact_at = '2026-09-20T12:00:00Z' where id = $1 returning last_contact_at", [clientId]),
    );
    assert.equal(set.rows[0].last_contact_at.toISOString(), "2026-09-20T12:00:00.000Z");
    const cleared = await asRole("authenticated", ADMIN_ID, () =>
      db.query("update public.clients set last_contact_at = null where id = $1 returning last_contact_at", [clientId]),
    );
    assert.equal(cleared.rows[0].last_contact_at, null);
  });

  it("does not stamp last_contact_at when a client is edited", async () => {
    const { rows } = await asRole("authenticated", ADMIN_ID, () =>
      db.query("update public.clients set notes = 'edited' where id = $1 returning last_contact_at", [clientId]),
    );
    assert.equal(rows[0].last_contact_at, null);
  });
});
