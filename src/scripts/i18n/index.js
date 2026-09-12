import en from "./locales/en.js";
import ptBR from "./locales/pt-BR.js";

export const DEFAULT_LOCALE = "pt-BR";
export const SUPPORTED_LOCALES = ["pt-BR", "en"];
export const LOCALE_STORAGE_KEY = "space-underground.locale";

const dictionaries = { "pt-BR": ptBR, en };
let currentLocale = resolveLocale();
const subscribers = new Set();

function readPath(source, key) {
  return String(key).split(".").reduce((value, part) => value?.[part], source);
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
  const stored = normalizeLocale(saved ?? globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY));
  if (stored) return stored;
  for (const language of languages ?? globalThis.navigator?.languages ?? [globalThis.navigator?.language].filter(Boolean)) {
    const locale = normalizeLocale(language);
    if (locale) return locale;
  }
  return DEFAULT_LOCALE;
}

export function getLocale() {
  return currentLocale;
}

export function t(key, params = {}) {
  const value = readPath(dictionaries[currentLocale], key) ?? readPath(dictionaries[DEFAULT_LOCALE], key) ?? key;
  if (typeof value === "object") return key;
  return interpolate(value, params);
}

export function setLocale(locale, { persist = true } = {}) {
  const next = normalizeLocale(locale) || DEFAULT_LOCALE;
  if (persist) globalThis.localStorage?.setItem(LOCALE_STORAGE_KEY, next);
  currentLocale = next;
  if (globalThis.document?.documentElement) {
    document.documentElement.lang = next;
    applyStaticTranslations();
    updateSeo();
  }
  if (globalThis.window && typeof globalThis.CustomEvent === "function") {
    window.dispatchEvent(new CustomEvent("localechange", { detail: { locale: next } }));
  }
  subscribers.forEach((callback) => callback(next));
}

export function subscribeLocaleChange(callback) {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

export function applyStaticTranslations(root = document) {
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
  root.querySelectorAll("[data-i18n-title]").forEach((node) => {
    node.setAttribute("title", t(node.dataset.i18nTitle));
  });
  root.querySelectorAll("[data-locale-switch]").forEach((button) => {
    const active = button.dataset.localeSwitch === currentLocale;
    button.setAttribute("aria-pressed", String(active));
    button.toggleAttribute("aria-current", active);
  });
}

function updateMeta(selector, value) {
  const node = document.head.querySelector(selector);
  if (node) node.setAttribute("content", value);
}

export function updateSeo() {
  document.title = t("seo.title");
  updateMeta('meta[name="description"]', t("seo.description"));
  updateMeta('meta[property="og:title"]', t("seo.title"));
  updateMeta('meta[property="og:description"]', t("seo.description"));
  updateMeta('meta[property="og:image:alt"]', t("seo.ogAlt"));
  updateMeta('meta[name="twitter:title"]', t("seo.title"));
  updateMeta('meta[name="twitter:description"]', t("seo.description"));
}

export function initI18n() {
  setLocale(currentLocale, { persist: false });
  document.querySelectorAll("[data-locale-switch]").forEach((button) => {
    button.addEventListener("click", () => setLocale(button.dataset.localeSwitch));
  });
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
