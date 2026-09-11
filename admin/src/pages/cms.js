import { DATA_SOURCE } from "../config/env.js";
import { getActivity } from "../services/activity-service.js";
import { getSiteContent } from "../services/content-service.js";
import { getPlans } from "../services/plan-service.js";
import { getProjects } from "../services/project-service.js";
import { getSiteSettings } from "../services/settings-service.js";
import { describeError } from "../services/errors.js";
import { formatRelativeDay } from "../utils/format.js";
import { escapeHtml } from "../utils/html.js";

const CONTENT_KEYS = ["hero", "about", "capabilities", "process", "contact", "footer"];

const MODULES = [
  {
    key: "projects",
    eyebrow: "PROJECTS / CASES",
    title: "Portfolio records",
    description: "Public case studies, presentation data and publishing state.",
    action: "Open Projects",
    href: "#/projects",
  },
  {
    key: "media",
    eyebrow: "MEDIA",
    title: "Project assets",
    description: "Posters, galleries and Storage-backed project media.",
    action: "Open Media",
    href: "#/media",
  },
  {
    key: "content",
    eyebrow: "SITE CONTENT",
    title: "Public sections",
    description: "Hero, About, Capabilities, Process, Contact and Footer.",
    action: "Edit Content",
    href: "#/content",
  },
  {
    key: "plans",
    eyebrow: "PLANS / PRICING",
    title: "Commercial plans",
    description: "Public offers, pricing, delivery and feature lists.",
    action: "Manage Plans",
    href: "#/services",
  },
  {
    key: "seo",
    eyebrow: "SEO / PUBLIC SETTINGS",
    title: "Site identity",
    description: "Metadata, public URL, contact identity and social preview.",
    action: "Open Settings",
    href: "#/settings",
  },
];

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function contentConfigured(entry) {
  if (!entry?.content || typeof entry.content !== "object") return false;
  if (Array.isArray(entry.content.items)) return entry.content.items.some((item) => Object.values(item || {}).some(hasText));
  return Object.values(entry.content).some(hasText);
}

function presentationComplete(project) {
  const presentation = project.presentation || {};
  return [presentation.system, presentation.label, presentation.type].every(hasText) && (project.modules || []).length > 0;
}

function deriveState({ projects, content, plans, settings }) {
  const published = projects.filter((project) => project.editorialStatus === "PUBLISHED" && project.visible);
  const drafts = projects.filter((project) => project.editorialStatus === "DRAFT");
  const archived = projects.filter((project) => project.editorialStatus === "ARCHIVED");
  const hidden = projects.filter((project) => !project.visible);
  const missingPoster = projects.filter((project) => project.editorialStatus !== "ARCHIVED" && !hasText(project.poster));
  const missingPresentation = projects.filter((project) => project.editorialStatus !== "ARCHIVED" && !presentationComplete(project));
  const galleryItems = projects.reduce((total, project) => total + (project.gallery || []).length, 0);
  const configuredContent = CONTENT_KEYS.filter((key) => contentConfigured(content.find((entry) => entry.key === key))).length;
  const visiblePlans = plans.filter((plan) => plan.visible);
  const plansWithoutFeatures = plans.filter((plan) => !(plan.features || []).length);
  const seoReady = hasText(settings.seoTitle) && hasText(settings.seoDescription);
  const ogReady = hasText(settings.ogImagePath);

  const attention = [];
  if (drafts.length) attention.push({ label: `${drafts.length} draft case${drafts.length === 1 ? "" : "s"}`, detail: "Review publishing state before release.", href: "#/projects" });
  if (missingPoster.length) attention.push({ label: `${missingPoster.length} case${missingPoster.length === 1 ? "" : "s"} without poster`, detail: "Public presentation is missing a primary visual.", href: "#/projects" });
  if (missingPresentation.length) attention.push({ label: `${missingPresentation.length} incomplete presentation${missingPresentation.length === 1 ? "" : "s"}`, detail: "Presentation metadata or modules are incomplete.", href: "#/projects" });
  if (configuredContent < CONTENT_KEYS.length) attention.push({ label: `${CONTENT_KEYS.length - configuredContent} empty content section${CONTENT_KEYS.length - configuredContent === 1 ? "" : "s"}`, detail: "Some public sections still rely on build-time copy.", href: "#/content" });
  if (!seoReady) attention.push({ label: "SEO metadata incomplete", detail: "Title and description should both be configured.", href: "#/settings" });
  if (!ogReady) attention.push({ label: "OG image missing", detail: "Social previews do not have a configured image yet.", href: "#/settings" });
  if (plansWithoutFeatures.length) attention.push({ label: `${plansWithoutFeatures.length} plan${plansWithoutFeatures.length === 1 ? "" : "s"} without features`, detail: "Offer cards need a clear feature list.", href: "#/services" });

  return {
    published,
    drafts,
    archived,
    hidden,
    missingPoster,
    missingPresentation,
    galleryItems,
    configuredContent,
    visiblePlans,
    seoReady,
    ogReady,
    attention,
  };
}

function statusChip(label, tone = "neutral") {
  return `<span class="cms-status cms-status--${tone}">${escapeHtml(label)}</span>`;
}

function renderStatus(state) {
  const healthTone = state.attention.length ? "warning" : "success";
  const healthLabel = state.attention.length ? `${state.attention.length} ITEM${state.attention.length === 1 ? "" : "S"}` : "GOOD";
  return `
    <section class="cms-status-grid" aria-label="CMS status">
      <article><span>PUBLIC WEBSITE</span><strong>ONLINE</strong><small>Runtime content enabled</small></article>
      <article><span>DATA SOURCE</span><strong>${escapeHtml(DATA_SOURCE.toUpperCase())}</strong><small>Admin editorial source</small></article>
      <article><span>PUBLISHED CASES</span><strong>${state.published.length}</strong><small>${state.drafts.length} draft · ${state.archived.length} archived</small></article>
      <article><span>CONTENT HEALTH</span><strong>${escapeHtml(healthLabel)}</strong><small>${statusChip(state.attention.length ? "Attention" : "Healthy", healthTone)}</small></article>
    </section>
  `;
}

function moduleMeta(module, state, plans) {
  if (module.key === "projects") {
    return [`${state.published.length} published`, `${state.drafts.length} draft`, `${state.missingPoster.length + state.missingPresentation.length} needs attention`];
  }
  if (module.key === "media") {
    return [`${state.galleryItems} gallery item${state.galleryItems === 1 ? "" : "s"}`, `${state.missingPoster.length} missing poster`, "Storage-backed assets"];
  }
  if (module.key === "content") {
    return [`${state.configuredContent} / ${CONTENT_KEYS.length} configured`, `${CONTENT_KEYS.length - state.configuredContent} using fallback`, "Structured content"];
  }
  if (module.key === "plans") {
    return [`${state.visiblePlans.length} visible`, `${plans.length - state.visiblePlans.length} hidden`, `${plans.filter((plan) => !(plan.features || []).length).length} without features`];
  }
  return [state.seoReady ? "Metadata configured" : "Metadata incomplete", state.ogReady ? "OG image configured" : "OG image missing", "Public identity"];
}

function moduleCard(module, state, plans) {
  return `
    <article class="panel cms-module-card">
      <header class="panel__head">
        <div>
          <span>${escapeHtml(module.eyebrow)}</span>
          <h3>${escapeHtml(module.title)}</h3>
        </div>
      </header>
      <p>${escapeHtml(module.description)}</p>
      <div class="cms-module-card__meta">
        ${moduleMeta(module, state, plans).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
      </div>
      <a class="button" href="${escapeHtml(module.href)}">${escapeHtml(module.action)}</a>
    </article>
  `;
}

function renderAttention(items) {
  if (!items.length) {
    return `
      <div class="cms-healthy-state">
        ${statusChip("Healthy", "success")}
        <div><strong>Everything looks healthy.</strong><p>No editorial issues need attention right now.</p></div>
      </div>
    `;
  }

  return `
    <div class="cms-attention-list">
      ${items.map((item) => `
        <a href="${item.href}" class="cms-attention-item">
          <span aria-hidden="true"></span>
          <div><strong>${escapeHtml(item.label)}</strong><p>${escapeHtml(item.detail)}</p></div>
          <b aria-hidden="true">→</b>
        </a>
      `).join("")}
    </div>
  `;
}

function isContentActivity(entry) {
  const value = `${entry.action || ""} ${entry.entityType || ""}`.toLowerCase();
  return ["project", "publish", "media", "content", "settings", "plan"].some((token) => value.includes(token));
}

function renderActivity(entries) {
  const visible = entries.filter(isContentActivity).slice(0, 6);
  if (!visible.length) return '<p class="empty-inline">No content activity recorded yet.</p>';

  return `
    <div class="cms-activity-list">
      ${visible.map((entry) => `
        <div>
          <span></span>
          <strong>${escapeHtml(entry.title || entry.action || "Editorial event")}</strong>
          <p>${escapeHtml(entry.detail || "No additional detail.")}</p>
          <small>${escapeHtml(formatRelativeDay(entry.time))}</small>
        </div>
      `).join("")}
    </div>
  `;
}

function controlCenter({ projects, content, plans, settings, activity }) {
  const state = deriveState({ projects, content, plans, settings });
  return `
    ${renderStatus(state)}

    <section class="cms-control-grid">
      <article class="panel cms-attention-panel">
        <header class="panel__head">
          <div><span>NEEDS ATTENTION</span><h3>Editorial checks</h3></div>
          ${statusChip(state.attention.length ? String(state.attention.length) : "Clear", state.attention.length ? "warning" : "success")}
        </header>
        ${renderAttention(state.attention)}
      </article>

      <article class="panel cms-summary-panel">
        <header class="panel__head"><div><span>PUBLICATION</span><h3>Case state</h3></div></header>
        <div class="cms-mini-stats">
          <div><span>Published</span><strong>${state.published.length}</strong></div>
          <div><span>Draft</span><strong>${state.drafts.length}</strong></div>
          <div><span>Archived</span><strong>${state.archived.length}</strong></div>
          <div><span>Hidden</span><strong>${state.hidden.length}</strong></div>
        </div>
      </article>
    </section>

    <section>
      <header class="cms-section-head"><div><span>MODULES</span><h3>Publishing workspaces</h3></div></header>
      <div class="cms-grid">${MODULES.map((module) => moduleCard(module, state, plans)).join("")}</div>
    </section>

    <section class="panel cms-activity-panel">
      <header class="panel__head">
        <div><span>RECENT CONTENT ACTIVITY</span><h3>Editorial changes</h3></div>
        <a class="text-link" href="#/logs">View all logs</a>
      </header>
      ${renderActivity(activity)}
    </section>
  `;
}

export const cmsPage = {
  title: "CMS",
  breadcrumb: "CONTENT / CMS",
  render: () => `
    <section class="page-heading page-heading--split">
      <div>
        <span>CMS</span>
        <h2>Content control.</h2>
        <p>Manage, review and publish everything visible on the Space Underground website.</p>
      </div>
      <div class="heading-actions"><a class="button" href="../" target="_blank" rel="noreferrer">View Website</a></div>
    </section>
    <div data-cms-control aria-busy="true">
      <section class="panel"><p class="empty-inline">Loading editorial state...</p></section>
    </div>
  `,
  afterRender: async () => {
    const root = document.querySelector("[data-cms-control]");
    try {
      const [projects, content, plans, settings, activity] = await Promise.all([
        getProjects(),
        getSiteContent(),
        getPlans(),
        getSiteSettings(),
        getActivity({ limit: 40 }),
      ]);
      if (!root?.isConnected) return;
      root.innerHTML = controlCenter({ projects, content, plans, settings, activity });
    } catch (error) {
      if (!root?.isConnected) return;
      root.innerHTML = `<section class="panel"><p class="empty-inline">${escapeHtml(describeError(error, "Unable to load CMS status."))}</p></section>`;
    } finally {
      root?.removeAttribute("aria-busy");
    }
  },
};
