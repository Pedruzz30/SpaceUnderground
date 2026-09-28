import { buildSeedOpportunities } from "../../data/commercial.js";
import { mapOpportunityFromDatabase, mapOpportunityToDatabase, stampStage } from "../mappers/commercial-mapper.js";

// localStorage-backed repository with the same contract as the Supabase one.
// Writes go through mapOpportunityToDatabase, so trimming, casing, rounding and
// the stage bookkeeping follow exactly what the real table receives.

const COMMERCIAL_KEY = "space-admin:commercial:v1";

const clone = (value) => JSON.parse(JSON.stringify(value));
const nowIso = () => new Date().toISOString();

function readAll() {
  const stored = localStorage.getItem(COMMERCIAL_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Falls through to a fresh seed.
    }
  }
  const seed = buildSeedOpportunities();
  localStorage.setItem(COMMERCIAL_KEY, JSON.stringify(seed));
  return clone(seed);
}

function writeAll(entries) {
  localStorage.setItem(COMMERCIAL_KEY, JSON.stringify(entries));
}

// Model -> row -> model, merged over what is stored, so the mock keeps the
// same normalized values Postgres would.
const ROW_TO_MODEL = {
  title: "title",
  stage: "stage",
  priority: "priority",
  source: "source",
  client_id: "clientId",
  plan_id: "planId",
  contact_name: "contactName",
  company: "company",
  email: "email",
  phone: "phone",
  estimated_value: "estimatedValue",
  expected_close_date: "expectedCloseDate",
  next_action: "nextAction",
  next_action_at: "nextActionAt",
  last_contact_at: "lastContactAt",
  lost_reason: "lostReason",
  position: "position",
  notes: "notes",
};

function applyRow(current, row) {
  const merged = { ...current };
  Object.entries(ROW_TO_MODEL).forEach(([column, field]) => {
    if (column in row) merged[field] = row[column];
  });
  // Round-trip through the row mapper for the stored shape.
  return mapOpportunityFromDatabase({
    id: merged.id,
    title: merged.title,
    stage: merged.stage,
    priority: merged.priority,
    source: merged.source,
    client_id: merged.clientId,
    plan_id: merged.planId,
    contact_name: merged.contactName,
    company: merged.company,
    email: merged.email,
    phone: merged.phone,
    estimated_value: merged.estimatedValue,
    expected_close_date: merged.expectedCloseDate,
    next_action: merged.nextAction,
    next_action_at: merged.nextActionAt,
    last_contact_at: merged.lastContactAt,
    lost_reason: merged.lostReason,
    position: merged.position,
    notes: merged.notes,
    stage_changed_at: merged.stageChangedAt,
    closed_at: merged.closedAt,
    created_at: merged.createdAt,
    updated_at: merged.updatedAt,
  });
}

// Shaped like the Postgres errors for the constraints the real table enforces.
function assertStorable(model) {
  if (!model.title) throw { code: "23514", message: "commercial_opportunities_title_check" };
  if (model.stage === "LOST" && !model.lostReason) throw { code: "23514", message: "commercial_opportunities_lost_needs_reason" };
  if (model.estimatedValue !== null && model.estimatedValue < 0) throw { code: "23514", message: "commercial_opportunities_estimated_value_check" };
}

export const mockCommercialRepository = {
  async list() {
    return readAll().map((entry) => clone(entry));
  },

  async getById(id) {
    const entry = readAll().find((item) => item.id === id);
    return entry ? clone(entry) : null;
  },

  async create(data) {
    const entries = readAll();
    const timestamp = nowIso();
    const base = {
      id: `mock-opp-${crypto.randomUUID()}`,
      stage: "NEW",
      priority: "MEDIUM",
      source: "OTHER",
      position: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const model = applyRow(base, mapOpportunityToDatabase(data));
    Object.assign(model, stampStage(null, model, timestamp));
    model.createdAt = timestamp;
    model.updatedAt = timestamp;
    assertStorable(model);
    entries.push(model);
    writeAll(entries);
    return clone(model);
  },

  async update(id, patch) {
    const entries = readAll();
    const index = entries.findIndex((entry) => entry.id === id);
    if (index < 0) return null;

    const current = entries[index];
    const timestamp = nowIso();
    const next = applyRow(current, mapOpportunityToDatabase(patch));
    Object.assign(next, stampStage(current, next, timestamp));
    next.createdAt = current.createdAt;
    next.updatedAt = timestamp;
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

export function resetMockCommercial() {
  writeAll(buildSeedOpportunities());
}

export function clearMockCommercial() {
  writeAll([]);
}
