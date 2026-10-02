// What the database exposes after the security migration, swept as a whole:
// no policy still on the old binary is_admin(), no write grant on a security
// table, no internal function reachable through the API, an audit log that
// keeps secrets out, and no privileged key anywhere in the Admin's source.
//
//   npm test

import { strict as assert } from "node:assert";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { as, code, createSecurityDb, one } from "./helpers/security-fixture.mjs";

const SECURITY_TABLES = [
  "roles",
  "permissions",
  "role_permissions",
  "approval_routes",
  "team_members",
  "user_roles",
  "project_members",
  "team_invitations",
  "security_settings",
  "change_requests",
  "security_audit_log",
];

// Functions from before the security migration that anon may run: the public
// site's media check and the translations check, and trigger functions, which
// cannot be called directly. is_admin() is not among them any more: nothing
// calls it after the migration.
const ANON_EXECUTABLE = [
  "media_project_id",
  "stamp_client_archived_at",
  "stamp_commercial_opportunity_stage",
  "stamp_financial_paid_at",
  "stamp_published_at",
  "touch_updated_at",
  "valid_i18n_translations",
];

const INTERNAL = [
  "write_audit",
  "revoke_auth_sessions",
  "set_auth_ban",
  "auth_user_has_password",
  "user_has_verified_factor",
  "mfa_method",
  "caller_mfa_verified_at",
  "caller_mfa_current",
  "mfa_gate",
  "member_roles",
  "member_is_active",
  "member_max_rank",
  "role_grants_permission",
  "assert_can_manage",
  "assert_can_grant_role",
  "validate_project_draft",
  "normalize_project_grants",
  "bootstrap_member",
  "next_member_ru",
  "end_member_sessions",
  "is_admin",
  "next_client_code",
  "assign_client_code",
];

let db;

before(async () => {
  db = await createSecurityDb();
});

after(async () => {
  await db?.close();
});

const executable = async (role) =>
  (await db.query("select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and has_function_privilege($1, p.oid, 'execute') order by 1", [role])).rows.map(
    (row) => row.proname,
  );

describe("database surface", () => {
  it("leaves no policy on the old binary is_admin()", async () => {
    const { rows } = await db.query(
      "select tablename, policyname from pg_policies where coalesce(qual, '') ~ 'is_admin' or coalesce(with_check, '') ~ 'is_admin'",
    );
    assert.deepEqual(rows, []);
  });

  it("keeps row level security on every public table", async () => {
    const { rows } = await db.query("select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity");
    assert.deepEqual(rows, []);
  });

  it("uses no always-true policy outside the public site's content", async () => {
    const { rows } = await db.query("select tablename, policyname from pg_policies where schemaname = 'public' and (qual = 'true' or with_check = 'true') order by 1");
    assert.deepEqual(rows.map((row) => row.tablename), ["site_content", "site_settings"], "the public site reads these two by design");
  });

  it("grants no API role a write on any security table", async () => {
    for (const table of SECURITY_TABLES) {
      const { rows } = await db.query(
        "select grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = $1 and grantee in ('anon', 'authenticated', 'service_role') order by 1, 2",
        [table],
      );
      assert.deepEqual(rows, [
        { grantee: "authenticated", privilege_type: "SELECT" },
        { grantee: "service_role", privilege_type: "SELECT" },
      ], table);
    }
  });

  it("lets anon run nothing the security migration added", async () => {
    assert.deepEqual(await executable("anon"), ANON_EXECUTABLE);
  });

  it("keeps the internal helpers out of every API role's reach", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      const reachable = await executable(role);
      assert.deepEqual(INTERNAL.filter((name) => reachable.includes(name)), [], role);
    }
  });

  it("pins the search_path of every function in public, with pg_temp last", async () => {
    const { rows } = await db.query(
      "select p.oid::regprocedure::text as sig, coalesce(array_to_string(p.proconfig, ','), '') as config from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1",
    );
    assert.ok(rows.length > 60);
    assert.deepEqual(rows.filter((row) => !/search_path=public, pg_temp/.test(row.config)).map((row) => row.sig), []);
  });

  it("keeps the invitation's service steps to the service role", async () => {
    assert.ok(!(await executable("authenticated")).includes("complete_invitation"));
    assert.ok((await executable("service_role")).includes("complete_invitation"));
  });

  it("hands no API role the sequences behind RUs and request numbers", async () => {
    const { rows } = await db.query(
      `select c.relname, r.rolname from pg_class c cross join pg_roles r
       where c.relkind = 'S' and c.relnamespace = 'public'::regnamespace
         and c.relname in ('team_member_ru_seq', 'change_requests_number_seq', 'security_audit_log_id_seq', 'user_roles_id_seq', 'project_members_id_seq', 'clients_code_seq')
         and r.rolname in ('anon', 'authenticated', 'service_role')
         and has_sequence_privilege(r.rolname, c.oid, 'usage')`,
    );
    assert.deepEqual(rows, []);
  });
});

describe("audit log", () => {
  it("keeps secret-looking metadata out, whatever the caller passes", async () => {
    await db.query(
      `select public.write_audit('SECURITY_SETTING_CHANGED', 'test', 'secrets', null,
        '{"password":"p","access_token":"t","refresh_token":"r","authorization":"Bearer x","cpf":"000","totp_secret":"s","service_role_key":"k","apikey":"a","kept":1}'::jsonb)`,
    );
    const row = await one(db.query("select metadata from public.security_audit_log where resource_id = 'secrets'"));
    assert.deepEqual(row.metadata, { kept: 1 });
  });

  it("records only known actions", async () => {
    assert.ok(await code(db.query("select public.write_audit('ANYTHING_GOES')")));
  });

  it("cannot be written through the API, even by the service role", async () => {
    assert.equal(await code(as(db, "owner", "select public.write_audit('LOGIN_SUCCESS')")), "42501");
    assert.equal(await code(as(db, "service", "select public.write_audit('LOGIN_SUCCESS')")), "42501");
    assert.equal(await code(as(db, "owner", "insert into public.security_audit_log (action) values ('LOGIN_SUCCESS')")), "42501");
    assert.equal(await code(as(db, "service", "insert into public.security_audit_log (action) values ('LOGIN_SUCCESS')")), "42501");
  });

  it("shows members their own events, and everything only with audit.read_all", async () => {
    const own = (await as(db, "collaborator", "select distinct coalesce(actor_user_id, target_user_id) as who from public.security_audit_log")).rows;
    assert.ok(own.length <= 1);
    const all = Number((await one(as(db, "owner", "select count(*) from public.security_audit_log"))).count);
    assert.equal(all, Number((await one(db.query("select count(*) from public.security_audit_log"))).count));
    assert.equal(Number((await one(as(db, "seo", "select count(*) from public.security_audit_log where actor_user_id is distinct from $1 and target_user_id is distinct from $1", ["a0000000-0000-4000-8000-000000000004"], "mfa"))).count), 0);
  });
});

describe("Admin source", () => {
  const root = fileURLToPath(new URL("../src/", import.meta.url));
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(js|mjs|html|css)$/.test(name)) files.push(path);
    }
  };
  walk(root);

  it("never mentions a privileged Supabase key", () => {
    const offenders = files.filter((path) => /service_role|SERVICE_ROLE|sb_secret_/.test(readFileSync(path, "utf8")));
    assert.deepEqual(offenders, []);
  });

  it("never decides access from user metadata, which every user can edit", () => {
    const offenders = files.filter((path) => /user_metadata\s*\??\.\s*role|raw_user_meta_data/.test(readFileSync(path, "utf8")));
    assert.deepEqual(offenders, []);
  });
});
