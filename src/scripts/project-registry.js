// Registro unico dos projetos exibidos no PROJECT VIEWER da secao Selected Work.
// O frame e reutilizavel: um projeto por vez, sempre no mesmo iframe.
// Para publicar um slot reservado, troque `reserved: true` pelos dados reais
// (e tire o data-slot-reserved do botao do rail e da linha do indice no HTML).
// `accent` vira --accent no <article> e no .case-index, entao o card inteiro
// assume a cor do projeto: por isso o CSS desse escopo usa var(--accent).
// `poster` traz os tres formatos do <picture> (AVIF/WebP/PNG) mais as dimensoes
// reais do arquivo. Gerados por scripts/optimize-images.mjs; se trocar o PNG,
// rode o script de novo e atualize width/height aqui.

export const projects = {
  ink: {
    id: "001",
    name: "INK Tattoo",
    client: "INK TATTOO",
    category: "DIGITAL IDENTITY & PORTFOLIO",
    description: "A dark editorial experience built around tattoo culture, motion and visual depth.",
    url: "https://pedruzz30.github.io/TattooSite/",
    previewUrl: "https://pedruzz30.github.io/TattooSite/?embed=spaceunderground",
    poster: { avif: "./tattoo-preview-poster.avif", webp: "./tattoo-preview-poster.webp", png: "./tattoo-preview-poster.png", width: 1440, height: 900 },
    accent: "#c6ff00",
    system: "EXPERIENCE SYSTEM / 01",
    label: "PORTFOLIO",
    address: "INK TATTOO / PRODUCTION",
    type: "PORTFOLIO WEBSITE",
    tech: "HTML / CSS / JAVASCRIPT",
    status: "LIVE",
    year: "2026",
    modules: [
      ["01", "ART DIRECTION", "MONOCHROME DEPTH"],
      ["02", "INTERACTION", "FLUID MOTION"],
      ["03", "EXPERIENCE", "EDITORIAL RHYTHM"],
    ],
    origin: "RJ / BR",
    coordinates: ["22°54'S", "43°12'W"],
  },

  lucas: {
    id: "002",
    name: "Lucas Souza",
    client: "LUCAS SOUZA",
    category: "SPORTS NUTRITION EXPERIENCE",
    description: "Strategic digital presence designed around performance, credibility and conversion.",
    url: "https://pedruzz30.github.io/LucasNutri/",
    previewUrl: "https://pedruzz30.github.io/LucasNutri/?embed=spaceunderground",
    poster: { avif: "./LucasNutri.avif", webp: "./LucasNutri.webp", png: "./LucasNutri.png", width: 1849, height: 931 },
    accent: "#ff9d00",
    system: "PERFORMANCE SYSTEM / 02",
    label: "PERFORMANCE",
    address: "LUCAS SOUZA / PRODUCTION",
    type: "SPORTS NUTRITION WEBSITE",
    tech: "HTML / CSS / JAVASCRIPT",
    status: "LIVE",
    year: "2026",
    modules: [
      ["01", "PERFORMANCE", "SPORTS STRATEGY"],
      ["02", "COMPOSITION", "BODY GOALS"],
      ["03", "RECOVERY", "LONGEVITY"],
    ],
    origin: "RJ / BR",
    coordinates: ["22°54'S", "43°12'W"],
  },

  "slot-003": { id: "003", name: "Reserved", reserved: true },
  "slot-004": { id: "004", name: "Reserved", reserved: true },
  "slot-005": { id: "005", name: "Reserved", reserved: true },
};

// Case que abre a pagina. A ORDEM dos slots nao mora aqui: e a ordem dos
// <button data-project-slot> no rail do index.html (e das linhas do indice).
export const defaultProjectKey = "ink";
