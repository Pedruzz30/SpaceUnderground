// What a win leaves behind when one of its steps fails, and what a retry does
// with it. A win can close the deal, create the client, link it and put the
// value in the ledger; each step is a separate write, so any of them can fail
// on its own. Every scenario checks two things: the state right after the
// failure, and that retrying the win finishes the job without a second client
// or a second set of receivables.
//
//   npm test

import { strict as assert } from "node:assert";
import { afterEach, beforeEach, describe, it } from "node:test";

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
const { clearMockCommercial, mockCommercialRepository } = await import("../src/services/repositories/mock-commercial-repository.js");
const { clearMockFinancial, mockFinancialRepository } = await import("../src/services/repositories/mock-financial-repository.js");
const { mockClientRepository, resetMockClients } = await import("../src/services/repositories/mock-client-repository.js");
const { resetMockActivity } = await import("../src/services/repositories/mock-activity-repository.js");
const { getActivity } = await import("../src/services/activity-service.js");
const { getClients } = await import("../src/services/client-service.js");
const { getTransactions } = await import("../src/services/financial-service.js");
const { createOpportunity, getOpportunity, reopenOpportunity, winOpportunity } = await import("../src/services/commercial-service.js");

setLocale("en", { persist: false });

const lead = {
  title: "Institutional website",
  contactName: "Marina Costa",
  company: "Estúdio Norte",
  email: "marina@example.com",
  estimatedValue: "3.500,00",
  source: "WEBSITE",
};

const WIN = { createClientRecord: true, receivable: { amount: "3.500,00", installments: 2, dueDate: "2026-10-10" } };
const offline = () => Object.assign(new TypeError("Failed to fetch"), { code: "network_error" });

// Makes one repository method fail once, only for calls that match. The
// original method is restored after the first failure and after each test.
const restores = [];
function failOnce(repository, method, matches = () => true, { after = false } = {}) {
  const original = repository[method];
  restores.push(() => {
    repository[method] = original;
  });
  repository[method] = async function (...args) {
    if (!matches(...args)) return original.apply(this, args);
    repository[method] = original;
    // `after`: the write goes through and only the answer is lost, like a
    // request that committed before the connection dropped.
    if (after) await original.apply(this, args);
    throw offline();
  };
}

const marinas = async () => (await getClients()).filter((client) => client.email === lead.email);
// The ledger starts empty in every test, so every income entry is the win's.
const receivables = async () => (await getTransactions()).filter((entry) => entry.type === "INCOME");
const wins = async () => (await getActivity()).filter((entry) => entry.action === "commercial.won").length;

beforeEach(() => {
  clearMockCommercial();
  clearMockFinancial();
  resetMockClients();
  resetMockActivity();
});

afterEach(() => {
  restores.splice(0).forEach((restore) => restore());
});

describe("a win that fails before anything is written", () => {
  it("stays open and creates nothing when closing the deal fails", async () => {
    const deal = await createOpportunity(lead);
    failOnce(mockCommercialRepository, "update", (id, patch) => patch.stage === "WON");

    await assert.rejects(winOpportunity(deal.id, WIN));
    assert.equal((await getOpportunity(deal.id)).stage, "NEW");
    assert.equal((await marinas()).length, 0);
    assert.equal((await getTransactions()).length, 0);

    const retry = await winOpportunity(deal.id, WIN);
    assert.deepEqual(retry.warnings, []);
    assert.equal((await marinas()).length, 1);
    assert.equal((await receivables()).length, 2);
  });
});

describe("a win that fails half way", () => {
  it("closes the deal and keeps the receivable when the client cannot be created, then finishes on retry", async () => {
    const deal = await createOpportunity(lead);
    failOnce(mockClientRepository, "create");

    const first = await winOpportunity(deal.id, WIN);
    assert.equal(first.opportunity.stage, "WON");
    assert.equal(first.warnings.length, 1, "the missing client is reported");
    assert.equal((await marinas()).length, 0);
    const unlinked = await receivables();
    assert.equal(unlinked.length, 2, "the receivable does not wait for the client");
    assert.ok(unlinked.every((entry) => !entry.clientId));

    const retry = await winOpportunity(deal.id, WIN);
    assert.deepEqual(retry.warnings, []);
    const [client] = await marinas();
    assert.ok(client, "the retry creates the client");
    assert.equal((await getOpportunity(deal.id)).clientId, client.id);
    const linked = await receivables();
    assert.equal(linked.length, 2, "no second set of receivables");
    assert.ok(linked.every((entry) => entry.clientId === client.id), "the existing receivables now point at the client");
    assert.ok(linked.every((entry) => entry.opportunityId === deal.id), "each receivable records the deal it came from");
    assert.equal(await wins(), 1, "the deal is won once");
  });

  it("reuses the client created before the link failed instead of creating another", async () => {
    const deal = await createOpportunity(lead);
    failOnce(mockCommercialRepository, "update", (id, patch) => Object.keys(patch).join() === "clientId");

    const first = await winOpportunity(deal.id, WIN);
    assert.equal(first.warnings.length, 1, "the missing link is reported");
    assert.equal((await marinas()).length, 1);
    assert.equal((await getOpportunity(deal.id)).clientId, null);
    assert.equal((await receivables()).length, 2);

    const retry = await winOpportunity(deal.id, WIN);
    assert.deepEqual(retry.warnings, []);
    const clients = await marinas();
    assert.equal(clients.length, 1, "no second client");
    assert.equal((await getOpportunity(deal.id)).clientId, clients[0].id);
    assert.equal(retry.clientReused, true, "the operator is told the existing client was linked");
    assert.equal((await receivables()).length, 2, "no second set of receivables");
  });

  it("keeps the client and link when the receivable fails, and adds only the receivable on retry", async () => {
    const deal = await createOpportunity(lead);
    failOnce(mockFinancialRepository, "createMany");

    const first = await winOpportunity(deal.id, WIN);
    assert.equal(first.warnings.length, 1, "the missing receivable is reported");
    assert.equal((await marinas()).length, 1);
    assert.equal((await getOpportunity(deal.id)).clientId, first.client.id);
    assert.equal((await getTransactions()).length, 0, "a failed installment set stores no installment");

    const retry = await winOpportunity(deal.id, WIN);
    assert.deepEqual(retry.warnings, []);
    assert.equal((await marinas()).length, 1, "no second client");
    assert.equal((await receivables()).length, 2);
    assert.equal(await wins(), 1);
  });

  it("does not repeat installments whose write went through before the answer was lost", async () => {
    const deal = await createOpportunity(lead);
    failOnce(mockFinancialRepository, "createMany", () => true, { after: true });

    const first = await winOpportunity(deal.id, WIN);
    assert.equal(first.warnings.length, 1);
    assert.equal((await receivables()).length, 2, "the write itself went through");

    const retry = await winOpportunity(deal.id, WIN);
    assert.equal(retry.receivableExists, true, "the operator is told the receivable is already there");
    assert.equal((await receivables()).length, 2, "no second set of receivables");
  });

  it("does not duplicate anything when the operator reopens the deal and wins it again", async () => {
    const deal = await createOpportunity(lead);
    failOnce(mockCommercialRepository, "update", (id, patch) => Object.keys(patch).join() === "clientId");
    await winOpportunity(deal.id, WIN);

    await reopenOpportunity(deal.id);
    const again = await winOpportunity(deal.id, WIN);
    assert.deepEqual(again.warnings, []);
    assert.equal((await marinas()).length, 1, "no second client");
    assert.equal((await receivables()).length, 2, "no second set of receivables");
  });
});

describe("a retry that finds everything in place", () => {
  it("changes nothing and says so", async () => {
    const deal = await createOpportunity(lead);
    const first = await winOpportunity(deal.id, WIN);
    assert.deepEqual(first.warnings, []);

    const retry = await winOpportunity(deal.id, WIN);
    assert.deepEqual(retry.warnings, []);
    assert.equal(retry.client, null, "no client created");
    assert.equal(retry.receivableExists, true);
    assert.deepEqual(retry.transactions, []);
    assert.equal((await marinas()).length, 1);
    assert.equal((await receivables()).length, 2);
    assert.equal(await wins(), 1);
  });

  it("still creates a fresh receivable when the earlier one was cancelled", async () => {
    const deal = await createOpportunity(lead);
    await winOpportunity(deal.id, WIN);
    const { cancelTransaction } = await import("../src/services/financial-service.js");
    for (const entry of await receivables()) await cancelTransaction(entry.id);

    const retry = await winOpportunity(deal.id, WIN);
    assert.equal(retry.transactions.length, 2);
    assert.equal((await receivables()).filter((entry) => entry.status === "PENDING").length, 2);
  });
});
