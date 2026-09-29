// The access catalog: every role, every permission, what each role grants,
// which actions can be requested for approval instead of executed, and which
// project fields a draft may change.
//
// This file is the single description of the model. The database seeds the
// same rows in supabase/migrations/20260928200000_security_rbac_approval_foundation.sql
// and admin/tests/security-catalog.test.mjs fails when the two disagree. The
// database is the authority: the Admin only reads this to word the interface
// (previews, labels, which button to show), never to decide who may do what.

// Risk is the default weight of exercising a permission. It drives MFA and
// step-up in the database (CRITICAL always needs a fresh MFA verification) and
// confirmation in the interface.
export const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

// rank orders roles for anti-escalation: nobody grants, changes, suspends or
// offboards a member whose highest rank is equal to or above their own.
// requiresMfa: every permission of the role needs an aal2 session, from the
// first use (migrated accounts included; there is no grace period).
export const ROLES = [
  { key: "ABSOLUTE_ADMIN", rank: 100, requiresMfa: true },
  { key: "OWNER", rank: 80, requiresMfa: true },
  { key: "SEO", rank: 60, requiresMfa: true },
  { key: "MANAGER", rank: 60, requiresMfa: true },
  { key: "COLLABORATOR", rank: 30, requiresMfa: false },
  { key: "VIEWER", rank: 10, requiresMfa: false },
];

// Only modules that exist in the Admin. `projects.read` is every project;
// `projects.read_assigned` is the projects a member is assigned to.
export const PERMISSIONS = [
  { key: "projects.read", module: "projects", risk: "LOW" },
  { key: "projects.read_assigned", module: "projects", risk: "LOW" },
  { key: "projects.create", module: "projects", risk: "MEDIUM" },
  { key: "projects.edit", module: "projects", risk: "MEDIUM" },
  { key: "projects.draft", module: "projects", risk: "LOW" },
  { key: "projects.publish", module: "projects", risk: "MEDIUM" },
  { key: "projects.archive", module: "projects", risk: "MEDIUM" },
  { key: "projects.delete", module: "projects", risk: "HIGH" },

  { key: "files.read", module: "files", risk: "LOW" },
  { key: "files.upload", module: "files", risk: "LOW" },
  { key: "files.delete", module: "files", risk: "HIGH" },

  { key: "clients.read", module: "clients", risk: "LOW" },
  { key: "clients.create", module: "clients", risk: "MEDIUM" },
  { key: "clients.edit", module: "clients", risk: "MEDIUM" },
  { key: "clients.archive", module: "clients", risk: "MEDIUM" },
  { key: "clients.delete", module: "clients", risk: "HIGH" },

  { key: "commercial.read", module: "commercial", risk: "LOW" },
  { key: "commercial.edit", module: "commercial", risk: "MEDIUM" },
  { key: "commercial.delete", module: "commercial", risk: "HIGH" },

  { key: "services.read", module: "services", risk: "LOW" },
  { key: "services.edit", module: "services", risk: "MEDIUM" },

  { key: "cms.read", module: "cms", risk: "LOW" },
  { key: "cms.edit", module: "cms", risk: "MEDIUM" },

  { key: "seo.read", module: "seo", risk: "LOW" },
  { key: "seo.edit", module: "seo", risk: "MEDIUM" },

  { key: "finance.read", module: "finance", risk: "LOW" },
  { key: "finance.edit", module: "finance", risk: "HIGH" },
  { key: "finance.delete", module: "finance", risk: "HIGH" },

  { key: "logs.read", module: "logs", risk: "LOW" },

  { key: "settings.read", module: "settings", risk: "LOW" },
  { key: "settings.edit", module: "settings", risk: "MEDIUM" },
  { key: "data.export", module: "settings", risk: "HIGH" },

  { key: "approvals.read", module: "approvals", risk: "LOW" },
  { key: "approvals.read_all", module: "approvals", risk: "LOW" },
  { key: "approvals.request", module: "approvals", risk: "LOW" },
  { key: "approvals.approve", module: "approvals", risk: "MEDIUM" },
  { key: "approvals.reject", module: "approvals", risk: "MEDIUM" },

  { key: "team.read", module: "team", risk: "LOW" },
  { key: "team.invite", module: "team", risk: "HIGH" },
  { key: "team.edit_access", module: "team", risk: "HIGH" },
  { key: "team.suspend", module: "team", risk: "HIGH" },
  { key: "team.offboard", module: "team", risk: "HIGH" },
  { key: "sessions.revoke", module: "team", risk: "HIGH" },

  { key: "roles.read", module: "roles", risk: "LOW" },
  { key: "roles.manage", module: "roles", risk: "CRITICAL" },
  { key: "permissions.read", module: "roles", risk: "LOW" },
  { key: "permissions.manage", module: "roles", risk: "CRITICAL" },

  { key: "audit.read", module: "audit", risk: "LOW" },
  { key: "audit.read_all", module: "audit", risk: "MEDIUM" },

  { key: "security.read", module: "security", risk: "LOW" },
  { key: "security.manage", module: "security", risk: "CRITICAL" },
  { key: "critical_settings.manage", module: "security", risk: "CRITICAL" },
];

const ALL = PERMISSIONS.map((permission) => permission.key);
const ABSOLUTE_ONLY = ["roles.manage", "permissions.manage", "security.manage", "critical_settings.manage"];

const CONTENT = [
  "projects.read",
  "projects.create",
  "projects.edit",
  "projects.draft",
  "projects.publish",
  "projects.archive",
  "files.read",
  "files.upload",
  "approvals.read",
  "approvals.read_all",
  "approvals.request",
  "approvals.approve",
  "approvals.reject",
  "roles.read",
  "permissions.read",
  "audit.read",
  "logs.read",
  "settings.read",
];

// What each role grants. Default deny: a permission missing here is refused.
export const ROLE_PERMISSIONS = {
  ABSOLUTE_ADMIN: ALL,
  OWNER: ALL.filter((key) => !ABSOLUTE_ONLY.includes(key)),
  // Publishes content and search copy; no money, deals or access management.
  SEO: [
    ...CONTENT,
    "files.delete",
    "cms.read",
    "cms.edit",
    "seo.read",
    "seo.edit",
    "services.read",
    "services.edit",
    "clients.read",
  ],
  // Runs projects, clients and the pipeline; no ledger, no access management.
  MANAGER: [
    ...CONTENT,
    "clients.read",
    "clients.create",
    "clients.edit",
    "clients.archive",
    "commercial.read",
    "commercial.edit",
    "services.read",
    "cms.read",
    "seo.read",
    "team.read",
  ],
  // Assigned projects only: drafts and uploads, never publishing.
  COLLABORATOR: ["projects.read_assigned", "projects.draft", "files.read", "files.upload", "approvals.read", "approvals.request", "audit.read"],
  VIEWER: ["projects.read_assigned", "files.read", "approvals.read", "audit.read"],
};

// Actions a member without the permission may still ask for: holding the
// `via` permission (and approvals.request), the change goes to review.
export const APPROVAL_ROUTES = [
  { permission: "projects.edit", via: "projects.draft" },
  { permission: "projects.publish", via: "projects.draft" },
];

// Project columns a draft may propose. Everything structural (identity, slug,
// case number, client link, visibility, editorial status, featured, live
// preview, timestamps, version) stays out: publishing is its own flag on the
// request, and the rest is not a collaborator's call.
export const DRAFT_FIELDS = [
  "name",
  "client",
  "category",
  "description",
  "status",
  "year",
  "accent",
  "tech_stack",
  "poster_url",
  "project_url",
  "presentation_system",
  "presentation_label",
  "presentation_address",
  "presentation_type",
  "origin",
  "coordinates",
  "translations",
];

// Statuses as the database stores them.
export const MEMBER_STATUSES = ["INVITED", "ACTIVE", "SUSPENDED", "EXPIRED", "OFFBOARDED"];
export const REQUEST_STATUSES = ["DRAFT", "PENDING", "APPROVED", "REJECTED", "CANCELLED", "EXPIRED"];
export const PROJECT_ACCESS_LEVELS = ["VIEW", "EDIT"];

// i18n ids cannot contain dots: "projects.read" is worded under
// security.permissions.projects_read.
export const permissionLabelKey = (key) => `security.permissions.${String(key).replace(/\./g, "_")}`;
export const roleLabelKey = (key) => `security.roles.${String(key).toLowerCase()}`;

export function roleRank(key) {
  return ROLES.find((role) => role.key === key)?.rank ?? 0;
}

export function permissionRisk(key) {
  return PERMISSIONS.find((permission) => permission.key === key)?.risk ?? null;
}

export function permissionsForRoles(roleKeys = []) {
  return [...new Set(roleKeys.flatMap((key) => ROLE_PERMISSIONS[key] ?? []))];
}
