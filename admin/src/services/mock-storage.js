import { seedProjects } from "../data/projects.js";

// Temporary mock persistence. Replace with Supabase data access in a future branch.
// Every function here is the seam that will become an async Supabase call later,
// so pages must go through this module instead of touching localStorage directly.

const PROJECTS_KEY = "space-admin:projects:v2";
const ACTIVITY_KEY = "space-admin:activity:v1";
const MAX_ACTIVITY_ENTRIES = 20;

const clone = (value) => JSON.parse(JSON.stringify(value));
const nowIso = () => new Date().toISOString();

function readProjects() {
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

function writeProjects(projects) {
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
}

function nextCaseNumber(projects) {
  const highest = projects.reduce((max, project) => Math.max(max, Number(project.caseNumber) || 0), 0);
  return String(highest + 1).padStart(3, "0");
}

export function getProjects() {
  return readProjects();
}

export function getProjectById(id) {
  return readProjects().find((project) => project.id === id) || null;
}

export function nextAvailableCaseNumber() {
  return nextCaseNumber(readProjects());
}

export function createProject(data = {}) {
  const projects = readProjects();
  const caseNumber = data.caseNumber || nextCaseNumber(projects);
  const timestamp = nowIso();

  const project = {
    name: "",
    slug: "",
    client: "",
    category: "Website",
    description: "",
    status: "In Development",
    editorialStatus: "DRAFT",
    featured: false,
    visible: false,
    year: String(new Date().getFullYear()),
    accent: "#c6ff00",
    techStack: [],
    poster: "",
    gallery: [],
    projectUrl: "",
    previewUrl: "",
    ...data,
    id: caseNumber,
    caseNumber,
    createdAt: timestamp,
    updatedAt: timestamp,
    publishedAt: data.editorialStatus === "PUBLISHED" ? timestamp : null,
  };

  projects.push(project);
  writeProjects(projects);
  logActivity("Project created", `CASE ${project.caseNumber} created`);
  return project;
}

export function updateProject(id, patch) {
  const projects = readProjects();
  const index = projects.findIndex((project) => project.id === id);
  if (index < 0) throw new Error(`Project ${id} not found in mock storage`);

  const current = projects[index];
  const next = {
    ...current,
    ...patch,
    id: current.id,
    caseNumber: current.caseNumber,
    createdAt: current.createdAt,
    updatedAt: nowIso(),
  };

  if (next.editorialStatus === "PUBLISHED" && !next.publishedAt) {
    next.publishedAt = nowIso();
  }

  projects[index] = next;
  writeProjects(projects);
  return next;
}

export function deleteProject(id) {
  const projects = readProjects();
  const target = projects.find((project) => project.id === id);
  writeProjects(projects.filter((project) => project.id !== id));
  if (target) logActivity("Project deleted", `CASE ${target.caseNumber} deleted`);
}

export function archiveProject(id) {
  const project = updateProject(id, { editorialStatus: "ARCHIVED" });
  logActivity("Project archived", `CASE ${project.caseNumber} archived`);
  return project;
}

export function resetMockData() {
  writeProjects(clone(seedProjects));
  localStorage.removeItem(ACTIVITY_KEY);
}

// Dev helper: run `window.__resetSpaceAdminMocks()` from the browser console
// to restore the seed data during local development.
if (typeof window !== "undefined") {
  window.__resetSpaceAdminMocks = resetMockData;
}

export function getActivity() {
  const stored = localStorage.getItem(ACTIVITY_KEY);
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function logActivity(title, detail) {
  const entries = getActivity();
  entries.unshift({ title, detail, time: nowIso() });
  localStorage.setItem(ACTIVITY_KEY, JSON.stringify(entries.slice(0, MAX_ACTIVITY_ENTRIES)));
}
