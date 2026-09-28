import { seedClients } from "../../data/clients.js";
import { mapClientToDatabase, nextClientCode, stampArchivedAt } from "../mappers/client-mapper.js";
import { normalizeClientStatus } from "../../utils/client-health.js";

// localStorage-backed repository with the same contract as the Supabase one.
// Writes go through mapClientToDatabase so trimming, blank-to-null and code
// casing follow exactly the rules the real table receives.

const CLIENTS_KEY = "space-admin:clients:v1";

const clone = (value) => JSON.parse(JSON.stringify(value));
const nowIso = () => new Date().toISOString();

function readAll() {
  const stored = localStorage.getItem(CLIENTS_KEY);
  if (!stored) {
    localStorage.setItem(CLIENTS_KEY, JSON.stringify(seedClients));
    return clone(seedClients);
  }

  try {
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) throw new Error("Corrupted client store");
    return parsed;
  } catch {
    localStorage.setItem(CLIENTS_KEY, JSON.stringify(seedClients));
    return clone(seedClients);
  }
}

function writeAll(clients) {
  localStorage.setItem(CLIENTS_KEY, JSON.stringify(clients));
}

// Shaped like the PostgREST error for clients_code_key, so the service maps
// both backends through the same toDataError() branch.
function duplicateCode(code) {
  return {
    code: "23505",
    message: 'duplicate key value violates unique constraint "clients_code_key"',
    details: `Key (code)=(${code}) already exists.`,
  };
}

// Converts the snake_case patch back to the UI model the mock stores.
function fromRow(row) {
  const model = {};
  if (row.code !== undefined) model.code = row.code;
  if (row.name !== undefined) model.name = row.name;
  if (row.company !== undefined) model.company = row.company ?? "";
  if (row.email !== undefined) model.email = row.email ?? "";
  if (row.phone !== undefined) model.phone = row.phone ?? "";
  if (row.status !== undefined) model.status = row.status;
  if (row.notes !== undefined) model.notes = row.notes ?? "";
  if (row.last_contact_at !== undefined) model.lastContactAt = row.last_contact_at;
  return model;
}

function normalize(client) {
  return {
    id: client.id,
    code: client.code ?? "",
    name: client.name ?? "",
    company: client.company ?? "",
    email: client.email ?? "",
    phone: client.phone ?? "",
    status: normalizeClientStatus(client.status),
    notes: client.notes ?? "",
    createdAt: client.createdAt ?? null,
    updatedAt: client.updatedAt ?? null,
    archivedAt: client.archivedAt ?? null,
    lastContactAt: client.lastContactAt ?? null,
  };
}

export const mockClientRepository = {
  async list() {
    return readAll()
      .map(normalize)
      .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
  },

  async getById(id) {
    const client = readAll().find((entry) => entry.id === id);
    return client ? normalize(client) : null;
  },

  async create(data) {
    const clients = readAll();
    const values = fromRow(mapClientToDatabase(data));
    const code = values.code || nextClientCode(clients.map((client) => client.code));
    if (clients.some((client) => client.code === code)) throw duplicateCode(code);

    const timestamp = nowIso();
    const client = normalize({
      status: "LEAD",
      ...values,
      id: `mock-client-${crypto.randomUUID()}`,
      code,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    client.archivedAt = stampArchivedAt(null, client, timestamp);

    clients.push(client);
    writeAll(clients);
    return clone(client);
  },

  async update(id, patch) {
    const clients = readAll();
    const index = clients.findIndex((client) => client.id === id);
    if (index < 0) return null;

    const current = normalize(clients[index]);
    const values = fromRow(mapClientToDatabase(patch));
    if (values.code && clients.some((client) => client.id !== id && client.code === values.code)) {
      throw duplicateCode(values.code);
    }

    const timestamp = nowIso();
    const next = normalize({
      ...current,
      ...values,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: timestamp,
    });
    next.archivedAt = stampArchivedAt(current, next, timestamp);

    clients[index] = next;
    writeAll(clients);
    return clone(next);
  },
};

export function resetMockClients() {
  writeAll(clone(seedClients));
}
