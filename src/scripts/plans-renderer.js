// Monta o HTML dos cards da secao 06 / Plans a partir do plans-registry.js.
//
// Roda em BUILD TIME, no plugin do vite.config.js, e nao no navegador: o
// index.html publicado ja sai com preco, prazo e escopo escritos. Isso mantem
// a fonte unica de verdade sem cobrar JS de quem le a pagina — crawler e
// visitante sem script veem os planos completos.
//
// Por isso este arquivo nao pode tocar em `document`: ele so devolve string.
// O markup abaixo e o mesmo que estava escrito a mao no index.html.

import { plans, planScopeLines } from "./plans-registry.js";

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function renderPlanCard(plan) {
  const label = `View plan: ${plan.name}`;
  const scope = planScopeLines(plan).map(escapeHtml).join("<br>");

  return `            <article class="project project--compact reveal" data-reveal>
              <a class="project__visual project__visual--plan" href="#project-preview" data-project="${escapeHtml(plan.key)}" aria-label="${escapeHtml(label)}">
                <div class="visual-index">PLAN / ${escapeHtml(plan.id)}</div>
                <div class="plan-card" aria-hidden="true">
                  <div class="plan-card__top"><span>PRICING PLAN</span><strong>${escapeHtml(plan.monogram)}</strong></div>
                  <div class="plan-card__body">
                    <span class="plan-card__eyebrow">PLAN</span>
                    <strong class="plan-card__name">${escapeHtml(plan.name)}</strong>
                    <span class="plan-card__range">${escapeHtml(plan.range)}</span>
                  </div>
                  <div class="plan-card__footer"><span>${escapeHtml(plan.scopeShort)}</span><span>${escapeHtml(plan.status)}</span></div>
                </div>
                <span class="project__hover-mark" aria-hidden="true">VIEW</span>
              </a>
              <div class="project__details project__details--stacked">
                <div>
                  <p class="project__meta">PRICING PLAN <span>YEAR — ${escapeHtml(plan.year)}</span></p>
                  <h3>${escapeHtml(plan.name)}</h3>
                </div>
                <p>${scope}</p>
                <a class="text-link" href="#project-preview" data-project="${escapeHtml(plan.key)}" aria-label="${escapeHtml(label)}"><span>View Plan</span><i aria-hidden="true"></i></a>
              </div>
            </article>`;
}

// Devolve o bloco exatamente como ele deve aparecer no index.html, entre os
// marcadores: comeca em nova linha e termina na indentacao do @plans:end.
// Quem escreve (scripts/render-plans.mjs) e quem confere (vite.config.js)
// comparam contra esta mesma string, entao o formato precisa ser unico.
export function renderPlanCards() {
  const cards = Object.values(plans);
  if (!cards.length) throw new Error("plans-registry.js esta vazio: a secao Plans sairia sem nenhum card.");
  return "\n" + cards.map(renderPlanCard).join("\n\n") + "\n            ";
}
