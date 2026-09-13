// Localiza o bloco de planos dentro do index.html. Usado por quem escreve
// (scripts/render-plans.mjs) e por quem confere (o plugin do vite.config.js),
// para que os dois concordem sobre onde o bloco comeca e termina.

export const PLANS_START = "<!-- @plans:start";
export const PLANS_END = "<!-- @plans:end -->";

export function readPlansBlock(html, file = "index.html") {
  const startTag = html.indexOf(PLANS_START);
  const end = html.indexOf(PLANS_END);

  if (startTag < 0 || end < 0 || end < startTag) {
    throw new Error(`${file} perdeu os marcadores ${PLANS_START} ... ${PLANS_END} da secao Plans.`);
  }

  // O comentario de abertura e multilinha: o conteudo comeca depois do "-->".
  const startClose = html.indexOf("-->", startTag);
  if (startClose < 0 || startClose > end) {
    throw new Error(`${file}: o comentario ${PLANS_START} nao foi fechado antes de ${PLANS_END}.`);
  }

  return {
    before: html.slice(0, startClose + 3),
    current: html.slice(startClose + 3, end),
    after: html.slice(end),
  };
}

// Um checkout no Windows com core.autocrlf=true entrega o index.html em CRLF,
// enquanto renderPlanCards() sempre gera LF. Comparar cru fazia o guard acusar
// divergencia em toda maquina Windows, com o build quebrado e nenhum card fora
// de lugar. A diferenca que importa e conteudo, nao fim de linha.
const normalizeEol = (value) => String(value).replace(/\r\n/g, "\n");

export function plansBlockMatches(current, expected) {
  return normalizeEol(current) === normalizeEol(expected);
}
