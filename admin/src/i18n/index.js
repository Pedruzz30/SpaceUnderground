import { applyLocaleFormatting } from "../utils/format.js";
import en from "./locales/en.js";
import ptBR from "./locales/pt-BR.js";

export const DEFAULT_LOCALE = "pt-BR";
export const SUPPORTED_LOCALES = ["pt-BR", "en"];
export const LOCALE_STORAGE_KEY = "space-underground.locale";

const dictionaries = {
  "pt-BR": ptBR,
  en,
};

const subscribers = new Set();
let initialized = false;
let currentLocale = resolveLocale();

function storage() {
  return globalThis.localStorage;
}

function browserLanguages() {
  return globalThis.navigator?.languages ?? [globalThis.navigator?.language].filter(Boolean);
}

function htmlElement() {
  return globalThis.document?.documentElement;
}

function readPath(source, key) {
  return String(key)
    .split(".")
    .reduce((value, part) => (value && Object.prototype.hasOwnProperty.call(value, part) ? value[part] : undefined), source);
}

function interpolate(value, params = {}) {
  return String(value).replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

export function normalizeLocale(value) {
  const locale = String(value || "").trim();
  if (locale === "pt-BR" || /^pt(?:-|$)/i.test(locale)) return "pt-BR";
  if (locale === "en" || /^en(?:-|$)/i.test(locale)) return "en";
  return null;
}

export function resolveLocale({ saved, languages } = {}) {
  const stored = saved ?? storage()?.getItem(LOCALE_STORAGE_KEY);
  const storedLocale = normalizeLocale(stored);
  if (storedLocale) return storedLocale;

  for (const language of languages ?? browserLanguages()) {
    const locale = normalizeLocale(language);
    if (locale) return locale;
  }

  return DEFAULT_LOCALE;
}

export function getLocale() {
  return currentLocale;
}

export function setLocale(locale, { persist = true } = {}) {
  const nextLocale = normalizeLocale(locale) || DEFAULT_LOCALE;
  if (persist) storage()?.setItem(LOCALE_STORAGE_KEY, nextLocale);
  if (nextLocale === currentLocale) return currentLocale;

  currentLocale = nextLocale;
  if (htmlElement()) htmlElement().lang = nextLocale;
  if (globalThis.window && typeof globalThis.CustomEvent === "function") {
    globalThis.window.dispatchEvent(new CustomEvent("localechange", { detail: { locale: nextLocale } }));
  }
  subscribers.forEach((callback) => callback(nextLocale));
  return currentLocale;
}

export function subscribeLocaleChange(callback) {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

export function applyStaticTranslations(root = globalThis.document) {
  if (!root?.querySelectorAll) return;
  root.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  root.querySelectorAll("[data-i18n-html]").forEach((node) => {
    node.innerHTML = t(node.dataset.i18nHtml);
  });
  root.querySelectorAll("[data-i18n-aria-label]").forEach((node) => {
    node.setAttribute("aria-label", t(node.dataset.i18nAriaLabel));
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((node) => {
    node.setAttribute("placeholder", t(node.dataset.i18nPlaceholder));
  });
  root.querySelectorAll("[data-status-label]").forEach((node) => {
    node.textContent = statusLabel(node.dataset.statusLabel);
  });
  applyLocaleFormatting(root);
  root.querySelectorAll("[data-locale-switch]").forEach((button) => {
    const active = button.dataset.localeSwitch === currentLocale;
    button.setAttribute("aria-pressed", String(active));
    button.toggleAttribute("aria-current", active);
  });
}

// Pages call this from afterRender() to re-label themselves in place. The
// handler runs for as long as `anchor` stays in the document, so a page that
// has been navigated away from stops listening without extra bookkeeping.
export function onLocaleChange(anchor, handler) {
  const unsubscribe = subscribeLocaleChange((locale) => {
    if (!anchor?.isConnected) {
      unsubscribe();
      return;
    }
    handler(locale);
    applyStaticTranslations(document);
  });
  return unsubscribe;
}

export function t(key, params = {}) {
  const value = readPath(dictionaries[currentLocale], key) ?? readPath(dictionaries[DEFAULT_LOCALE], key) ?? key;
  if (typeof value === "object") return key;
  return interpolate(value, params);
}

// pt-BR and en share the same one/other split, so a two-form lookup is enough
// here. Dictionaries store plurals as `{ one, other }` under the given key.
export function plural(key, count, params = {}) {
  return t(`${key}.${count === 1 ? "one" : "other"}`, { count, ...params });
}

export function statusLabel(value) {
  const key = String(value || "").toLowerCase().replace(/\s+/g, "");
  return t(`status.${key}`) === `status.${key}` ? String(value || "") : t(`status.${key}`);
}

export function initI18n() {
  currentLocale = resolveLocale();
  if (htmlElement()) htmlElement().lang = currentLocale;
  if (globalThis.window) globalThis.window.__spaceUndergroundLocale = currentLocale;
  applyStaticTranslations();
  if (!initialized) {
    initialized = true;
    subscribeLocaleChange(() => applyStaticTranslations());
  }
}

export function dictionaryKeys(locale = DEFAULT_LOCALE) {
  const keys = [];
  const walk = (value, prefix = "") => {
    Object.entries(value).forEach(([key, child]) => {
      const next = prefix ? `${prefix}.${key}` : key;
      if (child && typeof child === "object") walk(child, next);
      else keys.push(next);
    });
  };
  walk(dictionaries[locale] || {});
  return keys.sort();
}

export function hasKey(key, locale = DEFAULT_LOCALE) {
  return readPath(dictionaries[locale], key) !== undefined;
}

export function localeSwitcher() {
  return `
    <div class="locale-switcher" role="group" aria-label="${t("locale.label")}">
      ${SUPPORTED_LOCALES.map((locale) => {
        const active = locale === currentLocale;
        const short = locale === "pt-BR" ? t("locale.pt") : t("locale.en");
        return `<button type="button" data-locale-switch="${locale}" aria-pressed="${active}"${active ? ' aria-current="true"' : ""}>${short}</button>`;
      }).join("")}
    </div>
  `;
}

export function bindLocaleSwitcher(root = document) {
  root.querySelectorAll("[data-locale-switch]").forEach((button) => {
    button.addEventListener("click", () => setLocale(button.dataset.localeSwitch));
  });
}
