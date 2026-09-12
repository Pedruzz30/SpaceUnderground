import { badge, badgeType } from "../components/badge.js";
import { statCard } from "../components/stat-card.js";
import { demoOpportunities, demoPipelineStages } from "../data/operations-demo.js";
import { t } from "../i18n/index.js";
import { escapeHtml } from "../utils/html.js";

function countStage(stage) {
  return demoOpportunities.filter((opportunity) => opportunity.stage === stage).length;
}

function renderMetrics() {
  const openLeads = demoOpportunities.filter((opportunity) => ["NEW", "CONTACTED"].includes(opportunity.stage)).length;

  return `
    ${statCard({ label: t("commercial.openLeads"), value: openLeads, detail: t("commercial.openLeadsDetail") })}
    ${statCard({ label: t("commercial.proposals"), value: countStage("PROPOSAL"), detail: t("commercial.proposalsDetail") })}
    ${statCard({ label: t("commercial.inNegotiation"), value: countStage("NEGOTIATION"), detail: t("commercial.inNegotiationDetail") })}
    ${statCard({ label: t("commercial.wonThisMonth"), value: countStage("WON"), detail: t("commercial.wonThisMonthDetail") })}
  `;
}

function opportunityCard(opportunity) {
  return `
    <article class="pipeline-card">
      <header class="pipeline-card__head">
        <span class="pipeline-card__client">${escapeHtml(opportunity.client)}</span>
        ${badge(opportunity.priority, badgeType(opportunity.priority))}
      </header>
      <p class="pipeline-card__type">${escapeHtml(opportunity.type)}</p>
      <p class="pipeline-card__range">${escapeHtml(opportunity.range)}</p>
      <span class="pipeline-card__foot">${escapeHtml(opportunity.activity)}</span>
    </article>
  `;
}

function stageColumn(stage) {
  const cards = demoOpportunities.filter((opportunity) => opportunity.stage === stage.id);

  return `
    <section class="pipeline__column" aria-label="${escapeHtml(stage.label)} ${t("common.status").toLowerCase()}">
      <header class="pipeline__head">
        <h3>${escapeHtml(stage.label)}</h3>
        <span class="pipeline__count">${cards.length}</span>
      </header>
      <div class="pipeline__body">
        ${cards.length ? cards.map(opportunityCard).join("") : `<p class="empty-inline" data-i18n="commercial.emptyStage">${t("commercial.emptyStage")}</p>`}
      </div>
    </section>
  `;
}

export const commercialPage = {
  title: () => t("commercial.title"),
  breadcrumb: () => t("commercial.breadcrumb"),
  render: () => `
    <section class="page-heading">
      <span data-i18n="commercial.eyebrow">${t("commercial.eyebrow")}</span>
      <h2 data-i18n="commercial.heading">${t("commercial.heading")}</h2>
      <p data-i18n="commercial.intro">${t("commercial.intro")}</p>
    </section>

    <section class="stats-grid stats-grid--quad" aria-label="${t("commercial.pipelineSummary")}">
      ${renderMetrics()}
    </section>

    <section class="panel">
      <header class="panel__head">
        <div>
          <span data-i18n="commercial.pipeline">${t("commercial.pipeline")}</span>
          <h3 data-i18n="commercial.opportunitiesByStage">${t("commercial.opportunitiesByStage")}</h3>
        </div>
        <span class="ops-note" data-i18n="commercial.scrollSideways">${t("commercial.scrollSideways")}</span>
      </header>
      <div class="pipeline" role="group" aria-label="${t("commercial.salesPipelineStages")}" tabindex="0">
        ${demoPipelineStages.map(stageColumn).join("")}
      </div>
      <p class="ops-note ops-note--spaced" data-i18n="commercial.note">${t("commercial.note")}</p>
    </section>
  `,
};
