import { getPlanRepository } from "./repositories/index.js";

export async function getPlans() {
  return (await getPlanRepository()).list();
}

export async function updatePlan(id, patch) {
  const updated = await (await getPlanRepository()).update(id, patch);
  if (!updated) throw new Error("Plan not found.");
  return updated;
}
