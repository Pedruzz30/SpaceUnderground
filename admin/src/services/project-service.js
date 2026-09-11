import { logActivity } from "./activity-service.js";
import { toDataError } from "./errors.js";
import { getProjectRepository } from "./repositories/index.js";

// Async contract used by every admin page. Pages call these functions and never
// learn whether the data came from localStorage, Supabase or anything else.

const PROJECT_DEFAULTS = {
  name: "",
  slug: "",
  client: "",
  category: "Website",
  description: "",
  status: "In Development",
  editorialStatus: "DRAFT",
  featured: false,
  visible: false,
  accent: "#c6ff00",
  techStack: [],
  poster: "",
  gallery: [],
  projectUrl: "",
  previewUrl: "",
};

export async function getProjects() {
  try {
    const repository = await getProjectRepository();
    return await repository.list();
  } catch (error) {
    throw toDataError(error, "Unable to load projects.");
  }
}

export async function getProjectById(id) {
  try {
    const repository = await getProjectRepository();
    return await repository.getById(id);
  } catch (error) {
    throw toDataError(error, "Unable to load project.");
  }
}

export async function nextAvailableCaseNumber() {
  try {
    const repository = await getProjectRepository();
    return await repository.nextCaseNumber();
  } catch (error) {
    throw toDataError(error, "Unable to determine the next case number.");
  }
}

export async function createProject(data = {}) {
  try {
    const repository = await getProjectRepository();
    const created = await repository.create({
      ...PROJECT_DEFAULTS,
      year: String(new Date().getFullYear()),
      ...data,
    });

    await logActivity("Project created", `CASE ${created.caseNumber} created`, {
      action: "project.created",
      entityType: "project",
      entityId: created.id,
    });
    return created;
  } catch (error) {
    throw toDataError(error, "Unable to create project.");
  }
}

export async function updateProject(id, patch) {
  try {
    const repository = await getProjectRepository();
    const updated = await repository.update(id, patch);
    if (!updated) throw toDataError({ code: "not_found" }, "Project not found.");
    return updated;
  } catch (error) {
    throw toDataError(error, "Unable to save changes.");
  }
}

export async function deleteProject(id) {
  try {
    const repository = await getProjectRepository();
    const removed = await repository.remove(id);
    if (removed) {
      await logActivity("Project deleted", `CASE ${removed.caseNumber} deleted`, {
        action: "project.deleted",
        entityType: "project",
        entityId: removed.id,
      });
    }
    return removed;
  } catch (error) {
    throw toDataError(error, "Unable to delete project.");
  }
}

export async function archiveProject(id) {
  try {
    const repository = await getProjectRepository();
    const archived = await repository.update(id, { editorialStatus: "ARCHIVED" });
    if (!archived) throw toDataError({ code: "not_found" }, "Project not found.");

    await logActivity("Project archived", `CASE ${archived.caseNumber} archived`, {
      action: "project.archived",
      entityType: "project",
      entityId: archived.id,
    });
    return archived;
  } catch (error) {
    throw toDataError(error, "Unable to archive project.");
  }
}
