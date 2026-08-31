// Registro unico dos projetos exibidos no PROJECT VIEWER da secao Selected Work.
// O frame CASE / 001 e reutilizavel: um projeto por vez, sempre no mesmo iframe.
// Para publicar um slot reservado, troque `reserved: true` pelos dados reais.

export const projects = {
  ink: {
    id: "001",
    name: "INK Tattoo",
    client: "INK TATTOO",
    category: "DIGITAL IDENTITY & PORTFOLIO",
    description: "A dark editorial experience built around tattoo culture, motion and visual depth.",
    url: "https://pedruzz30.github.io/TattooSite/",
    previewUrl: "https://pedruzz30.github.io/TattooSite/?embed=spaceunderground",
    poster: "./tattoo-preview-poster.png",
    accent: "#c6ff00",
    system: "EXPERIENCE SYSTEM / 01",
    label: "PORTFÓLIO",
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
    poster: "./LucasNutri.png",
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

// Ordem dos quadrados na coluna esquerda do frame.
export const projectOrder = ["ink", "lucas", "slot-003", "slot-004", "slot-005"];

export const defaultProjectKey = "ink";
