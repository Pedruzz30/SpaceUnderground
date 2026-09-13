// Data layer tests for the async admin services running against the mock
// repository. No browser and no Supabase credentials required.
//
//   npm test
//
// The services touch localStorage, which does not exist in Node, so a small
// in-memory stub is installed before the module graph is imported.

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

const { resetMockProjects } = await import("../src/services/repositories/mock-project-repository.js");
const { resetMockPlans } = await import("../src/services/repositories/mock-plan-repository.js");
const { resetMockActivity } = await import("../src/services/repositories/mock-activity-repository.js");
const { getActivity, getActivityWithStatus } = await import("../src/services/activity-service.js");
const {
  archiveProject,
  createProject,
  deleteProject,
  getProjectById,
  getProjects,
  nextAvailableCaseNumber,
  updateProject,
} = await import("../src/services/project-service.js");
const { archivePlan, createPlan, duplicatePlan, getPlan, getPlans, unarchivePlan } = await import("../src/services/plan-service.js");
const { mapProjectFromDatabase, mapProjectToDatabase, formatCaseNumber } = await import(
  "../src/services/mappers/project-mapper.js"
);

const draft = {
  name: "Orbital Ops",
  slug: "orbital-ops",
  client: "Orbital",
  category: "System",
  status: "MVP",
  editorialStatus: "DRAFT",
  year: "2026",
  techStack: ["Node"],
};

describe("project service (mock repository)", () => {
  beforeEach(() => {
    resetMockProjects();
    resetMockActivity();
  });

  it("returns the seeded projects", async () => {
    const projects = await getProjects();
    assert.equal(projects.length, 2);
    assert.equal(projects[0].caseNumber, "001");
  });

  it("finds a project by its padded case number and returns null otherwise", async () => {
    assert.equal((await getProjectById("001")).name, "INK Tattoo");
    assert.equal(await getProjectById("999"), null);
  });

  it("creates a project with the next case number and timestamps", async () => {
    const created = await createProject(draft);

    assert.equal(created.caseNumber, "003");
    assert.equal(created.id, "003");
    assert.equal(created.name, "Orbital Ops");
    assert.ok(created.createdAt);
    assert.ok(created.updatedAt);
    assert.equal(created.publishedAt, null);
    assert.equal((await getProjects()).length, 3);
  });

  it("derives the next case number from the highest one, not the count", async () => {
    await createProject(draft);
    await deleteProject("002");

    // 001 and 003 remain: counting would wrongly suggest 003 again.
    assert.equal(await nextAvailableCaseNumber(), "004");
  });

  it("updates a project without touching its identity", async () => {
    const updated = await updateProject("001", { name: "INK Tattoo v2", client: "INK" });

    assert.equal(updated.name, "INK Tattoo v2");
    assert.equal(updated.caseNumber, "001");
    assert.equal(updated.id, "001");
  });

  it("stamps published_at on first publication and keeps it afterwards", async () => {
    const created = await createProject(draft);
    assert.equal(created.publishedAt, null);

    const published = await updateProject(created.id, { editorialStatus: "PUBLISHED" });
    assert.ok(published.publishedAt);

    const backToDraft = await updateProject(created.id, { editorialStatus: "DRAFT" });
    assert.equal(backToDraft.publishedAt, published.publishedAt);
  });

  it("archives a project", async () => {
    const archived = await archiveProject("001");
    assert.equal(archived.editorialStatus, "ARCHIVED");
    assert.equal((await getProjectById("001")).editorialStatus, "ARCHIVED");
  });

  it("deletes a project", async () => {
    await deleteProject("001");

    assert.equal(await getProjectById("001"), null);
    assert.equal((await getProjects()).length, 1);
  });

  it("rejects updates to a project that does not exist", async () => {
    await assert.rejects(() => updateProject("999", { name: "Nope" }), /not found|não encontrado/i);
  });

  it("records activity for create, archive and delete", async () => {
    await createProject(draft);
    await archiveProject("001");
    await deleteProject("002");

    const titles = (await getActivity()).map((entry) => entry.title);
    assert.deepEqual(titles, ["Project deleted", "Project archived", "Project created"]);
  });
});

describe("project mapper", () => {
  it("pads case numbers for display", () => {
    assert.equal(formatCaseNumber(7), "007");
    assert.equal(formatCaseNumber(42), "042");
  });

  it("maps a database row into the UI model", () => {
    const model = mapProjectFromDatabase({
      id: "6f1c9d0e-6d38-4b0f-8f0a-0b0f9a1b2c3d",
      case_number: 3,
      name: "Orbital Ops",
      slug: "orbital-ops",
      category: "System",
      status: "MVP",
      editorial_status: "PUBLISHED",
      featured: true,
      visible: true,
      year: 2026,
      tech_stack: ["Node"],
      poster_url: "poster.png",
      project_url: "https://example.com",
      preview_url: null,
      live_preview_enabled: true,
    });

    assert.equal(model.id, "003");
    assert.equal(model.dbId, "6f1c9d0e-6d38-4b0f-8f0a-0b0f9a1b2c3d");
    assert.equal(model.caseNumber, "003");
    assert.equal(model.editorialStatus, "PUBLISHED");
    assert.equal(model.year, "2026");
    assert.equal(model.poster, "poster.png");
    assert.equal(model.previewUrl, "");
    assert.equal(model.livePreviewEnabled, true);
    assert.deepEqual(model.techStack, ["Node"]);
  });

  it("maps the UI model back to snake_case columns", () => {
    const row = mapProjectToDatabase({
      caseNumber: "003",
      name: "Orbital Ops",
      editorialStatus: "DRAFT",
      techStack: ["Node"],
      year: "2026",
      poster: "poster.png",
      previewUrl: "",
      livePreviewEnabled: false,
    });

    assert.equal(row.case_number, 3);
    assert.equal(row.editorial_status, "DRAFT");
    assert.equal(row.year, 2026);
    assert.equal(row.poster_url, "poster.png");
    assert.equal(row.preview_url, null);
    assert.equal(row.live_preview_enabled, false);
    assert.deepEqual(row.tech_stack, ["Node"]);
    // Fields that were not provided must not appear in the patch.
    assert.equal("slug" in row, false);
  });
});

describe("plan service (mock repository)", () => {
  beforeEach(() => {
    resetMockPlans();
  });

  it("creates a hidden unavailable plan with features", async () => {
    const created = await createPlan({
      name: "Orbit",
      slug: "orbit",
      range: "R$ 1.000",
      status: "UNAVAILABLE",
      visible: false,
      timeline: "2 semanas",
      description: "Plano sob medida.",
      features: [{ text: "Diagnóstico", translations: { en: { text: "Discovery" } } }],
    });

    assert.equal(created.status, "UNAVAILABLE");
    assert.equal(created.visible, false);
    assert.equal(created.features.length, 1);
    assert.equal((await getPlans()).length, 4);
  });

  it("duplicates a plan as hidden and unavailable with copied features", async () => {
    const duplicated = await duplicatePlan("plan-pro");

    assert.equal(duplicated.name, "Pro Copy");
    assert.equal(duplicated.slug, "pro-copy");
    assert.equal(duplicated.status, "UNAVAILABLE");
    assert.equal(duplicated.visible, false);
    assert.equal(duplicated.features.length, (await getPlan("plan-pro")).features.length);
    assert.ok(duplicated.features.every((feature) => feature.id));
  });

  it("uses incremented slugs for repeated duplicates", async () => {
    await duplicatePlan("plan-pro");
    const second = await duplicatePlan("plan-pro");

    assert.equal(second.slug, "pro-copy-2");
  });

  it("archives and unarchives without physical deletion", async () => {
    const archived = await archivePlan("plan-plus");
    assert.equal(archived.status, "ARCHIVED");
    assert.equal(archived.visible, false);

    const restored = await unarchivePlan("plan-plus");
    assert.equal(restored.status, "UNAVAILABLE");
    assert.equal(restored.visible, false);
    assert.ok(await getPlan("plan-plus"));
  });
});

describe("activity service (mock repository)", () => {
  beforeEach(() => {
    resetMockActivity();
  });

  // Breaks the read the way a repository outage would, so the distinction
  // between "nothing logged" and "could not read the log" is exercised for
  // real rather than asserted in the abstract.
  async function withBrokenStorage(task) {
    const original = globalThis.localStorage.getItem;
    globalThis.localStorage.getItem = () => {
      throw new Error("storage unavailable");
    };
    try {
      return await task();
    } finally {
      globalThis.localStorage.getItem = original;
    }
  }

  it("reports a successful read of an empty log", async () => {
    assert.deepEqual(await getActivityWithStatus(), { items: [], ok: true });
  });

  it("reports a read failure instead of passing it off as an empty log", async () => {
    const result = await withBrokenStorage(() => getActivityWithStatus());
    assert.equal(result.ok, false, "the outage is visible to the caller");
    assert.deepEqual(result.items, []);
  });

  it("keeps getActivity() forgiving for the pages that only want entries", async () => {
    assert.deepEqual(await withBrokenStorage(() => getActivity()), []);
  });
});
