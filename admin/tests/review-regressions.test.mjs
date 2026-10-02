// Regression locks for PR review findings: keep the UI and database contract aligned.
//
//   npm test

import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

describe("PR review regressions", () => {
  it("routes project creation before the generic project detail route", async () => {
    const source = await read("src/router/router.js");
    const create = source.indexOf('route === "/projects/new"');
    const detail = source.indexOf('/^\\/projects\\/[^/]+$/');
    assert.ok(create >= 0 && detail > create);
    assert.match(source.slice(create, detail), /projects\.create/);
  });

  it("gates client creation with clients.create and edits with clients.edit", async () => {
    const source = await read("src/pages/client-detail.js");
    assert.ok(source.includes('data-client-save data-requires="${isCreate ? "clients.create" : "clients.edit"}"'));
  });

  it("keeps the Admin MFA contract TOTP-only end to end", async () => {
    const migration = await read("../supabase/migrations/20261002033705_security_rbac_approval_foundation.sql");
    const policy = await read("src/security/policy.js");
    assert.match(migration, /f\.factor_type::text = 'totp'/);
    assert.match(migration, /when 'totp' then 'totp'/);
    assert.doesNotMatch(migration.match(/create or replace function public\.mfa_method[\s\S]*?\$\$;/)?.[0] ?? "", /mfa\/phone|mfa\/webauthn/);
    assert.match(policy, /MFA_METHODS = \["totp"\]/);
  });
});