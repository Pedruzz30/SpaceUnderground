// The post-review hardening, each piece tried the way it is used:
//   - client codes come from inserting a client, never from an RPC
//   - privileged members, migrated owners included, need a verified factor
//     and a live aal2 session bound to it from the start
//   - every function from earlier migrations runs with a pinned search_path,
//     and the triggers and policies built on them still work
//   - the old is_admin() is reachable by no API role
//   - claims without a role never pass for a trusted backend (a null there
//     used to skip the guards that ask "not is_trusted_backend()")
//
//   npm test

import { strict as assert } from "node:assert";
import { after, before, describe, it } from "node:test";
import { IDS, PROJECTS, as, code, createSecurityDb, one, outcome } from "./helpers/security-fixture.mjs";
import { addVerifiedFactor } from "./helpers/supabase-db.mjs";

let db;

before(async () => {
  db = await createSecurityDb();
});

after(async () => {
  await db?.close();
});

const sequenceValue = async () => Number((await one(db.query("select last_value from public.clients_code_seq"))).last_value);
const insertClient = (who, name, strength) => as(db, who, "insert into public.clients (name, status) values ($1, 'ACTIVE') returning code", [name], strength);

describe("client codes", () => {
  it("gives an authorized OWNER or MANAGER a CLIENT-XXX code on insert, with no code sent", async () => {
    for (const who of ["owner", "manager"]) {
      const created = await one(insertClient(who, `Created by ${who}`));
      assert.match(created.code, /^CLIENT-\d{3,}$/, who);
    }
  });

  it("refuses an insert without clients.create before a number is drawn", async () => {
    for (const who of ["seo", "collaborator", "viewer", "outsider"]) {
      const before = await sequenceValue();
      assert.equal(await code(insertClient(who, `Sneaky ${who}`)), "42501", who);
      assert.equal(await sequenceValue(), before, `${who} burned a number`);
    }
    const before = await sequenceValue();
    assert.equal(await code(as(db, "anon", "insert into public.clients (name) values ('Anon')")), "42501");
    assert.equal(await sequenceValue(), before);
  });

  it("does not answer as an RPC, to anyone: not even an authorized member or the service role", async () => {
    for (const who of ["anon", "collaborator", "manager", "owner", "service"]) {
      const before = await sequenceValue();
      assert.equal(await code(as(db, who, "select public.next_client_code()")), "42501", who);
      assert.equal(await sequenceValue(), before, `${who} burned a number`);
    }
    for (const role of ["anon", "authenticated", "service_role"]) {
      for (const fn of ["public.next_client_code()", "public.assign_client_code()"]) {
        const { rows } = await db.query("select has_function_privilege($1, $2, 'execute') as ok", [role, fn]);
        assert.equal(rows[0].ok, false, `${role} ${fn}`);
      }
    }
  });

  it("still serves the service role and direct SQL through the insert", async () => {
    assert.match((await one(as(db, "service", "insert into public.clients (name) values ('Automation') returning code"))).code, /^CLIENT-\d{3,}$/);
    assert.match((await one(db.query("insert into public.clients (name) values ('SQL editor') returning code"))).code, /^CLIENT-\d{3,}$/);
  });

  it("keeps an explicit code, still refuses a blank one, and needs no column default", async () => {
    assert.equal((await one(as(db, "manager", "insert into public.clients (name, code) values ('Typed', 'CLIENT-900') returning code"))).code, "CLIENT-900");
    assert.equal(await code(as(db, "manager", "insert into public.clients (name, code) values ('Blank', '  ')")), "23514");
    const column = await one(db.query("select column_default from information_schema.columns where table_schema = 'public' and table_name = 'clients' and column_name = 'code'"));
    assert.equal(column.column_default, null, "a default would need EXECUTE from every inserting role");
  });

  it("keeps the code sequence out of every API role's reach", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      const { rows } = await db.query(
        "select has_sequence_privilege($1, 'public.clients_code_seq', 'usage') as usage, has_sequence_privilege($1, 'public.clients_code_seq', 'select') as read, has_sequence_privilege($1, 'public.clients_code_seq', 'update') as write",
        [role],
      );
      assert.deepEqual(rows[0], { usage: false, read: false, write: false }, role);
    }
  });
});

describe("MFA from the first use", () => {
  it("denies a migrated OWNER without a factor everything, on any token, and allows it once a factor is verified and the session is aal2", async () => {
    const decide = async (strength) => (await one(as(db, "owner", "select public.has_permission('team.invite') as ok", [], strength))).ok;
    const reason = async (strength) => (await one(as(db, "owner", "select public.my_access() as access", [], strength))).access.blocked_reason;
    await db.query("delete from auth.mfa_factors where user_id = $1", [IDS.owner]);
    try {
      assert.equal(await decide("aal1"), false);
      assert.equal(await code(as(db, "owner", "select public.require_permission('clients.edit')", [], "aal1")), "SU006", "MFA required");
      assert.equal(await reason("aal1"), "MFA_ENROLL_REQUIRED");
      // An aal2 token is not MFA without a factor behind it.
      assert.equal(await decide("mfa"), false);
      assert.equal(await reason("mfa"), "MFA_ENROLL_REQUIRED");
    } finally {
      await addVerifiedFactor(db, IDS.owner);
    }
    assert.equal(await decide("aal1"), false, "enrolled, but this session has not verified it");
    assert.equal(await reason("aal1"), "MFA_CHALLENGE_REQUIRED");
    assert.equal(await decide("mfa"), true);
    assert.equal(await reason("mfa"), null);
  });

  it("applies the same rule to every role that requires MFA", async () => {
    const userId = "e0000000-0000-4000-8000-000000000001";
    await db.query("insert into auth.users (id, email, encrypted_password) values ($1, 'new-manager@space.local', 'hash')", [userId]);
    await db.query("insert into public.team_members (user_id, display_name, email, status) values ($1, 'New manager', 'new-manager@space.local', 'ACTIVE')", [userId]);
    await db.query("insert into public.user_roles (user_id, role_key) values ($1, 'MANAGER')", [userId]);
    const { asRole, mfaClaims, mfaSession } = await import("./helpers/supabase-db.mjs");
    const read = (claims) => asRole(db, "authenticated", userId, () => db.query("select id from public.projects where id = $1", [PROJECTS.assigned]), claims);
    const aal1 = { aal: "aal1", amr: [] };
    assert.equal(await outcome(read(aal1)), "none");
    assert.equal(await outcome(read(mfaClaims())), "none", "no factor: an aal2 token alone is not MFA");
    const factor = await addVerifiedFactor(db, userId);
    assert.equal(await outcome(read(aal1)), "none");
    assert.equal(await outcome(read({ aal: "aal2", amr: [] })), "none", "aal2 with no MFA entry in amr proves nothing");
    assert.equal(await outcome(read(mfaClaims())), "none", "aal2 claims with no live session behind them prove nothing");
    const { claims } = await mfaSession(db, userId, { factorId: factor.id });
    assert.equal(await outcome(read(claims)), "ok", "a session that verified the factor");
  });

  it("does not ask MFA of roles that do not require it", async () => {
    assert.equal(await outcome(as(db, "collaborator", "select id from public.projects where id = $1", [PROJECTS.assigned], "aal1")), "ok");
  });
});

describe("functions from earlier migrations", () => {
  const LEGACY = [
    "touch_updated_at()",
    "stamp_published_at()",
    "media_project_id(text)",
    "valid_i18n_translations(jsonb)",
    "stamp_client_archived_at()",
    "stamp_financial_paid_at()",
    "stamp_commercial_opportunity_stage()",
  ];

  it("run with search_path = public, pg_temp", async () => {
    for (const signature of LEGACY) {
      const { rows } = await db.query("select coalesce(array_to_string(proconfig, ','), '') as config from pg_proc where oid = $1::regprocedure", [`public.${signature}`]);
      assert.match(rows[0].config, /search_path=public, pg_temp/, signature);
    }
  });

  it("still do their work in triggers, policies and checks", async () => {
    const client = await one(db.query("insert into public.clients (name, status) values ('Trigger check', 'ACTIVE') returning id, updated_at"));
    const archived = await one(db.query("update public.clients set status = 'ARCHIVED' where id = $1 returning archived_at, updated_at", [client.id]));
    assert.ok(archived.archived_at, "stamp_client_archived_at");
    assert.ok(archived.updated_at >= client.updated_at, "touch_updated_at");

    const published = await one(db.query("update public.projects set editorial_status = 'PUBLISHED' where id = $1 returning published_at", [PROJECTS.other]));
    assert.ok(published.published_at, "stamp_published_at");

    const entry = await one(db.query("insert into public.financial_transactions (type, category, description, amount, due_date, status) values ('INCOME', 'PROJECT', 'Paid now', 5, current_date, 'PAID') returning paid_at"));
    assert.ok(entry.paid_at, "stamp_financial_paid_at");

    const deal = await one(db.query("insert into public.commercial_opportunities (title, stage) values ('Deal', 'WON') returning stage_changed_at, closed_at"));
    assert.ok(deal.stage_changed_at && deal.closed_at, "stamp_commercial_opportunity_stage");

    const media = await one(db.query("select public.media_project_id($1) as id", [`projects/${PROJECTS.published}/poster/a.png`]));
    assert.equal(media.id, PROJECTS.published, "media_project_id");
    assert.equal(await code(db.query("update public.projects set translations = '{\"fr\":{}}'::jsonb where id = $1", [PROJECTS.other])), "23514", "valid_i18n_translations");

    // The public media policy still resolves through media_project_id as anon.
    await db.query("insert into storage.objects (bucket_id, name) values ('project-media', $1)", [`projects/${PROJECTS.published}/poster/public.png`]);
    assert.equal(await outcome(as(db, "anon", "select name from storage.objects where name = $1", [`projects/${PROJECTS.published}/poster/public.png`])), "ok");
  });
});

describe("the old is_admin()", () => {
  it("is executable by no API role", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      const { rows } = await db.query("select has_function_privilege($1, 'public.is_admin()', 'execute') as ok", [role]);
      assert.equal(rows[0].ok, false, role);
    }
    assert.equal(await code(as(db, "anon", "select public.is_admin()")), "42501");
  });

  it("has no caller left in any policy, function, view or constraint", async () => {
    const functions = await db.query(
      "select p.oid::regprocedure::text as sig from pg_proc p where p.pronamespace in ('public'::regnamespace, 'storage'::regnamespace) and p.proname <> 'is_admin' and position('is_admin(' in pg_get_functiondef(p.oid)) > 0",
    );
    assert.deepEqual(functions.rows, []);
    const policies = await db.query("select policyname from pg_policies where position('is_admin' in coalesce(qual, '') || coalesce(with_check, '')) > 0");
    assert.deepEqual(policies.rows, []);
    const views = await db.query("select table_name from information_schema.views where position('is_admin' in coalesce(view_definition, '')) > 0");
    assert.deepEqual(views.rows, []);
    const constraints = await db.query("select conname from pg_constraint where position('is_admin' in pg_get_constraintdef(oid)) > 0");
    assert.deepEqual(constraints.rows, []);
  });
});

describe("claims without a role", () => {
  // PostgREST sends '{}' for a request without a JWT. Claims like that are an
  // API request everywhere, never a trusted backend. Run here as the table
  // owner, so only the guards stand in the way.
  const withClaims = async (claims, sql, params = []) => {
    await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(claims)]);
    try {
      return await db.query(sql, params);
    } finally {
      await db.query("select set_config('request.jwt.claims', '', false)");
    }
  };

  it("are never a trusted backend, and the answer is never null", async () => {
    for (const claims of [{}, { sub: IDS.collaborator }, { role: null }, { role: "authenticated" }]) {
      assert.equal((await one(withClaims(claims, "select public.is_trusted_backend() as trusted"))).trusted, false, JSON.stringify(claims));
    }
    assert.equal((await one(withClaims({ role: "service_role" }, "select public.is_trusted_backend() as trusted"))).trusted, true);
    assert.equal((await one(db.query("select public.is_trusted_backend() as trusted"))).trusted, true, "no JWT context at all");
  });

  it("cannot draw client codes, archive clients, sign the activity log as someone else or sweep expiries", async () => {
    const before = await sequenceValue();
    assert.equal(await code(withClaims({ sub: IDS.collaborator }, "insert into public.clients (name) values ('Roleless')")), "42501");
    assert.equal(await sequenceValue(), before, "no number drawn");

    const client = await one(db.query("insert into public.clients (name, status) values ('Guarded', 'ACTIVE') returning id"));
    assert.equal(await code(withClaims({ sub: IDS.collaborator }, "update public.clients set status = 'ARCHIVED' where id = $1", [client.id])), "42501");

    await withClaims({ sub: IDS.collaborator }, "insert into public.activity_log (admin_user_id, action, entity_type, title) values ($1, 'x', 'y', 'Roleless author')", [IDS.owner]);
    assert.equal((await one(db.query("select admin_user_id from public.activity_log where title = 'Roleless author'"))).admin_user_id, IDS.collaborator);

    assert.equal(await code(withClaims({}, "select public.expire_stale_access()")), "42501");
  });
});
