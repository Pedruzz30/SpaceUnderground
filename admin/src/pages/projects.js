import { badge, badgeType } from "../components/badge.js";
import { getProjects } from "../services/project-service.js";
import { describeError } from "../services/errors.js";
import { escapeAttribute, escapeHtml } from "../utils/html.js";

function formatUpdated(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const diff = Date.now() - date.getTime();
  const day = 24 * 60 * 60 * 1000;
  if (diff >= 0 && diff < day) return "today";
  if (diff >= 0 && diff < day * 7) return `${Math.max(1, Math.round(diff / day))}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "2-digit" });
}

function visibilityLabel(project) {
  return project.visible ? "VISIBLE" : "HIDDEN";
}

function projectCard(project) {
  return `
    <button class="project-row" type="button" data-project-id="${escapeAttribute(project.id)}">
      <span class="project-row__case">${escapeHtml(project.caseNumber)}</span>
      <span class="project-row__project">
        <strong>${escapeHtml(project.name || "Untitled project")}</strong>
        <small>${escapeHtml(project.client || project.slug || "No client")}</small>
      </span>
      <span data-label="Category">${escapeHtml(project.category)}</span>
      <span data-label="Status">${badge(project.status, badgeType(project.status))}</span>
      <span data-label="Editorial">${badge(project.editorialStatus, badgeType(project.editorialStatus))}</span>
      <span data-label="Visibility">${escapeHtml(visibilityLabel(project))}</span>
      <span data-label="Updated">${escapeHtml(formatUpdated(project.updatedAt))}</span>
      <span class="project-row__arrow" aria-hidden="true">&rarr;</span>
    </button>
  `;
}

export const projectsPage = {
  title: "Projects",
  breadcrumb: "OPERATIONS / PROJECTS",
  render: () => `
    <section class="page-heading page-heading--split">
      <div>
        <span>PROJECTS</span>
        <h2>Portfolio control.</h2>
        <p>Search, filter and manage project records.</p>
      </div>
      <div class="heading-actions">
        <button class="button button--primary" type="button" data-new-project>New Project</button>
      </div>
    </section>

    <section class="panel projects-panel">
      <div class="toolbar">
        <label class="search-field">
          <span>Search projects</span>
          <input data-search-projects type="search" placeholder="Search projects..." disabled>
        </label>
        <div class="toolbar__controls">
          <label class="sort-field">
            <span>Sort by</span>
            <select data-project-sort disabled>
              <option value="updated">Updated</option>
              <option value="case">Case</option>
              <option value="name">Name</option>
            </select>
          </label>
          <div class="segmented" role="group" aria-label="Filtrar projetos por editorial">
            <button type="button" class="is-active" data-editorial-filter="ALL" aria-pressed="true">ALL</button>
            <button type="button" data-editorial-filter="PUBLISHED" aria-pressed="false">PUBLISHED</button>
            <button type="button" data-editorial-filter="DRAFT" aria-pressed="false">DRAFT</button>
            <button type="button" data-editorial-filter="ARCHIVED" aria-pressed="false">ARCHIVED</button>
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
        ? "No projects match the current search or filter."
        : "No projects yet. Create the first project to start the portfolio system.";

      list.innerHTML = `
        <div class="project-table__head" aria-hidden="true">
          <span>CASE</span><span>PROJECT</span><span>CATEGORY</span><span>STATUS</span><span>EDITORIAL</span><span>VISIBILITY</span><span>UPDATED</span><span></span>
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
