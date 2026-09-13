import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

const { contentCompleteness, normalizeServiceStatus, serviceHealth } = await import("../src/utils/service-health.js");

function plan(overrides = {}) {
  return {
    name: "Pro",
    slug: "pro",
    range: "R$ 2.500 - R$ 4.500",
    timeline: "3-6 semanas",
    scope: "Sites institucionais",
    scopeShort: "Sites",
    description: "Presença digital completa.",
    status: "AVAILABLE",
    visible: true,
    features: [{ text: "Design responsivo", translations: { en: { text: "Responsive design" } } }],
    translations: {
      en: {
        timeline: "3-6 weeks",
        scope: "Institutional websites",
        scopeShort: "Websites",
        description: "Complete digital presence.",
      },
    },
    ...overrides,
  };
}

describe("service health", () => {
  it("marks a complete visible available plan as healthy", () => {
    assert.equal(serviceHealth(plan()).status, "healthy");
  });

  it("marks an available hidden plan as attention", () => {
    assert.equal(serviceHealth(plan({ visible: false })).status, "attention");
  });

  it("marks a plan missing the PT description as incomplete", () => {
    assert.equal(serviceHealth(plan({ description: "" })).status, "incomplete");
  });

  it("marks a plan without features as incomplete", () => {
    assert.equal(serviceHealth(plan({ features: [] })).status, "incomplete");
  });

  it("treats incomplete English as attention, not incomplete", () => {
    assert.equal(serviceHealth(plan({ translations: {}, features: [{ text: "Design responsivo", translations: {} }] })).status, "attention");
  });

  it("keeps archived hidden plans valid when the essentials are complete", () => {
    assert.equal(serviceHealth(plan({ status: "ARCHIVED", visible: false })).status, "healthy");
  });

  it("normalizes production legacy statuses before health checks", () => {
    assert.equal(normalizeServiceStatus("DISPONÍVEL"), "AVAILABLE");
    assert.equal(normalizeServiceStatus("SOB CONSULTA"), "ON_REQUEST");
    assert.equal(serviceHealth(plan({ status: "DISPONÍVEL" })).status, "healthy");
    assert.equal(serviceHealth(plan({ status: "SOB CONSULTA" })).status, "healthy");
  });
});

describe("service content completeness", () => {
  it("counts PT and EN content as 100 when translatable fields and features are filled", () => {
    assert.deepEqual(contentCompleteness(plan()), {
      pt: { done: 5, total: 5, percent: 100 },
      en: { done: 5, total: 5, percent: 100 },
    });
  });

  it("counts feature translations in the EN percentage", () => {
    const completeness = contentCompleteness(plan({ features: [{ text: "Design responsivo", translations: {} }] }));
    assert.equal(completeness.pt.percent, 100);
    assert.equal(completeness.en.percent, 80);
  });

  it("does not count structural fields", () => {
    const completeness = contentCompleteness(plan({ name: "", slug: "", range: "", status: "", position: 99, accent: "" }));
    assert.equal(completeness.pt.total, 5);
    assert.equal(completeness.en.total, 5);
  });
});
