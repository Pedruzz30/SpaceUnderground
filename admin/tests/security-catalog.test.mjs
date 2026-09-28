// The access catalog in admin/src/security/catalog.js and the one the
// security migration seeds must be the same model: the Admin words its
// interface from the first, the database decides with the second.
//
//   npm test

import { strict as assert } from "node:assert";
import { after, before, describe, it } from "node:test";
import { APPROVAL_ROUTES, DRAFT_FIELDS, PERMISSIONS, ROLES, ROLE_PERMISSIONS } from "../src/security/catalog.js";
import { readMigration } from "./helpers/migration-files.mjs";
import { createSecurityDb } from "./helpers/security-fixture.mjs";

const SQL = readMigration("security_rbac_approval_foundation");
let db;

before(async () => {
  db = await createSecurityDb();
});

after(async () => {
  await db?.close();
});

const sorted = (list) => [...list].sort();

describe("security catalog", () => {
  it("seeds the same roles, with the same rank and MFA requirement", async () => {
    const { rows } = await db.query("select key, rank, requires_mfa as \"requiresMfa\" from public.roles order by key");
    assert.deepEqual(rows, [...ROLES].sort((a, b) => a.key.localeCompare(b.key)));
  });

  it("seeds the same permissions, modules and risk levels", async () => {
    const { rows } = await db.query("select key, module, risk_level as risk from public.permissions order by key");
    assert.deepEqual(rows, [...PERMISSIONS].sort((a, b) => a.key.localeCompare(b.key)));
  });

  it("grants each role exactly the catalog's permissions", async () => {
    const { rows } = await db.query("select role_key, array_agg(permission_key order by permission_key) as keys from public.role_permissions group by role_key");
    const granted = Object.fromEntries(rows.map((row) => [row.role_key, row.keys]));
    for (const [role, keys] of Object.entries(ROLE_PERMISSIONS)) {
      assert.deepEqual(granted[role], sorted(keys), role);
    }
    assert.deepEqual(sorted(Object.keys(granted)), sorted(Object.keys(ROLE_PERMISSIONS)));
  });

  it("seeds the same approval routes", async () => {
    const { rows } = await db.query("select permission_key as permission, via_permission_key as via from public.approval_routes order by 1");
    assert.deepEqual(rows, [...APPROVAL_ROUTES].sort((a, b) => a.permission.localeCompare(b.permission)));
  });

  it("names only permissions that exist, in every grant", () => {
    const known = new Set(PERMISSIONS.map((permission) => permission.key));
    for (const [role, keys] of Object.entries(ROLE_PERMISSIONS)) {
      assert.deepEqual(keys.filter((key) => !known.has(key)), [], role);
    }
  });

  it("keeps the draft allowlist, the approval's column list and the catalog in step", () => {
    const allowlist = SQL.match(/allowed text\[\] := array\[([\s\S]*?)\];/)[1].match(/'([a-z_]+)'/g).map((item) => item.slice(1, -1));
    assert.deepEqual(sorted(allowlist), sorted(DRAFT_FIELDS));
    const applied = [...SQL.match(/update public\.projects\s+set ([\s\S]*?)editorial_status = case/)[1].matchAll(/([a-z_]+) = merged\.\1/g)].map((match) => match[1]);
    assert.deepEqual(sorted(applied), sorted(DRAFT_FIELDS));
  });

  it("gives ABSOLUTE_ADMIN alone the critical permissions", () => {
    const critical = PERMISSIONS.filter((permission) => permission.risk === "CRITICAL").map((permission) => permission.key);
    for (const [role, keys] of Object.entries(ROLE_PERMISSIONS)) {
      if (role === "ABSOLUTE_ADMIN") continue;
      assert.deepEqual(keys.filter((key) => critical.includes(key)), [], role);
    }
  });

  it("keeps collaborators and viewers away from money, people, settings and security", () => {
    const forbidden = /^(finance|commercial|clients|team|sessions|roles|permissions|security|critical_settings|settings|data|logs)\./;
    for (const role of ["COLLABORATOR", "VIEWER"]) {
      assert.deepEqual(ROLE_PERMISSIONS[role].filter((key) => forbidden.test(key)), [], role);
      assert.ok(!ROLE_PERMISSIONS[role].includes("projects.read"), `${role} sees assigned projects only`);
      assert.ok(!ROLE_PERMISSIONS[role].includes("projects.publish"), `${role} never publishes`);
    }
  });
});
