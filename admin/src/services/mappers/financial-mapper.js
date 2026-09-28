// Single place where the transaction UI model (camelCase) meets the database
// row (snake_case). Pages and services never do this conversion themselves.

import { toDateKey, TRANSACTION_CATEGORIES, TRANSACTION_STATUSES, TRANSACTION_TYPES } from "../../utils/financial-metrics.js";

// Listed explicitly rather than `*`: a column the Admin reads that no
// migration creates must fail as a clear test failure, not as PostgREST 42703
// in production. admin/tests/financial-migration.test.mjs checks this list.
export const FINANCIAL_COLUMNS = [
  "id",
  "type",
  "status",
  "description",
  "category",
  "amount",
  "currency",
  "due_date",
  "paid_at",
  "client_id",
  "project_id",
  "notes",
  "created_at",
  "updated_at",
].join(",");

function upper(value, allowed, fallback) {
  const text = String(value ?? "").trim().toUpperCase();
  return allowed.includes(text) ? text : fallback;
}

// numeric(12,2) comes back from PostgREST as a string ("1750.00").
function toAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
}

export function mapTransactionFromDatabase(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: upper(row.type, TRANSACTION_TYPES, "INCOME"),
    status: upper(row.status, TRANSACTION_STATUSES, "PENDING"),
    description: row.description ?? "",
    category: upper(row.category, TRANSACTION_CATEGORIES, "OTHER"),
    amount: toAmount(row.amount),
    currency: row.currency ?? "BRL",
    dueDate: toDateKey(row.due_date),
    paidAt: toDateKey(row.paid_at),
    clientId: row.client_id ?? null,
    projectId: row.project_id ?? null,
    notes: row.notes ?? "",
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

// Only fields present in the model reach the row, so a partial update never
// blanks a column it did not mean to touch. The timestamps belong to the
// database. paid_at is sent only for a PAID entry: the trigger stamps today
// when it is missing and clears it for any other status.
export function mapTransactionToDatabase(model) {
  const row = {};
  const optional = (value) => {
    const text = String(value ?? "").trim();
    return text || null;
  };

  if (model.type !== undefined) row.type = upper(model.type, TRANSACTION_TYPES, "INCOME");
  if (model.status !== undefined) row.status = upper(model.status, TRANSACTION_STATUSES, "PENDING");
  if (model.description !== undefined) row.description = String(model.description ?? "").trim();
  if (model.category !== undefined) row.category = upper(model.category, TRANSACTION_CATEGORIES, "OTHER");
  if (model.amount !== undefined) row.amount = toAmount(model.amount);
  if (model.dueDate !== undefined) row.due_date = toDateKey(model.dueDate);
  if (model.paidAt !== undefined) row.paid_at = row.status === "PAID" || model.status === undefined ? toDateKey(model.paidAt) : null;
  if (model.clientId !== undefined) row.client_id = optional(model.clientId);
  if (model.projectId !== undefined) row.project_id = optional(model.projectId);
  if (model.notes !== undefined) row.notes = optional(model.notes);

  return row;
}

// The rule public.stamp_financial_paid_at() enforces in Postgres, for the mock
// repository, which has no trigger to lean on.
export function stampPaidAt(previous, next, today = toDateKey(new Date())) {
  if (next.status !== "PAID") return null;
  return toDateKey(next.paidAt) ?? (previous?.status === "PAID" ? toDateKey(previous.paidAt) : null) ?? today;
}
