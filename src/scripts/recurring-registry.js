// Recurring service packages. Phase 5 of Strategy 001 — monetização contínua.
//
// The runtime registry is intentionally bundled: these packages are a
// commercial statement, not editorial content, and need to render reliably
// even when Supabase is unavailable. When they graduate to a CMS, this file
// becomes the fallback the same way project-fallback.js is for cases.
//
// `recommendedFor` lists the project categories the package pairs with — used
// to render a per-case upsell hint and to filter the section by relevance.

export const RECURRING_PACKAGES = [
  {
    id: "essential",
    monogram: "E+",
    index: "01",
    nameKey: "recurring.packages.essential.name",
    kickerKey: "recurring.packages.essential.kicker",
    priceLabel: "R$ 450",
    cadenceKey: "recurring.cadence.monthly",
    scopeKey: "recurring.packages.essential.scope",
    includes: [
      "recurring.packages.essential.i1",
      "recurring.packages.essential.i2",
      "recurring.packages.essential.i3",
      "recurring.packages.essential.i4",
    ],
    recommendedFor: ["website"],
    accent: "#c6ff00",
  },
  {
    id: "operational",
    monogram: "OP",
    index: "02",
    nameKey: "recurring.packages.operational.name",
    kickerKey: "recurring.packages.operational.kicker",
    priceLabel: "R$ 1.800",
    cadenceKey: "recurring.cadence.monthly",
    scopeKey: "recurring.packages.operational.scope",
    includes: [
      "recurring.packages.operational.i1",
      "recurring.packages.operational.i2",
      "recurring.packages.operational.i3",
      "recurring.packages.operational.i4",
    ],
    recommendedFor: ["commerce", "system", "booking"],
    accent: "#38bdf8",
    featured: true,
  },
  {
    id: "automation",
    monogram: "AU",
    index: "03",
    nameKey: "recurring.packages.automation.name",
    kickerKey: "recurring.packages.automation.kicker",
    priceLabel: "R$ 2.400",
    cadenceKey: "recurring.cadence.monthly",
    scopeKey: "recurring.packages.automation.scope",
    includes: [
      "recurring.packages.automation.i1",
      "recurring.packages.automation.i2",
      "recurring.packages.automation.i3",
      "recurring.packages.automation.i4",
    ],
    recommendedFor: ["automation", "ai"],
    accent: "#fb923c",
  },
  {
    id: "analytics",
    monogram: "AN",
    index: "04",
    nameKey: "recurring.packages.analytics.name",
    kickerKey: "recurring.packages.analytics.kicker",
    priceLabel: "R$ 1.200",
    cadenceKey: "recurring.cadence.monthly",
    scopeKey: "recurring.packages.analytics.scope",
    includes: [
      "recurring.packages.analytics.i1",
      "recurring.packages.analytics.i2",
      "recurring.packages.analytics.i3",
      "recurring.packages.analytics.i4",
    ],
    recommendedFor: ["website", "commerce"],
    accent: "#ff6ad5",
  },
];
