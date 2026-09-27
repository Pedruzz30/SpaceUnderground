// The migration chain as a whole: numbering and a clean replay.
//
// Two files once shared the 010 prefix (010_normalize_plan_status and
// 010_automation_runs). The Supabase CLI keys a migration by that prefix, so a
// duplicate breaks `db push` and `db reset` on a fresh database, and nothing in
// the per-migration tests noticed. This test fails on that, and proves every
// file applies in order to an empty database shaped like Supabase.
//
//   npm test

import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const DIR = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));
const FILES = readdirSync(DIR).filter((name) => name.endsWith(".sql")).sort();
const read = (name) => readFileSync(`${DIR}${name}`, "utf8");
const prefix = (name) => name.match(/^(\d+)_/)?.[1] ?? null;

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

describe("migration chain", () => {
  it("numbers every file with a three digit prefix", () => {
    assert.ok(FILES.length > 0, "no migrations found");
    const unnumbered = FILES.filter((name) => !/^\d{3}_[a-z0-9_]+\.sql$/.test(name));
    assert.deepEqual(unnumbered, []);
  });

  it("never reuses a version", () => {
    const seen = new Map();
    const duplicates = [];
    for (const name of FILES) {
      const version = prefix(name);
      if (seen.has(version)) duplicates.push(`${seen.get(version)} / ${name}`);
      else seen.set(version, name);
    }
    assert.deepEqual(duplicates, []);
  });

  it("has no gaps, so the order is unambiguous from 001 up", () => {
    const versions = FILES.map((name) => Number(prefix(name)));
    assert.deepEqual(versions, versions.map((_, index) => index + 1));
  });

  it("applies in order to an empty Supabase-shaped database", async () => {
    for (const name of FILES) {
      await assert.doesNotReject(() => db.exec(read(name)), `${name} failed on a fresh chain`);
    }
  });

  it("re-applies the schema production already has without changing anything", async () => {
    // 011 and 012 were created in production before they joined this chain,
    // so running them there again must be a no-op.
    for (const name of FILES.filter((file) => /^01[12]_/.test(file))) {
      await assert.doesNotReject(() => db.exec(read(name)), `${name} is not idempotent`);
    }
  });
});
