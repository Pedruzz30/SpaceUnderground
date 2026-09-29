// The Admin's side of the access model: the snapshot of what the database
// allows, how an action is offered (execute / confirm / step-up / request
// approval / deny), the field-by-field diff, the team helpers, the links in
// Supabase Auth emails, and the mock workflow end to end. None of this is a
// security boundary (the database is); these tests keep the interface honest
// about what the database will say.
//
//   npm test

import { strict as assert } from "node:assert";
import { beforeEach, describe, it } from "node:test";

function createStorageStub() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
  };
}

globalThis.localStorage = createStorageStub();
globalThis.sessionStorage = createStorageStub();

const { can, hasPermission, hasProjectAccess, isSecurityModelActive, legacyAccess, normalizeAccess, requiresApproval } = await import("../src/security/access.js");
const { decide, stepUpFresh } = await import("../src/security/policy.js");
const { parseAuthLink, captureAuthLink, takeAuthLink } = await import("../src/security/auth-link.js");
const { diffProposal, changedCount, draftFields, displayValue, projectColumns } = await import("../src/utils/change-diff.js");
const { accessPreview, canManage, countByStatus, filterMembers, grantableRoles, mfaState } = await import("../src/utils/team-view.js");
const { toDataError } = await import("../src/services/errors.js");
const { permissionsForRoles } = await import("../src/security/catalog.js");

const PROJECT = "b0000000-0000-4000-8000-000000000001";
const OTHER = "b0000000-0000-4000-8000-000000000002";

function raw(roles, { projects = [], blocked = null, stepUp = false, userId = "u-1" } = {}) {
  return {
    member: { user_id: userId, ru: "SU-00042", display_name: "Test", email: "t@x.dev", status: blocked ? "SUSPENDED" : "ACTIVE", effective_status: "ACTIVE" },
    blocked_reason: blocked,
    roles: roles.map((key) => ({ key, rank: { ABSOLUTE_ADMIN: 100, OWNER: 80, SEO: 60, MANAGER: 60, COLLABORATOR: 30, VIEWER: 10 }[key], requires_mfa: ["ABSOLUTE_ADMIN", "OWNER", "SEO", "MANAGER"].includes(key) })),
    permissions: [...permissionsForRoles(roles).map((key) => ({ key })), { key: "made.up" }],
    projects,
    approval_routes: [
      { permission: "projects.edit", via: "projects.draft" },
      { permission: "projects.publish", via: "projects.draft" },
    ],
    mfa: { required: true, enrolled: true, aal: "aal2", step_up: stepUp },
    settings: { step_up_max_age_seconds: 600, approval_expiry_days: 14, invitation_expiry_days: 7 },
  };
}

const collaborator = () => normalizeAccess(raw(["COLLABORATOR"], { projects: [{ project_id: PROJECT, access_level: "EDIT" }, { project_id: OTHER, access_level: "VIEW" }] }));

describe("access snapshot", () => {
  it("keeps only the permissions the catalog knows", () => {
    const access = collaborator();
    assert.equal(access.permissions.has("made.up"), false);
    assert.equal(access.permissions.size, 7);
    assert.equal(access.member.ru, "SU-00042");
  });

  it("answers project access from global permissions or the membership", () => {
    const access = collaborator();
    assert.equal(hasProjectAccess(PROJECT, { access }), true);
    assert.equal(hasProjectAccess(PROJECT, { write: true, access }), true);
    assert.equal(hasProjectAccess(OTHER, { write: true, access }), false, "VIEW only");
    assert.equal(hasProjectAccess("unassigned", { access }), false);
    const owner = normalizeAccess(raw(["OWNER"]));
    assert.equal(hasProjectAccess("anything", { write: true, access: owner }), true);
  });

  it("ignores a project grant that has ended", () => {
    const access = normalizeAccess(raw(["COLLABORATOR"], { projects: [{ project_id: PROJECT, access_level: "EDIT", expires_at: "2020-01-01T00:00:00Z" }] }));
    assert.equal(hasProjectAccess(PROJECT, { access }), false);
  });

  it("offers approval instead of execution only where a route and the project allow it", () => {
    const access = collaborator();
    assert.equal(requiresApproval("projects.edit", { projectId: PROJECT, access }), true);
    assert.equal(requiresApproval("projects.edit", { projectId: OTHER, access }), false);
    assert.equal(requiresApproval("finance.edit", { access }), false);
    assert.equal(requiresApproval("projects.edit", { projectId: PROJECT, access: normalizeAccess(raw(["VIEWER"])) }), false);
    assert.equal(requiresApproval("projects.edit", { access: normalizeAccess(raw(["OWNER"])) }), false, "owners just edit");
  });

  it("grants nothing while the account is blocked", () => {
    const access = normalizeAccess(raw(["OWNER"], { blocked: "SUSPENDED" }));
    assert.equal(hasPermission("projects.read", access), false);
    assert.equal(can("team.read", { access }), false);
  });

  it("mirrors the legacy admins table before the migration, with the security modules closed", () => {
    const access = legacyAccess({ isAdmin: true, user: { id: "x", email: "a@b.c" } });
    assert.equal(hasPermission("finance.edit", access), true);
    assert.equal(hasPermission("permissions.manage", access), false);
    assert.equal(isSecurityModelActive(access), false);
    assert.equal(legacyAccess({ isAdmin: false }), null);
  });
});

describe("decision policy", () => {
  it("executes, confirms, steps up, requests approval or denies", () => {
    const owner = normalizeAccess(raw(["OWNER"]));
    const absolute = normalizeAccess(raw(["ABSOLUTE_ADMIN"]));
    assert.equal(decide("projects.edit", { access: owner }).outcome, "execute");
    assert.equal(decide("team.invite", { access: owner }).outcome, "confirm");
    assert.equal(decide("permissions.manage", { access: owner }).outcome, "deny");
    assert.equal(decide("permissions.manage", { access: absolute }).outcome, "step_up");
    const now = Date.now();
    assert.equal(decide("permissions.manage", { access: absolute, methods: [{ method: "totp", timestamp: Math.floor(now / 1000) - 60 }], now }).outcome, "confirm");
    assert.equal(decide("projects.edit", { projectId: PROJECT, access: collaborator() }).outcome, "request_approval");
    assert.equal(decide("projects.edit", { projectId: "unassigned", access: collaborator() }).outcome, "deny");
    assert.equal(decide("unknown.permission", { access: owner }).outcome, "deny");
  });

  it("counts only a recent second factor as step-up", () => {
    const now = 1_800_000_000_000;
    const at = (seconds) => Math.floor(now / 1000) - seconds;
    assert.equal(stepUpFresh([{ method: "totp", timestamp: at(30) }], 600, now), true);
    assert.equal(stepUpFresh([{ method: "totp", timestamp: at(3600) }], 600, now), false);
    assert.equal(stepUpFresh([{ method: "password", timestamp: at(1) }], 600, now), false);
    assert.equal(stepUpFresh([], 600, now), false);
    // Supabase Auth's names for phone and WebAuthn verifications.
    assert.equal(stepUpFresh([{ method: "mfa/phone", timestamp: at(30) }], 600, now), true);
    assert.equal(stepUpFresh([{ method: "mfa/webauthn", timestamp: at(30) }], 600, now), true);
    assert.equal(stepUpFresh([{ method: "phone", timestamp: at(30) }], 600, now), false, "not a name Supabase Auth records");
    assert.equal(stepUpFresh([{ method: "webauthn", timestamp: at(30) }], 600, now), false);
  });
});

describe("change diff", () => {
  const current = projectColumns({ name: "Ink", category: "Website", year: "2024", techStack: ["Vite"], poster: "", description: "Old" });

  it("maps the Admin model to the columns a draft names", () => {
    assert.equal(current.year, 2024);
    assert.deepEqual(current.tech_stack, ["Vite"]);
    assert.equal(current.poster_url, "");
  });

  it("marks what differs, field by field", () => {
    const diff = diffProposal({ name: "Ink 2", year: 2024, tech_stack: ["Vite"], description: "New" }, current);
    assert.deepEqual(diff.map((entry) => [entry.column, entry.changed]), [["name", true], ["description", true], ["year", false], ["tech_stack", false]]);
    assert.equal(changedCount(diff), 2);
  });

  it("sends only real changes, typed as the database validates them", () => {
    const fields = draftFields({ name: " Ink ", year: "2025", tech_stack: "Vite, Supabase ,", description: "Old", slug: "hacked", editorial_status: "PUBLISHED" }, current);
    assert.deepEqual(fields, { year: 2025, tech_stack: ["Vite", "Supabase"] });
  });

  it("reads empty values as a dash", () => {
    assert.equal(displayValue(null), "—");
    assert.equal(displayValue([]), "—");
    assert.equal(displayValue(["a", "b"]), "a, b");
  });
});

describe("team helpers", () => {
  const members = [
    { userId: "a", displayName: "José Álvares", email: "jose@x.dev", ru: "SU-00001", roles: ["OWNER"], effectiveStatus: "ACTIVE", mfaEnrolledAt: "2026-01-01" },
    { userId: "b", displayName: "Bia", email: "bia@x.dev", ru: "SU-00002", roles: ["COLLABORATOR"], effectiveStatus: "SUSPENDED" },
    { userId: "c", displayName: "Caio", email: "caio@x.dev", ru: "SU-00003", roles: ["SEO"], effectiveStatus: "ACTIVE" },
  ];

  it("filters by status and by a search that ignores accents", () => {
    assert.deepEqual(filterMembers(members, "ALL", "alvares").map((member) => member.userId), ["a"]);
    assert.deepEqual(filterMembers(members, "SUSPENDED").map((member) => member.userId), ["b"]);
    assert.deepEqual(filterMembers(members, "ALL", "su-00003").map((member) => member.userId), ["c"]);
    assert.equal(countByStatus(members).ACTIVE, 2);
  });

  it("reads the MFA state a row shows, with no grace state", () => {
    assert.equal(mfaState(members[0]), "enabled");
    assert.equal(mfaState(members[1]), "optional");
    assert.equal(mfaState(members[2]), "required", "a privileged member without MFA is simply blocked");
    assert.equal(mfaState({ roles: ["MANAGER"] }), "required");
  });

  it("applies the rank rule the database applies", () => {
    const owner = normalizeAccess(raw(["OWNER"], { userId: "me" }));
    assert.equal(canManage(members[1], owner), true);
    assert.equal(canManage(members[0], owner), false, "another owner");
    assert.equal(canManage({ ...members[1], userId: "me" }, owner), false, "yourself");
    assert.deepEqual(grantableRoles(owner), ["SEO", "MANAGER", "COLLABORATOR", "VIEWER"]);
    assert.deepEqual(grantableRoles(normalizeAccess(raw(["ABSOLUTE_ADMIN"]))).length, 6);
  });

  it("previews what a collaborator cannot reach", () => {
    const preview = accessPreview(["COLLABORATOR"]);
    for (const module of ["finance", "commercial", "clients", "team", "roles", "security", "settings", "logs"]) {
      assert.ok(preview.blocked.includes(module), module);
    }
    assert.ok(preview.permissions.includes("projects.draft"));
  });
});

describe("links from Supabase Auth emails", () => {
  it("reads a session from the fragment, or a one-time hash from the query", () => {
    assert.deepEqual(parseAuthLink("#access_token=a.b.c&refresh_token=r1&type=invite&expires_in=3600", ""), { type: "invite", accessToken: "a.b.c", refreshToken: "r1" });
    assert.deepEqual(parseAuthLink("#/login", "?token_hash=h1&type=recovery"), { type: "recovery", tokenHash: "h1" });
    assert.deepEqual(parseAuthLink("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid", ""), { error: "otp_expired", description: "Email link is invalid" });
    assert.equal(parseAuthLink("#/dashboard", ""), null);
    assert.equal(parseAuthLink("#/login", "?token_hash=h1&type=bogus"), null);
  });

  it("takes the tokens out of the address bar and hands them over once", () => {
    const replaced = [];
    const location = { hash: "#access_token=a.b.c&refresh_token=r1&type=invite", search: "?x=1", pathname: "/admin/" };
    captureAuthLink(location, { replaceState: (_state, _title, url) => replaced.push(url) });
    assert.deepEqual(replaced, ["/admin/?x=1#/welcome"]);
    assert.equal(takeAuthLink().refreshToken, "r1");
    assert.equal(takeAuthLink(), null);
  });
});

describe("security error codes", () => {
  it("maps each database refusal to a stable code the pages act on", () => {
    assert.equal(toDataError({ code: "SU005" }, "x").code, "step_up_required");
    assert.equal(toDataError({ code: "SU013" }, "x").code, "session_revoked");
    assert.equal(toDataError({ code: "SU006" }, "x").code, "mfa_required");
    assert.equal(toDataError({ code: "SU001" }, "x").code, "version_conflict");
    assert.equal(toDataError({ code: "SU002" }, "x").code, "self_approval");
    assert.equal(toDataError({ code: "42501" }, "x").code, "unauthorized");
    assert.equal(toDataError({ code: "PGRST202" }, "x").code, "schema_outdated");
    assert.equal(toDataError({ code: "function_unavailable" }, "x").code, "function_unavailable");
  });
});

const { login, logout } = await import("../src/services/auth-service.js");
const { resetMockData } = await import("../src/services/dev-tools.js");
const approvals = await import("../src/services/approval-service.js");
const team = await import("../src/services/team-service.js");
const { getProjectById } = await import("../src/services/project-service.js");
const { getAccess } = await import("../src/security/access.js");

describe("mock workflow", () => {
  const as = (profile) => login({ email: "", password: "mock", profile });

  beforeEach(async () => {
    sessionStorage.clear();
    resetMockData();
  });

  it("drafts, submits and gets approved by someone else, never by the requester", async () => {
    await as("collaborator");
    assert.equal(getAccess().roles[0].key, "COLLABORATOR");
    const draft = await approvals.saveDraft("001", { description: "Proposed in mock" });
    const pending = await approvals.submitRequest(draft.id);
    assert.equal(pending.status, "PENDING");
    await assert.rejects(approvals.approveRequest(pending.id), (error) => error.code === "unauthorized");
    await logout();

    await as("seo");
    const result = await approvals.approveRequest(pending.id, "ok");
    assert.equal(result.status, "APPROVED");
    assert.equal((await getProjectById("001")).description, "Proposed in mock");
    const again = await approvals.approveRequest(pending.id);
    assert.equal(again.already_applied, true);
    await logout();
  });

  it("refuses drafts on a project the collaborator only views", async () => {
    await as("collaborator");
    await assert.rejects(approvals.saveDraft("002", { name: "Nope" }), (error) => error.code === "unauthorized");
    await assert.rejects(approvals.saveDraft("001", { slug: "nope" }), (error) => error.code === "invalid_input");
    await logout();
  });

  it("ends the member's own session everywhere, until they sign in again", async () => {
    await as("seo");
    const { revokeMySessions, loadAccess } = await import("../src/services/access-service.js");
    const { getSession } = await import("../src/services/auth-service.js");
    await revokeMySessions();
    const access = await loadAccess(await getSession(), { force: true });
    assert.equal(access.blockedReason, "SESSION_REVOKED");
    assert.equal(access.permissions.size, 0);
    assert.deepEqual([access.member, access.roles, access.projects], [null, [], []], "nothing about the member");
    await assert.rejects(team.listMembers(), (error) => error.code === "session_revoked");
    await logout();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await as("seo");
    assert.equal(getAccess().blockedReason, null, "a new sign-in works");
    await logout();
  });

  it("treats a removed factor as no MFA, on the very session that removed it", async () => {
    await as("owner");
    const mfa = await import("../src/services/mfa-service.js");
    const { loadAccess } = await import("../src/services/access-service.js");
    const { getSession } = await import("../src/services/auth-service.js");
    const repository = await (await import("../src/services/repositories/index.js")).getAccessRepository();
    const [factor] = await mfa.listFactors();
    assert.equal(factor.status, "verified");

    // The removal alone: the session still carries its verification, as a
    // Supabase token keeps aal2 until it is refreshed.
    await repository.unenroll(factor.id);
    assert.equal((await repository.assurance()).currentLevel, "aal2");
    const access = await loadAccess(await getSession(), { force: true });
    assert.equal(access.blockedReason, "MFA_ENROLL_REQUIRED");
    assert.deepEqual([access.mfa.enrolled, access.mfa.stepUp], [false, false]);
    assert.equal(hasPermission("team.read"), false);
    assert.equal(await mfa.hasFreshStepUp(), false);
    await assert.rejects(team.listMembers(), (error) => error.code === "mfa_required");
    await logout();
  });

  it("does not accept a session from before the factor enrolled since", async () => {
    await as("owner");
    const mfa = await import("../src/services/mfa-service.js");
    const { loadAccess } = await import("../src/services/access-service.js");
    const { getSession } = await import("../src/services/auth-service.js");
    const repository = await (await import("../src/services/repositories/index.js")).getAccessRepository();
    const KEY = "space-admin:session:v1";
    // T1: this session verified factor A. Another copy of it keeps it as is.
    const t1 = sessionStorage.getItem(KEY);
    const [factorA] = await mfa.listFactors();
    await repository.unenroll(factorA.id);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const factorB = await mfa.enrollTotp("B");
    await mfa.verifyTotp(factorB.id, "123456");
    assert.equal((await loadAccess(await getSession(), { force: true })).blockedReason, null, "T2, from verifying B, works");

    const t2 = sessionStorage.getItem(KEY);
    sessionStorage.setItem(KEY, t1);
    const stale = await loadAccess(await getSession(), { force: true });
    assert.equal(stale.blockedReason, "MFA_CHALLENGE_REQUIRED", "T1 verified A, not B");
    await assert.rejects(team.listMembers(), (error) => error.code === "mfa_required");
    sessionStorage.setItem(KEY, t2);
    await logout();
  });

  it("does not accept a session whose factor was removed, though another factor remains", async () => {
    await as("owner");
    const mfa = await import("../src/services/mfa-service.js");
    const { loadAccess } = await import("../src/services/access-service.js");
    const { getSession } = await import("../src/services/auth-service.js");
    const repository = await (await import("../src/services/repositories/index.js")).getAccessRepository();
    // Factor B joins factor A; then this session verifies A again (T1).
    const [factorA] = await mfa.listFactors();
    const factorB = await mfa.enrollTotp("B");
    await mfa.verifyTotp(factorB.id, "123456");
    await new Promise((resolve) => setTimeout(resolve, 5));
    await mfa.verifyTotp(factorA.id, "123456");
    assert.equal((await loadAccess(await getSession(), { force: true })).blockedReason, null, "T1 works");

    await repository.unenroll(factorA.id);
    assert.ok((await mfa.listFactors()).some((factor) => factor.id === factorB.id && factor.status === "verified"), "B remains");
    const access = await loadAccess(await getSession(), { force: true });
    assert.equal(access.blockedReason, "MFA_CHALLENGE_REQUIRED", "T1's session is aal1 now: verify B");
    await assert.rejects(team.listMembers(), (error) => error.code === "mfa_required");
    await logout();
  });

  it("refreshes the session as soon as a factor is removed, and enrolling again restores access", async () => {
    await as("owner");
    const mfa = await import("../src/services/mfa-service.js");
    const { loadAccess } = await import("../src/services/access-service.js");
    const { getSession } = await import("../src/services/auth-service.js");
    const repository = await (await import("../src/services/repositories/index.js")).getAccessRepository();
    const [factor] = await mfa.listFactors();
    await mfa.removeFactor(factor.id);
    assert.equal((await repository.assurance()).currentLevel, "aal1", "the refreshed session is aal1");
    assert.equal((await loadAccess(await getSession(), { force: true })).blockedReason, "MFA_ENROLL_REQUIRED");

    const enrolment = await mfa.enrollTotp("Again");
    await mfa.verifyTotp(enrolment.id, "123456");
    assert.equal((await loadAccess(await getSession(), { force: true })).blockedReason, null);
    assert.equal(hasPermission("team.read"), true);
    await logout();
  });

  it("re-reads the access snapshot once it is older than its time to live", async () => {
    await as("collaborator");
    const { loadAccess } = await import("../src/services/access-service.js");
    const { getSession } = await import("../src/services/auth-service.js");
    const session = await getSession();
    const first = await loadAccess(session);
    assert.equal(await loadAccess(session), first, "fresh: the same snapshot");
    const reread = await loadAccess(session, { maxAge: 0 });
    assert.notEqual(reread, first, "stale: asked again");
    await logout();
  });

  it("suspends a member, who then holds nothing", async () => {
    await as("owner");
    await team.suspendMember("mock-collaborator", "Paused");
    await assert.rejects(team.suspendMember("mock-owner", "self"), (error) => error.code === "rank");
    await logout();
    // A sign-in after the suspension (one from the same instant counts as
    // ended, as the database counts one from the same second).
    await new Promise((resolve) => setTimeout(resolve, 5));
    await as("collaborator");
    assert.equal(getAccess().blockedReason, "SUSPENDED");
    await logout();
  });
});
