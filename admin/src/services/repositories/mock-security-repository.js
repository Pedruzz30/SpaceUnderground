// Mock mode only: a small, local stand-in for the security model, so the Team,
// Approvals and Audit screens can be used and tested without Supabase. It
// follows the database's main rules (permissions from the catalog, no
// self-approval, rank, step-up for critical actions, version conflicts) with
// the same error codes, but it protects nothing: in mock mode everything is
// in this browser. Supabase mode never loads this file.

import { MOCK_MEMBER_SEED, mockEmail, mockUserId } from "../../data/team.js";
import { APPROVAL_ROUTES, DRAFT_FIELDS, PERMISSIONS, ROLES, permissionRisk, permissionsForRoles, roleRank } from "../../security/catalog.js";
import { stepUpFresh } from "../../security/policy.js";
import { currentMockSession, forgetMockMfaVerification, markMockMfaVerified } from "./mock-auth-repository.js";
import { mockProjectRepository } from "./mock-project-repository.js";
import { effectiveStatus } from "../mappers/team-mapper.js";
import { projectColumns } from "../../utils/change-diff.js";

const STATE_KEY = "space-admin:security:v1";
const STEP_UP_SECONDS = 600;
const DAY = 86400_000;

const nowIso = () => new Date().toISOString();
const clone = (value) => JSON.parse(JSON.stringify(value));

class MockSecurityError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const fail = (code, message = code) => {
  throw new MockSecurityError(code, message);
};

function seedState() {
  const created = "2026-09-01T12:00:00.000Z";
  const members = MOCK_MEMBER_SEED.map((seed) => ({
    userId: mockUserId(seed),
    ru: seed.ru,
    displayName: seed.displayName,
    email: mockEmail(seed),
    status: seed.status ?? "ACTIVE",
    statusReason: seed.statusReason ?? "",
    roles: [...seed.roles],
    projects: (seed.projects ?? []).map((grant) => ({ ...grant, expiresAt: null, grantedAt: created })),
    accessStartsAt: null,
    accessExpiresAt: null,
    mfaEnrolledAt: seed.mfa ? created : null,
    sessionsValidAfter: null,
    invitedBy: seed.profile === "owner" ? null : "mock-owner",
    invitedAt: created,
    inviteExpiresAt: seed.status === "INVITED" ? new Date(Date.now() + 7 * DAY).toISOString() : null,
    activatedAt: seed.status === "INVITED" ? null : created,
    lastSignInAt: seed.profile ? created : null,
    suspendedAt: seed.status === "SUSPENDED" ? created : null,
    offboardedAt: seed.status === "OFFBOARDED" ? created : null,
    createdAt: created,
  }));
  return { members, invitations: [], requests: [], audit: [], factors: {}, sequence: { ru: members.length, request: 0, audit: 0 } };
}

function read() {
  try {
    const stored = JSON.parse(localStorage.getItem(STATE_KEY) ?? "null");
    if (stored?.members) return stored;
  } catch {
    // A corrupted mock store is replaced below.
  }
  const state = seedState();
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
  return state;
}

function write(state) {
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

export function resetMockSecurity() {
  write(seedState());
}

/* ---------------------------------------------------------------- identity */

function me(state) {
  const session = currentMockSession();
  return session ? state.members.find((member) => member.userId === session.user.id) ?? null : null;
}

function active(member) {
  return Boolean(member) && effectiveStatus(member) === "ACTIVE";
}

// The mock session plays the token: one issued before the member's sessions
// were ended authorizes nothing, like the database's iat check. One from the
// same instant is refused too, as the database refuses one from the same
// second (fail closed).
function tokenCurrent(member) {
  if (!member?.sessionsValidAfter) return true;
  return (Date.parse(currentMockSession()?.issuedAt ?? "") || 0) > Date.parse(member.sessionsValidAfter);
}

// Always the signed-in member's own permissions (the current session decides),
// once the MFA the roles need is satisfied; CRITICAL ones also need a step-up,
// checked where they are used.
function permissionsOf(member) {
  return active(member) && tokenCurrent(member) && mfaSatisfied(member) ? new Set(permissionsForRoles(member.roles)) : new Set();
}

function endSessions(member) {
  member.sessionsValidAfter = nowIso();
}

// The signed-in member, refusing a session that was ended (SU013), as the
// database does before looking at any permission.
function currentMember(state) {
  const member = me(state);
  if (member && !tokenCurrent(member)) fail("SU013", "this session was ended; sign in again");
  return member;
}

const rankOf = (member) => Math.max(0, ...(member?.roles ?? []).map(roleRank));
const requiresMfa = (member) => (member?.roles ?? []).some((key) => ROLES.find((role) => role.key === key)?.requiresMfa);

function mfaMethods() {
  const verifiedAt = currentMockSession()?.mfaVerifiedAt;
  return verifiedAt ? [{ method: "totp", timestamp: Math.floor(new Date(verifiedAt).getTime() / 1000) }] : [];
}

// The factors a member holds now (auth.mfa_factors in Supabase). Seeded
// members with MFA have one until they remove it.
function factorsOf(state, member) {
  return state.factors[member?.userId] ?? (member?.mfaEnrolledAt ? [{ id: `factor-${member.userId}`, type: "totp", status: "verified", name: "Mock", createdAt: member.mfaEnrolledAt }] : []);
}

// Since when the member's current factors exist: the earliest verification
// among them (mfa_enrolment_since in the database); null without one, and a
// time it cannot read counts as never (it only refuses).
function enrolmentSince(member) {
  const times = factorsOf(read(), member)
    .filter((factor) => factor.status === "verified")
    .map((factor) => Date.parse(factor.updatedAt ?? factor.createdAt ?? ""));
  return times.length ? Math.min(...times.map((time) => (Number.isNaN(time) ? Infinity : time))) : null;
}

const hasVerifiedFactor = (member) => enrolmentSince(member) !== null;

// The session's MFA counts only if it verified the member's current factors.
// The mock session keeps its verification after a removal, as a Supabase
// token keeps aal2 until it is refreshed; one from before the factors
// enrolled since does not count, even once there is a factor again.
function sessionVerified(member) {
  const since = enrolmentSince(member);
  const verifiedAt = Date.parse(currentMockSession()?.mfaVerifiedAt ?? "");
  return Number.isFinite(since) && Number.isFinite(verifiedAt) && verifiedAt >= since;
}

const stepUpSatisfied = (member) => sessionVerified(member) && stepUpFresh(mfaMethods(), STEP_UP_SECONDS);

// The database's mfa_gate: privileged roles need a verified factor, whatever
// the session says; a member with a factor needs a session that verified it;
// CRITICAL needs a recent verification of it.
function mfaSatisfied(member, risk = "LOW") {
  const factor = hasVerifiedFactor(member);
  if (!factor && requiresMfa(member)) return false;
  if (risk === "CRITICAL") return stepUpSatisfied(member);
  return factor ? sessionVerified(member) : true;
}

function requirePermission(state, permission) {
  const member = me(state);
  if (member && !tokenCurrent(member)) fail("SU013", "this session was ended; sign in again");
  if (!permissionsOf(member).has(permission)) {
    // Granted by the roles, refused for MFA: enrol or verify first.
    if (active(member) && permissionsForRoles(member.roles).includes(permission)) fail("SU006", "MFA required");
    fail("42501", `not allowed: ${permission}`);
  }
  if (!mfaSatisfied(member, permissionRisk(permission))) fail(sessionVerified(member) ? "SU005" : "SU006", "step-up required");
  return member;
}

function audit(state, action, { resourceType = "", resourceId = "", target = null, request = null, metadata = {} } = {}) {
  const actor = me(state);
  state.sequence.audit += 1;
  state.audit.unshift({
    id: state.sequence.audit,
    createdAt: nowIso(),
    actorUserId: actor?.userId ?? null,
    actorRu: actor?.ru ?? "",
    action,
    resourceType,
    resourceId: String(resourceId ?? ""),
    targetUserId: target,
    requestId: request,
    aal: mfaMethods().length ? "aal2" : "aal1",
    metadata,
  });
}

function manageable(state, targetId) {
  const actor = me(state);
  if (targetId === actor?.userId) fail("SU009", "you cannot change your own access");
  const target = state.members.find((member) => member.userId === targetId) ?? fail("SU010", "member not found");
  if (rankOf(target) >= rankOf(actor) && !actor.roles.includes("ABSOLUTE_ADMIN")) fail("SU009", "ranked at or above you");
  if (requiresMfa(target) && !stepUpSatisfied(actor)) fail("SU005", "step-up required");
  return target;
}

function grantable(state, role) {
  const actor = me(state);
  if (!ROLES.some((item) => item.key === role)) fail("SU004", `unknown role ${role}`);
  if (roleRank(role) >= rankOf(actor) && !actor.roles.includes("ABSOLUTE_ADMIN")) fail("SU009", `cannot grant ${role}`);
  if (ROLES.find((item) => item.key === role)?.requiresMfa && !stepUpSatisfied(actor)) fail("SU005", "step-up required");
}

/* ------------------------------------------------------------------ access */

export const mockAccessRepository = {
  async myAccess() {
    const state = read();
    const member = me(state);
    if (!member) return { member: null, blocked_reason: currentMockSession() ? "NOT_MEMBER" : "UNAUTHENTICATED" };
    // An ended session learns that, and nothing about the member.
    if (!tokenCurrent(member)) return { member: null, blocked_reason: "SESSION_REVOKED", roles: [], permissions: [], projects: [], approval_routes: [] };
    const status = effectiveStatus(member);
    const enrolled = hasVerifiedFactor(member);
    const blocked =
      { OFFBOARDED: "OFFBOARDED", SUSPENDED: "SUSPENDED", EXPIRED: "EXPIRED", INVITED: "INVITED" }[status] ??
      (requiresMfa(member) && !enrolled ? "MFA_ENROLL_REQUIRED" : enrolled && !sessionVerified(member) ? "MFA_CHALLENGE_REQUIRED" : null);
    const granted = active(member) ? new Set(permissionsForRoles(member.roles)) : new Set();
    return {
      member: {
        user_id: member.userId,
        ru: member.ru,
        display_name: member.displayName,
        email: member.email,
        status: member.status,
        effective_status: status,
        access_starts_at: member.accessStartsAt,
        access_expires_at: member.accessExpiresAt,
        invite_expires_at: member.inviteExpiresAt,
        activated_at: member.activatedAt,
      },
      blocked_reason: blocked,
      roles: member.roles.map((key) => ({ key, rank: roleRank(key), requires_mfa: requiresMfa({ roles: [key] }) })),
      permissions: PERMISSIONS.filter((permission) => granted.has(permission.key)).map((permission) => ({ key: permission.key, risk: permission.risk })),
      projects: member.projects.map((grant) => ({ project_id: grant.projectId, access_level: grant.accessLevel, expires_at: grant.expiresAt })),
      approval_routes: APPROVAL_ROUTES.map((route) => ({ permission: route.permission, via: route.via })),
      mfa: {
        required: requiresMfa(member),
        enrolled,
        aal: mfaMethods().length ? "aal2" : "aal1",
        step_up: stepUpSatisfied(member),
      },
      settings: { step_up_max_age_seconds: STEP_UP_SECONDS, approval_expiry_days: 14, invitation_expiry_days: 7 },
    };
  },

  async activate() {
    const state = read();
    const member = me(state) ?? fail("42501", "not a team member");
    if (member.status === "INVITED") {
      member.status = "ACTIVE";
      member.activatedAt = nowIso();
      audit(state, "USER_ACTIVATED", { resourceType: "team_member", resourceId: member.userId, target: member.userId });
      write(state);
    }
    return this.myAccess();
  },

  async recordSignIn() {
    const state = read();
    const member = me(state);
    if (!member) return;
    member.lastSignInAt = nowIso();
    audit(state, "LOGIN_SUCCESS", { resourceType: "team_member", resourceId: member.userId, target: member.userId });
    write(state);
  },

  async recordMfaState() {
    return this.myAccess();
  },

  async revokeMySessions() {
    const state = read();
    const member = me(state);
    if (!member || !tokenCurrent(member)) return { sessions_revoked: 0 };
    endSessions(member);
    audit(state, "SESSION_REVOKED", { resourceType: "team_member", resourceId: member.userId, target: member.userId, metadata: { cause: "self" } });
    write(state);
    return { sessions_revoked: 1 };
  },

  async expireStale() {
    const state = read();
    let members = 0;
    state.members.forEach((member) => {
      if (member.status === "ACTIVE" && effectiveStatus(member) === "EXPIRED") {
        member.status = "EXPIRED";
        members += 1;
      }
    });
    write(state);
    return { members, requests: 0 };
  },

  async directory(ids) {
    const state = read();
    const wanted = new Set(ids ?? []);
    return state.members
      .filter((member) => wanted.has(member.userId))
      .map((member) => ({ user_id: member.userId, ru: member.ru, display_name: member.displayName, status: effectiveStatus(member) }));
  },

  async listFactors() {
    const state = read();
    return factorsOf(state, me(state));
  },

  // A mock TOTP: any six digits verify. The QR code encodes nothing real.
  async enrollTotp(friendlyName) {
    const state = read();
    const member = me(state) ?? fail("42501");
    const factor = { id: `factor-${member.userId}-${Date.now()}`, type: "totp", status: "unverified", name: friendlyName || "Mock", createdAt: nowIso() };
    state.factors[member.userId] = [...(await this.listFactors()).filter((item) => item.status === "verified"), factor];
    write(state);
    const qr = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="#fff"/><path d="M0 0h3v3H0zM5 0h3v3H5zM0 5h3v3H0zM4 4h1v1H4zM6 6h2v2H6z" fill="#000"/></svg>`;
    return { id: factor.id, qrCode: `data:image/svg+xml;utf8,${encodeURIComponent(qr)}`, secret: "MOCKMOCKMOCKMOCK", uri: "otpauth://totp/mock" };
  },

  async verifyFactor(factorId, code) {
    if (!/^\d{6}$/.test(String(code ?? ""))) fail("invalid_code", "Invalid code");
    const state = read();
    const member = me(state) ?? fail("42501");
    const factors = await this.listFactors();
    const factor = factors.find((item) => item.id === factorId);
    // Supabase Auth stamps updated_at when a factor becomes verified.
    if (factor && factor.status !== "verified") Object.assign(factor, { status: "verified", updatedAt: nowIso() });
    state.factors[member.userId] = factors;
    if (!member.mfaEnrolledAt) {
      member.mfaEnrolledAt = nowIso();
      audit(state, "MFA_ENROLLED", { resourceType: "team_member", resourceId: member.userId, target: member.userId });
    }
    write(state);
    markMockMfaVerified();
  },

  async unenroll(factorId) {
    const state = read();
    const member = me(state) ?? fail("42501");
    state.factors[member.userId] = (await this.listFactors()).filter((item) => item.id !== factorId);
    if (!state.factors[member.userId].some((item) => item.status === "verified")) {
      member.mfaEnrolledAt = null;
      audit(state, "MFA_REMOVED", { resourceType: "team_member", resourceId: member.userId, target: member.userId });
    }
    write(state);
  },

  // Supabase Auth downgrades a session once its factor is gone; the refreshed
  // token no longer carries the verification.
  async refreshSession() {
    const member = me(read());
    if (member && !hasVerifiedFactor(member)) forgetMockMfaVerification();
  },

  async assurance() {
    const methods = mfaMethods();
    return { currentLevel: methods.length ? "aal2" : "aal1", nextLevel: "aal2", methods };
  },

  async sessionFromLink() {},
  async setPassword() {},
  async requestPasswordReset() {},
};

/* -------------------------------------------------------------------- team */

function normalizeGrants(projects = []) {
  const seen = new Set();
  return projects.map((grant) => {
    if (!grant.projectId || seen.has(grant.projectId)) fail("SU004", "invalid project grant");
    seen.add(grant.projectId);
    return { projectId: grant.projectId, accessLevel: grant.accessLevel === "EDIT" ? "EDIT" : "VIEW", expiresAt: grant.expiresAt || null, grantedAt: nowIso() };
  });
}

export const mockTeamRepository = {
  async listMembers() {
    const state = read();
    requirePermission(state, "team.read");
    return clone(state.members).map((member) => ({ ...member, effectiveStatus: effectiveStatus(member) }));
  },

  async getMember(userId) {
    return (await this.listMembers()).find((member) => member.userId === userId) ?? null;
  },

  async listInvitations() {
    const state = read();
    requirePermission(state, "team.read");
    return clone(state.invitations);
  },

  // No email in mock mode: the member appears as INVITED straight away.
  async invite(payload) {
    const state = read();
    const actor = requirePermission(state, "team.invite");
    const email = String(payload.email ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail("SU004", "invalid email");
    if (!payload.displayName?.trim()) fail("SU004", "invalid name");
    if (!payload.roles?.length) fail("SU004", "choose a role");
    payload.roles.forEach((role) => grantable(state, role));
    if (state.members.some((member) => member.email === email)) fail("SU008", "already a member");
    state.sequence.ru += 1;
    const userId = `mock-invited-${Date.now()}`;
    const member = {
      userId,
      ru: `SU-${String(state.sequence.ru).padStart(5, "0")}`,
      displayName: payload.displayName.trim(),
      email,
      status: "INVITED",
      statusReason: "",
      roles: [...new Set(payload.roles)],
      projects: normalizeGrants(payload.projects),
      accessStartsAt: null,
      accessExpiresAt: payload.accessExpiresAt || null,
      mfaEnrolledAt: null,
      sessionsValidAfter: null,
      invitedBy: actor.userId,
      invitedAt: nowIso(),
      inviteExpiresAt: new Date(Date.now() + 7 * DAY).toISOString(),
      activatedAt: null,
      lastSignInAt: null,
      suspendedAt: null,
      offboardedAt: null,
      createdAt: nowIso(),
    };
    state.members.push(member);
    const invitation = { id: `invitation-${Date.now()}`, email, displayName: member.displayName, roles: member.roles, projectCount: member.projects.length, status: "SENT", userId, invitedBy: actor.userId, failureReason: "", createdAt: nowIso(), expiresAt: member.inviteExpiresAt };
    state.invitations.unshift(invitation);
    audit(state, "USER_INVITED", { resourceType: "team_member", resourceId: userId, target: userId, metadata: { roles: member.roles, ru: member.ru } });
    write(state);
    return { invitation_id: invitation.id, user_id: userId, ru: member.ru, status: "INVITED" };
  },

  async resend(userId) {
    const state = read();
    requirePermission(state, "team.invite");
    const member = manageable(state, userId);
    if (member.status !== "INVITED") fail("SU008", `member is ${member.status}`);
    member.inviteExpiresAt = new Date(Date.now() + 7 * DAY).toISOString();
    audit(state, "USER_INVITED", { resourceType: "team_member", resourceId: userId, target: userId, metadata: { resend: true } });
    write(state);
    return { user_id: userId, invite_expires_at: member.inviteExpiresAt };
  },

  async updateAccess(userId, { roles, projects, accessExpiresAt, displayName }) {
    const state = read();
    requirePermission(state, "team.edit_access");
    const member = manageable(state, userId);
    if (member.status === "OFFBOARDED") fail("SU008", "offboarded");
    if (!roles?.length) fail("SU004", "choose a role");
    const removed = member.roles.filter((role) => !roles.includes(role));
    const added = roles.filter((role) => !member.roles.includes(role));
    [...removed, ...added].forEach((role) => grantable(state, role));
    removed.forEach((role) => audit(state, "ROLE_REMOVED", { resourceType: "team_member", resourceId: userId, target: userId, metadata: { role } }));
    added.forEach((role) => audit(state, "ROLE_ASSIGNED", { resourceType: "team_member", resourceId: userId, target: userId, metadata: { role } }));
    member.roles = [...new Set(roles)];
    member.projects = normalizeGrants(projects);
    member.accessExpiresAt = accessExpiresAt || null;
    if (displayName?.trim()) member.displayName = displayName.trim();
    audit(state, "ACCESS_UPDATED", { resourceType: "team_member", resourceId: userId, target: userId });
    write(state);
    return { user_id: userId, roles: member.roles };
  },

  async suspend(userId, reason) {
    const state = read();
    requirePermission(state, "team.suspend");
    const member = manageable(state, userId);
    if (!reason?.trim()) fail("SU004", "a reason is required");
    if (!["ACTIVE", "INVITED", "EXPIRED"].includes(member.status)) fail("SU008", `member is ${member.status}`);
    Object.assign(member, { status: "SUSPENDED", suspendedAt: nowIso(), statusReason: reason.trim() });
    endSessions(member);
    audit(state, "USER_SUSPENDED", { resourceType: "team_member", resourceId: userId, target: userId, metadata: { reason: reason.trim() } });
    audit(state, "SESSION_REVOKED", { resourceType: "team_member", resourceId: userId, target: userId, metadata: { cause: "suspension" } });
    write(state);
    return { user_id: userId, status: "SUSPENDED", sessions_revoked: 1 };
  },

  async reactivate(userId, accessExpiresAt) {
    const state = read();
    requirePermission(state, "team.suspend");
    const member = manageable(state, userId);
    if (!["SUSPENDED", "EXPIRED"].includes(effectiveStatus(member))) fail("SU008", `member is ${member.status}`);
    const ended = member.accessExpiresAt && new Date(member.accessExpiresAt).getTime() <= Date.now();
    Object.assign(member, { status: "ACTIVE", statusReason: "", suspendedAt: null, accessExpiresAt: ended ? accessExpiresAt || null : accessExpiresAt || member.accessExpiresAt });
    audit(state, "USER_REACTIVATED", { resourceType: "team_member", resourceId: userId, target: userId });
    write(state);
    return { user_id: userId, status: "ACTIVE" };
  },

  async offboard(userId, reason) {
    const state = read();
    requirePermission(state, "team.offboard");
    const member = manageable(state, userId);
    if (!reason?.trim()) fail("SU004", "a reason is required");
    if (member.status === "OFFBOARDED") fail("SU008", "already offboarded");
    Object.assign(member, { status: "OFFBOARDED", offboardedAt: nowIso(), statusReason: reason.trim(), roles: [], projects: [] });
    endSessions(member);
    let cancelled = 0;
    state.requests.forEach((request) => {
      if (request.requesterId === userId && ["DRAFT", "PENDING"].includes(request.status)) {
        request.status = "CANCELLED";
        cancelled += 1;
      }
    });
    audit(state, "USER_OFFBOARDED", { resourceType: "team_member", resourceId: userId, target: userId, metadata: { reason: reason.trim(), requests_cancelled: cancelled } });
    audit(state, "SESSION_REVOKED", { resourceType: "team_member", resourceId: userId, target: userId, metadata: { cause: "offboarding" } });
    write(state);
    return { user_id: userId, status: "OFFBOARDED", requests_cancelled: cancelled };
  },

  async revokeSessions(userId) {
    const state = read();
    requirePermission(state, "sessions.revoke");
    endSessions(manageable(state, userId));
    audit(state, "SESSION_REVOKED", { resourceType: "team_member", resourceId: userId, target: userId, metadata: { cause: "manual" } });
    write(state);
    return { user_id: userId, sessions_revoked: 1 };
  },

  async cancelInvitation(invitationId) {
    const state = read();
    requirePermission(state, "team.invite");
    const invitation = state.invitations.find((item) => item.id === invitationId) ?? fail("SU010", "invitation not found");
    invitation.status = "CANCELLED";
    const member = state.members.find((item) => item.userId === invitation.userId && item.status === "INVITED");
    if (member) {
      Object.assign(member, { status: "OFFBOARDED", offboardedAt: nowIso(), roles: [], projects: [], statusReason: "invitation cancelled" });
      endSessions(member);
    }
    audit(state, "INVITATION_CANCELLED", { resourceType: "team_invitation", resourceId: invitationId, target: invitation.userId });
    write(state);
  },
};

/* --------------------------------------------------------------- approvals */

const versionOf = (project) => Number(project?.version) || 1;

// Draft fields arrive as database columns; the mock projects store the
// Admin's model, so the few columns a draft may change are translated here.
const COLUMN_TO_MODEL = {
  name: "name",
  client: "client",
  category: "category",
  description: "description",
  status: "status",
  year: "year",
  accent: "accent",
  tech_stack: "techStack",
  poster_url: "poster",
  project_url: "projectUrl",
  translations: "translations",
};


function visible(state, request, member) {
  const granted = permissionsOf(member);
  if (request.requesterId === member?.userId) return granted.has("approvals.read");
  return request.status !== "DRAFT" && granted.has("approvals.read_all");
}

function canDraft(member, projectId) {
  const granted = permissionsOf(member);
  if (!granted.has("projects.draft") || !granted.has("approvals.request")) return false;
  return granted.has("projects.edit") || member.projects.some((grant) => grant.projectId === projectId && grant.accessLevel === "EDIT");
}

export const mockApprovalRepository = {
  async list({ requesterId = null, statuses = null } = {}) {
    const state = read();
    const member = me(state);
    return clone(state.requests)
      .filter((request) => visible(state, request, member))
      .filter((request) => !requesterId || request.requesterId === requesterId)
      .filter((request) => !statuses?.length || statuses.includes(request.status))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  },

  async get(id) {
    const state = read();
    const request = state.requests.find((item) => item.id === id);
    return request && visible(state, request, me(state)) ? clone(request) : null;
  },

  async pendingCount() {
    return (await this.list({ statuses: ["PENDING"] })).length;
  },

  async openFor(resourceId, requesterId) {
    return (await this.list({ requesterId })).find((request) => request.resourceId === resourceId && ["DRAFT", "PENDING"].includes(request.status)) ?? null;
  },

  async saveDraft(resourceId, fields, { publish = false, message = null } = {}) {
    const state = read();
    const member = currentMember(state);
    if (!canDraft(member, resourceId)) fail("42501", "no draft access to this project");
    const unknown = Object.keys(fields ?? {}).filter((field) => !DRAFT_FIELDS.includes(field));
    if (unknown.length) fail("SU004", `field ${unknown[0]} cannot be changed by a draft`);
    if (!Object.keys(fields ?? {}).length && !publish) fail("SU004", "a draft needs at least one change");
    const project = (await mockProjectRepository.getById(resourceId)) ?? fail("SU010", "project not found");
    let request = state.requests.find((item) => item.requesterId === member.userId && item.resourceId === resourceId && ["DRAFT", "PENDING"].includes(item.status));
    if (request?.status === "PENDING") fail("SU003", "waiting for review");
    if (!request) {
      state.sequence.request += 1;
      request = { id: `request-${Date.now()}`, number: state.sequence.request, requesterId: member.userId, reviewerId: null, resourceType: "project", resourceId, baseVersion: versionOf(project), appliedChanges: null, appliedVersion: null, createdAt: nowIso(), submittedAt: null, reviewedAt: null, expiresAt: null, reviewMessage: "" };
      state.requests.unshift(request);
      audit(state, "APPROVAL_DRAFTED", { resourceType: "project", resourceId, request: request.id, metadata: { fields: Object.keys(fields) } });
    }
    Object.assign(request, {
      action: publish ? "project.publish" : "project.update",
      proposed: clone(fields),
      riskLevel: publish || project.editorialStatus === "PUBLISHED" ? "MEDIUM" : "LOW",
      status: "DRAFT",
      requestMessage: message ?? request.requestMessage ?? "",
      updatedAt: nowIso(),
    });
    write(state);
    return clone(request);
  },

  async submit(id, message = null) {
    const state = read();
    const member = currentMember(state);
    if (!permissionsOf(member).has("approvals.request")) fail("42501");
    const request = state.requests.find((item) => item.id === id && item.requesterId === member.userId) ?? fail("SU010", "request not found");
    if (request.status !== "DRAFT") fail("SU003", `request is ${request.status}`);
    Object.assign(request, { status: "PENDING", submittedAt: nowIso(), expiresAt: new Date(Date.now() + 14 * DAY).toISOString(), requestMessage: message || request.requestMessage, updatedAt: nowIso() });
    audit(state, "APPROVAL_REQUESTED", { resourceType: "project", resourceId: request.resourceId, request: id, metadata: { number: request.number } });
    write(state);
    return clone(request);
  },

  async cancel(id) {
    const state = read();
    const member = currentMember(state);
    const request = state.requests.find((item) => item.id === id && item.requesterId === member?.userId) ?? fail("SU010", "request not found");
    if (!["DRAFT", "PENDING"].includes(request.status)) fail("SU003", `request is ${request.status}`);
    Object.assign(request, { status: "CANCELLED", updatedAt: nowIso() });
    audit(state, "APPROVAL_CANCELLED", { resourceType: "project", resourceId: request.resourceId, request: id });
    write(state);
    return clone(request);
  },

  async rebase(id) {
    const state = read();
    const member = currentMember(state);
    const request = state.requests.find((item) => item.id === id && item.requesterId === member?.userId) ?? fail("SU010", "request not found");
    if (!["DRAFT", "PENDING"].includes(request.status)) fail("SU003", `request is ${request.status}`);
    const project = (await mockProjectRepository.getById(request.resourceId)) ?? fail("SU010", "project not found");
    Object.assign(request, { baseVersion: versionOf(project), status: "DRAFT", submittedAt: null, expiresAt: null, updatedAt: nowIso() });
    audit(state, "APPROVAL_REBASED", { resourceType: "project", resourceId: request.resourceId, request: id });
    write(state);
    return clone(request);
  },

  async approve(id, comment = null) {
    const state = read();
    const reviewer = requirePermission(state, "approvals.approve");
    const request = state.requests.find((item) => item.id === id) ?? fail("SU010", "request not found");
    if (request.status === "APPROVED") return { status: "APPROVED", already_applied: true, applied_version: request.appliedVersion };
    requirePermission(state, "projects.edit");
    if (request.action === "project.publish") requirePermission(state, "projects.publish");
    if (request.status !== "PENDING") fail("SU003", `request is ${request.status}`);
    if (request.requesterId === reviewer.userId) fail("SU002", "you cannot approve your own request");
    const requester = state.members.find((member) => member.userId === request.requesterId);
    if (!active(requester)) fail("SU012", "requester inactive");
    const project = (await mockProjectRepository.getById(request.resourceId)) ?? fail("SU010", "project not found");
    if (versionOf(project) !== request.baseVersion) fail("SU001", "version conflict");

    const before = projectColumns(project);
    const patch = {};
    const changes = {};
    for (const [column, value] of Object.entries(request.proposed)) {
      const field = COLUMN_TO_MODEL[column];
      if (!field) continue;
      patch[field] = field === "year" ? (value == null ? "" : String(value)) : value;
      if (JSON.stringify(before[column]) !== JSON.stringify(value)) changes[column] = { old: before[column], new: value };
    }
    if (request.action === "project.publish") {
      patch.editorialStatus = "PUBLISHED";
      patch.visible = true;
      if (project.editorialStatus !== "PUBLISHED") changes.editorial_status = { old: project.editorialStatus, new: "PUBLISHED" };
    }
    const updated = await mockProjectRepository.update(request.resourceId, patch);
    Object.assign(request, {
      status: "APPROVED",
      reviewerId: reviewer.userId,
      reviewedAt: nowIso(),
      reviewMessage: comment?.trim() || "",
      appliedChanges: changes,
      appliedVersion: versionOf(updated),
      updatedAt: nowIso(),
    });
    audit(state, request.action === "project.publish" ? "PROJECT_PUBLISHED" : "PROJECT_UPDATED", { resourceType: "project", resourceId: request.resourceId, request: id, metadata: { fields: Object.keys(changes) } });
    audit(state, "APPROVAL_APPROVED", { resourceType: "project", resourceId: request.resourceId, target: request.requesterId, request: id, metadata: { number: request.number } });
    write(state);
    return { status: "APPROVED", already_applied: false, applied_version: request.appliedVersion, changes };
  },

  async reject(id, reason) {
    const state = read();
    const reviewer = requirePermission(state, "approvals.reject");
    if (!reason?.trim()) fail("SU004", "rejecting needs a reason");
    const request = state.requests.find((item) => item.id === id) ?? fail("SU010", "request not found");
    if (request.status !== "PENDING") fail("SU003", `request is ${request.status}`);
    if (request.requesterId === reviewer.userId) fail("SU002", "you cannot review your own request");
    Object.assign(request, { status: "REJECTED", reviewerId: reviewer.userId, reviewedAt: nowIso(), reviewMessage: reason.trim(), updatedAt: nowIso() });
    audit(state, "APPROVAL_REJECTED", { resourceType: "project", resourceId: request.resourceId, target: request.requesterId, request: id, metadata: { reason: reason.trim() } });
    write(state);
    return clone(request);
  },
};

/* ------------------------------------------------------------------- audit */

export const mockAuditRepository = {
  async list({ action = null, userId = null, requestId = null, resourceId = null, before = null, limit = 100 } = {}) {
    const state = read();
    const member = me(state);
    const granted = permissionsOf(member);
    if (!granted.has("audit.read")) return [];
    return clone(state.audit)
      .filter((entry) => granted.has("audit.read_all") || entry.actorUserId === member.userId || entry.targetUserId === member.userId)
      .filter((entry) => !action || entry.action === action)
      .filter((entry) => !userId || entry.actorUserId === userId || entry.targetUserId === userId)
      .filter((entry) => !requestId || entry.requestId === requestId)
      .filter((entry) => !resourceId || entry.resourceId === resourceId)
      .filter((entry) => !before || entry.id < before)
      .slice(0, limit);
  },
};
