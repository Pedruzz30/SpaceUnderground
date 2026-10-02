// Pure helpers for the Team screens: filters, the MFA state a row shows, which
// roles the signed-in member may hand out, and the "can / cannot" preview of
// an invitation. They mirror the database's rules to offer the right choices;
// the database checks every one of them again.

import { PERMISSIONS, ROLES, permissionsForRoles, roleRank } from "../security/catalog.js";
import { highestRank, hasRole } from "../security/access.js";

export const MEMBER_FILTERS = ["ALL", "ACTIVE", "INVITED", "SUSPENDED", "EXPIRED", "OFFBOARDED"];

const normalize = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

export function filterMembers(members = [], filter = "ALL", query = "") {
  const needle = normalize(query).trim();
  return members.filter((member) => {
    if (filter !== "ALL" && member.effectiveStatus !== filter) return false;
    if (!needle) return true;
    return [member.displayName, member.email, member.ru, ...(member.roles ?? [])].some((value) => normalize(value).includes(needle));
  });
}

export function countByStatus(members = []) {
  const counts = Object.fromEntries(MEMBER_FILTERS.map((filter) => [filter, 0]));
  counts.ALL = members.length;
  members.forEach((member) => {
    if (counts[member.effectiveStatus] !== undefined) counts[member.effectiveStatus] += 1;
  });
  return counts;
}

const requiresMfa = (roles = []) => roles.some((key) => ROLES.find((role) => role.key === key)?.requiresMfa);

// enabled: a verified factor on record; required: privileged without MFA
// (they hold nothing until they enable it, migrated accounts included);
// optional: MFA is not required for these roles.
export function mfaState(member) {
  if (member.mfaEnrolledAt) return "enabled";
  return requiresMfa(member.roles) ? "required" : "optional";
}

export function memberRank(member) {
  return Math.max(0, ...(member.roles ?? []).map(roleRank));
}

// The rank rule, as the database applies it: never yourself, never someone
// ranked at or above you, unless you are ABSOLUTE_ADMIN.
export function canManage(member, access) {
  if (!member || !access?.member || member.userId === access.member.userId) return false;
  if (hasRole("ABSOLUTE_ADMIN", access)) return true;
  return memberRank(member) < highestRank(access);
}

export function grantableRoles(access) {
  const absolute = hasRole("ABSOLUTE_ADMIN", access);
  const rank = highestRank(access);
  return ROLES.filter((role) => absolute || role.rank < rank).map((role) => role.key);
}

// Administrative roles (approval powers, MFA required): granting one is
// CRITICAL, so the database asks for a fresh MFA verification.
export function isAdministrativeRole(key) {
  return Boolean(ROLES.find((role) => role.key === key)?.requiresMfa);
}

// Modules a role set reaches, and the sensitive ones it does not.
const SENSITIVE_MODULES = ["finance", "commercial", "clients", "team", "roles", "security", "settings", "logs", "audit"];

export function accessPreview(roles = []) {
  const granted = new Set(permissionsForRoles(roles));
  const permissions = PERMISSIONS.filter((permission) => granted.has(permission.key));
  const modules = [...new Set(permissions.map((permission) => permission.module))];
  const blocked = SENSITIVE_MODULES.filter((module) => !modules.includes(module));
  return { permissions: permissions.map((permission) => permission.key), modules, blocked };
}

export function isExpiringSoon(value, days = 7, now = Date.now()) {
  if (!value) return false;
  const time = new Date(value).getTime();
  return time > now && time - now <= days * 86400_000;
}
