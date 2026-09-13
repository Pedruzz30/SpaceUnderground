// Monta o HTML dos cards da secao 06 / Plans a partir do plans-registry.js.
//
// Roda em BUILD TIME, no plugin do vite.config.js, e nao no navegador: o
// index.html publicado ja sai com preco, prazo e escopo escritos. Isso mantem
// a fonte unica de verdade sem cobrar JS de quem le a pagina — crawler e
// visitante sem script veem os planos completos.
//
// Por isso este arquivo nao pode tocar em `document`: ele so devolve string.
// O markup abaixo e o mesmo que estava escrito a mao no index.html.

import { commercialPlan, plans, planScopeLines } from "./plans-registry.js";
import { serviceStatusLabel } from "./service-status.js";

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function renderPlanCard(plan) {
  const localizedPlan = commercialPlan(plan);
  const status = serviceStatusLabel(localizedPlan.status, "pt-BR");
  const label = `Ver plano: ${localizedPlan.name}`;
  const scope = planScopeLines({ ...localizedPlan, status })
    .map((line) => line.replace("SCOPE —", "ESCOPO —").replace("RANGE —", "INVESTIMENTO —"))
    .map(escapeHtml)
    .join("<br>");

  return `            <article class="project project--compact reveal" data-reveal>
              <a class="project__visual project__visual--plan" href="#project-preview" data-project="${escapeHtml(localizedPlan.key)}" aria-label="${escapeHtml(label)}">
                <div class="visual-index">PLANO / ${escapeHtml(localizedPlan.id)}</div>
                <div class="plan-card" aria-hidden="true">
                  <div class="plan-card__top"><span>PLANO COMERCIAL</span><strong>${escapeHtml(localizedPlan.monogram)}</strong></div>
                  <div class="plan-card__body">
                    <span class="plan-card__eyebrow">PLANO</span>
                    <strong class="plan-card__name">${escapeHtml(localizedPlan.name)}</strong>
                    <span class="plan-card__range">${escapeHtml(localizedPlan.range)}</span>
                  </div>
                  <div class="plan-card__footer"><span>${escapeHtml(localizedPlan.scopeShort)}</span><span>${escapeHtml(status)}</span></div>
                </div>
                <span class="project__hover-mark" aria-hidden="true">VER</span>
              </a>
              <div class="project__details project__details--stacked">
                <div>
                  <p class="project__meta">PLANO COMERCIAL <span>ANO — ${escapeHtml(localizedPlan.year)}</span></p>
                  <h3>${escapeHtml(localizedPlan.name)}</h3>
                </div>
                <p>${scope}</p>
                <a class="text-link" href="#project-preview" data-project="${escapeHtml(localizedPlan.key)}" aria-label="${escapeHtml(label)}"><span>Ver plano</span><i aria-hidden="true"></i></a>
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
