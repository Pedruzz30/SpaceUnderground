import { getSupabaseClient } from "../../lib/supabase.js";
import { toDataError } from "../errors.js";
import { formatCaseNumber, mapProjectFromDatabase, mapProjectToDatabase, parseCaseNumber } from "../mappers/project-mapper.js";

const TABLE = "projects";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function unwrap(result, fallbackMessage) {
  if (result.error) throw toDataError(result.error, fallbackMessage);
  return result.data;
}

// The admin router still addresses projects by padded case number ("001"), so
// look-ups accept either that or the real uuid primary key.
async function findRow(id) {
  const supabase = getSupabaseClient();

  if (UUID_PATTERN.test(String(id))) {
    const result = await supabase.from(TABLE).select("*").eq("id", id).maybeSingle();
    return unwrap(result, "Unable to load project.");
  }

  const caseNumber = parseCaseNumber(id);
  if (caseNumber === null) return null;

  const result = await supabase.from(TABLE).select("*").eq("case_number", caseNumber).maybeSingle();
  return unwrap(result, "Unable to load project.");
}

export const supabaseProjectRepository = {
  async list() {
    const supabase = getSupabaseClient();
    const result = await supabase.from(TABLE).select("*").order("case_number", { ascending: true });
    return unwrap(result, "Unable to load projects.").map(mapProjectFromDatabase);
  },

  async getById(id) {
    return mapProjectFromDatabase(await findRow(id));
  },

  async nextCaseNumber() {
    const supabase = getSupabaseClient();
    // Highest existing number + 1 — never count(*), which collides after deletes.
    const result = await supabase
      .from(TABLE)
      .select("case_number")
      .order("case_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    const row = unwrap(result, "Unable to determine the next case number.");
    return formatCaseNumber((row?.case_number ?? 0) + 1);
  },

  async create(data) {
    const supabase = getSupabaseClient();
    const row = mapProjectToDatabase(data);

    if (row.case_number == null) {
      row.case_number = parseCaseNumber(await this.nextCaseNumber());
    }

    // published_at and the timestamps are owned by the database triggers.
    const result = await supabase.from(TABLE).insert(row).select("*").single();
    return mapProjectFromDatabase(unwrap(result, "Unable to create project."));
  },

  async update(id, patch) {
    const supabase = getSupabaseClient();
    const existing = await findRow(id);
    if (!existing) return null;

    const row = mapProjectToDatabase(patch);
    // Case number is editorial identity: it is assigned once and never patched.
    delete row.case_number;

    const result = await supabase.from(TABLE).update(row).eq("id", existing.id).select("*").single();
    return mapProjectFromDatabase(unwrap(result, "Unable to save changes."));
  },

  async remove(id) {
    const supabase = getSupabaseClient();
    const existing = await findRow(id);
    if (!existing) return null;

    const result = await supabase.from(TABLE).delete().eq("id", existing.id);
    unwrap(result, "Unable to delete project.");
    return mapProjectFromDatabase(existing);
  },
};
