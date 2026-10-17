// Injects the "operação contínua" section after the pricing plans. The
// section exists to make the Strategy 001 rule explicit: every case points
// to a service the client can keep contracting — maintenance, SLA, recurring
// automation and continuous analytics.
//
// Static copy is translated via data-i18n on every render; per-package
// details come from recurring-registry.js and run through t() once at paint
// time (the inner markup is re-rendered on locale change by applyStatic-
// Translations the same way it is for Capabilities).

import { getLocale, subscribeLocaleChange, t } from "./i18n/index.js";
import { RECURRING_PACKAGES } from "./recurring-registry.js";

const SECTION_ID = "recurring";
let rendered = false;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cardMarkup(pkg) {
  const includes = pkg.includes
    .map((key) => `<li data-i18n="${key}">${escapeHtml(t(key))}</li>`)
    .join("");
  const recommended = pkg.recommendedFor
    .map((cat) => `<span data-i18n="work.categories.${cat}">${escapeHtml(t(`work.categories.${cat}`))}</span>`)
    .join("");
  return `
    <article class="recurring-card${pkg.featured ? " recurring-card--featured" : ""} reveal" data-reveal style="--recurring-accent:${pkg.accent}">
      <header class="recurring-card__head">
        <span class="recurring-card__index">${escapeHtml(pkg.index)}</span>
        <strong class="recurring-card__mono" aria-hidden="true">${escapeHtml(pkg.monogram)}</strong>
      </header>
      <div class="recurring-card__body">
        <p class="recurring-card__kicker" data-i18n="${pkg.kickerKey}">${escapeHtml(t(pkg.kickerKey))}</p>
        <h3 class="recurring-card__name" data-i18n="${pkg.nameKey}">${escapeHtml(t(pkg.nameKey))}</h3>
        <p class="recurring-card__scope" data-i18n="${pkg.scopeKey}">${escapeHtml(t(pkg.scopeKey))}</p>
      </div>
      <div class="recurring-card__price">
        <b>${escapeHtml(pkg.priceLabel)}</b>
        <small data-i18n="${pkg.cadenceKey}">${escapeHtml(t(pkg.cadenceKey))}</small>
      </div>
      <ul class="recurring-card__includes">${includes}</ul>
      <div class="recurring-card__meta">
        <span class="recurring-card__for" data-i18n="recurring.recommendedFor">${escapeHtml(t("recurring.recommendedFor"))}</span>
        <div class="recurring-card__tags">${recommended}</div>
      </div>
      <a class="recurring-card__cta" href="#project-request" data-recurring="${escapeHtml(pkg.id)}">
        <span data-i18n="recurring.cta">${escapeHtml(t("recurring.cta"))}</span>
        <i aria-hidden="true">↗</i>
      </a>
    </article>
  `;
}

function sectionMarkup() {
  const grid = RECURRING_PACKAGES.map(cardMarkup).join("");
  return `
    <div class="container">
      <header class="section-heading section-heading--row reveal" data-reveal>
        <div>
          <p class="section-label"><span>10</span> <span data-i18n="recurring.label">${t("recurring.label")}</span></p>
          <h2 id="recurring-title" data-i18n-html="recurring.title">${t("recurring.title")}</h2>
        </div>
        <p class="section-intro" data-i18n="recurring.intro">${t("recurring.intro")}</p>
      </header>
      <div class="recurring__grid">${grid}</div>
      <p class="recurring__footnote reveal" data-reveal data-i18n="recurring.footnote">${t("recurring.footnote")}</p>
    </div>
  `;
}

export function initRecurringSection() {
  if (document.getElementById(SECTION_ID)) return;
  // Anchors to the plans section so the recurring tier reads as the natural
  // sequel to one-off engagements. Falls back to appending into main if
  // plans is missing (e.g. an admin-stripped layout).
  const plans = document.getElementById("plans");
  const why = document.getElementById("why");
  const anchor = plans || why;
  if (!anchor) return;

  const section = document.createElement("section");
  section.className = "section recurring";
  section.id = SECTION_ID;
  section.setAttribute("aria-labelledby", "recurring-title");
  section.innerHTML = sectionMarkup();

  if (plans) plans.after(section);
  else anchor.before(section);

  rendered = true;

  // Locale changes re-render the whole inner markup so numeric/string copy
  // from the registry (kickers, scopes, includes, recommendedFor labels)
  // stays in sync — applyStaticTranslations only touches data-i18n nodes
  // whose text keys do not depend on the registry.
  subscribeLocaleChange(() => {
    if (!rendered) return;
    section.innerHTML = sectionMarkup();
  });
}
