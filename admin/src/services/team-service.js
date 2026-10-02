import { t } from "../i18n/index.js";
import { toDataError } from "./errors.js";
import { getTeamRepository } from "./repositories/index.js";

// Team management. Every change is a security function (or the team-invite
// Edge Function) that authorizes the caller itself: rank, self-changes,
// step-up for administrative members and the audit trail all live there.

async function call(method, fallbackKey, ...args) {
  try {
    return await (await getTeamRepository())[method](...args);
  } catch (error) {
    throw toDataError(error, t(fallbackKey));
  }
}

export const listMembers = () => call("listMembers", "security.team.loadError");
export const getMember = (userId) => call("getMember", "security.team.loadError", userId);
export const listInvitations = () => call("listInvitations", "security.team.loadError");
export const inviteMember = (payload) => call("invite", "security.invite.error", payload);
export const resendInvitation = (userId) => call("resend", "security.invite.resendError", userId);
export const cancelInvitation = (invitationId) => call("cancelInvitation", "security.invite.cancelError", invitationId);
export const updateMemberAccess = (userId, access) => call("updateAccess", "security.member.saveError", userId, access);
export const suspendMember = (userId, reason) => call("suspend", "security.member.actionError", userId, reason);
export const reactivateMember = (userId, accessExpiresAt) => call("reactivate", "security.member.actionError", userId, accessExpiresAt);
export const offboardMember = (userId, reason) => call("offboard", "security.member.actionError", userId, reason);
export const revokeMemberSessions = (userId) => call("revokeSessions", "security.member.actionError", userId);
