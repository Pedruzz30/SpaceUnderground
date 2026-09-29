// A PGlite database shaped like a Supabase project: the three API roles, the
// auth schema with Supabase's own auth.uid() and the Auth tables the security
// migration reads (MFA factors, sessions and refresh tokens), the default
// privileges Supabase grants on every new object in public, and a minimal
// storage schema. Tests that exercise a migration's grants and policies start
// from here, so a revoke that production needs cannot pass just because the
// test database never granted anything.

import { PGlite } from "@electric-sql/pglite";

export const ADMIN_ID = "11111111-1111-1111-1111-111111111111";
export const USER_ID = "22222222-2222-2222-2222-222222222222";

export async function createSupabaseDb() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    -- As on Supabase: the service role bypasses RLS (grants still apply).
    create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create schema if not exists auth;
    create table auth.users (
      id uuid primary key,
      email text,
      encrypted_password text not null default '',
      banned_until timestamptz,
      last_sign_in_at timestamptz,
      raw_user_meta_data jsonb not null default '{}'::jsonb
    );
    -- The columns the security foundation reads, as Supabase Auth has them:
    -- created_at at enrolment, updated_at when the factor is verified.
    create table auth.mfa_factors (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references auth.users (id) on delete cascade,
      factor_type text not null default 'totp',
      status text not null default 'unverified',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table auth.sessions (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references auth.users (id) on delete cascade
    );
    create table auth.refresh_tokens (
      id bigserial primary key,
      session_id uuid references auth.sessions (id) on delete cascade,
      token text not null default md5(random()::text)
    );
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
    -- Supabase grants the table itself; the policies decide.
    grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
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
//
// A signed-in request carries what a Supabase token carries after an MFA
// sign-in (aal2, a TOTP entry in amr, iat), since privileged members hold
// nothing without it. extra overrides any of it: aal, amr, iat, session_id.
export async function asRole(db, role, uid, fn, extra = {}) {
  const claims = JSON.stringify(uid ? { role, sub: uid, ...mfaClaims(30), iat: issuedNow(), ...extra } : { role, ...extra });
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

// The iat of a token issued just now, rounded up past the current second:
// it postdates anything a test did a moment ago (a revocation, say), the way
// a sign-in after a revocation does. A test about an older token passes its
// own iat.
export function issuedNow() {
  return Math.floor(Date.now() / 1000) + 1;
}

// A verified TOTP factor, as Supabase Auth records one once its first code
// is accepted. A token only reaches aal2 through one, so a member acting with
// mfaClaims needs one too: the database checks the factor on every request,
// and that the token's MFA is no older than it. By default it was verified a
// day ago, before any session a test signs in with; pass verifiedAt (a Date)
// for one verified later. Returns its id and the second it was verified.
export async function addVerifiedFactor(db, uid, { verifiedAt = null } = {}) {
  const { rows } = await db.query(
    `insert into auth.mfa_factors (user_id, status, created_at, updated_at)
     values ($1, 'verified', coalesce($2::timestamptz, now() - interval '1 day'), coalesce($2::timestamptz, now() - interval '1 day'))
     returning id, floor(extract(epoch from updated_at))::bigint as verified_second`,
    [uid, verifiedAt],
  );
  return { id: rows[0].id, verifiedSecond: Number(rows[0].verified_second) };
}

// Claims of a session that verified MFA `secondsAgo` seconds ago: aal2, with
// the TOTP entry Supabase Auth adds to amr. Fresh enough for step-up by
// default; pass more than the step-up window (600 s) for a stale one.
export function mfaClaims(secondsAgo = 30) {
  const now = Math.floor(Date.now() / 1000);
  return {
    aal: "aal2",
    amr: [
      { method: "password", timestamp: now - 3600 },
      { method: "totp", timestamp: now - secondsAgo },
    ],
  };
}
