// Pure derivations behind the Dashboard command center. No DOM and no browser:
// every function under test takes its data as an argument.
//
//   npm test

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  activeClients,
  activeEngagements,
  adminDataStatus,
  barPercent,
  financialTotals,
  followUps,
  openOpportunities,
  operationalChecks,
  pendingReceivables,
  periodStart,
  pipelineSummary,
  projectChecks,
  projectHealth,
  rankAttention,
  withinPeriod,
} from "../src/utils/dashboard-metrics.js";

const NOW = new Date("2026-09-20T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function daysBefore(days, reference = NOW) {
  return new Date(reference.getTime() - days * DAY).toISOString();
}

const clients = [
  {
    id: "001",
    name: "Active One",
    status: "ACTIVE",
    lastContactAt: daysBefore(2),
    projects: [{ status: "ACTIVE" }, { status: "COMPLETED" }],
  },
  {
    id: "002",
    name: "Active Two",
    status: "ACTIVE",
    lastContactAt: daysBefore(45),
    projects: [{ status: "ACTIVE" }],
  },
  { id: "003", name: "Fresh Lead", status: "LEAD", lastContactAt: daysBefore(1), projects: [] },
  {
    id: "004",
    name: "Old Archive",
    status: "ARCHIVED",
    lastContactAt: daysBefore(200),
    projects: [{ status: "COMPLETED" }],
  },
];

const opportunities = [
  { id: "a", stage: "NEW", priority: "HIGH", client: "ACME", activity: "Received 2h ago" },
  { id: "b", stage: "CONTACTED", priority: "LOW", client: "BETA", activity: "Contacted yesterday" },
  { id: "c", stage: "PROPOSAL", priority: "MEDIUM", client: "GAMMA", activity: "Proposal sent 5d ago" },
  { id: "d", stage: "WON", priority: "HIGH", client: "DELTA", activity: "Closed 6d ago" },
];

const transactions = [
  { type: "INCOME", status: "PAID", amount: 1000, date: daysBefore(2), description: "Installment", client: "Active One" },
  { type: "EXPENSE", status: "PAID", amount: -250, date: daysBefore(3), description: "Infrastructure", client: null },
  { type: "RECEIVABLE", status: "PENDING", amount: 400, date: daysBefore(4), description: "Second installment", client: "Active Two" },
  { type: "INCOME", status: "PAID", amount: 5000, date: daysBefore(70), description: "Old payment", client: "Active One" },
];

describe("period windows", () => {
  it("starts a month period on the first of the current month", () => {
    const start = periodStart("month", NOW);
    assert.equal(start.getDate(), 1);
    assert.equal(start.getMonth(), NOW.getMonth());
  });

  it("starts a year period on january first", () => {
    const start = periodStart("year", NOW);
    assert.equal(start.getMonth(), 0);
    assert.equal(start.getDate(), 1);
  });

  it("excludes records older than a rolling window", () => {
    assert.equal(withinPeriod(daysBefore(10), "30d", NOW), true);
    assert.equal(withinPeriod(daysBefore(40), "30d", NOW), false);
  });

  it("rejects unparsable dates instead of counting them", () => {
    assert.equal(withinPeriod("not-a-date", "90d", NOW), false);
  });
});

describe("financial totals", () => {
  it("counts only settled money and derives the result", () => {
    const totals = financialTotals(transactions, "30d", NOW);
    assert.equal(totals.revenue, 1000);
    assert.equal(totals.expenses, 250);
    assert.equal(totals.result, 750);
  });

  it("never counts a pending receivable as revenue", () => {
    const totals = financialTotals(transactions, "90d", NOW);
    assert.equal(totals.revenue, 6000, "both paid incomes, receivable excluded");
  });

  it("scopes to the selected period", () => {
    assert.equal(financialTotals(transactions, "30d", NOW).transactions.length, 3);
    assert.equal(financialTotals(transactions, "90d", NOW).transactions.length, 4);
  });

  it("returns zeroes rather than NaN for an empty window", () => {
    const totals = financialTotals([], "month", NOW);
    assert.deepEqual([totals.revenue, totals.expenses, totals.result], [0, 0, 0]);
  });
});

describe("open receivables", () => {
  // One source of truth: whatever is still pending in the ledger, never a
  // standing summary total that can drift away from it.
  const ledger = [
    { type: "RECEIVABLE", status: "PENDING", amount: 1000 },
    { type: "RECEIVABLE", status: "PENDING", amount: 1750 },
    { type: "RECEIVABLE", status: "PAID", amount: 900 },
    { type: "INCOME", status: "PAID", amount: 3200 },
    { type: "EXPENSE", status: "PAID", amount: -160 },
  ];

  it("totals every pending receivable", () => {
    assert.equal(pendingReceivables(ledger), 2750);
  });

  it("ignores a receivable that has already been settled", () => {
    assert.equal(pendingReceivables([{ type: "RECEIVABLE", status: "PAID", amount: 900 }]), 0);
  });

  it("ignores income and expenses entirely", () => {
    const notReceivables = ledger.filter((entry) => entry.type !== "RECEIVABLE");
    assert.equal(pendingReceivables(notReceivables), 0);
  });

  it("returns zero for an empty ledger", () => {
    assert.equal(pendingReceivables([]), 0);
  });

  it("never counts a pending receivable as revenue at the same time", () => {
    const totals = financialTotals(ledger.map((entry) => ({ ...entry, date: daysBefore(1) })), "30d", NOW);
    assert.equal(totals.revenue, 3200, "only the settled income");
    assert.equal(pendingReceivables(ledger), 2750, "and the receivables stay separate");
  });
});

describe("bar percentages", () => {
  it("clamps between 0 and 100 and survives a zero maximum", () => {
    assert.equal(barPercent(5, 10), 50);
    assert.equal(barPercent(20, 10), 100);
    assert.equal(barPercent(5, 0), 0);
  });
});

describe("primary indicators", () => {
  it("counts active engagements rather than published cases", () => {
    assert.equal(activeEngagements(clients), 2);
  });

  it("counts only clients with an active relationship", () => {
    assert.equal(activeClients(clients), 2);
  });

  it("treats won deals as closed", () => {
    assert.equal(openOpportunities(opportunities), 3);
  });
});

describe("pipeline summary", () => {
  const stages = [
    { id: "NEW", label: "NEW" },
    { id: "CONTACTED", label: "CONTACTED" },
    { id: "PROPOSAL", label: "PROPOSAL" },
    { id: "NEGOTIATION", label: "NEGOTIATION" },
    { id: "WON", label: "WON" },
  ];

  it("counts every stage, including empty ones", () => {
    const summary = pipelineSummary(stages, opportunities);
    assert.deepEqual(
      summary.stages.map((stage) => [stage.id, stage.count]),
      [["NEW", 1], ["CONTACTED", 1], ["PROPOSAL", 1], ["NEGOTIATION", 0], ["WON", 1]],
    );
  });

  it("excludes won deals from open and high priority counts", () => {
    const summary = pipelineSummary(stages, opportunities);
    assert.equal(summary.open, 3);
    assert.equal(summary.highPriority, 1, "the won HIGH deal does not count");
  });

  it("keeps the maximum at least one so bars never divide by zero", () => {
    assert.equal(pipelineSummary(stages, []).max, 1);
  });
});

describe("needs attention", () => {
  const projects = [
    { id: "p1", caseNumber: "001", name: "Hidden case", editorialStatus: "PUBLISHED", visible: false, poster: "x", description: "ok" },
    { id: "p2", caseNumber: "002", name: "Draft case", editorialStatus: "DRAFT", visible: true, poster: "", description: "" },
    { id: "p3", caseNumber: "003", name: "Healthy case", editorialStatus: "PUBLISHED", visible: true, poster: "x", description: "ok" },
  ];

  it("keeps the editorial checks the previous dashboard derived", () => {
    const details = projectChecks(projects).map((item) => item.detail);
    assert.equal(details.filter((detail) => detail.includes("published but hidden")).length, 1);
    assert.equal(details.filter((detail) => detail.includes("missing poster")).length, 1);
    assert.equal(details.filter((detail) => detail.includes("still a draft")).length, 1);
    assert.equal(details.filter((detail) => detail.includes("missing description")).length, 1);
  });

  it("ignores healthy projects", () => {
    assert.equal(projectChecks([projects[2]]).length, 0);
  });

  it("raises pending receivables and high priority deals from demo data", () => {
    const items = operationalChecks({ transactions, opportunities });
    assert.equal(items.filter((item) => item.category === "FINANCIAL").length, 1);
    assert.equal(items.filter((item) => item.category === "COMMERCIAL").length, 1, "the open high priority deal");
  });

  it("leaves proposals to the follow up queue so no deal is listed twice", () => {
    const attention = operationalChecks({ transactions, opportunities }).map((item) => item.title);
    const queue = followUps({ clients, opportunities }, NOW).map((item) => item.title);
    assert.equal(attention.includes("GAMMA"), false, "the proposal is not an attention item");
    assert.ok(queue.includes("GAMMA"), "the proposal is a follow up");
  });

  it("guarantees the editorial checks a place even when demo items flood the list", () => {
    const flood = Array.from({ length: 6 }, (_, index) => ({
      weight: 10,
      category: "FINANCIAL",
      title: `Receivable ${index}`,
      detail: "pending",
      href: "#/financial",
    }));
    const ranked = rankAttention([...flood, ...projectChecks(projects)]);
    // The quota reserves a slot per domain first, then urgency backfills the
    // rest — so money still dominates, but never takes the whole list.
    assert.equal(ranked.length, 6);
    assert.ok(ranked.filter((item) => item.category === "CMS").length >= 2, "editorial checks still surface");
    assert.ok(ranked.filter((item) => item.category === "FINANCIAL").length < 6, "one source cannot fill the list");
  });

  it("puts money ahead of editorial hygiene and caps the list", () => {
    const ranked = rankAttention([...operationalChecks({ transactions, opportunities }), ...projectChecks(projects)]);
    assert.equal(ranked[0].category, "FINANCIAL");
    assert.ok(ranked.length <= 6);
    assert.deepEqual(
      [...ranked].map((item) => item.weight),
      [...ranked].map((item) => item.weight).sort((a, b) => a - b),
      "ordered by weight",
    );
  });
});

describe("follow ups", () => {
  it("leads first, then proposals awaiting a reply, then quiet relationships", () => {
    const items = followUps({ clients, opportunities }, NOW);
    assert.deepEqual(items.map((item) => item.category), ["LEAD", "PROPOSAL", "CLIENT"]);
  });

  it("derives a stale relationship from the last contact date", () => {
    const stale = followUps({ clients, opportunities }, NOW).find((item) => item.category === "CLIENT");
    assert.ok(stale, "a client untouched for 45 days is surfaced");
    assert.match(stale.detail, /No contact in 4[45] days/);
  });

  it("never chases an archived relationship", () => {
    const items = followUps({ clients, opportunities }, NOW, 10);
    assert.equal(items.some((item) => item.title === "Old Archive"), false);
  });

  it("caps the queue", () => {
    assert.ok(followUps({ clients, opportunities }, NOW).length <= 4);
  });
});

describe("system health", () => {
  const projects = [
    { id: "p1", caseNumber: "001", editorialStatus: "PUBLISHED", visible: true, poster: "x", description: "ok" },
    { id: "p2", caseNumber: "002", editorialStatus: "DRAFT", visible: false, poster: "", description: "" },
    { id: "p3", caseNumber: "003", editorialStatus: "ARCHIVED", visible: false, poster: "x", description: "ok" },
  ];

  it("derives publication counts from the real project records", () => {
    const health = projectHealth(projects);
    assert.equal(health.published, 1);
    assert.equal(health.drafts, 1);
    assert.equal(health.archived, 1);
    assert.equal(health.hidden, 2);
    assert.ok(health.issues > 0);
  });

  it("only reports connected when both admin queries came back", () => {
    assert.equal(adminDataStatus({ projectsOk: true, activityOk: true }).label, "CONNECTED");
    assert.equal(adminDataStatus({ projectsOk: true, activityOk: false }).label, "DEGRADED");
    assert.equal(adminDataStatus({ projectsOk: false, activityOk: true }).label, "DEGRADED");
    assert.equal(adminDataStatus({ projectsOk: false, activityOk: false }).label, "UNAVAILABLE");
  });

  it("names which query failed instead of a generic warning", () => {
    assert.match(adminDataStatus({ projectsOk: true, activityOk: false }).detail, /Activity/);
    assert.match(adminDataStatus({ projectsOk: false, activityOk: true }).detail, /Project/);
  });

  it("a failing activity read can never be reported as connected", () => {
    const status = adminDataStatus({ projectsOk: true, activityOk: false });
    assert.notEqual(status.label, "CONNECTED");
    assert.equal(status.tone, "warn");
  });
});
