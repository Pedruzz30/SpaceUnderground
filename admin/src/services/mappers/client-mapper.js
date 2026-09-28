// Single place where the client UI model (camelCase) meets the database row
// (snake_case). Pages and services never do this conversion themselves.

import { normalizeClientStatus } from "../../utils/client-health.js";

// Listed explicitly rather than `*`: a column the Admin reads that no
// migration creates must fail as a clear test failure, not as PostgREST 42703
// in production. admin/tests/clients-migration.test.mjs checks this list.
export const CLIENT_COLUMNS = [
  "id",
  "code",
  "name",
  "company",
  "email",
  "phone",
  "status",
  "notes",
  "created_at",
  "updated_at",
  "archived_at",
  "last_contact_at",
].join(",");

export const CLIENT_CODE_PREFIX = "CLIENT-";

const CODE_NUMBER = /^CLIENT-(\d{1,18})$/;

export function formatClientCode(value) {
  const digits = String(Math.trunc(Number(value)));
  return `${CLIENT_CODE_PREFIX}${digits.padStart(3, "0")}`;
}

export function parseClientCodeNumber(code) {
  const match = String(code ?? "").trim().toUpperCase().match(CODE_NUMBER);
  return match ? Number(match[1]) : null;
}

// Highest existing number + 1, skipping anything already taken. Mirrors the
// database generator (public.next_client_code): never count(*), which reuses
// numbers after a removal.
export function nextClientCode(codes = []) {
  const taken = new Set(codes.map((code) => String(code ?? "").trim().toUpperCase()));
  let number = codes.reduce((max, code) => Math.max(max, parseClientCodeNumber(code) ?? 0), 0) + 1;
  while (taken.has(formatClientCode(number))) number += 1;
  return formatClientCode(number);
}

// Codes are stored upper case, so "client-004" and "CLIENT-004" are one code.
export function normalizeClientCode(value) {
  return String(value ?? "").trim().toUpperCase();
}

// Contact timestamps travel as ISO 8601 UTC strings ("2026-09-20T12:00:00.000Z")
// whatever the database or a caller returned ("+00:00" offsets, Date objects).
// Empty means never contacted; anything unparseable is kept as-is so the
// service's validation can reject it instead of it silently becoming null.
export function normalizeContactTimestamp(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const date = value instanceof Date ? value : new Date(String(value).trim());
  return Number.isNaN(date.getTime()) ? String(value).trim() : date.toISOString();
}

export function mapClientFromDatabase(row) {
  if (!row) return null;

  return {
    id: row.id,
    code: row.code ?? "",
    name: row.name ?? "",
    company: row.company ?? "",
    email: row.email ?? "",
    phone: row.phone ?? "",
    status: normalizeClientStatus(row.status),
    notes: row.notes ?? "",
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
    archivedAt: row.archived_at ?? null,
    lastContactAt: normalizeContactTimestamp(row.last_contact_at),
  };
}

// Only fields present in the model reach the patch, so a partial update never
// blanks a column it did not mean to touch. archived_at and the timestamps
// belong to the database triggers and are never written from here.
export function mapClientToDatabase(model) {
  const row = {};
  const optional = (value) => {
    const trimmed = String(value ?? "").trim();
    return trimmed || null;
  };

  if (model.code !== undefined) {
    const code = normalizeClientCode(model.code);
    // An empty code is left out so the database default assigns one.
    if (code) row.code = code;
  }
  if (model.name !== undefined) row.name = String(model.name ?? "").trim();
  if (model.company !== undefined) row.company = optional(model.company);
  if (model.email !== undefined) row.email = optional(model.email);
  if (model.phone !== undefined) row.phone = optional(model.phone);
  if (model.status !== undefined) row.status = normalizeClientStatus(model.status);
  if (model.notes !== undefined) row.notes = optional(model.notes);
  if (model.lastContactAt !== undefined) row.last_contact_at = normalizeContactTimestamp(model.lastContactAt);

  return row;
}

// The rule public.stamp_client_archived_at() enforces in Postgres, for the
// mock repository, which has no trigger to lean on.
export function stampArchivedAt(previous, next, now = new Date().toISOString()) {
  if (next.status !== "ARCHIVED") return null;
  if (previous?.status === "ARCHIVED") return previous.archivedAt ?? now;
  return now;
}
