import { badge, badgeType } from "../components/badge.js";
import { statCard } from "../components/stat-card.js";
import { demoOpportunities, demoPipelineStages } from "../data/operations-demo.js";
import { escapeHtml } from "../utils/html.js";

function countStage(stage) {
  return demoOpportunities.filter((opportunity) => opportunity.stage === stage).length;
}

function renderMetrics() {
  const openLeads = demoOpportunities.filter((opportunity) => ["NEW", "CONTACTED"].includes(opportunity.stage)).length;

  return `
    ${statCard({ label: "OPEN LEADS", value: openLeads, detail: "New and contacted" })}
    ${statCard({ label: "PROPOSALS", value: countStage("PROPOSAL"), detail: "Awaiting a decision" })}
    ${statCard({ label: "IN NEGOTIATION", value: countStage("NEGOTIATION"), detail: "Scope under review" })}
    ${statCard({ label: "WON THIS MONTH", value: countStage("WON"), detail: "Closed opportunities" })}
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
    <section class="pipeline__column" aria-label="${escapeHtml(stage.label)} stage">
      <header class="pipeline__head">
        <h3>${escapeHtml(stage.label)}</h3>
        <span class="pipeline__count">${cards.length}</span>
      </header>
      <div class="pipeline__body">
        ${cards.length ? cards.map(opportunityCard).join("") : '<p class="empty-inline">Empty stage.</p>'}
      </div>
    </section>
  `;
}

export const commercialPage = {
  title: "Commercial",
  breadcrumb: "OPERATIONS / COMMERCIAL",
  render: () => `
    <section class="page-heading">
      <span>COMMERCIAL</span>
      <h2>Sales pipeline.</h2>
      <p>Track opportunities from first contact to closing.</p>
    </section>

    <section class="stats-grid stats-grid--quad" aria-label="Pipeline summary">
      ${renderMetrics()}
    </section>

    <section class="panel">
      <header class="panel__head">
        <div>
          <span>PIPELINE</span>
          <h3>Opportunities by stage</h3>
        </div>
        <span class="ops-note">Scroll sideways for every stage</span>
      </header>
      <div class="pipeline" role="group" aria-label="Sales pipeline stages" tabindex="0">
        ${demoPipelineStages.map(stageColumn).join("")}
      </div>
      <p class="ops-note ops-note--spaced">Presentation data · moving a card is not persisted yet</p>
    </section>
  `,
};
