import { seedPlans } from "../../data/plans.js";

const PLANS_KEY = "space-admin:plans:v1";
const clone = (value) => JSON.parse(JSON.stringify(value));
const LEGACY_STATUSES = new Map([
  ["DISPONÍVEL", "AVAILABLE"],
  ["DISPONIVEL", "AVAILABLE"],
  ["SOB CONSULTA", "LIMITED"],
  ["ON REQUEST", "LIMITED"],
]);

function normalizeStatus(value) {
  const raw = String(value || "").trim();
  return LEGACY_STATUSES.get(raw.toUpperCase()) || raw || "UNAVAILABLE";
}

function normalizePlan(plan, index = 0) {
  return {
    ...plan,
    status: normalizeStatus(plan.status),
    visible: Boolean(plan.visible),
    position: Number.isFinite(Number(plan.position)) ? Number(plan.position) : index,
    features: Array.isArray(plan.features)
      ? plan.features.map((feature, featureIndex) => ({
          ...feature,
          id: feature.id || `mock-feature-${plan.id || plan.slug || featureIndex}-${crypto.randomUUID()}`,
          position: featureIndex,
        }))
      : [],
  };
}

function readAll() {
  const stored = localStorage.getItem(PLANS_KEY);
  if (!stored) {
    localStorage.setItem(PLANS_KEY, JSON.stringify(seedPlans));
    return clone(seedPlans).map(normalizePlan);
  }
  try {
    const parsed = JSON.parse(stored);
    return (Array.isArray(parsed) ? parsed : clone(seedPlans)).map(normalizePlan);
  } catch {
    localStorage.setItem(PLANS_KEY, JSON.stringify(seedPlans));
    return clone(seedPlans).map(normalizePlan);
  }
}

function writeAll(plans) {
  localStorage.setItem(PLANS_KEY, JSON.stringify(plans));
}

export const mockPlanRepository = {
  async list() {
    return readAll().sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  },

  async getById(id) {
    return readAll().find((plan) => plan.id === id || plan.slug === id) ?? null;
  },

  async create(data) {
    const plans = readAll();
    const now = new Date().toISOString();
    const slug = String(data.slug || crypto.randomUUID()).trim();
    const id = `mock-plan-${slug || crypto.randomUUID()}`;
    const created = normalizePlan(
      {
        ...data,
        id,
        slug,
        createdAt: now,
        updatedAt: now,
      },
      plans.length,
    );
    plans.push(created);
    writeAll(plans);
    return clone(created);
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
    return clone(plans[index]);
  },
};

export function resetMockPlans() {
  writeAll(clone(seedPlans));
}
