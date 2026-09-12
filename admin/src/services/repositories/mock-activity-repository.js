const ACTIVITY_KEY = "space-admin:activity:v1";
const MAX_ENTRIES = 20;

function readAll() {
  const stored = localStorage.getItem(ACTIVITY_KEY);
  if (!stored) return [];

  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const mockActivityRepository = {
  async list() {
    return readAll();
  },

  async add(entry) {
    const entries = readAll();
    entries.unshift({ ...entry, time: new Date().toISOString() });
    localStorage.setItem(ACTIVITY_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
    return entries[0];
  },
};

export function resetMockActivity() {
  localStorage.removeItem(ACTIVITY_KEY);
}
