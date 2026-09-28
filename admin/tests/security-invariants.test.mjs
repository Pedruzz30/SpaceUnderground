// The twenty security invariants of the access model, each tried the way an
// attacker would: straight against the database, through the API roles, with
// whatever the client can put in a request. The Admin's interface is not
// involved; if one of these passes, it holds however the Admin is modified.
//
//   npm test

import { strict as assert } from "node:assert";
import { after, before, describe, it } from "node:test";
import { IDS, PROJECTS, as, code, createSecurityDb, one, outcome } from "./helpers/security-fixture.mjs";

let db;

before(async () => {
  db = await createSecurityDb();
});

after(async () => {
  await db?.close();
});

const projectRow = async (id) => one(db.query("select * from public.projects where id = $1", [id]));

// A draft from the collaborator on the assigned project, submitted for review.
async function pendingRequest(fields = { description: "Proposed" }, publish = false, who = "collaborator", project = PROJECTS.assigned, strength = "aal1") {
  const draft = await one(as(db, who, "select * from public.save_project_draft($1, $2::jsonb, $3)", [project, JSON.stringify(fields), publish], strength));
  return one(as(db, who, "select * from public.submit_change_request($1)", [draft.id], strength));
}

describe("security invariants", () => {
  it("1. an anonymous visitor reads only what the public site publishes", async () => {
    const rows = (await as(db, "anon", "select id from public.projects order by case_number")).rows.map((row) => row.id);
    assert.deepEqual(rows, [PROJECTS.published], "drafts stay hidden");
    for (const table of ["team_members", "user_roles", "change_requests", "security_audit_log", "project_members", "team_invitations"]) {
      assert.equal(await outcome(as(db, "anon", `select * from public.${table}`)), "42501", `anon reads ${table}`);
    }
    assert.equal(await code(as(db, "anon", "select public.my_access()")), "42501");
  });

  it("2. a collaborator cannot read a project they are not assigned to", async () => {
    assert.equal(await outcome(as(db, "collaborator", "select id from public.projects where id = $1", [PROJECTS.other])), "none");
    assert.equal(await outcome(as(db, "collaborator", "select id from public.projects where id = $1", [PROJECTS.assigned])), "ok");
    const visible = (await as(db, "collaborator", "select id from public.projects order by case_number")).rows.map((row) => row.id);
    assert.deepEqual(visible, [PROJECTS.assigned, PROJECTS.published]);
  });

  it("3. a collaborator cannot publish directly", async () => {
    assert.equal(
      await outcome(as(db, "collaborator", "update public.projects set editorial_status = 'PUBLISHED', visible = true where id = $1 returning id", [PROJECTS.assigned])),
      "none",
    );
    assert.equal(await outcome(as(db, "collaborator", "update public.projects set description = 'Direct' where id = $1 returning id", [PROJECTS.assigned])), "none");
    assert.equal((await projectRow(PROJECTS.assigned)).editorial_status, "DRAFT");
    assert.equal((await projectRow(PROJECTS.assigned)).description, "Original");
  });

  it("4. a collaborator can save a draft, which changes nothing live", async () => {
    const before = await projectRow(PROJECTS.assigned);
    const draft = await one(as(db, "collaborator", "select * from public.save_project_draft($1, $2::jsonb)", [PROJECTS.assigned, JSON.stringify({ name: "Renamed" })]));
    assert.equal(draft.status, "DRAFT");
    assert.equal(draft.base_version, before.version);
    const again = await one(as(db, "collaborator", "select * from public.save_project_draft($1, $2::jsonb)", [PROJECTS.assigned, JSON.stringify({ name: "Renamed twice" })]));
    assert.equal(again.id, draft.id, "saving again updates the same draft");
    const afterSave = await projectRow(PROJECTS.assigned);
    assert.equal(afterSave.name, "Assigned");
    assert.equal(afterSave.version, before.version);
    await as(db, "collaborator", "select public.cancel_change_request($1)", [draft.id]);
  });

  it("5. a collaborator can ask for approval", async () => {
    const request = await pendingRequest();
    assert.equal(request.status, "PENDING");
    assert.ok(request.expires_at, "a pending request has a deadline");
    await as(db, "collaborator", "select public.cancel_change_request($1)", [request.id]);
  });

  it("6. nobody approves their own request", async () => {
    const request = await pendingRequest();
    assert.equal(await code(as(db, "collaborator", "select public.approve_change_request($1)", [request.id])), "42501", "collaborators cannot approve at all");
    await as(db, "collaborator", "select public.cancel_change_request($1)", [request.id]);

    // A reviewer who drafts is still not their own reviewer.
    const own = await pendingRequest({ description: "SEO draft" }, false, "seo", PROJECTS.other, "mfa");
    assert.equal(await code(as(db, "seo", "select public.approve_change_request($1)", [own.id], "mfa")), "SU002");
    assert.equal(await code(as(db, "seo", "select public.reject_change_request($1, 'no')", [own.id], "mfa")), "SU002");
    await as(db, "seo", "select public.cancel_change_request($1)", [own.id], "mfa");
  });

  it("7. a collaborator cannot touch roles or grants", async () => {
    for (const sql of [
      "insert into public.user_roles (user_id, role_key) values ($1, 'OWNER')",
      "update public.user_roles set role_key = 'OWNER' where user_id = $1",
      "delete from public.user_roles where user_id = $1",
      "insert into public.role_permissions (role_key, permission_key) select 'COLLABORATOR', 'finance.read' where $1::uuid is not null",
      "insert into public.project_members (user_id, project_id) values ($1, 'b0000000-0000-4000-8000-000000000002')",
    ]) {
      assert.equal(await code(as(db, "collaborator", sql, [IDS.collaborator])), "42501", sql);
    }
  });

  it("8. a collaborator cannot promote themselves", async () => {
    assert.equal(
      await code(as(db, "collaborator", "select public.update_member_access($1, array['OWNER'], '[]'::jsonb, null)", [IDS.collaborator])),
      "42501",
    );
    assert.equal(await code(as(db, "collaborator", "update public.team_members set status = 'ACTIVE', access_expires_at = null where user_id = $1", [IDS.collaborator])), "42501");
    assert.equal(await code(as(db, "collaborator", "select public.bootstrap_member('collaborator@space.local', 'ABSOLUTE_ADMIN')")), "42501");
    assert.equal(await code(as(db, "collaborator", "select public.set_role_permission('COLLABORATOR', 'finance.read', true)")), "42501");
    const roles = (await db.query("select role_key from public.user_roles where user_id = $1 and revoked_at is null", [IDS.collaborator])).rows;
    assert.deepEqual(roles, [{ role_key: "COLLABORATOR" }]);
  });

  it("9. a collaborator cannot read finance", async () => {
    await db.query(
      "insert into public.financial_transactions (type, category, description, amount, due_date, status) values ('INCOME', 'PROJECT', 'Fee', 10, current_date, 'PENDING')",
    );
    assert.equal(await outcome(as(db, "collaborator", "select id from public.financial_transactions")), "none");
    assert.equal(await outcome(as(db, "collaborator", "select id from public.clients")), "none");
    assert.equal(await outcome(as(db, "collaborator", "select id from public.commercial_opportunities")), "none");
    assert.equal(
      await code(as(db, "collaborator", "insert into public.financial_transactions (type, category, description, amount, due_date, status) values ('INCOME', 'PROJECT', 'x', 1, current_date, 'PENDING')")),
      "42501",
    );
  });

  it("10. an authorized SEO publishes a normal change", async () => {
    assert.equal(
      await outcome(as(db, "seo", "update public.projects set editorial_status = 'PUBLISHED', visible = true where id = $1 returning id", [PROJECTS.other], "mfa")),
      "ok",
    );
    assert.equal((await projectRow(PROJECTS.other)).editorial_status, "PUBLISHED");
    await db.query("update public.projects set editorial_status = 'DRAFT', visible = false where id = $1", [PROJECTS.other]);
  });

  it("11. a suspended member's token still valid for Supabase authorizes nothing", async () => {
    assert.equal(await outcome(as(db, "suspended", "select id from public.projects where id = $1", [PROJECTS.assigned])), "none");
    assert.equal(await code(as(db, "suspended", "select public.save_project_draft($1, '{\"name\":\"x\"}'::jsonb)", [PROJECTS.assigned])), "42501");
    assert.equal((await one(as(db, "suspended", "select public.my_access() as access"))).access.blocked_reason, "SUSPENDED");
  });

  it("12. an expired member authorizes nothing", async () => {
    assert.equal(await outcome(as(db, "expired", "select id from public.projects where id = $1", [PROJECTS.assigned])), "none");
    assert.equal(await code(as(db, "expired", "select public.save_project_draft($1, '{\"name\":\"x\"}'::jsonb)", [PROJECTS.assigned])), "42501");
    const access = (await one(as(db, "expired", "select public.my_access() as access"))).access;
    assert.equal(access.blocked_reason, "EXPIRED");
    assert.deepEqual(access.permissions, []);
  });

  it("13. without a project membership, calling the API directly gets nothing", async () => {
    assert.equal(await outcome(as(db, "collaborator2", "select id from public.projects where id = $1", [PROJECTS.assigned])), "none");
    assert.equal(await outcome(as(db, "collaborator2", "select id from public.project_gallery where project_id = $1", [PROJECTS.assigned])), "none");
    assert.equal(await code(as(db, "collaborator2", "select public.save_project_draft($1, '{\"name\":\"x\"}'::jsonb)", [PROJECTS.assigned])), "42501");
    assert.equal(
      await code(as(db, "collaborator2", "insert into storage.objects (bucket_id, name) values ('project-media', $1)", [`projects/${PROJECTS.assigned}/poster/x.png`])),
      "42501",
    );
  });

  it("14. nobody updates the audit log, not even the database owner", async () => {
    assert.equal(await code(as(db, "owner", "update public.security_audit_log set action = 'LOGIN_SUCCESS'")), "42501");
    assert.equal(await code(as(db, "absolute", "update public.security_audit_log set metadata = '{}'::jsonb", [], "mfa")), "42501");
    assert.equal(await code(as(db, "service", "update public.security_audit_log set metadata = '{}'::jsonb")), "42501");
    assert.equal(await code(db.query("update public.security_audit_log set metadata = '{}'::jsonb")), "42501");
  });

  it("15. nobody deletes or truncates the audit log", async () => {
    const count = Number((await one(db.query("select count(*) from public.security_audit_log"))).count);
    assert.ok(count > 0);
    assert.equal(await code(as(db, "owner", "delete from public.security_audit_log")), "42501");
    assert.equal(await code(as(db, "service", "delete from public.security_audit_log")), "42501");
    assert.equal(await code(db.query("delete from public.security_audit_log")), "42501");
    assert.equal(await code(db.query("truncate public.security_audit_log")), "42501");
    assert.equal(Number((await one(db.query("select count(*) from public.security_audit_log"))).count), count);
  });

  it("16. showing Finance in a modified Admin changes nothing: the database still refuses", async () => {
    // Whatever the page renders, the request it sends carries the same identity.
    for (const who of ["collaborator", "viewer", "seo"]) {
      assert.equal(await outcome(as(db, who, "select id from public.financial_transactions", [], "mfa")), "none", who);
    }
  });

  it("17. claiming a role in the token or its metadata is ignored", async () => {
    const forged = { user_role: "ABSOLUTE_ADMIN", app_metadata: { role: "ABSOLUTE_ADMIN" }, user_metadata: { role: "absolute_admin" }, aal: "aal2" };
    assert.equal(await outcome(as(db, "collaborator", "select id from public.financial_transactions", [], "aal1", forged)), "none");
    assert.equal(await outcome(as(db, "collaborator", "select id from public.projects where id = $1", [PROJECTS.other], "aal1", forged)), "none");
    const access = (await one(as(db, "collaborator", "select public.my_access() as access", [], "aal1", forged))).access;
    assert.deepEqual(access.roles.map((role) => role.key), ["COLLABORATOR"]);
    assert.ok(!access.permissions.some((permission) => permission.key === "finance.read"));
  });

  it("18. an approval run twice applies once", async () => {
    const request = await pendingRequest({ description: "Approved once" });
    const first = (await one(as(db, "seo", "select public.approve_change_request($1) as result", [request.id], "mfa"))).result;
    const second = (await one(as(db, "manager", "select public.approve_change_request($1) as result", [request.id], "mfa"))).result;
    assert.equal(first.already_applied, false);
    assert.equal(second.already_applied, true);
    assert.equal(second.applied_version, first.applied_version);
    assert.equal((await projectRow(PROJECTS.assigned)).version, first.applied_version, "the project moved one version");
    const approvals = await one(db.query("select count(*) from public.security_audit_log where action = 'APPROVAL_APPROVED' and request_id = $1", [request.id]));
    assert.equal(Number(approvals.count), 1);
    const reviewer = await one(db.query("select reviewer_id from public.change_requests where id = $1", [request.id]));
    assert.equal(reviewer.reviewer_id, IDS.seo, "the first reviewer stays on record");
  });

  it("19. a draft based on an older version conflicts instead of overwriting", async () => {
    const request = await pendingRequest({ description: "Stale proposal" });
    await as(db, "seo", "update public.projects set description = 'Edited meanwhile' where id = $1", [PROJECTS.assigned], "mfa");
    assert.equal(await code(as(db, "seo", "select public.approve_change_request($1)", [request.id], "mfa")), "SU001");
    assert.equal((await projectRow(PROJECTS.assigned)).description, "Edited meanwhile");
    assert.equal((await one(db.query("select status from public.change_requests where id = $1", [request.id]))).status, "PENDING");
    await as(db, "collaborator", "select public.cancel_change_request($1)", [request.id]);
  });

  it("20. a critical action without a fresh MFA verification is refused", async () => {
    const grant = "select public.set_role_permission('VIEWER', 'logs.read', true)";
    assert.equal(await code(as(db, "absolute", grant, [], "aal1")), "SU006", "an enrolled admin on a password-only session must finish MFA");
    assert.equal(await code(as(db, "absolute", grant, [], "stale")), "SU005", "aal2 from an hour ago is not step-up");
    assert.equal(await code(as(db, "owner", grant, [], "mfa")), "42501", "owners do not manage permissions");
    assert.equal(await code(as(db, "absolute", grant, [], "mfa")), null);
    await as(db, "absolute", "select public.set_role_permission('VIEWER', 'logs.read', false)", [], "mfa");
  });
});
