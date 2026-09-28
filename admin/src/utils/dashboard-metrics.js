// Pure derivations behind the Dashboard command center.
//
// Every input is real: clients, projects, activity, the financial ledger and
// the commercial pipeline arrive from the configured repository (mock or
// Supabase) through their services.
//
// Nothing here reads a module directly: callers pass the data in, which keeps
// these functions pure and testable.

import { isActiveProject } from "./client-metrics.js";
import { daysInStage, displayName, isActionOverdue, isOpen, normalizeOpportunity } from "./commercial-metrics.js";
import { effectiveDate, financialSummary, isOverdue, normalizeEntry, openPayables, openReceivables } from "./financial-metrics.js";

export const PERIODS = [
  { id: "month", label: "This month", labelKey: "dashboard.periods.month" },
  { id: "30d", label: "Last 30 days", labelKey: "dashboard.periods.30d" },
  { id: "90d", label: "Last 90 days", labelKey: "dashboard.periods.90d" },
  { id: "year", label: "This year", labelKey: "dashboard.periods.year" },
];

const DAY = 24 * 60 * 60 * 1000;

export function periodLabel(id) {
  return PERIODS.find((period) => period.id === id)?.label ?? PERIODS[0].label;
}

export function periodStart(id, now = new Date()) {
  const reference = now instanceof Date ? now : new Date(now);
  if (id === "30d") return new Date(reference.getTime() - 30 * DAY);
  if (id === "90d") return new Date(reference.getTime() - 90 * DAY);
  if (id === "year") return new Date(reference.getFullYear(), 0, 1);
  return new Date(reference.getFullYear(), reference.getMonth(), 1);
}

export function withinPeriod(value, id, now = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date.getTime() >= periodStart(id, now).getTime() && date.getTime() <= (now instanceof Date ? now : new Date(now)).getTime();
}

/* --- KPIs --------------------------------------------------------------- */

// "Active projects" means client engagements in delivery, not published cases:
// a published portfolio entry is an editorial state, not an active job. Only
// projects linked to a client record count, with the Client Hub's own rule.
export function activeEngagements(projects) {
  return projects.filter((project) => project.clientId && isActiveProject(project)).length;
}

export function activeClients(clients) {
  return clients.filter((client) => client.status === "ACTIVE").length;
}

// Won and lost deals are both closed.
export function openOpportunities(opportunities) {
  return opportunities.filter((opportunity) => isOpen(opportunity)).length;
}

/* --- Commercial pipeline ------------------------------------------------ */

export function pipelineSummary(stages, opportunities) {
  const counted = stages.map((stage) => ({
    id: stage.id,
    label: stage.label,
    count: opportunities.filter((opportunity) => opportunity.stage === stage.id).length,
  }));

  const open = opportunities.filter((opportunity) => isOpen(opportunity));

  return {
    stages: counted,
    max: Math.max(1, ...counted.map((stage) => stage.count)),
    open: open.length,
    highPriority: open.filter((opportunity) => opportunity.priority === "HIGH").length,
  };
}

/* --- Financial ----------------------------------------------------------- */

// The period window is the only thing the Dashboard adds: the rules for what
// counts as revenue or an expense live in financial-metrics.js, so this and the
// Financial page can never disagree. "To receive" is deliberately absent — an
// open balance is point-in-time, not something a date range scopes.
export function financialTotals(transactions, periodId, now = new Date()) {
  // An entry's day is a calendar date: read it at local midnight, so an entry
  // dated the 1st is inside "this month" whatever the timezone offset.
  const scoped = transactions.filter((transaction) => {
    const day = effectiveDate(transaction);
    return Boolean(day) && withinPeriod(new Date(`${day}T00:00:00`), periodId, now);
  });
  const { revenue, expenses, result } = financialSummary(scoped);

  return { revenue, expenses, result, transactions: scoped };
}

export function barPercent(value, max) {
  if (!max || max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((value / max) * 100)));
}

/* --- Needs attention ---------------------------------------------------- */

// Lower weight wins. Money first, then deals going cold, then anything that is
// wrong on the public site, then editorial hygiene.
const WEIGHT = {
  receivable: 10,
  highPriority: 20,
  hidden: 40,
  poster: 50,
  draft: 60,
  description: 70,
};

export function operationalChecks({ transactions = [], opportunities = [] } = {}) {
  const items = [];

  // Every open receivable, late ones first and flagged; payables only once
  // they are late, since a bill that is not due yet needs no action.
  const financialItem = (transaction, overdue, detailKey) => {
    const entry = normalizeEntry(transaction);
    return {
      weight: overdue ? WEIGHT.receivable - 1 : WEIGHT.receivable,
      tone: overdue ? "danger" : "warning",
      category: "FINANCIAL",
      title: entry.clientName || entry.client || entry.description,
      detail: `${entry.description} ${overdue ? "overdue" : "pending"}`,
      detailKey,
      detailParams: { description: entry.description },
      amount: entry.amount,
      href: "#/financial",
    };
  };

  openReceivables(transactions).forEach((transaction) => {
    const overdue = isOverdue(transaction);
    items.push(financialItem(transaction, overdue, overdue ? "dashboard.attention.transactionOverdue" : "dashboard.attention.transactionPending"));
  });
  openPayables(transactions)
    .filter((transaction) => isOverdue(transaction))
    .forEach((transaction) => items.push(financialItem(transaction, true, "dashboard.attention.payableOverdue")));

  // One item per deal: a missed next action says so; otherwise an open high
  // priority deal is flagged with whatever activity it carries.
  opportunities.filter((opportunity) => isOpen(opportunity)).forEach((opportunity) => {
    const deal = normalizeOpportunity(opportunity);
    const title = displayName(deal);
    if (isActionOverdue(deal)) {
      items.push({
        weight: WEIGHT.highPriority,
        tone: "danger",
        category: "COMMERCIAL",
        title,
        detail: `Next action overdue · ${deal.nextAction || deal.title}`,
        detailKey: "dashboard.attention.actionOverdue",
        detailParams: { action: deal.nextAction || deal.title },
        href: "#/commercial",
      });
      return;
    }
    if (deal.priority !== "HIGH") return;
    const activity = String(deal.activity || deal.nextAction || "").toLowerCase();
    items.push({
      weight: WEIGHT.highPriority,
      tone: "danger",
      category: "COMMERCIAL",
      title,
      detail: activity ? `High priority · ${activity}` : "High priority",
      detailKey: activity ? "dashboard.attention.highPriority" : "dashboard.attention.highPriorityPlain",
      detailParams: { activity },
      href: "#/commercial",
    });
  });

  return items;
}

// Keeps the editorial checks the previous Dashboard already derived, only they
// no longer own the screen.
export function projectChecks(projects = []) {
  const items = [];

  projects.forEach((project) => {
    const href = `#/projects/${encodeURIComponent(project.id)}`;
    const title = project.name || "Untitled project";
    const reference = `CASE ${project.caseNumber}`;

    if (project.editorialStatus === "PUBLISHED" && !project.visible) {
      items.push({ weight: WEIGHT.hidden, tone: "danger", category: "CMS", title, detail: `${reference} · published but hidden`, detailKey: "dashboard.attention.publishedHidden", detailParams: { reference }, href });
    }
    if (!project.poster) {
      items.push({ weight: WEIGHT.poster, tone: "warning", category: "CMS", title, detail: `${reference} · missing poster`, detailKey: "dashboard.attention.missingPoster", detailParams: { reference }, href });
    }
    if (project.editorialStatus === "DRAFT") {
      items.push({ weight: WEIGHT.draft, tone: "neutral", category: "CMS", title, detail: `${reference} · still a draft`, detailKey: "dashboard.attention.stillDraft", detailParams: { reference }, href });
    }
    if (!String(project.description || "").trim()) {
      items.push({ weight: WEIGHT.description, tone: "neutral", category: "CMS", title, detail: `${reference} · missing description`, detailKey: "dashboard.attention.missingDescription", detailParams: { reference }, href });
    }
  });

  return items;
}

// Urgency decides the order, but a quota decides who gets in: without it the
// operational demo data (six standing items) would permanently crowd the real
// editorial checks out of a six-slot list.
export function rankAttention(items, limit = 6, perCategory = 2) {
  const sorted = [...items].sort((a, b) => a.weight - b.weight);
  const picked = [];
  const used = new Map();

  for (const item of sorted) {
    const taken = used.get(item.category) ?? 0;
    if (taken >= perCategory) continue;
    used.set(item.category, taken + 1);
    picked.push(item);
    if (picked.length === limit) break;
  }

  for (const item of sorted) {
    if (picked.length === limit) break;
    if (!picked.includes(item)) picked.push(item);
  }

  return picked.sort((a, b) => a.weight - b.weight);
}

/* --- Follow ups --------------------------------------------------------- */

const STALE_CONTACT_DAYS = 30;

// Deliberately distinct from Needs Attention: these are people to contact, not
// things that are broken. No invented meetings or deadlines — every item is a
// state already present in the data.
export function followUps({ clients = [], opportunities = [] } = {}, now = new Date(), limit = 4) {
  const reference = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const items = [];

  clients
    .filter((client) => client.status === "LEAD")
    .forEach((client) => {
      items.push({
        weight: 10,
        category: "LEAD",
        title: client.name,
        detail: "New lead to qualify",
        detailKey: "dashboard.followUp.newLead",
        href: `#/clients/${encodeURIComponent(client.id)}`,
      });
    });

  opportunities
    .filter((opportunity) => normalizeOpportunity(opportunity).stage === "PROPOSAL")
    .forEach((opportunity) => {
      const days = daysInStage(opportunity, now instanceof Date ? now : new Date(now));
      const base = { weight: 20, category: "PROPOSAL", title: displayName(opportunity), href: "#/commercial" };
      if (opportunity.activity) {
        items.push({
          ...base,
          detail: `${opportunity.activity} · awaiting reply`,
          detailKey: "dashboard.followUp.awaitingReply",
          detailParams: { activity: opportunity.activity },
        });
      } else {
        items.push({
          ...base,
          detail: `Proposal waiting ${days ?? 0} days`,
          detailKey: "dashboard.followUp.proposalWaiting",
          detailParams: { days: days ?? 0 },
        });
      }
    });

  clients
    .filter((client) => client.status !== "ARCHIVED" && client.status !== "LEAD" && client.lastContactAt)
    .map((client) => ({ client, days: Math.floor((reference - new Date(client.lastContactAt).getTime()) / DAY) }))
    .filter((entry) => entry.days >= STALE_CONTACT_DAYS)
    .forEach(({ client, days }) => {
      items.push({
        weight: 30,
        category: "CLIENT",
        title: client.name,
        detail: `No contact in ${days} days`,
        detailKey: "dashboard.followUp.noContact",
        detailParams: { days },
        href: `#/clients/${encodeURIComponent(client.id)}`,
      });
    });

  return items.sort((a, b) => a.weight - b.weight).slice(0, limit);
}

/* --- System health ------------------------------------------------------ */

export function projectHealth(projects = []) {
  return {
    total: projects.length,
    published: projects.filter((project) => project.editorialStatus === "PUBLISHED").length,
    drafts: projects.filter((project) => project.editorialStatus === "DRAFT").length,
    archived: projects.filter((project) => project.editorialStatus === "ARCHIVED").length,
    hidden: projects.filter((project) => !project.visible).length,
    issues: projectChecks(projects).length,
  };
}

// Never claims more than it verified: this reports whether the admin's own
// queries came back, not the health of Supabase, Storage or Netlify.
export function adminDataStatus({ projectsOk, activityOk }) {
  if (projectsOk && activityOk) {
    return { label: "CONNECTED", tone: "ok", detail: "Admin queries responding", detailKey: "dashboard.adminStatus.responding" };
  }
  if (!projectsOk && !activityOk) {
    return { label: "UNAVAILABLE", tone: "danger", detail: "Admin queries failed", detailKey: "dashboard.adminStatus.failed" };
  }
  return projectsOk
    ? { label: "DEGRADED", tone: "warn", detail: "Activity query failed", detailKey: "dashboard.adminStatus.activityFailed" }
    : { label: "DEGRADED", tone: "warn", detail: "Project query failed", detailKey: "dashboard.adminStatus.projectFailed" };
}
