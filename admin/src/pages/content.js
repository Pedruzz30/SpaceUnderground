import { mergeLocalizedRecord } from "../../../shared/localized-items.js";
import { showToast } from "../components/toast.js";
import { BASE_LOCALE, TRANSLATION_LOCALE, localeHint, localeTabs } from "../components/locale-fields.js";
import { clearNavigationGuard, setNavigationGuard } from "../router/router.js";
import { logActivity } from "../services/activity-service.js";
import { getSiteContent, saveSiteContent } from "../services/content-service.js";
import { describeError } from "../services/errors.js";
import { onLocaleChange, plural, t } from "../i18n/index.js";
import { formatRelativeDay } from "../utils/format.js";
import { escapeAttribute, escapeHtml } from "../utils/html.js";

const SECTIONS = ["hero", "about", "capabilities", "process", "contact", "footer"];

// `translatable: false` marks a technical or structural field: a URL, an accent
// colour or a brand name. Those live once, in the base record, and stay
// read-only while the English tab is open so editing a translation can never
// change a link, a colour or an item's position.
const TEXT = (name, labelKey, hintKey) => ({ name, labelKey, hintKey, translatable: true });
const SHARED = (name, labelKey, hintKey) => ({ name, labelKey, hintKey, translatable: false });
const AREA = (name, labelKey, hintKey, rows = 5) => ({ name, labelKey, hintKey, rows, type: "textarea", translatable: true });

const GENERIC_HEAD = [
  TEXT("kicker", "content.fields.kicker", "content.fields.kickerHint"),
  TEXT("title", "content.fields.title", "content.fields.titleHint"),
  AREA("description", "content.fields.description", "content.fields.sectionDescriptionHint", 6),
];

const SECTION_FIELDS = {
  hero: [
    TEXT("eyebrow", "content.fields.eyebrow", "content.fields.eyebrowHint"),
    TEXT("headline", "content.fields.headline", "content.fields.headlineHint"),
    TEXT("primaryCtaLabel", "content.fields.primaryCtaLabel"),
    SHARED("primaryCtaUrl", "content.fields.primaryCtaUrl", "content.fields.ctaUrlHint"),
    TEXT("secondaryCtaLabel", "content.fields.secondaryCtaLabel"),
    SHARED("secondaryCtaUrl", "content.fields.secondaryCtaUrl", "content.fields.ctaUrlHint"),
    AREA("description", "content.fields.description", "content.fields.heroDescriptionHint"),
  ],
  about: [
    ...GENERIC_HEAD,
    TEXT("notePrimary", "content.fields.notePrimary"),
    TEXT("noteSecondary", "content.fields.noteSecondary"),
  ],
  capabilities: GENERIC_HEAD,
  process: GENERIC_HEAD,
  contact: [
    ...GENERIC_HEAD,
    TEXT("availability", "content.fields.availability"),
    TEXT("buttonLabel", "content.fields.buttonLabel"),
  ],
  footer: [
    ...GENERIC_HEAD,
    SHARED("brand", "content.fields.brand"),
    TEXT("legal", "content.fields.legal"),
  ],
};

const REPEATABLE = {
  capabilities: {
    kind: "capability",
    fields: [
      TEXT("kicker", "content.fields.kicker"),
      TEXT("title", "content.fields.title"),
      SHARED("link", "content.fields.link"),
      SHARED("accent", "content.fields.accent"),
      AREA("description", "content.fields.description", "", 3),
    ],
  },
  process: {
    kind: "step",
    fields: [TEXT("title", "content.fields.title"), AREA("description", "content.fields.description", "", 3)],
  },
};

function sectionLabel(key) {
  return t(`content.sections.${key}`);
}

function sectionDescription(key) {
  return t(`content.sections.${key}Description`);
}

function fieldsFor(key) {
  return SECTION_FIELDS[key] || GENERIC_HEAD;
}

function hasConfiguredContent(entry) {
  const content = entry?.content;
  if (!content || typeof content !== "object") return false;
  if (Array.isArray(content.items)) {
    return content.items.some((item) => Object.values(item || {}).some((value) => String(value || "").trim()));
  }
  return Object.values(content).some((value) => String(value || "").trim());
}

function hasTranslation(entry) {
  const translation = entry?.translations?.[TRANSLATION_LOCALE];
  return Boolean(translation) && Object.keys(translation).length > 0;
}

function fieldControl(field, value, { readOnly = false, placeholder = "" } = {}) {
  const id = `content-${field.name}`;
  const hint = field.hintKey ? `<small>${escapeHtml(t(field.hintKey))}</small>` : "";
  const sharedNote = readOnly ? `<small class="locale-hint">${escapeHtml(t("content.sharedField"))}</small>` : "";
  const attrs = [
    `id="${id}"`,
    `name="${escapeAttribute(field.name)}"`,
    readOnly ? "readonly" : "",
    placeholder ? `placeholder="${escapeAttribute(placeholder)}"` : "",
    field.translatable ? "" : 'data-shared-field="true"',
  ]
    .filter(Boolean)
    .join(" ");

  const control =
    field.type === "textarea"
      ? `<textarea ${attrs} rows="${field.rows || 5}">${escapeHtml(value || "")}</textarea>`
      : `<input ${attrs} value="${escapeAttribute(value || "")}">`;

  return `
    <div class="field${field.type === "textarea" ? " field--wide" : ""}">
      <label for="${id}">${escapeHtml(t(field.labelKey))}</label>
      ${control}
      ${hint}
      ${sharedNote}
    </div>
  `;
}

function repeatableItem(kind, fields, item, index, { editLocale, baseItem = {} }) {
  const showingBase = editLocale === BASE_LOCALE;
  return `
    <article class="module-card" data-repeatable-item data-item-position="${index}">
      <header class="module-card__head">
        <div><span>${escapeHtml(kind.toUpperCase())} ${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(item.title || baseItem.title || t("content.untitled"))}</strong></div>
        <button type="button" class="button button--danger" data-remove-repeatable ${showingBase ? "" : "disabled"}>${escapeHtml(t("content.removeItem"))}</button>
      </header>
      <div class="form-grid">
        ${fields
          .map((field) => {
            const readOnly = !showingBase && !field.translatable;
            const value = readOnly ? baseItem[field.name] : item[field.name];
            const placeholder = !showingBase && field.translatable ? String(baseItem[field.name] || "") : "";
            const control =
              field.type === "textarea"
                ? `<textarea rows="${field.rows || 3}" data-repeatable-field="${escapeAttribute(field.name)}"${readOnly ? " readonly" : ""}${placeholder ? ` placeholder="${escapeAttribute(placeholder)}"` : ""}>${escapeHtml(value || "")}</textarea>`
                : `<input data-repeatable-field="${escapeAttribute(field.name)}" value="${escapeAttribute(value || "")}"${readOnly ? " readonly" : ""}${placeholder ? ` placeholder="${escapeAttribute(placeholder)}"` : ""}>`;
            return `<div class="field${field.type === "textarea" ? " field--wide" : ""}"><label>${escapeHtml(t(field.labelKey))}</label>${control}${readOnly ? `<small class="locale-hint">${escapeHtml(t("content.sharedField"))}</small>` : ""}</div>`;
          })
          .join("")}
      </div>
    </article>
  `;
}

function formFor(key, draft, { editLocale, baseContent }) {
  const showingBase = editLocale === BASE_LOCALE;
  const body = fieldsFor(key)
    .map((field) => {
      const readOnly = !showingBase && !field.translatable;
      const value = readOnly ? baseContent[field.name] : draft[field.name];
      const placeholder = !showingBase && field.translatable ? String(baseContent[field.name] || "") : "";
      return fieldControl(field, value, { readOnly, placeholder });
    })
    .join("");

  const repeatable = REPEATABLE[key];
  if (!repeatable) return `<div class="form-grid">${body}</div>`;

  const baseItems = Array.isArray(baseContent.items) ? baseContent.items : [];
  const items = Array.isArray(draft.items) ? draft.items : [];
  // Position is the identity shared between the base items and their
  // translations, so the two lists stay aligned even when only one has entries.
  const rows = showingBase ? items : baseItems.map((_, index) => items[index] || {});

  return `
    <div class="form-grid">${body}</div>
    <div class="module-list" data-repeatable-list="${escapeAttribute(repeatable.kind)}">
      ${rows
        .map((item, index) =>
          repeatableItem(repeatable.kind, repeatable.fields, item, index, {
            editLocale,
            baseItem: baseItems[index] || {},
          }),
        )
        .join("") || `<p class="empty-inline">${escapeHtml(t("content.noItems"))}</p>`}
    </div>
    <button class="button" type="button" data-add-repeatable ${showingBase ? "" : "disabled"}>${escapeHtml(t("content.addItem"))}</button>
  `;
}

function readRepeatable(form, fields, { translatableOnly }) {
  return [...form.querySelectorAll("[data-repeatable-item]")]
    .map((card, index) => {
      const item = { position: index };
      card.querySelectorAll("[data-repeatable-field]").forEach((inputEl) => {
        const name = inputEl.dataset.repeatableField;
        const field = fields.find((entry) => entry.name === name);
        if (translatableOnly && !field?.translatable) return;
        item[name] = inputEl.value.trim();
      });
      return item;
    })
    .filter((item) => Object.entries(item).some(([key, value]) => key !== "position" && value));
}

function draftFromForm(key, form, { translatableOnly }) {
  const fields = fieldsFor(key);
  const draft = {};
  fields.forEach((field) => {
    if (translatableOnly && !field.translatable) return;
    const control = form.elements[field.name];
    if (control) draft[field.name] = String(control.value ?? "").trim();
  });

  const repeatable = REPEATABLE[key];
  if (repeatable) draft.items = readRepeatable(form, repeatable.fields, { translatableOnly });
  return draft;
}

// What the public site will actually render for the chosen locale: an English
// field that has not been filled in falls back to the Portuguese one. The merge
// itself is shared with the public renderer so the preview cannot drift from
// what visitors actually see.
function resolvedContent(baseContent, translation) {
  return mergeLocalizedRecord(baseContent, translation);
}

function previewFor(key, content = {}) {
  if (key === "hero") {
    return `
      <div class="cms-preview cms-preview--hero">
        <span>${escapeHtml(content.eyebrow || t("content.previewDefaults.eyebrow"))}</span>
        <strong>${escapeHtml(content.headline || t("content.previewDefaults.headline"))}</strong>
        <p>${escapeHtml(content.description || t("content.previewDefaults.description"))}</p>
        <div><b>${escapeHtml(content.primaryCtaLabel || t("content.previewDefaults.primaryCta"))}</b><small>${escapeHtml(content.secondaryCtaLabel || t("content.previewDefaults.secondaryCta"))}</small></div>
      </div>
    `;
  }

  if (REPEATABLE[key]) {
    const items = Array.isArray(content.items) ? content.items : [];
    return `
      <div class="cms-preview">
        <span>${escapeHtml(sectionLabel(key).toUpperCase())} / ${escapeHtml(t("content.preview"))}</span>
        <strong>${escapeHtml(items.length ? plural("content.structuredItems", items.length) : t("content.noneConfigured", { section: sectionLabel(key).toLowerCase() }))}</strong>
        <p>${escapeHtml(content.description || t("content.sectionCopyHere"))}</p>
        <div class="cms-preview-list">
          ${items.slice(0, 4).map((item, index) => `<p><i>${String(index + 1).padStart(2, "0")}</i>${escapeHtml(item.title || item.description || t("content.untitledItem"))}</p>`).join("") || `<p class="empty-inline">${escapeHtml(t("content.addItemsToPreview"))}</p>`}
        </div>
      </div>
    `;
  }

  return `
    <div class="cms-preview">
      <span>${escapeHtml(content.kicker || `${sectionLabel(key).toUpperCase()} / ${t("content.preview")}`)}</span>
      <strong>${escapeHtml(content.headline || content.title || content.brand || sectionLabel(key))}</strong>
      <p>${escapeHtml(content.description || content.availability || content.legal || t("content.sectionCopyHere"))}</p>
    </div>
  `;
}

function stateLabel(entry, dirty, saving, saveError) {
  if (saving) return `<span class="cms-editor-state cms-editor-state--saving">${escapeHtml(t("content.saving"))}</span>`;
  if (saveError) return `<span class="cms-editor-state cms-editor-state--error">${escapeHtml(t("content.errorSaving"))}</span>`;
  if (dirty) return `<span class="cms-editor-state cms-editor-state--dirty">${escapeHtml(t("content.unsavedChanges"))}</span>`;
  return `<span class="cms-editor-state cms-editor-state--saved">${escapeHtml(entry ? t("content.savedState") : t("content.loadedState"))}</span>`;
}

export const contentPage = {
  title: () => t("content.title"),
  breadcrumb: () => t("content.breadcrumb"),
  render: () => `
    <section class="page-heading page-heading--split">
      <div>
        <span data-i18n="content.eyebrow">${t("content.eyebrow")}</span>
        <h2 data-i18n="content.heading">${t("content.heading")}</h2>
        <p data-i18n="content.intro">${t("content.intro")}</p>
      </div>
      <div class="heading-actions"><a class="button" href="#/cms" data-i18n="content.backToCms">${t("content.backToCms")}</a></div>
    </section>

    <section class="cms-content-shell" data-content-workspace aria-busy="true">
      <aside class="panel cms-content-nav" aria-label="${t("content.sectionsNav")}" data-i18n-aria-label="content.sectionsNav">
        <p class="empty-inline" data-i18n="content.loadingSections">${t("content.loadingSections")}</p>
      </aside>
      <div class="panel cms-content-editor"><p class="empty-inline" data-i18n="content.loadingContent">${t("content.loadingContent")}</p></div>
      <aside class="panel cms-content-preview"><p class="empty-inline" data-i18n="content.loadingPreview">${t("content.loadingPreview")}</p></aside>
    </section>
  `,
  afterRender: async () => {
    const workspace = document.querySelector("[data-content-workspace]");
    const nav = workspace?.querySelector(".cms-content-nav");
    const editor = workspace?.querySelector(".cms-content-editor");
    const preview = workspace?.querySelector(".cms-content-preview");
    if (!workspace || !nav || !editor || !preview) return;

    let entries = new Map();
    let active = "hero";
    let editLocale = BASE_LOCALE;
    let dirty = false;
    let saving = false;
    let saveError = false;

    // Drafts for both languages are held per section, so switching the content
    // language (or the interface language) never drops an unsaved edit.
    const drafts = new Map();

    setNavigationGuard(() => dirty);

    function entryFor(key) {
      return entries.get(key) || { key, content: {}, translations: {}, updatedAt: null };
    }

    function draftsFor(key) {
      if (!drafts.has(key)) {
        const entry = entryFor(key);
        drafts.set(key, {
          [BASE_LOCALE]: structuredClone(entry.content ?? {}),
          [TRANSLATION_LOCALE]: structuredClone(entry.translations?.[TRANSLATION_LOCALE] ?? {}),
        });
      }
      return drafts.get(key);
    }

    function captureDraft() {
      const form = editor.querySelector("[data-content-form]");
      if (!form) return;
      draftsFor(active)[editLocale] = draftFromForm(active, form, {
        translatableOnly: editLocale !== BASE_LOCALE,
      });
    }

    function renderNav() {
      nav.innerHTML = `
        <header class="panel__head"><div><span>${escapeHtml(t("content.sectionsLabel"))}</span><h3>${escapeHtml(t("content.publicContent"))}</h3></div></header>
        <div class="cms-section-list">
          ${SECTIONS.map((key) => {
            const entry = entries.get(key);
            const configured = hasConfiguredContent(entry);
            return `
              <button type="button" class="cms-section-button${key === active ? " is-active" : ""}" data-content-section="${key}" aria-pressed="${key === active}">
                <span>${escapeHtml(sectionLabel(key))}</span>
                <small>${escapeHtml(configured ? t("content.configured") : t("content.usingFallback"))}</small>
              </button>
            `;
          }).join("")}
        </div>
      `;

      nav.querySelectorAll("[data-content-section]").forEach((button) => {
        button.addEventListener("click", () => {
          const next = button.dataset.contentSection;
          if (next === active) return;
          if (dirty) {
            showToast(t("content.saveOrDiscard"));
            return;
          }
          active = next;
          saveError = false;
          renderWorkspace();
        });
      });
    }

    function renderEditorState() {
      const state = editor.querySelector("[data-content-state]");
      if (state) state.innerHTML = stateLabel(entries.get(active), dirty, saving, saveError);
    }

    function renderPreview() {
      const form = editor.querySelector("[data-content-form]");
      if (form) captureDraft();
      const sectionDrafts = draftsFor(active);
      const baseContent = sectionDrafts[BASE_LOCALE];
      const shown =
        editLocale === BASE_LOCALE
          ? baseContent
          : resolvedContent(baseContent, sectionDrafts[TRANSLATION_LOCALE]);

      const fallbackNote =
        editLocale === BASE_LOCALE
          ? ""
          : `<p class="locale-hint">${escapeHtml(
              Object.keys(sectionDrafts[TRANSLATION_LOCALE] ?? {}).length
                ? t("content.translationReady")
                : t("content.translationFallback"),
            )}</p>`;

      preview.innerHTML = `
        <header class="panel__head"><div><span>${escapeHtml(t("content.preview"))}</span><h3>${escapeHtml(t("content.editorialStructure"))}</h3></div></header>
        ${previewFor(active, shown)}
        ${fallbackNote}
        <p class="ops-note">${escapeHtml(t("content.structuralNote"))}</p>
      `;
    }

    function addRepeatableItem(form) {
      const list = form.querySelector("[data-repeatable-list]");
      const repeatable = REPEATABLE[active];
      if (!list || !repeatable || editLocale !== BASE_LOCALE) return;
      if (list.querySelector(".empty-inline")) list.innerHTML = "";
      list.insertAdjacentHTML(
        "beforeend",
        repeatableItem(repeatable.kind, repeatable.fields, {}, list.querySelectorAll("[data-repeatable-item]").length, {
          editLocale,
        }),
      );
      dirty = true;
      saveError = false;
      renderEditorState();
      renderPreview();
    }

    function renderEditor() {
      const entry = entryFor(active);
      const sectionDrafts = draftsFor(active);
      const draft = sectionDrafts[editLocale];
      const showingBase = editLocale === BASE_LOCALE;

      editor.innerHTML = `
        <form data-content-form>
          <header class="panel__head cms-editor-head">
            <div>
              <span>${escapeHtml(sectionLabel(active).toUpperCase())}</span>
              <h3>${escapeHtml(sectionLabel(active))}</h3>
              <p>${escapeHtml(sectionDescription(active))}</p>
            </div>
            <div class="cms-editor-actions">
              ${localeTabs("site-content")}
              ${localeHint("site-content")}
              <span data-content-state>${stateLabel(entry, dirty, saving, saveError)}</span>
              <button class="button button--primary" type="submit" data-action-save ${saving ? "disabled" : ""}>${escapeHtml(saving ? t("content.saving") : t("content.saveSection"))}</button>
            </div>
          </header>
          <div class="cms-editor-meta">
            <span>${escapeHtml(hasConfiguredContent(entry) ? t("content.configuredBadge") : t("content.fallbackBadge"))}</span>
            <span>${escapeHtml(entry.updatedAt ? t("content.updatedPrefix", { when: formatRelativeDay(entry.updatedAt) }) : t("content.noSavedRevision"))}</span>
            <span data-translation-state>${escapeHtml(hasTranslation(entry) ? t("content.translationReady") : t("content.translationFallback"))}</span>
          </div>
          <p class="field-error" data-content-error hidden></p>
          ${formFor(active, draft, { editLocale, baseContent: sectionDrafts[BASE_LOCALE] })}
        </form>
      `;

      const form = editor.querySelector("[data-content-form]");
      const error = form.querySelector("[data-content-error]");

      // The fallback note only makes sense while the English tab is open.
      form.querySelectorAll("[data-locale-hint]").forEach((hint) => {
        hint.hidden = showingBase;
      });

      form.querySelectorAll("[data-locale-edit]").forEach((button) => {
        const target = button.dataset.localeEdit;
        const isActive = target === editLocale;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-pressed", String(isActive));
        button.addEventListener("click", () => {
          if (target === editLocale) return;
          captureDraft();
          editLocale = target;
          renderEditor();
          renderPreview();
        });
      });

      form.addEventListener("input", () => {
        dirty = true;
        saveError = false;
        error.hidden = true;
        renderEditorState();
        renderPreview();
      });
      form.querySelector("[data-add-repeatable]")?.addEventListener("click", () => addRepeatableItem(form));
      form.addEventListener("click", (event) => {
        const remove = event.target.closest("[data-remove-repeatable]");
        if (!remove || !showingBase) return;
        remove.closest("[data-repeatable-item]")?.remove();
        dirty = true;
        saveError = false;
        renderEditorState();
        renderPreview();
      });

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (saving) return;
        captureDraft();
        saving = true;
        saveError = false;
        renderEditorState();
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        button.textContent = t("content.saving");

        const sectionDraftsNow = draftsFor(active);
        const translation = sectionDraftsNow[TRANSLATION_LOCALE] ?? {};
        // An entirely empty English draft is not persisted, so the record keeps
        // no translation at all and the site falls back to Portuguese.
        const hasAnyTranslation = Object.entries(translation).some(([key, value]) =>
          key === "items" ? (value || []).length > 0 : String(value ?? "").trim() !== "",
        );

        try {
          const saved = await saveSiteContent({
            key: active,
            content: sectionDraftsNow[BASE_LOCALE],
            // Merging preserves any other locale the Admin does not edit yet.
            translations: hasAnyTranslation
              ? { ...(entry.translations ?? {}), [TRANSLATION_LOCALE]: translation }
              : Object.fromEntries(
                  Object.entries(entry.translations ?? {}).filter(([locale]) => locale !== TRANSLATION_LOCALE),
                ),
          });
          entries.set(active, saved);
          drafts.delete(active);
          dirty = false;
          await logActivity("Site content updated", `${sectionLabel(active)} updated`, {
            action: "site_content.updated",
            entityType: "site_content",
            entityId: active,
          });
          showToast(t("content.contentSaved"));
          saving = false;
          renderWorkspace();
        } catch (err) {
          saveError = true;
          saving = false;
          const message = describeError(err, t("content.saveError"));
          error.textContent = message;
          error.hidden = false;
          showToast(message);
          renderEditorState();
        } finally {
          if (button?.isConnected) {
            button.disabled = false;
            button.textContent = t("content.saveSection");
          }
        }
      });
    }

    function renderWorkspace() {
      renderNav();
      renderEditor();
      renderPreview();
    }

    // Changing the interface language keeps the active section, the content
    // language being edited and every unsaved draft: the drafts are captured
    // first and the workspace is rebuilt from them, not re-fetched.
    onLocaleChange(workspace, () => {
      if (!entries.size) return;
      captureDraft();
      renderWorkspace();
    });

    try {
      entries = new Map((await getSiteContent()).map((entry) => [entry.key, entry]));
      renderWorkspace();
    } catch (error) {
      editor.innerHTML = `<p class="empty-inline">${escapeHtml(describeError(error, t("content.loadError")))}</p>`;
      nav.innerHTML = `<p class="empty-inline">${escapeHtml(t("content.sectionsUnavailable"))}</p>`;
      preview.innerHTML = `<p class="empty-inline">${escapeHtml(t("content.previewUnavailable"))}</p>`;
    } finally {
      workspace.removeAttribute("aria-busy");
    }
  },
  beforeLeave: () => clearNavigationGuard(),
};
