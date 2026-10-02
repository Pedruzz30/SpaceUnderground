import { badge, badgeType } from "../components/badge.js";
import { CATEGORIES, EDITORIAL_STATUSES } from "../data/projects.js";
import { publicSiteUrl } from "../config/public-site.js";
import { getProjects } from "../services/project-service.js";
import { describeError } from "../services/errors.js";
import { resolveImageUrl } from "../services/storage-service.js";
import { onLocaleChange, statusLabel, t } from "../i18n/index.js";
import { escapeAttribute, escapeHtml, safeHexColor } from "../utils/html.js";
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

// These labels are already localized, so they must not go through badge(),
// which runs its text through statusLabel(): that maps "LIVE" to the project
// status "No ar" and would mislabel the whole column.
function plainBadge(label, type = "neutral") {
  return `<span class="badge badge--${type}">${escapeHtml(label)}</span>`;
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
  const attention = enriched.filter((item) => ["attention", "incomplete"].includes(item.health.status)).length;
  const metrics = [
    ["projects.metricTotal", projects.length],
    ["projects.metricPublished", projects.filter((project) => project.editorialStatus === "PUBLISHED").length],
    ["projects.metricDraft", projects.filter((project) => project.editorialStatus === "DRAFT").length],
    ["projects.metricHidden", projects.filter((project) => project.visible === false).length],
    ["projects.metricWithDemo", enriched.filter((item) => item.demo === "live").length],
    ["projects.metricAttention", attention],
  ];

  return metrics.map(([key, value]) => `
    <div class="project-metric${key === "projects.metricAttention" && value > 0 ? " is-warn" : ""}">
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(t(key))}</span>
    </div>
  `).join("");
}

function meterMarkup(label, percent) {
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  return `
    <div class="content-meter${value < 100 ? " content-meter--partial" : ""}">
      <span>${escapeHtml(label)}</span>
      <i aria-hidden="true"><b style="width:${value}%"></b></i>
      <em>${value}%</em>
    </div>
  `;
}

function pendingMarkup(health) {
  const failing = health.checks.filter((check) => !check.ok);
  if (!failing.length) return "";
  const labels = failing.map((check) => t(`projectHealth.checks.${check.key}`)).join(" · ");
  return `
    <p class="pending-note pending-note--${health.status}">
      <span>${escapeHtml(t("projects.pendingChecks"))}</span>
      ${escapeHtml(labels)}
    </p>
  `;
}

function projectCard(project) {
  const health = projectHealth(project);
  const demo = liveDemoState(project);
  const completeness = contentCompleteness(project);
  // Absolute: the Admin runs on its own host, so a relative link would resolve
  // against the Admin domain instead of the public site.
  const publicHref = project.slug ? publicSiteUrl("#work") : "";
  const projectHref = project.projectUrl || "";
  const demoHref = demo === "live" ? project.previewUrl : "";
  const editHref = `#/projects/${encodeURIComponent(project.id)}`;
  const caseLabel = `CASE ${project.caseNumber || "—"}`;
  const category = statusLabel(project.category || t("projects.uncategorised"));
  const muted = project.editorialStatus === "ARCHIVED" || !project.visible;
  const poster = String(project.poster || "").trim();

  return `
    <article class="project-card${muted ? " project-card--muted" : ""}" data-project-id="${escapeAttribute(project.id)}" style="--project-accent:${safeHexColor(project.accent)}">
      <a class="project-card__poster" href="${escapeAttribute(editHref)}" tabindex="-1" aria-hidden="true">
        ${poster ? `<img data-poster-src="${escapeAttribute(poster)}" alt="" loading="lazy">` : ""}
        <span class="project-card__placeholder">
          <strong>${escapeHtml(project.caseNumber || "—")}</strong>
          ${poster ? "" : `<small>${escapeHtml(t("projectEditor.noPoster"))}</small>`}
        </span>
        <span class="project-card__case">${escapeHtml(caseLabel)}</span>
        <span class="project-card__health">${plainBadge(healthLabel(health.status), health.status === "healthy" ? "success" : health.status === "attention" ? "warning" : "muted")}</span>
      </a>

      <div class="project-card__body">
        <span class="project-card__eyebrow">${escapeHtml(category)} · ${escapeHtml(statusLabel(project.status))}</span>
        <h3 class="project-card__name">${escapeHtml(project.name || t("projects.untitled"))}</h3>
        <p class="project-card__meta">
          <span>${escapeHtml(project.client || t("projects.noClient"))}</span>
          <small>${escapeHtml(project.slug || "—")}</small>
        </p>

        <div class="project-card__badges">
          ${badge(project.editorialStatus, badgeType(project.editorialStatus))}
          ${plainBadge(visibilityLabel(project), project.visible ? "neutral" : "muted")}
          ${plainBadge(`DEMO · ${demoLabel(demo)}`, demo === "live" ? "success" : demo === "invalid" ? "warning" : "muted")}
        </div>

        <div class="project-card__content">
          <span>${escapeHtml(t("projects.content"))}</span>
          ${meterMarkup("PT", completeness.pt.percent)}
          ${meterMarkup("EN", completeness.en.percent)}
        </div>

        ${pendingMarkup(health)}
      </div>

      <footer class="project-card__actions">
        <button class="button project-card__edit" type="button" data-project-open="${escapeAttribute(project.id)}">${t("projects.actionEdit")} <span aria-hidden="true">→</span></button>
        <span class="project-card__updated" title="${escapeAttribute(t("common.updated"))}">${escapeHtml(formatUpdated(project.updatedAt))}</span>
        <span class="row-menu" data-row-menu>
          <button class="button button--compact row-menu__toggle" type="button" data-row-menu-toggle aria-expanded="false" aria-haspopup="true" aria-label="${escapeAttribute(t("projects.actions"))}">⋯</button>
          <span class="row-menu__panel" role="menu" hidden>
            <a role="menuitem" href="${escapeAttribute(publicHref || "#/projects")}" target="_blank" rel="noreferrer" ${publicHref ? "" : 'aria-disabled="true"'}>${t("projects.actionViewPublic")}</a>
            <a role="menuitem" href="${escapeAttribute(projectHref || "#")}" target="_blank" rel="noreferrer" ${projectHref ? "" : 'aria-disabled="true"'}>${t("projects.actionOpenProject")}</a>
            <a role="menuitem" href="${escapeAttribute(demoHref || "#")}" target="_blank" rel="noreferrer" ${demoHref ? "" : 'aria-disabled="true"'}>${t("projects.actionOpenDemo")}</a>
          </span>
        </span>
      </footer>
    </article>
  `;
}

// The last tile is a shortcut to create a case, so the grid never ends on a
// dead edge.
function newProjectTile() {
  return `
    <a class="project-card project-card--new" href="#/projects/new">
      <span aria-hidden="true">+</span>
      <strong>${escapeHtml(t("projects.newProject"))}</strong>
    </a>
  `;
}

function skeletonCards() {
  return Array.from({ length: 3 }, () => `<div class="project-card project-card--skeleton skeleton-card"></div>`).join("");
}

function closeRowMenus(root = document) {
  root.querySelectorAll("[data-row-menu] .row-menu__panel").forEach((panel) => {
    panel.hidden = true;
  });
  root.querySelectorAll("[data-row-menu-toggle]").forEach((toggle) => {
    toggle.setAttribute("aria-expanded", "false");
  });
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
        <button class="button button--primary" type="button" data-new-project data-requires="projects.create" data-i18n="projects.newProject">${t("projects.newProject")}</button>
      </div>
    </section>

    <div class="metric-strip" data-project-metrics aria-live="polite"></div>

    <div class="project-filters">
      <label class="search-field">
        <span data-i18n="projects.searchProjects">${t("projects.searchProjects")}</span>
        <input data-search-projects type="search" placeholder="${t("projects.searchPlaceholder")}" disabled>
      </label>
      <label class="sort-field project-filters__sort">
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

    <div class="project-grid" data-project-list aria-live="polite" aria-busy="true">
      ${skeletonCards()}
    </div>
  `,
  afterRender: async () => {
    document.querySelector("[data-new-project]")?.addEventListener("click", () => {
      window.location.hash = "#/projects/new";
    });

    document.addEventListener("click", (event) => {
      if (!event.target.closest("[data-row-menu]")) closeRowMenus();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeRowMenus();
    });

    const search = document.querySelector("[data-search-projects]");
    const sort = document.querySelector("[data-project-sort]");
    const list = document.querySelector("[data-project-list]");
    const metricRoot = document.querySelector("[data-project-metrics]");
    const filters = [...document.querySelectorAll("[data-project-filter]")];
    let projects = [];

    // Storage posters resolve asynchronously (signed URLs in Supabase mode).
    // One lookup per path for the life of the page, so typing in the search
    // box does not re-request every image.
    const posterUrls = new Map();
    const hydratePosters = () => {
      list.querySelectorAll("img[data-poster-src]").forEach((img) => {
        const path = img.dataset.posterSrc;
        if (!posterUrls.has(path)) posterUrls.set(path, resolveImageUrl(path).catch(() => ""));
        posterUrls.get(path).then((src) => {
          if (!src || !img.isConnected) return;
          // Revealed by class, not by the hidden attribute: a lazy image that is
          // display:none never enters layout, so the browser never fetches it.
          img.addEventListener("load", () => {
            img.closest(".project-card__poster")?.classList.add("has-image");
          }, { once: true });
          img.addEventListener("error", () => {
            img.hidden = true;
          }, { once: true });
          img.src = src;
        });
      });
    };

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

      list.innerHTML = visible.length
        ? `${visible.map(projectCard).join("")}${newProjectTile()}`
        : `<p class="empty-inline project-grid__empty">${emptyMessage}</p>${projects.length ? "" : newProjectTile()}`;

      hydratePosters();

      list.querySelectorAll("[data-project-open]").forEach((button) => {
        button.addEventListener("click", () => {
          window.location.hash = `#/projects/${button.dataset.projectOpen}`;
        });
      });

      // Secondary actions live behind a per-card overflow menu, so each card
      // keeps one primary button instead of four.
      list.querySelectorAll("[data-row-menu-toggle]").forEach((toggle) => {
        toggle.addEventListener("click", (event) => {
          event.stopPropagation();
          const panel = toggle.nextElementSibling;
          const willOpen = panel?.hidden;
          closeRowMenus();
          if (panel && willOpen) {
            panel.hidden = false;
            toggle.setAttribute("aria-expanded", "true");
          }
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
      list.innerHTML = `<p class="empty-inline project-grid__empty">${escapeHtml(describeError(error, t("projects.loadError")))}</p>`;
    } finally {
      list.removeAttribute("aria-busy");
    }
  },
};
