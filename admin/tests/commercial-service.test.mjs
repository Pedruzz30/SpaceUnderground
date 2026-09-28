// Commercial V2 data layer: mapper, validation and the commercial service
// running against the mock repositories, including the win that creates a
// client and a receivable. No browser and no Supabase credentials.
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
const { clearMockCommercial, resetMockCommercial } = await import("../src/services/repositories/mock-commercial-repository.js");
const { clearMockFinancial } = await import("../src/services/repositories/mock-financial-repository.js");
const { resetMockClients } = await import("../src/services/repositories/mock-client-repository.js");
const { resetMockActivity } = await import("../src/services/repositories/mock-activity-repository.js");
const { getActivity } = await import("../src/services/activity-service.js");
const { getClients } = await import("../src/services/client-service.js");
const { getTransactions } = await import("../src/services/financial-service.js");
const {
  createOpportunity,
  deleteOpportunity,
  getOpportunities,
  loseOpportunity,
  moveOpportunity,
  reopenOpportunity,
  reorderOpportunity,
  sanitizeOpportunity,
  updateOpportunity,
  validateOpportunity,
  winOpportunity,
} = await import("../src/services/commercial-service.js");
const { mapOpportunityFromDatabase, mapOpportunityToDatabase, stampStage } = await import("../src/services/mappers/commercial-mapper.js");
const { buildSeedOpportunities } = await import("../src/data/commercial.js");

setLocale("en", { persist: false });

const lead = {
  title: "Institutional website",
  contactName: "Marina Costa",
  company: "Estúdio Norte",
  email: "marina@example.com",
  estimatedValue: "3.500,00",
  source: "WEBSITE",
};

const actions = async () => (await getActivity()).map((entry) => entry.action);

beforeEach(() => {
  clearMockCommercial();
  clearMockFinancial();
  resetMockClients();
  resetMockActivity();
});

describe("commercial mapper", () => {
  it("reads a PostgREST row, with numeric values sent as strings", () => {
    const model = mapOpportunityFromDatabase({
      id: "o1",
      title: "Site",
      stage: "proposal",
      priority: "high",
      source: "instagram",
      estimated_value: "4500.00",
      next_action_at: "2026-09-30",
      lost_reason: null,
      position: "1.5",
    });
    assert.deepEqual(
      [model.stage, model.priority, model.source, model.estimatedValue, model.nextActionAt, model.position],
      ["PROPOSAL", "HIGH", "INSTAGRAM", 4500, "2026-09-30", 1.5],
    );
    assert.equal(model.contactName, "");
  });

  it("writes only present fields, blanks as null, and never the stage bookkeeping", () => {
    assert.deepEqual(mapOpportunityToDatabase({ company: "  " }), { company: null });
    assert.deepEqual(mapOpportunityToDatabase({ estimatedValue: "" }), { estimated_value: null });
    const row = mapOpportunityToDatabase({ stage: "WON", closedAt: "x", stageChangedAt: "y" });
    assert.deepEqual(row, { stage: "WON" });
  });

  it("stamps the stage the way the database trigger does", () => {
    const now = "2026-09-20T12:00:00.000Z";
    const created = stampStage(null, { stage: "NEW" }, now);
    assert.deepEqual(created, { stageChangedAt: now, closedAt: null, lostReason: null });
    const won = stampStage({ stage: "NEGOTIATION", stageChangedAt: "old" }, { stage: "WON" }, now);
    assert.equal(won.closedAt, now);
    const edited = stampStage({ stage: "WON", stageChangedAt: "t1", closedAt: "t1" }, { stage: "WON" }, now);
    assert.deepEqual([edited.stageChangedAt, edited.closedAt], ["t1", "t1"]);
    assert.equal(stampStage({ stage: "LOST" }, { stage: "NEW", lostReason: "PRICE" }, now).lostReason, null);
  });
});

describe("commercial validation", () => {
  it("accepts a lead with a contact and no client", () => {
    assert.deepEqual(validateOpportunity(sanitizeOpportunity({ ...lead, stage: "NEW", priority: "MEDIUM" })), {});
  });

  it("requires a title and somebody on the other side", () => {
    const errors = validateOpportunity(sanitizeOpportunity({ title: "", stage: "NEW", priority: "LOW", source: "OTHER" }));
    assert.deepEqual(Object.keys(errors).sort(), ["contactName", "title"]);
  });

  it("refuses a bad email, a negative value and a future last contact", () => {
    const errors = validateOpportunity(
      sanitizeOpportunity({ ...lead, stage: "NEW", priority: "LOW", email: "nope", estimatedValue: "-5", lastContactAt: "2999-01-01" }),
    );
    assert.deepEqual(Object.keys(errors).sort(), ["email", "estimatedValue", "lastContactAt"]);
  });

  it("requires a reason to lose a deal", () => {
    assert.ok(validateOpportunity(sanitizeOpportunity({ ...lead, stage: "LOST", priority: "LOW" })).lostReason);
  });

  it("drops the loss reason from any other stage", () => {
    assert.equal(sanitizeOpportunity({ stage: "NEW", lostReason: "PRICE" }).lostReason, null);
  });
});

describe("commercial service", () => {
  it("creates a deal and logs it", async () => {
    const created = await createOpportunity(lead);
    assert.equal(created.stage, "NEW");
    assert.equal(created.estimatedValue, 3500);
    assert.ok(created.stageChangedAt);
    assert.equal(created.closedAt, null);
    assert.deepEqual(await actions(), ["commercial.created"]);
  });

  it("moves a deal between open stages and logs the move", async () => {
    const created = await createOpportunity(lead);
    const moved = await moveOpportunity(created.id, "PROPOSAL", 3);
    assert.equal(moved.stage, "PROPOSAL");
    assert.equal(moved.position, 3);
    assert.equal((await actions())[0], "commercial.stage_changed");
  });

  it("refuses to close a deal by moving it, so the win and loss dialogs run", async () => {
    const created = await createOpportunity(lead);
    await assert.rejects(moveOpportunity(created.id, "WON"), (error) => error.field === "stage");
  });

  it("reorders inside a column without writing to the log", async () => {
    const created = await createOpportunity(lead);
    await reorderOpportunity(created.id, 0.5);
    assert.deepEqual(await actions(), ["commercial.created"]);
  });

  it("wins a lead, creating the client and the receivable installments", async () => {
    const created = await createOpportunity(lead);
    const clientsBefore = (await getClients()).length;
    const result = await winOpportunity(created.id, {
      createClientRecord: true,
      receivable: { amount: "3.500,00", installments: 2, dueDate: "2026-10-10" },
    });

    assert.equal(result.opportunity.stage, "WON");
    assert.ok(result.opportunity.closedAt);
    assert.deepEqual(result.warnings, []);
    assert.equal((await getClients()).length, clientsBefore + 1);
    assert.equal(result.client.name, "Marina Costa");
    assert.equal(result.opportunity.clientId, result.client.id, "the deal now points at the new client");

    const ledger = await getTransactions();
    assert.deepEqual(ledger.map((entry) => entry.amount).sort(), [1750, 1750]);
    assert.ok(ledger.every((entry) => entry.type === "INCOME" && entry.status === "PENDING" && entry.clientId === result.client.id));
    assert.ok((await actions()).includes("commercial.won"));
  });

  it("wins without side effects when none are asked for", async () => {
    const created = await createOpportunity(lead);
    const clientsBefore = (await getClients()).length;
    const result = await winOpportunity(created.id);
    assert.equal(result.opportunity.stage, "WON");
    assert.equal((await getClients()).length, clientsBefore);
    assert.equal((await getTransactions()).length, 0);
  });

  it("keeps the win when the receivable is refused, and reports it", async () => {
    const created = await createOpportunity({ ...lead, estimatedValue: "" });
    const result = await winOpportunity(created.id, { receivable: { amount: "", installments: 1, dueDate: "2026-10-10" } });
    assert.equal(result.opportunity.stage, "WON");
    assert.equal(result.warnings.length, 1);
    assert.equal((await getTransactions()).length, 0);
  });

  it("loses a deal with a reason, appending the note, and reopens it", async () => {
    const created = await createOpportunity({ ...lead, notes: "First call went well." });
    const lost = await loseOpportunity(created.id, "PRICE", "Went with a template.");
    assert.equal(lost.stage, "LOST");
    assert.equal(lost.lostReason, "PRICE");
    assert.match(lost.notes, /First call went well\.\n\nWent with a template\./);

    const reopened = await reopenOpportunity(created.id);
    assert.equal(reopened.stage, "NEGOTIATION");
    assert.equal(reopened.lostReason, null);
    assert.equal(reopened.closedAt, null);
    assert.deepEqual((await actions()).slice(0, 2), ["commercial.reopened", "commercial.lost"]);
  });

  it("refuses an edit that breaks a rule", async () => {
    const created = await createOpportunity(lead);
    await assert.rejects(updateOpportunity(created.id, { title: " " }), (error) => error.field === "title");
  });

  it("deletes a deal and logs it", async () => {
    const created = await createOpportunity(lead);
    await deleteOpportunity(created.id);
    assert.equal((await getOpportunities()).length, 0);
    assert.equal((await actions())[0], "commercial.deleted");
  });
});

describe("commercial mock seed", () => {
  it("covers every stage with valid, closable deals", () => {
    resetMockCommercial();
    const seed = buildSeedOpportunities();
    assert.deepEqual([...new Set(seed.map((deal) => deal.stage))].sort(), ["CONTACTED", "LOST", "NEGOTIATION", "NEW", "PROPOSAL", "WON"]);
    assert.ok(seed.every((deal) => deal.title && (deal.clientId || deal.contactName || deal.company)));
    assert.ok(seed.every((deal) => (deal.stage === "LOST") === Boolean(deal.lostReason)));
    assert.ok(seed.every((deal) => ["WON", "LOST"].includes(deal.stage) === Boolean(deal.closedAt)));
  });
});
