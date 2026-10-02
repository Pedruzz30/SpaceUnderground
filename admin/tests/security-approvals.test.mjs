// Drafts, review and publication, plus the field-level guards that keep a
// permission from being stretched: publishing through an edit, archiving
// through an update, the SEO copy through the settings form.
//
//   npm test

import { strict as assert } from "node:assert";
import { after, before, describe, it } from "node:test";
import { IDS, PROJECTS, as, code, createSecurityDb, defaultStrength, one, outcome } from "./helpers/security-fixture.mjs";

let db;

before(async () => {
  db = await createSecurityDb();
});

after(async () => {
  await db?.close();
});

const project = (id) => one(db.query("select * from public.projects where id = $1", [id]));
const request = (id) => one(db.query("select * from public.change_requests where id = $1", [id]));

async function draft(fields, { who = "collaborator", target = PROJECTS.assigned, publish = false, strength = defaultStrength(who) } = {}) {
  return one(as(db, who, "select * from public.save_project_draft($1, $2::jsonb, $3)", [target, JSON.stringify(fields), publish], strength));
}

async function submitted(fields, options = {}) {
  const saved = await draft(fields, options);
  const who = options.who ?? "collaborator";
  return one(as(db, who, "select * from public.submit_change_request($1, 'Please review')", [saved.id], options.strength ?? defaultStrength(who)));
}

const cancel = (id, who = "collaborator", strength = defaultStrength(who)) => as(db, who, "select public.cancel_change_request($1)", [id], strength);

// Temporarily takes a permission away from a role, as an ABSOLUTE_ADMIN would.
async function without(role, permission, fn) {
  await as(db, "absolute", "select public.set_role_permission($1, $2, false)", [role, permission], "mfa");
  try {
    await fn();
  } finally {
    await as(db, "absolute", "select public.set_role_permission($1, $2, true)", [role, permission], "mfa");
  }
}

describe("drafts", () => {
  it("accepts only the fields a draft may change", async () => {
    for (const field of ["editorial_status", "visible", "featured", "slug", "id", "version", "client_id", "case_number", "published_at", "preview_url", "live_preview_enabled"]) {
      assert.equal(await code(draft({ [field]: "PUBLISHED" })), "SU004", field);
    }
  });

  it("validates every value on the server", async () => {
    const invalid = [
      { name: "" },
      { name: null },
      { year: "2024" },
      { year: 1800 },
      { tech_stack: "Vite" },
      { tech_stack: [1, 2] },
      { category: "Crypto" },
      { status: "Shipped" },
      { accent: "red" },
      { project_url: "javascript:alert(1)" },
      { poster_url: `projects/${PROJECTS.other}/poster/x.png` },
      { poster_url: "../../etc/passwd" },
      { translations: { fr: { name: "Nom" } } },
      { description: "x".repeat(8001) },
      {},
    ];
    for (const fields of invalid) {
      assert.equal(await code(draft(fields)), "SU004", JSON.stringify(fields).slice(0, 80));
    }
    const valid = await draft({
      name: "Renamed",
      year: 2026,
      tech_stack: ["Vite", "Supabase"],
      accent: "#c6ff00",
      project_url: "https://example.com",
      poster_url: `projects/${PROJECTS.assigned}/poster/5b1c.png`,
    });
    assert.equal(valid.status, "DRAFT");
    await cancel(valid.id);
  });

  it("needs EDIT access to the project, and projects.draft", async () => {
    assert.equal(await code(draft({ name: "x" }, { target: PROJECTS.published })), "42501", "VIEW access only");
    assert.equal(await code(draft({ name: "x" }, { who: "viewer" })), "42501");
    assert.equal(await code(draft({ name: "x" }, { who: "outsider" })), "42501");
  });

  it("freezes a request once submitted, until its author cancels it", async () => {
    const pending = await submitted({ description: "Frozen" });
    assert.equal(await code(draft({ description: "Changed after submitting" })), "SU003");
    await cancel(pending.id);
    const fresh = await draft({ description: "New draft" });
    assert.notEqual(fresh.id, pending.id);
    await cancel(fresh.id);
  });

  it("never lets a client write requests directly", async () => {
    const pending = await submitted({ description: "Direct write" });
    for (const sql of [
      "update public.change_requests set status = 'APPROVED' where id = $1",
      "update public.change_requests set reviewer_id = requester_id where id = $1",
      "delete from public.change_requests where id = $1",
      "insert into public.change_requests (requester_id, resource_type, resource_id, action, base_version, status) select requester_id, 'project', resource_id, 'project.publish', 1, 'APPROVED' from public.change_requests where id = $1",
    ]) {
      for (const who of ["collaborator", "seo", "owner"]) {
        assert.equal(await code(as(db, who, sql, [pending.id], "mfa")), "42501", `${who}: ${sql}`);
      }
    }
    await cancel(pending.id);
  });

  it("shows a request to its author and, once submitted, to reviewers only", async () => {
    const own = await draft({ description: "Private draft" });
    assert.equal(await outcome(as(db, "collaborator", "select id from public.change_requests where id = $1", [own.id])), "ok");
    assert.equal(await outcome(as(db, "seo", "select id from public.change_requests where id = $1", [own.id], "mfa")), "none", "drafts stay private");
    await as(db, "collaborator", "select public.submit_change_request($1)", [own.id]);
    assert.equal(await outcome(as(db, "seo", "select id from public.change_requests where id = $1", [own.id], "mfa")), "ok");
    assert.equal(await outcome(as(db, "collaborator2", "select id from public.change_requests where id = $1", [own.id])), "none");
    assert.equal(await outcome(as(db, "viewer", "select id from public.change_requests where id = $1", [own.id])), "none");
    await cancel(own.id);
  });
});

describe("review", () => {
  it("applies exactly the proposed fields and records what changed", async () => {
    const before = await project(PROJECTS.assigned);
    const pending = await submitted({ name: "Approved name", tech_stack: ["Astro"] });
    assert.equal(pending.risk_level, "LOW", "an unpublished project");
    const result = (await one(as(db, "seo", "select public.approve_change_request($1, 'Looks good') as result", [pending.id], "mfa"))).result;
    const after = await project(PROJECTS.assigned);
    assert.equal(after.name, "Approved name");
    assert.deepEqual(after.tech_stack, ["Astro"]);
    assert.equal(after.description, before.description);
    assert.equal(after.editorial_status, "DRAFT", "an update request never publishes");
    assert.equal(after.version, before.version + 1);
    assert.deepEqual(result.changes.name, { old: before.name, new: "Approved name" });

    const stored = await request(pending.id);
    assert.equal(stored.status, "APPROVED");
    assert.equal(stored.reviewer_id, IDS.seo);
    assert.equal(stored.review_message, "Looks good");
    assert.equal(stored.applied_version, after.version);
    const trail = (await db.query("select action, actor_user_id from public.security_audit_log where request_id = $1 order by id", [pending.id])).rows;
    assert.deepEqual(trail.map((row) => row.action), ["APPROVAL_DRAFTED", "APPROVAL_REQUESTED", "PROJECT_UPDATED", "APPROVAL_APPROVED"]);
    assert.equal(trail.at(-1).actor_user_id, IDS.seo);
  });

  it("publishes when the request asks to, with projects.publish", async () => {
    const pending = await submitted({ description: "Ready" }, { publish: true });
    assert.equal(pending.action, "project.publish");
    assert.equal(pending.risk_level, "MEDIUM");
    await without("MANAGER", "projects.publish", async () => {
      assert.equal(await code(as(db, "manager", "select public.approve_change_request($1)", [pending.id], "mfa")), "42501");
    });
    await as(db, "manager", "select public.approve_change_request($1)", [pending.id], "mfa");
    const live = await project(PROJECTS.assigned);
    assert.equal(live.editorial_status, "PUBLISHED");
    assert.equal(live.visible, true);
    assert.equal(Number((await one(db.query("select count(*) from public.security_audit_log where action = 'PROJECT_PUBLISHED' and request_id = $1", [pending.id]))).count), 1);
    const changed = await submitted({ description: "Edit of a live project" });
    assert.equal(changed.risk_level, "MEDIUM", "changing something public");
    await cancel(changed.id);
    await db.query("update public.projects set editorial_status = 'DRAFT', visible = false where id = $1", [PROJECTS.assigned]);
  });

  it("rejects with a reason and leaves the project alone", async () => {
    const before = await project(PROJECTS.assigned);
    const pending = await submitted({ name: "Rejected name" });
    assert.equal(await code(as(db, "seo", "select public.reject_change_request($1, '  ')", [pending.id], "mfa")), "SU004");
    await as(db, "seo", "select public.reject_change_request($1, 'Wrong name')", [pending.id], "mfa");
    assert.equal((await request(pending.id)).status, "REJECTED");
    assert.equal((await project(PROJECTS.assigned)).name, before.name);
    assert.equal(await code(as(db, "seo", "select public.approve_change_request($1)", [pending.id], "mfa")), "SU003", "a rejected request stays rejected");
  });

  it("needs MFA from the reviewer", async () => {
    const pending = await submitted({ description: "MFA please" });
    assert.equal(await code(as(db, "seo", "select public.approve_change_request($1)", [pending.id], "aal1")), "SU006");
    await cancel(pending.id);
  });

  it("refuses to apply a request whose author is no longer active", async () => {
    const pending = await submitted({ description: "Author suspended" });
    await as(db, "owner", "select public.suspend_member($1, 'Review')", [IDS.collaborator]);
    try {
      assert.equal(await code(as(db, "seo", "select public.approve_change_request($1)", [pending.id], "mfa")), "SU012");
    } finally {
      await as(db, "owner", "select public.reactivate_member($1)", [IDS.collaborator]);
    }
    await cancel(pending.id);
  });

  it("refuses an expired request, and the sweep marks it expired", async () => {
    const pending = await submitted({ description: "Too late" });
    await db.query("update public.change_requests set expires_at = now() - interval '1 minute' where id = $1", [pending.id]);
    assert.equal(await code(as(db, "seo", "select public.approve_change_request($1)", [pending.id], "mfa")), "SU011");
    await as(db, "owner", "select public.expire_stale_access()");
    assert.equal((await request(pending.id)).status, "EXPIRED");
  });

  it("re-bases a conflicting draft on the current version, to be submitted again", async () => {
    const pending = await submitted({ description: "Needs rebase" });
    await as(db, "seo", "update public.projects set name = 'Moved on' where id = $1", [PROJECTS.assigned], "mfa");
    assert.equal(await code(as(db, "seo", "select public.approve_change_request($1)", [pending.id], "mfa")), "SU001");
    const rebased = await one(as(db, "collaborator", "select * from public.rebase_change_request($1)", [pending.id]));
    assert.equal(rebased.status, "DRAFT");
    assert.equal(rebased.base_version, (await project(PROJECTS.assigned)).version);
    await as(db, "collaborator", "select public.submit_change_request($1)", [pending.id]);
    await as(db, "seo", "select public.approve_change_request($1)", [pending.id], "mfa");
    const live = await project(PROJECTS.assigned);
    assert.equal(live.description, "Needs rebase");
    assert.equal(live.name, "Moved on", "the newer change survives");
  });

  it("gives the requester's other projects nothing to do with it", async () => {
    // IDOR: a request id from another member is not a key to their project.
    const theirs = await submitted({ description: "collaborator2's" }, { who: "collaborator2", target: PROJECTS.other });
    assert.equal(await code(as(db, "collaborator", "select public.cancel_change_request($1)", [theirs.id])), "SU010");
    assert.equal(await code(as(db, "collaborator", "select public.rebase_change_request($1)", [theirs.id])), "SU010");
    assert.equal(await code(as(db, "collaborator", "select public.submit_change_request($1)", [theirs.id])), "SU010");
    await cancel(theirs.id, "collaborator2");
  });
});

describe("field guards", () => {
  it("owns the project version: every update moves it, a client value is ignored", async () => {
    const before = await project(PROJECTS.other);
    await as(db, "seo", "update public.projects set version = 1, description = 'Bump' where id = $1", [PROJECTS.other], "mfa");
    assert.equal((await project(PROJECTS.other)).version, before.version + 1);
  });

  it("keeps publishing and archiving to their own permissions", async () => {
    await without("MANAGER", "projects.publish", async () => {
      assert.equal(await code(as(db, "manager", "update public.projects set editorial_status = 'PUBLISHED' where id = $1", [PROJECTS.other], "mfa")), "42501");
      assert.equal(await code(as(db, "manager", "update public.projects set visible = false where id = $1", [PROJECTS.published], "mfa")), "42501");
      assert.equal(await code(as(db, "manager", "update public.projects set description = 'Allowed' where id = $1", [PROJECTS.published], "mfa")), null);
    });
    await without("MANAGER", "projects.archive", async () => {
      assert.equal(await code(as(db, "manager", "update public.projects set editorial_status = 'ARCHIVED' where id = $1", [PROJECTS.other], "mfa")), "42501");
    });
    assert.equal(await code(as(db, "collaborator", "insert into public.projects (case_number, name, slug) values (900, 'New', 'new')")), "42501");
  });

  it("splits the site settings between settings.edit and seo.edit", async () => {
    await db.query("insert into public.site_settings (key, site_name, seo_title) values ('public', 'Space Underground', 'Old title') on conflict (key) do nothing");
    assert.equal(await code(as(db, "seo", "update public.site_settings set seo_title = 'New title'", [], "mfa")), null);
    assert.equal(await code(as(db, "seo", "update public.site_settings set site_name = 'Hijacked'", [], "mfa")), "42501");
    // The Admin saves the whole row; unchanged identity fields are fine.
    const upsert = `insert into public.site_settings (key, site_name, seo_title, updated_by) values ('public', 'Space Underground', 'Upserted', $1)
                    on conflict (key) do update set site_name = excluded.site_name, seo_title = excluded.seo_title, updated_by = excluded.updated_by`;
    assert.equal(await code(as(db, "seo", upsert, [IDS.owner], "mfa")), null);
    const row = await one(db.query("select seo_title, updated_by from public.site_settings where key = 'public'"));
    assert.equal(row.seo_title, "Upserted");
    assert.equal(row.updated_by, IDS.seo, "the author is the caller, not what the browser sent");
    assert.equal(await outcome(as(db, "manager", "update public.site_settings set seo_title = 'x' returning key", [], "mfa")), "none");
  });

  it("stamps the activity log with the caller, whoever the browser names", async () => {
    await as(db, "collaborator", "insert into public.activity_log (admin_user_id, action, entity_type, title) values ($1, 'updated', 'project', 'Spoof')", [IDS.owner]);
    const row = await one(db.query("select admin_user_id from public.activity_log where title = 'Spoof'"));
    assert.equal(row.admin_user_id, IDS.collaborator);
    assert.equal(await outcome(as(db, "collaborator", "select id from public.activity_log where title <> 'Spoof'")), "none", "others' entries need logs.read");
  });

  it("keeps archiving clients to clients.archive", async () => {
    const client = await one(db.query("insert into public.clients (name, status) values ('Guarded', 'ACTIVE') returning id"));
    assert.equal(await outcome(as(db, "seo", "update public.clients set name = 'x' where id = $1 returning id", [client.id], "mfa")), "none", "SEO only reads clients");
    await without("MANAGER", "clients.archive", async () => {
      assert.equal(await code(as(db, "manager", "update public.clients set status = 'ARCHIVED' where id = $1", [client.id], "mfa")), "42501");
    });
    assert.equal(await code(as(db, "manager", "update public.clients set status = 'ARCHIVED' where id = $1", [client.id], "mfa")), null);
    assert.equal(await code(as(db, "collaborator", "select public.next_client_code()")), "42501");
  });

  it("lets a collaborator upload into an assigned project's folder only, and never delete", async () => {
    const path = (id, name = "draft.png") => `projects/${id}/poster/${name}`;
    const upload = (who, name) => as(db, who, "insert into storage.objects (bucket_id, name) values ('project-media', $1)", [name]);
    assert.equal(await code(upload("collaborator", path(PROJECTS.assigned))), null);
    assert.equal(await code(upload("collaborator", path(PROJECTS.published))), "42501", "VIEW access");
    assert.equal(await code(upload("collaborator", path(PROJECTS.other))), "42501", "not assigned");
    assert.equal(await code(upload("viewer", path(PROJECTS.assigned, "v.png"))), "42501");
    assert.equal(await outcome(as(db, "collaborator", "delete from storage.objects where name = $1 returning id", [path(PROJECTS.assigned)])), "none");
    assert.equal(await outcome(as(db, "seo", "delete from storage.objects where name = $1 returning id", [path(PROJECTS.assigned)], "mfa")), "ok");
  });
});
