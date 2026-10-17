// Brings Selected Work under Supabase control without bundling editorial
// project content. If Supabase is unavailable, the section remains neutral.

import { projects } from "./project-registry.js";
import { getLocale, subscribeLocaleChange, t } from "./i18n/index.js";
import { fetchPublishedProjects, isConfigured, signPaths } from "./supabase-public.js";
import { getActiveProjectKey, refreshProjectViewerSlots, showProject } from "./signal-frame.js";
import { resolvePoster } from "./project-posters.js";
import { resolvePublicUrl } from "./public-url.js";
import { FALLBACK_PROJECTS } from "./project-fallback.js";

const SOURCE_ATTRIBUTE = "data-projects-source";
let subscribedToLocale = false;
// Rows and signed URLs are kept so a locale change can re-render the section
// without asking Supabase for the same data again, or re-signing storage paths
// that are still valid.
let lastRows = null;
let lastSigned = new Map();

const isStoragePath = (value) => Boolean(value) && !/^(https?:|data:|blob:|\/|\.{1,2}\/)/i.test(value);
const text = (value) => (typeof value === "string" ? value.trim() : "");
const pad = (value) => String(Number(value) || value || "").padStart(3, "0");
const keyFor = (row) => `case-${pad(row.case_number)}`;

// Editorial copy only. A project's name, client, URLs, accent, year, tech stack
// and coordinates are records rather than copy: they read identically in both
// locales and must never come from `translations`.
function localized(row, field) {
  const locale = getLocale();
  const translated = row?.translations?.[locale]?.[field];
  return text(translated) || text(row?.[field]);
}

// Category is a stored enum ("Website", "System", ...). Its presentation is
// localized through the dictionary; the stored value never changes.
function categoryLabel(row) {
  const value = text(row?.category);
  if (!value) return "";
  const key = `work.categories.${value.toLowerCase().replace(/\s+/g, "")}`;
  const label = t(key);
  return (label === key ? value : label).toUpperCase();
}

function categorySlug(row) {
  return text(row?.category).toLowerCase().replace(/\s+/g, "") || "other";
}

// Picks the CTA label the card should show. A per-project override always
// wins; otherwise falls back to the per-category label defined in i18n.
function resolveCtaLabel(row) {
  const locale = getLocale();
  const override = locale === "en"
    ? text(row?.cta_label_en) || text(row?.cta_label)
    : text(row?.cta_label) || text(row?.cta_label_en);
  if (override) return override;
  const key = `work.ctaFallback.${categorySlug(row)}`;
  const label = t(key);
  if (label !== key) return label;
  return t("work.viewProject");
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

function markMedia(state) {
  document.querySelector("#work")?.setAttribute("data-projects-media", state);
}

function clearRegistry() {
  Object.keys(projects).forEach((key) => {
    delete projects[key];
  });
}

// Status is a stored enum too; only its label follows the locale.
function normalizeStatus(row) {
  const status = text(row.status);
  if (!status) return "";
  const key = `work.statuses.${status.toLowerCase().replace(/\s+/g, "")}`;
  const label = t(key);
  return (label === key ? status : label).toUpperCase();
}

function approvedPreviewUrl(row) {
  return row.live_preview_enabled === true ? resolvePublicUrl(row.preview_url) : "";
}

function projectFromRow(row, signed) {
  const key = keyFor(row);
  const { poster, posterFallback } = resolvePoster(row, signed);
  const previewUrl = approvedPreviewUrl(row);
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

  // Case modules are ordered by position by default, but when the author uses
  // the canonical codes (CONTEXT, PROBLEM, SOLUTION, FEATURES, STACK, RESULT,
  // DEMO) those lead in that fixed sequence. Non-canonical codes keep their
  // relative order. Keeps the Strategy 001 story readable without forcing
  // every project to adopt the convention.
  const CANONICAL_ORDER = ["CONTEXT", "PROBLEM", "SOLUTION", "FEATURES", "STACK", "RESULT", "DEMO"];
  const modules = Array.isArray(row.project_modules)
    ? [...row.project_modules]
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .sort((a, b) => {
          const ai = CANONICAL_ORDER.indexOf(text(a.code).toUpperCase());
          const bi = CANONICAL_ORDER.indexOf(text(b.code).toUpperCase());
          if (ai === -1 && bi === -1) return 0;
          if (ai === -1) return 1;
          if (bi === -1) return -1;
          return ai - bi;
        })
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
      name: text(row.name),
      client: text(row.client || row.name).toUpperCase(),
      category: categoryLabel(row),
      categorySlug: categorySlug(row),
      description: localized(row, "description"),
      url: resolvePublicUrl(row.project_url),
      previewUrl,
      hasLivePreview: Boolean(previewUrl),
      poster,
      posterFallback,
      accent: text(row.accent) || "#c6ff00",
      system: localized(row, "presentation_system"),
      label: localized(row, "presentation_label"),
      address: localized(row, "presentation_address"),
      type: (localized(row, "presentation_type").toUpperCase() || categoryLabel(row)),
      tech: Array.isArray(row.tech_stack) ? row.tech_stack.join(" / ").toUpperCase() : "",
      status: normalizeStatus(row),
      year: row.year ? String(row.year) : "",
      modules,
      origin: text(row.origin),
      coordinates: Array.isArray(row.coordinates) ? row.coordinates.map(text).filter(Boolean) : [],
      gallery,
      ctaLabel: resolveCtaLabel(row),
      demoUrl: resolvePublicUrl(row.demo_url),
    },
  ];
}

function slotButton(key, project, active) {
  const ariaLabel = t("work.showProject", { id: project.id, name: project.name });
  const tipLabel = t("work.projectTip", { id: project.id });
  return `
    <button class="signal-ui__slot${active ? " is-active" : ""}" type="button" data-project-slot="${escapeAttribute(key)}" data-category="${escapeAttribute(project.categorySlug)}" aria-pressed="${active ? "true" : "false"}" aria-label="${escapeAttribute(ariaLabel)}">
      <i></i>
      <span class="signal-ui__slot-tip" aria-hidden="true"><em>${escapeHtml(tipLabel)}</em>${escapeHtml(project.name)}</span>
    </button>
  `;
}

function indexRow(key, project, active) {
  return `
    <li data-category="${escapeAttribute(project.categorySlug)}">
      <button class="case-index__row${active ? " is-active" : ""}" type="button" data-project-slot="${escapeAttribute(key)}" data-category="${escapeAttribute(project.categorySlug)}" aria-pressed="${active ? "true" : "false"}">
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

function renderNavigation(entries, preferredKey = "") {
  // Keeps whichever project the visitor was looking at; only falls back to the
  // first one when that project is no longer published.
  const hasPreferred = preferredKey && entries.some(([key]) => key === preferredKey);
  const activeKey = hasPreferred ? preferredKey : entries[0]?.[0] || "";
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

// Filter chips only hide items, they never remove them, so the carousel in
// signal-frame.js keeps its loop. If the active case is hidden, the first
// visible one is activated instead.
let activeFilter = "all";

function applyFilter(category) {
  activeFilter = category || "all";
  const chips = document.querySelectorAll("[data-work-filters] [data-filter]");
  chips.forEach((chip) => {
    const match = chip.dataset.filter === activeFilter;
    chip.classList.toggle("is-active", match);
    chip.setAttribute("aria-pressed", match ? "true" : "false");
  });

  const slots = document.querySelectorAll(".signal-ui__slot[data-category]");
  const rows = document.querySelectorAll(".case-index__list [data-category]");
  const matchesFilter = (node) => activeFilter === "all" || node.dataset.category === activeFilter;
  slots.forEach((node) => node.classList.toggle("is-filtered", !matchesFilter(node)));
  rows.forEach((node) => node.classList.toggle("is-filtered", !matchesFilter(node)));

  const activeKey = getActiveProjectKey();
  const activeSlot = activeKey
    ? document.querySelector(`[data-project-slot="${CSS.escape(activeKey)}"][data-category]`)
    : null;
  if (activeSlot && activeSlot.classList.contains("is-filtered")) {
    const firstVisible = [...slots].find((slot) => !slot.classList.contains("is-filtered"));
    const nextKey = firstVisible?.dataset.projectSlot;
    if (nextKey) showProject(nextKey, { preserveMode: false });
  }
}

function initFilters() {
  const container = document.querySelector("[data-work-filters]");
  if (!container || container.dataset.filtersWired === "true") return;
  container.dataset.filtersWired = "true";
  container.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-filter]");
    if (!chip || !container.contains(chip)) return;
    applyFilter(chip.dataset.filter);
  });
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

// Renders the section from rows already in hand. Pure presentation: no network
// calls, so it is safe to replay on every locale change. `source` controls the
// data-projects-source marker when the render actually succeeds.
function renderFromRows(rows, signed, { preferredKey = "", preserveMode = false, source = "supabase" } = {}) {
  clearRegistry();

  const entries = rows.map((row) => projectFromRow(row, signed));
  entries.forEach(([key, project]) => {
    projects[key] = project;
  });

  if (!entries.length) {
    renderUnavailable(t("work.empty"));
    markSection("empty");
    return;
  }

  const activeKey = renderNavigation(entries, preferredKey);
  markSection(source);
  showProject(activeKey, { preserveMode });
  // Re-apply the active filter so a locale change (which re-renders rows)
  // does not quietly reveal cards the visitor had filtered out.
  applyFilter(activeFilter);
}

// Supabase is the source of truth; the fallback is only shown when live data
// is impossible — unconfigured, request error, or an empty result set. The
// shape is identical to a Supabase row so renderFromRows() needs no branches.
function renderFallback({ preferredKey = "", preserveMode = false } = {}) {
  if (!FALLBACK_PROJECTS.length) return false;
  lastRows = FALLBACK_PROJECTS;
  lastSigned = new Map();
  markMedia("ready");
  renderFromRows(FALLBACK_PROJECTS, lastSigned, { preferredKey, preserveMode, source: "fallback" });
  return true;
}

export async function initPublicProjects() {
  initFilters();
  if (!subscribedToLocale) {
    subscribedToLocale = true;
    subscribeLocaleChange(() => {
      // Re-render the localized copy over the cached rows, keeping the project
      // the visitor had open, the display mode they had chosen, and a loaded
      // preview iframe exactly as it is.
      if (lastRows) {
        renderFromRows(lastRows, lastSigned, { preferredKey: getActiveProjectKey(), preserveMode: true });
      } else {
        initPublicProjects();
      }
    });
  }
  if (!isConfigured()) {
    if (renderFallback({ preferredKey: getActiveProjectKey() })) return;
    renderUnavailable();
    markSection("unconfigured");
    markMedia("unavailable");
    return;
  }

  try {
    let rows;
    try {
      rows = await fetchPublishedProjects();
    } catch (firstError) {
      // One short retry recovers common cold-start/network hiccups without
      // keeping the section blocked during a real outage.
      await new Promise((resolve) => window.setTimeout(resolve, 250));
      rows = await fetchPublishedProjects();
      console.info("[projects] Recovered after a transient Supabase failure.", firstError);
    }

    if (!rows.length) {
      // Published nothing is a valid state during setup — show the bundled
      // case shelf so the vitrine never looks empty to a visitor.
      if (renderFallback({ preferredKey: getActiveProjectKey() })) return;
      renderUnavailable(t("work.empty"));
      markSection("empty");
      markMedia("unavailable");
      return;
    }

    const paths = [];
    rows.forEach((row) => {
      if (isStoragePath(row.poster_url)) paths.push(row.poster_url);
      (row.project_gallery ?? []).forEach((image) => {
        if (isStoragePath(image.url)) paths.push(image.url);
      });
    });

    let signed = new Map();
    let mediaState = "ready";
    if (paths.length) {
      try {
        signed = await signPaths(paths);
      } catch (error) {
        // Project metadata is more important than optional remote artwork.
        // Keep the portfolio usable and let resolvePoster() fall back to the
        // bundled artwork/placeholder instead of hiding every published case.
        mediaState = "degraded";
        console.warn("[projects] Project media unavailable; using safe fallbacks.", error);
      }
    }

    lastRows = rows;
    lastSigned = signed;
    markMedia(mediaState);
    renderFromRows(rows, signed, { preferredKey: getActiveProjectKey() });
  } catch (error) {
    if (renderFallback({ preferredKey: getActiveProjectKey() })) {
      console.warn("[projects] Supabase unavailable; showing bundled cases.", error);
      return;
    }
    renderUnavailable();
    markSection("unavailable");
    markMedia("unavailable");
    console.warn("[projects] Supabase unavailable, keeping the viewer neutral.", error);
  }
}
