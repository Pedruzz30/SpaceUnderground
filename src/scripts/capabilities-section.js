import { t } from "./i18n/index.js";

// Case references ("CASE 001", "JARVIS") are project identifiers, not copy, so
// they stay the same in both locales. Everything else is marked up and picked
// up by applyStaticTranslations() on a locale change -- the section is built
// once and never rebuilt.
export function initCapabilitiesSection() {
  const services = document.querySelector("#services");
  const work = document.querySelector("#work");
  if (!services || !work || document.querySelector("#capabilities")) return;

  const section = document.createElement("section");
  section.className = "section capabilities";
  section.id = "capabilities";
  section.setAttribute("aria-labelledby", "capabilities-title");
  section.innerHTML = `
    <div class="container">
      <header class="section-heading section-heading--row reveal" data-reveal>
        <div>
          <p class="section-label"><span>CAP</span> <span data-i18n="capabilities.label">${t("capabilities.label")}</span></p>
          <h2 id="capabilities-title" data-i18n-html="capabilities.title">${t("capabilities.title")}</h2>
        </div>
        <p class="section-intro" data-i18n="capabilities.intro">${t("capabilities.intro")}</p>
      </header>

      <div class="capabilities__rail" aria-label="${t("capabilities.rail")}" data-i18n-aria-label="capabilities.rail">
        <article class="capability-card reveal" data-reveal style="--capability-accent:#c6ff00">
          <div class="capability-card__top"><span>01</span><i aria-hidden="true"></i></div>
          <p class="capability-card__kicker" data-i18n="capabilities.sitesKicker">${t("capabilities.sitesKicker")}</p>
          <h3 data-i18n="capabilities.sitesTitle">${t("capabilities.sitesTitle")}</h3>
          <p data-i18n="capabilities.sitesText">${t("capabilities.sitesText")}</p>
          <div class="capability-card__cases"><span>CASE 001</span><span>CASE 002</span></div>
          <a href="#work"><span data-i18n="capabilities.sitesLink">${t("capabilities.sitesLink")}</span> <b aria-hidden="true">↗</b></a>
        </article>

        <article class="capability-card reveal" data-reveal style="--capability-accent:#22c55e">
          <div class="capability-card__top"><span>02</span><i aria-hidden="true"></i></div>
          <p class="capability-card__kicker" data-i18n="capabilities.systemsKicker">${t("capabilities.systemsKicker")}</p>
          <h3 data-i18n="capabilities.systemsTitle">${t("capabilities.systemsTitle")}</h3>
          <p data-i18n="capabilities.systemsText">${t("capabilities.systemsText")}</p>
          <div class="capability-card__cases"><span>CASE 004</span><span>CASE 005</span></div>
          <a href="#work"><span data-i18n="capabilities.systemsLink">${t("capabilities.systemsLink")}</span> <b aria-hidden="true">↗</b></a>
        </article>

        <article class="capability-card reveal" data-reveal style="--capability-accent:#38bdf8">
          <div class="capability-card__top"><span>03</span><i aria-hidden="true"></i></div>
          <p class="capability-card__kicker" data-i18n="capabilities.automationKicker">${t("capabilities.automationKicker")}</p>
          <h3 data-i18n="capabilities.automationTitle">${t("capabilities.automationTitle")}</h3>
          <p data-i18n="capabilities.automationText">${t("capabilities.automationText")}</p>
          <div class="capability-card__cases"><span>CASE 003</span><span>CASE 004</span></div>
          <a href="#work"><span data-i18n="capabilities.automationLink">${t("capabilities.automationLink")}</span> <b aria-hidden="true">↗</b></a>
        </article>

        <article class="capability-card capability-card--featured reveal" data-reveal style="--capability-accent:#f59e0b">
          <div class="capability-card__top"><span>04</span><i aria-hidden="true"></i></div>
          <p class="capability-card__kicker" data-i18n="capabilities.aiKicker">${t("capabilities.aiKicker")}</p>
          <h3 data-i18n="capabilities.aiTitle">${t("capabilities.aiTitle")}</h3>
          <p data-i18n="capabilities.aiText">${t("capabilities.aiText")}</p>
          <div class="capability-card__cases"><span>CASE 003 / JARVIS</span></div>
          <a href="./jarvis-case/"><span data-i18n="capabilities.aiLink">${t("capabilities.aiLink")}</span> <b aria-hidden="true">↗</b></a>
        </article>
      </div>

      <div class="capabilities__statement reveal" data-reveal>
        <span data-i18n="capabilities.statementLabel">${t("capabilities.statementLabel")}</span>
        <p><b data-i18n="capabilities.sitesTitle">${t("capabilities.sitesTitle")}</b><i>→</i><b data-i18n="capabilities.systemsTitle">${t("capabilities.systemsTitle")}</b><i>→</i><b data-i18n="capabilities.automationTitle">${t("capabilities.automationTitle")}</b><i>→</i><b data-i18n="capabilities.aiTitle">${t("capabilities.aiTitle")}</b></p>
        <small data-i18n="capabilities.statementNote">${t("capabilities.statementNote")}</small>
      </div>
    </div>
  `;

  work.before(section);
}
