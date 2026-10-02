// A change request, field by field: the project's current values as the
// database columns a draft names, what the draft proposes, and what differs.
// Pure, so the review screen and the tests read the same answer.

import { DRAFT_FIELDS } from "../security/catalog.js";

const blank = (value) => value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length);

function same(a, b) {
  if (blank(a) && blank(b)) return true;
  if (Array.isArray(a) || Array.isArray(b) || (a && typeof a === "object") || (b && typeof b === "object")) {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  }
  return String(a) === String(b);
}

// The Admin's project model, as the columns a draft may change.
export function projectColumns(project = {}) {
  return {
    name: project.name ?? "",
    client: project.client ?? "",
    category: project.category ?? "",
    description: project.description ?? "",
    status: project.status ?? "",
    year: project.year === "" || project.year == null ? null : Number(project.year),
    accent: project.accent ?? "",
    tech_stack: project.techStack ?? [],
    poster_url: project.poster ?? "",
    project_url: project.projectUrl ?? "",
    presentation_system: project.presentation?.system ?? "",
    presentation_label: project.presentation?.label ?? "",
    presentation_address: project.presentation?.address ?? "",
    presentation_type: project.presentation?.type ?? "",
    origin: project.presentation?.origin ?? "",
    coordinates: project.presentation?.coordinates ?? [],
    translations: project.translations ?? {},
    editorial_status: project.editorialStatus ?? "",
  };
}

const kindOf = (column) =>
  column === "poster_url" ? "asset" : column === "translations" ? "json" : ["tech_stack", "coordinates"].includes(column) ? "list" : "text";

// Only the columns the draft names, in the catalog's order.
export function diffProposal(proposed = {}, current = {}) {
  return DRAFT_FIELDS.filter((column) => Object.prototype.hasOwnProperty.call(proposed, column)).map((column) => ({
    column,
    kind: kindOf(column),
    before: current[column] ?? null,
    after: proposed[column] ?? null,
    changed: !same(current[column], proposed[column]),
  }));
}

export function changedCount(diff) {
  return diff.filter((entry) => entry.changed).length;
}

// What the draft editor sends: only the fields that differ from the project,
// typed the way the database validates them.
export function draftFields(values = {}, current = {}) {
  const typed = {};
  for (const [column, raw] of Object.entries(values)) {
    if (!DRAFT_FIELDS.includes(column)) continue;
    let value = raw;
    if (column === "year") value = String(raw ?? "").trim() === "" ? null : Number(raw);
    else if (column === "tech_stack" || column === "coordinates") {
      value = Array.isArray(raw)
        ? raw
        : String(raw ?? "")
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean);
    } else if (typeof raw === "string") value = raw.trim();
    if (!same(current[column], value)) typed[column] = value;
  }
  return typed;
}

export function displayValue(value) {
  if (blank(value)) return "—";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}
