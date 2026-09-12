// Brings Selected Work under Supabase control without bundling editorial
// project content. If Supabase is unavailable, the section remains neutral.

import { projects } from "./project-registry.js";
import { getLocale, subscribeLocaleChange, t } from "./i18n/index.js";
import { fetchPublishedProjects, isConfigured, signPaths } from "./supabase-public.js";
import { refreshProjectViewerSlots, showProject } from "./signal-frame.js";

const SOURCE_ATTRIBUTE = "data-projects-source";
let subscribedToLocale = false;
const PLACEHOLDER_POSTER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1440 900'%3E%3Crect width='1440' height='900' fill='%23050605'/%3E%3Cpath d='M120 450h1200' stroke='%23c6ff00' stroke-opacity='.22'/%3E%3Ccircle cx='720' cy='450' r='120' fill='none' stroke='%23c6ff00' stroke-opacity='.18'/%3E%3C/svg%3E";

const isStoragePath = (value) => Boolean(value) && !/^(https?:|data:|blob:|\/|\.{1,2}\/)/i.test(value);
const text = (value) => (typeof value === "string" ? value.trim() : "");
const pad = (value) => String(Number(value) || value || "").padStart(3, "0");
const keyFor = (row) => `case-${pad(row.case_number)}`;

function localized(row, field) {
  const locale = getLocale();
  const translated = row?.translations?.[locale]?.[field];
  return text(translated) || text(row?.[field]);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

function markSection(state) {
  document.querySelector("#work")?.setAttribute(SOURCE_ATTRIBUTE, state);
}

function clearRegistry() {
  Object.keys(projects).forEach((key) => {
    delete projects[key];
  });
}

function normalizeStatus(row) {
  const status = text(row.status);
  if (!status) return "";
  return status.toUpperCase() === "LIVE" ? t("work.statusLive") : status.toUpperCase();
}

function projectFromRow(row, signed) {
  const key = keyFor(row);
  const posterPath = text(row.poster_url);
  const gallery = Array.isArray(row.project_gallery)
    ? [...row.project_gallery]
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map((image) => {
          const path = text(image.url);
          return {
            url: isStoragePath(path) ? signed.get(path) || "" : path,
            alt: localized(image, "alt"),
            caption: localized(image, "caption"),
          };
        })
        .filter((image) => image.url)
    : [];

  const modules = Array.isArray(row.project_modules)
    ? [...row.project_modules]
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map((module, index) => [
          text(module.code) || String(index + 1).padStart(2, "0"),
          localized(module, "title"),
          localized(module, "description"),
        ])
        .filter((module) => module[1])
    : [];

  return [
    key,
    {
      id: pad(row.case_number),
      name: localized(row, "name"),
      client: text(row.client || row.name).toUpperCase(),
      category: localized(row, "category").toUpperCase(),
      description: localized(row, "description"),
      url: text(row.project_url),
      previewUrl: text(row.preview_url || row.project_url),
      poster: isStoragePath(posterPath) ? signed.get(posterPath) || PLACEHOLDER_POSTER : posterPath || PLACEHOLDER_POSTER,
      accent: text(row.accent) || "#c6ff00",
      system: localized(row, "presentation_system"),
      label: localized(row, "presentation_label"),
      address: localized(row, "presentation_address"),
      type: (localized(row, "presentation_type") || localized(row, "category")).toUpperCase(),
      tech: Array.isArray(row.tech_stack) ? row.tech_stack.join(" / ").toUpperCase() : "",
      status: normalizeStatus(row),
      year: row.year ? String(row.year) : "",
      modules,
      origin: text(row.origin),
      coordinates: Array.isArray(row.coordinates) ? row.coordinates.map(text).filter(Boolean) : [],
      gallery,
    },
  ];
}

function slotButton(key, project, active) {
  const ariaLabel = t("work.showProject", { id: project.id, name: project.name });
  const tipLabel = t("work.projectTip", { id: project.id });
  return `
    <button class="signal-ui__slot${active ? " is-active" : ""}" type="button" data-project-slot="${escapeAttribute(key)}" aria-pressed="${active ? "true" : "false"}" aria-label="${escapeAttribute(ariaLabel)}">
      <i></i>
      <span class="signal-ui__slot-tip" aria-hidden="true"><em>${escapeHtml(tipLabel)}</em>${escapeHtml(project.name)}</span>
    </button>
  `;
}

function indexRow(key, project, active) {
  return `
    <li>
      <button class="case-index__row${active ? " is-active" : ""}" type="button" data-project-slot="${escapeAttribute(key)}" aria-pressed="${active ? "true" : "false"}">
        <span class="case-index__id">${escapeHtml(project.id)}</span>
        <span class="case-index__name">${escapeHtml(project.name)}</span>
        <span class="case-index__type">${escapeHtml(project.type)}</span>
        <span class="case-index__year">${escapeHtml(project.year || "—")}</span>
        <span class="case-index__status"><i aria-hidden="true"></i>${escapeHtml(project.status || "—")}</span>
        <span class="case-index__go" aria-hidden="true">↗</span>
      </button>
    </li>
  `;
}

function renderNavigation(entries) {
  const activeKey = entries[0]?.[0] || "";
  const rail = document.querySelector(".signal-ui__rail-track");
  const index = document.querySelector(".case-index__list");
  const indexHead = document.querySelector(".case-index__head span:first-child");

  if (rail) {
    rail.innerHTML = entries.map(([key, project]) => slotButton(key, project, key === activeKey)).join("");
  }

  if (index) {
    index.innerHTML = entries.map(([key, project]) => indexRow(key, project, key === activeKey)).join("");
  }

  if (indexHead) {
    const last = entries.at(-1)?.[1]?.id || "000";
    indexHead.textContent = t("work.index", { last });
  }

  refreshProjectViewerSlots();
  return activeKey;
}

function renderUnavailable(message = t("work.unavailable")) {
  clearRegistry();
  const rail = document.querySelector(".signal-ui__rail-track");
  const index = document.querySelector(".case-index__list");
  const title = document.querySelector("[data-viewer-name]");
  const description = document.querySelector("[data-viewer-description]");
  const specs = document.querySelector("[data-viewer-specs]");

  if (rail) rail.innerHTML = "";
  if (index) index.innerHTML = `<li><span class="case-index__row is-reserved"><span class="case-index__name">${escapeHtml(message)}</span></span></li>`;
  if (title) title.textContent = t("work.title");
  if (description) description.textContent = message;
  if (specs) specs.textContent = t("work.statusUnavailable");
}

export async function initPublicProjects() {
  if (!subscribedToLocale) {
    subscribedToLocale = true;
    subscribeLocaleChange(() => {
      initPublicProjects();
    });
  }
  if (!isConfigured()) {
    renderUnavailable();
    markSection("unconfigured");
    return;
  }

  try {
    const rows = await fetchPublishedProjects();
    clearRegistry();

    const paths = [];
    rows.forEach((row) => {
      if (isStoragePath(row.poster_url)) paths.push(row.poster_url);
      (row.project_gallery ?? []).forEach((image) => {
        if (isStoragePath(image.url)) paths.push(image.url);
      });
    });

    let signed = new Map();
    if (paths.length) signed = await signPaths(paths);

    const entries = rows.map((row) => projectFromRow(row, signed));
    entries.forEach(([key, project]) => {
      projects[key] = project;
    });

    if (!entries.length) {
      renderUnavailable(t("work.empty"));
      markSection("empty");
      return;
    }

    const activeKey = renderNavigation(entries);
    markSection("supabase");
    showProject(activeKey);
  } catch (error) {
    renderUnavailable();
    markSection("unavailable");
    console.warn("[projects] Supabase unavailable, keeping the viewer neutral.", error);
  }
}
