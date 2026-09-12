import { getActivityRepository } from "./repositories/index.js";

// Reports whether the read actually succeeded. Callers that need to tell an
// outage apart from an empty log (the Dashboard's system health) use this;
// everything else keeps the forgiving contract below.
export async function getActivityWithStatus(options) {
  try {
    const repository = await getActivityRepository();
    return { items: await repository.list(options), ok: true };
  } catch {
    return { items: [], ok: false };
  }
}

export async function getActivity(options) {
  // The activity log is informational; never break a page over it.
  const { items } = await getActivityWithStatus(options);
  return items;
}

export async function logActivity(title, detail, meta = {}) {
  try {
    const repository = await getActivityRepository();
    await repository.add({ title, detail, ...meta });
  } catch {
    // Same reasoning: a failed log entry must not fail the user's action.
  }
}
