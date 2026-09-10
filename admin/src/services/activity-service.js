import { getActivityRepository } from "./repositories/index.js";

export async function getActivity(options) {
  try {
    const repository = await getActivityRepository();
    return await repository.list(options);
  } catch {
    // The activity log is informational; never break a page over it.
    return [];
  }
}

export async function logActivity(title, detail, meta = {}) {
  try {
    const repository = await getActivityRepository();
    await repository.add({ title, detail, ...meta });
  } catch {
    // Same reasoning: a failed log entry must not fail the user's action.
  }
}
