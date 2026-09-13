import { confirmModal, openModal } from "../components/modal.js";
import { showToast } from "../components/toast.js";
import { BASE_LOCALE, TRANSLATION_LOCALE, bindLocaleFields, localeFieldAttrs, localeHint, localeTabs } from "../components/locale-fields.js";
import { publicSiteUrl } from "../config/public-site.js";
import { applyStaticTranslations, onLocaleChange, plural, statusLabel, t } from "../i18n/index.js";
import { clearNavigationGuard, setNavigationGuard } from "../router/router.js";
import { logActivity } from "../services/activity-service.js";
import { describeError, toDataError } from "../services/errors.js";
import {
  SERVICE_STATUSES,
  archivePlan,
  createPlan,
  duplicatePlan,
  getPlan,
  newPlanDefaults,
  slugifyPlan,
  unarchivePlan,
  updatePlan,
} from "../services/plan-service.js";
import { contentCompleteness, serviceHealth, serviceReadiness } from "../utils/service-health.js";
import { escapeAttribute, escapeHtml } from "../utils/html.js";

const SCOPE = "service-editor";

function uiKey() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeHex(hex) {
  if (/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  if (/^#[0-9a-f]{3}$/i.test(hex)) return `#${hex.slice(1).split("").map((item) => item + item).join("")}`;
  return "#c6ff00";
}

function formatDate(iso) {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString(document.documentElement.lang || undefined, { dateStyle: "medium", timeStyle: "short" });
}

function fieldMarkup({ labelKey, name, value = "", type = "text", attrs = "", translatable = false, rows = 3, hintKey = "" }) {
  const id = `field-${name}`;
  const localeAttrs = translatable ? ` ${localeFieldAttrs(SCOPE, name)}` : "";
  const control =
    type === "textarea"
      ? `<textarea id="${id}" name="${name}" rows="${rows}"${localeAttrs} ${attrs}>${escapeHtml(value)}</textarea>`
      : `<input id="${id}" name="${name}" type="${type}" value="${escapeAttribute(value)}"${localeAttrs} ${attrs}>`;
  return `
    <div class="field${type === "textarea" ? " field--wide" : ""}" data-field="${escapeAttribute(name)}">
      <label for="${id}" data-i18n="${labelKey}">${escapeHtml(t(labelKey))}</label>
      ${control}
      ${hintKey ? `<p class="field-hint" data-i18n="${hintKey}">${escapeHtml(t(hintKey))}</p>` : ""}
      <p class="field-error" id="${id}-error" hidden></p>
    </div>
  `;
}

function selectMarkup({ labelKey, name, value, options }) {
  return `
    <div class="field" data-field="${escapeAttribute(name)}">
      <label for="field-${name}" data-i18n="${labelKey}">${escapeHtml(t(labelKey))}</label>
      <select id="field-${name}" name="${name}">
        ${options.map((option) => `<option value="${escapeAttribute(option)}" ${option === value ? "selected" : ""}>${escapeHtml(statusLabel(option))}</option>`).join("")}
      </select>
      <p class="field-error" id="field-${name}-error" hidden></p>
    </div>
  `;
}

function statusBadge(label, state) {
  const type = state === "healthy" ? "success" : state === "attention" ? "warning" : state === "incomplete" ? "muted" : "neutral";
  return `<span class="badge badge--${type}">${escapeHtml(label)}</span>`;
}

function healthChecksMarkup(health) {
  return `
    <div class="health-checks">
      ${health.checks
        .map(
          (item) => `
            <div class="health-check health-check--${item.ok ? "ok" : item.severity}">
              <span aria-hidden="true">${item.ok ? "OK" : "!"}</span>
              <strong>${escapeHtml(t(`serviceHealth.checks.${item.key}`))}</strong>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function overviewMarkup(plan) {
  const health = serviceHealth(plan);
  const completeness = health.completeness;
  const publicUrl = publicSiteUrl("#plans");
  return `
    <div class="project-overview service-overview">
      <section class="overview-hero">
        <div>
          <span>${escapeHtml(plan.slug || t("services.newService"))}</span>
          <h3 data-overview-title>${escapeHtml(plan.name || t("services.untitledPlan"))}</h3>
        </div>
        <div class="overview-badges" data-service-badges>
          ${statusBadge(statusLabel(plan.status).toUpperCase(), health.status)}
          ${statusBadge(plan.visible ? t("common.visible") : t("common.hidden"), plan.visible ? "healthy" : "neutral")}
          ${statusBadge(t("serviceHealth.content.pt", { percent: completeness.pt.percent }), completeness.pt.percent === 100 ? "healthy" : "attention")}
          ${statusBadge(t("serviceHealth.content.en", { percent: completeness.en.percent }), completeness.en.percent === 100 ? "healthy" : "attention")}
          ${statusBadge(plural("services.featureCount", (plan.features || []).length), (plan.features || []).length ? "healthy" : "incomplete")}
        </div>
      </section>
      <section class="overview-grid">
        <article class="overview-card">
          <span>${escapeHtml(t("serviceHealth.title"))}</span>
          <div data-service-health>
            <strong>${escapeHtml(t("serviceHealth.score", { score: health.score, total: health.total }))}</strong>
            ${statusBadge(t(`serviceHealth.status.${health.status}`), health.status)}
            ${healthChecksMarkup(health)}
          </div>
        </article>
        <article class="overview-card">
          <span>${escapeHtml(t("services.quickActions"))}</span>
          <div class="overview-actions">
            <button type="submit" class="button" data-editor-action data-action-overview-save>${escapeHtml(t("common.save"))}</button>
            <a class="button" href="${escapeAttribute(publicUrl)}" target="_blank" rel="noreferrer">${escapeHtml(t("services.actionViewPublic"))}</a>
            <button type="button" class="button" data-editor-action data-action-duplicate ${plan.id ? "" : "hidden"}>${escapeHtml(t("services.actionDuplicate"))}</button>
            <button type="button" class="button" data-editor-action data-action-archive ${plan.id ? "" : "hidden"}>${escapeHtml(plan.status === "ARCHIVED" ? t("services.actionUnarchive") : t("services.actionArchive"))}</button>
          </div>
        </article>
      </section>
    </div>
  `;
}

function featureMarkup(feature, index, total) {
  const translated = feature.translations?.[TRANSLATION_LOCALE]?.text ?? "";
  const showingBase = feature.editLocale !== TRANSLATION_LOCALE;
  const value = showingBase ? feature.text ?? "" : translated;
  const placeholder = showingBase ? "" : feature.text ?? "";
  return `
    <article class="feature-row service-feature-row" data-feature-key="${escapeAttribute(feature.uiKey)}">
      <span>${String(index + 1).padStart(2, "0")}</span>
      <input type="text" value="${escapeAttribute(value)}" data-feature-text="${escapeAttribute(feature.uiKey)}" ${placeholder ? `placeholder="${escapeAttribute(placeholder)}"` : ""} ${showingBase ? "" : 'class="is-translation"'} aria-label="${escapeAttribute(t("services.featureText"))}">
      <div class="feature-row__actions">
        <button type="button" class="button button--compact" data-feature-up="${escapeAttribute(feature.uiKey)}" ${index === 0 ? "disabled" : ""}>${escapeHtml(t("services.moveUp"))}</button>
        <button type="button" class="button button--compact" data-feature-down="${escapeAttribute(feature.uiKey)}" ${index === total - 1 ? "disabled" : ""}>${escapeHtml(t("services.moveDown"))}</button>
        <button type="button" class="button button--compact" data-feature-duplicate="${escapeAttribute(feature.uiKey)}">${escapeHtml(t("services.actionDuplicate"))}</button>
        <button type="button" class="button button--danger button--compact" data-feature-remove="${escapeAttribute(feature.uiKey)}">${escapeHtml(t("services.remove"))}</button>
      </div>
    </article>
  `;
}

function previewMarkup(plan) {
  const featureItems = (plan.features || []).filter((feature) => feature.text.trim()).slice(0, 5);
  return `
    <aside class="service-preview" data-service-preview style="--preview-accent:${escapeAttribute(plan.accent || "#c6ff00")}">
      <div class="plan-card">
        <div class="plan-card__top"><span>${escapeHtml(statusLabel(plan.status))}</span><strong>${escapeHtml(plan.monogram || (plan.name || "SU").slice(0, 2).toUpperCase())}</strong></div>
        <div class="plan-card__body">
          <span class="plan-card__eyebrow">${escapeHtml(plan.scopeShort || t("services.plan"))}</span>
          <strong class="plan-card__name">${escapeHtml(plan.name || t("services.untitledPlan"))}</strong>
          <span class="plan-card__range">${escapeHtml(plan.range || t("services.rangePending"))}</span>
          <p>${escapeHtml(plan.description || t("services.noPublicDescription"))}</p>
        </div>
        <ul>
          ${featureItems.length ? featureItems.map((feature) => `<li>${escapeHtml(feature.text)}</li>`).join("") : `<li>${escapeHtml(t("services.noFeatures"))}</li>`}
        </ul>
        <div class="plan-card__footer"><span>${escapeHtml(plan.timeline || t("services.timelinePending"))}</span><span>${escapeHtml(plan.visible ? t("common.visible") : t("common.hidden"))}</span></div>
      </div>
    </aside>
  `;
}

function renderEditor(plan, isCreate) {
  const activeTab = "overview";
  return `
    <section class="page-heading page-heading--split">
      <div>
        <span data-editor-breadcrumb>${escapeHtml(isCreate ? t("services.newBreadcrumb") : t("services.editorBreadcrumb"))}</span>
        <h2 data-i18n="services.editorHeading">${escapeHtml(t("services.editorHeading"))}</h2>
        <div class="editor-identity">
          <strong class="editor-identity__name">${escapeHtml(plan.name || t("services.untitledPlan"))}</strong>
          <span class="editor-identity__meta">${escapeHtml(statusLabel(plan.status))} / ${escapeHtml(plan.visible ? t("common.visible") : t("common.hidden"))}</span>
          <span class="save-state is-saved" data-save-state ${isCreate ? "hidden" : ""}>${escapeHtml(t("common.saved").toUpperCase())}</span>
        </div>
      </div>
      <div class="heading-actions">
        <a class="button" href="#/services" data-i18n="services.allServices">${escapeHtml(t("services.allServices"))}</a>
      </div>
    </section>
    <form class="editor-form service-editor-grid" data-service-editor data-service-id="${escapeAttribute(plan.id || "")}" data-mode="${isCreate ? "create" : "edit"}" novalidate>
      <div class="service-editor-main">
        <div class="editor-toolbar">
          <button type="submit" class="button button--primary" data-editor-action data-action-save>${escapeHtml(isCreate ? t("services.createService") : t("services.saveChanges"))}</button>
        </div>
        <div class="tabs" role="tablist" aria-label="${escapeAttribute(t("services.editorSections"))}">
          ${[
            ["overview", "services.tabOverview"],
            ["commercial", "services.tabCommercial"],
            ["content", "services.tabContent"],
            ["features", "services.tabFeatures"],
            ["publishing", "services.tabPublishing"],
          ]
            .map(([tab, key]) => `<button type="button" role="tab" id="tab-${tab}" aria-selected="${activeTab === tab}" aria-controls="panel-${tab}" data-tab="${tab}" tabindex="${activeTab === tab ? "0" : "-1"}">${escapeHtml(t(key))}</button>`)
            .join("")}
        </div>
        <div class="tab-panel" id="panel-overview" role="tabpanel" aria-labelledby="tab-overview">
          ${overviewMarkup(plan)}
        </div>
        <div class="tab-panel" id="panel-commercial" role="tabpanel" aria-labelledby="tab-commercial" hidden>
          <div class="form-grid">
            ${fieldMarkup({ labelKey: "services.name", name: "name", value: plan.name, attrs: "required" })}
            ${fieldMarkup({ labelKey: "services.slug", name: "slug", value: plan.slug, attrs: "required", hintKey: "services.slugHint" })}
            ${fieldMarkup({ labelKey: "services.range", name: "range", value: plan.range })}
            ${selectMarkup({ labelKey: "services.status", name: "status", value: plan.status, options: SERVICE_STATUSES })}
            <div class="field" data-field="accent">
              <label for="field-accent" data-i18n="services.accent">${escapeHtml(t("services.accent"))}</label>
              <div class="accent-field">
                <input type="color" value="${escapeAttribute(normalizeHex(plan.accent))}" data-accent-picker aria-label="${escapeAttribute(t("services.pickAccent"))}">
                <input id="field-accent" name="accent" type="text" value="${escapeAttribute(plan.accent || "#c6ff00")}" data-accent-text>
              </div>
              <p class="field-error" id="field-accent-error" hidden></p>
            </div>
            ${fieldMarkup({ labelKey: "services.position", name: "position", value: plan.position, type: "number", attrs: 'min="0"' })}
          </div>
        </div>
        <div class="tab-panel" id="panel-content" role="tabpanel" aria-labelledby="tab-content" hidden>
          <div class="field field--wide editor-locale-row">
            <span class="field-label" data-i18n="services.editorialCopy">${escapeHtml(t("services.editorialCopy"))}</span>
            ${localeTabs(SCOPE)}
            ${localeHint(SCOPE)}
          </div>
          <div class="form-grid">
            ${fieldMarkup({ labelKey: "services.timeline", name: "timeline", value: plan.timeline, translatable: true })}
            ${fieldMarkup({ labelKey: "services.scope", name: "scope", value: plan.scope, translatable: true })}
            ${fieldMarkup({ labelKey: "services.scopeShort", name: "scopeShort", value: plan.scopeShort, translatable: true })}
            ${fieldMarkup({ labelKey: "services.description", name: "description", value: plan.description, type: "textarea", rows: 5, translatable: true })}
          </div>
        </div>
        <div class="tab-panel" id="panel-features" role="tabpanel" aria-labelledby="tab-features" hidden>
          <div class="field field--wide editor-locale-row">
            <span class="field-label" data-i18n="services.editorialCopy">${escapeHtml(t("services.editorialCopy"))}</span>
            ${localeTabs(SCOPE)}
            ${localeHint(SCOPE)}
          </div>
          <div class="module-builder service-feature-builder">
            <div class="module-builder__head">
              <div>
                <span class="field-label" data-i18n="services.features">${escapeHtml(t("services.features"))}</span>
                <h3 data-feature-count>${escapeHtml(plural("services.featureCount", (plan.features || []).length))}</h3>
              </div>
              <button type="button" class="button" data-feature-add>${escapeHtml(t("services.addFeature"))}</button>
            </div>
            <div class="feature-list" data-feature-list></div>
          </div>
        </div>
        <div class="tab-panel" id="panel-publishing" role="tabpanel" aria-labelledby="tab-publishing" hidden>
          <div class="form-grid">
            <fieldset class="field field--wide">
              <legend data-i18n="services.visibility">${escapeHtml(t("services.visibility"))}</legend>
              <div class="checks">
                <label><input type="checkbox" name="visible" ${plan.visible ? "checked" : ""}> <span data-i18n="services.showOnPublicSite">${escapeHtml(t("services.showOnPublicSite"))}</span></label>
              </div>
            </fieldset>
          </div>
          <div class="meta-grid">
            <div><span data-i18n="services.created">${escapeHtml(t("services.created"))}</span><strong>${escapeHtml(formatDate(plan.createdAt))}</strong></div>
            <div><span data-i18n="services.lastModified">${escapeHtml(t("services.lastModified"))}</span><strong>${escapeHtml(formatDate(plan.updatedAt))}</strong></div>
          </div>
        </div>
      </div>
      ${previewMarkup(plan)}
    </form>
  `;
}

function bindTabs(form) {
  const tabs = [...form.querySelectorAll('[role="tab"]')];
  const panels = [...form.querySelectorAll('[role="tabpanel"]')];
  function activate(tab) {
    tabs.forEach((item) => {
      const active = item === tab;
      item.setAttribute("aria-selected", String(active));
      item.tabIndex = active ? 0 : -1;
    });
    panels.forEach((panel) => {
      panel.hidden = panel.id !== tab.getAttribute("aria-controls");
    });
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => activate(tab));
    tab.addEventListener("keydown", (event) => {
      const keys = { ArrowRight: 1, ArrowLeft: -1, Home: -index, End: tabs.length - index - 1 };
      if (!(event.key in keys)) return;
      event.preventDefault();
      const next = (index + keys[event.key] + tabs.length) % tabs.length;
      tabs[next].focus();
      activate(tabs[next]);
    });
  });
}

function mount(plan, isCreate) {
  const form = document.querySelector("[data-service-editor]");
  if (!form) return;

  let features = [...(plan.features || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map((feature) => ({ ...feature, uiKey: feature.uiKey || uiKey() }));
  let slugTouched = Boolean(plan.slug);
  let dirty = false;
  let controller = null;
  let featureLocale = BASE_LOCALE;

  const initialTranslations = { ...(plan.translations?.[TRANSLATION_LOCALE] ?? {}) };

  function captureFeatureDrafts() {
    form.querySelectorAll("[data-feature-text]").forEach((input) => {
      const index = features.findIndex((feature) => feature.uiKey === input.dataset.featureText);
      if (index < 0) return;
      if (featureLocale === TRANSLATION_LOCALE) {
        const current = features[index].translations?.[TRANSLATION_LOCALE] ?? {};
        features[index] = { ...features[index], translations: { ...(features[index].translations ?? {}), [TRANSLATION_LOCALE]: { ...current, text: input.value } } };
      } else {
        features[index] = { ...features[index], text: input.value };
      }
    });
  }

  function collectValues() {
    captureFeatureDrafts();
    const data = Object.fromEntries(new FormData(form).entries());
    const base = controller?.baseValues() ?? {};
    const translated = controller?.translationDraftValues?.() ?? controller?.translationValues() ?? {};
    const featureValues = features.map((feature, index) => {
      const text = String(feature.text ?? "").trim();
      const enText = String(feature.translations?.[TRANSLATION_LOCALE]?.text ?? "").trim();
      return {
        id: feature.id ?? null,
        position: index,
        text,
        translations: enText ? { [TRANSLATION_LOCALE]: { text: enText } } : {},
      };
    });
    const planTranslation = Object.fromEntries(
      ["timeline", "scope", "scopeShort", "description"]
        .map((field) => [field, String(translated[field] ?? "").trim()])
        .filter(([field, value]) => {
          const dbField = field === "scopeShort" ? "scope_short" : field;
          return value || initialTranslations[field] !== undefined || initialTranslations[dbField] !== undefined;
        }),
    );
    return {
      name: String(data.name || "").trim(),
      slug: String(data.slug || "").trim(),
      range: String(data.range || "").trim(),
      status: data.status || "UNAVAILABLE",
      accent: String(data.accent || "#c6ff00").trim(),
      position: Number(data.position) || 0,
      timeline: String(base.timeline ?? data.timeline ?? "").trim(),
      scope: String(base.scope ?? data.scope ?? "").trim(),
      scopeShort: String(base.scopeShort ?? data.scopeShort ?? "").trim(),
      description: String(base.description ?? data.description ?? "").trim(),
      visible: Boolean(form.elements.visible?.checked),
      features: featureValues,
      translations: Object.keys(planTranslation).length ? { [TRANSLATION_LOCALE]: planTranslation } : {},
    };
  }

  function updateSaveState() {
    const node = document.querySelector("[data-save-state]");
    if (!node) return;
    node.hidden = isCreate && !dirty;
    node.textContent = dirty ? t("shell.unsavedChanges") : t("common.saved").toUpperCase();
    node.classList.toggle("is-unsaved", dirty);
    node.classList.toggle("is-saved", !dirty);
  }

  function healthCard(planValues) {
    const health = serviceHealth(planValues);
    return `
      <strong>${escapeHtml(t("serviceHealth.score", { score: health.score, total: health.total }))}</strong>
      ${statusBadge(t(`serviceHealth.status.${health.status}`), health.status)}
      ${healthChecksMarkup(health)}
    `;
  }

  function badges(planValues) {
    const health = serviceHealth(planValues);
    const completeness = health.completeness;
    return `
      ${statusBadge(statusLabel(planValues.status).toUpperCase(), health.status)}
      ${statusBadge(planValues.visible ? t("common.visible") : t("common.hidden"), planValues.visible ? "healthy" : "neutral")}
      ${statusBadge(t("serviceHealth.content.pt", { percent: completeness.pt.percent }), completeness.pt.percent === 100 ? "healthy" : "attention")}
      ${statusBadge(t("serviceHealth.content.en", { percent: completeness.en.percent }), completeness.en.percent === 100 ? "healthy" : "attention")}
      ${statusBadge(plural("services.featureCount", planValues.features.length), planValues.features.length ? "healthy" : "incomplete")}
    `;
  }

  function refreshSignals() {
    const values = collectValues();
    const title = document.querySelector("[data-overview-title]");
    if (title) title.textContent = values.name || t("services.untitledPlan");
    const healthNode = document.querySelector("[data-service-health]");
    if (healthNode) healthNode.innerHTML = healthCard(values);
    const badgesNode = document.querySelector("[data-service-badges]");
    if (badgesNode) badgesNode.innerHTML = badges(values);
    const preview = document.querySelector("[data-service-preview]");
    if (preview) preview.outerHTML = previewMarkup(values);
    const identityName = document.querySelector(".editor-identity__name");
    if (identityName) identityName.textContent = values.name || t("services.untitledPlan");
    const identityMeta = document.querySelector(".editor-identity__meta");
    if (identityMeta) identityMeta.textContent = `${statusLabel(values.status)} / ${values.visible ? t("common.visible") : t("common.hidden")}`;
    applyStaticTranslations(document);
  }

  let refreshTimer = 0;
  function scheduleRefresh() {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(refreshSignals, 120);
  }

  const baseline = () => JSON.stringify(collectValues());
  let savedSnapshot = "";

  function markDirty() {
    dirty = baseline() !== savedSnapshot;
    updateSaveState();
    scheduleRefresh();
  }

  function renderFeatures({ capture = true } = {}) {
    controller?.baseValues();
    controller?.translationValues();
    if (capture) captureFeatureDrafts();
    const list = form.querySelector("[data-feature-list]");
    if (!list) return;
    list.innerHTML = features.length
      ? features.map((feature, index) => featureMarkup({ ...feature, editLocale: featureLocale }, index, features.length)).join("")
      : `<p class="empty-inline" data-i18n="services.noFeatures">${escapeHtml(t("services.noFeatures"))}</p>`;
    const count = form.querySelector("[data-feature-count]");
    if (count) count.textContent = plural("services.featureCount", features.length);
    controller?.rescan();
    list.querySelectorAll("input").forEach((input) => input.addEventListener("input", markDirty));
    list.querySelectorAll("[data-feature-remove]").forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.dataset.featureRemove;
        controller?.forget(`feature:${key}`);
        features = features.filter((feature) => feature.uiKey !== key);
        renderFeatures();
        markDirty();
      });
    });
    list.querySelectorAll("[data-feature-duplicate]").forEach((button) => {
      button.addEventListener("click", () => {
        const current = collectValues();
        const index = features.findIndex((feature) => feature.uiKey === button.dataset.featureDuplicate);
        const source = current.features[index];
        features.splice(index + 1, 0, { ...source, id: null, uiKey: uiKey() });
        renderFeatures();
        markDirty();
      });
    });
    list.querySelectorAll("[data-feature-up], [data-feature-down]").forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.dataset.featureUp || button.dataset.featureDown;
        const index = features.findIndex((feature) => feature.uiKey === key);
        const direction = button.dataset.featureUp ? -1 : 1;
        const next = index + direction;
        if (index < 0 || next < 0 || next >= features.length) return;
        [features[index], features[next]] = [features[next], features[index]];
        renderFeatures();
        markDirty();
      });
    });
  }

  function validate(values) {
    const errors = {};
    if (!values.name) errors.name = t("services.validation.nameRequired");
    if (!values.slug) errors.slug = t("services.validation.slugRequired");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(values.slug)) errors.slug = t("services.validation.slugValid");
    if (!SERVICE_STATUSES.includes(values.status)) errors.status = t("services.validation.statusValid");
    if (values.accent && !/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(values.accent)) errors.accent = t("services.validation.hexValid");
    return errors;
  }

  function clearErrors() {
    form.querySelectorAll(".field-error").forEach((node) => {
      node.hidden = true;
      node.textContent = "";
    });
    form.querySelectorAll("[aria-invalid]").forEach((node) => node.removeAttribute("aria-invalid"));
  }

  function showErrors(errors) {
    clearErrors();
    let first = null;
    Object.entries(errors).forEach(([field, message]) => {
      const container = form.querySelector(`[data-field="${CSS.escape(field)}"]`);
      const input = container?.querySelector("input, select, textarea");
      const error = container?.querySelector(".field-error");
      if (error) {
        error.textContent = message;
        error.hidden = false;
      }
      input?.setAttribute("aria-invalid", "true");
      if (!first) first = input;
    });
    first?.focus();
    showToast(t("services.fixHighlighted"));
  }

  function showReadinessModal(readiness) {
    openModal({
      title: t("services.cannotPublishTitle"),
      body: `
        <div class="readiness-modal">
          <p>${escapeHtml(t("services.cannotPublishBody"))}</p>
          <ul>${readiness.blocking.map((item) => `<li>${escapeHtml(t(`serviceHealth.checks.${item.key}`))}</li>`).join("")}</ul>
          ${readiness.warnings.length ? `<p>${escapeHtml(t("services.nonBlockingWarnings"))}</p><ul>${readiness.warnings.map((item) => `<li>${escapeHtml(t(`serviceHealth.checks.${item.key}`))}</li>`).join("")}</ul>` : ""}
        </div>
      `,
      actions: [{ label: t("common.close") }],
    });
  }

  async function save(button = form.querySelector("[data-action-save]")) {
    const values = collectValues();
    const errors = validate(values);
    if (Object.keys(errors).length) {
      showErrors(errors);
      return;
    }
    const readiness = serviceReadiness(values);
    if ((values.visible || values.status === "AVAILABLE") && !readiness.ok) {
      showReadinessModal(readiness);
      return;
    }
    button.disabled = true;
    try {
      const saved = isCreate ? await createPlan(values) : await updatePlan(plan.id, values);
      await logActivity(isCreate ? "Plan created" : "Plan updated", `${saved.name} saved.`, {
        action: isCreate ? "plan.created" : "plan.updated",
        entityType: "plan",
        entityId: saved.id,
      });
      clearNavigationGuard();
      dirty = false;
      showToast(t("services.planSaved"));
      if (isCreate) {
        window.location.hash = `#/services/${saved.id}`;
        return;
      }
      savedSnapshot = JSON.stringify(values);
      updateSaveState();
    } catch (error) {
      const dataError = toDataError(error, t("services.saveError"));
      if (dataError.code === "readiness" && dataError.cause) showReadinessModal(dataError.cause);
      else if (dataError.field) showErrors({ [dataError.field]: dataError.message });
      else showToast(dataError.message);
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  }

  bindTabs(form);
  controller = bindLocaleFields({
    root: form,
    scope: SCOPE,
    initial: initialTranslations,
    onChange: (locale) => {
      captureFeatureDrafts();
      featureLocale = locale;
      renderFeatures({ capture: false });
      refreshSignals();
    },
  });
  renderFeatures();
  savedSnapshot = baseline();
  refreshSignals();

  form.elements.slug.addEventListener("input", () => {
    slugTouched = true;
  });
  form.elements.name.addEventListener("input", () => {
    if (!slugTouched) form.elements.slug.value = slugifyPlan(form.elements.name.value);
  });
  const accentPicker = form.querySelector("[data-accent-picker]");
  const accentText = form.querySelector("[data-accent-text]");
  accentPicker?.addEventListener("input", () => {
    accentText.value = accentPicker.value;
  });
  accentText?.addEventListener("input", () => {
    if (/^#[0-9a-f]{6}$/i.test(accentText.value)) accentPicker.value = accentText.value;
  });
  form.querySelector("[data-feature-add]")?.addEventListener("click", () => {
    features.push({ id: null, position: features.length, text: "", translations: {}, uiKey: uiKey() });
    renderFeatures();
    markDirty();
  });
  form.addEventListener("input", markDirty);
  form.addEventListener("change", markDirty);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    save(event.submitter);
  });
  form.querySelector("[data-action-duplicate]")?.addEventListener("click", async () => {
    try {
      const copy = await duplicatePlan(plan.id);
      await logActivity("Plan duplicated", `${copy.name} created from ${plan.name}.`, { action: "plan.duplicated", entityType: "plan", entityId: copy.id });
      clearNavigationGuard();
      window.location.hash = `#/services/${copy.id}`;
    } catch (error) {
      showToast(describeError(error, t("services.duplicateError")));
    }
  });
  form.querySelector("[data-action-archive]")?.addEventListener("click", async () => {
    const archive = collectValues().status !== "ARCHIVED";
    const confirmed = await confirmModal({
      title: archive ? t("services.archiveTitle") : t("services.unarchiveTitle"),
      body: `<p>${escapeHtml(archive ? t("services.archiveBody") : t("services.unarchiveBody"))}</p>`,
      confirmLabel: archive ? t("services.actionArchive") : t("services.actionUnarchive"),
      danger: archive,
    });
    if (!confirmed) return;
    try {
      const changed = archive ? await archivePlan(plan.id) : await unarchivePlan(plan.id);
      await logActivity(archive ? "Plan archived" : "Plan unarchived", `${changed.name} lifecycle updated.`, {
        action: archive ? "plan.archived" : "plan.unarchived",
        entityType: "plan",
        entityId: changed.id,
      });
      clearNavigationGuard();
      window.location.hash = `#/services/${changed.id}`;
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    } catch (error) {
      showToast(describeError(error, t("services.archiveError")));
    }
  });
  onLocaleChange(form, () => {
    [...form.querySelectorAll("select")].forEach((select) => {
      [...select.options].forEach((option) => {
        if (SERVICE_STATUSES.includes(option.value)) option.textContent = statusLabel(option.value);
      });
    });
    renderFeatures();
    refreshSignals();
  });
  setNavigationGuard(() => dirty);
}

export const serviceEditorPage = {
  title: () => t("services.editorTitle"),
  breadcrumb: () => t("services.editorBreadcrumb"),
  render: () => `<section class="empty-state" aria-busy="true"><span data-i18n="services.loading">${escapeHtml(t("services.loading"))}</span></section>`,
  afterRender: async ({ id }) => {
    const page = document.querySelector(".page");
    const isCreate = id === "new";
    try {
      const plan = isCreate ? await newPlanDefaults() : await getPlan(id);
      if (!plan) {
        page.innerHTML = `<section class="empty-state"><span>404</span><h2>${escapeHtml(t("services.notFound"))}</h2><a class="button" href="#/services">${escapeHtml(t("services.allServices"))}</a></section>`;
        return;
      }
      page.innerHTML = renderEditor(plan, isCreate);
      mount(plan, isCreate);
    } catch (error) {
      page.innerHTML = `<section class="empty-state"><p>${escapeHtml(describeError(error, t("services.loadError")))}</p></section>`;
    }
  },
};
