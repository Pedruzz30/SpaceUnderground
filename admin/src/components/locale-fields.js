// Bilingual editing for editorial copy.
//
// pt-BR is the base language and lives in the record's own columns. English
// lives under `translations.en`. Switching the tab swaps what the inputs are
// bound to while keeping both drafts in memory, so an unsaved English edit is
// still there after a trip back to pt-BR and vice versa.
//
// Nothing is auto-copied between locales: an empty English field stays empty in
// the database, and the Public site falls back to pt-BR at read time. The
// pt-BR text is only surfaced as a placeholder, to show what the fallback will
// render.

import { escapeAttribute, escapeHtml } from "../utils/html.js";
import { t } from "../i18n/index.js";

export const BASE_LOCALE = "pt-BR";
export const TRANSLATION_LOCALE = "en";

export function localeTabs(scope) {
  return `
    <div class="locale-tabs" role="group" aria-label="${escapeAttribute(t("localeEditor.label"))}" data-i18n-aria-label="localeEditor.label" data-locale-tabs="${escapeAttribute(scope)}">
      <button type="button" data-locale-edit="${BASE_LOCALE}" class="is-active" aria-pressed="true">
        <span data-i18n="localeEditor.base">${escapeHtml(t("localeEditor.base"))}</span>
      </button>
      <button type="button" data-locale-edit="${TRANSLATION_LOCALE}" aria-pressed="false">
        <span data-i18n="localeEditor.english">${escapeHtml(t("localeEditor.english"))}</span>
      </button>
    </div>
  `;
}

export function localeHint(scope) {
  return `<p class="locale-hint" data-locale-hint="${escapeAttribute(scope)}" hidden data-i18n="localeEditor.fallbackNote">${escapeHtml(t("localeEditor.fallbackNote"))}</p>`;
}

function fieldsIn(root, scope) {
  return [...root.querySelectorAll(`[data-i18n-field][data-locale-scope="${CSS.escape(scope)}"]`)];
}

/**
 * Binds one PT-BR | EN group.
 *
 * @param root     element containing the tabs and the fields
 * @param scope    group name shared by the tabs and their fields
 * @param initial  existing `translations.en` object for this record
 * @returns a controller exposing the current drafts for both locales
 */
export function bindLocaleFields({ root, scope, initial = {}, onChange } = {}) {
  const tabs = root.querySelector(`[data-locale-tabs="${CSS.escape(scope)}"]`);
  const hint = root.querySelector(`[data-locale-hint="${CSS.escape(scope)}"]`);

  if (!fieldsIn(root, scope).length) return null;

  let activeLocale = BASE_LOCALE;
  const base = new Map();
  const translated = new Map();

  // Fields are looked up live rather than captured once, so rows added after
  // binding (a new plan feature, a new project module) join the group through
  // adopt() without losing the drafts already held for the other locale.
  function fields() {
    return fieldsIn(root, scope);
  }

  function adopt() {
    fields().forEach((field) => {
      const name = field.dataset.i18nField;
      if (!base.has(name)) base.set(name, activeLocale === BASE_LOCALE ? field.value : "");
      if (!translated.has(name)) {
        translated.set(name, String(initial?.[name] ?? (activeLocale === BASE_LOCALE ? "" : field.value)));
      }
      if (field.dataset.basePlaceholder === undefined) {
        field.dataset.basePlaceholder = field.placeholder || "";
      }
    });
  }

  function store() {
    const target = activeLocale === BASE_LOCALE ? base : translated;
    fields().forEach((field) => target.set(field.dataset.i18nField, field.value));
  }

  function paint() {
    adopt();
    const showingBase = activeLocale === BASE_LOCALE;
    fields().forEach((field) => {
      const name = field.dataset.i18nField;
      field.value = showingBase ? base.get(name) ?? "" : translated.get(name) ?? "";
      // The pt-BR text is shown as a placeholder only. It is never written to
      // the record, so leaving the field blank keeps the fallback in place.
      field.placeholder = showingBase ? field.dataset.basePlaceholder ?? "" : base.get(name) ?? "";
      field.classList.toggle("is-translation", !showingBase);
    });
    if (hint) hint.hidden = showingBase;
    tabs?.querySelectorAll("[data-locale-edit]").forEach((button) => {
      const active = button.dataset.localeEdit === activeLocale;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  tabs?.querySelectorAll("[data-locale-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = button.dataset.localeEdit;
      if (next === activeLocale) return;
      store();
      activeLocale = next;
      paint();
      onChange?.(activeLocale);
    });
  });

  adopt();
  paint();

  return {
    get activeLocale() {
      return activeLocale;
    },
    /** pt-BR values, for the record's own columns. */
    baseValues() {
      store();
      return Object.fromEntries(base);
    },
    /**
     * `translations.en` with blank fields dropped, so an untranslated field is
     * absent rather than stored as an empty string.
     */
    translationValues() {
      store();
      return Object.fromEntries([...translated].filter(([, value]) => String(value).trim() !== ""));
    },
    /** Picks up fields added to the group after binding. */
    rescan() {
      store();
      adopt();
      paint();
    },
    /** Drops drafts for fields that are no longer on the page. */
    forget(name) {
      base.delete(name);
      translated.delete(name);
    },
    refresh: paint,
  };
}

/** Marks an input as part of a bilingual group. */
export function localeFieldAttrs(scope, name) {
  return `data-i18n-field="${escapeAttribute(name)}" data-locale-scope="${escapeAttribute(scope)}"`;
}
