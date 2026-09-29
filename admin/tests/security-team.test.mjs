// Identity, MFA, invitations and the account lifecycle, attacked and exercised
// through the API roles: who can invite whom, what suspension and offboarding
// take away, and what they leave for the record.
//
//   npm test

import { strict as assert } from "node:assert";
import { after, before, describe, it } from "node:test";
import { IDS, PROJECTS, as, code, createSecurityDb, defaultStrength, one, outcome, sessionClaims } from "./helpers/security-fixture.mjs";
import { issuedNow } from "./helpers/supabase-db.mjs";

let db;

before(async () => {
  db = await createSecurityDb();
});

after(async () => {
  await db?.close();
});

const member = (id) => one(db.query("select * from public.team_members where user_id = $1", [id]));
const activeRoles = async (id) =>
  (await db.query("select role_key from public.user_roles where user_id = $1 and revoked_at is null order by role_key", [id])).rows.map((row) => row.role_key);
const audit = async (action, target) =>
  (await db.query("select * from public.security_audit_log where action = $1 and target_user_id = $2 order by id", [action, target])).rows;
const access = async (who, strength = defaultStrength(who)) => (await one(as(db, who, "select public.my_access() as access", [], strength))).access;

let serial = 0;
// A fresh Supabase Auth user, as Supabase Auth creates it for an invitation:
// no password yet.
async function authUser(email, password = "") {
  serial += 1;
  const id = `c0000000-0000-4000-8000-${String(serial).padStart(12, "0")}`;
  await db.query("insert into auth.users (id, email, encrypted_password) values ($1, $2, $3)", [id, email, password]);
  return id;
}

// The whole invitation, as the team-invite Edge Function runs it.
async function invite(who, { email, roles = ["COLLABORATOR"], projects = [], expires = null, strength = defaultStrength(who) }) {
  const prepared = (await one(as(db, who, "select public.prepare_invitation($1, 'New person', $2, $3::jsonb, null, $4) as result", [email, roles, JSON.stringify(projects), expires], strength))).result;
  const userId = await authUser(email);
  await as(db, "service", "select public.complete_invitation($1, $2)", [prepared.invitation_id, userId]);
  return { invitationId: prepared.invitation_id, userId };
}

async function asUser(userId, sql, params = [], extra = {}) {
  const { asRole } = await import("./helpers/supabase-db.mjs");
  return asRole(db, "authenticated", userId, () => db.query(sql, params), { aal: "aal1", ...extra });
}

describe("identity", () => {
  it("turns each legacy admin into an OWNER with the first RU, and no MFA grace period", async () => {
    const owner = await member(IDS.owner);
    assert.equal(owner.ru, "SU-00001");
    assert.equal(owner.status, "ACTIVE");
    assert.equal("mfa_grace_until" in owner, false);
    assert.equal(owner.sessions_valid_after, null, "no session was ended yet");
    assert.deepEqual(await activeRoles(IDS.owner), ["OWNER"]);
    const [grant] = await audit("BOOTSTRAP_GRANT", IDS.owner);
    assert.equal(grant.metadata.source, "public.admins");
  });

  it("gives every member a unique RU in the SU-00000 format, derived from nothing personal", async () => {
    const { rows } = await db.query("select ru from public.team_members order by ru");
    assert.ok(rows.every((row) => /^SU-\d{5,}$/.test(row.ru)));
    assert.equal(new Set(rows.map((row) => row.ru)).size, rows.length);
  });

  it("keeps the RU and the user id immutable, even against a plain UPDATE by the table owner", async () => {
    assert.equal(await code(db.query("update public.team_members set ru = 'SU-99999' where user_id = $1", [IDS.seo])), "42501");
    assert.equal(await code(db.query("update public.team_members set user_id = $2 where user_id = $1", [IDS.seo, IDS.outsider])), "42501");
  });

  it("refuses new rows in the legacy admins table, which no longer grants access", async () => {
    assert.equal(await code(db.query("insert into public.admins (user_id, role) values ($1, 'owner')", [IDS.outsider])), "42501");
    assert.equal(await code(as(db, "owner", "insert into public.admins (user_id, role) values ($1, 'owner')", [IDS.outsider])), "42501");
  });

  it("runs the break-glass bootstrap only without a request JWT", async () => {
    assert.equal(await code(as(db, "service", "select public.bootstrap_member('outsider@space.local', 'ABSOLUTE_ADMIN')")), "42501");
    assert.equal(await code(as(db, "absolute", "select public.bootstrap_member('someone@space.local', 'OWNER')", [], "mfa")), "42501");
  });
});

describe("permissions and MFA", () => {
  it("resolves each role to its catalog permissions", async () => {
    const counts = {};
    for (const who of ["absolute", "owner", "seo", "manager", "collaborator", "viewer"]) {
      counts[who] = (await access(who, "mfa")).permissions.length;
    }
    assert.deepEqual(counts, { absolute: 52, owner: 48, seo: 26, manager: 28, collaborator: 7, viewer: 4 });
  });

  it("holds nothing on a password-only session once a factor is enrolled", async () => {
    assert.equal(await outcome(as(db, "partner", "select id from public.projects where id = $1", [PROJECTS.assigned], "aal1")), "none");
    assert.equal((await access("partner", "aal1")).blocked_reason, "MFA_CHALLENGE_REQUIRED");
    assert.equal(await outcome(as(db, "partner", "select id from public.projects where id = $1", [PROJECTS.assigned], "mfa")), "ok");
  });

  it("holds nothing for a privileged role without MFA once there is no grace period", async () => {
    const userId = await authUser("fresh-seo@space.local", "hash");
    await db.query("insert into public.team_members (user_id, display_name, email, status) values ($1, 'Fresh', 'fresh-seo@space.local', 'ACTIVE')", [userId]);
    await db.query("insert into public.user_roles (user_id, role_key) values ($1, 'SEO')", [userId]);
    assert.equal(await outcome(asUser(userId, "select id from public.projects")), "none");
    const blocked = (await one(asUser(userId, "select public.my_access() as access"))).access;
    assert.equal(blocked.blocked_reason, "MFA_ENROLL_REQUIRED");
    assert.equal(blocked.mfa.required, true);
  });

  it("gives a migrated owner nothing without MFA, from the first use", async () => {
    // No grace period: the legacy admin became an OWNER with no factor.
    const columns = await db.query("select column_name from information_schema.columns where table_name = 'team_members' and column_name ~ 'grace'");
    assert.deepEqual(columns.rows, [], "no grace column left");
    assert.equal(await outcome(as(db, "owner", "select id from public.projects where id = $1", [PROJECTS.assigned], "aal1")), "none");
    assert.equal(await outcome(as(db, "owner", "select id from public.financial_transactions", [], "aal1")), "none");
    assert.equal(await code(as(db, "owner", "select public.prepare_invitation('first-use@space.local', 'X', array['VIEWER'])", [], "aal1")), "SU006");
    const blocked = await access("owner", "aal1");
    assert.equal(blocked.blocked_reason, "MFA_ENROLL_REQUIRED", "the Admin opens the enrolment screen");
    assert.deepEqual([blocked.mfa.required, blocked.mfa.enrolled], [true, false]);
    assert.equal("grace_until" in blocked.mfa, false);

    // Enrolling goes through Supabase Auth; once the session is aal2 the
    // owner's access is back, with nothing else to unlock.
    assert.equal(await outcome(as(db, "owner", "select id from public.projects where id = $1", [PROJECTS.assigned], "mfa")), "ok");
    assert.equal((await access("owner", "mfa")).blocked_reason, null);
  });

  it("keeps the old is_admin() out of every API role's reach, failing closed for any internal caller", async () => {
    for (const who of ["owner", "partner", "absolute", "collaborator", "outsider", "anon", "service"]) {
      assert.equal(await code(as(db, who, "select public.is_admin()")), "42501", who);
    }
    // What it would still answer a caller inside the database (run here as
    // the table owner with a member's claims).
    const internal = async (who, strength) => {
      await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ role: "authenticated", sub: IDS[who], ...sessionClaims(strength), iat: issuedNow() })]);
      try {
        return (await one(db.query("select public.is_admin() as value"))).value;
      } finally {
        await db.query("select set_config('request.jwt.claims', '', false)");
      }
    };
    assert.equal(await internal("partner", "mfa"), true);
    assert.equal(await internal("partner", "aal1"), false, "an enrolled owner on a password-only session");
    assert.equal(await internal("owner", "aal1"), false, "a migrated owner without MFA");
    assert.equal(await internal("seo", "mfa"), false);
    assert.equal(await internal("collaborator", "aal1"), false);
  });

  it("never tells a member someone else's status without team.read", async () => {
    const rows = (await as(db, "collaborator", "select * from public.member_directory($1)", [[IDS.seo, IDS.collaborator]])).rows;
    const byId = Object.fromEntries(rows.map((row) => [row.user_id, row]));
    assert.equal(byId[IDS.seo].status, null);
    assert.equal(byId[IDS.seo].ru.startsWith("SU-"), true);
    assert.equal(byId[IDS.collaborator].status, "ACTIVE");
    assert.equal(await outcome(as(db, "outsider", "select * from public.member_directory($1)", [[IDS.seo]])), "none");
  });
});

describe("invitations", () => {
  it("invites a collaborator with projects, who activates after choosing a password", async () => {
    const { invitationId, userId } = await invite("owner", {
      email: "new.collaborator@space.local",
      projects: [{ project_id: PROJECTS.assigned, access_level: "EDIT" }],
    });
    const invited = await member(userId);
    assert.equal(invited.status, "INVITED");
    assert.deepEqual(await activeRoles(userId), ["COLLABORATOR"]);
    const [record] = await audit("USER_INVITED", userId);
    assert.equal(record.actor_user_id, IDS.owner);
    assert.equal((await one(db.query("select status from public.team_invitations where id = $1", [invitationId]))).status, "SENT");

    assert.equal(await outcome(asUser(userId, "select id from public.projects")), "none", "an invited member holds nothing yet");
    assert.equal(await code(asUser(userId, "select public.activate_my_membership()")), "SU008", "a password comes first");
    await db.query("update auth.users set encrypted_password = 'hash' where id = $1", [userId]);
    const activated = (await one(asUser(userId, "select public.activate_my_membership() as access"))).access;
    assert.equal(activated.member.status, "ACTIVE");
    assert.equal(activated.blocked_reason, null);
    assert.equal((await audit("USER_ACTIVATED", userId)).length, 1);
    assert.equal(await outcome(asUser(userId, "select id from public.projects where id = $1", [PROJECTS.assigned])), "ok");
  });

  it("completes invitations only with the service role", async () => {
    const prepared = (await one(as(db, "owner", "select public.prepare_invitation('only-service@space.local', 'X', array['VIEWER']) as result"))).result;
    const userId = await authUser("only-service@space.local");
    assert.equal(await code(as(db, "owner", "select public.complete_invitation($1, $2)", [prepared.invitation_id, userId])), "42501");
    assert.equal(await code(asUser(userId, "select public.complete_invitation($1, $2)", [prepared.invitation_id, userId])), "42501");
    assert.equal(await code(as(db, "anon", "select public.complete_invitation($1, $2)", [prepared.invitation_id, userId])), "42501");
  });

  it("refuses an account that already has a password, so nobody who registered the address first gets the access", async () => {
    const prepared = (await one(as(db, "owner", "select public.prepare_invitation('squatted@space.local', 'X', array['COLLABORATOR']) as result"))).result;
    const userId = await authUser("squatted@space.local", "attacker-chosen");
    assert.equal(await code(as(db, "service", "select public.complete_invitation($1, $2)", [prepared.invitation_id, userId])), "SU008");
    await as(db, "service", "select public.fail_invitation($1, 'existing account')", [prepared.invitation_id]);
    assert.equal((await one(db.query("select status from public.team_invitations where id = $1", [prepared.invitation_id]))).status, "FAILED");
    assert.equal(await member(userId), undefined);
  });

  it("refuses to invite into a role at or above the inviter's", async () => {
    for (const role of ["OWNER", "ABSOLUTE_ADMIN"]) {
      assert.equal(await code(as(db, "owner", "select public.prepare_invitation($1, 'X', $2)", [`${role}@space.local`, [role]], "mfa")), "SU009", role);
    }
  });

  it("needs a fresh MFA verification to invite into a role with approval powers", async () => {
    assert.equal(await code(as(db, "owner", "select public.prepare_invitation('seo2@space.local', 'X', array['SEO'])", [], "stale")), "SU005");
    assert.equal(await code(as(db, "owner", "select public.prepare_invitation('seo2@space.local', 'X', array['SEO'])", [], "mfa")), null);
  });

  it("keeps invitations to people with team.invite", async () => {
    assert.equal(await code(as(db, "manager", "select public.prepare_invitation('m@space.local', 'X', array['VIEWER'])", [], "mfa")), "42501");
    assert.equal(await code(as(db, "collaborator", "select public.prepare_invitation('m@space.local', 'X', array['VIEWER'])")), "42501");
  });

  it("refuses a duplicate: a current member, or an invitation already open", async () => {
    assert.equal(await code(as(db, "owner", "select public.prepare_invitation('SEO@space.local', 'X', array['VIEWER'])")), "SU008");
    await as(db, "owner", "select public.prepare_invitation('twice@space.local', 'X', array['VIEWER'])");
    assert.equal(await code(as(db, "owner", "select public.prepare_invitation('twice@space.local', 'X', array['VIEWER'])")), "SU008");
  });

  it("validates what an invitation carries", async () => {
    const bad = [
      ["not-an-email", ["VIEWER"], "[]"],
      ["ok@space.local", [], "[]"],
      ["ok@space.local", ["NOBODY"], "[]"],
      ["ok@space.local", ["VIEWER"], JSON.stringify([{ project_id: "not-a-uuid" }])],
      ["ok@space.local", ["VIEWER"], JSON.stringify([{ project_id: PROJECTS.assigned, access_level: "ADMIN" }])],
      ["ok@space.local", ["VIEWER"], JSON.stringify([{ project_id: PROJECTS.assigned }, { project_id: PROJECTS.assigned }])],
    ];
    for (const [email, roles, projects] of bad) {
      assert.equal(await code(as(db, "owner", "select public.prepare_invitation($1, 'X', $2, $3::jsonb)", [email, roles, projects])), "SU004", `${email} ${roles} ${projects}`);
    }
    assert.equal(
      await code(as(db, "owner", "select public.prepare_invitation('past@space.local', 'X', array['VIEWER'], '[]'::jsonb, null, now() - interval '1 day')")),
      "SU004",
    );
  });

  it("limits how many invitations one person sends per hour", async () => {
    await db.query("update public.security_settings set invitations_per_hour = 1");
    try {
      const partnerInvite = "select public.prepare_invitation($1, 'X', array['VIEWER'])";
      assert.equal(await code(as(db, "partner", partnerInvite, ["limit-1@space.local"], "mfa")), null);
      assert.equal(await code(as(db, "partner", partnerInvite, ["limit-2@space.local"], "mfa")), "SU007");
    } finally {
      await db.query("update public.security_settings set invitations_per_hour = 20");
    }
  });

  it("cancels an invitation, offboarding the member who never accepted", async () => {
    const { invitationId, userId } = await invite("owner", { email: "cancelled@space.local" });
    await as(db, "owner", "select public.cancel_invitation($1)", [invitationId]);
    assert.equal((await member(userId)).status, "OFFBOARDED");
    assert.deepEqual(await activeRoles(userId), []);
  });

  it("resends only to someone who has not accepted yet", async () => {
    const { userId } = await invite("owner", { email: "resend@space.local" });
    const resent = (await one(as(db, "owner", "select public.prepare_invitation_resend($1) as result", [userId]))).result;
    assert.equal(resent.email, "resend@space.local");
    assert.equal(await code(as(db, "owner", "select public.prepare_invitation_resend($1)", [IDS.collaborator])), "SU008");
  });
});

describe("account lifecycle", () => {
  async function sessionsOf(userId) {
    return Number((await one(db.query("select count(*) from auth.sessions where user_id = $1", [userId]))).count);
  }

  async function signIn(userId) {
    const session = await one(db.query("insert into auth.sessions (user_id) values ($1) returning id", [userId]));
    await db.query("insert into auth.refresh_tokens (session_id) values ($1)", [session.id]);
  }

  it("suspends: no access, sessions revoked, sign-in banned; reactivation restores it", async () => {
    await signIn(IDS.collaborator2);
    assert.equal(await code(as(db, "partner", "select public.suspend_member($1, '')", [IDS.collaborator2], "mfa")), "SU004", "a reason is required");
    const result = (await one(as(db, "partner", "select public.suspend_member($1, 'Contract paused') as result", [IDS.collaborator2], "mfa"))).result;
    assert.equal(result.status, "SUSPENDED");
    assert.equal(result.sessions_revoked, 1);
    assert.equal(await sessionsOf(IDS.collaborator2), 0);
    assert.equal(Number((await one(db.query("select count(*) from auth.refresh_tokens"))).count), 0, "refresh tokens go with their sessions");
    assert.ok((await one(db.query("select banned_until from auth.users where id = $1", [IDS.collaborator2]))).banned_until > new Date());
    assert.equal(await outcome(as(db, "collaborator2", "select id from public.projects where id = $1", [PROJECTS.other])), "none");
    assert.equal((await audit("USER_SUSPENDED", IDS.collaborator2)).length, 1);
    assert.equal((await audit("SESSION_REVOKED", IDS.collaborator2)).length, 1);

    await as(db, "partner", "select public.reactivate_member($1)", [IDS.collaborator2], "mfa");
    assert.equal((await member(IDS.collaborator2)).status, "ACTIVE");
    assert.equal((await one(db.query("select banned_until from auth.users where id = $1", [IDS.collaborator2]))).banned_until, null);
    assert.equal(await outcome(as(db, "collaborator2", "select id from public.projects where id = $1", [PROJECTS.other])), "ok");
  });

  it("never lets anyone act on themselves or on someone ranked at or above them", async () => {
    assert.equal(await code(as(db, "partner", "select public.suspend_member($1, 'x')", [IDS.partner], "mfa")), "SU009");
    assert.equal(await code(as(db, "partner", "select public.suspend_member($1, 'x')", [IDS.owner], "mfa")), "SU009", "owners cannot remove each other");
    assert.equal(await code(as(db, "partner", "select public.suspend_member($1, 'x')", [IDS.absolute], "mfa")), "SU009");
    assert.equal(await code(as(db, "manager", "select public.suspend_member($1, 'x')", [IDS.collaborator], "mfa")), "42501");
  });

  it("needs a fresh MFA verification to suspend an administrative member", async () => {
    assert.equal(await code(as(db, "absolute", "select public.suspend_member($1, 'Audit')", [IDS.partner], "stale")), "SU005");
    assert.equal(await code(as(db, "absolute", "select public.suspend_member($1, 'Audit')", [IDS.partner], "mfa")), null);
    await as(db, "absolute", "select public.reactivate_member($1)", [IDS.partner], "mfa");
    assert.equal((await member(IDS.partner)).status, "ACTIVE");
  });

  it("offboards for good: access gone, requests cancelled, history and RU kept", async () => {
    const { userId } = await invite("owner", { email: "leaving@space.local", projects: [{ project_id: PROJECTS.assigned, access_level: "EDIT" }] });
    await db.query("update auth.users set encrypted_password = 'hash' where id = $1", [userId]);
    await asUser(userId, "select public.activate_my_membership()");
    const draft = await one(asUser(userId, "select * from public.save_project_draft($1, '{\"description\":\"Mine\"}'::jsonb)", [PROJECTS.assigned]));
    await signIn(userId);
    const ru = (await member(userId)).ru;

    const result = (await one(as(db, "owner", "select public.offboard_member($1, 'Left the company') as result", [userId]))).result;
    assert.equal(result.requests_cancelled, 1);
    const gone = await member(userId);
    assert.equal(gone.status, "OFFBOARDED");
    assert.equal(gone.ru, ru);
    assert.deepEqual(await activeRoles(userId), []);
    assert.equal(Number((await one(db.query("select count(*) from public.project_members where user_id = $1 and revoked_at is null", [userId]))).count), 0);
    assert.equal((await one(db.query("select status from public.change_requests where id = $1", [draft.id]))).status, "CANCELLED");
    assert.equal(await sessionsOf(userId), 0);
    assert.ok((await audit("USER_OFFBOARDED", userId)).length === 1);
    assert.equal(await outcome(asUser(userId, "select id from public.projects")), "none");

    assert.equal(await code(as(db, "owner", "select public.reactivate_member($1)", [userId])), "SU008");
    assert.equal(await code(as(db, "owner", "select public.update_member_access($1, array['COLLABORATOR'], '[]'::jsonb, null)", [userId])), "SU008");
    assert.equal(await code(db.query("update public.team_members set status = 'ACTIVE' where user_id = $1", [userId])), "SU008", "terminal, even against a plain UPDATE by the table owner");
  });

  it("expires access at the end of its window, and reactivating needs a new end date or none", async () => {
    const swept = (await one(as(db, "owner", "select public.expire_stale_access() as result"))).result;
    assert.ok(swept.members >= 1);
    assert.equal((await member(IDS.expired)).status, "EXPIRED");
    assert.equal(await code(as(db, "owner", "select public.reactivate_member($1, now() - interval '1 day')", [IDS.expired])), "SU004");
    const until = new Date(Date.now() + 30 * 86400_000);
    await as(db, "owner", "select public.reactivate_member($1, $2)", [IDS.expired, until]);
    const renewed = await member(IDS.expired);
    assert.equal(renewed.status, "ACTIVE");
    assert.equal(renewed.access_expires_at.getTime(), until.getTime());
    assert.equal(await outcome(as(db, "expired", "select id from public.projects where id = $1", [PROJECTS.assigned])), "ok");
  });

  it("keeps the end date of a suspended temporary member unless a new one is given", async () => {
    const until = new Date(Date.now() + 5 * 86400_000);
    await db.query("update public.team_members set access_expires_at = $2 where user_id = $1", [IDS.viewer, until]);
    await as(db, "owner", "select public.suspend_member($1, 'Pause')", [IDS.viewer]);
    await as(db, "owner", "select public.reactivate_member($1)", [IDS.viewer]);
    assert.equal((await member(IDS.viewer)).access_expires_at.getTime(), until.getTime(), "reactivation did not make the access permanent");
  });

  it("changes roles and projects of another member, auditing each grant and removal", async () => {
    const projects = [{ project_id: PROJECTS.other, access_level: "VIEW" }];
    await as(db, "owner", "select public.update_member_access($1, array['VIEWER'], $2::jsonb, null)", [IDS.collaborator2, JSON.stringify(projects)]);
    assert.deepEqual(await activeRoles(IDS.collaborator2), ["VIEWER"]);
    assert.equal((await audit("ROLE_REMOVED", IDS.collaborator2)).at(-1).metadata.role, "COLLABORATOR");
    assert.equal((await audit("ROLE_ASSIGNED", IDS.collaborator2)).at(-1).metadata.role, "VIEWER");
    assert.equal((await audit("PROJECT_ACCESS_CHANGED", IDS.collaborator2)).at(-1).metadata.access_level, "VIEW");
    assert.equal(await code(as(db, "collaborator2", "select public.save_project_draft($1, '{\"name\":\"x\"}'::jsonb)", [PROJECTS.other])), "42501");
    await as(db, "owner", "select public.update_member_access($1, array['COLLABORATOR'], $2::jsonb, null)", [
      IDS.collaborator2,
      JSON.stringify([{ project_id: PROJECTS.other, access_level: "EDIT" }]),
    ]);
  });

  it("revokes the sessions of another member on demand", async () => {
    await signIn(IDS.viewer);
    await signIn(IDS.viewer);
    const result = (await one(as(db, "owner", "select public.revoke_member_sessions($1) as result", [IDS.viewer]))).result;
    assert.equal(result.sessions_revoked, 2);
    assert.equal(await sessionsOf(IDS.viewer), 0);
    assert.equal(await code(as(db, "collaborator", "select public.revoke_member_sessions($1)", [IDS.viewer])), "42501");
  });

  it("records a sign-in once per session, with the time Supabase Auth recorded", async () => {
    await as(db, "seo", "select public.record_sign_in()", [], "mfa");
    await as(db, "seo", "select public.record_sign_in()", [], "mfa");
    const rows = await audit("LOGIN_SUCCESS", IDS.seo);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].metadata.session_id, "s-seo");
    assert.equal(rows[0].aal, "aal2");
  });

  it("records MFA enrolment and removal from what Supabase Auth holds, not from the client", async () => {
    const userId = await authUser("mfa-later@space.local", "hash");
    await db.query("insert into public.team_members (user_id, display_name, email, status) values ($1, 'Later', 'mfa-later@space.local', 'ACTIVE')", [userId]);
    await db.query("insert into public.user_roles (user_id, role_key) values ($1, 'COLLABORATOR')", [userId]);
    await asUser(userId, "select public.record_mfa_state()");
    assert.equal((await audit("MFA_ENROLLED", userId)).length, 0, "no factor, no record");
    await db.query("insert into auth.mfa_factors (user_id, status) values ($1, 'verified')", [userId]);
    await asUser(userId, "select public.record_mfa_state()", [], { aal: "aal2" });
    assert.equal((await audit("MFA_ENROLLED", userId)).length, 1);
    await db.query("delete from auth.mfa_factors where user_id = $1", [userId]);
    await asUser(userId, "select public.record_mfa_state()");
    assert.equal((await audit("MFA_REMOVED", userId)).length, 1);
  });
});
