import { fetchSiteContent, fetchSiteSettings, isConfigured } from "./supabase-public.js";

function write(selector, value) {
  const node = document.querySelector(selector);
  if (node && typeof value === "string" && value.trim()) node.textContent = value.trim();
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

function applySettings(settings = {}) {
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
  if (settings.locale) document.documentElement.lang = settings.locale;
  if (settings.seo_title) document.title = settings.seo_title;
  const description = document.querySelector('meta[name="description"]');
  if (description && settings.seo_description) description.content = settings.seo_description;
}

export async function initPublicContent() {
  if (!isConfigured()) return;
  try {
    const [contentRows, settings] = await Promise.all([fetchSiteContent(), fetchSiteSettings()]);
    const content = new Map(contentRows.map((row) => [row.key, row.content || {}]));
    applyHero(content.get("hero"));
    applyCapabilities(content.get("capabilities"));
    if (settings) applySettings(settings);
  } catch (error) {
    console.warn("[content] Supabase content unavailable, keeping build-time copy.", error);
  }
}
