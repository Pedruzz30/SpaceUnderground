import { seedSiteSettings } from "../../data/plans.js";

const SETTINGS_KEY = "space-admin:site-settings:v1";
const clone = (value) => JSON.parse(JSON.stringify(value));

function read() {
  const stored = localStorage.getItem(SETTINGS_KEY);
  if (!stored) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(seedSiteSettings));
    return clone(seedSiteSettings);
  }
  try {
    return { ...clone(seedSiteSettings), ...JSON.parse(stored) };
  } catch {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(seedSiteSettings));
    return clone(seedSiteSettings);
  }
}

export const mockSettingsRepository = {
  async get() {
    return read();
  },

  async save(settings) {
    const next = { ...read(), ...settings, updatedAt: new Date().toISOString() };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    return next;
  },
};
