// The relationship around a client (money, deals, contact rhythm, signals,
// duplicates) and the contact log, against the mock repositories.
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
const { resetMockClients } = await import("../src/services/repositories/mock-client-repository.js");
const { resetMockActivity } = await import("../src/services/repositories/mock-activity-repository.js");
const { getActivity } = await import("../src/services/activity-service.js");
const { getClient, recordContact } = await import("../src/services/client-service.js");
const {
  clientFinance,
  clientPipeline,
  contactState,
  contactTimestampForDay,
  daysSinceContact,
  findDuplicates,
  initials,
  mailtoLink,
  matchesFocus,
  relationshipSignals,
  sortClients,
  telLink,
  whatsappLink,
} = await import("../src/utils/client-relationship.js");

setLocale("en", { persist: false });

const NOW = new Date(2026, 8, 20, 12, 0, 0);
const daysAgo = (days) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

const entries = [
  { type: "INCOME", status: "PAID", amount: 1000, dueDate: "2026-09-01", paidAt: "2026-09-01" },
  { type: "INCOME", status: "PENDING", amount: 500, dueDate: "2026-09-10" },
  { type: "INCOME", status: "PENDING", amount: 300, dueDate: "2026-10-10" },
  { type: "INCOME", status: "CANCELLED", amount: 900, dueDate: "2026-09-05" },
  { type: "EXPENSE", status: "PAID", amount: 120, dueDate: "2026-09-03", paidAt: "2026-09-03" },
];

const deals = [
  { stage: "PROPOSAL", estimatedValue: 4000, nextActionAt: "2026-09-18", stageChangedAt: daysAgo(3) },
  { stage: "NEW", estimatedValue: 2000, stageChangedAt: daysAgo(20) },
  { stage: "WON", estimatedValue: 3500 },
  { stage: "LOST", estimatedValue: 6000, lostReason: "PRICE" },
];

describe("client money and deals", () => {
  it("separates received, to receive and overdue, leaving cancellations out", () => {
    assert.deepEqual(clientFinance(entries, NOW), { received: 1000, toReceive: 800, overdue: 500, overdueCount: 1, costs: 120 });
  });

  it("summarizes the client's pipeline", () => {
    const pipeline = clientPipeline(deals, NOW);
    assert.deepEqual(
      [pipeline.openCount, pipeline.openValue, pipeline.wonCount, pipeline.wonValue, pipeline.lostCount, pipeline.overdueActions],
      [2, 6000, 1, 3500, 1, 1],
    );
    assert.equal(pipeline.forecast, 2200);
  });
});

describe("contact rhythm", () => {
  it("counts days since the last contact", () => {
    assert.equal(daysSinceContact({ lastContactAt: daysAgo(12) }, NOW), 12);
    assert.equal(daysSinceContact({}, NOW), null);
  });

  it("calls a relationship stale after 30 days and never chases an archived one", () => {
    assert.equal(contactState({ status: "ACTIVE", lastContactAt: daysAgo(10) }, NOW), "recent");
    assert.equal(contactState({ status: "ACTIVE", lastContactAt: daysAgo(30) }, NOW), "stale");
    assert.equal(contactState({ status: "ACTIVE" }, NOW), "never");
    assert.equal(contactState({ status: "ARCHIVED" }, NOW), "closed");
  });

  it("stores a picked day at noon UTC, but never in the future", () => {
    assert.equal(contactTimestampForDay("2026-09-01", NOW), "2026-09-01T12:00:00.000Z");
    const early = new Date("2026-09-20T10:30:00.000Z");
    assert.equal(contactTimestampForDay("2026-09-20", early), early.toISOString(), "before noon UTC, today is now");
    assert.equal(contactTimestampForDay("2026-09-25", NOW), "2026-09-25T12:00:00.000Z", "a future day is not capped, so it can be refused");
    assert.equal(contactTimestampForDay("", NOW), null);
  });
});

describe("relationship signals", () => {
  it("puts money and missed actions first, then contact and stalled deals", () => {
    const signals = relationshipSignals({ client: { status: "ACTIVE", lastContactAt: daysAgo(45) }, entries, deals, now: NOW });
    assert.deepEqual(signals.map((signal) => signal.key), ["overdue", "dealAction", "stale", "stalledDeal"]);
    assert.equal(signals[0].params.amount, 500);
  });

  it("flags a lead with nothing in the pipeline", () => {
    const signals = relationshipSignals({ client: { status: "LEAD", lastContactAt: daysAgo(2) }, now: NOW });
    assert.deepEqual(signals.map((signal) => signal.key), ["leadNoDeal"]);
  });

  it("asks nothing of an archived client", () => {
    assert.deepEqual(relationshipSignals({ client: { status: "ARCHIVED" }, entries, deals, now: NOW }), []);
  });

  it("does not chase an inactive client with nothing open", () => {
    assert.deepEqual(relationshipSignals({ client: { status: "INACTIVE" }, now: NOW }), []);
  });
});

describe("duplicates", () => {
  const clients = [
    { id: "a", name: "João Pereira", email: "Joao@Aurora.com", phone: "+55 21 90000-0001" },
    { id: "b", name: "Maria", email: "maria@example.com", phone: "" },
  ];

  it("matches by email, accent-insensitive name or the last eight phone digits", () => {
    assert.deepEqual(findDuplicates({ email: "joao@aurora.com" }, clients).map((match) => [match.client.id, match.reasons]), [["a", ["email"]]]);
    assert.deepEqual(findDuplicates({ name: "joao  pereira" }, clients).map((match) => match.reasons), [["name"]]);
    assert.deepEqual(findDuplicates({ phone: "(21) 90000-0001" }, clients).map((match) => match.reasons), [["phone"]]);
  });

  it("never reports a record as a duplicate of itself", () => {
    assert.deepEqual(findDuplicates({ id: "a", name: "João Pereira" }, clients), []);
  });
});

describe("contact links", () => {
  it("builds wa.me links, adding Brazil's code when missing", () => {
    assert.equal(whatsappLink("(21) 90000-0004"), "https://wa.me/5521900000004");
    assert.equal(whatsappLink("+55 21 90000-0004"), "https://wa.me/5521900000004");
    assert.equal(whatsappLink("123"), "");
  });

  it("offers mailto and tel only for usable values", () => {
    assert.equal(mailtoLink("ops@aurora.com"), "mailto:ops@aurora.com");
    assert.equal(mailtoLink("not an email"), "");
    assert.equal(telLink("+55 21 90000-0004"), "tel:+5521900000004");
    assert.equal(telLink(""), "");
  });

  it("shows two initials", () => {
    assert.equal(initials("Lucas Souza"), "LS");
    assert.equal(initials("INK Tattoo Studio"), "IS");
    assert.equal(initials("Aurora"), "AU");
    assert.equal(initials(""), "?");
  });
});

describe("hub order and focus", () => {
  const rows = [
    { client: { name: "B", updatedAt: "2026-09-01", lastContactAt: daysAgo(5), status: "ACTIVE" }, finance: { received: 100, toReceive: 0, overdue: 0 }, pipeline: { openCount: 0 } },
    { client: { name: "A", updatedAt: "2026-09-10", lastContactAt: null, status: "ACTIVE" }, finance: { received: 900, toReceive: 50, overdue: 50 }, pipeline: { openCount: 1 } },
    { client: { name: "C", updatedAt: "2026-08-01", lastContactAt: daysAgo(40), status: "LEAD" }, finance: { received: 0, toReceive: 300, overdue: 0 }, pipeline: { openCount: 0 } },
  ];
  const names = (list) => list.map((row) => row.client.name);

  it("sorts by update, name, oldest contact, revenue and receivable", () => {
    assert.deepEqual(names(sortClients(rows, "updated")), ["A", "B", "C"]);
    assert.deepEqual(names(sortClients(rows, "name")), ["A", "B", "C"]);
    assert.deepEqual(names(sortClients(rows, "contact")), ["A", "C", "B"], "never contacted comes first");
    assert.deepEqual(names(sortClients(rows, "revenue")), ["A", "B", "C"]);
    assert.deepEqual(names(sortClients(rows, "receivable")), ["C", "A", "B"]);
  });

  it("focuses on quiet, overdue or deal-carrying clients", () => {
    assert.deepEqual(names(rows.filter((row) => matchesFocus(row, "stale", NOW))), ["A", "C"]);
    assert.deepEqual(names(rows.filter((row) => matchesFocus(row, "overdue", NOW))), ["A"]);
    assert.deepEqual(names(rows.filter((row) => matchesFocus(row, "deals", NOW))), ["A"]);
  });
});

describe("recording a contact", () => {
  beforeEach(() => {
    resetMockClients();
    resetMockActivity();
  });

  it("moves the last contact and logs the conversation on the client", async () => {
    await recordContact("mock-client-002", { channel: "WHATSAPP", note: "Approved the scope.", day: "2026-09-15" });
    const client = await getClient("mock-client-002");
    assert.equal(client.lastContactAt, "2026-09-15T12:00:00.000Z");
    const [entry] = await getActivity();
    assert.equal(entry.action, "client.contacted");
    assert.equal(entry.entityId, "mock-client-002");
    assert.match(entry.detail, /WHATSAPP: Approved the scope\./);
  });

  it("keeps a newer contact date when an older conversation is logged", async () => {
    await recordContact("mock-client-002", { channel: "CALL", day: "2026-09-15" });
    await recordContact("mock-client-002", { channel: "EMAIL", day: "2026-09-01" });
    assert.equal((await getClient("mock-client-002")).lastContactAt, "2026-09-15T12:00:00.000Z");
    assert.equal((await getActivity()).length, 2, "both conversations are in the history");
  });

  it("refuses an unknown channel, a future day and a missing client", async () => {
    await assert.rejects(recordContact("mock-client-002", { channel: "PIGEON" }), (error) => error.field === "channel");
    await assert.rejects(recordContact("mock-client-002", { channel: "CALL", day: "2999-01-01" }), (error) => error.field === "day");
    await assert.rejects(recordContact("missing", { channel: "CALL" }), (error) => error.code === "not_found");
  });
});
