import { seedProjects } from "../data/projects.js";

const STORAGE_KEY = "space-admin:projects:v1";

const clone = (value) => JSON.parse(JSON.stringify(value));

// Temporary mock persistence. Replace with Supabase data access in a future branch.
export function getProjects() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seedProjects));
    return clone(seedProjects);
  }

  try {
    return JSON.parse(stored);
  } catch {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seedProjects));
    return clone(seedProjects);
  }
}

export function getProject(id) {
  return getProjects().find((project) => project.id === id);
}

export function saveProject(nextProject) {
  const projects = getProjects();
  const index = projects.findIndex((project) => project.id === nextProject.id);
  const updated = { ...nextProject, updatedAt: new Date().toISOString().slice(0, 10) };

  if (index >= 0) projects[index] = updated;
  else projects.push(updated);

  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  return updated;
}
