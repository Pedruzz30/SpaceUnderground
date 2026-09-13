import { badge, badgeType } from "../components/badge.js";
import { showToast } from "../components/toast.js";
import { confirmModal, openModal } from "../components/modal.js";
import { CATEGORIES, EDITORIAL_STATUSES, PROJECT_STATUSES } from "../data/projects.js";
import { logActivity } from "../services/activity-service.js";
import { describeError, toDataError } from "../services/errors.js";
import {
  archiveProject,
  createProject,
  deleteProject,
  getProjectById,
  nextAvailableCaseNumber,
  updateProject,
} from "../services/project-service.js";
import {
  isStoragePath,
  removeProjectImages,
  resolveGalleryUrls,
  resolveImageUrl,
  uploadProjectImage,
} from "../services/storage-service.js";
import { clearNavigationGuard, setNavigationGuard } from "../router/router.js";
import { applyStaticTranslations, subscribeLocaleChange, t, statusLabel } from "../i18n/index.js";
import { BASE_LOCALE, TRANSLATION_LOCALE, localeHint, localeTabs } from "../components/locale-fields.js";
import { publicSiteUrl } from "../config/public-site.js";
import { escapeAttribute, escapeHtml } from "../utils/html.js";
import { isLivePreviewUrl, liveDemoState, projectHealth, publishReadiness } from "../utils/project-health.js";

const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/avif,image/gif";

const DIACRITIC_MARKS = new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`, "g");

function slugify(value) {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(DIACRITIC_MARKS, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
}

function isValidUrl(value) {
  if (!value) return true;
  try {
    if (/^(#|\/|\.{1,2}\/)/.test(value)) return true;
    const url = new URL(value, "https://spaceunderground.local");
    return /^(https?:)?\/\//i.test(value) && ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function isRequiredLivePreviewUrl(value) {
  return isLivePreviewUrl(value);
}

function isValidHex(value) {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value || "");
}

function normalizeHexForPicker(hex) {
  if (/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  if (/^#[0-9a-f]{3}$/i.test(hex)) return `#${hex.slice(1).split("").map((c) => c + c).join("")}`;
  return "#c6ff00";
}

function formatDate(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(document.documentElement.lang || undefined, { dateStyle: "medium", timeStyle: "short" });
}

function validate(values) {
  const errors = {};
  if (!values.name.trim()) errors.name = t("projectEditor.validation.nameRequired");
  if (!values.slug.trim()) errors.slug = t("projectEditor.validation.slugRequired");
  if (!CATEGORIES.includes(values.category)) errors.category = t("projectEditor.validation.categoryRequired");

  const year = Number(values.year);
  if (!values.year || Number.isNaN(year) || year < 1990 || year > 2100) errors.year = t("projectEditor.validation.yearValid");
  if (!PROJECT_STATUSES.includes(values.status)) errors.status = t("projectEditor.validation.statusValid");
  if (!EDITORIAL_STATUSES.includes(values.editorialStatus)) errors.editorialStatus = t("projectEditor.validation.editorialStatusValid");
  if (!isValidUrl(values.projectUrl)) errors.projectUrl = t("projectEditor.validation.urlValid");
  if (values.previewUrl && !isRequiredLivePreviewUrl(values.previewUrl)) errors.previewUrl = t("projectEditor.validation.previewUrlValid");
  if (values.livePreviewEnabled && !isRequiredLivePreviewUrl(values.previewUrl)) errors.previewUrl = t("projectEditor.validation.previewUrlValid");
  if (values.accent && !isValidHex(values.accent)) errors.accent = t("projectEditor.validation.hexValid");
  const untitledModule = (values.modules || []).findIndex((module) => !module.title.trim());
  if (untitledModule >= 0) errors[`module-title-${untitledModule}`] = t("projectEditor.validation.moduleTitleRequired");

  return errors;
}

function fieldMarkup({ label, labelKey, name, value = "", type = "text", attrs = "", hint = "", hintKey = "" }) {
  return `
    <div class="field" data-field="${name}">
      <label for="field-${name}"${labelKey ? ` data-i18n="${labelKey}"` : ""}>${escapeHtml(labelKey ? t(labelKey) : label)}</label>
      <input id="field-${name}" name="${name}" type="${type}" value="${escapeAttribute(value)}" ${attrs}>
      ${hint || hintKey ? `<p class="field-hint"${hintKey ? ` data-i18n="${hintKey}"` : ""}>${escapeHtml(hintKey ? t(hintKey) : hint)}</p>` : ""}
      <p class="field-error" id="field-${name}-error" hidden></p>
    </div>
  `;
}

function selectMarkup({ labelKey, name, value, options }) {
  return `
    <div class="field" data-field="${name}">
      <label for="field-${name}" data-i18n="${labelKey}">${escapeHtml(t(labelKey))}</label>
      <select id="field-${name}" name="${name}">
        ${options.map((option) => `<option value="${escapeAttribute(option)}" ${option === value ? "selected" : ""}>${escapeHtml(statusLabel(option))}</option>`).join("")}
      </select>
      <p class="field-error" id="field-${name}-error" hidden></p>
    </div>
  `;
}

function updateSelectLabels(select) {
  [...select.options].forEach((option) => {
    option.textContent = statusLabel(option.value);
  });
}

function blankProject(caseNumber) {
  return {
    id: null,
    dbId: null,
    caseNumber,
    name: "",
    slug: "",
    client: "",
    category: "Website",
    description: "",
    status: "In Development",
    editorialStatus: "DRAFT",
    featured: false,
    visible: false,
    year: String(new Date().getFullYear()),
    accent: "#c6ff00",
    techStack: [],
    presentation: {
      system: "",
      label: "",
      address: "",
      type: "",
      origin: "",
      coordinates: ["", ""],
    },
    modules: [],
    poster: "",
    gallery: [],
    projectUrl: "",
    previewUrl: "",
    livePreviewEnabled: false,
    createdAt: null,
    updatedAt: null,
    publishedAt: null,
  };
}

// `editLocale` decides whether the title/description inputs are bound to the
// module's own pt-BR text or to its English translation. Code, order and
// identity are structural and never change with the locale.
function moduleMarkup(module, index, total, editLocale = BASE_LOCALE) {
  const showingBase = editLocale === BASE_LOCALE;
  const localized = module.translations?.[TRANSLATION_LOCALE] ?? {};
  const valueFor = (field) => (showingBase ? module[field] ?? "" : localized[field] ?? "");
  const placeholderFor = (field) => (showingBase ? "" : String(module[field] ?? ""));
  return `
    <article class="module-card" data-module-index="${index}">
      <header class="module-card__head">
        <div>
          <span>${escapeHtml(t("projectEditor.moduleIndex", { index: String(index + 1).padStart(2, "0") }))}</span>
          <strong>${escapeHtml(module.title || t("projectEditor.untitledModule"))}</strong>
        </div>
        <div class="module-card__actions">
          <button type="button" class="button" data-module-up="${index}" ${index === 0 ? "disabled" : ""} data-i18n="projectEditor.moveUp">${t("projectEditor.moveUp")}</button>
          <button type="button" class="button" data-module-down="${index}" ${index === total - 1 ? "disabled" : ""} data-i18n="projectEditor.moveDown">${t("projectEditor.moveDown")}</button>
          <button type="button" class="button button--danger" data-module-remove="${index}" data-i18n="projectEditor.removeModule">${t("projectEditor.removeModule")}</button>
        </div>
      </header>
      <div class="form-grid">
        ${fieldMarkup({ labelKey: "projectEditor.code", name: `module-code-${index}`, value: module.code, attrs: `data-module-field="code" data-module-index="${index}"${showingBase ? "" : " readonly"}` })}
        ${fieldMarkup({ labelKey: "projectEditor.titleField", name: `module-title-${index}`, value: valueFor("title"), attrs: `data-module-field="title" data-module-index="${index}"${placeholderFor("title") ? ` placeholder="${escapeAttribute(placeholderFor("title"))}"` : ""}${showingBase ? "" : ' class="is-translation"'}` })}
        <div class="field field--wide">
          <label for="field-module-description-${index}" data-i18n="projectEditor.description"> ${t("projectEditor.description")}</label>
          <textarea id="field-module-description-${index}" rows="3" data-module-field="description" data-module-index="${index}"${placeholderFor("description") ? ` placeholder="${escapeAttribute(placeholderFor("description"))}"` : ""}${showingBase ? "" : ' class="is-translation"'}>${escapeHtml(valueFor("description"))}</textarea>
        </div>
      </div>
    </article>
  `;
}

const HEALTH_LABEL_KEYS = {
  healthy: "projectHealth.status.healthy",
  attention: "projectHealth.status.attention",
  incomplete: "projectHealth.status.incomplete",
};

const DEMO_LABEL_KEYS = {
  live: "projectHealth.demo.live",
  none: "projectHealth.demo.none",
  invalid: "projectHealth.demo.invalid",
};

const CHECK_LABEL_KEYS = {
  name: "projectHealth.checks.name",
  client: "projectHealth.checks.client",
  category: "projectHealth.checks.category",
  descriptionPt: "projectHealth.checks.descriptionPt",
  poster: "projectHealth.checks.poster",
  modules: "projectHealth.checks.modules",
  projectUrl: "projectHealth.checks.projectUrl",
  publicationConsistency: "projectHealth.checks.publicationConsistency",
  liveDemoUrl: "projectHealth.checks.liveDemoUrl",
  englishCompleteness: "projectHealth.checks.englishCompleteness",
};

function statusBadge(label, state) {
  const type = state === "healthy" || state === "live" ? "success" : state === "none" ? "muted" : "warning";
  return `<span class="badge badge--${type}">${escapeHtml(label)}</span>`;
}

function healthChecksMarkup(health) {
  return `
    <div class="health-checks">
      ${health.checks.map((item) => `
        <div class="health-check health-check--${item.ok ? "ok" : item.severity}">
          <span aria-hidden="true">${item.ok ? "OK" : "!"}</span>
          <strong>${escapeHtml(t(CHECK_LABEL_KEYS[item.key]))}</strong>
        </div>
      `).join("")}
    </div>
  `;
}

function healthCardMarkup(health) {
  return `
    <strong>${escapeHtml(t("projectHealth.score", { score: health.score, total: health.total }))}</strong>
    ${statusBadge(t(HEALTH_LABEL_KEYS[health.status]), health.status)}
    ${healthChecksMarkup(health)}
  `;
}

function overviewBadgesMarkup(values, health) {
  const completeness = health.completeness;
  return `
    ${badge(values.editorialStatus, badgeType(values.editorialStatus))}
    ${statusBadge(values.visible ? t("common.visible") : t("common.hidden"), values.visible ? "healthy" : "none")}
    ${statusBadge(t(DEMO_LABEL_KEYS[health.demo]), health.demo)}
    ${statusBadge(t("projectHealth.content.pt", { percent: completeness.pt.percent }), completeness.pt.percent === 100 ? "healthy" : "attention")}
    ${statusBadge(t("projectHealth.content.en", { percent: completeness.en.percent }), completeness.en.percent === 100 ? "healthy" : "attention")}
  `;
}

function overviewMarkup(project) {
  const health = projectHealth(project);
  const completeness = health.completeness;
  const demo = health.demo;
  const publicUrl = project.slug ? publicSiteUrl("#work") : "";

  return `
    <div class="project-overview">
      <section class="overview-hero">
        <div>
          <span>${escapeHtml(t("projectEditor.caseLabel", { caseNumber: project.caseNumber }))}</span>
          <h3>${escapeHtml(project.name || t("projects.untitled"))}</h3>
        </div>
        <div class="overview-badges" data-overview-badges>${overviewBadgesMarkup(project, health)}</div>
      </section>

      <section class="overview-grid">
        <article class="overview-card">
          <span>${escapeHtml(t("projectHealth.title"))}</span>
          <div data-overview-health>${healthCardMarkup(health)}</div>
        </article>
        <article class="overview-card">
          <span>${escapeHtml(t("projectEditor.quickActions"))}</span>
          <div class="overview-actions">
            <button type="submit" class="button" data-editor-action data-action-overview-save>${t("common.save")}</button>
            <button type="button" class="button button--primary" data-editor-action data-action-overview-publish>${t("projectEditor.publishChanges")}</button>
            <a class="button" href="${escapeAttribute(publicUrl || "#/projects")}" target="_blank" rel="noreferrer" ${publicUrl ? "" : "aria-disabled=\"true\""}>${t("projectEditor.viewPublic")}</a>
            <a class="button" data-action-open-project href="${escapeAttribute(project.projectUrl || "#")}" target="_blank" rel="noreferrer" ${project.projectUrl ? "" : "aria-disabled=\"true\""}>${t("projectEditor.openProject")}</a>
            <button type="button" class="button" data-editor-action data-action-demo ${demo === "live" ? "" : "disabled"}>${t("projectEditor.openDemo")}</button>
          </div>
        </article>
      </section>
    </div>
  `;
}

function liveDemoMarkup(project) {
  const demo = liveDemoState(project);
  return `
    <div class="live-demo-panel">
      <div class="live-demo-status">
        <span>${escapeHtml(t("projectEditor.liveDemoStatus"))}</span>
        <span data-demo-status>${statusBadge(t(DEMO_LABEL_KEYS[demo]), demo)}</span>
      </div>
      <fieldset class="field field--wide">
        <legend data-i18n="projectEditor.liveDemo">${t("projectEditor.liveDemo")}</legend>
        <div class="checks">
          <label><input type="checkbox" name="livePreviewEnabled" ${project.livePreviewEnabled ? "checked" : ""}> <span data-i18n="projectEditor.enableLiveDemo">${t("projectEditor.enableLiveDemo")}</span></label>
        </div>
      </fieldset>
      <div class="form-grid">
        ${fieldMarkup({ labelKey: "projectEditor.previewUrl", name: "previewUrl", value: project.previewUrl, type: "url", hintKey: "projectEditor.previewUrlHint" })}
      </div>
      <div class="media-actions">
        <button type="button" class="button" data-editor-action data-action-test-demo ${demo === "live" ? "" : "disabled"} data-i18n="projectEditor.testDemo">${t("projectEditor.testDemo")}</button>
      </div>
    </div>
  `;
}

function renderEditor(project, isCreate) {
  const accentValue = project.accent || "#c6ff00";
  const presentation = project.presentation || {};
  const coordinates = Array.isArray(presentation.coordinates) ? presentation.coordinates : [];
  const activeTab = isCreate ? "general" : "overview";

  return `
    <section class="page-heading page-heading--split">
      <div>
        <span data-editor-breadcrumb>${isCreate ? t("projectEditor.newBreadcrumb") : t("projectEditor.caseBreadcrumb", { caseNumber: project.caseNumber })}</span>
        <h2 data-i18n="projectEditor.heading">${t("projectEditor.heading")}</h2>
        <div class="editor-identity">
          <strong>${escapeHtml(t("projectEditor.caseLabel", { caseNumber: project.caseNumber }))}</strong>
          <strong class="editor-identity__name">${escapeHtml(project.name || t("projects.untitled"))}</strong>
          <span class="editor-identity__meta" data-editor-meta data-category="${escapeAttribute(project.category)}" data-status="${escapeAttribute(project.status)}">${escapeHtml(statusLabel(project.category))} / ${escapeHtml(statusLabel(project.status))}</span>
          ${badge(project.editorialStatus, badgeType(project.editorialStatus))}
          <span class="save-state is-saved" data-save-state ${isCreate ? "hidden" : ""}>${t("common.saved").toUpperCase()}</span>
        </div>
      </div>
      <div class="heading-actions">
        <a class="button" href="#/projects" data-i18n="projectEditor.allProjects">${t("projectEditor.allProjects")}</a>
      </div>
    </section>

    <form class="editor-form" data-project-editor data-project-id="${escapeAttribute(project.id || "")}" data-mode="${isCreate ? "create" : "edit"}" novalidate>
      <div class="editor-toolbar">
        ${isCreate
          ? `<button type="submit" class="button button--primary" data-editor-action data-action-create data-i18n="projectEditor.createProject">${t("projectEditor.createProject")}</button>`
          : `
            <button type="button" class="button" data-editor-action data-action-preview data-i18n="projectEditor.preview">${t("projectEditor.preview")}</button>
            <button type="submit" class="button" data-editor-action data-action-save data-i18n="projectEditor.saveChanges">${t("projectEditor.saveChanges")}</button>
            <button type="button" class="button button--primary" data-editor-action data-action-publish data-i18n="projectEditor.publishChanges">${t("projectEditor.publishChanges")}</button>
          `}
      </div>

      <div class="tabs" role="tablist" aria-label="${t("projectEditor.sections")}" data-i18n-aria-label="projectEditor.sections">
        ${isCreate ? "" : `<button type="button" role="tab" id="tab-overview" aria-selected="${activeTab === "overview"}" aria-controls="panel-overview" data-tab="overview" tabindex="${activeTab === "overview" ? "0" : "-1"}" data-i18n="projectEditor.overview">${t("projectEditor.overview")}</button>`}
        <button type="button" role="tab" id="tab-general" aria-selected="${activeTab === "general"}" aria-controls="panel-general" data-tab="general" tabindex="${activeTab === "general" ? "0" : "-1"}" data-i18n="projectEditor.general">${t("projectEditor.general")}</button>
        <button type="button" role="tab" id="tab-presentation" aria-selected="false" aria-controls="panel-presentation" data-tab="presentation" tabindex="-1" data-i18n="projectEditor.presentation">${t("projectEditor.presentation")}</button>
        <button type="button" role="tab" id="tab-media" aria-selected="false" aria-controls="panel-media" data-tab="media" tabindex="-1" data-i18n="projectEditor.media">${t("projectEditor.media")}</button>
        <button type="button" role="tab" id="tab-live-demo" aria-selected="false" aria-controls="panel-live-demo" data-tab="live-demo" tabindex="-1" data-i18n="projectEditor.liveDemo">${t("projectEditor.liveDemo")}</button>
        <button type="button" role="tab" id="tab-publishing" aria-selected="false" aria-controls="panel-publishing" data-tab="publishing" tabindex="-1" data-i18n="projectEditor.publishing">${t("projectEditor.publishing")}</button>
      </div>

      ${isCreate ? "" : `
      <div class="tab-panel" id="panel-overview" role="tabpanel" aria-labelledby="tab-overview" ${activeTab === "overview" ? "" : "hidden"}>
        ${overviewMarkup(project)}
      </div>`}

      <div class="tab-panel" id="panel-general" role="tabpanel" aria-labelledby="tab-general" ${activeTab === "general" ? "" : "hidden"}>
        <div class="form-grid">
          ${fieldMarkup({ labelKey: "projectEditor.caseNumber", name: "caseNumber", value: project.caseNumber, attrs: 'readonly aria-readonly="true"', hintKey: "projectEditor.caseNumberHint" })}
          ${fieldMarkup({ labelKey: "projectEditor.projectName", name: "name", value: project.name, attrs: "required" })}
          ${fieldMarkup({ labelKey: "projectEditor.slug", name: "slug", value: project.slug, attrs: "required", hintKey: "projectEditor.slugHint" })}
          ${fieldMarkup({ labelKey: "common.client", name: "client", value: project.client })}
          ${selectMarkup({ labelKey: "common.category", name: "category", value: project.category, options: CATEGORIES })}
          ${selectMarkup({ labelKey: "projectEditor.projectStatus", name: "status", value: project.status, options: PROJECT_STATUSES })}
          ${fieldMarkup({ labelKey: "projectEditor.year", name: "year", value: project.year, type: "number", attrs: 'min="1990" max="2100"' })}
          ${fieldMarkup({ labelKey: "projectEditor.projectUrl", name: "projectUrl", value: project.projectUrl, type: "url", hintKey: "projectEditor.projectUrlHint" })}
          <div class="field" data-field="accent">
            <label for="field-accent" data-i18n="projectEditor.accent">${t("projectEditor.accent")}</label>
            <div class="accent-field">
              <input type="color" value="${escapeAttribute(normalizeHexForPicker(accentValue))}" data-accent-picker aria-label="${t("projectEditor.pickAccent")}" data-i18n-aria-label="projectEditor.pickAccent">
              <input id="field-accent" name="accent" type="text" value="${escapeAttribute(accentValue)}" data-accent-text>
            </div>
            <p class="field-error" id="field-accent-error" hidden></p>
          </div>
          <div class="field field--wide editor-locale-row">
            <span class="field-label" data-i18n="projectEditor.editorialCopy">${t("projectEditor.editorialCopy")}</span>
            ${localeTabs("project-general")}
            ${localeHint("project-general")}
          </div>
          <div class="field field--wide" data-field="description">
            <label for="field-description" data-i18n="projectEditor.description">${t("projectEditor.description")}</label>
            <textarea id="field-description" name="description" rows="5">${escapeHtml(project.description)}</textarea>
          </div>
          <div class="field field--wide" data-field="techStack">
            <span class="field-label" id="tech-stack-label" data-i18n="projectEditor.techStack">${t("projectEditor.techStack")}</span>
            <div class="chip-field">
              <div class="chip-list" data-tech-list aria-labelledby="tech-stack-label"></div>
              <div class="chip-input-row">
                <input type="text" data-tech-input placeholder="${t("projectEditor.addTechnology")}" aria-label="${t("projectEditor.addTechnology")}" data-i18n-placeholder="projectEditor.addTechnology" data-i18n-aria-label="projectEditor.addTechnology">
                <button type="button" class="button" data-tech-add data-i18n="projectEditor.addTechnologyButton">${t("projectEditor.addTechnologyButton")}</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="tab-panel" id="panel-presentation" role="tabpanel" aria-labelledby="tab-presentation" hidden>
        <div class="form-grid">
          <div class="field field--wide editor-locale-row">
            <span class="field-label" data-i18n="projectEditor.editorialCopy">${t("projectEditor.editorialCopy")}</span>
            ${localeTabs("project-presentation")}
            ${localeHint("project-presentation")}
          </div>
          ${fieldMarkup({ labelKey: "projectEditor.systemLabel", name: "presentationSystem", value: presentation.system || "", hintKey: "projectEditor.systemLabelHint" })}
          ${fieldMarkup({ labelKey: "projectEditor.viewerLabel", name: "presentationLabel", value: presentation.label || "", hintKey: "projectEditor.viewerLabelHint" })}
          ${fieldMarkup({ labelKey: "projectEditor.address", name: "presentationAddress", value: presentation.address || "", hintKey: "projectEditor.addressHint" })}
          ${fieldMarkup({ labelKey: "projectEditor.type", name: "presentationType", value: presentation.type || "", hintKey: "projectEditor.typeHint" })}
          ${fieldMarkup({ labelKey: "projectEditor.origin", name: "presentationOrigin", value: presentation.origin || "", hintKey: "projectEditor.originHint" })}
          ${fieldMarkup({ labelKey: "projectEditor.latitude", name: "presentationLatitude", value: coordinates[0] || "", hintKey: "projectEditor.latitudeHint" })}
          ${fieldMarkup({ labelKey: "projectEditor.longitude", name: "presentationLongitude", value: coordinates[1] || "", hintKey: "projectEditor.latitudeHint" })}
        </div>

        <section class="module-builder" aria-labelledby="modules-title">
          <div class="module-builder__head">
            <div>
              <span class="field-label" data-i18n="projectEditor.modules">${t("projectEditor.modules")}</span>
              <h3 id="modules-title" data-i18n="projectEditor.viewerModules">${t("projectEditor.viewerModules")}</h3>
            </div>
            <button type="button" class="button" data-module-add data-i18n="projectEditor.addModule">${t("projectEditor.addModule")}</button>
          </div>
          <div class="module-list" data-module-list></div>
        </section>
      </div>

      <div class="tab-panel" id="panel-media" role="tabpanel" aria-labelledby="tab-media" hidden>
        <div class="media-block">
          <span class="field-label" data-i18n="projectEditor.projectPoster">${t("projectEditor.projectPoster")}</span>
          <div class="media-preview">
            <img data-poster-preview src="${escapeAttribute(project.posterDisplayUrl || "")}" alt="${escapeAttribute(t("projectEditor.posterPreviewAlt", { name: project.name || t("projectEditor.project") }))}" ${project.posterDisplayUrl ? "" : "hidden"}>
            <p class="media-preview__empty" data-poster-empty ${project.posterDisplayUrl ? "hidden" : ""} data-i18n="projectEditor.noPoster">${t("projectEditor.noPoster")}</p>
          </div>
          <p class="media-meta">${project.poster ? `${t("projectEditor.path")}: ${escapeHtml(project.poster)}` : t("projectEditor.noStoragePath")}</p>
          <div class="media-actions">
            <button type="button" class="button" data-editor-action data-replace-poster ${isCreate ? "disabled" : ""} data-i18n="projectEditor.replaceImage">${t("projectEditor.replaceImage")}</button>
            <button type="button" class="button button--danger" data-editor-action data-remove-poster ${project.poster ? "" : "hidden"} data-i18n="projectEditor.removePoster">${t("projectEditor.removePoster")}</button>
            <input type="file" accept="${IMAGE_ACCEPT}" data-poster-file hidden>
          </div>
          ${isCreate ? `<p class="field-hint" data-i18n="projectEditor.saveBeforeUpload">${t("projectEditor.saveBeforeUpload")}</p>` : ""}
        </div>

        <div class="media-block">
          <span class="field-label" data-i18n="projectEditor.gallery">${t("projectEditor.gallery")}</span>
          <div class="gallery-grid" data-gallery></div>
          <button type="button" class="button" data-editor-action data-gallery-add ${isCreate ? "disabled" : ""} data-i18n="projectEditor.addImage">${t("projectEditor.addImage")}</button>
          <input type="file" accept="${IMAGE_ACCEPT}" data-gallery-file hidden>
        </div>
      </div>

      <div class="tab-panel" id="panel-live-demo" role="tabpanel" aria-labelledby="tab-live-demo" hidden>
        ${liveDemoMarkup(project)}
      </div>

      <div class="tab-panel" id="panel-publishing" role="tabpanel" aria-labelledby="tab-publishing" hidden>
        <div class="form-grid">
          <fieldset class="field field--wide" data-field="editorialStatus">
            <legend data-i18n="projectEditor.editorialStatus">${t("projectEditor.editorialStatus")}</legend>
            <div class="checks">
              ${EDITORIAL_STATUSES.map((status) => `
                <label>
                  <input type="radio" name="editorialStatus" value="${status}" ${project.editorialStatus === status ? "checked" : ""}>
                  <span data-status-label="${escapeAttribute(status)}">${statusLabel(status)}</span>
                </label>
              `).join("")}
            </div>
          </fieldset>

          <fieldset class="field field--wide">
            <legend data-i18n="common.visibility">${t("common.visibility")}</legend>
            <div class="checks">
              <label><input type="checkbox" name="visible" ${project.visible ? "checked" : ""}> <span data-i18n="projectEditor.showInPortfolio">${t("projectEditor.showInPortfolio")}</span></label>
              <label><input type="checkbox" name="featured" ${project.featured ? "checked" : ""}> <span data-i18n="projectEditor.featuredProject">${t("projectEditor.featuredProject")}</span></label>
            </div>
          </fieldset>
        </div>

        <div class="meta-grid">
          <div><span data-i18n="projectEditor.created">${t("projectEditor.created")}</span><strong>${formatDate(project.createdAt)}</strong></div>
          <div><span data-i18n="projectEditor.lastModified">${t("projectEditor.lastModified")}</span><strong>${formatDate(project.updatedAt)}</strong></div>
          <div><span data-i18n="common.published">${t("common.published")}</span><strong>${formatDate(project.publishedAt)}</strong></div>
        </div>
      </div>
    </form>

    ${isCreate ? "" : `
      <section class="panel danger-zone">
        <header class="panel__head">
          <div>
            <span data-i18n="projectEditor.dangerZone">${t("projectEditor.dangerZone")}</span>
            <h3 data-i18n="projectEditor.irreversibleActions">${t("projectEditor.irreversibleActions")}</h3>
          </div>
        </header>
        <p data-i18n="projectEditor.dangerCopy">${t("projectEditor.dangerCopy")}</p>
        <div class="danger-zone__actions">
          <button type="button" class="button" data-editor-action data-action-archive data-i18n="projectEditor.archiveProject">${t("projectEditor.archiveProject")}</button>
          <button type="button" class="button button--danger" data-editor-action data-action-delete data-i18n="projectEditor.deleteProject">${t("projectEditor.deleteProject")}</button>
        </div>
      </section>
    `}
  `;
}

function bindTabs(form) {
  const tabs = [...form.querySelectorAll('[role="tab"]')];
  const panels = [...form.querySelectorAll('[role="tabpanel"]')];

  function activate(tab) {
    tabs.forEach((item) => {
      const selected = item === tab;
      item.setAttribute("aria-selected", String(selected));
      item.tabIndex = selected ? 0 : -1;
    });
    panels.forEach((panel) => {
      panel.hidden = panel.id !== tab.getAttribute("aria-controls");
    });
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => activate(tab));
    tab.addEventListener("keydown", (event) => {
      let nextIndex = null;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
      else if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = tabs.length - 1;

      if (nextIndex !== null) {
        event.preventDefault();
        tabs[nextIndex].focus();
        activate(tabs[nextIndex]);
      }
    });
  });
}

// Serializes editor actions: while one is running every action button is
// disabled, so a double click can never fire two saves or two deletes.
function createActionRunner() {
  let running = false;

  return async function run(button, busyLabel, task) {
    if (running) return;
    running = true;

    const actions = [...document.querySelectorAll("[data-editor-action]")];
    // Remember which were already disabled (uploads are, while creating) so
    // finishing an action never enables something that should stay off.
    const wasDisabled = actions.map((action) => action.disabled);
    const originalLabel = button?.textContent;
    actions.forEach((action) => {
      action.disabled = true;
    });
    if (button) button.textContent = busyLabel;

    try {
      await task();
    } finally {
      running = false;
      actions.forEach((action, index) => {
        if (action.isConnected) action.disabled = wasDisabled[index];
      });
      if (button?.isConnected) button.textContent = originalLabel;
    }
  };
}

function mount(project, isCreate) {
  const form = document.querySelector("[data-project-editor]");
  if (!form) return;

  const id = project.id;
  // Storage paths are keyed by the database uuid so the RLS policy can map an
  // object back to its project. Mock mode has no uuid and uses the case number.
  const storageOwnerId = project.dbId || project.id;
  let techStack = [...(project.techStack || [])];
  let gallery = [...(project.gallery || [])];
  let modules = [...(project.modules || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  let posterUrl = project.poster || "";
  let slugTouched = Boolean(project.slug);
  let isDirty = false;

  // Which language the editorial fields are currently bound to. pt-BR is the
  // base record; English is a draft held here until the project is saved.
  let editLocale = BASE_LOCALE;
  // Form control name -> the database column the translation is stored under,
  // which is what the public site reads back from translations.en.
  const EDITORIAL_FIELDS = {
    description: "description",
    presentationSystem: "presentation_system",
    presentationLabel: "presentation_label",
    presentationAddress: "presentation_address",
    presentationType: "presentation_type",
  };
  const translationDraft = { ...(project.translations?.[TRANSLATION_LOCALE] ?? {}) };
  const baseDraft = {};
  const originalPosterUrl = project.poster || "";
  const originalGalleryPaths = new Set((project.gallery || []).map((item) => item.path).filter(Boolean));

  // Files replaced or removed in the editor are only deleted from storage once
  // the save succeeds, so cancelling out of the page never destroys an image
  // the record still points at.
  const pendingDeletions = [];

  // Uploads that no saved record points at yet. Leaving the page discards them,
  // otherwise an abandoned edit would leave files nobody can reach.
  const unsavedUploads = new Set();

  const run = createActionRunner();

  // Moves the editorial inputs between the pt-BR record and the English draft.
  // Both sides are kept in memory, so an unsaved translation survives switching
  // back and forth, and nothing is copied from one locale into the other.
  function captureEditorialDraft() {
    Object.entries(EDITORIAL_FIELDS).forEach(([control, column]) => {
      const field = form.elements[control];
      if (!field) return;
      if (editLocale === BASE_LOCALE) baseDraft[control] = field.value;
      else translationDraft[column] = field.value;
    });
  }

  function paintEditorialLocale() {
    const showingBase = editLocale === BASE_LOCALE;
    Object.entries(EDITORIAL_FIELDS).forEach(([control, column]) => {
      const field = form.elements[control];
      if (!field) return;
      if (showingBase) {
        field.value = baseDraft[control] ?? "";
        field.placeholder = "";
      } else {
        field.value = translationDraft[column] ?? "";
        // The Portuguese text is a placeholder only, never written to the
        // record, so an untouched English field keeps the fallback.
        field.placeholder = baseDraft[control] ?? "";
      }
      field.classList.toggle("is-translation", !showingBase);
    });

    form.querySelectorAll("[data-locale-edit]").forEach((button) => {
      const active = button.dataset.localeEdit === editLocale;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    form.querySelectorAll("[data-locale-hint]").forEach((hint) => {
      hint.hidden = showingBase;
    });
    renderModules();
  }

  function setEditLocale(next) {
    if (next === editLocale) return;
    captureEditorialDraft();
    editLocale = next;
    paintEditorialLocale();
  }

  function collectFormValues() {
    const data = Object.fromEntries(new FormData(form).entries());
    captureEditorialDraft();
    // Editorial fields are read from the pt-BR draft rather than the live form,
    // because the form may currently be showing the English translation.
    const base = (control) => String(baseDraft[control] ?? data[control] ?? "");

    // Blank English fields are dropped so an untranslated field stays absent
    // and the public site falls back to pt-BR.
    const projectTranslation = Object.fromEntries(
      Object.values(EDITORIAL_FIELDS)
        .map((column) => [column, String(translationDraft[column] ?? "").trim()])
        .filter(([, value]) => value !== ""),
    );
    const translations = { ...(project.translations ?? {}) };
    if (Object.keys(projectTranslation).length) translations[TRANSLATION_LOCALE] = projectTranslation;
    else delete translations[TRANSLATION_LOCALE];

    return {
      translations,
      name: (data.name || "").trim(),
      slug: (data.slug || "").trim(),
      client: (data.client || "").trim(),
      category: data.category,
      description: base("description"),
      status: data.status,
      year: data.year,
      accent: (data.accent || "").trim(),
      projectUrl: (data.projectUrl || "").trim(),
      previewUrl: (data.previewUrl || "").trim(),
      livePreviewEnabled: Boolean(form.elements.livePreviewEnabled?.checked),
      editorialStatus: data.editorialStatus,
      visible: form.elements.visible.checked,
      featured: form.elements.featured.checked,
      techStack: [...techStack],
      presentation: {
        system: base("presentationSystem").trim(),
        label: base("presentationLabel").trim(),
        address: base("presentationAddress").trim(),
        type: base("presentationType").trim(),
        origin: (data.presentationOrigin || "").trim(),
        coordinates: [data.presentationLatitude, data.presentationLongitude].map((value) => String(value || "").trim()).filter(Boolean),
      },
      modules: modules.map((item, index) => {
        const localized = Object.fromEntries(
          ["title", "description"]
            .map((field) => [field, String(item.translations?.[TRANSLATION_LOCALE]?.[field] ?? "").trim()])
            .filter(([, value]) => value !== ""),
        );
        return {
          id: item.id ?? null,
          position: index,
          code: item.code ?? "",
          title: item.title ?? "",
          description: item.description ?? "",
          translations: Object.keys(localized).length ? { [TRANSLATION_LOCALE]: localized } : {},
        };
      }),
      // displayUrl is a short-lived signed URL that changes on every resolve,
      // so it must stay out of what we save and out of the dirty comparison.
      gallery: gallery.map((item) => ({
        id: item.id ?? null,
        path: item.path,
        alt: item.alt ?? "",
        caption: item.caption ?? "",
      })),
      poster: posterUrl,
    };
  }

  function updateSaveState() {
    const stateEl = document.querySelector("[data-save-state]");
    if (!stateEl) return;
    // In create mode the editorial badge already reads DRAFT; only surface
    // the save-state pill once there is something that could be lost.
    stateEl.hidden = isCreate && !isDirty;
    stateEl.textContent = isDirty ? t("shell.unsavedChanges") : t("common.saved").toUpperCase();
    stateEl.classList.toggle("is-unsaved", isDirty);
    stateEl.classList.toggle("is-saved", !isDirty);
  }

  function fieldContainer(name) {
    return form.querySelector(`[data-field="${name}"]`);
  }

  function clearErrors() {
    form.querySelectorAll(".field-error").forEach((el) => {
      el.hidden = true;
      el.textContent = "";
    });
    form.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
  }

  function clearFieldError(name) {
    const container = fieldContainer(name);
    if (!container) return;
    const errorEl = container.querySelector(".field-error");
    const input = container.querySelector("[aria-invalid]");
    if (errorEl) errorEl.hidden = true;
    input?.removeAttribute("aria-invalid");
  }

  function showErrors(errors, toastMessage = t("projectEditor.fixHighlighted")) {
    clearErrors();
    let firstInvalid = null;

    Object.entries(errors).forEach(([name, message]) => {
      const container = fieldContainer(name);
      const errorEl = container?.querySelector(".field-error");
      const input = container?.querySelector("input, select, textarea");
      if (errorEl) {
        errorEl.textContent = message;
        errorEl.hidden = false;
      }
      if (input) {
        input.setAttribute("aria-invalid", "true");
        if (errorEl) input.setAttribute("aria-describedby", errorEl.id);
        if (!firstInvalid) firstInvalid = input;
      }
    });

    firstInvalid?.focus();
    showToast(toastMessage);
  }

  // Database rejections (a duplicate slug, for instance) belong next to the
  // field that caused them; everything else is a toast.
  function reportFailure(error, fallbackMessage) {
    const dataError = toDataError(error, fallbackMessage);
    if (dataError.field && fieldContainer(dataError.field)) {
      showErrors({ [dataError.field]: dataError.message }, dataError.message);
      return;
    }
    showToast(dataError.message);
  }

  // Overview and Live Demo show values derived from the form, not from the
  // record loaded at mount. Without this they went stale the moment anything
  // was edited: enabling a demo left TEST DEMO disabled until a save+reload.
  //
  // Only the derived nodes are repainted, so focus, dirty state, translations,
  // modules and pending uploads are untouched.
  function refreshProjectSignals() {
    if (!form.isConnected) return;

    const values = collectFormValues();
    const health = projectHealth(values);
    const demo = health.demo;

    const badges = form.querySelector("[data-overview-badges]");
    if (badges) badges.innerHTML = overviewBadgesMarkup(values, health);

    const healthCard = form.querySelector("[data-overview-health]");
    if (healthCard) healthCard.innerHTML = healthCardMarkup(health);

    const demoStatus = form.querySelector("[data-demo-status]");
    if (demoStatus) demoStatus.innerHTML = statusBadge(t(DEMO_LABEL_KEYS[demo]), demo);

    // Toggled rather than re-rendered, so a focused button keeps its focus.
    form.querySelectorAll("[data-action-test-demo], [data-action-demo]").forEach((button) => {
      button.disabled = demo !== "live";
    });

    const openProject = form.querySelector("[data-action-open-project]");
    if (openProject) {
      const href = values.projectUrl || "";
      openProject.href = href || "#";
      openProject.toggleAttribute("aria-disabled", !href);
    }

    applyStaticTranslations(form);
  }

  let signalsTimer = 0;
  function scheduleProjectSignals() {
    window.clearTimeout(signalsTimer);
    signalsTimer = window.setTimeout(refreshProjectSignals, 150);
  }

  function demoModal(values = collectFormValues()) {
    const demo = liveDemoState(values);
    if (demo !== "live") {
      showToast(t("projectEditor.demoUnavailable"));
      return;
    }

    openModal({
      title: t("projectEditor.demoPreviewTitle", { name: values.name || t("projects.untitled") }),
      body: `
        <div class="demo-preview">
          <p>${escapeHtml(values.previewUrl)}</p>
          <iframe src="${escapeAttribute(values.previewUrl)}" title="${escapeAttribute(t("projectEditor.demoIframeTitle", { name: values.name || t("projects.untitled") }))}" loading="lazy"></iframe>
        </div>
      `,
      actions: [
        { label: t("projectEditor.openExternally"), onSelect: () => window.open(values.previewUrl, "_blank", "noopener,noreferrer") },
        { label: t("common.close") },
      ],
    });
  }

  function showReadinessModal(readiness) {
    const row = (item) => `<li>${escapeHtml(t(CHECK_LABEL_KEYS[item.key]))}</li>`;
    openModal({
      title: t("projectEditor.cannotPublishTitle"),
      body: `
        <div class="readiness-modal">
          <p>${escapeHtml(t("projectEditor.cannotPublishBody"))}</p>
          <ul>${readiness.blocking.map(row).join("")}</ul>
          ${readiness.warnings.length ? `<p>${escapeHtml(t("projectEditor.nonBlockingWarnings"))}</p><ul>${readiness.warnings.map(row).join("")}</ul>` : ""}
        </div>
      `,
      actions: [{ label: t("common.close") }],
    });
  }

  const baselineSnapshot = JSON.stringify(collectFormValues());

  function markDirty() {
    isDirty = JSON.stringify(collectFormValues()) !== baselineSnapshot;
    updateSaveState();
    // Debounced: the derived panels follow the form without repainting on
    // every keystroke.
    scheduleProjectSignals();
  }

  bindTabs(form);

  // Entering a tab that shows derived values repaints it immediately, so it is
  // never a debounce behind.
  form.querySelectorAll('[role="tab"][data-tab="overview"], [role="tab"][data-tab="live-demo"]').forEach((tab) => {
    tab.addEventListener("click", refreshProjectSignals);
  });

  // The checkbox and the preview URL drive the demo state directly, so they
  // refresh without waiting for the debounce.
  form.elements.livePreviewEnabled?.addEventListener("change", refreshProjectSignals);
  form.elements.previewUrl?.addEventListener("input", scheduleProjectSignals);

  refreshProjectSignals();

  // Slug auto-generation from the project name until manually edited.
  form.elements.slug.addEventListener("input", () => {
    slugTouched = true;
  });
  form.elements.name.addEventListener("input", () => {
    if (!slugTouched) form.elements.slug.value = slugify(form.elements.name.value);
  });

  // Accent color picker <-> hex text field.
  const accentPicker = form.querySelector("[data-accent-picker]");
  const accentText = form.querySelector("[data-accent-text]");
  accentPicker?.addEventListener("input", () => {
    accentText.value = accentPicker.value;
  });
  accentText?.addEventListener("input", () => {
    if (/^#[0-9a-f]{6}$/i.test(accentText.value)) accentPicker.value = accentText.value;
  });

  // Tech stack chip editor.
  function renderChips() {
    const list = form.querySelector("[data-tech-list]");
    if (!list) return;
    list.innerHTML = techStack.length
      ? techStack
          .map(
            (tech, index) => `
              <span class="chip">${escapeHtml(tech)}<button type="button" data-remove-tech="${index}" aria-label="${escapeAttribute(t("projectEditor.removeTechnology", { tech }))}">&times;</button></span>
            `,
          )
          .join("")
      : `<p class="empty-inline" data-i18n="projectEditor.noTechnologies">${t("projectEditor.noTechnologies")}</p>`;

    list.querySelectorAll("[data-remove-tech]").forEach((btn) => {
      btn.addEventListener("click", () => {
        techStack.splice(Number(btn.dataset.removeTech), 1);
        renderChips();
        markDirty();
      });
    });
  }

  const techInput = form.querySelector("[data-tech-input]");
  const techAddBtn = form.querySelector("[data-tech-add]");

  function addTech() {
    const value = techInput.value.trim();
    if (!value || techStack.some((tech) => tech.toLowerCase() === value.toLowerCase())) {
      techInput.value = "";
      return;
    }
    techStack = [...techStack, value];
    techInput.value = "";
    renderChips();
    markDirty();
  }

  techAddBtn?.addEventListener("click", addTech);
  techInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addTech();
    }
  });
  renderChips();

  function normalizeModule(item = {}, index = modules.length) {
    return {
      id: item.id ?? null,
      position: index,
      code: item.code ?? "",
      title: item.title ?? "",
      description: item.description ?? "",
      // Held on the module so moving or removing one carries its English copy
      // with it, rather than leaving translations aligned to a stale position.
      translations: item.translations ?? {},
    };
  }

  function renderModules() {
    const list = form.querySelector("[data-module-list]");
    if (!list) return;

    modules = modules.map(normalizeModule);
    list.innerHTML = modules.length
      ? modules.map((module, index) => moduleMarkup(module, index, modules.length, editLocale)).join("")
      : `<p class="empty-inline" data-i18n="projectEditor.noModules">${t("projectEditor.noModules")}</p>`;

    list.querySelectorAll("[data-module-field]").forEach((input) => {
      input.addEventListener("input", () => {
        const index = Number(input.dataset.moduleIndex);
        const field = input.dataset.moduleField;
        if (!modules[index] || !field) return;

        if (editLocale === BASE_LOCALE) {
          modules[index] = { ...modules[index], [field]: input.value };
        } else {
          // Only copy is translatable; `code` stays structural and is read-only
          // while the English tab is open.
          if (field === "code") return;
          const existing = modules[index].translations?.[TRANSLATION_LOCALE] ?? {};
          modules[index] = {
            ...modules[index],
            translations: {
              ...(modules[index].translations ?? {}),
              [TRANSLATION_LOCALE]: { ...existing, [field]: input.value },
            },
          };
        }
        markDirty();
      });
    });

    list.querySelectorAll("[data-module-remove]").forEach((button) => {
      button.addEventListener("click", () => {
        modules.splice(Number(button.dataset.moduleRemove), 1);
        renderModules();
        markDirty();
      });
    });

    list.querySelectorAll("[data-module-up]").forEach((button) => {
      button.addEventListener("click", () => {
        const index = Number(button.dataset.moduleUp);
        if (index <= 0) return;
        [modules[index - 1], modules[index]] = [modules[index], modules[index - 1]];
        renderModules();
        markDirty();
      });
    });

    list.querySelectorAll("[data-module-down]").forEach((button) => {
      button.addEventListener("click", () => {
        const index = Number(button.dataset.moduleDown);
        if (index >= modules.length - 1) return;
        [modules[index], modules[index + 1]] = [modules[index + 1], modules[index]];
        renderModules();
        markDirty();
      });
    });
  }

  form.querySelector("[data-module-add]")?.addEventListener("click", () => {
    modules = [
      ...modules,
      normalizeModule({
        code: String(modules.length + 1).padStart(2, "0"),
        title: "",
        description: "",
      }),
    ];
    renderModules();
    markDirty();
  });
  renderModules();

  // Poster: uploaded to storage immediately so it has a durable path. Files it
  // replaces are only deleted once the record is actually saved.
  const posterPreview = form.querySelector("[data-poster-preview]");
  const posterEmpty = form.querySelector("[data-poster-empty]");
  const replacePosterBtn = form.querySelector("[data-replace-poster]");
  const removePosterBtn = form.querySelector("[data-remove-poster]");
  const posterFileInput = form.querySelector("[data-poster-file]");

  function showPoster(displayUrl) {
    if (posterPreview) {
      posterPreview.src = displayUrl || "";
      posterPreview.hidden = !displayUrl;
    }
    if (posterEmpty) posterEmpty.hidden = Boolean(displayUrl);
    if (removePosterBtn) removePosterBtn.hidden = !posterUrl;
  }

  function trackDeletion(path) {
    if (isStoragePath(path)) pendingDeletions.push(path);
  }

  async function cleanupUnsavedMedia() {
    const paths = new Set(unsavedUploads);

    if (posterUrl && posterUrl !== originalPosterUrl && isStoragePath(posterUrl)) {
      paths.add(posterUrl);
    }

    gallery.forEach((item) => {
      if (item.path && !originalGalleryPaths.has(item.path) && isStoragePath(item.path)) {
        paths.add(item.path);
      }
    });

    unsavedUploads.clear();
    await removeProjectImages([...paths]);
  }

  replacePosterBtn?.addEventListener("click", () => posterFileInput.click());
  posterFileInput?.addEventListener("change", () => {
    const [file] = posterFileInput.files || [];
    posterFileInput.value = "";
    if (!file) return;

    run(replacePosterBtn, t("projectEditor.uploading"), async () => {
      try {
        const path = await uploadProjectImage({ projectId: storageOwnerId, kind: "poster", file });
        unsavedUploads.add(path);
        trackDeletion(posterUrl);
        posterUrl = path;
        showPoster(await resolveImageUrl(path));
        await logActivity("Poster uploaded", `${file.name} uploaded for CASE ${project.caseNumber}`, {
          action: "media.uploaded",
          entityType: "media",
          entityId: id,
        });
        showToast(t("projectEditor.posterUploaded"));
        markDirty();
      } catch (error) {
        showToast(describeError(error, t("projectEditor.uploadImageError")));
      }
    });
  });

  removePosterBtn?.addEventListener("click", () => {
    trackDeletion(posterUrl);
    posterUrl = "";
    showPoster("");
    showToast(t("projectEditor.posterRemoved"));
    markDirty();
  });

  // Gallery: same contract as the poster. The storage path is the stable key,
  // because a freshly uploaded image has no database id until the next save.
  function renderGallery() {
    const grid = form.querySelector("[data-gallery]");
    if (!grid) return;

    grid.innerHTML = gallery.length
      ? gallery
          .map(
            (item) => `
              <figure class="gallery-item">
                <img src="${escapeAttribute(item.displayUrl || "")}" alt="${escapeAttribute(item.alt || "")}">
                <button type="button" data-remove-gallery="${escapeAttribute(item.path)}" aria-label="${escapeAttribute(t("projectEditor.removeImage"))}">&times;</button>
              </figure>
            `,
          )
          .join("")
      : `<p class="empty-inline" data-i18n="projectEditor.noGalleryImages">${t("projectEditor.noGalleryImages")}</p>`;

    grid.querySelectorAll("[data-remove-gallery]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const path = btn.dataset.removeGallery;
        trackDeletion(path);
        gallery = gallery.filter((item) => item.path !== path);
        renderGallery();
        markDirty();
      });
    });
  }

  const galleryAddBtn = form.querySelector("[data-gallery-add]");
  const galleryFileInput = form.querySelector("[data-gallery-file]");
  galleryAddBtn?.addEventListener("click", () => galleryFileInput.click());
  galleryFileInput?.addEventListener("change", () => {
    const [file] = galleryFileInput.files || [];
    galleryFileInput.value = "";
    if (!file) return;

    run(galleryAddBtn, t("projectEditor.uploading"), async () => {
      try {
        const path = await uploadProjectImage({ projectId: storageOwnerId, kind: "gallery", file });
        unsavedUploads.add(path);
        gallery = [...gallery, { id: null, path, alt: "", caption: "", displayUrl: await resolveImageUrl(path) }];
        renderGallery();
        await logActivity("Gallery image uploaded", `${file.name} uploaded for CASE ${project.caseNumber}`, {
          action: "media.uploaded",
          entityType: "media",
          entityId: id,
        });
        showToast(t("projectEditor.imageAdded"));
        markDirty();
      } catch (error) {
        showToast(describeError(error, t("projectEditor.uploadImageError")));
      }
    });
  });
  renderGallery();
  posterPreview?.addEventListener("error", () => {
    posterPreview.hidden = true;
    if (posterEmpty) {
      posterEmpty.textContent = t("projectEditor.posterPreviewUnavailable");
      posterEmpty.hidden = false;
    }
  });
  showPoster(project.posterDisplayUrl || "");

  form.addEventListener("input", (event) => {
    const container = event.target.closest("[data-field]");
    if (container?.dataset.field) clearFieldError(container.dataset.field);
    markDirty();
  });
  form.addEventListener("change", markDirty);

  updateSaveState();
  setNavigationGuard(
    () => isDirty,
    () => {
      return cleanupUnsavedMedia();
    },
  );

  async function handleCreate() {
    const values = collectFormValues();
    const errors = validate(values);
    if (Object.keys(errors).length) {
      showErrors(errors);
      return;
    }
    clearErrors();

    try {
      const created = await createProject({ ...values, caseNumber: form.elements.caseNumber.value });
      showToast(t("projectEditor.projectCreated"));
      isDirty = false;
      clearNavigationGuard();
      window.location.hash = `#/projects/${created.id}`;
    } catch (error) {
      reportFailure(error, t("projectEditor.createError"));
    }
  }

  async function handleSave() {
    const values = collectFormValues();
    const errors = validate(values);
    if (Object.keys(errors).length) {
      showErrors(errors);
      return;
    }
    clearErrors();

    try {
      const updated = await updateProject(id, values);
      unsavedUploads.clear();
      await removeProjectImages(pendingDeletions.splice(0));
      showToast(t("projectEditor.changesSaved"));
      await loadEditor(updated.id);
    } catch (error) {
      reportFailure(error, t("projectEditor.saveError"));
    }
  }

  async function handlePublish() {
    const values = { ...collectFormValues(), editorialStatus: "PUBLISHED" };
    const errors = validate(values);
    if (Object.keys(errors).length) {
      showErrors(errors);
      return;
    }
    clearErrors();

    const readiness = publishReadiness(values);
    if (!readiness.canPublish) {
      showReadinessModal(readiness);
      return;
    }

    try {
      const updated = await updateProject(id, values);
      unsavedUploads.clear();
      await removeProjectImages(pendingDeletions.splice(0));
      showToast(t("projectEditor.projectPublished"));
      await loadEditor(updated.id);
    } catch (error) {
      reportFailure(error, t("projectEditor.publishError"));
    }
  }

  async function handleArchive() {
    const confirmed = await confirmModal({
      title: t("projectEditor.archiveTitle", { caseNumber: project.caseNumber }),
      body: `<p>${escapeHtml(t("projectEditor.archiveBody"))}</p>`,
      confirmLabel: t("projectEditor.archiveProject"),
      danger: false,
    });
    if (!confirmed) return;

    try {
      await archiveProject(id);
      showToast(t("projectEditor.projectArchived"));
      await loadEditor(id);
    } catch (error) {
      reportFailure(error, t("projectEditor.archiveError"));
    }
  }

  async function handleDelete() {
    const confirmed = await confirmModal({
      title: t("projectEditor.deleteTitle", { caseNumber: project.caseNumber }),
      body: `<p>${escapeHtml(t("projectEditor.deleteBody"))}</p>`,
      confirmLabel: t("projectEditor.deleteProject"),
    });
    if (!confirmed) return;

    try {
      await deleteProject(id);
      showToast(t("projectEditor.projectDeleted"));
      isDirty = false;
      clearNavigationGuard();
      window.location.hash = "#/projects";
    } catch (error) {
      reportFailure(error, t("projectEditor.deleteError"));
    }
  }

  function handlePreview() {
    const values = collectFormValues();
    openModal({
      title: t("projectEditor.previewTitle", { caseNumber: form.elements.caseNumber.value }),
      body: `
        <div class="preview-card">
          ${values.poster ? `<img src="${escapeAttribute(values.poster)}" alt="">` : ""}
          <h3>${escapeHtml(values.name || t("projects.untitled"))}</h3>
          <p>${escapeHtml(values.description || t("projectEditor.noDescription"))}</p>
          <dl>
            <div><dt data-i18n="common.category">${t("common.category")}</dt><dd>${escapeHtml(statusLabel(values.category))}</dd></div>
            <div><dt data-i18n="common.status">${t("common.status")}</dt><dd>${escapeHtml(statusLabel(values.status))}</dd></div>
            <div><dt data-i18n="projectEditor.techStack">${t("projectEditor.techStack")}</dt><dd>${values.techStack.map((tech) => escapeHtml(tech)).join(", ") || "—"}</dd></div>
          </dl>
        </div>
      `,
      actions: [{ label: t("common.close") }],
    });
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (isCreate) {
      run(form.querySelector("[data-action-create]"), t("projectEditor.creating"), handleCreate);
    } else {
      run(form.querySelector("[data-action-save]"), t("projectEditor.saving"), handleSave);
    }
  });

  const publishBtn = form.querySelector("[data-action-publish]");
  publishBtn?.addEventListener("click", () => run(publishBtn, t("projectEditor.publishingProgress"), handlePublish));
  form.querySelector("[data-action-overview-publish]")?.addEventListener("click", (event) => {
    const button = event.currentTarget;
    run(button, t("projectEditor.publishingProgress"), handlePublish);
  });

  form.querySelector("[data-action-preview]")?.addEventListener("click", handlePreview);
  form.querySelector("[data-action-demo]")?.addEventListener("click", () => demoModal());
  form.querySelector("[data-action-test-demo]")?.addEventListener("click", () => demoModal());

  const archiveBtn = document.querySelector("[data-action-archive]");
  archiveBtn?.addEventListener("click", () => run(archiveBtn, t("projectEditor.archiving"), handleArchive));

  const deleteBtn = document.querySelector("[data-action-delete]");
  deleteBtn?.addEventListener("click", () => run(deleteBtn, t("projectEditor.deleting"), handleDelete));

  // Seed the pt-BR side from the rendered form, then wire both tab groups to
  // the one editLocale so they always agree.
  Object.keys(EDITORIAL_FIELDS).forEach((control) => {
    const field = form.elements[control];
    if (field) baseDraft[control] = field.value;
  });
  form.querySelectorAll("[data-locale-edit]").forEach((button) => {
    button.addEventListener("click", () => setEditLocale(button.dataset.localeEdit));
  });
  paintEditorialLocale();

  const unsubscribe = subscribeLocaleChange(() => {
    if (!form.isConnected) {
      unsubscribe();
      return;
    }
    form.querySelectorAll("select").forEach(updateSelectLabels);
    document.querySelectorAll("[data-status-label]").forEach((node) => {
      node.textContent = statusLabel(node.dataset.statusLabel);
    });
    const meta = document.querySelector("[data-editor-meta]");
    if (meta) meta.textContent = `${statusLabel(meta.dataset.category)} / ${statusLabel(meta.dataset.status)}`;
    const breadcrumb = document.querySelector("[data-editor-breadcrumb]");
    if (breadcrumb) breadcrumb.textContent = isCreate ? t("projectEditor.newBreadcrumb") : t("projectEditor.caseBreadcrumb", { caseNumber: project.caseNumber });
    renderChips();
    captureEditorialDraft();
    paintEditorialLocale();
    renderGallery();
    updateSaveState();
    // Overview badges, the health checks and the demo state are rendered from
    // dictionary values, so they have to be rebuilt too. Without this they kept
    // the previous language until something was edited or a tab was reopened.
    refreshProjectSignals();
    applyStaticTranslations(document);
  });
}

function loadingMarkup() {
  return `
    <section class="empty-state" aria-busy="true">
      <span>PROJECT</span>
      <h2 data-i18n="projectEditor.loadingProject">${t("projectEditor.loadingProject")}</h2>
    </section>
  `;
}

function notFoundMarkup(id) {
  return `
    <section class="empty-state">
      <span>CASE / ${escapeHtml(id)}</span>
      <h2 data-i18n="projectEditor.notFound">${t("projectEditor.notFound")}</h2>
      <p data-i18n="projectEditor.notFoundBody">${t("projectEditor.notFoundBody")}</p>
      <a class="button" href="#/projects" data-i18n="projectEditor.backToProjects">${t("projectEditor.backToProjects")}</a>
    </section>
  `;
}

function errorMarkup(message) {
  return `
    <section class="empty-state">
      <span>ERROR</span>
      <h2>${escapeHtml(message)}</h2>
      <button class="button" type="button" data-retry-editor data-i18n="projectEditor.tryAgain">${t("projectEditor.tryAgain")}</button>
    </section>
  `;
}

async function loadEditor(id) {
  const root = document.querySelector("[data-editor-root]");
  if (!root) return;

  // Saving re-renders the editor; keep the reader where they were instead of
  // throwing them back to the first tab.
  const previousTab = document.querySelector('[role="tab"][aria-selected="true"]')?.dataset.tab;

  const isCreate = id === "new";
  root.innerHTML = loadingMarkup();

  try {
    let project;

    if (isCreate) {
      project = blankProject(await nextAvailableCaseNumber());
    } else {
      project = await getProjectById(id);
      if (!root.isConnected) return;
      if (!project) {
        clearNavigationGuard();
        root.innerHTML = notFoundMarkup(id);
        return;
      }
    }

    // Stored values are storage paths; turn them into something an <img> can
    // actually load before rendering.
    project.posterDisplayUrl = await resolveImageUrl(project.poster);
    project.gallery = await resolveGalleryUrls(project.gallery);

    if (!root.isConnected) return;
    root.innerHTML = renderEditor(project, isCreate);
    mount(project, isCreate);

    if (previousTab) root.querySelector(`[role="tab"][data-tab="${previousTab}"]`)?.click();
  } catch (error) {
    if (!root.isConnected) return;
    clearNavigationGuard();
    root.innerHTML = errorMarkup(describeError(error, t("projectEditor.loadError")));
    root.querySelector("[data-retry-editor]")?.addEventListener("click", () => loadEditor(id));
  }
}

export const projectEditorPage = {
  title: () => t("projectEditor.title"),
  breadcrumb: () => t("projectEditor.breadcrumb"),
  render: () => `<div data-editor-root>${loadingMarkup()}</div>`,
  afterRender: ({ id }) => loadEditor(id),
};
