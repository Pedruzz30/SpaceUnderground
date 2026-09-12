import { badge, badgeType } from "../components/badge.js";
import { getProjects } from "../services/project-service.js";
import { describeError } from "../services/errors.js";
import { t } from "../i18n/index.js";
import { escapeAttribute, escapeHtml } from "../utils/html.js";

function formatUpdated(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const diff = Date.now() - date.getTime();
  const day = 24 * 60 * 60 * 1000;
  if (diff >= 0 && diff < day) return t("format.today");
  if (diff >= 0 && diff < day * 7) return t("format.daysAgo", { count: Math.max(1, Math.round(diff / day)) });
  return date.toLocaleDateString(document.documentElement.lang || undefined, { month: "short", day: "2-digit" });
}

function visibilityLabel(project) {
  return project.visible ? t("common.visible").toUpperCase() : t("common.hidden").toUpperCase();
}

function projectCard(project) {
  return `
    <button class="project-row" type="button" data-project-id="${escapeAttribute(project.id)}">
      <span class="project-row__case">${escapeHtml(project.caseNumber)}</span>
      <span class="project-row__project">
        <strong>${escapeHtml(project.name || t("projects.untitled"))}</strong>
        <small>${escapeHtml(project.client || project.slug || t("projects.noClient"))}</small>
      </span>
      <span data-label="${t("common.category")}">${escapeHtml(project.category || t("projects.uncategorised"))}</span>
      <span data-label="${t("common.status")}">${badge(project.status, badgeType(project.status))}</span>
      <span data-label="${t("common.editorial")}">${badge(project.editorialStatus, badgeType(project.editorialStatus))}</span>
      <span data-label="${t("common.visibility")}">${escapeHtml(visibilityLabel(project))}</span>
      <span data-label="${t("common.updated")}">${escapeHtml(formatUpdated(project.updatedAt))}</span>
      <span class="project-row__arrow" aria-hidden="true">&rarr;</span>
    </button>
  `;
}

export const projectsPage = {
  title: () => t("projects.title"),
  breadcrumb: () => t("projects.breadcrumb"),
  render: () => `
    <section class="page-heading page-heading--split">
      <div>
        <span>${t("projects.eyebrow")}</span>
        <h2>${t("projects.heading")}</h2>
        <p>${t("projects.intro")}</p>
      </div>
      <div class="heading-actions">
        <button class="button button--primary" type="button" data-new-project>${t("projects.newProject")}</button>
      </div>
    </section>

    <section class="panel projects-panel">
      <div class="toolbar">
        <label class="search-field">
          <span>${t("projects.searchProjects")}</span>
          <input data-search-projects type="search" placeholder="${t("projects.searchPlaceholder")}" disabled>
        </label>
        <div class="toolbar__controls">
          <label class="sort-field">
            <span>${t("projects.sortBy")}</span>
            <select data-project-sort disabled>
              <option value="updated">${t("projects.sortUpdated")}</option>
              <option value="case">${t("projects.sortCase")}</option>
              <option value="name">${t("projects.sortName")}</option>
            </select>
          </label>
          <div class="segmented" role="group" aria-label="${t("projects.filterEditorial")}">
            <button type="button" class="is-active" data-editorial-filter="ALL" aria-pressed="true">${t("common.all").toUpperCase()}</button>
            <button type="button" data-editorial-filter="PUBLISHED" aria-pressed="false">${t("common.published").toUpperCase()}</button>
            <button type="button" data-editorial-filter="DRAFT" aria-pressed="false">${t("common.draft").toUpperCase()}</button>
            <button type="button" data-editorial-filter="ARCHIVED" aria-pressed="false">${t("common.archived").toUpperCase()}</button>
          </div>
        </div>
      </div>

      <div class="project-table" data-project-list aria-live="polite" aria-busy="true">
        <div class="project-row project-row--skeleton"></div>
        <div class="project-row project-row--skeleton"></div>
        <div class="project-row project-row--skeleton"></div>
      </div>
    </section>
  `,
  afterRender: async () => {
    document.querySelector("[data-new-project]")?.addEventListener("click", () => {
      window.location.hash = "#/projects/new";
    });

    const search = document.querySelector("[data-search-projects]");
    const sort = document.querySelector("[data-project-sort]");
    const list = document.querySelector("[data-project-list]");
    const filters = [...document.querySelectorAll("[data-editorial-filter]")];
    let activeFilter = "ALL";
    let projects = [];

    const renderList = () => {
      const query = search.value.trim().toLowerCase();
      const visible = projects.filter((project) => {
        const matchesQuery = [project.name, project.client, project.category, project.status, project.slug].some((value) =>
          String(value).toLowerCase().includes(query),
        );
        const matchesFilter = activeFilter === "ALL" || project.editorialStatus === activeFilter;
        return matchesQuery && matchesFilter;
      }).sort((a, b) => {
        if (sort.value === "case") return String(a.caseNumber).localeCompare(String(b.caseNumber));
        if (sort.value === "name") return String(a.name || "").localeCompare(String(b.name || ""));
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });

      const emptyMessage = projects.length
        ? t("projects.noMatch")
        : t("projects.empty");

      list.innerHTML = `
        <div class="project-table__head" aria-hidden="true">
          <span>CASE</span><span>${t("dashboard.project")}</span><span>${t("common.category").toUpperCase()}</span><span>${t("common.status").toUpperCase()}</span><span>${t("common.editorial").toUpperCase()}</span><span>${t("common.visibility").toUpperCase()}</span><span>${t("common.updated").toUpperCase()}</span><span></span>
        </div>
        ${visible.length ? visible.map(projectCard).join("") : `<p class="empty-inline">${emptyMessage}</p>`}
      `;

      list.querySelectorAll("[data-project-id]").forEach((row) => {
        row.addEventListener("click", () => {
          window.location.hash = `#/projects/${row.dataset.projectId}`;
        });
      });
    };

    filters.forEach((button) => {
      button.addEventListener("click", () => {
        activeFilter = button.dataset.editorialFilter;
        filters.forEach((item) => {
          const isActive = item === button;
          item.classList.toggle("is-active", isActive);
          item.setAttribute("aria-pressed", String(isActive));
        });
        renderList();
      });
    });

    search.addEventListener("input", renderList);
    sort.addEventListener("change", renderList);

    try {
      projects = await getProjects();
      if (!list.isConnected) return;
      search.disabled = false;
      sort.disabled = false;
      renderList();
    } catch (error) {
      if (!list.isConnected) return;
      list.innerHTML = `<p class="empty-inline">${escapeHtml(describeError(error, "Unable to load projects."))}</p>`;
    } finally {
      list.removeAttribute("aria-busy");
    }
  },
};
