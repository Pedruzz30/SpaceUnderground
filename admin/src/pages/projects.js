import { badge, badgeType } from "../components/badge.js";
import { CATEGORIES, EDITORIAL_STATUSES } from "../data/projects.js";
import { getProjects } from "../services/project-service.js";
import { describeError } from "../services/errors.js";
import { onLocaleChange, statusLabel, t } from "../i18n/index.js";
import { escapeAttribute, escapeHtml } from "../utils/html.js";
import { contentCompleteness, liveDemoState, projectHealth } from "../utils/project-health.js";

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

function demoLabel(state) {
  return t(`projectHealth.demo.${state}`).toUpperCase();
}

function healthLabel(status) {
  return t(`projectHealth.status.${status}`).toUpperCase();
}

function optionMarkup(value, label = value) {
  return `<option value="${escapeAttribute(value)}">${escapeHtml(label)}</option>`;
}

function filterMarkup({ labelKey, name, options }) {
  return `
    <label class="sort-field">
      <span>${escapeHtml(t(labelKey))}</span>
      <select data-project-filter="${escapeAttribute(name)}" disabled>
        ${options.map(([value, label]) => optionMarkup(value, label)).join("")}
      </select>
    </label>
  `;
}

function metricsMarkup(projects) {
  const enriched = projects.map((project) => ({ project, health: projectHealth(project), demo: liveDemoState(project) }));
  const metrics = [
    ["projects.metricTotal", projects.length],
    ["projects.metricPublished", projects.filter((project) => project.editorialStatus === "PUBLISHED").length],
    ["projects.metricDraft", projects.filter((project) => project.editorialStatus === "DRAFT").length],
    ["projects.metricHidden", projects.filter((project) => project.visible === false).length],
    ["projects.metricWithDemo", enriched.filter((item) => item.demo === "live").length],
    ["projects.metricAttention", enriched.filter((item) => ["attention", "incomplete"].includes(item.health.status)).length],
  ];

  return metrics.map(([key, value]) => `
    <div class="project-metric">
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(t(key))}</span>
    </div>
  `).join("");
}

function projectCard(project) {
  const health = projectHealth(project);
  const demo = liveDemoState(project);
  const completeness = contentCompleteness(project);
  const publicHref = project.slug ? "../#work" : "";
  const projectHref = project.projectUrl || "";
  const demoHref = demo === "live" ? project.previewUrl : "";

  return `
    <article class="project-row" data-project-id="${escapeAttribute(project.id)}">
      <span class="project-row__case">${escapeHtml(project.caseNumber)}</span>
      <span class="project-row__project">
        <strong>${escapeHtml(project.name || t("projects.untitled"))}</strong>
        <small>${escapeHtml(project.client || project.slug || t("projects.noClient"))}</small>
      </span>
      <span data-label="${t("dashboard.project")}">${escapeHtml(statusLabel(project.status))}</span>
      <span data-label="${t("common.client")}">${escapeHtml(project.client || t("projects.noClient"))}</span>
      <span data-label="${t("common.category")}">${escapeHtml(statusLabel(project.category || t("projects.uncategorised")))}</span>
      <span class="project-row__stack" data-label="${t("projects.publication")}">${badge(project.editorialStatus, badgeType(project.editorialStatus))}<small>${escapeHtml(visibilityLabel(project))}</small></span>
      <span data-label="${t("projectEditor.liveDemo")}">${badge(demoLabel(demo), demo === "live" ? "success" : demo === "invalid" ? "warning" : "muted")}</span>
      <span data-label="${t("projects.content")}">${escapeHtml(t("projectHealth.content.compact", { pt: completeness.pt.percent, en: completeness.en.percent }))}</span>
      <span data-label="${t("projectHealth.title")}">${badge(healthLabel(health.status), health.status === "healthy" ? "success" : health.status === "attention" ? "warning" : "muted")}</span>
      <span data-label="${t("common.updated")}">${escapeHtml(formatUpdated(project.updatedAt))}</span>
      <span class="project-row__actions">
        <button class="button button--compact" type="button" data-project-open="${escapeAttribute(project.id)}">${t("projects.actionEdit")}</button>
        <a class="button button--compact" href="${escapeAttribute(publicHref || "#/projects")}" target="_blank" rel="noreferrer" ${publicHref ? "" : "aria-disabled=\"true\""}>${t("projects.actionViewPublic")}</a>
        <a class="button button--compact" href="${escapeAttribute(projectHref || "#")}" target="_blank" rel="noreferrer" ${projectHref ? "" : "aria-disabled=\"true\""}>${t("projects.actionOpenProject")}</a>
        <a class="button button--compact" href="${escapeAttribute(demoHref || "#")}" target="_blank" rel="noreferrer" ${demoHref ? "" : "aria-disabled=\"true\""}>${t("projects.actionOpenDemo")}</a>
      </span>
    </article>
  `;
}

export const projectsPage = {
  title: () => t("projects.title"),
  breadcrumb: () => t("projects.breadcrumb"),
  render: () => `
    <section class="page-heading page-heading--split">
      <div>
        <span data-i18n="projects.eyebrow">${t("projects.eyebrow")}</span>
        <h2 data-i18n="projects.heading">${t("projects.heading")}</h2>
        <p data-i18n="projects.intro">${t("projects.intro")}</p>
      </div>
      <div class="heading-actions">
        <button class="button button--primary" type="button" data-new-project data-i18n="projects.newProject">${t("projects.newProject")}</button>
      </div>
    </section>

    <section class="panel projects-panel">
      <div class="project-metrics" data-project-metrics aria-live="polite"></div>
      <div class="toolbar">
        <label class="search-field">
          <span data-i18n="projects.searchProjects">${t("projects.searchProjects")}</span>
          <input data-search-projects type="search" placeholder="${t("projects.searchPlaceholder")}" disabled>
        </label>
        <div class="toolbar__controls">
          <label class="sort-field">
            <span data-i18n="projects.sortBy">${t("projects.sortBy")}</span>
            <select data-project-sort disabled>
              <option value="updated">${t("projects.sortUpdated")}</option>
              <option value="case">${t("projects.sortCase")}</option>
              <option value="name">${t("projects.sortName")}</option>
            </select>
          </label>
          ${filterMarkup({ labelKey: "common.category", name: "category", options: [["ALL", t("common.all")], ...CATEGORIES.map((item) => [item, statusLabel(item)])] })}
          ${filterMarkup({ labelKey: "common.editorial", name: "editorial", options: [["ALL", t("common.all")], ...EDITORIAL_STATUSES.map((item) => [item, statusLabel(item)])] })}
          ${filterMarkup({ labelKey: "common.visibility", name: "visibility", options: [["ALL", t("common.all")], ["VISIBLE", t("common.visible")], ["HIDDEN", t("common.hidden")]] })}
          ${filterMarkup({ labelKey: "projectEditor.liveDemo", name: "demo", options: [["ALL", t("common.all")], ["LIVE", t("projectHealth.demo.live")], ["NONE", t("projectHealth.demo.none")]] })}
          ${filterMarkup({ labelKey: "projectHealth.title", name: "health", options: [["ALL", t("common.all")], ["HEALTHY", t("projectHealth.status.healthy")], ["ATTENTION", t("projectHealth.status.attention")], ["INCOMPLETE", t("projectHealth.status.incomplete")]] })}
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
    const metricRoot = document.querySelector("[data-project-metrics]");
    const filters = [...document.querySelectorAll("[data-project-filter]")];
    let projects = [];

    const renderList = () => {
      const query = search.value.trim().toLowerCase();
      const visible = projects.filter((project) => {
        const matchesQuery = [project.name, project.client, project.category, project.status, project.slug].some((value) =>
          String(value).toLowerCase().includes(query),
        );
        const filterState = Object.fromEntries(filters.map((filter) => [filter.dataset.projectFilter, filter.value]));
        const health = projectHealth(project).status.toUpperCase();
        const demo = liveDemoState(project).toUpperCase();
        const matchesCategory = filterState.category === "ALL" || project.category === filterState.category;
        const matchesEditorial = filterState.editorial === "ALL" || project.editorialStatus === filterState.editorial;
        const matchesVisibility = filterState.visibility === "ALL" || (filterState.visibility === "VISIBLE" ? project.visible : !project.visible);
        const matchesDemo = filterState.demo === "ALL" || demo === filterState.demo;
        const matchesHealth = filterState.health === "ALL" || health === filterState.health;
        return matchesQuery && matchesCategory && matchesEditorial && matchesVisibility && matchesDemo && matchesHealth;
      }).sort((a, b) => {
        if (sort.value === "case") return String(a.caseNumber).localeCompare(String(b.caseNumber));
        if (sort.value === "name") return String(a.name || "").localeCompare(String(b.name || ""));
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });

      const emptyMessage = projects.length
        ? t("projects.noMatch")
        : t("projects.empty");

      if (metricRoot) metricRoot.innerHTML = metricsMarkup(projects);

      list.innerHTML = `
        <div class="project-table__head" aria-hidden="true">
          <span>CASE</span><span>${t("dashboard.project").toUpperCase()}</span><span>${t("common.status").toUpperCase()}</span><span>${t("common.client").toUpperCase()}</span><span>${t("common.category").toUpperCase()}</span><span>${t("projects.publication").toUpperCase()}</span><span>${t("projectEditor.liveDemo").toUpperCase()}</span><span>${t("projects.content").toUpperCase()}</span><span>${t("projectHealth.title").toUpperCase()}</span><span>${t("common.updated").toUpperCase()}</span><span>${t("projects.actions").toUpperCase()}</span>
        </div>
        ${visible.length ? visible.map(projectCard).join("") : `<p class="empty-inline">${emptyMessage}</p>`}
      `;

      list.querySelectorAll("[data-project-open]").forEach((button) => {
        button.addEventListener("click", () => {
          window.location.hash = `#/projects/${button.dataset.projectOpen}`;
        });
      });
    };

    filters.forEach((filter) => filter.addEventListener("change", renderList));

    search.addEventListener("input", renderList);
    sort.addEventListener("change", renderList);

    // Re-renders from the projects already in memory, so switching locale keeps
    // the typed search, the editorial filter and the sort without re-querying.
    onLocaleChange(list, () => {
      if (projects.length) renderList();
    });

    try {
      projects = await getProjects();
      if (!list.isConnected) return;
      search.disabled = false;
      sort.disabled = false;
      filters.forEach((filter) => {
        filter.disabled = false;
      });
      renderList();
    } catch (error) {
      if (!list.isConnected) return;
      list.innerHTML = `<p class="empty-inline">${escapeHtml(describeError(error, t("projects.loadError")))}</p>`;
    } finally {
      list.removeAttribute("aria-busy");
    }
  },
};
