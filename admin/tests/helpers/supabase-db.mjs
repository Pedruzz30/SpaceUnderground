// A PGlite database shaped like a Supabase project: the three API roles, the
// auth schema with Supabase's own auth.uid(), the default privileges Supabase
// grants on every new object in public, and a minimal storage schema. Tests
// that exercise a migration's grants and policies start from here, so a revoke
// that production needs cannot pass just because the test database never
// granted anything.

import { PGlite } from "@electric-sql/pglite";

export const ADMIN_ID = "11111111-1111-1111-1111-111111111111";
export const USER_ID = "22222222-2222-2222-2222-222222222222";

export async function createSupabaseDb() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    grant usage on schema public to anon, authenticated, service_role;
    create schema if not exists auth;
    create table auth.users (id uuid primary key, email text);
    create or replace function auth.uid() returns uuid language sql stable as $$
      select coalesce(
        nullif(current_setting('request.jwt.claim.sub', true), ''),
        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
      )::uuid;
    $$;
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
  return db;
}

// Runs a callback the way PostgREST runs a request: as the given role, with
// request.jwt.claims set. The claims are cleared afterwards, so SQL outside
// runs with no JWT context at all, like a migration or the SQL editor.
export async function asRole(db, role, uid, fn) {
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

export async function failure(db, sql, params = []) {
  try {
    await db.query(sql, params);
    return null;
  } catch (error) {
    return error;
  }
}
