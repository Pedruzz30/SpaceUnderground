export const CATEGORIES = ["Website", "System", "Automation", "AI", "Other"];

export const PROJECT_STATUSES = ["Live", "Prototype", "MVP", "Pilot", "In Development", "Research", "Archived"];

export const EDITORIAL_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"];

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
    poster: "../tattoo-preview-poster.png",
    gallery: [],
    projectUrl: "https://pedruzz30.github.io/TattooSite/",
    previewUrl: "https://pedruzz30.github.io/TattooSite/?embed=spaceunderground",
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
    poster: "../LucasNutri.png",
    gallery: [],
    projectUrl: "https://pedruzz30.github.io/LucasNutri/",
    previewUrl: "https://pedruzz30.github.io/LucasNutri/?embed=spaceunderground",
    createdAt: "2026-09-04T12:00:00.000Z",
    updatedAt: "2026-09-04T12:00:00.000Z",
    publishedAt: "2026-09-04T12:00:00.000Z",
  },
];
