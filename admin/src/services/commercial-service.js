import { t } from "../i18n/index.js";
import { isValidEmail } from "../utils/client-health.js";
import { LOST_REASONS, OPEN_STAGES, PRIORITIES, SOURCES, STAGES } from "../utils/commercial-metrics.js";
import { isDateKey, parseAmount, toDateKey, todayKey } from "../utils/financial-metrics.js";
import { logActivity } from "./activity-service.js";
import { createClient } from "./client-service.js";
import { DataError, toDataError } from "./errors.js";
import { createTransaction } from "./financial-service.js";
import { getCommercialRepository } from "./repositories/index.js";

// Async contract used by the Commercial page. Pages call these functions and
// never learn whether the data came from localStorage or Supabase. Every rule
// lives here once, so both repositories receive the same validated values.

const MAX_VALUE = 9_999_999_999.99;

const DEFAULTS = {
  title: "",
  stage: "NEW",
  priority: "MEDIUM",
  source: "OTHER",
  clientId: "",
  planId: "",
  contactName: "",
  company: "",
  email: "",
  phone: "",
  estimatedValue: "",
  expectedCloseDate: "",
  nextAction: "",
  nextActionAt: "",
  lastContactAt: "",
  notes: "",
};

const EDITABLE_FIELDS = [...Object.keys(DEFAULTS), "lostReason", "position"];
const DATE_FIELDS = ["expectedCloseDate", "nextActionAt", "lastContactAt"];

function meta(action, opportunity) {
  return { action, entityType: "opportunity", entityId: opportunity?.id ?? null };
}

// Stored as data, like every activity detail: one readable line, no locale.
function label(opportunity) {
  const who = opportunity.clientName || opportunity.company || opportunity.contactName;
  return who ? `${opportunity.title} · ${who}` : opportunity.title;
}

export function newOpportunityDefaults(overrides = {}) {
  return { ...DEFAULTS, ...overrides };
}

// Keeps only fields the editor may write, in their stored shape. id and the
// database-owned stage bookkeeping never pass through.
export function sanitizeOpportunity(values = {}) {
  const clean = {};
  EDITABLE_FIELDS.forEach((field) => {
    if (values[field] === undefined) return;
    const value = values[field];
    clean[field] = typeof value === "number" || value === null ? value : String(value ?? "").trim();
  });
  ["stage", "priority", "source"].forEach((field) => {
    if (clean[field] !== undefined) clean[field] = String(clean[field]).toUpperCase();
  });
  if (clean.lostReason !== undefined) clean.lostReason = clean.lostReason ? String(clean.lostReason).toUpperCase() : null;
  if (clean.estimatedValue !== undefined) {
    clean.estimatedValue = clean.estimatedValue === "" || clean.estimatedValue === null ? null : parseAmount(clean.estimatedValue);
  }
  DATE_FIELDS.forEach((field) => {
    if (clean[field] === undefined) return;
    clean[field] = clean[field] ? toDateKey(clean[field]) ?? clean[field] : null;
  });
  if (clean.clientId !== undefined) clean.clientId = clean.clientId || null;
  if (clean.planId !== undefined) clean.planId = clean.planId || null;
  if (clean.position !== undefined) clean.position = Number(clean.position) || 0;
  if (clean.stage !== undefined && clean.stage !== "LOST") clean.lostReason = null;
  return clean;
}

// Field -> message. Used by the form for inline errors and by the service
// itself, so a caller that skips the form still cannot store an invalid deal.
export function validateOpportunity(values = {}) {
  const errors = {};
  if (!String(values.title ?? "").trim()) errors.title = t("commercial.validation.titleRequired");
  if (!STAGES.includes(values.stage)) errors.stage = t("commercial.validation.stageValid");
  if (!PRIORITIES.includes(values.priority)) errors.priority = t("commercial.validation.priorityValid");
  if (!SOURCES.includes(values.source)) errors.source = t("commercial.validation.sourceValid");

  // Somebody has to be on the other side of the deal.
  const hasContact = [values.clientId, values.contactName, values.company].some((value) => String(value ?? "").trim());
  if (!hasContact) errors.contactName = t("commercial.validation.whoRequired");

  const email = String(values.email ?? "").trim();
  if (email && !isValidEmail(email)) errors.email = t("commercial.validation.emailValid");

  const value = values.estimatedValue;
  if (value !== null && value !== undefined && value !== "") {
    const amount = typeof value === "number" ? value : parseAmount(value);
    if (!Number.isFinite(amount) || amount < 0) errors.estimatedValue = t("commercial.validation.valueValid");
    else if (amount > MAX_VALUE) errors.estimatedValue = t("commercial.validation.valueTooLarge");
    else if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) errors.estimatedValue = t("commercial.validation.valueCents");
  }

  DATE_FIELDS.forEach((field) => {
    if (values[field] && !isDateKey(values[field])) errors[field] = t("commercial.validation.dateValid");
  });
  if (values.lastContactAt && isDateKey(values.lastContactAt) && values.lastContactAt > todayKey()) {
    errors.lastContactAt = t("commercial.validation.lastContactFuture");
  }

  if (values.stage === "LOST" && !LOST_REASONS.includes(values.lostReason)) errors.lostReason = t("commercial.validation.lostReasonRequired");
  return errors;
}

function assertValid(values) {
  const errors = validateOpportunity(values);
  const [field] = Object.keys(errors);
  if (field) throw new DataError(errors[field], { code: "validation", field });
}

export async function getOpportunities() {
  try {
    return await (await getCommercialRepository()).list();
  } catch (error) {
    throw toDataError(error, t("errors.data.loadOpportunities"));
  }
}

// A list that never throws, for screens that only summarize the pipeline (the
// Dashboard): an outage reads as a flagged empty board instead of an error.
export async function getOpportunitiesWithStatus() {
  try {
    return { items: await getOpportunities(), ok: true };
  } catch {
    return { items: [], ok: false };
  }
}

export async function getOpportunity(id) {
  try {
    return await (await getCommercialRepository()).getById(id);
  } catch (error) {
    throw toDataError(error, t("errors.data.loadOpportunities"));
  }
}

export async function createOpportunity(data = {}) {
  try {
    const values = sanitizeOpportunity({ ...DEFAULTS, ...data });
    assertValid(values);
    const created = await (await getCommercialRepository()).create(values);
    await logActivity("Opportunity created", label({ ...created, ...data }), meta("commercial.created", created));
    return created;
  } catch (error) {
    throw toDataError(error, t("errors.data.saveOpportunity"));
  }
}

// The log names what actually happened: a stage move, a win or a loss reads
// as that event, not as a generic edit.
function lifecycleEvent(before, after) {
  if (before.stage === after.stage) return ["commercial.updated", "Opportunity updated"];
  if (after.stage === "WON") return ["commercial.won", "Opportunity won"];
  if (after.stage === "LOST") return ["commercial.lost", "Opportunity lost"];
  if (!OPEN_STAGES.includes(before.stage)) return ["commercial.reopened", "Opportunity reopened"];
  return ["commercial.stage_changed", `Opportunity moved to ${after.stage}`];
}

export async function updateOpportunity(id, patch = {}, { context = {} } = {}) {
  try {
    const repository = await getCommercialRepository();
    const before = await repository.getById(id);
    if (!before) throw new DataError(t("errors.notFound"), { code: "not_found" });

    const values = sanitizeOpportunity(patch);
    assertValid({ ...before, ...values });

    const updated = await repository.update(id, values);
    if (!updated) throw new DataError(t("errors.notFound"), { code: "not_found" });
    const [action, title] = lifecycleEvent(before, updated);
    // A pure reorder inside a column is not worth a log line.
    const onlyPosition = Object.keys(values).every((key) => key === "position");
    if (!onlyPosition) await logActivity(title, label({ ...updated, ...context }), meta(action, updated));
    return updated;
  } catch (error) {
    throw toDataError(error, t("errors.data.saveOpportunity"));
  }
}

export async function moveOpportunity(id, stage, position) {
  if (stage === "WON" || stage === "LOST") {
    // Closing needs its own dialog (client, receivable, lost reason).
    throw new DataError(t("commercial.validation.closeWithDialog"), { code: "validation", field: "stage" });
  }
  const patch = { stage };
  if (Number.isFinite(position)) patch.position = position;
  return updateOpportunity(id, patch);
}

export async function reorderOpportunity(id, position) {
  return updateOpportunity(id, { position });
}

// Winning can also turn the lead into a client and put the value in the
// ledger as money to receive. The deal is closed first, so a failure in the
// follow-up steps never leaves a won deal marked as open; those steps report
// back as warnings instead.
export async function winOpportunity(id, { createClientRecord = false, receivable = null } = {}) {
  const opportunity = await getOpportunity(id);
  if (!opportunity) throw new DataError(t("errors.notFound"), { code: "not_found" });

  const warnings = [];
  let clientId = opportunity.clientId;
  let client = null;

  // Closed before anything else is written: if the close fails nothing has
  // been created, so a retry can never leave a second client behind.
  let won = await updateOpportunity(id, { stage: "WON" });

  if (createClientRecord && !clientId) {
    try {
      client = await createClient({
        name: opportunity.contactName || opportunity.company || opportunity.title,
        company: opportunity.company,
        email: opportunity.email,
        phone: opportunity.phone,
        status: "ACTIVE",
      });
      clientId = client.id;
    } catch (error) {
      warnings.push(toDataError(error, t("errors.data.createClient")).message);
    }
    if (client) {
      // Linking is part of the win already logged, not a separate edit.
      try {
        won = (await (await getCommercialRepository()).update(id, sanitizeOpportunity({ clientId }))) ?? won;
      } catch (error) {
        warnings.push(toDataError(error, t("errors.data.saveOpportunity")).message);
      }
    }
  }

  let transactions = [];
  if (receivable) {
    try {
      transactions = await createTransaction(
        {
          type: "INCOME",
          status: "PENDING",
          description: label({ ...won, clientName: client?.name ?? receivable.clientName }),
          category: receivable.category || "PROJECT",
          amount: receivable.amount ?? won.estimatedValue ?? "",
          dueDate: receivable.dueDate || todayKey(),
          clientId: clientId ?? "",
          notes: receivable.notes ?? "",
        },
        { installments: receivable.installments ?? 1 },
      );
    } catch (error) {
      warnings.push(toDataError(error, t("errors.data.saveTransaction")).message);
    }
  }

  return { opportunity: won, client, transactions, warnings };
}

export async function loseOpportunity(id, reason, note = "") {
  const patch = { stage: "LOST", lostReason: reason };
  if (note) {
    const current = await getOpportunity(id);
    patch.notes = [current?.notes, note].filter(Boolean).join("\n\n");
  }
  return updateOpportunity(id, patch);
}

// Back into the pipeline at the stage it would have been worked in next.
export async function reopenOpportunity(id, stage = "NEGOTIATION") {
  return updateOpportunity(id, { stage: OPEN_STAGES.includes(stage) ? stage : "NEGOTIATION" });
}

export async function deleteOpportunity(id) {
  try {
    const removed = await (await getCommercialRepository()).remove(id);
    if (!removed) throw new DataError(t("errors.notFound"), { code: "not_found" });
    await logActivity("Opportunity deleted", label(removed), meta("commercial.deleted", removed));
    return removed;
  } catch (error) {
    throw toDataError(error, t("errors.data.deleteOpportunity"));
  }
}
