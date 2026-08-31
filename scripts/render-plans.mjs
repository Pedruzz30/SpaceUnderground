// Escreve os cards da secao 06 / Plans dentro do index.html, entre os
// marcadores @plans:start e @plans:end, a partir do plans-registry.js.
//
//   npm run plans
//
// Rode depois de mexer em preco, prazo, escopo ou no que esta incluso. O
// `npm run build` CONFERE se o bloco esta em dia e falha se nao estiver, entao
// esquecer de rodar isso quebra o build em vez de publicar preco errado.
//
// A ideia: o index.html continua completo e legivel sozinho (abre no editor e
// os planos estao la), mas quem manda continua sendo o registry — o HTML e
// saida, nao fonte.

import fs from "node:fs";

import { PLANS_END, PLANS_START, readPlansBlock } from "./plans-block.mjs";
import { renderPlanCards } from "../src/scripts/plans-renderer.js";

const FILE = "index.html";
const html = fs.readFileSync(FILE, "utf8");
const { before, current, after } = readPlansBlock(html, FILE);
const next = renderPlanCards();

if (current === next) {
  console.log("Plans: ja estava em dia, nada reescrito.");
  process.exit(0);
}

fs.writeFileSync(FILE, before + next + after);
console.log(`Plans: ${FILE} atualizado a partir de src/scripts/plans-registry.js.`);
