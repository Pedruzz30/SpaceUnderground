import { seedPlans } from "../../data/plans.js";

const PLANS_KEY = "space-admin:plans:v1";
const clone = (value) => JSON.parse(JSON.stringify(value));

function readAll() {
  const stored = localStorage.getItem(PLANS_KEY);
  if (!stored) {
    localStorage.setItem(PLANS_KEY, JSON.stringify(seedPlans));
    return clone(seedPlans);
  }
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : clone(seedPlans);
  } catch {
    localStorage.setItem(PLANS_KEY, JSON.stringify(seedPlans));
    return clone(seedPlans);
  }
}

function writeAll(plans) {
  localStorage.setItem(PLANS_KEY, JSON.stringify(plans));
}

export const mockPlanRepository = {
  async list() {
    return readAll().sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  },

  async update(id, patch) {
    const plans = readAll();
    const index = plans.findIndex((plan) => plan.id === id || plan.slug === id);
    if (index < 0) return null;
    plans[index] = {
      ...plans[index],
      ...patch,
      id: plans[index].id,
      features: Array.isArray(patch.features)
        ? patch.features.map((feature, featureIndex) => ({
          ...feature,
          id: feature.id || `mock-feature-${plans[index].id}-${crypto.randomUUID()}`,
          position: featureIndex,
        }))
        : plans[index].features,
      updatedAt: new Date().toISOString(),
    };
    writeAll(plans);
    return plans[index];
  },
};
