// Ending sessions: an access token issued before a session revocation, a
// suspension or an offboarding never authorizes again, not even after the
// member is reactivated; a new sign-in does. The token is judged by its iat
// against team_members.sessions_valid_after, which only moves forward.
//
//   npm test

import { strict as assert } from "node:assert";
import { after, before, describe, it } from "node:test";
import { IDS, PROJECTS, as, code, createSecurityDb, issuedAgo, one, outcome } from "./helpers/security-fixture.mjs";

let db;

before(async () => {
  db = await createSecurityDb();
});

after(async () => {
  await db?.close();
});

// A token the member already held before the test acts: issued a minute ago.
const OLD = () => ({ iat: issuedAgo(60) });
const readAssigned = (who, extra = {}) =>
  outcome(as(db, who, "select id from public.projects where id = $1", [PROJECTS.assigned], undefined, extra));
const accessOf = async (who, extra = {}) => (await one(as(db, who, "select public.my_access() as access", [], undefined, extra))).access;
const cutoffOf = async (id) => (await one(db.query("select sessions_valid_after from public.team_members where user_id = $1", [id]))).sessions_valid_after;

describe("session revocation", () => {
  it("A: refuses a token issued before a manual revoke, everywhere", async () => {
    const old = OLD();
    assert.equal(await readAssigned("collaborator", old), "ok", "the token works before");

    const result = (await one(as(db, "owner", "select public.revoke_member_sessions($1) as result", [IDS.collaborator]))).result;
    assert.ok(await cutoffOf(IDS.collaborator), "the cutoff moved");
    assert.equal(result.user_id, IDS.collaborator);

    assert.equal(await readAssigned("collaborator", old), "none", "RLS refuses it");
    assert.equal(await code(as(db, "collaborator", "select public.save_project_draft($1, '{\"name\":\"x\"}'::jsonb)", [PROJECTS.assigned], undefined, old)), "SU013");
    assert.equal(await outcome(as(db, "collaborator", "select user_id from public.team_members where user_id = $1", [IDS.collaborator], undefined, old)), "none", "not even its own row");
    assert.equal(await outcome(as(db, "collaborator", "select key from public.roles", [], undefined, old)), "none");
    const access = await accessOf("collaborator", old);
    assert.equal(access.blocked_reason, "SESSION_REVOKED");
    assert.deepEqual(access.permissions, []);

    assert.equal(await readAssigned("collaborator"), "ok", "a token from a new sign-in works");
    assert.equal((await accessOf("collaborator")).blocked_reason, null);
  });

  it("B: never lets suspend + reactivate bring an old token back", async () => {
    const old = OLD();
    assert.equal(await readAssigned("viewer", old), "ok");

    await as(db, "owner", "select public.suspend_member($1, 'Review')", [IDS.viewer]);
    assert.equal(await readAssigned("viewer", old), "none", "suspended");

    await as(db, "owner", "select public.reactivate_member($1)", [IDS.viewer]);
    assert.equal((await one(db.query("select status from public.team_members where user_id = $1", [IDS.viewer]))).status, "ACTIVE");
    assert.equal(await readAssigned("viewer", old), "none", "still refused after the reactivation");
    assert.equal((await accessOf("viewer", old)).blocked_reason, "SESSION_REVOKED");
  });

  it("C: accepts a token issued after the reactivation", async () => {
    assert.equal(await readAssigned("viewer"), "ok");
    assert.equal((await accessOf("viewer")).blocked_reason, null);
  });

  it("refuses an old token after offboarding, as well as by status", async () => {
    const userId = "d0000000-0000-4000-8000-000000000001";
    await db.query("insert into auth.users (id, email, encrypted_password) values ($1, 'leaver@space.local', 'hash')", [userId]);
    await db.query("insert into public.team_members (user_id, display_name, email, status) values ($1, 'Leaver', 'leaver@space.local', 'ACTIVE')", [userId]);
    await db.query("insert into public.user_roles (user_id, role_key) values ($1, 'VIEWER')", [userId]);
    await as(db, "owner", "select public.offboard_member($1, 'Left')", [userId]);
    assert.ok(await cutoffOf(userId), "offboarding moves the cutoff too");
  });

  it("does not touch the tokens of anyone else", async () => {
    const old = OLD();
    await as(db, "owner", "select public.revoke_member_sessions($1)", [IDS.collaborator2]);
    assert.equal(await outcome(as(db, "collaborator2", "select id from public.projects where id = $1", [PROJECTS.other], undefined, old)), "none");
    assert.equal(await outcome(as(db, "seo", "select id from public.projects where id = $1", [PROJECTS.other], undefined, old)), "ok", "another member's old token is untouched");
  });

  it("stops an old token from reviewing or managing, with a reason the Admin can act on", async () => {
    const old = OLD();
    await as(db, "absolute", "select public.revoke_member_sessions($1)", [IDS.manager]);
    // The ended session is the reason given first, whatever the permission.
    assert.equal(await code(as(db, "manager", "select public.prepare_invitation('late@space.local', 'X', array['VIEWER'])", [], undefined, old)), "SU013");
    assert.equal(await code(as(db, "manager", "select public.reject_change_request(gen_random_uuid(), 'no')", [], undefined, old)), "SU013");
    assert.equal(await code(as(db, "manager", "select public.reject_change_request(gen_random_uuid(), 'no')")), "SU010", "a new token reaches the function");
  });
});

describe("sign out everywhere", () => {
  it("ends the member's own tokens, the one used included", async () => {
    const before = OLD();
    const current = { iat: issuedAgo(5) };
    const result = (await one(as(db, "seo", "select public.revoke_my_sessions() as result", [], undefined, current))).result;
    assert.equal(typeof result.sessions_revoked, "number");
    assert.equal(await outcome(as(db, "seo", "select id from public.projects where id = $1", [PROJECTS.assigned], undefined, current)), "none", "the token that asked");
    assert.equal(await outcome(as(db, "seo", "select id from public.projects where id = $1", [PROJECTS.assigned], undefined, before)), "none", "an older one");
    assert.equal(await outcome(as(db, "seo", "select id from public.projects where id = $1", [PROJECTS.assigned])), "ok", "a new sign-in");
    const logged = await one(db.query("select count(*) from public.security_audit_log where action = 'SESSION_REVOKED' and target_user_id = $1 and metadata ->> 'cause' = 'self'", [IDS.seo]));
    assert.equal(Number(logged.count), 1);
  });

  it("changes nothing when asked with a token that is already out of date", async () => {
    const cutoff = await cutoffOf(IDS.seo);
    const result = (await one(as(db, "seo", "select public.revoke_my_sessions() as result", [], undefined, OLD()))).result;
    assert.equal(result.sessions_revoked, 0);
    assert.equal((await cutoffOf(IDS.seo)).getTime(), cutoff.getTime());
  });
});

describe("the session cutoff", () => {
  it("only moves forward, even against a plain UPDATE by the table owner", async () => {
    const cutoff = await cutoffOf(IDS.collaborator);
    assert.equal(await code(db.query("update public.team_members set sessions_valid_after = null where user_id = $1", [IDS.collaborator])), "42501");
    assert.equal(await code(db.query("update public.team_members set sessions_valid_after = sessions_valid_after - interval '1 hour' where user_id = $1", [IDS.collaborator])), "42501");
    assert.equal((await cutoffOf(IDS.collaborator)).getTime(), cutoff.getTime());
  });

  it("refuses a token from the same second as the cutoff, and one with no iat", async () => {
    await db.query("update public.team_members set sessions_valid_after = date_trunc('second', now()) + interval '2.5 seconds' where user_id = $1", [IDS.partner]);
    const cutoff = await cutoffOf(IDS.partner);
    const second = Math.floor(cutoff.getTime() / 1000);
    assert.equal(await outcome(as(db, "partner", "select id from public.projects where id = $1", [PROJECTS.assigned], undefined, { iat: second })), "none");
    assert.equal(await outcome(as(db, "partner", "select id from public.projects where id = $1", [PROJECTS.assigned], undefined, { iat: second + 1 })), "ok");
    assert.equal(await outcome(as(db, "partner", "select id from public.projects where id = $1", [PROJECTS.assigned], undefined, { iat: undefined })), "none", "no iat, no access");
    assert.equal(await outcome(as(db, "partner", "select id from public.projects where id = $1", [PROJECTS.assigned], undefined, { iat: "yesterday" })), "none");
  });

  it("is not something any API role can write", async () => {
    for (const who of ["collaborator", "owner", "absolute"]) {
      assert.equal(await code(as(db, who, "update public.team_members set sessions_valid_after = null where user_id = $1", [IDS[who]])), "42501", who);
    }
    for (const role of ["anon", "authenticated", "service_role"]) {
      const { rows } = await db.query("select has_function_privilege($1, 'public.end_member_sessions(uuid)', 'execute') as ok", [role]);
      assert.equal(rows[0].ok, false, role);
    }
  });
});
