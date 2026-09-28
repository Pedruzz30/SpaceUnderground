// The relationship around a client: money, deals, contact rhythm and the
// signals that ask for action. Pure functions over records the services
// already return, so the Client Hub, the client record and the tests read one
// rule each. Nothing here is stored: a client never keeps a total of its own.

import { daysInStage, isActionOverdue, isOpen, normalizeOpportunity, STAGE_PROBABILITY } from "./commercial-metrics.js";
import { isOverdue, normalizeEntry, todayKey } from "./financial-metrics.js";
import { isActiveProject } from "./client-metrics.js";

const DAY = 24 * 60 * 60 * 1000;

// Past this, a relationship that is still open has gone quiet. Kept equal to
// the Dashboard's follow-up rule, which surfaces the same clients.
export const STALE_CONTACT_DAYS = 30;

export const CONTACT_CHANNELS = ["CALL", "WHATSAPP", "EMAIL", "MEETING", "OTHER"];

export const CLIENT_SORTS = ["updated", "name", "contact", "revenue", "receivable"];
export const CLIENT_FOCUS = ["all", "stale", "overdue", "deals"];

const round = (value) => Math.round(value * 100) / 100;

export function groupBy(items = [], key = "clientId") {
  const groups = new Map();
  items.forEach((item) => {
    const id = item?.[key];
    if (!id) return;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(item);
  });
  return groups;
}

// Money for one client. Cancelled entries count nowhere; expenses tied to a
// client (a freelancer on their project) are the cost of serving them.
export function clientFinance(entries = [], now = new Date()) {
  let received = 0;
  let toReceive = 0;
  let overdue = 0;
  let overdueCount = 0;
  let costs = 0;
  entries.forEach((raw) => {
    const entry = normalizeEntry(raw);
    if (entry.status === "CANCELLED") return;
    if (entry.type === "EXPENSE") {
      if (entry.status === "PAID") costs += entry.amount;
      return;
    }
    if (entry.status === "PAID") received += entry.amount;
    else {
      toReceive += entry.amount;
      if (isOverdue(entry, now)) {
        overdue += entry.amount;
        overdueCount += 1;
      }
    }
  });
  return { received: round(received), toReceive: round(toReceive), overdue: round(overdue), overdueCount, costs: round(costs) };
}

export function clientPipeline(deals = [], now = new Date()) {
  const normalized = deals.map(normalizeOpportunity);
  const open = normalized.filter((deal) => isOpen(deal));
  const won = normalized.filter((deal) => deal.stage === "WON");
  const value = (list) => round(list.reduce((total, deal) => total + (deal.estimatedValue ?? 0), 0));
  return {
    openCount: open.length,
    openValue: value(open),
    forecast: round(open.reduce((total, deal) => total + (deal.estimatedValue ?? 0) * STAGE_PROBABILITY[deal.stage], 0)),
    wonCount: won.length,
    wonValue: value(won),
    lostCount: normalized.filter((deal) => deal.stage === "LOST").length,
    overdueActions: open.filter((deal) => isActionOverdue(deal, now)).length,
  };
}

export function daysSinceContact(client, now = new Date()) {
  if (!client?.lastContactAt) return null;
  const time = new Date(client.lastContactAt).getTime();
  if (Number.isNaN(time)) return null;
  return Math.max(0, Math.floor((now.getTime() - time) / DAY));
}

// never: no contact recorded. stale: open relationship quiet for 30+ days.
// Archived clients are never chased.
export function contactState(client, now = new Date()) {
  if (client?.status === "ARCHIVED") return "closed";
  const days = daysSinceContact(client, now);
  if (days === null) return "never";
  return days >= STALE_CONTACT_DAYS ? "stale" : "recent";
}

// What asks for action on this client, most urgent first. Each signal is a
// key and parameters; the page words them.
// financialOk / commercialOk: whether that module could be read. A module that
// failed gives no signal at all; its empty list must not read as "no overdue
// money" or, worse, as "a lead with no deal".
export function relationshipSignals({
  client = {},
  entries = [],
  deals = [],
  projects = [],
  now = new Date(),
  financialOk = true,
  commercialOk = true,
} = {}) {
  if (client.status === "ARCHIVED") return [];
  const signals = [];
  const finance = clientFinance(financialOk ? entries : [], now);
  const pipeline = clientPipeline(commercialOk ? deals : [], now);

  if (financialOk && finance.overdue > 0) signals.push({ key: "overdue", tone: "danger", params: { amount: finance.overdue, count: finance.overdueCount } });
  if (commercialOk && pipeline.overdueActions > 0) signals.push({ key: "dealAction", tone: "danger", params: { count: pipeline.overdueActions } });

  const contact = contactState(client, now);
  const engaged = client.status === "ACTIVE" || client.status === "LEAD" || pipeline.openCount > 0 || projects.some(isActiveProject);
  if (engaged && contact === "stale") signals.push({ key: "stale", tone: "warning", params: { days: daysSinceContact(client, now) } });
  if (engaged && contact === "never") signals.push({ key: "neverContacted", tone: "warning", params: {} });

  if (commercialOk) {
    const stalled = deals.map(normalizeOpportunity).filter((deal) => isOpen(deal) && (daysInStage(deal, now) ?? 0) >= 14);
    if (stalled.length) signals.push({ key: "stalledDeal", tone: "warning", params: { count: stalled.length } });

    if (client.status === "LEAD" && pipeline.openCount === 0 && pipeline.wonCount === 0) signals.push({ key: "leadNoDeal", tone: "neutral", params: {} });
  }

  return signals;
}

// The client record's Financial and Commercial data, from the two settled
// reads, each on its own: one failing never blanks the other, and neither
// touches the client itself, its projects or its activity.
export function relatedState(entriesResult, dealsResult, client = {}) {
  const financialOk = entriesResult?.status === "fulfilled";
  const commercialOk = dealsResult?.status === "fulfilled";
  return {
    financialOk,
    commercialOk,
    entries: financialOk ? entriesResult.value.filter((entry) => entry.clientId === client.id) : [],
    deals: commercialOk
      ? dealsResult.value.filter((deal) => deal.clientId === client.id).map((deal) => ({ ...deal, clientName: client.name }))
      : [],
  };
}

// "João" and "joao", "Ops@Aurora.com" and "ops@aurora.com" are one person.
function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

// Records that are probably the same client, so a create or an edit can say
// so before a second copy is saved. Archived records still count: restoring
// beats duplicating.
export function findDuplicates(candidate = {}, clients = []) {
  const email = normalize(candidate.email);
  const name = normalize(candidate.name);
  const phone = String(candidate.phone ?? "").replace(/\D/g, "");
  return clients
    .filter((client) => client.id !== candidate.id)
    .map((client) => {
      const reasons = [];
      if (email && normalize(client.email) === email) reasons.push("email");
      if (name && normalize(client.name) === name) reasons.push("name");
      const otherPhone = String(client.phone ?? "").replace(/\D/g, "");
      if (phone.length >= 8 && otherPhone.length >= 8 && otherPhone.slice(-8) === phone.slice(-8)) reasons.push("phone");
      return reasons.length ? { client, reasons } : null;
    })
    .filter(Boolean);
}

// A number a person typed ("(21) 90000-0004", "+55 21 ...") as a wa.me link.
// Brazilian numbers without a country code get 55; anything too short to be a
// phone number gets no link at all.
export function whatsappLink(phone) {
  let digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length < 10) return "";
  if (digits.length <= 11) digits = `55${digits}`;
  return `https://wa.me/${digits}`;
}

export function telLink(phone) {
  const cleaned = String(phone ?? "").trim().replace(/[^\d+]/g, "");
  return cleaned.replace(/\D/g, "").length >= 8 ? `tel:${cleaned}` : "";
}

export function mailtoLink(email) {
  const value = String(email ?? "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? `mailto:${value}` : "";
}

export function initials(name) {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  const letters = words.length === 1 ? words[0].slice(0, 2) : `${words[0][0]}${words.at(-1)[0]}`;
  return letters.toUpperCase();
}

// Hub order. "contact" puts the longest silence first (never contacted before
// everyone), so the list reads as a call sheet.
export function sortClients(rows = [], sort = "updated") {
  const list = [...rows];
  const byName = (a, b) => String(a.client.name).localeCompare(String(b.client.name), undefined, { sensitivity: "base" });
  switch (sort) {
    case "name":
      return list.sort(byName);
    case "contact":
      return list.sort((a, b) => {
        const left = a.client.lastContactAt ? new Date(a.client.lastContactAt).getTime() : -Infinity;
        const right = b.client.lastContactAt ? new Date(b.client.lastContactAt).getTime() : -Infinity;
        return left - right || byName(a, b);
      });
    case "revenue":
      return list.sort((a, b) => b.finance.received - a.finance.received || byName(a, b));
    case "receivable":
      return list.sort((a, b) => b.finance.toReceive - a.finance.toReceive || byName(a, b));
    default:
      return list.sort((a, b) => String(b.client.updatedAt ?? "").localeCompare(String(a.client.updatedAt ?? "")) || byName(a, b));
  }
}

export function matchesFocus(row, focus, now = new Date()) {
  switch (focus) {
    case "stale":
      return ["stale", "never"].includes(contactState(row.client, now)) && row.client.status !== "INACTIVE";
    case "overdue":
      return row.finance.overdue > 0;
    case "deals":
      return row.pipeline.openCount > 0;
    default:
      return true;
  }
}

// A contact is picked as a calendar day and stored at 12:00 UTC of that day,
// which reads back as the same date in every Brazilian time zone. Before 09:00
// in Brazil, 12:00 UTC of today is still in the future and would be refused as
// a contact that has not happened yet, so today is capped at "now", which
// still falls on the same UTC date. A day after today is left as it is, so
// validation refuses it as the future contact it is.
export function contactTimestampForDay(day, now = new Date()) {
  if (!day) return null;
  const noon = new Date(`${day}T12:00:00.000Z`);
  if (Number.isNaN(noon.getTime())) return null;
  const capped = day <= todayKey(now) && noon.getTime() > now.getTime();
  return (capped ? now : noon).toISOString();
}
