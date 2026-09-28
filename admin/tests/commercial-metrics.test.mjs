// Pipeline rules shared by the Commercial page, its reports and the Dashboard.
//
//   npm test

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  averageDaysToWin,
  daysInStage,
  displayName,
  isActionOverdue,
  isOpen,
  isStale,
  lostReasons,
  normalizeOpportunity,
  pipelineSummary,
  positionBetween,
  renumberColumn,
  sortForBoard,
  stageTotals,
  wonBySource,
} from "../src/utils/commercial-metrics.js";

const NOW = new Date(2026, 8, 20, 12, 0, 0);
const iso = (y, m, d) => new Date(y, m - 1, d, 12).toISOString();

const deals = [
  { id: "new", stage: "NEW", priority: "HIGH", source: "INSTAGRAM", estimatedValue: 10000, title: "System", company: "Academia X", stageChangedAt: iso(2026, 9, 19), nextActionAt: "2026-09-21" },
  { id: "contacted", stage: "CONTACTED", priority: "MEDIUM", source: "REFERRAL", estimatedValue: 5000, title: "Automation", contactName: "Ana", stageChangedAt: iso(2026, 9, 1), nextActionAt: "2026-09-18" },
  { id: "proposal", stage: "PROPOSAL", priority: "LOW", source: "WEBSITE", estimatedValue: 4000, title: "Site", clientName: "Borealis", stageChangedAt: iso(2026, 9, 15) },
  { id: "negotiation", stage: "NEGOTIATION", priority: "HIGH", source: "REFERRAL", estimatedValue: null, title: "Retainer", company: "Pimenta" },
  { id: "won", stage: "WON", source: "REFERRAL", estimatedValue: 3500, title: "Won deal", createdAt: iso(2026, 9, 1), closedAt: iso(2026, 9, 11) },
  { id: "won-old", stage: "WON", source: "INSTAGRAM", estimatedValue: 2000, title: "Old win", createdAt: iso(2026, 6, 1), closedAt: iso(2026, 7, 1) },
  { id: "lost", stage: "LOST", source: "EVENT", estimatedValue: 6000, title: "Lost deal", lostReason: "PRICE", closedAt: iso(2026, 9, 5) },
  { id: "lost-2", stage: "LOST", source: "EVENT", estimatedValue: 1000, title: "Lost again", lostReason: "PRICE", closedAt: iso(2026, 9, 8) },
];

const september = ["2026-09-01", "2026-09-30"];

describe("pipeline summary", () => {
  it("values the open pipeline and weights it by stage", () => {
    const summary = pipelineSummary(deals, september, NOW);
    assert.equal(summary.openCount, 4);
    assert.equal(summary.openValue, 19000);
    // 10000 * 0.1 + 5000 * 0.25 + 4000 * 0.5 + 0 * 0.75
    assert.equal(summary.forecast, 4250);
  });

  it("counts wins and losses inside the period only", () => {
    const summary = pipelineSummary(deals, september, NOW);
    assert.deepEqual([summary.wonCount, summary.wonValue, summary.lostCount], [1, 3500, 2]);
    assert.equal(Math.round(summary.conversion * 1000) / 1000, 0.333);
    assert.equal(summary.averageWon, 3500);
  });

  it("reports no conversion when nothing was decided", () => {
    const summary = pipelineSummary(deals.filter((deal) => !["WON", "LOST"].includes(deal.stage)), september, NOW);
    assert.equal(summary.conversion, null);
    assert.equal(summary.averageWon, null);
  });

  it("counts overdue next actions and open high priority deals", () => {
    const summary = pipelineSummary(deals, september, NOW);
    assert.equal(summary.overdueActions, 1);
    assert.equal(summary.highPriority, 2);
  });
});

describe("deal state", () => {
  it("treats won and lost deals as closed", () => {
    assert.deepEqual(deals.filter(isOpen).map((deal) => deal.id), ["new", "contacted", "proposal", "negotiation"]);
  });

  it("flags a next action whose date has passed, never on a closed deal", () => {
    assert.equal(isActionOverdue(deals[1], NOW), true);
    assert.equal(isActionOverdue(deals[0], NOW), false);
    assert.equal(isActionOverdue({ ...deals[1], stage: "WON" }, NOW), false);
  });

  it("measures days in stage and calls a deal stale after two weeks", () => {
    assert.equal(daysInStage(deals[1], NOW), 19);
    assert.equal(isStale(deals[1], NOW), true);
    assert.equal(isStale(deals[2], NOW), false);
    assert.equal(daysInStage({ stage: "NEW" }, NOW), null);
  });

  it("names the client record first, then the company, then the contact", () => {
    assert.equal(displayName(deals[2]), "Borealis");
    assert.equal(displayName(deals[0]), "Academia X");
    assert.equal(displayName(deals[1]), "Ana");
    assert.equal(displayName({ title: "Only a title" }), "Only a title");
  });

  it("reads the presentation shape: client as a name, unknown values defaulted", () => {
    const legacy = normalizeOpportunity({ stage: "proposal", priority: "urgent", client: "GAMMA" });
    assert.equal(legacy.stage, "PROPOSAL");
    assert.equal(legacy.priority, "MEDIUM");
    assert.equal(displayName(legacy), "GAMMA");
  });
});

describe("pipeline reports", () => {
  it("totals every stage, including empty value", () => {
    const totals = stageTotals(deals);
    assert.deepEqual(
      totals.map((row) => [row.stage, row.count, row.value]),
      [["NEW", 1, 10000], ["CONTACTED", 1, 5000], ["PROPOSAL", 1, 4000], ["NEGOTIATION", 1, 0], ["WON", 2, 5500], ["LOST", 2, 7000]],
    );
  });

  it("ranks loss reasons in the period", () => {
    assert.deepEqual(lostReasons(deals, september), [{ reason: "PRICE", count: 2, share: 1 }]);
  });

  it("ranks won value by source in the period", () => {
    assert.deepEqual(wonBySource(deals, september), [{ source: "REFERRAL", count: 1, value: 3500 }]);
    assert.equal(wonBySource(deals, [null, null]).length, 2);
  });

  it("averages days from creation to a win", () => {
    assert.equal(averageDaysToWin(deals, september), 10);
    assert.equal(averageDaysToWin([], september), null);
  });
});

describe("board order", () => {
  it("places a card between, above or below its neighbours", () => {
    assert.equal(positionBetween(1, 2), 1.5);
    assert.equal(positionBetween(3, undefined), 4);
    assert.equal(positionBetween(undefined, 0), -1);
    assert.equal(positionBetween(undefined, undefined), 0);
  });

  it("renumbers a column in the dropped order, writing only what changed", () => {
    const positions = new Map([["a", 0], ["b", 1], ["c", 1], ["moved", Number.NaN]]);
    assert.deepEqual(renumberColumn(["a", "moved", "b", "c"], positions), [
      { id: "moved", position: 1 },
      { id: "b", position: 2 },
      { id: "c", position: 3 },
    ]);
  });

  it("sorts a column by position, newest first on ties", () => {
    const sorted = sortForBoard([
      { id: "b", position: 1, createdAt: "2026-09-01" },
      { id: "a", position: 0, createdAt: "2026-09-01" },
      { id: "c", position: 1, createdAt: "2026-09-05" },
    ]);
    assert.deepEqual(sorted.map((deal) => deal.id), ["a", "c", "b"]);
  });
});
