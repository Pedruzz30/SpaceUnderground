import { seedProjects } from "../../data/projects.js";
import { DataError } from "../errors.js";
import { formatCaseNumber } from "../mappers/project-mapper.js";
import { t } from "../../i18n/index.js";

// localStorage-backed repository. Same persistence the admin has always used,
// now behind the async repository contract so it can be swapped for Supabase.

const PROJECTS_KEY = "space-admin:projects:v2";

const clone = (value) => JSON.parse(JSON.stringify(value));
const nowIso = () => new Date().toISOString();

function readAll() {
  const stored = localStorage.getItem(PROJECTS_KEY);
  if (!stored) {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(seedProjects));
    return clone(seedProjects);
  }

  try {
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) throw new Error("Corrupted project store");
    return parsed;
  } catch {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(seedProjects));
    return clone(seedProjects);
  }
}

function writeAll(projects) {
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
  } catch (error) {
    // Mock images are inlined as data URLs, so localStorage can genuinely fill up.
    if (error?.name === "QuotaExceededError" || error?.code === 22) {
      throw new DataError("Mock storage is full. Remove some images or use smaller files.", { code: "quota_exceeded" });
    }
    throw error;
  }
}

// Older mock records stored gallery items as { id, url }.
function normalizeGallery(project) {
  const next = {
    ...project,
    // Mock stand-in for projects.version: bumped on every save, which is all
    // the mock approval flow needs to detect a stale draft.
    version: Number(project.version) || 1,
    gallery: Array.isArray(project.gallery)
      ? project.gallery.map((item) => ({ ...item, path: item.path ?? item.url ?? "" }))
      : [],
    presentation: {
      system: project.presentation?.system ?? "",
      label: project.presentation?.label ?? "",
      address: project.presentation?.address ?? "",
      type: project.presentation?.type ?? "",
      origin: project.presentation?.origin ?? "",
      coordinates: Array.isArray(project.presentation?.coordinates) ? project.presentation.coordinates : [],
    },
    modules: Array.isArray(project.modules)
      ? project.modules
          .map((item, index) => ({
            id: item.id ?? `mock-module-${project.id || "new"}-${index}`,
            position: Number.isFinite(Number(item.position)) ? Number(item.position) : index,
            code: item.code ?? "",
            title: item.title ?? "",
            description: item.description ?? "",
            // Rebuilding the module field by field used to drop this, so every
            // read silently discarded the English copy of a module.
            translations: item.translations ?? {},
          }))
          .sort((a, b) => a.position - b.position)
      : [],
  };
  return next;
}

function nextNumber(projects) {
  const highest = projects.reduce((max, project) => Math.max(max, Number(project.caseNumber) || 0), 0);
  return formatCaseNumber(highest + 1);
}

function setClientIf(id, allowed, clientId, conflictKey) {
  const projects = readAll();
  const index = projects.findIndex((project) => project.id === id);
  if (index < 0) return null;
  if (!allowed(projects[index])) throw new DataError(t(conflictKey), { code: "conflict" });
  projects[index] = { ...projects[index], clientId, updatedAt: nowIso() };
  writeAll(projects);
  return normalizeGallery(projects[index]);
}

export const mockProjectRepository = {
  async list() {
    return readAll().map(normalizeGallery);
  },

  async listByClient(clientId) {
    return readAll()
      .filter((project) => clientId && project.clientId === clientId)
      .map(normalizeGallery);
  },

  // Same conditional contract as the Supabase repository: link only an
  // unowned project, unlink only from the expected client. Read, check and
  // write happen in one synchronous step, so no other call can interleave.
  async assignClient(id, clientId) {
    return setClientIf(id, (current) => !current.clientId, clientId, "clientEditor.projectAlreadyLinked");
  },

  async releaseClient(id, clientId) {
    return setClientIf(id, (current) => current.clientId === clientId, null, "clientEditor.projectLinkChanged");
  },

  async getById(id) {
    const project = readAll().find((entry) => entry.id === id);
    return project ? normalizeGallery(project) : null;
  },

  async nextCaseNumber() {
    return nextNumber(readAll());
  },

  async create(data) {
    const projects = readAll();
    const caseNumber = data.caseNumber || nextNumber(projects);
    const timestamp = nowIso();

    const project = {
      ...data,
      id: caseNumber,
      dbId: null,
      caseNumber,
      modules: (data.modules || []).map((item, index) => ({
        ...item,
        id: item.id || `mock-module-${caseNumber}-${crypto.randomUUID()}`,
        position: index,
      })),
      createdAt: timestamp,
      updatedAt: timestamp,
      publishedAt: data.editorialStatus === "PUBLISHED" ? timestamp : null,
    };

    projects.push(project);
    writeAll(projects);
    return project;
  },

  async update(id, patch) {
    const projects = readAll();
    const index = projects.findIndex((project) => project.id === id);
    if (index < 0) return null;

    const current = projects[index];
    const next = {
      ...current,
      ...patch,
      id: current.id,
      caseNumber: current.caseNumber,
      createdAt: current.createdAt,
      updatedAt: nowIso(),
      // Owned by the store, like the database's trigger: a patch cannot set it.
      version: (Number(current.version) || 1) + 1,
    };

    if (Array.isArray(patch.modules)) {
      next.modules = patch.modules.map((item, moduleIndex) => ({
        ...item,
        id: item.id || `mock-module-${current.id}-${crypto.randomUUID()}`,
        position: moduleIndex,
      }));
    }

    // First publication stamps published_at; later edits never reset it.
    if (next.editorialStatus === "PUBLISHED" && !next.publishedAt) {
      next.publishedAt = nowIso();
    }

    projects[index] = next;
    writeAll(projects);
    return next;
  },

  async remove(id) {
    const projects = readAll();
    const target = projects.find((project) => project.id === id) ?? null;
    writeAll(projects.filter((project) => project.id !== id));
    return target;
  },
};

export function resetMockProjects() {
  writeAll(clone(seedProjects));
}
