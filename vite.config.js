import { defineConfig } from "vite";

import { readPlansBlock } from "./scripts/plans-block.mjs";
import { localizeHtmlSource } from "./src/scripts/localization.js";
import { renderPlanCards } from "./src/scripts/plans-renderer.js";
import {
  OG_IMAGE,
  OG_IMAGE_ALT,
  OG_IMAGE_HEIGHT,
  OG_IMAGE_WIDTH,
  ROUTES,
  SITE_DESCRIPTION,
  SITE_EMAIL,
  SITE_LOCALE,
  SITE_NAME,
  SITE_TITLE,
  SITE_URL,
  absoluteUrl,
} from "./site.config.js";

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// O tradutor legado tem duas regras sobrepostas ("PLAN /" e "PLAN"). Como a
// localizacao estatica ainda e aplicada uma unica vez no build, normalizamos a
// unica colisao conhecida aqui. O navegador nao executa mais o tradutor.
function normalizeLocalizedHtml(html) {
  const normalized = String(html).replaceAll("PLANOO", "PLANO");
  if (normalized.includes("PLANOO")) {
    throw new Error("A localizacao gerou texto recursivo de plano.");
  }
  return normalized;
}

// JSON-LD com fatos que estao na pagina e mais nada: sem endereco de rua, sem
// telefone, sem numero de funcionarios, sem nota/review. Se um dado nao aparece
// no site, ele nao entra aqui.
function renderJsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@type": "ProfessionalService",
    "@id": `${SITE_URL}#studio`,
    name: SITE_NAME,
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    email: SITE_EMAIL,
    image: absoluteUrl(OG_IMAGE),
    address: { "@type": "PostalAddress", addressCountry: "BR" },
    areaServed: "Mundial",
  };

  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}

function renderSeoHead() {
  const ogImage = absoluteUrl(OG_IMAGE);

  return [
    `<title>${escapeHtml(SITE_TITLE)}</title>`,
    `<meta name="description" content="${escapeHtml(SITE_DESCRIPTION)}">`,
    `<link rel="canonical" href="${escapeHtml(SITE_URL)}">`,
    "",
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}">`,
    `<meta property="og:locale" content="${escapeHtml(SITE_LOCALE)}">`,
    `<meta property="og:url" content="${escapeHtml(SITE_URL)}">`,
    `<meta property="og:title" content="${escapeHtml(SITE_TITLE)}">`,
    `<meta property="og:description" content="${escapeHtml(SITE_DESCRIPTION)}">`,
    `<meta property="og:image" content="${escapeHtml(ogImage)}">`,
    `<meta property="og:image:width" content="${OG_IMAGE_WIDTH}">`,
    `<meta property="og:image:height" content="${OG_IMAGE_HEIGHT}">`,
    `<meta property="og:image:alt" content="${escapeHtml(OG_IMAGE_ALT)}">`,
    "",
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escapeHtml(SITE_TITLE)}">`,
    `<meta name="twitter:description" content="${escapeHtml(SITE_DESCRIPTION)}">`,
    `<meta name="twitter:image" content="${escapeHtml(ogImage)}">`,
    "",
    renderJsonLd(),
  ]
    .map((line) => (line ? `    ${line}` : ""))
    .join("\n");
}

function renderRobots() {
  return ["User-agent: *", "Allow: /", "", `Sitemap: ${absoluteUrl("sitemap.xml")}`, ""].join("\n");
}

function renderSitemap() {
  const today = new Date().toISOString().slice(0, 10);
  const urls = ROUTES.map(
    (route) => `  <url>\n    <loc>${absoluteUrl(route)}</loc>\n    <lastmod>${today}</lastmod>\n  </url>`,
  ).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function render404() {
  const home = escapeHtml(SITE_URL);

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>404 — Sinal perdido | ${escapeHtml(SITE_NAME)}</title>
    <meta name="robots" content="noindex">
    <meta name="theme-color" content="#080808">
    <link rel="icon" href="${escapeHtml(absoluteUrl("favicon.svg"))}" type="image/svg+xml">
    <style>
      *, *::before, *::after { box-sizing: border-box; }
      body {
        display: grid;
        min-height: 100vh;
        margin: 0;
        padding: 2rem;
        place-content: center;
        background: #080808;
        color: #f2f2ee;
        font-family: "DM Mono", "SFMono-Regular", Consolas, monospace;
        text-align: left;
      }
      main { max-width: 34rem; }
      .code {
        margin: 0 0 1.75rem;
        color: #c6ff00;
        font-size: 0.7rem;
        letter-spacing: 0.28em;
        text-transform: uppercase;
      }
      h1 {
        margin: 0 0 1.5rem;
        font-family: "Space Grotesk", "Arial Black", sans-serif;
        font-size: clamp(2.75rem, 9vw, 5.5rem);
        font-weight: 500;
        line-height: 0.92;
        letter-spacing: -0.06em;
      }
      h1 em { color: #c6ff00; font-style: normal; }
      p {
        margin: 0 0 2.5rem;
        max-width: 30rem;
        color: #929292;
        font-size: 0.9rem;
        line-height: 1.7;
      }
      a {
        display: inline-flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.9rem 1.6rem;
        border: 1px solid #c6ff00;
        background: #c6ff00;
        color: #080808;
        font-size: 0.72rem;
        letter-spacing: 0.14em;
        text-decoration: none;
        text-transform: uppercase;
        transition: background 240ms ease, color 240ms ease;
      }
      a:hover, a:focus-visible { background: transparent; color: #c6ff00; }
      a:focus-visible { outline: 2px solid #c6ff00; outline-offset: 4px; }
      .mark {
        margin-top: 3.5rem;
        color: #5a5a5a;
        font-size: 0.6rem;
        letter-spacing: 0.2em;
        text-transform: uppercase;
      }
    </style>
  </head>
  <body>
    <main>
      <p class="code">Erro 404 — Sinal perdido</p>
      <h1>Esta página nunca <em>existiu.</em></h1>
      <p>O endereço acessado não leva a lugar nenhum. Tudo o que está no ar fica na superfície — volte ao início e comece por lá.</p>
      <a href="${home}">Voltar ao início <span aria-hidden="true">&rarr;</span></a>
      <p class="mark">${escapeHtml(SITE_NAME)} — Estúdio digital independente</p>
    </main>
  </body>
</html>
`;
}

function spaceUndergroundBuild() {
  return {
    name: "space-underground-build",

    transformIndexHtml: {
      order: "pre",
      handler(html, context) {
        if (context.filename && !context.filename.endsWith("index.html")) return html;

        if (!html.includes("<!--@seo-->")) throw new Error("index.html perdeu o marcador <!--@seo-->.");

        const { current } = readPlansBlock(html, context.filename || "index.html");
        if (current !== renderPlanCards()) {
          throw new Error(
            "Os cards de Plans no index.html nao batem com src/scripts/plans-registry.js. " +
              "Rode `npm run plans` para regerar o bloco (e nunca edite os cards a mao).",
          );
        }

        // A localizacao da fonte EN-first continua sendo feita uma unica vez no
        // build. A camada runtime foi removida para eliminar mutacoes recursivas.
        const localizedHtml = normalizeLocalizedHtml(localizeHtmlSource(html));

        return localizedHtml
          .replace("<!--@seo-->", renderSeoHead())
          .replace(/[ \t]*<!-- @plans:start[\s\S]*?-->\n?/, "")
          .replace(/[ \t]*<!-- @plans:end -->\n?/, "");
      },
    },

    generateBundle() {
      const files = {
        "robots.txt": renderRobots(),
        "sitemap.xml": renderSitemap(),
        "404.html": render404(),
      };

      for (const [fileName, source] of Object.entries(files)) {
        this.emitFile({ type: "asset", fileName, source });
      }
    },

    configureServer(server) {
      const routes = {
        "/robots.txt": ["text/plain", renderRobots],
        "/sitemap.xml": ["application/xml", renderSitemap],
        "/404.html": ["text/html", render404],
      };

      server.middlewares.use((request, response, next) => {
        const route = routes[request.url?.split("?")[0]];
        if (!route) return next();
        response.setHeader("Content-Type", `${route[0]}; charset=utf-8`);
        response.end(route[1]());
      });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [spaceUndergroundBuild()],
});
