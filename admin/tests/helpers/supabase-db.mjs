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
    -- Sessions and their authentication methods, as Supabase Auth keeps them:
    -- aal and the factor that raised it to aal2 (factor_id), and one row per
    -- method with the time it last authenticated (updated_at), which is what
    -- the access token's amr carries.
    create table auth.sessions (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references auth.users (id) on delete cascade,
      aal text,
      factor_id uuid,
      created_at timestamptz not null default now()
    );
    create table auth.mfa_amr_claims (
      id uuid primary key default gen_random_uuid(),
      session_id uuid not null references auth.sessions (id) on delete cascade,
      authentication_method text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (session_id, authentication_method)
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
// sign-in (aal2, a TOTP entry in amr, iat). That alone proves no MFA: the
// database also wants the token's session (session_id) live, aal2 and bound
// to a verified factor (see mfaSession). extra overrides any of it: aal,
// amr, iat, session_id.
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

// A verified factor (TOTP unless type says otherwise), as Supabase Auth
// records one once its first code is accepted; by default verified a day
// ago. Returns its id.
export async function addVerifiedFactor(db, uid, { verifiedAt = null, type = "totp" } = {}) {
  const { rows } = await db.query(
    `insert into auth.mfa_factors (user_id, factor_type, status, created_at, updated_at)
     values ($1, $3, 'verified', coalesce($2::timestamptz, now() - interval '1 day'), coalesce($2::timestamptz, now() - interval '1 day'))
     returning id`,
    [uid, verifiedAt, type],
  );
  return { id: rows[0].id };
}

// The amr method Supabase Auth records for each factor type.
export const MFA_METHOD = { totp: "totp", phone: "mfa/phone", webauthn: "mfa/webauthn" };

// A sign-in, as Supabase Auth records it: an aal1 session with a password
// entry. Returns the session id.
export async function signIn(db, uid) {
  const { rows } = await db.query("insert into auth.sessions (user_id, aal) values ($1, 'aal1') returning id", [uid]);
  await db.query("insert into auth.mfa_amr_claims (session_id, authentication_method) values ($1, 'password')", [rows[0].id]);
  return rows[0].id;
}

// mfa.challengeAndVerify on a session, as Supabase Auth applies it: the
// factor becomes verified (if it was not), the session aal2 and bound to it
// (factor_id), and the session's entry for the factor's method is created or
// moved to this moment (at, default now). Returns the claims of the access
// token that verification issues, whose amr entry carries that second.
export async function verifyFactor(db, sessionId, factorId, { at = null } = {}) {
  const factor = (await db.query("select factor_type from auth.mfa_factors where id = $1", [factorId])).rows[0];
  const method = MFA_METHOD[factor.factor_type];
  await db.query("update auth.mfa_factors set status = 'verified', updated_at = coalesce($2::timestamptz, now()) where id = $1 and status <> 'verified'", [factorId, at]);
  await db.query("update auth.sessions set aal = 'aal2', factor_id = $2 where id = $1", [sessionId, factorId]);
  const { rows } = await db.query(
    `insert into auth.mfa_amr_claims (session_id, authentication_method, created_at, updated_at)
     values ($1, $2, coalesce($3::timestamptz, now()), coalesce($3::timestamptz, now()))
     on conflict (session_id, authentication_method) do update set updated_at = excluded.updated_at
     returning floor(extract(epoch from updated_at))::bigint as second`,
    [sessionId, method, at],
  );
  const second = Number(rows[0].second);
  return {
    aal: "aal2",
    amr: [
      { method: "password", timestamp: second - 60 },
      { method, timestamp: second },
    ],
    iat: issuedNow(),
    session_id: sessionId,
  };
}

// A sign-in that then verified `factorId`. Returns the session id and the
// claims of its access token.
export async function mfaSession(db, uid, { factorId, at = null } = {}) {
  const sessionId = await signIn(db, uid);
  const claims = await verifyFactor(db, sessionId, factorId, { at });
  return { sessionId, claims };
}

// supabase.auth.mfa.unenroll(), as Supabase Auth applies it: the sessions
// bound to the factor lose that factor's amr entry (matched by factor type,
// as Supabase Auth does) and drop to aal1 with no factor, and the factor is
// deleted. A token those sessions issued keeps saying aal2.
export async function unenroll(db, factorId) {
  const factor = (await db.query("select factor_type from auth.mfa_factors where id = $1", [factorId])).rows[0];
  await db.query(
    "delete from auth.mfa_amr_claims where authentication_method = $2 and session_id in (select id from auth.sessions where factor_id = $1)",
    [factorId, factor?.factor_type ?? null],
  );
  await db.query("update auth.sessions set aal = 'aal1', factor_id = null where factor_id = $1", [factorId]);
  await db.query("delete from auth.mfa_factors where id = $1", [factorId]);
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
