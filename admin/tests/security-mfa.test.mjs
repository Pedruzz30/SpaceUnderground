// MFA is what Supabase Auth's live session state backs, not what the token
// remembers. A token keeps aal2 and its amr entries after its factor is
// removed (supabase.auth.mfa.unenroll), until the session is refreshed; the
// database reads the token's session (auth.sessions: aal2, bound to a
// verified factor of the caller) and that session's current proof
// (auth.mfa_amr_claims) on every check. So a token whose factor was removed
// authorizes nothing a factor was needed for, even while another factor
// remains, and it never comes back: not when another factor is enrolled, not
// when its own session verifies again. Also: an ended session learns only
// that it was ended from my_access(), nothing about the member.
//
//   npm test

import { strict as assert } from "node:assert";
import { after, before, describe, it } from "node:test";
import { IDS, PROJECTS, as, code, createSecurityDb, issuedAgo, memberSession, one, outcome } from "./helpers/security-fixture.mjs";
import { addVerifiedFactor, asRole, issuedNow, mfaClaims, mfaSession, unenroll, verifyFactor } from "./helpers/supabase-db.mjs";

let db;

before(async () => {
  db = await createSecurityDb();
});

after(async () => {
  await db?.close();
});

// A fixture member's access token, reused as is: aal2 from their signed-in
// MFA session, TOTP verified `secondsAgo` ago.
const token = async (who, secondsAgo = 30) => ({ ...mfaClaims(secondsAgo), iat: issuedNow(), session_id: await memberSession(db, IDS[who]) });
const factorOf = async (who) => (await one(db.query("select id from auth.mfa_factors where user_id = $1 and status = 'verified' order by updated_at limit 1", [IDS[who]]))).id;
const decide = async (who, permission, claims) =>
  (await one(as(db, who, "select public.has_permission($1) as ok", [permission], undefined, claims))).ok;
const accessOf = async (who, claims, strength) => (await one(as(db, who, "select public.my_access() as access", [], strength, claims))).access;
const readAssigned = (who, claims, strength) => outcome(as(db, who, "select id from public.projects where id = $1", [PROJECTS.assigned], strength, claims));

describe("a token that outlives its MFA factor", () => {
  it("1: denies an OWNER who removed their factor, on the same aal2 token", async () => {
    const kept = await token("partner");
    const administrative = ["team.invite", "team.edit_access", "sessions.revoke", "projects.edit", "clients.create", "finance.read"];
    for (const permission of administrative) {
      assert.equal(await decide("partner", permission, kept), true, `${permission} before the removal`);
    }
    assert.equal(await readAssigned("partner", kept), "ok");

    await unenroll(db, await factorOf("partner"));
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
    const kept = await token("absolute", 5);
    assert.equal(await decide("absolute", "security.manage", kept), true, "a fresh step-up, before the removal");
    assert.equal((await one(as(db, "absolute", "select public.step_up_satisfied() as ok", [], undefined, kept))).ok, true);

    await unenroll(db, await factorOf("absolute"));
    try {
      assert.equal(await decide("absolute", "security.manage", kept), false);
      assert.equal(await decide("absolute", "critical_settings.manage", kept), false);
      assert.equal((await one(as(db, "absolute", "select public.step_up_satisfied() as ok", [], undefined, kept))).ok, false, "the amr entry alone is no step-up");
      assert.equal(await code(as(db, "absolute", "select public.require_permission('security.manage')", [], undefined, kept)), "SU006", "nothing to step up with");
    } finally {
      await addVerifiedFactor(db, IDS.absolute);
    }
    // With a factor again (a new sign-in), a verification older than the
    // window still asks for a step-up, and a recent one passes.
    assert.equal(await code(as(db, "absolute", "select public.require_permission('security.manage')", [], "stale")), "SU005");
    assert.equal(await decide("absolute", "security.manage", await token("absolute", 5)), true);
  });

  it("3: denies an OWNER with a verified factor on an aal1 session", async () => {
    assert.equal(await decide("partner", "team.invite", {}), true, "sanity: the default session is aal2");
    assert.equal((await one(as(db, "partner", "select public.has_permission('team.invite') as ok", [], "aal1"))).ok, false);
    assert.equal(await readAssigned("partner", {}, "aal1"), "none");
    assert.equal(await code(as(db, "partner", "select public.require_permission('team.invite')", [], "aal1")), "SU006");
    assert.equal((await accessOf("partner", {}, "aal1")).blocked_reason, "MFA_CHALLENGE_REQUIRED");
  });

  it("4: allows an OWNER with a verified factor on an aal2 session", async () => {
    const kept = await token("partner");
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
    assert.equal(await readAssigned("collaborator", { ...mfaClaims(), iat: issuedNow() }), "ok");
  });

  it("6: makes my_access say MFA_ENROLL_REQUIRED after the removal, even on the aal2 token", async () => {
    const kept = await token("partner");
    // The Admin records the enrolment once it is verified.
    assert.equal((await one(as(db, "partner", "select public.record_mfa_state() as access", [], undefined, kept))).access.blocked_reason, null);

    await unenroll(db, await factorOf("partner"));
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

// Members of their own, sessions and tokens as Supabase Auth issues them.
let serial = 0;
async function newMember(role, { type = "totp" } = {}) {
  serial += 1;
  const id = `f0000000-0000-4000-8000-${String(serial).padStart(12, "0")}`;
  const email = `mfa-${serial}@space.local`;
  await db.query("insert into auth.users (id, email, encrypted_password) values ($1, $2, 'hash')", [id, email]);
  await db.query("insert into public.team_members (user_id, display_name, email, status) values ($1, 'MFA', $2, 'ACTIVE')", [id, email]);
  await db.query("insert into public.user_roles (user_id, role_key) values ($1, $2)", [id, role]);
  const factorA = (await addVerifiedFactor(db, id, { type })).id;
  return { id, factorA };
}
const secondsAgo = (seconds) => new Date(Date.now() - seconds * 1000);
const run = (id, claims, sql, params = []) => asRole(db, "authenticated", id, () => db.query(sql, params), claims);
const allowed = async (id, claims, permission = "team.invite") => (await one(run(id, claims, "select public.has_permission($1) as ok", [permission]))).ok;
const reasonOf = async (id, claims) => (await one(run(id, claims, "select public.my_access() as access"))).access.blocked_reason;
const stepUp = async (id, claims) => (await one(run(id, claims, "select public.step_up_satisfied() as ok"))).ok;
const liveSession = (sessionId) => one(db.query("select aal, factor_id from auth.sessions where id = $1", [sessionId]));

describe("factor rotation never brings an old token back", () => {
  it("A and B: T1 is refused once factor A is removed, and still refused after factor B is enrolled", async () => {
    const { id, factorA } = await newMember("OWNER");
    const { claims: t1 } = await mfaSession(db, id, { factorId: factorA, at: secondsAgo(30) });
    assert.equal(await allowed(id, t1), true, "T1 works with factor A");

    await unenroll(db, factorA);
    assert.equal(await allowed(id, t1), false, "A: no factor");
    assert.equal(await reasonOf(id, t1), "MFA_ENROLL_REQUIRED");

    const factorB = (await addVerifiedFactor(db, id, { verifiedAt: new Date() })).id;
    await mfaSession(db, id, { factorId: factorB });
    assert.equal(await allowed(id, t1), false, "B: a new factor does not revive T1");
    assert.equal(await outcome(run(id, t1, "select id from public.projects where id = $1", [PROJECTS.assigned])), "none", "RLS refuses it");
    assert.equal(await code(run(id, t1, "select public.require_permission('team.invite')")), "SU006", "verify the current factor");
    assert.equal(await reasonOf(id, t1), "MFA_CHALLENGE_REQUIRED", "the Admin asks for a code, not for enrolment");
    assert.equal(await stepUp(id, t1), false);
  });

  it("C and E: the token from verifying factor B works, from the very second of the verification", async () => {
    const { id, factorA } = await newMember("OWNER");
    await unenroll(db, factorA);
    const factorB = (await addVerifiedFactor(db, id, { verifiedAt: new Date() })).id;
    const { claims: t2 } = await mfaSession(db, id, { factorId: factorB });
    assert.equal(await allowed(id, t2), true);
    assert.equal(await outcome(run(id, t2, "select id from public.projects where id = $1", [PROJECTS.assigned])), "ok");
    assert.equal(await reasonOf(id, t2), null);
    const earlier = { ...t2, amr: t2.amr.map((entry) => (entry.method === "totp" ? { ...entry, timestamp: entry.timestamp - 1 } : entry)) };
    assert.equal(await allowed(id, earlier), false, "one second before the session's proof");
  });

  it("D and F: CRITICAL refuses the old token's recent TOTP entry, and accepts a fresh verification of factor B", async () => {
    const { id, factorA } = await newMember("ABSOLUTE_ADMIN");
    const { sessionId, claims: t1 } = await mfaSession(db, id, { factorId: factorA, at: secondsAgo(5) });
    assert.equal(await allowed(id, t1, "security.manage"), true, "a fresh step-up with factor A");

    await unenroll(db, factorA);
    const factorB = (await addVerifiedFactor(db, id, { verifiedAt: new Date() })).id;
    assert.equal(await allowed(id, t1, "security.manage"), false, "D: its TOTP entry is 5 s old, but factor A is gone");
    assert.equal(await allowed(id, t1, "critical_settings.manage"), false);
    assert.equal(await stepUp(id, t1), false);
    assert.equal(await code(run(id, t1, "select public.require_permission('security.manage')")), "SU006");

    const t2 = await verifyFactor(db, sessionId, factorB);
    assert.equal(await allowed(id, t2, "security.manage"), true, "F: a fresh verification of B");
    assert.equal(await stepUp(id, t2), true);
  });

  it("keeps T1 refused through every later change of factors and of its own session", async () => {
    const { id, factorA } = await newMember("OWNER");
    const { sessionId, claims: t1 } = await mfaSession(db, id, { factorId: factorA, at: secondsAgo(30) });
    await unenroll(db, factorA);
    const refused = async (step) => assert.equal(await allowed(id, t1), false, step);

    const b = (await addVerifiedFactor(db, id, { verifiedAt: new Date() })).id;
    await refused("B enrolled");
    await verifyFactor(db, sessionId, b);
    await refused("T1's own session verified B");
    const c = (await addVerifiedFactor(db, id, { verifiedAt: new Date() })).id;
    await mfaSession(db, id, { factorId: c });
    await refused("C enrolled and verified elsewhere");
    await unenroll(db, b);
    await refused("B removed");
    await verifyFactor(db, sessionId, c);
    await refused("T1's own session verified C");
    await db.query("delete from auth.mfa_factors where user_id = $1", [id]);
    await refused("no factor");
  });

  it("does not revive T1 through a factor enrolled before it and verified in its session after A was removed", async () => {
    const { id, factorA } = await newMember("OWNER");
    const { rows } = await db.query(
      "insert into auth.mfa_factors (user_id, status, created_at, updated_at) values ($1, 'unverified', now() - interval '1 hour', now() - interval '1 hour') returning id",
      [id],
    );
    const { sessionId, claims: t1 } = await mfaSession(db, id, { factorId: factorA, at: secondsAgo(30) });
    assert.equal(await allowed(id, t1), true);
    await unenroll(db, factorA);
    await verifyFactor(db, sessionId, rows[0].id);
    assert.equal(await allowed(id, t1), false);
  });

  it("decides from auth.mfa_factors and the session, never from team_members.mfa_enrolled_at", async () => {
    const withFactor = await newMember("OWNER");
    const { claims } = await mfaSession(db, withFactor.id, { factorId: withFactor.factorA, at: secondsAgo(30) });
    await db.query("update public.team_members set mfa_enrolled_at = null where user_id = $1", [withFactor.id]);
    assert.equal(await allowed(withFactor.id, claims), true, "no record, but a verified factor and its session");

    const without = await newMember("OWNER");
    const { claims: before } = await mfaSession(db, without.id, { factorId: without.factorA, at: secondsAgo(30) });
    await unenroll(db, without.factorA);
    await db.query("update public.team_members set mfa_enrolled_at = now() where user_id = $1", [without.id]);
    assert.equal(await allowed(without.id, before), false, "a record, but no factor");
  });

  it("fails closed on MFA claims it cannot read", async () => {
    const { id, factorA } = await newMember("OWNER");
    const { claims } = await mfaSession(db, id, { factorId: factorA, at: secondsAgo(30) });
    const second = claims.amr.find((entry) => entry.method === "totp").timestamp;
    // Each keeps the live session and breaks one thing. (asRole fills in a
    // valid amr unless a test replaces it; undefined drops it.)
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
    for (const broken of malformed) {
      assert.equal(await allowed(id, { ...claims, ...broken }), false, JSON.stringify(broken));
    }
    assert.equal(await allowed(id, claims), true, "sanity: the token itself works");
  });
});

describe("MFA bound to the live session", () => {
  it("1: refuses T1 once the factor it verified is removed, though another verified factor remains", async () => {
    const { id, factorA } = await newMember("OWNER");
    const factorB = (await addVerifiedFactor(db, id, { verifiedAt: secondsAgo(3600) })).id;
    // T1 verifies A after both factors exist.
    const { claims: t1 } = await mfaSession(db, id, { factorId: factorA, at: secondsAgo(30) });
    assert.equal(await allowed(id, t1), true);

    await unenroll(db, factorA);
    assert.ok((await db.query("select 1 from auth.mfa_factors where id = $1 and status = 'verified'", [factorB])).rows.length, "B remains");
    assert.equal(await allowed(id, t1), false);
    assert.equal(await outcome(run(id, t1, "select id from public.projects where id = $1", [PROJECTS.assigned])), "none");
    assert.equal(await code(run(id, t1, "select public.require_permission('team.invite')")), "SU006");
    assert.equal(await reasonOf(id, t1), "MFA_CHALLENGE_REQUIRED", "verify B");
  });

  it("2: refuses CRITICAL in the same case, however recent T1's verification", async () => {
    const { id, factorA } = await newMember("ABSOLUTE_ADMIN");
    await addVerifiedFactor(db, id, { verifiedAt: secondsAgo(3600) });
    const { claims: t1 } = await mfaSession(db, id, { factorId: factorA, at: secondsAgo(5) });
    assert.equal(await allowed(id, t1, "security.manage"), true);

    await unenroll(db, factorA);
    assert.equal(await allowed(id, t1, "security.manage"), false);
    assert.equal(await stepUp(id, t1), false);
    assert.equal(await code(run(id, t1, "select public.require_permission('security.manage')")), "SU006");
  });

  it("3, 4 and 5: ignores T1's aal2 once its session is aal1, keeps it refused after that session verifies B, and accepts the new token", async () => {
    const { id, factorA } = await newMember("OWNER");
    const factorB = (await addVerifiedFactor(db, id, { verifiedAt: secondsAgo(3600) })).id;
    const { sessionId, claims: t1 } = await mfaSession(db, id, { factorId: factorA, at: secondsAgo(30) });

    await unenroll(db, factorA);
    assert.deepEqual(await liveSession(sessionId), { aal: "aal1", factor_id: null }, "3: Supabase Auth downgraded the session");
    assert.equal(t1.aal, "aal2");
    assert.equal(await allowed(id, t1), false, "3: the token's aal2 is ignored");

    const t2 = await verifyFactor(db, sessionId, factorB);
    assert.deepEqual(await liveSession(sessionId), { aal: "aal2", factor_id: factorB });
    assert.equal(await allowed(id, t1), false, "4: the same session verified B; T1 stays refused");
    assert.equal(await stepUp(id, t1), false);

    assert.equal(await allowed(id, t2), true, "5: the token issued by that verification");
    assert.equal(await reasonOf(id, t2), null);
    assert.equal(await stepUp(id, t2), true);
  });

  it("6: keeps a valid token valid when factor B is added while A remains", async () => {
    const { id, factorA } = await newMember("OWNER");
    const { claims: t } = await mfaSession(db, id, { factorId: factorA, at: secondsAgo(30) });
    const factorB = (await addVerifiedFactor(db, id, { verifiedAt: new Date() })).id;
    await mfaSession(db, id, { factorId: factorB });
    assert.equal(await allowed(id, t), true);
    assert.equal(await reasonOf(id, t), null);
  });

  it("7: fails closed on a session_id that is missing, malformed, unknown or someone else's", async () => {
    const { id, factorA } = await newMember("OWNER");
    const { claims } = await mfaSession(db, id, { factorId: factorA, at: secondsAgo(30) });
    const someoneElse = await memberSession(db, IDS.partner);
    for (const session_id of [undefined, "", "not-a-uuid", "00000000-0000-4000-8000-000000000000", someoneElse, 42]) {
      assert.equal(await allowed(id, { ...claims, session_id }), false, String(session_id));
    }
    assert.equal(await allowed(id, claims), true, "sanity: its own session works");
  });

  it("8: refuses a session bound to a factor that is gone, unverified or someone else's, or with no proof", async () => {
    const { id, factorA } = await newMember("OWNER");
    const { sessionId, claims } = await mfaSession(db, id, { factorId: factorA, at: secondsAgo(30) });
    assert.equal(await allowed(id, claims), true);

    await db.query("update auth.mfa_factors set status = 'unverified' where id = $1", [factorA]);
    assert.equal(await allowed(id, claims), false, "an unverified factor");
    await db.query("update auth.mfa_factors set status = 'verified' where id = $1", [factorA]);
    assert.equal(await allowed(id, claims), true);

    await db.query("update auth.sessions set factor_id = $2 where id = $1", [sessionId, await factorOf("partner")]);
    assert.equal(await allowed(id, claims), false, "another member's factor");
    await db.query("update auth.sessions set factor_id = null where id = $1", [sessionId]);
    assert.equal(await allowed(id, claims), false, "no factor at all");
    await db.query("update auth.sessions set factor_id = $2 where id = $1", [sessionId, factorA]);
    assert.equal(await allowed(id, claims), true);

    await db.query("update auth.sessions set aal = 'aal1' where id = $1", [sessionId]);
    assert.equal(await allowed(id, claims), false, "a session that is aal1 now");
    await db.query("update auth.sessions set aal = 'aal2' where id = $1", [sessionId]);
    assert.equal(await allowed(id, claims), true);

    await db.query("delete from auth.mfa_amr_claims where session_id = $1 and authentication_method = 'totp'", [sessionId]);
    assert.equal(await allowed(id, claims), false, "no proof of the method on the session");

    // The factor removed where Supabase Auth would not downgrade the session.
    const second = await newMember("OWNER");
    const kept = await mfaSession(db, second.id, { factorId: second.factorA, at: secondsAgo(30) });
    await db.query("delete from auth.mfa_factors where id = $1", [second.factorA]);
    assert.deepEqual(await liveSession(kept.sessionId), { aal: "aal2", factor_id: second.factorA });
    assert.equal(await allowed(second.id, kept.claims), false, "a factor that is gone");
  });

  it("9: maps TOTP to the totp amr method, and refuses another method's entry", async () => {
    const { rows } = await db.query("select public.mfa_method('totp') as totp, public.mfa_method('phone') as phone, public.mfa_method('webauthn') as webauthn, public.mfa_method('sms') as other");
    assert.deepEqual(rows[0], { totp: "totp", phone: "mfa/phone", webauthn: "mfa/webauthn", other: null });

    const { id, factorA } = await newMember("OWNER");
    const { claims } = await mfaSession(db, id, { factorId: factorA, at: secondsAgo(30) });
    assert.deepEqual(claims.amr.map((entry) => entry.method), ["password", "totp"]);
    assert.equal(await allowed(id, claims), true);
    const wrongMethod = { ...claims, amr: claims.amr.map((entry) => (entry.method === "totp" ? { ...entry, method: "mfa/phone" } : entry)) };
    assert.equal(await allowed(id, wrongMethod), false, "a TOTP session proves nothing with a phone entry");
  });

  it("10: reads phone and WebAuthn as mfa/phone and mfa/webauthn, never the bare names", async () => {
    for (const [type, method] of [["phone", "mfa/phone"], ["webauthn", "mfa/webauthn"]]) {
      const { id, factorA } = await newMember("OWNER", { type });
      const { sessionId, claims } = await mfaSession(db, id, { factorId: factorA, at: secondsAgo(30) });
      assert.deepEqual(claims.amr.map((entry) => entry.method), ["password", method]);
      assert.equal(await allowed(id, claims), true, method);
      const bare = { ...claims, amr: claims.amr.map((entry) => (entry.method === method ? { ...entry, method: type } : entry)) };
      assert.equal(await allowed(id, bare), false, `the bare "${type}"`);

      // Removing it downgrades the session; Supabase Auth's clean-up of amr
      // matches the factor type, so the mfa/* entry stays, and still counts
      // for nothing.
      await unenroll(db, factorA);
      assert.ok((await db.query("select 1 from auth.mfa_amr_claims where session_id = $1 and authentication_method = $2", [sessionId, method])).rows.length);
      assert.equal(await allowed(id, claims), false, `${method} after the removal`);
    }
  });

  it("refuses a token its own session superseded with a later verification", async () => {
    const { id, factorA } = await newMember("OWNER");
    const { sessionId, claims: first } = await mfaSession(db, id, { factorId: factorA, at: secondsAgo(120) });
    const second = await verifyFactor(db, sessionId, factorA);
    assert.equal(await allowed(id, second), true);
    assert.equal(await allowed(id, first), false, "every token is judged against the session's latest proof");
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
