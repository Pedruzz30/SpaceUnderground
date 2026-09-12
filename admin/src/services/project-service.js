import { logActivity } from "./activity-service.js";
import { toDataError } from "./errors.js";
import { getProjectRepository } from "./repositories/index.js";
import { t } from "../i18n/index.js";

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

function projectMeta(action, project) {
  return {
    action,
    entityType: "project",
    entityId: project?.dbId || project?.id || null,
  };
}

export async function getProjects() {
  try {
    const repository = await getProjectRepository();
    return await repository.list();
  } catch (error) {
    throw toDataError(error, t("errors.data.loadProjects"));
  }
}

export async function getProjectById(id) {
  try {
    const repository = await getProjectRepository();
    return await repository.getById(id);
  } catch (error) {
    throw toDataError(error, t("errors.data.loadProject"));
  }
}

export async function nextAvailableCaseNumber() {
  try {
    const repository = await getProjectRepository();
    return await repository.nextCaseNumber();
  } catch (error) {
    throw toDataError(error, t("errors.data.nextCaseNumber"));
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

    await logActivity("Project created", `CASE ${created.caseNumber} created`, projectMeta("project.created", created));
    return created;
  } catch (error) {
    throw toDataError(error, t("errors.data.createProject"));
  }
}

export async function updateProject(id, patch) {
  try {
    const repository = await getProjectRepository();
    const before = await repository.getById(id);
    const updated = await repository.update(id, patch);
    if (!updated) throw toDataError({ code: "not_found" }, "Project not found.");

    const previousStatus = before?.editorialStatus;
    const nextStatus = updated.editorialStatus;
    let action = "project.updated";
    let title = "Project updated";
    let detail = `CASE ${updated.caseNumber} updated`;

    if (previousStatus !== nextStatus && nextStatus === "PUBLISHED") {
      action = "project.published";
      title = "Project published";
      detail = `CASE ${updated.caseNumber} published`;
    } else if (previousStatus === "PUBLISHED" && nextStatus === "DRAFT") {
      action = "project.unpublished";
      title = "Project unpublished";
      detail = `CASE ${updated.caseNumber} unpublished`;
    }

    await logActivity(title, detail, projectMeta(action, updated));
    return updated;
  } catch (error) {
    throw toDataError(error, t("errors.data.saveChanges"));
  }
}

export async function deleteProject(id) {
  try {
    const repository = await getProjectRepository();
    const removed = await repository.remove(id);
    if (removed) {
      await logActivity("Project deleted", `CASE ${removed.caseNumber} deleted`, projectMeta("project.deleted", removed));
    }
    return removed;
  } catch (error) {
    throw toDataError(error, t("errors.data.deleteProject"));
  }
}

export async function archiveProject(id) {
  try {
    const repository = await getProjectRepository();
    const archived = await repository.update(id, { editorialStatus: "ARCHIVED" });
    if (!archived) throw toDataError({ code: "not_found" }, "Project not found.");

    await logActivity("Project archived", `CASE ${archived.caseNumber} archived`, projectMeta("project.archived", archived));
    return archived;
  } catch (error) {
    throw toDataError(error, t("errors.data.archiveProject"));
  }
}
