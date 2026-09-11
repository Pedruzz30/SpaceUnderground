import { getActivity } from "../services/activity-service.js";
import { getSiteContent } from "../services/content-service.js";
import { getPlans } from "../services/plan-service.js";
import { getProjects } from "../services/project-service.js";
import { getSiteSettings } from "../services/settings-service.js";
import { describeError } from "../services/errors.js";
import { escapeHtml } from "../utils/html.js";

const SECTIONS = ["hero", "about", "capabilities", "process", "contact", "footer"];

const MODULES = [
  { key: "projects", eyebrow: "PROJECTS / CASES", title: "Portfolio records", href: "#/projects", action: "Open Projects" },
  { key: "media", eyebrow: "MEDIA", title: "Assets", href: "#/media", action: "Open Media" },
  { key: "content", eyebrow: "SITE CONTENT", title: "Public sections", href: "#/content", action: "Edit Content" },
  { key: "plans", eyebrow: "PLANS / PRICING", title: "Commercial plans", href: "#/services", action: "Manage Plans" },
  { key: "settings", eyebrow: "SEO / PUBLIC SETTINGS", title: "Site identity", href: "#/settings", action: "Open Settings" },
];

function countMedia(projects) {
  return projects.reduce((total, project) => total + (project.poster ? 1 : 0) + (project.gallery?.length || 0), 0);
}

function hasContent(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.values(value).some(hasContent);
  return Boolean(String(value || "").trim());
}

function deriveState({ projects, plans, contentRows, settings, activity }) {
  const content = new Map(contentRows.map((entry) => [entry.key, entry.content || {}]));
  const published = projects.filter((project) => project.editorialStatus === "PUBLISHED" && project.visible);
  const drafts = projects.filter((project) => project.editorialStatus === "DRAFT").length;
  const archived = projects.filter((project) => project.editorialStatus === "ARCHIVED").length;
  const hidden = projects.filter((project) => !project.visible).length;
  const missingPoster = projects.filter((project) => project.visible && !project.poster).length;
  const missingPresentation = projects.filter((project) => project.visible && !project.presentation?.system).length;
  const configuredSections = SECTIONS.filter((key) => hasContent(content.get(key))).length;
  const visiblePlans = plans.filter((plan) => plan.visible);
  const incompletePlans = visiblePlans.filter((plan) => !plan.features?.length || !plan.range || !plan.timeline).length;

  const attention = [];
  if (!published.length) attention.push({ label: "Portfolio", detail: "No visible published projects are available." });
  if (missingPoster) attention.push({ label: "Media", detail: `${missingPoster} visible project(s) have no poster.` });
  if (missingPresentation) attention.push({ label: "Presentation", detail: `${missingPresentation} visible project(s) are missing presentation data.` });
  if (configuredSections < SECTIONS.length) attention.push({ label: "Site Content", detail: `${SECTIONS.length - configuredSections} public section(s) still use build copy.` });
  if (!settings?.seoTitle || !settings?.seoDescription) attention.push({ label: "SEO", detail: "Search title or description is incomplete." });
  if (!settings?.ogImagePath) attention.push({ label: "Social", detail: "Open Graph image is not configured." });
  if (incompletePlans) attention.push({ label: "Plans", detail: `${incompletePlans} visible plan(s) need pricing, timeline or features.` });

  const stats = [
    { label: "Published", value: published.length, hint: `${drafts} draft / ${archived} archived / ${hidden} hidden` },
    { label: "Assets", value: countMedia(projects), hint: `${missingPoster} missing posters` },
    { label: "Sections", value: `${configuredSections}/${SECTIONS.length}`, hint: "runtime content configured" },
    { label: "Plans", value: visiblePlans.length, hint: `${plans.length - visiblePlans.length} hidden` },
  ];

  const moduleStats = {
    projects: `${projects.length} records, ${published.length} live`,
    media: `${countMedia(projects)} attached assets`,
    content: `${configuredSections}/${SECTIONS.length} sections configured`,
    plans: `${visiblePlans.length} visible plans`,
    settings: settings?.siteName ? `${settings.siteName} identity` : "Identity not configured",
  };

  const contentActivity = activity.filter((entry) => {
    const signature = `${entry.action || ""} ${entry.entityType || ""}`.toLowerCase();
    return ["project", "media", "publish", "content", "settings", "plan"].some((term) => signature.includes(term));
  });

  return { attention, stats, moduleStats, activity: contentActivity };
}

function statCard(stat) {
  return `
    <article class="stat-card">
      <span>${escapeHtml(stat.label)}</span>
      <strong>${escapeHtml(String(stat.value))}</strong>
      <p>${escapeHtml(stat.hint)}</p>
    </article>
  `;
}

function moduleCard(module, state) {
  return `
    <article class="panel cms-card">
      <header class="panel__head">
        <div>
          <span>${escapeHtml(module.eyebrow)}</span>
          <h3>${escapeHtml(module.title)}</h3>
        </div>
        <strong class="badge badge--success">LIVE</strong>
      </header>
      <p>${escapeHtml(state.moduleStats[module.key])}</p>
      <a class="button" href="${escapeHtml(module.href)}">${escapeHtml(module.action)}</a>
    </article>
  `;
}

function attentionList(items) {
  if (!items.length) return '<p class="empty-inline">Everything looks healthy.</p>';
  return items.map((item) => `
    <div class="cms-attention-row">
      <strong>${escapeHtml(item.label)}</strong>
      <span>${escapeHtml(item.detail)}</span>
    </div>
  `).join("");
}

function activityRows(entries) {
  if (!entries.length) return '<p class="empty-inline">No content activity yet.</p>';
  return entries.slice(0, 8).map((entry) => `
    <div class="activity-row">
      <span>${escapeHtml(new Date(entry.time).toLocaleString())}</span>
      <strong>${escapeHtml(entry.title)}</strong>
      <p>${escapeHtml(entry.detail || entry.action || "No detail.")}</p>
      <small>${escapeHtml(entry.action || "admin.event")}</small>
    </div>
  `).join("");
}

export const cmsPage = {
  title: "CMS",
  breadcrumb: "CONTENT / CMS",
  render: () => `
    <section class="page-heading page-heading--split">
      <div>
        <span>CMS CONTROL CENTER</span>
        <h2>Content control.</h2>
        <p>Operational overview for everything that feeds the public Space Underground site.</p>
      </div>
      <div class="heading-actions">
        <a class="button" href="../" target="_blank" rel="noreferrer">View Website</a>
      </div>
    </section>

    <section data-cms-dashboard aria-busy="true">
      <div class="panel"><p class="empty-inline">Loading CMS status...</p></div>
    </section>
  `,
  afterRender: async () => {
    const root = document.querySelector("[data-cms-dashboard]");
    try {
      const [projects, plans, contentRows, settings, activity] = await Promise.all([
        getProjects(),
        getPlans(),
        getSiteContent(),
        getSiteSettings(),
        getActivity({ limit: 40 }),
      ]);
      if (!root?.isConnected) return;
      const state = deriveState({ projects, plans, contentRows, settings, activity });
      root.innerHTML = `
        <div class="stats-grid stats-grid--four">${state.stats.map(statCard).join("")}</div>
        <div class="cms-dashboard-grid">
          <section class="panel">
            <header class="panel__head">
              <div><span>NEEDS ATTENTION</span><h3>Publishing readiness</h3></div>
            </header>
            <div class="cms-attention-list">${attentionList(state.attention)}</div>
          </section>
          <section class="panel">
            <header class="panel__head">
              <div><span>RECENT ACTIVITY</span><h3>Content changes</h3></div>
              <a class="button" href="#/logs">Open Logs</a>
            </header>
            <div class="activity-table">${activityRows(state.activity)}</div>
          </section>
        </div>
        <div class="cms-grid">${MODULES.map((module) => moduleCard(module, state)).join("")}</div>
      `;
    } catch (error) {
      root.innerHTML = `<section class="panel"><p class="empty-inline">${escapeHtml(describeError(error, "Unable to load CMS status."))}</p></section>`;
    } finally {
      root?.removeAttribute("aria-busy");
    }
  },
};
