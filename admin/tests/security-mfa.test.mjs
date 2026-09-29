// MFA is what the member has now, not what the token remembers. Supabase Auth
// keeps aal2 and the TOTP entry of amr in an access token after its factor is
// removed (supabase.auth.mfa.unenroll), until the session is refreshed; the
// database reads auth.mfa_factors on every check, so that token authorizes
// nothing a factor was needed for. Also: an ended session learns only that
// it was ended from my_access(), nothing about the member.
//
//   npm test

import { strict as assert } from "node:assert";
import { after, before, describe, it } from "node:test";
import { IDS, PROJECTS, as, code, createSecurityDb, issuedAgo, one, outcome } from "./helpers/security-fixture.mjs";
import { addVerifiedFactor, issuedNow, mfaClaims } from "./helpers/supabase-db.mjs";

let db;

before(async () => {
  db = await createSecurityDb();
});

after(async () => {
  await db?.close();
});

// One access token, reused as is: aal2, TOTP verified `secondsAgo` ago.
const token = (secondsAgo = 30) => ({ ...mfaClaims(secondsAgo), iat: issuedNow(), session_id: "s-kept" });
const decide = async (who, permission, claims) =>
  (await one(as(db, who, "select public.has_permission($1) as ok", [permission], undefined, claims))).ok;
const accessOf = async (who, claims, strength) => (await one(as(db, who, "select public.my_access() as access", [], strength, claims))).access;
const readAssigned = (who, claims, strength) => outcome(as(db, who, "select id from public.projects where id = $1", [PROJECTS.assigned], strength, claims));

// What supabase.auth.mfa.unenroll() leaves behind: no verified factor, and
// the token the member already holds.
const unenroll = (who) => db.query("delete from auth.mfa_factors where user_id = $1", [IDS[who]]);

describe("a token that outlives its MFA factor", () => {
  it("1: denies an OWNER who removed their factor, on the same aal2 token", async () => {
    const kept = token();
    const administrative = ["team.invite", "team.edit_access", "sessions.revoke", "projects.edit", "clients.create", "finance.read"];
    for (const permission of administrative) {
      assert.equal(await decide("partner", permission, kept), true, `${permission} before the removal`);
    }
    assert.equal(await readAssigned("partner", kept), "ok");

    await unenroll("partner");
    try {
      for (const permission of administrative) {
        assert.equal(await decide("partner", permission, kept), false, permission);
      }
      assert.equal(await readAssigned("partner", kept), "none", "RLS refuses it");
      assert.equal(await outcome(as(db, "partner", "select id from public.financial_transactions", [], undefined, kept)), "none");
      assert.equal(await code(as(db, "partner", "select public.require_permission('team.invite')", [], undefined, kept)), "SU006", "enrol MFA, not step-up");
      assert.equal(await code(as(db, "partner", "select public.prepare_invitation('after-unenroll@space.local', 'X', array['VIEWER'])", [], undefined, kept)), "SU006");
      assert.ok(await code(as(db, "partner", "insert into public.clients (name, status) values ('No factor', 'ACTIVE')", [], undefined, kept)), "no client either");
    } finally {
      await addVerifiedFactor(db, IDS.partner);
    }
  });

  it("2: denies CRITICAL on the same token, however recent its TOTP entry", async () => {
    const kept = token(5);
    assert.equal(await decide("absolute", "security.manage", kept), true, "a fresh step-up, before the removal");
    assert.equal((await one(as(db, "absolute", "select public.step_up_satisfied() as ok", [], undefined, kept))).ok, true);

    await unenroll("absolute");
    try {
      assert.equal(await decide("absolute", "security.manage", kept), false);
      assert.equal(await decide("absolute", "critical_settings.manage", kept), false);
      assert.equal((await one(as(db, "absolute", "select public.step_up_satisfied() as ok", [], undefined, kept))).ok, false, "the amr entry alone is no step-up");
      assert.equal(await code(as(db, "absolute", "select public.require_permission('security.manage')", [], undefined, kept)), "SU006", "nothing to step up with");
    } finally {
      await addVerifiedFactor(db, IDS.absolute);
    }
    // With the factor, a verification older than the window still asks for a
    // step-up, and a recent one passes.
    assert.equal(await code(as(db, "absolute", "select public.require_permission('security.manage')", [], "stale")), "SU005");
    assert.equal(await decide("absolute", "security.manage", token(5)), true);
  });

  it("3: denies an OWNER with a verified factor on an aal1 session", async () => {
    assert.equal(await decide("partner", "team.invite", {}), true, "sanity: the default session is aal2");
    assert.equal((await one(as(db, "partner", "select public.has_permission('team.invite') as ok", [], "aal1"))).ok, false);
    assert.equal(await readAssigned("partner", {}, "aal1"), "none");
    assert.equal(await code(as(db, "partner", "select public.require_permission('team.invite')", [], "aal1")), "SU006");
    assert.equal((await accessOf("partner", {}, "aal1")).blocked_reason, "MFA_CHALLENGE_REQUIRED");
  });

  it("4: allows an OWNER with a verified factor on an aal2 session", async () => {
    const kept = token();
    assert.equal(await decide("partner", "team.invite", kept), true);
    assert.equal(await readAssigned("partner", kept), "ok");
    const access = await accessOf("partner", kept);
    assert.equal(access.blocked_reason, null);
    assert.deepEqual(access.mfa, { required: true, enrolled: true, aal: "aal2", step_up: true });
  });

  it("5: leaves a COLLABORATOR without a factor its normal access on aal1", async () => {
    assert.equal(await readAssigned("collaborator", {}, "aal1"), "ok");
    assert.equal(await outcome(as(db, "collaborator", "select id from public.projects where id = $1", [PROJECTS.other], "aal1")), "none", "still only its own projects");
    assert.equal((await one(as(db, "collaborator", "select public.has_permission('projects.draft') as ok", [], "aal1"))).ok, true);
    assert.equal((await one(as(db, "collaborator", "select public.has_permission('team.invite') as ok", [], "aal1"))).ok, false);
    const access = await accessOf("collaborator", {}, "aal1");
    assert.equal(access.blocked_reason, null);
    assert.deepEqual([access.mfa.required, access.mfa.enrolled], [false, false]);
    // A leftover aal2 claim changes nothing for a role that needs no MFA.
    assert.equal(await readAssigned("collaborator", token()), "ok");
  });

  it("6: makes my_access say MFA_ENROLL_REQUIRED after the removal, even on the aal2 token", async () => {
    const kept = token();
    // The Admin records the enrolment once it is verified.
    assert.equal((await one(as(db, "partner", "select public.record_mfa_state() as access", [], undefined, kept))).access.blocked_reason, null);

    await unenroll("partner");
    try {
      const access = await accessOf("partner", kept);
      assert.equal(access.blocked_reason, "MFA_ENROLL_REQUIRED", "the Admin opens the enrolment screen");
      assert.equal(access.mfa.enrolled, false);
      assert.equal(access.mfa.step_up, false, "no step-up without a factor");
      assert.equal(access.mfa.aal, "aal2", "the token's claim is reported, not trusted");

      // Recording the removal from the same token works, and says the same.
      const recorded = (await one(as(db, "partner", "select public.record_mfa_state() as access", [], undefined, kept))).access;
      assert.equal(recorded.blocked_reason, "MFA_ENROLL_REQUIRED");
      const removed = await db.query("select 1 from public.security_audit_log where action = 'MFA_REMOVED' and target_user_id = $1", [IDS.partner]);
      assert.equal(removed.rows.length, 1);
    } finally {
      await addVerifiedFactor(db, IDS.partner);
      await as(db, "partner", "select public.record_mfa_state()");
    }
  });
});

describe("my_access for an ended session", () => {
  it("returns only the reason: no identity, roles, projects, MFA state or settings", async () => {
    const old = { iat: issuedAgo(60) };
    const before = await accessOf("collaborator", old);
    assert.equal(before.member.email, "collaborator@space.local", "the token worked before");
    assert.ok(before.projects.length > 0 && before.roles.length > 0);

    await as(db, "owner", "select public.revoke_member_sessions($1)", [IDS.collaborator]);
    const ended = await accessOf("collaborator", old);
    assert.deepEqual(ended, {
      member: null,
      blocked_reason: "SESSION_REVOKED",
      roles: [],
      permissions: [],
      projects: [],
      approval_routes: [],
    });
    const text = JSON.stringify(ended);
    for (const leak of ["collaborator@space.local", IDS.collaborator, PROJECTS.assigned, "COLLABORATOR"]) {
      assert.equal(text.includes(leak), false, leak);
    }

    const renewed = await accessOf("collaborator");
    assert.equal(renewed.blocked_reason, null, "a new sign-in gets the full answer");
    assert.equal(renewed.member.email, "collaborator@space.local");
  });

  it("answers a suspended member's old token the same way; a current one still learns of the suspension", async () => {
    const old = { iat: issuedAgo(60) };
    await as(db, "owner", "select public.suspend_member($1, 'Review')", [IDS.collaborator2]);
    const ended = await accessOf("collaborator2", old);
    assert.equal(ended.blocked_reason, "SESSION_REVOKED");
    assert.equal(ended.member, null);
    assert.deepEqual([ended.roles, ended.projects], [[], []]);

    const current = await accessOf("collaborator2");
    assert.equal(current.blocked_reason, "SUSPENDED");
    assert.deepEqual(current.permissions, []);
  });
});
