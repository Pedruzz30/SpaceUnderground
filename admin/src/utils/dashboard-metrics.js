// Pure derivations behind the Dashboard command center.
//
// Two data origins meet on the Dashboard and are kept apart on purpose:
//
//   REAL  — `projects` and `activity` arrive from the configured repository
//           (mock or Supabase) through the existing services.
//   DEMO  — clients, opportunities, transactions and the financial summary come
//           from src/data/operations-demo.js. Those modules have no backend
//           yet, so every figure derived from them is presentation-only.
//
// Nothing here reads a module directly: callers pass the data in, which keeps
// these functions pure and testable.

export const PERIODS = [
  { id: "month", label: "This month" },
  { id: "30d", label: "Last 30 days" },
  { id: "90d", label: "Last 90 days" },
  { id: "year", label: "This year" },
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

/* --- KPIs (presentation-only) ------------------------------------------ */

// "Active projects" means client engagements in delivery, not published cases:
// a published portfolio entry is an editorial state, not an active job.
export function activeEngagements(clients) {
  return clients.reduce(
    (total, client) => total + client.projects.filter((project) => project.status === "ACTIVE").length,
    0,
  );
}

export function activeClients(clients) {
  return clients.filter((client) => client.status === "ACTIVE").length;
}

export function openOpportunities(opportunities) {
  return opportunities.filter((opportunity) => opportunity.stage !== "WON").length;
}

/* --- Commercial pipeline (presentation-only) --------------------------- */

export function pipelineSummary(stages, opportunities) {
  const counted = stages.map((stage) => ({
    id: stage.id,
    label: stage.label,
    count: opportunities.filter((opportunity) => opportunity.stage === stage.id).length,
  }));

  const open = opportunities.filter((opportunity) => opportunity.stage !== "WON");

  return {
    stages: counted,
    max: Math.max(1, ...counted.map((stage) => stage.count)),
    open: open.length,
    highPriority: open.filter((opportunity) => opportunity.priority === "HIGH").length,
  };
}

/* --- Financial (presentation-only) ------------------------------------- */

// Only settled money counts: a receivable is not revenue until it is paid, and
// the range strings on opportunities are never parsed into arithmetic.
export function financialTotals(transactions, periodId, now = new Date()) {
  const scoped = transactions.filter((transaction) => withinPeriod(transaction.date, periodId, now));
  const revenue = scoped
    .filter((transaction) => transaction.type === "INCOME" && transaction.status === "PAID")
    .reduce((total, transaction) => total + Math.abs(transaction.amount), 0);
  const expenses = scoped
    .filter((transaction) => transaction.type === "EXPENSE" && transaction.status === "PAID")
    .reduce((total, transaction) => total + Math.abs(transaction.amount), 0);

  return { revenue, expenses, result: revenue - expenses, transactions: scoped };
}

// The only source of truth for open receivables: the transaction list. A
// standing summary total would be a second one, free to drift out of step.
export function pendingReceivables(transactions = []) {
  return transactions
    .filter((transaction) => transaction.type === "RECEIVABLE" && transaction.status === "PENDING")
    .reduce((total, transaction) => total + Math.abs(transaction.amount), 0);
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

  transactions
    .filter((transaction) => transaction.type === "RECEIVABLE" && transaction.status === "PENDING")
    .forEach((transaction) => {
      items.push({
        weight: WEIGHT.receivable,
        tone: "warning",
        category: "FINANCIAL",
        title: transaction.client || transaction.description,
        detail: `${transaction.description} pending`,
        amount: Math.abs(transaction.amount),
        href: "#/financial",
      });
    });

  opportunities
    .filter((opportunity) => opportunity.stage !== "WON" && opportunity.priority === "HIGH")
    .forEach((opportunity) => {
      items.push({
        weight: WEIGHT.highPriority,
        tone: "danger",
        category: "COMMERCIAL",
        title: opportunity.client,
        detail: `High priority · ${opportunity.activity.toLowerCase()}`,
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
      items.push({ weight: WEIGHT.hidden, tone: "danger", category: "CMS", title, detail: `${reference} · published but hidden`, href });
    }
    if (!project.poster) {
      items.push({ weight: WEIGHT.poster, tone: "warning", category: "CMS", title, detail: `${reference} · missing poster`, href });
    }
    if (project.editorialStatus === "DRAFT") {
      items.push({ weight: WEIGHT.draft, tone: "neutral", category: "CMS", title, detail: `${reference} · still a draft`, href });
    }
    if (!String(project.description || "").trim()) {
      items.push({ weight: WEIGHT.description, tone: "neutral", category: "CMS", title, detail: `${reference} · missing description`, href });
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
        href: `#/clients/${encodeURIComponent(client.id)}`,
      });
    });

  opportunities
    .filter((opportunity) => opportunity.stage === "PROPOSAL")
    .forEach((opportunity) => {
      items.push({
        weight: 20,
        category: "PROPOSAL",
        title: opportunity.client,
        detail: `${opportunity.activity} · awaiting reply`,
        href: "#/commercial",
      });
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
  if (projectsOk && activityOk) return { label: "CONNECTED", tone: "ok", detail: "Admin queries responding" };
  if (!projectsOk && !activityOk) return { label: "UNAVAILABLE", tone: "danger", detail: "Admin queries failed" };
  return { label: "DEGRADED", tone: "warn", detail: projectsOk ? "Activity query failed" : "Project query failed" };
}
