// Migrations are named YYYYMMDDHHMMSS_<name>.sql, the Supabase CLI format: the
// timestamp is the migration's identity and the rest says what it does. Some
// names keep the old ordinal for auditability (20260909062014_001_admin_foundation).
//
// Tests refer to a migration by its purpose, never by its version, so giving a
// migration a different timestamp never has to touch the tests that exercise it.
// admin/tests/migration-chain.test.mjs is the one place that pins versions.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const MIGRATIONS_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));

export function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// "business_workflows" -> "20260914025524_011_business_workflows.sql". Exactly
// one file must match: zero means it was removed, two means it was duplicated.
export function migrationFile(purpose) {
  const pattern = new RegExp(`^\\d{14}_(?:\\d{3}_)?${escape(purpose)}\\.sql$`);
  const matches = migrationFiles().filter((name) => pattern.test(name));
  if (matches.length !== 1) {
    throw new Error(`expected exactly one migration for "${purpose}", found ${matches.length}: ${matches.join(", ") || "none"}`);
  }
  return matches[0];
}

export function migrationPath(purpose) {
  return `${MIGRATIONS_DIR}${migrationFile(purpose)}`;
}

export function readMigration(purpose) {
  return readFileSync(migrationPath(purpose), "utf8");
}

// Applies every migration in order, the way production ran them. before maps
// a file name to a callback run just before that file (rows that must exist
// when a backfill runs). legacyAdmins are rows of public.admins from before
// the security foundation, which turns each one into an OWNER, exactly as it
// does in production; they must already exist in auth.users.
export async function applyMigrations(db, { legacyAdmins = [], before = {} } = {}) {
  const security = migrationFile("security_rbac_approval_foundation");
  for (const name of migrationFiles()) {
    if (before[name]) await before[name]();
    if (name === security) {
      for (const id of legacyAdmins) {
        await db.query("insert into public.admins (user_id, role) values ($1, 'owner') on conflict (user_id) do nothing", [id]);
      }
    }
    await db.exec(readFileSync(`${MIGRATIONS_DIR}${name}`, "utf8"));
  }
}
