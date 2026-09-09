import { seedProjects } from "../../data/projects.js";
import { formatCaseNumber } from "../mappers/project-mapper.js";

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
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
}

function nextNumber(projects) {
  const highest = projects.reduce((max, project) => Math.max(max, Number(project.caseNumber) || 0), 0);
  return formatCaseNumber(highest + 1);
}

export const mockProjectRepository = {
  async list() {
    return readAll();
  },

  async getById(id) {
    return readAll().find((project) => project.id === id) ?? null;
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
    };

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
