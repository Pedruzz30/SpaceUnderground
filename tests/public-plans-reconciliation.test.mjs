import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  getPublicPlan,
  listPublicPlans,
  refreshPublicPlansForLocale,
  resetPublicPlansToFallback,
  setPublicPlanRows,
} from "../src/scripts/public-plan-store.js";
import { plans } from "../src/scripts/plans-registry.js";
import { normalizeServiceStatus, serviceStatusLabel } from "../src/scripts/service-status.js";

const plus = { slug: "plan-plus", name: "Plus", range: "R$ 800", scope: "Landing", scope_short: "Landing", status: "DISPONÍVEL", description: "Plus PT", timeline: "1 semana", position: 0, plan_features: [{ text: "Design", position: 0 }] };
const pro = { slug: "plan-pro", name: "Pro", range: "R$ 2.500", scope: "Site", scope_short: "Site", status: "AVAILABLE", description: "Pro PT", timeline: "3 semanas", position: 1, plan_features: [{ text: "SEO", position: 0 }] };
const beta = { slug: "beta", name: "Beta", range: "R$ 9.000", scope: "Sistema", scope_short: "Sistema", status: "ON_REQUEST", description: "Beta PT", timeline: "8 semanas", position: 2, plan_features: [{ text: "Portal", position: 0 }] };

describe("public plan status normalization", () => {
  it("normalizes legacy and canonical status values", () => {
    assert.equal(normalizeServiceStatus("DISPONÍVEL"), "AVAILABLE");
    assert.equal(normalizeServiceStatus("SOB CONSULTA"), "ON_REQUEST");
    assert.equal(normalizeServiceStatus("ON_REQUEST"), "ON_REQUEST");
    assert.equal(serviceStatusLabel("SOB CONSULTA", "en"), "ON REQUEST");
    assert.equal(serviceStatusLabel("ON_REQUEST", "pt-BR"), "SOB CONSULTA");
  });
});

describe("public plan runtime store", () => {
  it("keeps fallback statuses canonical and localizes their labels", () => {
    assert.equal(plans.plus.status, "AVAILABLE");
    assert.equal(plans.plus.commercial.status, "AVAILABLE");
    assert.equal(plans.pro.status, "AVAILABLE");
    assert.equal(plans.pro.commercial.status, "AVAILABLE");
    assert.equal(plans.max.status, "ON_REQUEST");
    assert.equal(plans.max.commercial.status, "ON_REQUEST");

    resetPublicPlansToFallback("pt-BR");
    assert.deepEqual(listPublicPlans().map((plan) => [plan.slug, plan.status, plan.statusLabel]), [
      ["plan-plus", "AVAILABLE", "DISPONÍVEL"],
      ["plan-pro", "AVAILABLE", "DISPONÍVEL"],
      ["plan-max", "ON_REQUEST", "SOB CONSULTA"],
    ]);

    refreshPublicPlansForLocale("en");
    assert.deepEqual(listPublicPlans().map((plan) => [plan.slug, plan.status, plan.statusLabel]), [
      ["plan-plus", "AVAILABLE", "AVAILABLE"],
      ["plan-pro", "AVAILABLE", "AVAILABLE"],
      ["plan-max", "ON_REQUEST", "ON REQUEST"],
    ]);
  });

  it("treats successful Supabase rows as authoritative", () => {
    setPublicPlanRows([plus, pro], "pt-BR");
    assert.deepEqual(listPublicPlans().map((plan) => plan.slug), ["plan-plus", "plan-pro"]);
  });

  it("keeps plans that do not exist in the static registry", () => {
    setPublicPlanRows([plus, pro, beta], "pt-BR");
    const live = getPublicPlan("beta");
    assert.equal(live.name, "Beta");
    assert.equal(live.statusLabel, "SOB CONSULTA");
    assert.deepEqual(live.included, ["Portal"]);
  });

  it("removes every runtime card when Supabase returns an empty successful array", () => {
    setPublicPlanRows([], "pt-BR");
    assert.deepEqual(listPublicPlans(), []);
  });

  it("orders runtime plans by position and assigns visual indexes after sorting", () => {
    setPublicPlanRows([beta, plus, pro], "pt-BR");
    assert.deepEqual(listPublicPlans().map((plan) => `${plan.id}:${plan.slug}`), ["001:plan-plus", "002:plan-pro", "003:beta"]);
  });

  it("rerenders locale from cached rows without needing another fetch", () => {
    setPublicPlanRows([{ ...beta, translations: { en: { scope: "System", scope_short: "System", description: "Beta EN", timeline: "8 weeks" } } }], "pt-BR");
    assert.equal(getPublicPlan("beta").description, "Beta PT");
    refreshPublicPlansForLocale("en");
    assert.equal(getPublicPlan("beta").description, "Beta EN");
    assert.equal(getPublicPlan("beta").statusLabel, "ON REQUEST");
  });

  it("can reset to immutable static fallback after a backend failure", () => {
    resetPublicPlansToFallback("pt-BR");
    assert.deepEqual(listPublicPlans().map((plan) => plan.slug), ["plan-plus", "plan-pro", "plan-max"]);
  });
});
