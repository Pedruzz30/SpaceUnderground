import { getSupabaseClient } from "../../lib/supabase.js";
import { toDataError } from "../errors.js";
import { formatCaseNumber, mapProjectFromDatabase, mapProjectToDatabase, parseCaseNumber } from "../mappers/project-mapper.js";
import { supabaseMediaRepository } from "./supabase-media-repository.js";
import { t } from "../../i18n/index.js";

const TABLE = "projects";
const GALLERY_TABLE = "project_gallery";
const MODULES_TABLE = "project_modules";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Gallery rows come back nested through the foreign key so a project and its
// images are one round trip.
const PROJECT_SELECT = "*, project_gallery(*), project_modules(*)";

function unwrap(result, fallbackMessage) {
  if (result.error) throw toDataError(result.error, fallbackMessage);
  return result.data;
}

// The admin router still addresses projects by padded case number ("001"), so
// look-ups accept either that or the real uuid primary key.
async function findRow(id, columns = "*") {
  const supabase = getSupabaseClient();

  if (UUID_PATTERN.test(String(id))) {
    return unwrap(await supabase.from(TABLE).select(columns).eq("id", id).maybeSingle(), t("errors.data.loadProject"));
  }

  const caseNumber = parseCaseNumber(id);
  if (caseNumber === null) return null;

  return unwrap(await supabase.from(TABLE).select(columns).eq("case_number", caseNumber).maybeSingle(), t("errors.data.loadProject"));
}

// Reconciles the gallery the editor holds with the rows already stored:
// new items are inserted, removed ones deleted, and order is rewritten.
async function syncGallery(projectDbId, gallery) {
  const supabase = getSupabaseClient();

  const existing = unwrap(
    await supabase.from(GALLERY_TABLE).select("id").eq("project_id", projectDbId),
    t("errors.data.loadGallery"),
  );
  const existingIds = new Set(existing.map((row) => row.id));

  const keptIds = new Set();
  const inserts = [];

  gallery.forEach((item, index) => {
    if (item.id && existingIds.has(item.id)) {
      keptIds.add(item.id);
      return;
    }
    inserts.push({
      project_id: projectDbId,
      url: item.path,
      alt: item.alt || null,
      caption: item.caption || null,
      translations: item.translations ?? {},
      position: index,
    });
  });

  const removedIds = [...existingIds].filter((id) => !keptIds.has(id));
  if (removedIds.length) {
    unwrap(await supabase.from(GALLERY_TABLE).delete().in("id", removedIds), t("errors.data.updateGallery"));
  }

  // Rewrite positions for the rows that stayed, so reordering persists.
  for (const [index, item] of gallery.entries()) {
    if (keptIds.has(item.id)) {
      unwrap(
        await supabase.from(GALLERY_TABLE).update({ position: index }).eq("id", item.id),
        t("errors.data.updateGallery"),
      );
    }
  }

  if (inserts.length) {
    unwrap(await supabase.from(GALLERY_TABLE).insert(inserts), t("errors.data.saveGallery"));
  }
}

// Supabase PostgREST does not expose a browser-side transaction. This
// reconciler deletes first, parks kept rows at temporary positions, then writes
// final order so reordering cannot trip the unique (project_id, position) key.
async function syncModules(projectDbId, modules) {
  const supabase = getSupabaseClient();

  const existing = unwrap(
    await supabase.from(MODULES_TABLE).select("id").eq("project_id", projectDbId),
    t("errors.data.loadProjectModules"),
  );
  const existingIds = new Set(existing.map((row) => row.id));
  const keptIds = new Set(modules.filter((item) => item.id && existingIds.has(item.id)).map((item) => item.id));
  const removedIds = [...existingIds].filter((id) => !keptIds.has(id));

  if (removedIds.length) {
    unwrap(await supabase.from(MODULES_TABLE).delete().in("id", removedIds), t("errors.data.updateProjectModules"));
  }

  for (const [index, item] of modules.entries()) {
    if (!keptIds.has(item.id)) continue;
    unwrap(
      await supabase.from(MODULES_TABLE).update({ position: 100000 + index }).eq("id", item.id),
      t("errors.data.updateProjectModules"),
    );
  }

  for (const [index, item] of modules.entries()) {
    if (!keptIds.has(item.id)) continue;
    unwrap(
      await supabase
        .from(MODULES_TABLE)
        .update({
          position: index,
          code: item.code || null,
          title: item.title,
          description: item.description || null,
          translations: item.translations ?? {},
        })
        .eq("id", item.id),
      t("errors.data.updateProjectModules"),
    );
  }

  const inserts = modules
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !item.id || !existingIds.has(item.id))
    .map(({ item, index }) => ({
      project_id: projectDbId,
      position: index,
      code: item.code || null,
      title: item.title,
      description: item.description || null,
      translations: item.translations ?? {},
    }));

  if (inserts.length) {
    unwrap(await supabase.from(MODULES_TABLE).insert(inserts), t("errors.data.saveProjectModules"));
  }
}

export const supabaseProjectRepository = {
  async list() {
    const supabase = getSupabaseClient();
    // The list view never renders images, so the gallery is left out here.
    const result = await supabase.from(TABLE).select("*").order("case_number", { ascending: true });
    return unwrap(result, t("errors.data.loadProjects")).map(mapProjectFromDatabase);
  },

  async getById(id) {
    return mapProjectFromDatabase(await findRow(id, PROJECT_SELECT));
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

    const row = unwrap(result, t("errors.data.nextCaseNumber"));
    return formatCaseNumber((row?.case_number ?? 0) + 1);
  },

  async create(data) {
    const supabase = getSupabaseClient();
    const row = mapProjectToDatabase(data);

    if (row.case_number == null) {
      row.case_number = parseCaseNumber(await this.nextCaseNumber());
    }

    // published_at and the timestamps are owned by the database triggers.
    const created = mapProjectFromDatabase(
      unwrap(await supabase.from(TABLE).insert(row).select("*").single(), t("errors.data.createProject")),
    );

    if (data.gallery?.length) {
      await syncGallery(created.dbId, data.gallery);
    }

    if (data.modules?.length) {
      await syncModules(created.dbId, data.modules);
    }

    if (data.gallery?.length || data.modules?.length) {
      return this.getById(created.dbId);
    }

    return created;
  },

  async update(id, patch) {
    const supabase = getSupabaseClient();
    const existing = await findRow(id);
    if (!existing) return null;

    const row = mapProjectToDatabase(patch);
    // Case number is editorial identity: it is assigned once and never patched.
    delete row.case_number;

    unwrap(await supabase.from(TABLE).update(row).eq("id", existing.id).select("*").single(), t("errors.data.saveChanges"));

    if (Array.isArray(patch.gallery)) {
      await syncGallery(existing.id, patch.gallery);
    }

    if (Array.isArray(patch.modules)) {
      await syncModules(existing.id, patch.modules);
    }

    return this.getById(existing.id);
  },

  async remove(id) {
    const supabase = getSupabaseClient();
    const existing = await findRow(id);
    if (!existing) return null;

    // Delete the files first so they cannot outlive the record. This is best
    // effort on purpose: a storage failure would only leave orphans behind and
    // must not stop the admin from deleting the project.
    await supabaseMediaRepository.removeProjectFolder(existing.id).catch(() => ({ removed: 0 }));

    // project_gallery rows disappear through the foreign key cascade.
    unwrap(await supabase.from(TABLE).delete().eq("id", existing.id), t("errors.data.deleteProject"));
    return mapProjectFromDatabase(existing);
  },
};
