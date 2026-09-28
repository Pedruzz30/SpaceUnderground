// What the signed-in member may do, as the database described it the last time
// it was asked (public.my_access()). The Admin uses this to choose what to show
// and which button to offer. It is never what protects anything: row level
// security and the security functions decide every request on their own, and
// a page edited in DevTools still gets nothing the database refuses.
//
// One snapshot per session, replaced whenever the database is asked again.

import { PERMISSIONS, permissionRisk, permissionsForRoles } from "./catalog.js";

let snapshot = null;

const iso = (value) => (value ? String(value) : null);

// Snake case from the RPC, camel case for the Admin. Unknown permission keys
// are dropped: the catalog is what the interface knows how to word.
export function normalizeAccess(raw, source = "rbac") {
  if (!raw || typeof raw !== "object") return null;
  const known = new Set(PERMISSIONS.map((permission) => permission.key));
  const member = raw.member
    ? {
        userId: raw.member.user_id,
        ru: raw.member.ru ?? "",
        displayName: raw.member.display_name ?? "",
        email: raw.member.email ?? "",
        status: raw.member.status ?? "",
        effectiveStatus: raw.member.effective_status ?? raw.member.status ?? "",
        accessStartsAt: iso(raw.member.access_starts_at),
        accessExpiresAt: iso(raw.member.access_expires_at),
        inviteExpiresAt: iso(raw.member.invite_expires_at),
        activatedAt: iso(raw.member.activated_at),
      }
    : null;
  return {
    source,
    member,
    blockedReason: raw.blocked_reason ?? null,
    roles: (raw.roles ?? []).map((role) => ({ key: role.key, rank: Number(role.rank) || 0, requiresMfa: Boolean(role.requires_mfa) })),
    permissions: new Set((raw.permissions ?? []).map((permission) => permission.key ?? permission).filter((key) => known.has(key))),
    projects: (raw.projects ?? []).map((grant) => ({
      projectId: grant.project_id,
      accessLevel: grant.access_level === "EDIT" ? "EDIT" : "VIEW",
      expiresAt: iso(grant.expires_at),
    })),
    approvalRoutes: (raw.approval_routes ?? []).map((route) => ({ permission: route.permission, via: route.via })),
    mfa: {
      required: Boolean(raw.mfa?.required),
      enrolled: Boolean(raw.mfa?.enrolled),
      aal: raw.mfa?.aal ?? "aal1",
      graceUntil: iso(raw.mfa?.grace_until),
      stepUp: Boolean(raw.mfa?.step_up),
    },
    settings: {
      stepUpMaxAgeSeconds: Number(raw.settings?.step_up_max_age_seconds) || 600,
      approvalExpiryDays: Number(raw.settings?.approval_expiry_days) || 14,
      invitationExpiryDays: Number(raw.settings?.invitation_expiry_days) || 7,
    },
  };
}

// Before the security migration is applied, the database still grants every
// row of public.admins everything. The Admin mirrors that (an OWNER's view),
// marks it as legacy, and keeps the Team, Approvals and Audit modules closed,
// since their tables do not exist yet.
export function legacyAccess(session) {
  if (!session?.isAdmin) return null;
  const keys = permissionsForRoles(["OWNER"]);
  return {
    source: "legacy",
    member: {
      userId: session.user?.id ?? null,
      ru: "",
      displayName: session.user?.email ?? "",
      email: session.user?.email ?? "",
      status: "ACTIVE",
      effectiveStatus: "ACTIVE",
      accessStartsAt: null,
      accessExpiresAt: null,
      inviteExpiresAt: null,
      activatedAt: null,
    },
    blockedReason: null,
    roles: [{ key: "OWNER", rank: 80, requiresMfa: true }],
    permissions: new Set(keys),
    projects: [],
    approvalRoutes: [],
    mfa: { required: false, enrolled: false, aal: "aal1", graceUntil: null, stepUp: false },
    settings: { stepUpMaxAgeSeconds: 600, approvalExpiryDays: 14, invitationExpiryDays: 7 },
  };
}

export function setAccess(next) {
  snapshot = next ?? null;
}

export function getAccess() {
  return snapshot;
}

export function clearAccess() {
  snapshot = null;
}

// The security modules exist only once the migration is applied.
export function isSecurityModelActive(access = snapshot) {
  return access?.source === "rbac" || access?.source === "mock";
}

export function hasPermission(permission, access = snapshot) {
  return Boolean(access && !access.blockedReason && access.permissions.has(permission));
}

export function hasAnyPermission(permissions = [], access = snapshot) {
  return permissions.some((permission) => hasPermission(permission, access));
}

export function hasRole(role, access = snapshot) {
  return Boolean(access && !access.blockedReason && access.roles.some((item) => item.key === role));
}

export function highestRank(access = snapshot) {
  return (access?.roles ?? []).reduce((max, role) => Math.max(max, role.rank), 0);
}

function activeGrant(grant, now) {
  return !grant.expiresAt || new Date(grant.expiresAt).getTime() > now;
}

// Every project (projects.read / projects.edit), or an assigned one with the
// right level (projects.read_assigned / projects.draft plus the membership).
export function hasProjectAccess(projectId, { write = false, access = snapshot, now = Date.now() } = {}) {
  if (!access || access.blockedReason) return false;
  if (hasPermission(write ? "projects.edit" : "projects.read", access)) return true;
  if (!projectId || !hasPermission(write ? "projects.draft" : "projects.read_assigned", access)) return false;
  return access.projects.some(
    (grant) => grant.projectId === projectId && activeGrant(grant, now) && (!write || grant.accessLevel === "EDIT"),
  );
}

export function assignedProjectIds(access = snapshot, now = Date.now()) {
  return new Set((access?.projects ?? []).filter((grant) => activeGrant(grant, now)).map((grant) => grant.projectId));
}

// Whether an action the member cannot execute may be asked for instead.
export function requiresApproval(permission, { projectId = null, access = snapshot } = {}) {
  if (!access || access.blockedReason || hasPermission(permission, access)) return false;
  if (!hasPermission("approvals.request", access)) return false;
  const route = access.approvalRoutes.find((item) => item.permission === permission);
  if (!route || !hasPermission(route.via, access)) return false;
  return projectId ? hasProjectAccess(projectId, { write: true, access }) : true;
}

export function getRiskLevel(permission) {
  return permissionRisk(permission);
}

// The one question pages ask. With a project, project permissions also need
// that project to be reachable.
export function can(permission, { projectId = null, access = snapshot } = {}) {
  if (!hasPermission(permission, access)) {
    if (projectId && (permission === "projects.read" || permission === "projects.edit")) {
      return hasProjectAccess(projectId, { write: permission === "projects.edit", access });
    }
    return false;
  }
  return true;
}
