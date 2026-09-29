// MFA is what the member has now, not what the token remembers. Supabase Auth
// keeps aal2 and the TOTP entry of amr in an access token after its factor is
// removed (supabase.auth.mfa.unenroll), until the session is refreshed; the
// database reads auth.mfa_factors on every check, so that token authorizes
// nothing a factor was needed for. Nor does it come back when another factor
// is enrolled: the token's MFA must be no older than the current factors.
// Also: an ended session learns only that it was ended from my_access(),
// nothing about the member.
//
//   npm test

import { strict as assert } from "node:assert";
import { after, before, describe, it } from "node:test";
import { IDS, PROJECTS, as, code, createSecurityDb, issuedAgo, one, outcome } from "./helpers/security-fixture.mjs";
import { addVerifiedFactor, asRole, issuedNow, mfaClaims } from "./helpers/supabase-db.mjs";

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

describe("factor rotation never brings an old token back", () => {
  let serial = 0;
  // A member of their own for each test: an ACTIVE holder of `role` with
  // factor A, verified a day ago.
  const member = async (role) => {
    serial += 1;
    const id = `f0000000-0000-4000-8000-${String(serial).padStart(12, "0")}`;
    const email = `rotation-${serial}@space.local`;
    await db.query("insert into auth.users (id, email, encrypted_password) values ($1, $2, 'hash')", [id, email]);
    await db.query("insert into public.team_members (user_id, display_name, email, status) values ($1, 'Rotation', $2, 'ACTIVE')", [id, email]);
    await db.query("insert into public.user_roles (user_id, role_key) values ($1, $2)", [id, role]);
    const factorA = await addVerifiedFactor(db, id);
    return { id, factorA };
  };
  // A token whose MFA (the TOTP entry of amr) happened at `second`.
  const mfaAt = (second) => ({
    aal: "aal2",
    amr: [
      { method: "password", timestamp: second - 60 },
      { method: "totp", timestamp: second },
    ],
    iat: issuedNow(),
    session_id: `s-${second}`,
  });
  const nowSecond = () => Math.floor(Date.now() / 1000);
  const run = (id, claims, sql, params = []) => asRole(db, "authenticated", id, () => db.query(sql, params), claims);
  const allowed = async (id, claims, permission) => (await one(run(id, claims, "select public.has_permission($1) as ok", [permission]))).ok;
  const reasonOf = async (id, claims) => (await one(run(id, claims, "select public.my_access() as access"))).access.blocked_reason;
  const stepUp = async (id, claims) => (await one(run(id, claims, "select public.step_up_satisfied() as ok"))).ok;
  const removeFactor = (factorId) => db.query("delete from auth.mfa_factors where id = $1", [factorId]);
  const removeAll = (id) => db.query("delete from auth.mfa_factors where user_id = $1", [id]);
  // Factor B, verified just now, as Supabase Auth stamps it.
  const enrolNow = (id) => addVerifiedFactor(db, id, { verifiedAt: new Date() });

  it("A and B: T1 is refused once factor A is removed, and still refused after factor B is enrolled", async () => {
    const { id, factorA } = await member("OWNER");
    const t1 = mfaAt(nowSecond() - 30);
    assert.equal(await allowed(id, t1, "team.invite"), true, "T1 works with factor A");

    await removeFactor(factorA.id);
    assert.equal(await allowed(id, t1, "team.invite"), false, "A: no factor");
    assert.equal(await reasonOf(id, t1), "MFA_ENROLL_REQUIRED");

    await enrolNow(id);
    assert.equal(await allowed(id, t1, "team.invite"), false, "B: a new factor does not revive T1");
    assert.equal(await outcome(run(id, t1, "select id from public.projects where id = $1", [PROJECTS.assigned])), "none", "RLS refuses it");
    assert.equal(await code(run(id, t1, "select public.require_permission('team.invite')")), "SU006", "verify the current factor");
    assert.equal(await reasonOf(id, t1), "MFA_CHALLENGE_REQUIRED", "the Admin asks for a code, not for enrolment");
    assert.equal(await stepUp(id, t1), false);
  });

  it("C and E: a token from verifying factor B works, from the very second of the verification", async () => {
    const { id, factorA } = await member("OWNER");
    await removeFactor(factorA.id);
    const factorB = await enrolNow(id);
    const t2 = mfaAt(factorB.verifiedSecond);
    assert.equal(await allowed(id, t2, "team.invite"), true);
    assert.equal(await outcome(run(id, t2, "select id from public.projects where id = $1", [PROJECTS.assigned])), "ok");
    assert.equal(await reasonOf(id, t2), null);
    assert.equal(await allowed(id, mfaAt(factorB.verifiedSecond - 1), "team.invite"), false, "one second earlier predates B");
  });

  it("D and F: CRITICAL refuses the old token's recent TOTP entry, and accepts a fresh verification of factor B", async () => {
    const { id, factorA } = await member("ABSOLUTE_ADMIN");
    const t1 = mfaAt(nowSecond() - 5);
    assert.equal(await allowed(id, t1, "security.manage"), true, "a fresh step-up with factor A");

    await removeFactor(factorA.id);
    const factorB = await enrolNow(id);
    assert.equal(await allowed(id, t1, "security.manage"), false, "D: its TOTP entry is 5 s old, but older than B");
    assert.equal(await allowed(id, t1, "critical_settings.manage"), false);
    assert.equal(await stepUp(id, t1), false);
    assert.equal(await code(run(id, t1, "select public.require_permission('security.manage')")), "SU006");

    const t2 = mfaAt(factorB.verifiedSecond);
    assert.equal(await allowed(id, t2, "security.manage"), true, "F: a fresh verification of B");
    assert.equal(await stepUp(id, t2), true);
  });

  it("keeps T1 refused through every later change of factors", async () => {
    const { id, factorA } = await member("OWNER");
    const t1 = mfaAt(nowSecond() - 30);
    await removeFactor(factorA.id);
    const refused = async (step) => assert.equal(await allowed(id, t1, "team.invite"), false, step);

    const b = await enrolNow(id);
    await refused("B enrolled");
    const c = await enrolNow(id);
    await refused("C enrolled too");
    await removeFactor(b.id);
    await refused("B removed");
    await db.query("update auth.mfa_factors set updated_at = now() where id = $1", [c.id]);
    await refused("C changed (renamed)");
    await removeAll(id);
    await refused("no factor");
    await enrolNow(id);
    await refused("D enrolled");
  });

  it("does not revive T1 through a factor enrolled before it and verified after A was removed", async () => {
    const { id, factorA } = await member("OWNER");
    // Enrolled an hour ago and left unverified.
    const { rows } = await db.query(
      "insert into auth.mfa_factors (user_id, status, created_at, updated_at) values ($1, 'unverified', now() - interval '1 hour', now() - interval '1 hour') returning id",
      [id],
    );
    const t1 = mfaAt(nowSecond() - 30);
    assert.equal(await allowed(id, t1, "team.invite"), true);
    await removeFactor(factorA.id);
    // Supabase Auth stamps updated_at when it verifies the factor.
    await db.query("update auth.mfa_factors set status = 'verified', updated_at = now() where id = $1", [rows[0].id]);
    assert.equal(await allowed(id, t1, "team.invite"), false);
  });

  it("logs nobody out for adding a second factor, and refuses once the factor older than the token is gone", async () => {
    const { id, factorA } = await member("OWNER");
    const t = mfaAt(nowSecond() - 30);
    const b = await enrolNow(id);
    assert.equal(await allowed(id, t, "team.invite"), true, "factor A is still there");
    await removeFactor(b.id);
    assert.equal(await allowed(id, t, "team.invite"), true);
    await enrolNow(id);
    await removeFactor(factorA.id);
    assert.equal(await allowed(id, t, "team.invite"), false, "only a factor newer than the token is left");
  });

  it("decides from auth.mfa_factors, never from team_members.mfa_enrolled_at", async () => {
    const withFactor = await member("OWNER");
    const t = mfaAt(nowSecond() - 30);
    await db.query("update public.team_members set mfa_enrolled_at = null where user_id = $1", [withFactor.id]);
    assert.equal(await allowed(withFactor.id, t, "team.invite"), true, "no record, but a verified factor");

    const without = await member("OWNER");
    await removeAll(without.id);
    await db.query("update public.team_members set mfa_enrolled_at = now() where user_id = $1", [without.id]);
    assert.equal(await allowed(without.id, t, "team.invite"), false, "a record, but no factor");
  });

  it("fails closed on MFA claims it cannot read", async () => {
    const { id } = await member("OWNER");
    const second = nowSecond() - 30;
    // (asRole fills in a valid amr unless a test replaces it; undefined drops it.)
    const malformed = [
      { aal: "aal2", amr: undefined },
      { aal: "aal2", amr: [] },
      { aal: "aal2", amr: "totp" },
      { aal: "aal2", amr: [{ method: "password", timestamp: second }] },
      { aal: "aal2", amr: [{ method: "totp", timestamp: "soon" }] },
      { aal: "aal2", amr: [{ method: "totp", timestamp: -1 }] },
      { aal: "aal2", amr: [{ method: "totp" }] },
      { aal: "aal1", amr: [{ method: "totp", timestamp: second }] },
    ];
    for (const claims of malformed) {
      assert.equal(await allowed(id, { ...claims, iat: issuedNow() }, "team.invite"), false, JSON.stringify(claims));
    }
    assert.equal(await allowed(id, mfaAt(second), "team.invite"), true, "sanity: a well-formed token works");
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
