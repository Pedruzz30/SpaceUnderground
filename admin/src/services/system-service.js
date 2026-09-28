import { DATA_SOURCE } from "../config/env.js";
import { t } from "../i18n/index.js";
import { HEALTH_MODULES, buildBackup, classifyFailure } from "../utils/settings-checks.js";
import { getActivityWithStatus } from "./activity-service.js";
import { getClients } from "./client-service.js";
import { getOpportunities } from "./commercial-service.js";
import { getSiteContent } from "./content-service.js";
import { toDataError } from "./errors.js";
import { getTransactions } from "./financial-service.js";
import { getPlans } from "./plan-service.js";
import { getProjects } from "./project-service.js";
import { getSiteSettings } from "./settings-service.js";

// The read that proves each module works. The same reads feed the backup, so
// "healthy" and "exportable" can never disagree.
const READERS = {
  projects: () => getProjects(),
  clients: () => getClients(),
  commercial: () => getOpportunities(),
  financial: () => getTransactions(),
  services: () => getPlans(),
  content: () => getSiteContent(),
  settings: () => getSiteSettings(),
  activity: async () => {
    const result = await getActivityWithStatus({ limit: 1000 });
    if (!result.ok) throw result.error ?? new Error("activity");
    return result.items;
  },
};

const countOf = (data) => (Array.isArray(data) ? data.length : data ? 1 : 0);

// Every module read in parallel, each one timed and classified on its own, so
// one missing table never hides the state of the others.
export async function checkModules({ clock = () => performance.now() } = {}) {
  return Promise.all(
    HEALTH_MODULES.map(async (module) => {
      const started = clock();
      try {
        const data = await READERS[module.key]();
        return { ...module, status: "ok", latency: Math.round(clock() - started), count: countOf(data), data };
      } catch (error) {
        const failure = toDataError(error, t("errors.generic"));
        return { ...module, status: classifyFailure(failure), latency: Math.round(clock() - started), count: null, message: failure.message, data: null };
      }
    }),
  );
}

// A fresh read of everything, as one JSON document. Media files, users and
// passwords are not in it: they live in Supabase Storage and Auth.
export async function exportBackup({ generatedAt = new Date().toISOString() } = {}) {
  const results = await checkModules();
  const modules = Object.fromEntries(results.filter((result) => result.status === "ok").map((result) => [result.key, result.data]));
  const failed = results.filter((result) => result.status !== "ok").map((result) => result.key);
  return { backup: buildBackup({ modules, failed, source: DATA_SOURCE, generatedAt }), results };
}
