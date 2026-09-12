import { getSettingsRepository } from "./repositories/index.js";

export async function getSiteSettings() {
  return (await getSettingsRepository()).get();
}

export async function saveSiteSettings(settings) {
  return (await getSettingsRepository()).save(settings);
}
