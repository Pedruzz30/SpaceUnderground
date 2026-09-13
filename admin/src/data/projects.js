export const CATEGORIES = ["Website", "System", "Automation", "AI", "Other"];

export const PROJECT_STATUSES = ["Live", "Prototype", "MVP", "Pilot", "In Development", "Research", "Archived"];

export const EDITORIAL_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"];

const mockPoster = (accent, label) =>
  `data:image/svg+xml,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 750">
      <rect width="1200" height="750" fill="#080808"/>
      <rect x="58" y="58" width="1084" height="634" fill="none" stroke="${accent}" stroke-width="4"/>
      <circle cx="600" cy="375" r="150" fill="none" stroke="${accent}" stroke-opacity=".42" stroke-width="3"/>
      <text x="96" y="132" fill="${accent}" font-family="monospace" font-size="34">SPACE UNDERGROUND</text>
      <text x="96" y="636" fill="#f2f2ee" font-family="monospace" font-size="56">${label}</text>
    </svg>
  `)}`;

export const seedProjects = [
  {
    id: "001",
    caseNumber: "001",
    name: "INK Tattoo",
    slug: "ink-tattoo",
    client: "INK Tattoo",
    category: "Website",
    description: "Dark editorial website for a tattoo studio, built around visual depth, motion and brand presence.",
    status: "Live",
    editorialStatus: "PUBLISHED",
    featured: true,
    visible: true,
    year: "2026",
    accent: "#c6ff00",
    techStack: ["HTML", "CSS", "JavaScript"],
    presentation: {
      system: "SISTEMA DE EXPERIÊNCIA / 01",
      label: "PORTFÓLIO",
      address: "INK TATTOO / PRODUÇÃO",
      type: "SITE DE PORTFÓLIO",
      origin: "RJ / BR",
      coordinates: ["22°54'S", "43°12'W"],
    },
    modules: [
      { id: "mock-001-01", position: 0, code: "01", title: "DIREÇÃO DE ARTE", description: "PROFUNDIDADE MONOCROMÁTICA" },
      { id: "mock-001-02", position: 1, code: "02", title: "INTERAÇÃO", description: "MOVIMENTO FLUIDO" },
      { id: "mock-001-03", position: 2, code: "03", title: "EXPERIÊNCIA", description: "RITMO EDITORIAL" },
    ],
    poster: mockPoster("#c6ff00", "CASE 001 / INK TATTOO"),
    gallery: [],
    projectUrl: "https://pedruzz30.github.io/TattooSite/",
    previewUrl: "https://pedruzz30.github.io/TattooSite/?embed=spaceunderground",
    livePreviewEnabled: true,
    createdAt: "2026-09-04T12:00:00.000Z",
    updatedAt: "2026-09-04T12:00:00.000Z",
    publishedAt: "2026-09-04T12:00:00.000Z",
  },
  {
    id: "002",
    caseNumber: "002",
    name: "Lucas Souza",
    slug: "lucas-souza",
    client: "Lucas Souza",
    category: "Website",
    description: "Strategic digital presence for sports nutrition, focused on credibility, performance and conversion.",
    status: "Live",
    editorialStatus: "PUBLISHED",
    featured: true,
    visible: true,
    year: "2026",
    accent: "#ff9d00",
    techStack: ["HTML", "CSS", "JavaScript"],
    presentation: {
      system: "SISTEMA DE PERFORMANCE / 02",
      label: "PERFORMANCE",
      address: "LUCAS SOUZA / PRODUÇÃO",
      type: "SITE DE NUTRIÇÃO ESPORTIVA",
      origin: "RJ / BR",
      coordinates: ["22°54'S", "43°12'W"],
    },
    modules: [
      { id: "mock-002-01", position: 0, code: "01", title: "PERFORMANCE", description: "ESTRATÉGIA ESPORTIVA" },
      { id: "mock-002-02", position: 1, code: "02", title: "COMPOSIÇÃO", description: "OBJETIVOS CORPORAIS" },
      { id: "mock-002-03", position: 2, code: "03", title: "RECUPERAÇÃO", description: "LONGEVIDADE" },
    ],
    poster: mockPoster("#ff9d00", "CASE 002 / LUCAS SOUZA"),
    gallery: [],
    projectUrl: "https://pedruzz30.github.io/LucasNutri/",
    previewUrl: "https://pedruzz30.github.io/LucasNutri/?embed=spaceunderground",
    livePreviewEnabled: true,
    createdAt: "2026-09-04T12:00:00.000Z",
    updatedAt: "2026-09-04T12:00:00.000Z",
    publishedAt: "2026-09-04T12:00:00.000Z",
  },
];
