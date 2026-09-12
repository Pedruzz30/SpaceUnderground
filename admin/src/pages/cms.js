import { DATA_SOURCE } from "../config/env.js";
import { getActivity } from "../services/activity-service.js";
import { getSiteContent } from "../services/content-service.js";
import { getPlans } from "../services/plan-service.js";
import { getProjects } from "../services/project-service.js";
import { getSiteSettings } from "../services/settings-service.js";
import { describeError } from "../services/errors.js";
import { onLocaleChange, plural, t } from "../i18n/index.js";
import { formatRelativeDay } from "../utils/format.js";
import { escapeHtml } from "../utils/html.js";

const CONTENT_KEYS = ["hero", "about", "capabilities", "process", "contact", "footer"];

const MODULES = [
  { key: "projects", href: "#/projects" },
  { key: "media", href: "#/media" },
  { key: "content", href: "#/content" },
  { key: "plans", href: "#/services" },
  { key: "seo", href: "#/settings" },
];

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasContent(value) {
  if (Array.isArray(value)) return value.some(hasContent);
  if (value && typeof value === "object") return Object.values(value).some(hasContent);
  return hasText(value);
}

function contentConfigured(entry) {
  return hasContent(entry?.content);
}

function presentationComplete(project) {
  const presentation = project.presentation || {};
  return [presentation.system, presentation.label, presentation.type].every(hasText) && (project.modules || []).length > 0;
}

function countMedia(projects) {
  return projects.reduce((total, project) => total + (project.poster ? 1 : 0) + (project.gallery?.length || 0), 0);
}

// Checks carry keys and counts rather than finished sentences, so the same
// derived state renders in either language without being recomputed.
function deriveState({ projects, content, plans, settings }) {
  const published = projects.filter((project) => project.editorialStatus === "PUBLISHED" && project.visible);
  const drafts = projects.filter((project) => project.editorialStatus === "DRAFT");
  const archived = projects.filter((project) => project.editorialStatus === "ARCHIVED");
  const hidden = projects.filter((project) => !project.visible);
  const activeProjects = projects.filter((project) => project.editorialStatus !== "ARCHIVED");
  const missingPoster = activeProjects.filter((project) => !hasText(project.poster));
  const missingPresentation = activeProjects.filter((project) => !presentationComplete(project));
  const galleryItems = projects.reduce((total, project) => total + (project.gallery || []).length, 0);
  const configuredContent = CONTENT_KEYS.filter((key) => contentConfigured(content.find((entry) => entry.key === key))).length;
  const visiblePlans = plans.filter((plan) => plan.visible);
  const plansWithoutFeatures = visiblePlans.filter((plan) => !(plan.features || []).length);
  const seoReady = hasText(settings.seoTitle) && hasText(settings.seoDescription);
  const ogReady = hasText(settings.ogImagePath);
  const emptySections = CONTENT_KEYS.length - configuredContent;

  const attention = [];
  if (!published.length) {
    attention.push({ labelKey: "cms.checks.noLiveCases", detailKey: "cms.checks.noLiveCasesDetail", href: "#/projects" });
  }
  if (drafts.length) {
    attention.push({ pluralKey: "cms.checks.draftCases", count: drafts.length, detailKey: "cms.checks.draftCasesDetail", href: "#/projects" });
  }
  if (missingPoster.length) {
    attention.push({ pluralKey: "cms.checks.withoutPoster", count: missingPoster.length, detailKey: "cms.checks.withoutPosterDetail", href: "#/projects" });
  }
  if (missingPresentation.length) {
    attention.push({ pluralKey: "cms.checks.incompletePresentation", count: missingPresentation.length, detailKey: "cms.checks.incompletePresentationDetail", href: "#/projects" });
  }
  if (emptySections > 0) {
    attention.push({ pluralKey: "cms.checks.emptySections", count: emptySections, detailKey: "cms.checks.emptySectionsDetail", href: "#/content" });
  }
  if (!seoReady) {
    attention.push({ labelKey: "cms.checks.seoIncomplete", detailKey: "cms.checks.seoIncompleteDetail", href: "#/settings" });
  }
  if (!ogReady) {
    attention.push({ labelKey: "cms.checks.ogMissing", detailKey: "cms.checks.ogMissingDetail", href: "#/settings" });
  }
  if (plansWithoutFeatures.length) {
    attention.push({ pluralKey: "cms.checks.plansWithoutFeatures", count: plansWithoutFeatures.length, detailKey: "cms.checks.plansWithoutFeaturesDetail", href: "#/services" });
  }

  return {
    published,
    drafts,
    archived,
    hidden,
    missingPoster,
    missingPresentation,
    galleryItems,
    attachedAssets: countMedia(projects),
    configuredContent,
    visiblePlans,
    seoReady,
    ogReady,
    attention,
  };
}

function checkLabel(item) {
  return item.pluralKey ? plural(item.pluralKey, item.count) : t(item.labelKey);
}

function statusChip(label, tone = "neutral") {
  return `<span class="cms-status cms-status--${tone}">${escapeHtml(label)}</span>`;
}

function renderStatus(state) {
  const healthTone = state.attention.length ? "warning" : "success";
  const healthLabel = state.attention.length ? plural("cms.itemCount", state.attention.length) : t("cms.good");
  return `
    <section class="cms-status-grid" aria-label="${t("cms.status")}" data-i18n-aria-label="cms.status">
      <article><span>${t("cms.publicWebsite")}</span><strong>${t("cms.online")}</strong><small>${t("cms.runtimeContentEnabled")}</small></article>
      <article><span>${t("cms.dataSource")}</span><strong>${escapeHtml(DATA_SOURCE.toUpperCase())}</strong><small>${t("cms.adminEditorialSource")}</small></article>
      <article><span>${t("cms.publishedCases")}</span><strong>${state.published.length}</strong><small>${escapeHtml(t("cms.draftArchived", { drafts: state.drafts.length, archived: state.archived.length }))}</small></article>
      <article><span>${t("cms.contentHealth")}</span><strong>${escapeHtml(healthLabel)}</strong><small>${statusChip(state.attention.length ? t("cms.attention") : t("cms.healthy"), healthTone)}</small></article>
    </section>
  `;
}

function moduleMeta(module, state, plans) {
  if (module.key === "projects") {
    return [
      t("cms.meta.publishedCount", { count: state.published.length }),
      t("cms.meta.draftCount", { count: state.drafts.length }),
      t("cms.meta.needsAttentionCount", { count: state.missingPoster.length + state.missingPresentation.length }),
    ];
  }
  if (module.key === "media") {
    return [
      plural("cms.meta.attachedAssets", state.attachedAssets),
      plural("cms.meta.galleryItems", state.galleryItems),
      t("cms.meta.missingPoster", { count: state.missingPoster.length }),
    ];
  }
  if (module.key === "content") {
    return [
      t("cms.meta.configured", { count: state.configuredContent, total: CONTENT_KEYS.length }),
      t("cms.meta.usingFallback", { count: CONTENT_KEYS.length - state.configuredContent }),
      t("cms.meta.structuredContent"),
    ];
  }
  if (module.key === "plans") {
    return [
      t("cms.meta.visibleCount", { count: state.visiblePlans.length }),
      t("cms.meta.hiddenCount", { count: plans.length - state.visiblePlans.length }),
      t("cms.meta.withoutFeatures", { count: plans.filter((plan) => !(plan.features || []).length).length }),
    ];
  }
  return [
    state.seoReady ? t("cms.meta.metadataConfigured") : t("cms.meta.metadataIncomplete"),
    state.ogReady ? t("cms.meta.ogConfigured") : t("cms.meta.ogMissing"),
    t("cms.meta.publicIdentity"),
  ];
}

function moduleCard(module, state, plans) {
  return `
    <article class="panel cms-module-card">
      <header class="panel__head">
        <div>
          <span>${escapeHtml(t(`cms.cards.${module.key}`))}</span>
          <h3>${escapeHtml(t(`cms.cards.${module.key}Title`))}</h3>
        </div>
      </header>
      <p>${escapeHtml(t(`cms.cards.${module.key}Description`))}</p>
      <div class="cms-module-card__meta">
        ${moduleMeta(module, state, plans).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
      </div>
      <a class="button" href="${escapeHtml(module.href)}">${escapeHtml(t(`cms.cards.${module.key}Action`))}</a>
    </article>
  `;
}

function renderAttention(items) {
  if (!items.length) {
    return `
      <div class="cms-healthy-state">
        ${statusChip(t("cms.healthy"), "success")}
        <div><strong>${t("cms.everythingHealthy")}</strong><p>${t("cms.noIssues")}</p></div>
      </div>
    `;
  }

  return `
    <div class="cms-attention-list">
      ${items.map((item) => `
        <a href="${item.href}" class="cms-attention-item">
          <span aria-hidden="true"></span>
          <div><strong>${escapeHtml(checkLabel(item))}</strong><p>${escapeHtml(t(item.detailKey))}</p></div>
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

// Activity titles and details are the recorded audit text and are shown as
// stored; only the surrounding copy is localized.
function renderActivity(entries) {
  const visible = entries.filter(isContentActivity).slice(0, 6);
  if (!visible.length) return `<p class="empty-inline">${t("cms.noContentActivity")}</p>`;

  return `
    <div class="cms-activity-list">
      ${visible.map((entry) => `
        <div>
          <span></span>
          <strong>${escapeHtml(entry.title || entry.action || t("cms.editorialEvent"))}</strong>
          <p>${escapeHtml(entry.detail || t("cms.noAdditionalDetail"))}</p>
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
          <div><span>${t("cms.needsAttention")}</span><h3>${t("cms.editorialChecks")}</h3></div>
          ${statusChip(state.attention.length ? String(state.attention.length) : t("cms.clear"), state.attention.length ? "warning" : "success")}
        </header>
        ${renderAttention(state.attention)}
      </article>

      <article class="panel cms-summary-panel">
        <header class="panel__head"><div><span>${t("cms.publication")}</span><h3>${t("cms.caseState")}</h3></div></header>
        <div class="cms-mini-stats">
          <div><span>${t("cms.published")}</span><strong>${state.published.length}</strong></div>
          <div><span>${t("cms.draft")}</span><strong>${state.drafts.length}</strong></div>
          <div><span>${t("cms.archived")}</span><strong>${state.archived.length}</strong></div>
          <div><span>${t("cms.hidden")}</span><strong>${state.hidden.length}</strong></div>
        </div>
      </article>
    </section>

    <section>
      <header class="cms-section-head"><div><span>${t("cms.modules")}</span><h3>${t("cms.publishingWorkspaces")}</h3></div></header>
      <div class="cms-grid">${MODULES.map((module) => moduleCard(module, state, plans)).join("")}</div>
    </section>

    <section class="panel cms-activity-panel">
      <header class="panel__head">
        <div><span>${t("cms.recentContentActivity")}</span><h3>${t("cms.editorialChanges")}</h3></div>
        <a class="text-link" href="#/logs">${t("cms.viewAllLogs")}</a>
      </header>
      ${renderActivity(activity)}
    </section>
  `;
}

export const cmsPage = {
  title: () => t("cms.title"),
  breadcrumb: () => t("cms.breadcrumb"),
  render: () => `
    <section class="page-heading page-heading--split">
      <div>
        <span data-i18n="cms.eyebrow">${t("cms.eyebrow")}</span>
        <h2 data-i18n="cms.heading">${t("cms.heading")}</h2>
        <p data-i18n="cms.intro">${t("cms.intro")}</p>
      </div>
      <div class="heading-actions"><a class="button" href="../" target="_blank" rel="noreferrer" data-i18n="cms.viewWebsite">${t("cms.viewWebsite")}</a></div>
    </section>
    <div data-cms-control aria-busy="true">
      <section class="panel"><p class="empty-inline" data-i18n="cms.loading">${t("cms.loading")}</p></section>
    </div>
  `,
  afterRender: async () => {
    const root = document.querySelector("[data-cms-control]");
    let snapshot = null;

    // The whole control centre is derived from one snapshot. A locale change
    // re-derives it from that same snapshot rather than re-running the five
    // queries behind it.
    onLocaleChange(root, () => {
      if (snapshot) root.innerHTML = controlCenter(snapshot);
    });

    try {
      const [projects, content, plans, settings, activity] = await Promise.all([
        getProjects(),
        getSiteContent(),
        getPlans(),
        getSiteSettings(),
        getActivity({ limit: 40 }),
      ]);
      if (!root?.isConnected) return;
      snapshot = { projects, content, plans, settings, activity };
      root.innerHTML = controlCenter(snapshot);
    } catch (error) {
      if (!root?.isConnected) return;
      root.innerHTML = `<section class="panel"><p class="empty-inline">${escapeHtml(describeError(error, t("cms.loadError")))}</p></section>`;
    } finally {
      root?.removeAttribute("aria-busy");
    }
  },
};
