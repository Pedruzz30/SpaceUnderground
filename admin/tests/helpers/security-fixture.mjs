// A Supabase-shaped database with the whole migration chain applied and one
// member of every kind the access model distinguishes, for the security tests.
//
//   owner          a row of public.admins before the security foundation, so
//                  an OWNER inside the MFA grace period, without a factor
//   partner        OWNER with a verified TOTP factor
//   absolute       ABSOLUTE_ADMIN with a verified factor (break-glass)
//   seo, manager   SEO / MANAGER with a verified factor
//   collaborator   COLLABORATOR: EDIT on the assigned project, VIEW on the
//                  published one
//   collaborator2  COLLABORATOR: EDIT on the other project only
//   viewer         VIEWER: VIEW on the assigned project
//   suspended      COLLABORATOR, SUSPENDED, still holding EDIT on assigned
//   expired        COLLABORATOR, ACTIVE but past access_expires_at
//   outsider       signed up in Supabase Auth, never a member
//
// Members are seeded with plain SQL and no JWT, like someone running the SQL
// editor; everything the tests then do goes through the API roles.

import { applyMigrations } from "./migration-files.mjs";
import { ADMIN_ID, USER_ID, asRole, createSupabaseDb, mfaClaims } from "./supabase-db.mjs";

const id = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const IDS = {
  owner: ADMIN_ID,
  outsider: USER_ID,
  partner: id(2),
  absolute: id(3),
  seo: id(4),
  manager: id(5),
  collaborator: id(6),
  collaborator2: id(7),
  viewer: id(8),
  suspended: id(9),
  expired: id(10),
};

export const PROJECTS = {
  assigned: "b0000000-0000-4000-8000-000000000001",
  other: "b0000000-0000-4000-8000-000000000002",
  published: "b0000000-0000-4000-8000-000000000003",
};

const MEMBERS = [
  { key: "partner", role: "OWNER", factor: true },
  { key: "absolute", role: "ABSOLUTE_ADMIN", factor: true },
  { key: "seo", role: "SEO", factor: true },
  { key: "manager", role: "MANAGER", factor: true },
  { key: "collaborator", role: "COLLABORATOR", projects: [["assigned", "EDIT"], ["published", "VIEW"]] },
  { key: "collaborator2", role: "COLLABORATOR", projects: [["other", "EDIT"]] },
  { key: "viewer", role: "VIEWER", projects: [["assigned", "VIEW"]] },
  { key: "suspended", role: "COLLABORATOR", status: "SUSPENDED", projects: [["assigned", "EDIT"]] },
  { key: "expired", role: "COLLABORATOR", expired: true, projects: [["assigned", "EDIT"]] },
];

export async function createSecurityDb() {
  const db = await createSupabaseDb();
  for (const key of Object.keys(IDS)) {
    if (key === "owner" || key === "outsider") continue;
    await db.query("insert into auth.users (id, email, encrypted_password) values ($1, $2, 'hash')", [IDS[key], `${key}@space.local`]);
  }
  await db.query("update auth.users set encrypted_password = 'hash' where id = $1", [IDS.owner]);
  await applyMigrations(db, { legacyAdmins: [IDS.owner] });

  await db.query(
    `insert into public.projects (id, case_number, name, slug, editorial_status, visible, description)
     values ($1, 101, 'Assigned', 'assigned', 'DRAFT', false, 'Original'),
            ($2, 102, 'Other', 'other', 'DRAFT', false, 'Other'),
            ($3, 103, 'Published', 'published', 'PUBLISHED', true, 'Live')`,
    [PROJECTS.assigned, PROJECTS.other, PROJECTS.published],
  );

  for (const member of MEMBERS) {
    const uid = IDS[member.key];
    await db.query(
      `insert into public.team_members (user_id, display_name, email, status, activated_at, access_expires_at, access_starts_at)
       values ($1, $2, $3, $4, now(), $5, $6)`,
      [
        uid,
        member.key,
        `${member.key}@space.local`,
        member.status ?? "ACTIVE",
        member.expired ? new Date(Date.now() - 3600_000) : null,
        member.expired ? new Date(Date.now() - 7 * 86400_000) : null,
      ],
    );
    await db.query("insert into public.user_roles (user_id, role_key) values ($1, $2)", [uid, member.role]);
    for (const [project, level] of member.projects ?? []) {
      await db.query("insert into public.project_members (user_id, project_id, access_level) values ($1, $2, $3)", [uid, PROJECTS[project], level]);
    }
    if (member.factor) {
      await db.query("insert into auth.mfa_factors (user_id, status) values ($1, 'verified')", [uid]);
    }
  }
  return db;
}

const now = () => Math.floor(Date.now() / 1000);

// Claims for each strength of session. "aal1" is a password-only session;
// "mfa" verified TOTP 30 s ago (fresh enough for step-up); "stale" is aal2
// but verified an hour ago.
export function sessionClaims(strength = "aal1") {
  if (strength === "mfa") return mfaClaims(30);
  if (strength === "stale") return mfaClaims(3600);
  return { aal: "aal1", amr: [{ method: "password", timestamp: now() - 60 }] };
}

// Runs one statement as a signed-in member (or anon when who is "anon").
export function as(db, who, sql, params = [], strength = "aal1", extra = {}) {
  if (who === "anon") return asRole(db, "anon", null, () => db.query(sql, params));
  if (who === "service") return asRole(db, "service_role", null, () => db.query(sql, params));
  return asRole(db, "authenticated", IDS[who], () => db.query(sql, params), { ...sessionClaims(strength), session_id: `s-${who}`, ...extra });
}

// The result of an attempt, as one word: "ok" (rows came back), "none" (the
// statement ran and touched nothing), or the SQLSTATE of the refusal
// ("42501" not allowed, "SU005" step-up, ...).
export async function outcome(promise) {
  try {
    const { rows } = await promise;
    return rows.length ? "ok" : "none";
  } catch (error) {
    return error.code ?? error.message;
  }
}

// The SQLSTATE a statement fails with, or null when it succeeds.
export async function code(promise) {
  try {
    await promise;
    return null;
  } catch (error) {
    return error.code ?? error.message;
  }
}

export async function one(promise) {
  const { rows } = await promise;
  return rows[0];
}
