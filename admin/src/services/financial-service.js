import { t } from "../i18n/index.js";
import {
  categoriesFor,
  isDateKey,
  parseAmount,
  splitInstallments,
  toDateKey,
  todayKey,
  TRANSACTION_STATUSES,
  TRANSACTION_TYPES,
} from "../utils/financial-metrics.js";
import { logActivity } from "./activity-service.js";
import { DataError, toDataError } from "./errors.js";
import { getFinancialRepository } from "./repositories/index.js";

// Async contract used by the Financial page. Pages call these functions and
// never learn whether the data came from localStorage or Supabase. Every rule
// lives here once, so both repositories receive the same validated values.

// numeric(12,2): the largest amount the column stores.
const MAX_AMOUNT = 9_999_999_999.99;
const MAX_INSTALLMENTS = 60;

const DEFAULTS = {
  type: "INCOME",
  status: "PENDING",
  description: "",
  category: "PROJECT",
  amount: "",
  dueDate: "",
  paidAt: "",
  clientId: "",
  projectId: "",
  // Set only by a won deal; the ledger form never shows or edits it.
  opportunityId: "",
  notes: "",
};

const EDITABLE_FIELDS = Object.keys(DEFAULTS);

function meta(action, entry) {
  return { action, entityType: "financial", entityId: entry?.id ?? null };
}

// Stored as data, like every activity detail: one readable line, no locale.
function label(entry) {
  return `${entry.description} (${Number(entry.amount).toFixed(2)} BRL)`;
}

export function newTransactionDefaults(overrides = {}) {
  return { ...DEFAULTS, dueDate: todayKey(), ...overrides };
}

// Keeps only fields the editor may write, in their stored shape. id and the
// timestamps never pass through; amount is parsed from what a person typed.
export function sanitizeTransaction(values = {}) {
  const clean = {};
  EDITABLE_FIELDS.forEach((field) => {
    if (values[field] === undefined) return;
    clean[field] = typeof values[field] === "number" ? values[field] : String(values[field] ?? "").trim();
  });
  if (clean.type !== undefined) clean.type = clean.type.toUpperCase();
  if (clean.status !== undefined) clean.status = clean.status.toUpperCase();
  if (clean.category !== undefined) clean.category = String(clean.category).toUpperCase();
  if (clean.amount !== undefined) clean.amount = parseAmount(clean.amount);
  if (clean.dueDate !== undefined) clean.dueDate = toDateKey(clean.dueDate) ?? clean.dueDate;
  if (clean.paidAt !== undefined) clean.paidAt = clean.paidAt ? toDateKey(clean.paidAt) ?? clean.paidAt : null;
  if (clean.clientId !== undefined) clean.clientId = clean.clientId || null;
  if (clean.projectId !== undefined) clean.projectId = clean.projectId || null;
  if (clean.opportunityId !== undefined) clean.opportunityId = clean.opportunityId || null;
  // Only a paid entry carries a payment date.
  if (clean.status !== undefined && clean.status !== "PAID") clean.paidAt = null;
  return clean;
}

// Field -> message. Used by the form for inline errors and by the service
// itself, so a caller that skips the form still cannot store an invalid entry.
export function validateTransaction(values = {}, { installments = 1 } = {}) {
  const errors = {};
  if (!TRANSACTION_TYPES.includes(values.type)) errors.type = t("financial.validation.typeValid");
  if (!TRANSACTION_STATUSES.includes(values.status)) errors.status = t("financial.validation.statusValid");
  if (!String(values.description ?? "").trim()) errors.description = t("financial.validation.descriptionRequired");

  const amount = typeof values.amount === "number" ? values.amount : parseAmount(values.amount);
  if (!Number.isFinite(amount) || amount <= 0) errors.amount = t("financial.validation.amountPositive");
  else if (amount > MAX_AMOUNT) errors.amount = t("financial.validation.amountTooLarge");
  // numeric(12,2) keeps cents; a third decimal would be silently rounded away.
  else if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) errors.amount = t("financial.validation.amountCents");

  if (values.type && !categoriesFor(values.type).includes(values.category)) errors.category = t("financial.validation.categoryValid");
  if (!isDateKey(values.dueDate)) errors.dueDate = t("financial.validation.dueDateRequired");

  if (values.status === "PAID" && values.paidAt) {
    if (!isDateKey(values.paidAt)) errors.paidAt = t("financial.validation.paidAtValid");
    else if (values.paidAt > todayKey()) errors.paidAt = t("financial.validation.paidAtFuture");
  }

  const count = Number(installments);
  if (!Number.isInteger(count) || count < 1 || count > MAX_INSTALLMENTS) {
    errors.installments = t("financial.validation.installmentsRange", { max: MAX_INSTALLMENTS });
  } else if (count > 1 && Number.isFinite(amount) && amount / count < 0.01) {
    errors.installments = t("financial.validation.installmentsTooSmall");
  } else if (count > 1 && values.status === "PAID") {
    errors.installments = t("financial.validation.installmentsPending");
  }
  return errors;
}

function assertValid(values, options) {
  const errors = validateTransaction(values, options);
  const [field] = Object.keys(errors);
  if (field) throw new DataError(errors[field], { code: "validation", field });
}

export async function getTransactions() {
  try {
    return await (await getFinancialRepository()).list();
  } catch (error) {
    throw toDataError(error, t("errors.data.loadTransactions"));
  }
}

// A list that never throws, for screens that only summarize the ledger (the
// Dashboard): an outage reads as a flagged empty ledger instead of an error.
export async function getTransactionsWithStatus() {
  try {
    return { items: await getTransactions(), ok: true };
  } catch {
    return { items: [], ok: false };
  }
}

// The entries a won deal created (see winOpportunity). Throws, unlike the
// Dashboard read: the caller must not mistake an outage for "nothing yet".
export async function getTransactionsForOpportunity(opportunityId) {
  if (!opportunityId) return [];
  try {
    return await (await getFinancialRepository()).listByOpportunity(opportunityId);
  } catch (error) {
    throw toDataError(error, t("errors.data.loadTransactions"));
  }
}

export async function getTransaction(id) {
  try {
    return await (await getFinancialRepository()).getById(id);
  } catch (error) {
    throw toDataError(error, t("errors.data.loadTransactions"));
  }
}

// One entry, or `installments` monthly entries that split the amount. Each
// installment is named "(1/3)", "(2/3)"... and stored in a single write.
export async function createTransaction(data = {}, { installments = 1 } = {}) {
  try {
    const values = sanitizeTransaction({ ...DEFAULTS, ...data });
    // "Leave empty to record today" means the Admin's today. Left to the
    // trigger, current_date is the server's (UTC) day, which is already
    // tomorrow on a Brazilian evening and then fails the no-future-date rule.
    if (values.status === "PAID" && !values.paidAt) values.paidAt = todayKey();
    assertValid(values, { installments });
    const repository = await getFinancialRepository();
    const count = Number(installments);

    if (count === 1) {
      const created = await repository.create(values);
      await logActivity("Financial entry created", label(created), meta("financial.created", created));
      return [created];
    }

    const parts = splitInstallments({ amount: values.amount, count, dueDate: values.dueDate });
    const created = await repository.createMany(
      parts.map((part) => ({
        ...values,
        description: `${values.description} (${part.index}/${part.count})`,
        amount: part.amount,
        dueDate: part.dueDate,
        status: "PENDING",
        paidAt: null,
      })),
    );
    await logActivity(
      "Installments created",
      `${values.description}: ${count} x ${(values.amount / count).toFixed(2)} BRL`,
      meta("financial.installments_created", created[0]),
    );
    return created;
  } catch (error) {
    throw toDataError(error, t("errors.data.saveTransaction"));
  }
}

// The log names what actually happened: settling or cancelling an entry from
// the form reads as that event, not as a generic edit.
function lifecycleEvent(before, after) {
  if (before.status !== "PAID" && after.status === "PAID") return ["financial.paid", "Financial entry settled"];
  if (before.status === "PAID" && after.status === "PENDING") return ["financial.reopened", "Financial entry reopened"];
  if (before.status !== "CANCELLED" && after.status === "CANCELLED") return ["financial.cancelled", "Financial entry cancelled"];
  if (before.status === "CANCELLED" && after.status !== "CANCELLED") return ["financial.reopened", "Financial entry reopened"];
  return ["financial.updated", "Financial entry updated"];
}

export async function updateTransaction(id, patch = {}) {
  try {
    const repository = await getFinancialRepository();
    const before = await repository.getById(id);
    if (!before) throw new DataError(t("errors.notFound"), { code: "not_found" });

    const values = sanitizeTransaction(patch);
    // An entry that stays paid keeps its date; one that becomes paid with no
    // date is paid today in the Admin's calendar, not the server's (see create).
    if ((values.status ?? before.status) === "PAID" && !values.paidAt) {
      if (before.status === "PAID") delete values.paidAt;
      else values.paidAt = todayKey();
    }
    // A type change must bring a category that belongs to the new type.
    if (values.type && values.category === undefined && !categoriesFor(values.type).includes(before.category)) {
      values.category = "OTHER";
    }
    assertValid({ ...before, ...values });

    const updated = await repository.update(id, values);
    if (!updated) throw new DataError(t("errors.notFound"), { code: "not_found" });
    const [action, title] = lifecycleEvent(before, updated);
    await logActivity(title, label(updated), meta(action, updated));
    return updated;
  } catch (error) {
    throw toDataError(error, t("errors.data.saveTransaction"));
  }
}

export async function markTransactionPaid(id, paidAt = todayKey()) {
  return updateTransaction(id, { status: "PAID", paidAt });
}

export async function reopenTransaction(id) {
  return updateTransaction(id, { status: "PENDING", paidAt: null });
}

export async function cancelTransaction(id) {
  return updateTransaction(id, { status: "CANCELLED", paidAt: null });
}

// A copy starts over as pending: duplicating a paid entry must never count the
// same money twice.
export async function duplicateTransaction(id) {
  const source = await getTransaction(id);
  if (!source) throw new DataError(t("errors.notFound"), { code: "not_found" });
  const [copy] = await createTransaction({
    type: source.type,
    status: "PENDING",
    description: source.description,
    category: source.category,
    amount: source.amount,
    dueDate: todayKey(),
    clientId: source.clientId ?? "",
    projectId: source.projectId ?? "",
    notes: source.notes ?? "",
  });
  return copy;
}

export async function deleteTransaction(id) {
  try {
    const removed = await (await getFinancialRepository()).remove(id);
    if (!removed) throw new DataError(t("errors.notFound"), { code: "not_found" });
    await logActivity("Financial entry deleted", label(removed), meta("financial.deleted", removed));
    return removed;
  } catch (error) {
    throw toDataError(error, t("errors.data.deleteTransaction"));
  }
}

export { MAX_INSTALLMENTS };
