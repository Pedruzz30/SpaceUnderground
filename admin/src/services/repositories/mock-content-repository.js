import { seedSiteContent } from "../../data/plans.js";

const CONTENT_KEY = "space-admin:site-content:v1";
const clone = (value) => JSON.parse(JSON.stringify(value));

function readAll() {
  const stored = localStorage.getItem(CONTENT_KEY);
  if (!stored) {
    localStorage.setItem(CONTENT_KEY, JSON.stringify(seedSiteContent));
    return clone(seedSiteContent);
  }
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : clone(seedSiteContent);
  } catch {
    localStorage.setItem(CONTENT_KEY, JSON.stringify(seedSiteContent));
    return clone(seedSiteContent);
  }
}

export const mockContentRepository = {
  async list() {
    return readAll();
  },

  async upsert(entry) {
    const entries = readAll();
    const index = entries.findIndex((item) => item.key === entry.key);
    const next = { ...entry, updatedAt: new Date().toISOString() };
    if (index >= 0) entries[index] = next;
    else entries.push(next);
    localStorage.setItem(CONTENT_KEY, JSON.stringify(entries));
    return next;
  },
};
