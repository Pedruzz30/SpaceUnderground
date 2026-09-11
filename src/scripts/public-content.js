import { fetchSiteContent, fetchSiteSettings, isConfigured, signPaths } from "./supabase-public.js";

const STORAGE_PATH = /^(?!https?:|data:|blob:|\/|\.{1,2}\/).+/i;

function write(selector, value) {
  const node = document.querySelector(selector);
  if (node && typeof value === "string" && value.trim()) node.textContent = value.trim();
}

function setMeta(selector, value) {
  const node = document.querySelector(selector);
  if (node && value) node.setAttribute("content", value);
}

function splitTitle(node, value) {
  if (!node || !value) return;
  const [first, ...rest] = String(value).trim().split(/\s+/);
  node.textContent = "";
  node.append(document.createTextNode(first || value));
  if (rest.length) {
    node.append(document.createElement("br"));
    node.append(document.createTextNode(rest.join(" ")));
  }
}

function applyHero(content = {}) {
  write(".hero .eyebrow", content.eyebrow);
  write(".hero__lede", content.description);
  const title = document.querySelector("#hero-title");
  if (title && content.headline) {
    title.textContent = content.headline;
    title.setAttribute("aria-label", content.headline);
  }

  const actions = document.querySelectorAll(".hero__actions a");
  if (actions[0]) {
    if (content.primaryCtaLabel) actions[0].querySelector("span").textContent = content.primaryCtaLabel;
    if (content.primaryCtaUrl) actions[0].setAttribute("href", content.primaryCtaUrl);
  }
  if (actions[1]) {
    if (content.secondaryCtaLabel) actions[1].querySelector("span").textContent = content.secondaryCtaLabel;
    if (content.secondaryCtaUrl) actions[1].setAttribute("href", content.secondaryCtaUrl);
  }
}

function applyAbout(content = {}) {
  write("#about .section-label", content.kicker);
  splitTitle(document.querySelector("#about-title"), content.title);
  write(".about__lead", content.description);
  const notes = document.querySelectorAll(".about__notes > p");
  if (notes[0] && content.notePrimary) notes[0].textContent = content.notePrimary;
  if (notes[1] && content.noteSecondary) notes[1].textContent = content.noteSecondary;
}

function applyCapabilities(content = {}) {
  const items = Array.isArray(content.items) ? [...content.items].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)) : [];
  if (!items.length) return;
  const cards = [...document.querySelectorAll(".capability-card")];
  items.forEach((item, index) => {
    const card = cards[index];
    if (!card) return;
    if (item.accent) card.style.setProperty("--capability-accent", item.accent);
    const kicker = card.querySelector(".capability-card__kicker");
    const title = card.querySelector("h3");
    const copy = card.querySelector("h3 + p");
    const link = card.querySelector("a");
    if (kicker && item.kicker) kicker.textContent = item.kicker;
    if (title && item.title) title.textContent = item.title;
    if (copy && item.description) copy.textContent = item.description;
    if (link && item.link) link.href = item.link;
  });
}

function applyProcess(content = {}) {
  write("#process .section-label", content.kicker);
  splitTitle(document.querySelector("#process-title"), content.title);
  write("#process .section-intro", content.description);
  const items = Array.isArray(content.items) ? [...content.items].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)) : [];
  const rows = [...document.querySelectorAll(".timeline__item")];
  items.forEach((item, index) => {
    const row = rows[index];
    if (!row) return;
    writeTimeline(row, item);
  });
}

function writeTimeline(row, item) {
  const title = row.querySelector("h3");
  const copy = row.querySelector("p");
  if (title && item.title) title.textContent = item.title;
  if (copy && item.description) copy.textContent = item.description;
}

function applyContact(content = {}) {
  write("#contact .section-label", content.kicker);
  write(".contact__availability", content.availability);
  splitTitle(document.querySelector("#contact-title"), content.title);
  write(".contact__bottom p", content.description);
  const submit = document.querySelector(".project-form__submit span");
  if (submit && content.buttonLabel) submit.textContent = content.buttonLabel;
}

function applyFooter(content = {}) {
  const brand = document.querySelector(".footer-brand");
  if (brand && content.brand) {
    brand.textContent = "";
    brand.append(document.createTextNode(content.brand));
  }
  write(".footer__bottom p:last-of-type", content.description);
  write(".footer__bottom p:first-of-type", content.legal);
}

async function resolvePublicImage(value) {
  if (!value) return "";
  if (!STORAGE_PATH.test(value)) return value;
  const signed = await signPaths([value]);
  return signed.get(value) || "";
}

async function applySettings(settings = {}) {
  if (settings.site_name) {
    const brand = document.querySelector(".brand__name");
    splitTitle(brand, settings.site_name);
  }
  if (settings.locale) document.documentElement.lang = settings.locale;
  if (settings.seo_title) {
    document.title = settings.seo_title;
    setMeta('meta[property="og:title"]', settings.seo_title);
    setMeta('meta[name="twitter:title"]', settings.seo_title);
  }
  if (settings.seo_description) {
    setMeta('meta[name="description"]', settings.seo_description);
    setMeta('meta[property="og:description"]', settings.seo_description);
    setMeta('meta[name="twitter:description"]', settings.seo_description);
  }
  if (settings.site_url) {
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) canonical.setAttribute("href", settings.site_url);
    setMeta('meta[property="og:url"]', settings.site_url);
  }
  if (settings.contact_email) {
    document.querySelectorAll('a[href^="mailto:"]').forEach((link) => {
      link.href = `mailto:${settings.contact_email}`;
    });
  }
  if (settings.og_image_path) {
    const image = await resolvePublicImage(settings.og_image_path);
    setMeta('meta[property="og:image"]', image);
    setMeta('meta[name="twitter:image"]', image);
  }
}

export async function initPublicContent() {
  if (!isConfigured()) return;
  try {
    const [contentRows, settings] = await Promise.all([fetchSiteContent(), fetchSiteSettings()]);
    const content = new Map(contentRows.map((row) => [row.key, row.content || {}]));
    applyHero(content.get("hero"));
    applyAbout(content.get("about"));
    applyCapabilities(content.get("capabilities"));
    applyProcess(content.get("process"));
    applyContact(content.get("contact"));
    applyFooter(content.get("footer"));
    if (settings) await applySettings(settings);
  } catch (error) {
    console.warn("[content] Supabase content unavailable, keeping build-time copy.", error);
  }
}
