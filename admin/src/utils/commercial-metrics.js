// Pipeline rules shared by the Commercial page, its reports and the Dashboard.
//
// A deal moves NEW -> CONTACTED -> PROPOSAL -> NEGOTIATION and closes as WON or
// LOST. Every figure is derived from the deals here:
//
//   open pipeline      open deals and their estimated value
//   weighted forecast  each open deal's value times its stage probability
//   won / lost         deals closed inside a period (dated by closedAt)
//   conversion         won / (won + lost) inside a period
//   overdue action     an open deal whose next action date has passed
//
// Rows from the presentation pipeline used `client` (a display name) and a
// free-text `activity`. normalizeOpportunity reads both shapes.

import { toDateKey, todayKey } from "./financial-metrics.js";

export const STAGES = ["NEW", "CONTACTED", "PROPOSAL", "NEGOTIATION", "WON", "LOST"];
export const OPEN_STAGES = ["NEW", "CONTACTED", "PROPOSAL", "NEGOTIATION"];
export const CLOSED_STAGES = ["WON", "LOST"];
export const PRIORITIES = ["HIGH", "MEDIUM", "LOW"];
export const SOURCES = ["REFERRAL", "INSTAGRAM", "WEBSITE", "WHATSAPP", "EVENT", "OTHER"];
export const LOST_REASONS = ["PRICE", "TIMING", "NO_RESPONSE", "COMPETITOR", "SCOPE", "OTHER"];

// How likely a deal in each open stage is to close. Deliberately round: the
// forecast is a planning aid, not a promise.
export const STAGE_PROBABILITY = { NEW: 0.1, CONTACTED: 0.25, PROPOSAL: 0.5, NEGOTIATION: 0.75, WON: 1, LOST: 0 };

const DAY = 24 * 60 * 60 * 1000;
// An open deal nobody moved for this long is going cold.
export const STALE_DAYS = 14;

const upper = (value, allowed, fallback) => {
  const text = String(value ?? "").trim().toUpperCase();
  return allowed.includes(text) ? text : fallback;
};

export function normalizeOpportunity(opportunity = {}) {
  const value = Number(opportunity.estimatedValue ?? opportunity.value);
  return {
    ...opportunity,
    stage: upper(opportunity.stage, STAGES, "NEW"),
    priority: upper(opportunity.priority, PRIORITIES, "MEDIUM"),
    source: upper(opportunity.source, SOURCES, "OTHER"),
    estimatedValue: Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : null,
    nextActionAt: toDateKey(opportunity.nextActionAt),
    expectedCloseDate: toDateKey(opportunity.expectedCloseDate),
    closedAt: opportunity.closedAt ?? null,
  };
}

// The name a person reads on the card: the client record when linked, else the
// lead's own contact. Legacy rows carried it as `client`.
export function displayName(opportunity = {}) {
  return (
    String(opportunity.clientName || opportunity.company || opportunity.contactName || opportunity.client || "").trim() ||
    String(opportunity.title || "").trim()
  );
}

export function isOpen(opportunity) {
  return OPEN_STAGES.includes(normalizeOpportunity(opportunity).stage);
}

export function isActionOverdue(opportunity, now = new Date()) {
  const deal = normalizeOpportunity(opportunity);
  return isOpen(deal) && Boolean(deal.nextActionAt) && deal.nextActionAt < todayKey(now);
}

export function daysInStage(opportunity, now = new Date()) {
  const since = new Date(opportunity.stageChangedAt ?? opportunity.updatedAt ?? NaN).getTime();
  if (Number.isNaN(since)) return null;
  return Math.max(0, Math.floor((now.getTime() - since) / DAY));
}

export function isStale(opportunity, now = new Date()) {
  const days = daysInStage(opportunity, now);
  return isOpen(opportunity) && days !== null && days >= STALE_DAYS;
}

const round = (value) => Math.round(value * 100) / 100;
const valueOf = (opportunity) => normalizeOpportunity(opportunity).estimatedValue ?? 0;

// Per stage: how many deals and how much they are worth.
export function stageTotals(opportunities = []) {
  return STAGES.map((stage) => {
    const deals = opportunities.filter((opportunity) => normalizeOpportunity(opportunity).stage === stage);
    return { stage, count: deals.length, value: round(deals.reduce((total, deal) => total + valueOf(deal), 0)) };
  });
}

// When a deal closed, as a calendar day (closedAt is a timestamp).
export function closedDay(opportunity) {
  return toDateKey(opportunity.closedAt);
}

function closedWithin(opportunity, [from, to]) {
  const day = closedDay(opportunity);
  if (!from && !to) return Boolean(day) || !isOpen(opportunity);
  if (!day) return false;
  return (!from || day >= from) && (!to || day <= to);
}

export function pipelineSummary(opportunities = [], range = [null, null], now = new Date()) {
  const deals = opportunities.map(normalizeOpportunity);
  const open = deals.filter((deal) => OPEN_STAGES.includes(deal.stage));
  const won = deals.filter((deal) => deal.stage === "WON" && closedWithin(deal, range));
  const lost = deals.filter((deal) => deal.stage === "LOST" && closedWithin(deal, range));
  const decided = won.length + lost.length;
  const wonValue = round(won.reduce((total, deal) => total + (deal.estimatedValue ?? 0), 0));

  return {
    openCount: open.length,
    openValue: round(open.reduce((total, deal) => total + (deal.estimatedValue ?? 0), 0)),
    forecast: round(open.reduce((total, deal) => total + (deal.estimatedValue ?? 0) * STAGE_PROBABILITY[deal.stage], 0)),
    wonCount: won.length,
    wonValue,
    lostCount: lost.length,
    conversion: decided ? won.length / decided : null,
    averageWon: won.length ? round(wonValue / won.length) : null,
    overdueActions: open.filter((deal) => isActionOverdue(deal, now)).length,
    highPriority: open.filter((deal) => deal.priority === "HIGH").length,
  };
}

// Why deals were lost inside a period, most common first.
export function lostReasons(opportunities = [], range = [null, null]) {
  const counts = new Map();
  opportunities.map(normalizeOpportunity).forEach((deal) => {
    if (deal.stage !== "LOST" || !closedWithin(deal, range)) return;
    const reason = deal.lostReason || "OTHER";
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  });
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count, share: total ? count / total : 0 }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

// Where won business came from inside a period, by value.
export function wonBySource(opportunities = [], range = [null, null]) {
  const totals = new Map();
  opportunities.map(normalizeOpportunity).forEach((deal) => {
    if (deal.stage !== "WON" || !closedWithin(deal, range)) return;
    const current = totals.get(deal.source) ?? { source: deal.source, count: 0, value: 0 };
    current.count += 1;
    current.value += deal.estimatedValue ?? 0;
    totals.set(deal.source, current);
  });
  return [...totals.values()]
    .map((item) => ({ ...item, value: round(item.value) }))
    .sort((a, b) => b.value - a.value || b.count - a.count);
}

// Average days from creation to a win, over the wins inside a period.
export function averageDaysToWin(opportunities = [], range = [null, null]) {
  const durations = opportunities
    .map(normalizeOpportunity)
    .filter((deal) => deal.stage === "WON" && closedWithin(deal, range))
    .map((deal) => (new Date(deal.closedAt).getTime() - new Date(deal.createdAt).getTime()) / DAY)
    .filter((days) => Number.isFinite(days) && days >= 0);
  if (!durations.length) return null;
  return Math.round(durations.reduce((sum, days) => sum + days, 0) / durations.length);
}

// A fractional position that lands a card between two neighbours with a single
// write. Either neighbour may be missing (top or bottom of the column).
export function positionBetween(before, after) {
  const hasBefore = Number.isFinite(before);
  const hasAfter = Number.isFinite(after);
  if (hasBefore && hasAfter) return (before + after) / 2;
  if (hasBefore) return before + 1;
  if (hasAfter) return after - 1;
  return 0;
}

// When two neighbours share a position there is no number between them, so
// the caller rewrites the column as 0, 1, 2... in the order given. Returns
// only the deals whose position actually changes.
export function renumberColumn(orderedIds, positions) {
  return orderedIds
    .map((id, index) => ({ id, position: index }))
    .filter(({ id, position }) => Number(positions.get(id)) !== position);
}

// Cards inside a column: explicit order first, newest as the tie-breaker.
export function sortForBoard(opportunities = []) {
  return [...opportunities].sort(
    (a, b) =>
      (Number(a.position) || 0) - (Number(b.position) || 0) ||
      String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")),
  );
}
