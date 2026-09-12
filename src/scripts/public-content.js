import { fetchSiteContent, fetchSiteSettings, isConfigured, signPaths } from "./supabase-public.js";
import { applyStaticTranslations, getLocale, subscribeLocaleChange } from "./i18n/index.js";
import { mergeLocalizedRecord } from "../../shared/localized-items.js";

const STORAGE_PATH = /^(?!https?:|data:|blob:|\/|\.{1,2}\/).+/i;
let subscribedToLocale = false;
// Content rows and settings are fetched once. A locale change re-applies the
// localized view of the same rows instead of querying Supabase again.
let lastContentRows = null;
let lastSettings = null;

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

// Scalars merge normally; `items` is merged by position, so a translation that
// only covers one of four capability cards localizes that card and leaves the
// rest in pt-BR instead of collapsing the list. Shared with the Admin preview.
function localizedRecord(row) {
  const locale = getLocale();
  return mergeLocalizedRecord(row?.content, row?.translations?.[locale]);
}

function localizedSettings(settings = {}) {
  const locale = getLocale();
  return {
    ...settings,
    ...(settings.translations?.[locale] || {}),
  };
}

function write(selector, value) {
  const node = document.querySelector(selector);
  const next = text(value);
  if (node && next) node.textContent = next;
}

function writeSectionLabel(selector, value) {
  const node = document.querySelector(selector);
  const next = text(value);
  if (!node || !next) return;
  const index = node.querySelector("span");
  node.textContent = "";
  if (index) node.append(index, document.createTextNode(` ${next}`));
  else node.textContent = next;
}

function writeAccentHeading(selector, value) {
  const node = document.querySelector(selector);
  const next = text(value);
  if (!node || !next) return;

  const words = next.split(/\s+/).filter(Boolean);
  node.textContent = "";
  if (words.length === 1) {
    const emphasis = document.createElement("em");
    emphasis.textContent = words[0];
    node.append(emphasis);
    return;
  }

  node.append(document.createTextNode(`${words.slice(0, -1).join(" ")} `));
  const emphasis = document.createElement("em");
  emphasis.textContent = words.at(-1);
  node.append(emphasis);
}

function ensureMeta(selector, attributes = {}) {
  let node = document.head.querySelector(selector);
  if (!node) {
    node = document.createElement("meta");
    Object.entries(attributes).forEach(([name, value]) => node.setAttribute(name, value));
    document.head.append(node);
  }
  return node;
}

function ensureCanonical() {
  let link = document.head.querySelector('link[rel="canonical"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "canonical";
    document.head.append(link);
  }
  return link;
}

function absolutePublicUrl(value, baseUrl = window.location.href) {
  const next = text(value);
  if (!next) return "";
  try {
    return new URL(next, baseUrl).href;
  } catch {
    return "";
  }
}

function applyHero(content = {}) {
  writeSectionLabel(".hero .eyebrow", content.eyebrow);
  write(".hero__lede", content.description);

  const title = document.querySelector("#hero-title");
  if (title && text(content.headline)) {
    title.textContent = content.headline.trim();
    title.setAttribute("aria-label", content.headline.trim());
  }

  const actions = document.querySelectorAll(".hero__actions a");
  if (actions[0]) {
    if (text(content.primaryCtaLabel)) actions[0].querySelector("span").textContent = content.primaryCtaLabel.trim();
    if (text(content.primaryCtaUrl)) actions[0].setAttribute("href", content.primaryCtaUrl.trim());
  }
  if (actions[1]) {
    if (text(content.secondaryCtaLabel)) actions[1].querySelector("span").textContent = content.secondaryCtaLabel.trim();
    if (text(content.secondaryCtaUrl)) actions[1].setAttribute("href", content.secondaryCtaUrl.trim());
  }
}

function applyCapabilities(content = {}) {
  const items = Array.isArray(content.items) ? [...content.items].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)) : [];
  if (!items.length) return;
  const cards = [...document.querySelectorAll(".capability-card")];
  items.forEach((item, index) => {
    const card = cards[index];
    if (!card) return;
    if (text(item.accent)) card.style.setProperty("--capability-accent", item.accent.trim());
    const kicker = card.querySelector(".capability-card__kicker");
    const title = card.querySelector("h3");
    const copy = card.querySelector("h3 + p");
    const link = card.querySelector("a");
    if (kicker && text(item.kicker)) kicker.textContent = item.kicker.trim();
    if (title && text(item.title)) title.textContent = item.title.trim();
    if (copy && text(item.description)) copy.textContent = item.description.trim();
    if (link && text(item.link)) link.href = item.link.trim();
  });
}

function applyAbout(content = {}) {
  writeSectionLabel("#about .section-label", content.kicker);
  writeAccentHeading("#about-title", content.title);
  write("#about .about__lead", content.description);
  const notes = document.querySelectorAll(".about__notes > p");
  if (notes[0] && text(content.notePrimary)) notes[0].textContent = content.notePrimary.trim();
  if (notes[1] && text(content.noteSecondary)) notes[1].textContent = content.noteSecondary.trim();
}

function writeTimeline(row, item) {
  const title = row.querySelector("h3");
  const copy = row.querySelector("p");
  if (title && text(item.title)) title.textContent = item.title.trim();
  if (copy && text(item.description)) copy.textContent = item.description.trim();
}

function applyProcess(content = {}) {
  writeSectionLabel("#process .section-label", content.kicker);
  writeAccentHeading("#process-title", content.title);
  write("#process .section-intro", content.description);

  const items = Array.isArray(content.items) ? [...content.items].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)) : [];
  const rows = [...document.querySelectorAll(".timeline__item")];
  items.forEach((item, index) => {
    const row = rows[index];
    if (row) writeTimeline(row, item);
  });
}

function applyContact(content = {}) {
  writeSectionLabel("#contact .section-label", content.kicker);
  write(".contact__availability", content.availability);
  writeAccentHeading("#contact-title", content.title);
  write("#contact .contact__bottom p", content.description);
  const submit = document.querySelector(".project-form__submit span");
  if (submit && text(content.buttonLabel)) submit.textContent = content.buttonLabel.trim();
}

function applyFooter(content = {}) {
  const brandText = text(content.brand || content.title);
  if (brandText) {
    const brand = document.querySelector(".footer-brand");
    if (brand) {
      brand.textContent = brandText;
      const mark = document.createElement("span");
      mark.textContent = "®";
      brand.append(mark);
    }
  }
  write(".footer__bottom p:first-of-type", content.legal);
  write(".footer__bottom p:nth-child(2)", content.description || content.kicker);
}

async function resolveOgImage(path, siteUrl) {
  const value = text(path);
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;

  if (STORAGE_PATH.test(value)) {
    try {
      const signed = await signPaths([value]);
      const url = signed.get(value);
      if (url) return url;
    } catch {
      // Fall through to a public-site-relative URL.
    }
  }

  return absolutePublicUrl(value, siteUrl || window.location.href);
}

async function applySettings(settings = {}) {
  if (settings.site_name) {
    const brand = document.querySelector(".brand__name");
    const parts = String(settings.site_name).trim().split(/\s+/, 2);
    if (brand && parts.length) {
      brand.textContent = "";
      brand.append(document.createTextNode(parts[0]));
      if (parts[1]) {
        brand.append(document.createElement("br"));
        brand.append(document.createTextNode(parts[1]));
      }
    }
  }

  const siteUrl = absolutePublicUrl(settings.site_url || window.location.href);
  const seoTitle = text(settings.seo_title);
  const seoDescription = text(settings.seo_description);

  if (seoTitle) document.title = seoTitle;

  const description = ensureMeta('meta[name="description"]', { name: "description" });
  if (seoDescription) description.content = seoDescription;

  if (siteUrl) ensureCanonical().href = siteUrl;

  const ogTitle = ensureMeta('meta[property="og:title"]', { property: "og:title" });
  const ogDescription = ensureMeta('meta[property="og:description"]', { property: "og:description" });
  const ogUrl = ensureMeta('meta[property="og:url"]', { property: "og:url" });
  const ogImage = ensureMeta('meta[property="og:image"]', { property: "og:image" });
  const twitterCard = ensureMeta('meta[name="twitter:card"]', { name: "twitter:card" });
  const twitterTitle = ensureMeta('meta[name="twitter:title"]', { name: "twitter:title" });
  const twitterDescription = ensureMeta('meta[name="twitter:description"]', { name: "twitter:description" });
  const twitterImage = ensureMeta('meta[name="twitter:image"]', { name: "twitter:image" });

  if (seoTitle) {
    ogTitle.content = seoTitle;
    twitterTitle.content = seoTitle;
  }
  if (seoDescription) {
    ogDescription.content = seoDescription;
    twitterDescription.content = seoDescription;
  }
  if (siteUrl) ogUrl.content = siteUrl;

  const resolvedOgImage = await resolveOgImage(settings.og_image_path, siteUrl);
  if (resolvedOgImage) {
    ogImage.content = resolvedOgImage;
    twitterImage.content = resolvedOgImage;
  }
  twitterCard.content = resolvedOgImage ? "summary_large_image" : "summary";

  const contactEmail = text(settings.contact_email);
  if (contactEmail) {
    document.querySelectorAll("[data-public-contact-email]").forEach((node) => {
      node.textContent = contactEmail;
      if (node instanceof HTMLAnchorElement) node.href = `mailto:${contactEmail}`;
    });
    document.querySelectorAll('a[href^="mailto:"]').forEach((link) => {
      link.href = `mailto:${contactEmail}`;
    });
  }
}

async function applyContentRows(contentRows, settings) {
  const content = new Map(contentRows.map((row) => [row.key, localizedRecord(row)]));

  applyHero(content.get("hero"));
  applyAbout(content.get("about"));
  applyCapabilities(content.get("capabilities"));
  applyProcess(content.get("process"));
  applyContact(content.get("contact"));
  applyFooter(content.get("footer"));
  if (settings) await applySettings(localizedSettings(settings));
  applyStaticTranslations();
}

export async function initPublicContent() {
  if (!isConfigured()) return;
  if (!subscribedToLocale) {
    subscribedToLocale = true;
    subscribeLocaleChange(() => {
      if (lastContentRows) applyContentRows(lastContentRows, lastSettings);
      else initPublicContent();
    });
  }
  try {
    const [contentRows, settings] = await Promise.all([fetchSiteContent(), fetchSiteSettings()]);
    lastContentRows = contentRows;
    lastSettings = settings;
    await applyContentRows(contentRows, settings);
  } catch (error) {
    console.warn("[content] Supabase content unavailable, keeping build-time copy.", error);
  }
}
