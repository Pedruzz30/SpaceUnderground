import { buildSeedTransactions } from "../../data/financial.js";
import { mapTransactionFromDatabase, mapTransactionToDatabase, stampPaidAt } from "../mappers/financial-mapper.js";
import { byEffectiveDateDesc } from "../../utils/financial-metrics.js";

// localStorage-backed repository with the same contract as the Supabase one.
// Writes go through mapTransactionToDatabase, so trimming, casing, rounding and
// the paid_at rule follow exactly what the real table receives.

const FINANCIAL_KEY = "space-admin:financial:v1";

const clone = (value) => JSON.parse(JSON.stringify(value));
const nowIso = () => new Date().toISOString();

function readAll() {
  const stored = localStorage.getItem(FINANCIAL_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Falls through to a fresh seed.
    }
  }
  const seed = buildSeedTransactions();
  localStorage.setItem(FINANCIAL_KEY, JSON.stringify(seed));
  return clone(seed);
}

function writeAll(entries) {
  localStorage.setItem(FINANCIAL_KEY, JSON.stringify(entries));
}

// Row -> model, then back onto the stored record, so the mock stores the same
// normalized values Postgres would.
function applyRow(current, row) {
  const model = mapTransactionFromDatabase({
    id: current.id,
    type: row.type ?? current.type,
    status: row.status ?? current.status,
    description: row.description ?? current.description,
    category: row.category ?? current.category,
    amount: row.amount ?? current.amount,
    currency: current.currency ?? "BRL",
    due_date: row.due_date ?? current.dueDate,
    paid_at: "paid_at" in row ? row.paid_at : current.paidAt,
    client_id: "client_id" in row ? row.client_id : current.clientId,
    project_id: "project_id" in row ? row.project_id : current.projectId,
    notes: "notes" in row ? row.notes : current.notes,
    created_at: current.createdAt,
    updated_at: current.updatedAt,
  });
  return model;
}

function constraintError(message) {
  return { code: "23514", message };
}

function assertStorable(model) {
  if (!model.description) throw constraintError("financial_transactions_description_check");
  if (!(model.amount > 0)) throw constraintError("financial_transactions_amount_check");
  if (!model.dueDate) throw constraintError("null value in column \"due_date\"");
}

export const mockFinancialRepository = {
  async list() {
    return readAll().map((entry) => clone(entry)).sort(byEffectiveDateDesc);
  },

  async getById(id) {
    const entry = readAll().find((item) => item.id === id);
    return entry ? clone(entry) : null;
  },

  async create(data) {
    const [created] = await this.createMany([data]);
    return created;
  },

  // All or nothing, like the single multi-row insert the Supabase repository sends.
  async createMany(list) {
    const entries = readAll();
    const timestamp = nowIso();
    const created = list.map((data) => {
      const base = { id: `mock-tx-${crypto.randomUUID()}`, currency: "BRL", createdAt: timestamp, updatedAt: timestamp };
      const model = applyRow({ ...base, status: "PENDING", category: "OTHER", clientId: null, projectId: null, notes: "", paidAt: null }, mapTransactionToDatabase(data));
      model.paidAt = stampPaidAt(null, model);
      model.createdAt = timestamp;
      model.updatedAt = timestamp;
      assertStorable(model);
      return model;
    });
    writeAll([...entries, ...created]);
    return clone(created);
  },

  async update(id, patch) {
    const entries = readAll();
    const index = entries.findIndex((entry) => entry.id === id);
    if (index < 0) return null;

    const current = entries[index];
    const next = applyRow(current, mapTransactionToDatabase(patch));
    next.paidAt = stampPaidAt(current, next);
    next.createdAt = current.createdAt;
    next.updatedAt = nowIso();
    assertStorable(next);

    entries[index] = next;
    writeAll(entries);
    return clone(next);
  },

  async remove(id) {
    const entries = readAll();
    const entry = entries.find((item) => item.id === id);
    if (!entry) return null;
    writeAll(entries.filter((item) => item.id !== id));
    return clone(entry);
  },
};

export function resetMockFinancial() {
  writeAll(buildSeedTransactions());
}

export function clearMockFinancial() {
  writeAll([]);
}
