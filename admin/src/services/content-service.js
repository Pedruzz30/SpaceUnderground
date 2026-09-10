import { getContentRepository } from "./repositories/index.js";

export async function getSiteContent() {
  return (await getContentRepository()).list();
}

export async function saveSiteContent(entry) {
  return (await getContentRepository()).upsert(entry);
}
