// Applies the migrations Clients V2 depends on (admin foundation, plans CMS,
// business workflows, clients foundation) to a
// real Postgres engine (PGlite) and exercises the client code generator, the
// archive stamp, the optional project relationship and row level security.
//
//   npm test
//
// No Docker, no Supabase project and no credentials required.

import { strict as assert } from "node:assert";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { MIGRATIONS_DIR, applyMigrations, migrationFile, migrationFiles, readMigration } from "./helpers/migration-files.mjs";
import { addVerifiedFactor, mfaSession } from "./helpers/supabase-db.mjs";

// Found by purpose, never by version: business workflows must come before
// clients foundation, which migration-chain.test.mjs checks by timestamp.
const CLIENTS = readMigration("clients_foundation");
const CLIENTS_FILE = migrationFile("clients_foundation");

const ADMIN_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";

// The columns the admin repository selects. Kept here, next to the migration
// test, so a column the Admin reads but no migration creates fails locally
// instead of as PostgREST 42703 in production.
const { CLIENT_COLUMNS } = await import("../src/services/mappers/client-mapper.js");

let db;
let caseNumber = 100;
// The admin's signed-in session, which completed MFA (see before()).
let adminSession = null;

// Runs a callback the way PostgREST runs a request: as the given role, with
// request.jwt.claims set ({"role": ..., "sub": ...}). The claims are cleared
// afterwards, so SQL outside asRole runs with no JWT context at all, like a
// migration or the SQL editor.
// A signed-in request carries what Supabase puts in a token after an MFA
// sign-in (aal2, a TOTP entry in amr, iat, and for the admin the session
// that verified it): the admin here is a migrated OWNER, and privileged
// members hold nothing without MFA.
async function asRole(role, uid, fn) {
  const now = Math.floor(Date.now() / 1000);
  const session = { aal: "aal2", amr: [{ method: "totp", timestamp: now - 30 }], iat: now + 1, ...(uid === ADMIN_ID ? { session_id: adminSession } : {}) };
  const claims = JSON.stringify(uid ? { role, sub: uid, ...session } : { role });
  await db.query("select set_config('request.jwt.claims', $1, false)", [claims]);
  await db.exec(`set role ${role};`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role;");
    await db.query("select set_config('request.jwt.claims', '', false)");
  }
}

async function sequenceValue() {
  const { rows } = await db.query("select last_value from public.clients_code_seq");
  return Number(rows[0].last_value);
}

async function failure(sql, params = []) {
  try {
    await db.query(sql, params);
    return null;
  } catch (error) {
    return error;
  }
}

async function insertClient(values = {}) {
  const row = { name: "Aurora Labs", status: "ACTIVE", ...values };
  const columns = Object.keys(row);
  const { rows } = await db.query(
    `insert into public.clients (${columns.join(", ")}) values (${columns.map((_, index) => `$${index + 1}`).join(", ")}) returning *`,
    Object.values(row),
  );
  return rows[0];
}

async function insertProject(values = {}) {
  caseNumber += 1;
  const { rows } = await db.query(
    `insert into public.projects (case_number, name, slug, client_id, editorial_status, visible)
     values ($1, $2, $3, $4, $5, $6) returning *`,
    [
      caseNumber,
      values.name ?? `Case ${caseNumber}`,
      values.slug ?? `case-${caseNumber}`,
      values.client_id ?? null,
      values.editorial_status ?? "DRAFT",
      values.visible ?? false,
    ],
  );
  return rows[0];
}

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create schema if not exists auth;
    create table auth.users (id uuid primary key, email text);
    -- The factors and sessions Supabase Auth keeps; the security foundation
    -- reads them on every permission check.
    create table auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users (id), factor_type text not null default 'totp', status text not null default 'unverified', created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users (id), aal text, factor_id uuid, created_at timestamptz not null default now());
    create table auth.mfa_amr_claims (id uuid primary key default gen_random_uuid(), session_id uuid not null references auth.sessions (id) on delete cascade, authentication_method text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (session_id, authentication_method));
    -- Supabase's own definition: the legacy claim first, then the claims JSON.
    create or replace function auth.uid() returns uuid language sql stable as $$
      select coalesce(
        nullif(current_setting('request.jwt.claim.sub', true), ''),
        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
      )::uuid;
    $$;
    -- Supabase grants every new table, sequence and function in public to the
    -- API roles by default. Without this the test would pass on grants that
    -- production never has, so a revoke that is missing would go unnoticed.
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

    create schema if not exists storage;
    grant usage on schema storage to anon, authenticated;
    create table storage.buckets (id text primary key, name text not null, public boolean not null default false, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text not null, owner uuid);
    create or replace function storage.foldername(name text) returns text[] language plpgsql immutable as $$
    declare _parts text[];
    begin
      select string_to_array(name, '/') into _parts;
      return _parts[1:array_length(_parts, 1) - 1];
    end
    $$;
    alter table storage.objects enable row level security;
  `);
  await db.query("insert into auth.users (id, email) values ($1, $2), ($3, $4)", [
    ADMIN_ID,
    "admin@space.local",
    USER_ID,
    "someone@space.local",
  ]);

  // The whole chain, in order, as production has it. Later migrations (the
  // post-review hardening grants every public project column) need tables and
  // columns from earlier ones, so a hand-picked subset would not apply.
  // The admin is one from before the security foundation, which makes them an
  // OWNER, as it does in production.
  await applyMigrations(db, {
    legacyAdmins: [ADMIN_ID],
    before: {
      [CLIENTS_FILE]: async () => {
        // Rows that exist before clients foundation runs: one without a code and
        // one already archived, the two shapes the backfill has to repair.
        await db.query("insert into public.clients (name, status, created_at) values ('Legacy One', 'ACTIVE', now() - interval '2 days')");
        await db.query("insert into public.clients (name, status, code, created_at) values ('Legacy Two', 'ARCHIVED', 'CLIENT-007', now() - interval '1 day')");
      },
    },
  });
  // The TOTP factor an OWNER needs from the first use, and the session that
  // verified it two hours ago.
  const factor = await addVerifiedFactor(db, ADMIN_ID);
  adminSession = (await mfaSession(db, ADMIN_ID, { factorId: factor.id, at: new Date(Date.now() - 2 * 3600_000) })).sessionId;
});

after(async () => {
  await db?.close();
});

describe("clients foundation migration", () => {
  it("refuses to run before business workflows created the clients table", async () => {
    const empty = new PGlite();
    try {
      await assert.rejects(() => empty.exec(CLIENTS), /requires \d{14}_011_business_workflows/);
    } finally {
      await empty.close();
    }
  });

  it("is idempotent", async () => {
    await db.exec(CLIENTS);
    await db.exec(CLIENTS);
    // Re-running it rewrote what later migrations changed (the security
    // foundation replaces the code generator, its grants and the column
    // default). Re-apply those, so the rest of this file tests the schema
    // production has rather than a mix of old and new.
    for (const name of migrationFiles().filter((file) => file > CLIENTS_FILE)) {
      await db.exec(readFileSync(`${MIGRATIONS_DIR}${name}`, "utf8"));
    }
  });

  it("creates every column the admin repository selects", async () => {
    const { rows } = await db.query(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'clients'",
    );
    const existing = new Set(rows.map((row) => row.column_name));
    const missing = CLIENT_COLUMNS.split(",").filter((column) => !existing.has(column));
    assert.deepEqual(missing, []);
  });

  it("backfills codes for legacy rows after the highest existing code", async () => {
    const { rows } = await db.query("select name, code from public.clients where name like 'Legacy%' order by name");
    assert.deepEqual(rows, [
      { name: "Legacy One", code: "CLIENT-008" },
      { name: "Legacy Two", code: "CLIENT-007" },
    ]);
  });

  it("backfills archived_at for rows that were already archived", async () => {
    const { rows } = await db.query("select archived_at from public.clients where name = 'Legacy Two'");
    assert.ok(rows[0].archived_at);
  });
});

describe("clients.code", () => {
  it("assigns the next code from the sequence when none is given", async () => {
    const first = await insertClient({ name: "Sequence A" });
    const second = await insertClient({ name: "Sequence B" });
    const number = (code) => Number(code.replace("CLIENT-", ""));

    assert.match(first.code, /^CLIENT-\d{3,}$/);
    assert.equal(number(second.code), number(first.code) + 1);
  });

  it("never reuses the number of a removed client", async () => {
    const removed = await insertClient({ name: "Removed" });
    await db.query("delete from public.clients where id = $1", [removed.id]);
    const next = await insertClient({ name: "After removal" });
    assert.notEqual(next.code, removed.code);
  });

  it("skips a code that was typed by hand", async () => {
    const { rows } = await db.query("select last_value from public.clients_code_seq");
    const upcoming = `CLIENT-${String(Number(rows[0].last_value) + 1).padStart(3, "0")}`;
    await insertClient({ name: "Manual", code: upcoming });

    const generated = await insertClient({ name: "Generated" });
    assert.notEqual(generated.code, upcoming);
  });

  it("keeps growing past 999 instead of truncating", async () => {
    await db.query("select setval('public.clients_code_seq', 999, true)");
    const { rows } = await db.query("select public.next_client_code() as code");
    assert.equal(rows[0].code, "CLIENT-1000");
  });

  it("rejects duplicate and blank codes", async () => {
    const existing = await insertClient({ name: "Unique" });
    const duplicate = await failure("insert into public.clients (name, code) values ('Dup', $1)", [existing.code]);
    assert.equal(duplicate?.code, "23505");
    assert.match(`${duplicate.message} ${duplicate.detail ?? ""}`, /clients_code/);

    const blank = await failure("insert into public.clients (name, code) values ('Blank', '  ')");
    assert.equal(blank?.code, "23514");

    // An explicit null asks for a generated code, like leaving the column out:
    // the security foundation assigns codes in a trigger (a column default
    // needed EXECUTE on the generator from every inserting role). The column
    // itself still refuses null on update.
    const generated = await insertClient({ name: "Null", code: null });
    assert.match(generated.code, /^CLIENT-\d{3,}$/);
    const cleared = await failure("update public.clients set code = null where id = $1", [generated.id]);
    assert.equal(cleared?.code, "23502");
  });
});

describe("clients lifecycle", () => {
  it("only accepts the four lifecycle statuses", async () => {
    const error = await failure("insert into public.clients (name, status) values ('Bad', 'PROSPECT')");
    assert.equal(error?.code, "23514");
  });

  it("stamps archived_at on archive, keeps it while archived and clears it on restore", async () => {
    const client = await insertClient({ name: "Lifecycle", status: "ACTIVE" });
    assert.equal(client.archived_at, null);

    const { rows: archived } = await db.query("update public.clients set status = 'ARCHIVED' where id = $1 returning archived_at", [client.id]);
    assert.ok(archived[0].archived_at);

    const { rows: edited } = await db.query("update public.clients set notes = 'still archived' where id = $1 returning archived_at", [client.id]);
    assert.equal(edited[0].archived_at.getTime(), archived[0].archived_at.getTime());

    const { rows: restored } = await db.query("update public.clients set status = 'INACTIVE' where id = $1 returning archived_at", [client.id]);
    assert.equal(restored[0].archived_at, null);
  });

  it("ignores an archived_at sent by a client", async () => {
    const { rows } = await db.query(
      "insert into public.clients (name, status, archived_at) values ('Forged', 'ACTIVE', now()) returning archived_at",
    );
    assert.equal(rows[0].archived_at, null);
  });

  it("owns updated_at", async () => {
    const client = await insertClient({ name: "Touch" });
    await db.query("update public.clients set updated_at = '2000-01-01' where id = $1", [client.id]);
    const { rows } = await db.query("select updated_at from public.clients where id = $1", [client.id]);
    assert.ok(rows[0].updated_at.getFullYear() > 2000);
  });
});

describe("projects.client_id", () => {
  it("is optional, so existing projects need no client", async () => {
    const project = await insertProject();
    assert.equal(project.client_id, null);
  });

  it("links a project to a client and rejects an unknown client", async () => {
    const client = await insertClient({ name: "Owner" });
    const project = await insertProject({ client_id: client.id });
    assert.equal(project.client_id, client.id);

    const error = await failure(
      "insert into public.projects (case_number, name, slug, client_id) values (9001, 'Orphan', 'orphan', gen_random_uuid())",
    );
    assert.equal(error?.code, "23503");
  });

  it("lets one client own many projects", async () => {
    const client = await insertClient({ name: "Many" });
    await insertProject({ client_id: client.id });
    await insertProject({ client_id: client.id });
    const { rows } = await db.query("select count(*)::int as total from public.projects where client_id = $1", [client.id]);
    assert.equal(rows[0].total, 2);
  });

  it("keeps the project when a client row is removed by hand", async () => {
    const client = await insertClient({ name: "Removed owner" });
    const project = await insertProject({ client_id: client.id });
    await db.query("delete from public.clients where id = $1", [client.id]);
    const { rows } = await db.query("select client_id from public.projects where id = $1", [project.id]);
    assert.equal(rows[0].client_id, null);
  });

  it("indexes the relationship and the hub filters", async () => {
    const { rows } = await db.query(
      "select indexname from pg_indexes where schemaname = 'public' and indexname in ('projects_client_idx', 'clients_status_idx', 'clients_updated_at_idx') order by indexname",
    );
    assert.deepEqual(rows.map((row) => row.indexname), ["clients_status_idx", "clients_updated_at_idx", "projects_client_idx"]);
  });
});

describe("clients row level security", () => {
  it("gives anonymous visitors no grant and no rows", async () => {
    await insertClient({ name: "Private" });
    const { rows: grants } = await db.query(
      "select privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = 'clients' and grantee = 'anon'",
    );
    assert.deepEqual(grants, []);

    const error = await asRole("anon", null, () => failure("select * from public.clients"));
    assert.equal(error?.code, "42501");
  });

  it("hides every client from an authenticated user who is not an admin", async () => {
    const { rows } = await asRole("authenticated", USER_ID, () => db.query("select * from public.clients"));
    assert.equal(rows.length, 0);
  });

  it("blocks writes from an authenticated user who is not an admin", async () => {
    const error = await asRole("authenticated", USER_ID, () =>
      failure("insert into public.clients (name) values ('Intruder')"),
    );
    assert.equal(error?.code, "42501");

    const target = await insertClient({ name: "Protected" });
    const { rows } = await asRole("authenticated", USER_ID, () =>
      db.query("update public.clients set name = 'Hijacked' where id = $1 returning id", [target.id]),
    );
    assert.equal(rows.length, 0);
  });

  it("lets an admin create, read, update and archive clients with a generated code", async () => {
    const created = await asRole("authenticated", ADMIN_ID, async () => {
      const { rows } = await db.query("insert into public.clients (name, email) values ('Admin Made', 'ops@example.com') returning *");
      return rows[0];
    });
    assert.match(created.code, /^CLIENT-\d{3,}$/);
    assert.equal(created.status, "LEAD");

    const archived = await asRole("authenticated", ADMIN_ID, async () => {
      const { rows } = await db.query("update public.clients set status = 'ARCHIVED' where id = $1 returning *", [created.id]);
      return rows[0];
    });
    assert.ok(archived.archived_at);

    const { rows } = await asRole("authenticated", ADMIN_ID, () => db.query("select id from public.clients where id = $1", [created.id]));
    assert.equal(rows.length, 1);
  });

  it("lets an admin link a project to a client", async () => {
    const client = await insertClient({ name: "Linkable" });
    const project = await insertProject();
    const { rows } = await asRole("authenticated", ADMIN_ID, () =>
      db.query("update public.projects set client_id = $1 where id = $2 returning client_id", [client.id, project.id]),
    );
    assert.equal(rows[0].client_id, client.id);
  });

  it("does not let anonymous visitors call the code generator", async () => {
    const error = await asRole("anon", null, () => failure("select public.next_client_code()"));
    assert.equal(error?.code, "42501");
  });

  it("does not let API roles draw from the code sequence directly", async () => {
    for (const role of ["anon", "authenticated"]) {
      const error = await asRole(role, null, () => failure("select nextval('public.clients_code_seq')"));
      assert.equal(error?.code, "42501", role);
    }
  });

  it("does not let authenticated users read or advance the sequence directly", async () => {
    for (const sql of [
      "select last_value from public.clients_code_seq",
      "select nextval('public.clients_code_seq')",
      "select setval('public.clients_code_seq', 1)",
    ]) {
      const error = await asRole("authenticated", ADMIN_ID, () => failure(sql));
      assert.equal(error?.code, "42501", sql);
    }
  });
});

// The generator's contract after the security foundation: it is not an RPC
// for anyone (codes come from inserting a client, through the
// clients_assign_code trigger), and it refuses anyone without clients.create
// before drawing a number. Direct SQL (migrations, the SQL editor) keeps it.
describe("client code generator authorization", () => {
  it("rejects anonymous visitors", async () => {
    const before = await sequenceValue();
    const error = await asRole("anon", null, () => failure("select public.next_client_code()"));
    assert.equal(error?.code, "42501");
    assert.equal(await sequenceValue(), before);
  });

  it("rejects a signed-in user who is not an admin before drawing a number", async () => {
    const before = await sequenceValue();
    const error = await asRole("authenticated", USER_ID, () => failure("select public.next_client_code()"));
    assert.equal(error?.code, "42501");
    assert.equal(await sequenceValue(), before, "a denied call must not consume a number");
  });

  it("refuses the insert of a signed-in user who is not an admin inside the generator", async () => {
    const before = await sequenceValue();
    const error = await asRole("authenticated", USER_ID, () => failure("insert into public.clients (name) values ('No code for you')"));
    assert.equal(error?.code, "42501");
    assert.match(error.message, /not authorized to generate client codes/);
    assert.equal(await sequenceValue(), before);
  });

  it("does not burn a number when a non-admin insert is refused", async () => {
    const before = await sequenceValue();
    const error = await asRole("authenticated", USER_ID, () => failure("insert into public.clients (name) values ('Sneaky')"));
    assert.equal(error?.code, "42501");
    assert.equal(await sequenceValue(), before);
  });

  it("serves an admin through the insert, not as an RPC", async () => {
    const { rows } = await asRole("authenticated", ADMIN_ID, () => db.query("insert into public.clients (name) values ('Admin insert') returning code"));
    assert.match(rows[0].code, /^CLIENT-\d{3,}$/);
    const before = await sequenceValue();
    const error = await asRole("authenticated", ADMIN_ID, () => failure("select public.next_client_code()"));
    assert.equal(error?.code, "42501", "the generator itself is not an API");
    assert.equal(await sequenceValue(), before);
  });

  it("serves the service role through the insert, not as an RPC", async () => {
    const { rows } = await asRole("service_role", null, () => db.query("insert into public.clients (name) values ('Service insert') returning code"));
    assert.match(rows[0].code, /^CLIENT-\d{3,}$/);
    const error = await asRole("service_role", null, () => failure("select public.next_client_code()"));
    assert.equal(error?.code, "42501");
  });

  it("serves direct SQL with no JWT context (migrations, SQL editor)", async () => {
    const { rows } = await db.query("select public.next_client_code() as code");
    assert.match(rows[0].code, /^CLIENT-\d{3,}$/);
    const client = await insertClient({ name: "Direct SQL" });
    assert.match(client.code, /^CLIENT-\d{3,}$/);
  });

  it("treats an empty claims object as an API request, not as direct SQL", async () => {
    await db.query("select set_config('request.jwt.claims', '{}', false)");
    try {
      const error = await failure("select public.next_client_code()");
      assert.equal(error?.code, "42501");
    } finally {
      await db.query("select set_config('request.jwt.claims', '', false)");
    }
  });

  it("leaves the public project read policy untouched", async () => {
    const client = await insertClient({ name: "Public owner" });
    await insertProject({ client_id: client.id, editorial_status: "PUBLISHED", visible: true, slug: "public-linked" });
    await insertProject({ editorial_status: "DRAFT", visible: true, slug: "draft-unlinked" });

    const { rows } = await asRole("anon", null, () => db.query("select slug from public.projects where slug in ('public-linked', 'draft-unlinked')"));
    assert.deepEqual(rows.map((row) => row.slug), ["public-linked"]);
  });
});
