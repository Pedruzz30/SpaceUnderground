// Clients V2 data layer: mapper, status rules, health, derived metrics and the
// client service running against the mock repository. No browser and no
// Supabase credentials required.
//
//   npm test

import { strict as assert } from "node:assert";
import { beforeEach, describe, it } from "node:test";

function createStorageStub() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
  };
}

globalThis.localStorage = createStorageStub();

const { setLocale } = await import("../src/i18n/index.js");
const { resetMockClients, mockClientRepository } = await import("../src/services/repositories/mock-client-repository.js");
const { resetMockProjects } = await import("../src/services/repositories/mock-project-repository.js");
const { resetMockActivity } = await import("../src/services/repositories/mock-activity-repository.js");
const { getActivity } = await import("../src/services/activity-service.js");
const { toDataError } = await import("../src/services/errors.js");
const {
  archiveClient,
  createClient,
  getClient,
  getClientActivity,
  getClientProjects,
  getClients,
  linkProjectToClient,
  newClientDefaults,
  sanitizeClient,
  unarchiveClient,
  unlinkProjectFromClient,
  updateClient,
  validateClient,
} = await import("../src/services/client-service.js");
const { getProjectById } = await import("../src/services/project-service.js");
const {
  formatClientCode,
  mapClientFromDatabase,
  mapClientToDatabase,
  nextClientCode,
  parseClientCodeNumber,
  stampArchivedAt,
} = await import("../src/services/mappers/client-mapper.js");
const { CLIENT_STATUSES, clientHealth, isClientStatus, isValidEmail, normalizeClientStatus } = await import(
  "../src/utils/client-health.js"
);
const { clientMetrics, groupProjectsByClient, isActiveProject, matchesClientQuery, projectSummary } = await import(
  "../src/utils/client-metrics.js"
);

// Messages are asserted in English; the service resolves them at throw time.
setLocale("en", { persist: false });

function reset() {
  resetMockClients();
  resetMockProjects();
  resetMockActivity();
}

/* ------------------------------------------------------------------ status */

describe("client status", () => {
  it("keeps exactly the four lifecycle values", () => {
    assert.deepEqual(CLIENT_STATUSES, ["ACTIVE", "LEAD", "INACTIVE", "ARCHIVED"]);
  });

  it("normalizes casing, whitespace and Portuguese spellings", () => {
    assert.equal(normalizeClientStatus(" active "), "ACTIVE");
    assert.equal(normalizeClientStatus("Ativo"), "ACTIVE");
    assert.equal(normalizeClientStatus("inativo"), "INACTIVE");
    assert.equal(normalizeClientStatus("Arquivado"), "ARCHIVED");
    assert.equal(normalizeClientStatus("lead"), "LEAD");
  });

  it("rejects values outside the lifecycle", () => {
    assert.equal(isClientStatus("PROSPECT"), false);
    assert.equal(isClientStatus(""), false);
    assert.equal(isClientStatus("archived"), true);
  });
});

/* ------------------------------------------------------------------ health */

describe("client health", () => {
  const complete = { name: "Aurora", company: "Aurora Labs", email: "ops@aurora.example.com", phone: "", status: "ACTIVE" };

  it("is healthy with a name, a contact, a valid status and a company", () => {
    const health = clientHealth(complete);
    assert.equal(health.status, "healthy");
    assert.equal(health.score, health.total);
  });

  it("accepts a phone instead of an email", () => {
    assert.equal(clientHealth({ ...complete, email: "", phone: "+55 21 90000-0000" }).status, "healthy");
  });

  it("needs attention when relevant details are missing or malformed", () => {
    assert.equal(clientHealth({ ...complete, company: "" }).status, "attention");
    assert.equal(clientHealth({ ...complete, email: "not-an-email" }).status, "attention");
  });

  it("is incomplete without essentials", () => {
    assert.equal(clientHealth({ ...complete, name: " " }).status, "incomplete");
    assert.equal(clientHealth({ ...complete, email: "", phone: "" }).status, "incomplete");
    assert.equal(clientHealth({ ...complete, status: "UNKNOWN" }).status, "incomplete");
  });

  it("validates email shape loosely", () => {
    assert.equal(isValidEmail("a@b.co"), true);
    assert.equal(isValidEmail("a@b"), false);
    assert.equal(isValidEmail("a b@c.co"), false);
  });
});

/* ------------------------------------------------------------------ mapper */

describe("client mapper", () => {
  it("formats and parses CLIENT codes", () => {
    assert.equal(formatClientCode(7), "CLIENT-007");
    assert.equal(formatClientCode(1234), "CLIENT-1234");
    assert.equal(parseClientCodeNumber("client-012"), 12);
    assert.equal(parseClientCodeNumber("VIP-01"), null);
  });

  it("derives the next code from the highest one, not the count", () => {
    assert.equal(nextClientCode([]), "CLIENT-001");
    assert.equal(nextClientCode(["CLIENT-001", "CLIENT-009"]), "CLIENT-010");
    assert.equal(nextClientCode(["VIP-01", "CLIENT-002"]), "CLIENT-003");
  });

  it("maps a database row into the UI model", () => {
    const model = mapClientFromDatabase({
      id: "6f1c9d0e-6d38-4b0f-8f0a-0b0f9a1b2c3d",
      code: "CLIENT-004",
      name: "Aurora",
      company: null,
      email: "ops@aurora.example.com",
      phone: null,
      status: "active",
      notes: null,
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-02T00:00:00Z",
      archived_at: null,
    });
    assert.deepEqual(model, {
      id: "6f1c9d0e-6d38-4b0f-8f0a-0b0f9a1b2c3d",
      code: "CLIENT-004",
      name: "Aurora",
      company: "",
      email: "ops@aurora.example.com",
      phone: "",
      status: "ACTIVE",
      notes: "",
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-02T00:00:00Z",
      archivedAt: null,
    });
  });

  it("maps the model back with blanks as null and only the fields given", () => {
    const row = mapClientToDatabase({ name: " Aurora ", company: "", status: "inativo", code: " client-009 " });
    assert.deepEqual(row, { name: "Aurora", company: null, status: "INACTIVE", code: "CLIENT-009" });
    assert.equal("email" in row, false);
  });

  it("leaves a blank code out so the database assigns one", () => {
    assert.equal("code" in mapClientToDatabase({ code: "  " }), false);
  });

  it("never writes database-owned columns", () => {
    const row = mapClientToDatabase({ name: "X", id: "a", createdAt: "b", updatedAt: "c", archivedAt: "d" });
    assert.deepEqual(Object.keys(row), ["name"]);
  });

  it("stamps archived_at like the database trigger", () => {
    const now = "2026-09-27T00:00:00.000Z";
    assert.equal(stampArchivedAt(null, { status: "ACTIVE" }, now), null);
    assert.equal(stampArchivedAt({ status: "ACTIVE" }, { status: "ARCHIVED" }, now), now);
    assert.equal(stampArchivedAt({ status: "ARCHIVED", archivedAt: "earlier" }, { status: "ARCHIVED" }, now), "earlier");
    assert.equal(stampArchivedAt({ status: "ARCHIVED", archivedAt: "earlier" }, { status: "INACTIVE" }, now), null);
  });
});

/* ------------------------------------------------------------------ errors */

describe("client errors", () => {
  it("maps a duplicate client code to the code field without leaking SQL", () => {
    const error = toDataError(
      { code: "23505", message: 'duplicate key value violates unique constraint "clients_code_key"' },
      "fallback",
    );
    assert.equal(error.field, "code");
    assert.doesNotMatch(error.message, /constraint|duplicate key/);
  });

  it("explains a missing table or column instead of a generic failure", () => {
    for (const code of ["42P01", "42703", "PGRST205"]) {
      const error = toDataError({ code, message: 'relation "public.clients" does not exist' }, "fallback");
      assert.equal(error.code, "schema_outdated");
      assert.doesNotMatch(error.message, /relation|public\.clients/);
    }
  });
});

/* ----------------------------------------------------------------- metrics */

describe("client metrics", () => {
  const projects = [
    { clientId: "a", status: "In Development", editorialStatus: "DRAFT" },
    { clientId: "a", status: "Live", editorialStatus: "PUBLISHED" },
    { clientId: "b", status: "Live", editorialStatus: "PUBLISHED" },
    { clientId: "c", status: "MVP", editorialStatus: "ARCHIVED" },
    { clientId: null, status: "Pilot", editorialStatus: "DRAFT" },
  ];
  const clients = [
    { id: "a", status: "ACTIVE" },
    { id: "b", status: "ACTIVE" },
    { id: "c", status: "INACTIVE" },
    { id: "d", status: "LEAD" },
    { id: "e", status: "ARCHIVED" },
  ];

  it("treats in-delivery work as active, and shipped or archived work as not", () => {
    assert.equal(isActiveProject(projects[0]), true);
    assert.equal(isActiveProject(projects[1]), false);
    assert.equal(isActiveProject(projects[3]), false);
  });

  it("groups projects by client and ignores projects with no client", () => {
    const groups = groupProjectsByClient(projects);
    assert.equal(groups.get("a").length, 2);
    assert.equal(groups.has(null), false);
    assert.deepEqual(projectSummary(groups.get("a")), { total: 2, active: 1, delivered: 1 });
  });

  it("derives every hub figure from the records", () => {
    assert.deepEqual(clientMetrics(clients, groupProjectsByClient(projects)), {
      total: 5,
      active: 2,
      leads: 1,
      withActiveProjects: 1,
      inactiveOrArchived: 2,
    });
  });

  it("searches name, company, email, phone and code", () => {
    const client = { name: "Aurora", company: "Labs Ltda", email: "ops@aurora.example.com", phone: "+55 21 9999", code: "CLIENT-042" };
    for (const query of ["auro", "LABS", "ops@", "21 99", "client-042"]) {
      assert.equal(matchesClientQuery(client, query), true, query);
    }
    assert.equal(matchesClientQuery(client, "zeta"), false);
    assert.equal(matchesClientQuery(client, "  "), true);
  });
});

/* ------------------------------------------------------------------ service */

describe("client service (mock repository)", () => {
  beforeEach(reset);

  it("lists the seeded clients, most recently updated first", async () => {
    const clients = await getClients();
    assert.equal(clients.length, 4);
    const stamps = clients.map((client) => client.updatedAt);
    assert.deepEqual(stamps, [...stamps].sort().reverse());
  });

  it("offers LEAD as the default for a new client", () => {
    assert.equal(newClientDefaults().status, "LEAD");
  });

  it("creates a client with the next code and timestamps", async () => {
    const created = await createClient({ name: "Aurora Labs", email: "ops@aurora.example.com", status: "active" });
    assert.equal(created.code, "CLIENT-005");
    assert.equal(created.status, "ACTIVE");
    assert.ok(created.id && created.createdAt && created.updatedAt);
    assert.equal(created.archivedAt, null);
    assert.equal((await getClient(created.id)).name, "Aurora Labs");
  });

  it("keeps a typed code, upper-cased", async () => {
    const created = await createClient({ name: "Typed", code: "vip-01" });
    assert.equal(created.code, "VIP-01");
  });

  it("rejects a duplicate code on the code field", async () => {
    await assert.rejects(
      () => createClient({ name: "Dup", code: "CLIENT-001" }),
      (error) => error.field === "code" && error.message === "This client code is already in use.",
    );
  });

  it("validates before anything is stored", async () => {
    await assert.rejects(() => createClient({ name: "  " }), (error) => error.field === "name");
    await assert.rejects(() => createClient({ name: "X", email: "nope" }), (error) => error.field === "email");
    await assert.rejects(() => createClient({ name: "X", status: "PROSPECT" }), (error) => error.field === "status");
    await assert.rejects(() => createClient({ name: "X", code: "bad code!" }), (error) => error.field === "code");
    assert.equal((await getClients()).length, 4);
  });

  it("exposes the same validation to the editor", () => {
    assert.deepEqual(Object.keys(validateClient({ name: "", email: "x" })).sort(), ["email", "name"]);
    assert.deepEqual(validateClient({ name: "Ok", email: "", status: "LEAD" }), {});
  });

  it("drops fields the editor may not write", () => {
    const clean = sanitizeClient({ name: " A ", id: "x", archivedAt: "y", status: "ativo" });
    assert.deepEqual(clean, { name: "A", status: "ACTIVE" });
  });

  it("updates a client without touching its identity", async () => {
    const before = await getClient("mock-client-003");
    const updated = await updateClient("mock-client-003", { company: "Academia X Ltda", notes: "Called back." });
    assert.equal(updated.id, before.id);
    assert.equal(updated.code, before.code);
    assert.equal(updated.createdAt, before.createdAt);
    assert.equal(updated.company, "Academia X Ltda");
    assert.equal(updated.notes, "Called back.");
  });

  it("rejects an update to a client that does not exist", async () => {
    await assert.rejects(() => updateClient("missing", { name: "X" }), (error) => error.code === "not_found");
  });

  it("archives and restores without deleting anything", async () => {
    const archived = await archiveClient("mock-client-002");
    assert.equal(archived.status, "ARCHIVED");
    assert.ok(archived.archivedAt);

    const restored = await unarchiveClient("mock-client-002");
    assert.equal(restored.status, "INACTIVE", "a restored client never claims an active relationship");
    assert.equal(restored.archivedAt, null);
    assert.equal((await getClients()).length, 4);
  });

  it("records activity for create, update, archive and restore", async () => {
    const created = await createClient({ name: "Logged" });
    await updateClient(created.id, { phone: "+55 21 90000-0000" });
    await archiveClient(created.id);
    await unarchiveClient(created.id);

    const entries = await getClientActivity(created.id);
    assert.deepEqual(
      entries.map((entry) => entry.action),
      ["client.unarchived", "client.archived", "client.updated", "client.created"],
    );
    assert.ok(entries.every((entry) => entry.entityType === "client" && entry.entityId === created.id));
  });

  it("logs a status change to ARCHIVED from the editor as an archive", async () => {
    await updateClient("mock-client-004", { status: "ARCHIVED" });
    const [latest] = await getActivity();
    assert.equal(latest.action, "client.archived");
  });

  it("reads a client's projects through the project repository", async () => {
    const projects = await getClientProjects("mock-client-001");
    assert.deepEqual(projects.map((project) => project.caseNumber), ["001"]);
    assert.deepEqual(await getClientProjects("mock-client-003"), []);
  });

  it("links and unlinks a project and logs both on the client", async () => {
    await unlinkProjectFromClient("mock-client-002", "002");
    assert.equal((await getProjectById("002")).clientId, null);

    await linkProjectToClient("mock-client-003", "002");
    assert.equal((await getProjectById("002")).clientId, "mock-client-003");
    assert.deepEqual((await getClientProjects("mock-client-003")).map((project) => project.id), ["002"]);

    const actions = (await getClientActivity("mock-client-003")).map((entry) => entry.action);
    assert.deepEqual(actions, ["client.project_linked"]);
  });

  it("refuses to link a project to a client that does not exist", async () => {
    await assert.rejects(() => linkProjectToClient("missing", "001"), (error) => error.code === "not_found");
    assert.equal((await getProjectById("001")).clientId, "mock-client-001");
  });
});

describe("mock client repository", () => {
  beforeEach(reset);

  it("never hands out a number that is still taken", async () => {
    await mockClientRepository.create({ name: "Manual", code: "CLIENT-005" });
    const next = await mockClientRepository.create({ name: "Auto" });
    assert.equal(next.code, "CLIENT-006");
  });

  it("keeps the original archive stamp while a client stays archived", async () => {
    const archived = await mockClientRepository.update("mock-client-001", { status: "ARCHIVED" });
    const edited = await mockClientRepository.update("mock-client-001", { notes: "still archived" });
    assert.equal(edited.archivedAt, archived.archivedAt);
  });

  it("returns null for an unknown client instead of throwing", async () => {
    assert.equal(await mockClientRepository.getById("nope"), null);
    assert.equal(await mockClientRepository.update("nope", { name: "X" }), null);
  });

  it("recovers from a corrupted store", async () => {
    localStorage.setItem("space-admin:clients:v1", "{not json");
    assert.equal((await mockClientRepository.list()).length, 4);
  });
});
