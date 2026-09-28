// Single place where the opportunity UI model (camelCase) meets the database
// row (snake_case). Pages and services never do this conversion themselves.

import { LOST_REASONS, PRIORITIES, SOURCES, STAGES } from "../../utils/commercial-metrics.js";
import { toDateKey } from "../../utils/financial-metrics.js";

// Listed explicitly rather than `*`: a column the Admin reads that no
// migration creates must fail as a clear test failure, not as PostgREST 42703
// in production. admin/tests/commercial-migration.test.mjs checks this list.
export const OPPORTUNITY_COLUMNS = [
  "id",
  "title",
  "stage",
  "priority",
  "source",
  "client_id",
  "plan_id",
  "contact_name",
  "company",
  "email",
  "phone",
  "estimated_value",
  "expected_close_date",
  "next_action",
  "next_action_at",
  "last_contact_at",
  "lost_reason",
  "position",
  "notes",
  "stage_changed_at",
  "closed_at",
  "created_at",
  "updated_at",
].join(",");

function upper(value, allowed, fallback) {
  const text = String(value ?? "").trim().toUpperCase();
  return allowed.includes(text) ? text : fallback;
}

function toAmount(value) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : null;
}

export function mapOpportunityFromDatabase(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title ?? "",
    stage: upper(row.stage, STAGES, "NEW"),
    priority: upper(row.priority, PRIORITIES, "MEDIUM"),
    source: upper(row.source, SOURCES, "OTHER"),
    clientId: row.client_id ?? null,
    planId: row.plan_id ?? null,
    contactName: row.contact_name ?? "",
    company: row.company ?? "",
    email: row.email ?? "",
    phone: row.phone ?? "",
    estimatedValue: toAmount(row.estimated_value),
    expectedCloseDate: toDateKey(row.expected_close_date),
    nextAction: row.next_action ?? "",
    nextActionAt: toDateKey(row.next_action_at),
    lastContactAt: toDateKey(row.last_contact_at),
    lostReason: row.lost_reason ? upper(row.lost_reason, LOST_REASONS, "OTHER") : null,
    position: Number(row.position) || 0,
    notes: row.notes ?? "",
    stageChangedAt: row.stage_changed_at ?? null,
    closedAt: row.closed_at ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

// Only fields present in the model reach the row, so a partial update never
// blanks a column it did not mean to touch. stage_changed_at, closed_at and
// the timestamps belong to the database trigger and are never written here.
export function mapOpportunityToDatabase(model) {
  const row = {};
  const optional = (value) => {
    const text = String(value ?? "").trim();
    return text || null;
  };

  if (model.title !== undefined) row.title = String(model.title ?? "").trim();
  if (model.stage !== undefined) row.stage = upper(model.stage, STAGES, "NEW");
  if (model.priority !== undefined) row.priority = upper(model.priority, PRIORITIES, "MEDIUM");
  if (model.source !== undefined) row.source = upper(model.source, SOURCES, "OTHER");
  if (model.clientId !== undefined) row.client_id = optional(model.clientId);
  if (model.planId !== undefined) row.plan_id = optional(model.planId);
  if (model.contactName !== undefined) row.contact_name = optional(model.contactName);
  if (model.company !== undefined) row.company = optional(model.company);
  if (model.email !== undefined) row.email = optional(model.email);
  if (model.phone !== undefined) row.phone = optional(model.phone);
  if (model.estimatedValue !== undefined) row.estimated_value = toAmount(model.estimatedValue);
  if (model.expectedCloseDate !== undefined) row.expected_close_date = toDateKey(model.expectedCloseDate);
  if (model.nextAction !== undefined) row.next_action = optional(model.nextAction);
  if (model.nextActionAt !== undefined) row.next_action_at = toDateKey(model.nextActionAt);
  if (model.lastContactAt !== undefined) row.last_contact_at = toDateKey(model.lastContactAt);
  if (model.lostReason !== undefined) row.lost_reason = model.lostReason ? upper(model.lostReason, LOST_REASONS, "OTHER") : null;
  if (model.position !== undefined) row.position = Number(model.position) || 0;
  if (model.notes !== undefined) row.notes = optional(model.notes);

  return row;
}

// The rule public.stamp_commercial_opportunity_stage() enforces in Postgres,
// for the mock repository, which has no trigger to lean on.
export function stampStage(previous, next, now = new Date().toISOString()) {
  const changed = !previous || previous.stage !== next.stage;
  const closed = next.stage === "WON" || next.stage === "LOST";
  return {
    stageChangedAt: changed ? now : previous.stageChangedAt ?? now,
    closedAt: closed ? (!changed && previous?.closedAt ? previous.closedAt : now) : null,
    lostReason: next.stage === "LOST" ? next.lostReason ?? null : null,
  };
}
