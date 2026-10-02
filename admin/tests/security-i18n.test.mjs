// The security screens build many keys at runtime (a role, a permission, a
// status, an audit action), which the literal-key scanner cannot see. This
// checks every one of those families, and every "security." key written
// anywhere in the Admin, in both locales.
//
//   npm test

import { strict as assert } from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { SUPPORTED_LOCALES, hasKey } from "../src/i18n/index.js";
import { DRAFT_FIELDS, MEMBER_STATUSES, PERMISSIONS, REQUEST_STATUSES, RISK_LEVELS, ROLES, permissionLabelKey, roleLabelKey } from "../src/security/catalog.js";
import { readMigration } from "./helpers/migration-files.mjs";

const SQL = readMigration("security_rbac_approval_foundation");
const AUDIT_ACTIONS = SQL.match(/if p_action not in \(([\s\S]*?)\) then/)[1].match(/'([A-Z_]+)'/g).map((item) => item.slice(1, -1));

const missing = (keys) => SUPPORTED_LOCALES.flatMap((locale) => keys.filter((key) => !hasKey(key, locale)).map((key) => `${locale}: ${key}`));

describe("security i18n", () => {
  it("names every role and permission of the catalog", () => {
    assert.deepEqual(missing(ROLES.map((role) => roleLabelKey(role.key))), []);
    assert.deepEqual(missing(PERMISSIONS.map((permission) => permissionLabelKey(permission.key))), []);
  });

  it("names every status, risk and MFA state", () => {
    assert.deepEqual(missing(MEMBER_STATUSES.map((status) => `security.status.${status.toLowerCase()}`)), []);
    assert.deepEqual(missing(REQUEST_STATUSES.map((status) => `security.requestStatus.${status.toLowerCase()}`)), []);
    assert.deepEqual(missing(RISK_LEVELS.map((risk) => `security.risk.${risk.toLowerCase()}`)), []);
    assert.deepEqual(missing(["enabled", "required", "optional"].map((state) => `security.mfaState.${state}`)), []);
  });

  it("names every draft field and every module a permission belongs to", () => {
    assert.deepEqual(missing([...DRAFT_FIELDS, "editorial_status"].map((field) => `security.fields.${field}`)), []);
    assert.deepEqual(missing([...new Set(PERMISSIONS.map((permission) => permission.module))].map((module) => `security.modules.${module}`)), []);
  });

  it("names every action the audit log can record", () => {
    assert.ok(AUDIT_ACTIONS.length >= 30);
    assert.deepEqual(missing(AUDIT_ACTIONS.map((action) => `security.auditActions.${action}`)), []);
  });

  it("has every security key the Admin writes down", () => {
    const root = fileURLToPath(new URL("../src/", import.meta.url));
    const keys = new Set();
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (name.endsWith(".js")) {
          for (const match of readFileSync(path, "utf8").matchAll(/["'`]((?:security|errors\.security|login\.profiles|nav)\.[A-Za-z0-9_.]+)["'`]/g)) {
            if (!match[1].endsWith(".")) keys.add(match[1]);
          }
        }
      }
    };
    walk(root);
    // Permission keys (security.read, security.manage) are not copy.
    PERMISSIONS.forEach((permission) => keys.delete(permission.key));
    // Plural families are written without their .one / .other leaf.
    const leaves = [...keys].flatMap((key) => (hasKey(`${key}.one`, "pt-BR") ? [`${key}.one`, `${key}.other`] : [key]));
    assert.deepEqual(missing(leaves), []);
  });
});
