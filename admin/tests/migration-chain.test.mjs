// The migration chain as a whole: identity, order and a clean replay.
//
// Migrations follow the Supabase CLI format, YYYYMMDDHHMMSS_<name>.sql. The
// timestamp is the version the CLI records in supabase_migrations.schema_migrations,
// so it must be unique, and sorting the files must sort them chronologically.
// Before this format two files shared the version 010 and nothing noticed.
//
// The versions production has already recorded are pinned below: renaming one
// of them would make the CLI treat applied schema as pending.
//
//   npm test

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { MIGRATIONS_DIR, migrationFile, migrationFiles } from "./helpers/migration-files.mjs";

const FILES = migrationFiles();
const version = (name) => name.slice(0, 14);
const read = (name) => readFileSync(`${MIGRATIONS_DIR}${name}`, "utf8");

// select version, name from supabase_migrations.schema_migrations (production,
// zvzfkfvxbuofgqrrogxh). The file name is <version>_<name> exactly.
const RECORDED_IN_PRODUCTION = [
  "20260912202425_editorial_i18n.sql",
  "20260913031225_project_live_preview.sql",
  "20260913211045_automation_runs.sql",
  "20260914025524_011_business_workflows.sql",
  "20260927225426_normalize_plan_status.sql",
];

// Schema production already had before the CLI recorded anything. Their
// versions come from the commit that first added each file, and the history
// was repaired to mark them applied; they must stay before the first version
// the CLI recorded on its own.
const HISTORICAL = [
  "admin_foundation",
  "project_media_storage",
  "project_presentation",
  "plans_cms",
  "site_content",
  "site_settings",
  "activity_log",
];

// Written after the recorded history and not applied anywhere yet.
const PENDING = ["clients_foundation"];

function toDate(stamp) {
  const [, y, mo, d, h, mi, s] = stamp.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  const date = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
  // Date.UTC rolls 20260231 over into March; a real timestamp survives a round trip.
  const roundTrip = date.toISOString().replace(/\D/g, "").slice(0, 14);
  return roundTrip === stamp ? date : null;
}

let db;

before(async () => {
  db = new PGlite();
  // What a Supabase project provides before any migration runs.
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
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;

    create schema if not exists storage;
    grant usage on schema storage to anon, authenticated;
    create table storage.buckets (
      id text primary key,
      name text not null,
      public boolean not null default false,
      file_size_limit bigint,
      allowed_mime_types text[]
    );
    create table storage.objects (
      id uuid primary key default gen_random_uuid(),
      bucket_id text references storage.buckets (id),
      name text not null,
      owner uuid
    );
    create or replace function storage.foldername(name text) returns text[] language plpgsql immutable as $$
    declare _parts text[];
    begin
      select string_to_array(name, '/') into _parts;
      return _parts[1:array_length(_parts, 1) - 1];
    end
    $$;
    alter table storage.objects enable row level security;
  `);
});

after(async () => {
  await db?.close();
});

describe("migration identity", () => {
  it("names every file <14 digit timestamp>_<name>.sql", () => {
    assert.ok(FILES.length > 0, "no migrations found");
    const invalid = FILES.filter((name) => !/^\d{14}_[a-z0-9_]+\.sql$/.test(name));
    assert.deepEqual(invalid, []);
  });

  it("uses no bare three digit versions any more", () => {
    assert.deepEqual(FILES.filter((name) => /^\d{3}_/.test(name)), []);
  });

  it("uses real UTC timestamps as versions", () => {
    assert.deepEqual(FILES.filter((name) => !toDate(version(name))), []);
  });

  it("never reuses a version", () => {
    const versions = FILES.map(version);
    const duplicates = versions.filter((value, index) => versions.indexOf(value) !== index);
    assert.deepEqual(duplicates, []);
  });

  it("sorts chronologically when sorted by name", () => {
    const times = FILES.map((name) => toDate(version(name)).getTime());
    assert.deepEqual(times, [...times].sort((a, b) => a - b));
  });
});

describe("production history", () => {
  it("keeps every version production has recorded, under the recorded name", () => {
    const missing = RECORDED_IN_PRODUCTION.filter((name) => !FILES.includes(name));
    assert.deepEqual(missing, []);
  });

  it("places the historical migrations before the first recorded version", () => {
    const first = version(RECORDED_IN_PRODUCTION[0]);
    for (const purpose of HISTORICAL) {
      assert.ok(version(migrationFile(purpose)) < first, `${purpose} must precede ${first}`);
    }
  });

  it("keeps the historical order admin foundation -> activity log", () => {
    const versions = HISTORICAL.map((purpose) => version(migrationFile(purpose)));
    assert.deepEqual(versions, [...versions].sort());
  });

  it("gives pending migrations versions after everything production recorded", () => {
    const last = version(RECORDED_IN_PRODUCTION.at(-1));
    for (const purpose of PENDING) {
      assert.ok(version(migrationFile(purpose)) > last, `${purpose} must come after ${last}`);
    }
  });
});

describe("clients foundation", () => {
  it("comes after business workflows, which creates the clients table", () => {
    assert.ok(version(migrationFile("clients_foundation")) > version(migrationFile("business_workflows")));
  });

  it("comes after the plan status normalization", () => {
    assert.ok(version(migrationFile("clients_foundation")) > version(migrationFile("normalize_plan_status")));
  });
});

describe("fresh database", () => {
  it("applies every migration in order to an empty Supabase-shaped database", async () => {
    for (const name of FILES) {
      await assert.doesNotReject(() => db.exec(read(name)), `${name} failed on a fresh chain`);
    }
  });

  it("re-applies the schema production created before it joined the chain", async () => {
    for (const purpose of ["automation_runs", "business_workflows"]) {
      const name = migrationFile(purpose);
      await assert.doesNotReject(() => db.exec(read(name)), `${name} is not idempotent`);
    }
  });
});
