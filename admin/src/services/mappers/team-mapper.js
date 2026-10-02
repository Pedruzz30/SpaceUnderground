// Security rows (snake_case) to the Admin's models (camelCase): members with
// their active grants, invitations, change requests and audit entries.

import { roleRank } from "../../security/catalog.js";

const iso = (value) => (value ? String(value) : null);

// ACTIVE past its end date reads EXPIRED, as the database treats it, even
// before the expiry sweep writes the status down.
export function effectiveStatus(member, now = Date.now()) {
  if (member.status === "ACTIVE" && member.accessExpiresAt && new Date(member.accessExpiresAt).getTime() <= now) return "EXPIRED";
  return member.status;
}

export function mapMember(row, roleRows = [], projectRows = []) {
  const roles = roleRows
    .filter((grant) => grant.user_id === row.user_id && (!grant.expires_at || new Date(grant.expires_at).getTime() > Date.now()))
    .map((grant) => grant.role_key)
    .sort((a, b) => roleRank(b) - roleRank(a));
  const member = {
    userId: row.user_id,
    ru: row.ru ?? "",
    displayName: row.display_name ?? "",
    email: row.email ?? "",
    status: row.status ?? "",
    statusReason: row.status_reason ?? "",
    roles,
    projects: projectRows
      .filter((grant) => grant.user_id === row.user_id)
      .map((grant) => ({ projectId: grant.project_id, accessLevel: grant.access_level, expiresAt: iso(grant.expires_at), grantedAt: iso(grant.created_at) })),
    accessStartsAt: iso(row.access_starts_at),
    accessExpiresAt: iso(row.access_expires_at),
    mfaEnrolledAt: iso(row.mfa_enrolled_at),
    sessionsValidAfter: iso(row.sessions_valid_after),
    invitedBy: row.invited_by ?? null,
    invitedAt: iso(row.invited_at),
    inviteExpiresAt: iso(row.invite_expires_at),
    activatedAt: iso(row.activated_at),
    lastSignInAt: iso(row.last_sign_in_at),
    suspendedAt: iso(row.suspended_at),
    offboardedAt: iso(row.offboarded_at),
    createdAt: iso(row.created_at),
  };
  member.effectiveStatus = effectiveStatus(member);
  return member;
}

export function mapInvitation(row) {
  return {
    id: row.id,
    email: row.email ?? "",
    displayName: row.display_name ?? "",
    roles: row.role_keys ?? [],
    projectCount: Array.isArray(row.projects) ? row.projects.length : 0,
    status: row.status ?? "",
    userId: row.user_id ?? null,
    invitedBy: row.invited_by ?? null,
    failureReason: row.failure_reason ?? "",
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
  };
}

export function mapChangeRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    number: Number(row.number) || 0,
    requesterId: row.requester_id,
    reviewerId: row.reviewer_id ?? null,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    action: row.action,
    proposed: row.proposed ?? {},
    baseVersion: Number(row.base_version) || 0,
    appliedChanges: row.applied_changes ?? null,
    appliedVersion: row.applied_version == null ? null : Number(row.applied_version),
    riskLevel: row.risk_level ?? "LOW",
    status: row.status,
    requestMessage: row.request_message ?? "",
    reviewMessage: row.review_message ?? "",
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    submittedAt: iso(row.submitted_at),
    reviewedAt: iso(row.reviewed_at),
    expiresAt: iso(row.expires_at),
  };
}

export function mapAuditEntry(row) {
  return {
    id: Number(row.id),
    createdAt: iso(row.created_at),
    actorUserId: row.actor_user_id ?? null,
    actorRu: row.actor_ru ?? "",
    action: row.action,
    resourceType: row.resource_type ?? "",
    resourceId: row.resource_id ?? "",
    targetUserId: row.target_user_id ?? null,
    requestId: row.request_id ?? null,
    aal: row.aal ?? "",
    metadata: row.metadata ?? {},
  };
}
