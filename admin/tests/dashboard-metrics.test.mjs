// Pure derivations behind the Dashboard command center. No DOM and no browser:
// every function under test takes its data as an argument.
//
//   npm test

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  SECURITY_ALERT_ACTIONS,
  activeClients,
  activeEngagements,
  approvalChecks,
  barPercent,
  contactLevel,
  financialTotals,
  followUps,
  liveProjects,
  openOpportunities,
  operationStatus,
  operationalChecks,
  periodStart,
  pipelineSummary,
  projectChecks,
  projectHealth,
  rankAttention,
  receivablesSummary,
  securityAlerts,
  withinPeriod,
} from "../src/utils/dashboard-metrics.js";
import { mapClientFromDatabase } from "../src/services/mappers/client-mapper.js";

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
  },
  {
    id: "002",
    name: "Active Two",
    status: "ACTIVE",
    lastContactAt: daysBefore(45),
  },
  { id: "003", name: "Fresh Lead", status: "LEAD", lastContactAt: daysBefore(1) },
  {
    id: "004",
    name: "Old Archive",
    status: "ARCHIVED",
    lastContactAt: daysBefore(200),
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

describe("receivables summary", () => {
  const today = "2026-09-20";
  const ledger = [
    { type: "INCOME", status: "PENDING", amount: 75, dueDate: "2026-09-10", description: "Domain renewal" },
    { type: "INCOME", status: "PENDING", amount: 73, dueDate: "2026-10-05", description: "Domain" },
    { type: "INCOME", status: "PAID", amount: 900, dueDate: "2026-09-01", paidAt: "2026-09-02", description: "Paid" },
    { type: "INCOME", status: "CANCELLED", amount: 500, dueDate: "2026-09-01", description: "Cancelled" },
    { type: "EXPENSE", status: "PENDING", amount: 40, dueDate: "2026-09-15", description: "Hosting" },
  ];

  it("says how many charges are behind the amount, and how many are late", () => {
    const summary = receivablesSummary(ledger, new Date(`${today}T12:00:00`));
    assert.equal(summary.total, 148);
    assert.equal(summary.count, 2);
    assert.equal(summary.overdueCount, 1);
    assert.equal(summary.overdueTotal, 75);
  });

  it("keeps what is owed by the studio apart from what is owed to it", () => {
    const summary = receivablesSummary(ledger, new Date(`${today}T12:00:00`));
    assert.equal(summary.toPay, 40);
    assert.equal(summary.overduePayable, 40);
  });

  it("never counts settled or cancelled entries as pending", () => {
    const summary = receivablesSummary(ledger.filter((entry) => entry.status !== "PENDING"));
    assert.deepEqual([summary.total, summary.count, summary.overdueCount, summary.toPay], [0, 0, 0, 0]);
  });

  it("agrees with the period totals about what is revenue: a pending charge is not", () => {
    // "R$ 148 to receive" and "R$ 0 this month" are both true at once.
    const pendingOnly = ledger.filter((entry) => entry.status === "PENDING");
    assert.equal(receivablesSummary(pendingOnly, NOW).total, 148);
    assert.equal(financialTotals(pendingOnly, "month", NOW).revenue, 0);
    assert.equal(financialTotals(pendingOnly, "month", NOW).result, 0);
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
    const engagements = [
      { clientId: "001", status: "In Development", editorialStatus: "DRAFT" },
      { clientId: "001", status: "Pilot", editorialStatus: "PUBLISHED" },
      { clientId: "002", status: "Live", editorialStatus: "PUBLISHED" },
      { clientId: "002", status: "MVP", editorialStatus: "ARCHIVED" },
      { clientId: null, status: "In Development", editorialStatus: "DRAFT" },
    ];
    // Delivered, editorially archived and client-less work is not an engagement.
    assert.equal(activeEngagements(engagements), 2);
  });

  it("counts shipped work apart from work in delivery", () => {
    const projects = [
      { id: "1", clientId: "001", status: "In Development", editorialStatus: "DRAFT" },
      { id: "2", clientId: "001", status: "Live", editorialStatus: "PUBLISHED" },
      { id: "3", clientId: null, status: "Live", editorialStatus: "PUBLISHED" },
      { id: "4", clientId: "002", status: "Live", editorialStatus: "ARCHIVED" },
    ];
    // "0 in delivery" next to four LIVE badges was the contradiction: the two
    // counts answer different questions, so both are shown.
    assert.equal(liveProjects(projects), 2, "live and not archived, with or without a client");
    assert.equal(activeEngagements(projects), 1);
    assert.equal(liveProjects([]), 0);
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

  it("grades each item: late money and broken publication are critical, hygiene is normal", () => {
    const byDetail = (items, text) => items.find((item) => item.detail.includes(text));
    const checks = projectChecks(projects);
    assert.equal(byDetail(checks, "published but hidden").priority, "critical");
    assert.equal(byDetail(checks, "missing poster").priority, "attention");
    assert.equal(byDetail(checks, "still a draft").priority, "normal");
    assert.equal(byDetail(checks, "missing description").priority, "normal");

    const now = new Date("2026-09-20T12:00:00");
    const money = operationalChecks(
      {
        transactions: [
          { type: "INCOME", status: "PENDING", amount: 10, dueDate: "2026-09-01", description: "Late" },
          { type: "INCOME", status: "PENDING", amount: 20, dueDate: "2026-09-20", description: "Today" },
          { type: "INCOME", status: "PENDING", amount: 30, dueDate: "2026-10-20", description: "Later" },
          { type: "EXPENSE", status: "PENDING", amount: 40, dueDate: "2026-09-01", description: "Bill" },
          { type: "EXPENSE", status: "PENDING", amount: 50, dueDate: "2026-10-01", description: "Not due" },
        ],
      },
      now,
    );
    assert.deepEqual(
      money.map((item) => [item.detailParams.description, item.priority]),
      [
        ["Late", "critical"],
        ["Today", "today"],
        ["Later", "attention"],
        ["Bill", "critical"],
      ],
      "a bill that is not due yet asks for nothing",
    );
    assert.equal(byDetail(money, "Today").detailKey, "dashboard.attention.transactionDueToday");
    const ranked = rankAttention(money, 6, 6).map((item) => item.priority);
    assert.deepEqual(ranked, ["critical", "critical", "today", "attention"], "late first, then today, then open");
  });

  it("flags a missed next action as critical and an open high priority deal as attention", () => {
    const now = new Date("2026-09-20T12:00:00");
    const items = operationalChecks(
      {
        opportunities: [
          { id: "a", stage: "NEW", priority: "HIGH", client: "ACME" },
          { id: "b", stage: "CONTACTED", priority: "LOW", client: "BETA", nextAction: "Call", nextActionAt: "2026-09-01" },
        ],
      },
      now,
    );
    assert.deepEqual(
      items.map((item) => [item.title, item.priority]),
      [
        ["ACME", "attention"],
        ["BETA", "critical"],
      ],
    );
  });

  it("turns changes waiting for review into one item, and none when there is nothing to review", () => {
    assert.deepEqual(approvalChecks(0), []);
    assert.deepEqual(approvalChecks(null), [], "a count that failed is not zero pending, and not an item either");
    assert.deepEqual(approvalChecks(undefined), []);
    const [item, ...rest] = approvalChecks(3);
    assert.equal(rest.length, 0, "one item however many requests");
    assert.equal(item.category, "APPROVAL");
    assert.equal(item.href, "#/approvals");
    assert.equal(item.detailParams.count, 3);
    assert.equal(item.priority, "attention");
    // After money, before deals and editorial checks.
    const ranked = rankAttention([...projectChecks(projects), ...approvalChecks(3), ...operationalChecks({ transactions, opportunities })]);
    assert.deepEqual(ranked.slice(0, 2).map((entry) => entry.category), ["FINANCIAL", "APPROVAL"]);
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

  it("grades how late a contact is, without shouting before 60 days", () => {
    assert.deepEqual(
      [0, 30, 31, 60, 61, 90, 91, 400].map(contactLevel),
      ["normal", "normal", "attention", "attention", "alert", "alert", "priority", "priority"],
    );
    assert.equal(contactLevel(undefined), "normal");
    assert.equal(contactLevel(Number.NaN), "normal");
  });

  it("carries that grade on each quiet relationship, and on nothing else", () => {
    const quiet = (days) => ({ id: `c${days}`, name: `Quiet ${days}`, status: "ACTIVE", lastContactAt: daysBefore(days) });
    const items = followUps({ clients: [quiet(45), quiet(70), quiet(125), { id: "lead", name: "Lead", status: "LEAD" }] }, NOW, 10);
    assert.deepEqual(
      items.map((item) => [item.category, item.days, item.level]),
      [
        ["LEAD", undefined, undefined],
        ["CLIENT", 45, "attention"],
        ["CLIENT", 70, "alert"],
        ["CLIENT", 125, "priority"],
      ],
    );
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

  it("only reports connected when every read it made came back", () => {
    const reads = (projects, logs) => [
      { id: "projects", ok: projects },
      { id: "logs", ok: logs },
    ];
    assert.equal(operationStatus(reads(true, true)).label, "CONNECTED");
    assert.equal(operationStatus(reads(true, false)).label, "DEGRADED");
    assert.equal(operationStatus(reads(false, true)).label, "DEGRADED");
    assert.equal(operationStatus(reads(false, false)).label, "UNAVAILABLE");
  });

  it("names which read failed instead of a generic warning", () => {
    const status = operationStatus([
      { id: "projects", ok: true },
      { id: "financial", ok: false },
      { id: "commercial", ok: false },
      { id: "logs", ok: true },
    ]);
    assert.deepEqual(status.failed, ["financial", "commercial"]);
    assert.equal(status.state, "degraded");
  });

  it("a failing read can never be reported as connected", () => {
    const status = operationStatus([
      { id: "projects", ok: true },
      { id: "logs", ok: false },
    ]);
    assert.notEqual(status.label, "CONNECTED");
    assert.equal(status.tone, "warn");
  });

  it("does not report a module the member may not read as an outage", () => {
    // null: the read was never sent. It is neither a success nor a failure.
    const status = operationStatus([
      { id: "projects", ok: true },
      { id: "financial", ok: null },
      { id: "logs", ok: null },
    ]);
    assert.deepEqual([status.state, status.label, status.failed], ["ok", "CONNECTED", []]);
    const down = operationStatus([
      { id: "projects", ok: false },
      { id: "financial", ok: null },
    ]);
    assert.equal(down.state, "down", "the only read that was made failed");
    assert.equal(down.tone, "danger");
  });
});

describe("security alerts", () => {
  const now = new Date("2026-09-20T12:00:00.000Z");
  const at = (minutes) => new Date(now.getTime() - minutes * 60_000).toISOString();
  const line = (id, action, minutes) => ({ id, action, createdAt: at(minutes) });

  it("keeps only what deserves a look: lost access, ended sessions, changed rules", () => {
    const trail = [
      line(1, "LOGIN_SUCCESS", 1),
      line(2, "SESSION_REVOKED", 15),
      line(3, "ROLE_ASSIGNED", 20),
      line(4, "ACCESS_UPDATED", 25),
      line(5, "APPROVAL_REJECTED", 30),
      line(6, "MFA_REMOVED", 40),
      line(7, "PROJECT_PUBLISHED", 50),
    ];
    assert.deepEqual(securityAlerts(trail, now).map((entry) => entry.action), ["SESSION_REVOKED", "MFA_REMOVED"]);
    for (const action of ["LOGIN_SUCCESS", "ROLE_ASSIGNED", "ACCESS_UPDATED", "APPROVAL_REQUESTED", "PROJECT_UPDATED"]) {
      assert.equal(SECURITY_ALERT_ACTIONS.includes(action), false, `${action} stays on the Audit page`);
    }
  });

  it("is recent or it is not an alert: 72 hours, newest first", () => {
    const trail = [line(1, "USER_SUSPENDED", 60 * 71), line(2, "SESSION_REVOKED", 60 * 73), line(3, "PERMISSION_CHANGED", 5)];
    assert.deepEqual(securityAlerts(trail, now).map((entry) => entry.id), [3, 1]);
    assert.deepEqual(securityAlerts(trail, now, 1).map((entry) => entry.id), [3], "a shorter window");
  });

  it("leaves out an entry it cannot date, and says nothing for an empty trail", () => {
    assert.deepEqual(securityAlerts([{ id: 1, action: "SESSION_REVOKED", createdAt: "not a date" }, { id: 2, action: "SESSION_REVOKED" }], now), []);
    assert.deepEqual(securityAlerts([line(1, "SESSION_REVOKED", -5)], now), [], "nor one dated in the future");
    assert.deepEqual(securityAlerts([], now), []);
    assert.deepEqual(securityAlerts(undefined, now), []);
  });
});

// Clients as the repository returns them: straight from database rows, so the
// rule is exercised on the real last_contact_at column, not on a demo field.
describe("follow ups from a recorded last contact", () => {
  const row = (name, status, lastContact) =>
    mapClientFromDatabase({ id: name, code: "CLIENT-001", name, status, last_contact_at: lastContact });
  const quiet = (items) => items.filter((item) => item.category === "CLIENT").map((item) => item.title);

  it("surfaces an active client whose last recorded contact is old", () => {
    const items = followUps({ clients: [row("Active Old", "ACTIVE", daysBefore(45))] }, NOW);
    assert.deepEqual(quiet(items), ["Active Old"]);
    assert.equal(items[0].detailParams.days, 45);
  });

  it("applies the same rule to an inactive client with an old contact", () => {
    // The rule only leaves out leads and archived clients.
    const items = followUps({ clients: [row("Inactive Old", "INACTIVE", daysBefore(60))] }, NOW);
    assert.deepEqual(quiet(items), ["Inactive Old"]);
  });

  it("stays quiet about a recent contact", () => {
    const items = followUps({ clients: [row("Recent", "ACTIVE", daysBefore(5))] }, NOW);
    assert.deepEqual(quiet(items), []);
  });

  it("never invents a contact for a client with none recorded", () => {
    const items = followUps({ clients: [row("Never", "ACTIVE", null)] }, NOW);
    assert.deepEqual(quiet(items), []);
  });

  it("reads a timestamp with any offset as the same instant", () => {
    const offset = new Date(new Date(daysBefore(40)).getTime()).toISOString().replace("Z", "+00:00");
    const items = followUps({ clients: [row("Offset", "ACTIVE", offset)] }, NOW);
    assert.equal(items[0].detailParams.days, 40);
  });
});
