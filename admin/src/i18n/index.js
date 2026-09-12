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

export function t(key, params = {}) {
  const value = readPath(dictionaries[currentLocale], key) ?? readPath(dictionaries[DEFAULT_LOCALE], key) ?? key;
  if (typeof value === "object") return key;
  return interpolate(value, params);
}

export function statusLabel(value) {
  const key = String(value || "").toLowerCase().replace(/\s+/g, "");
  return t(`status.${key}`) === `status.${key}` ? String(value || "") : t(`status.${key}`);
}

export function initI18n() {
  currentLocale = resolveLocale();
  if (htmlElement()) htmlElement().lang = currentLocale;
  if (globalThis.window) globalThis.window.__spaceUndergroundLocale = currentLocale;
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
