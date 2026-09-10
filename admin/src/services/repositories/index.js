import { isSupabaseMode } from "../../config/env.js";
import { mockActivityRepository } from "./mock-activity-repository.js";
import { mockAuthRepository } from "./mock-auth-repository.js";
import { mockContentRepository } from "./mock-content-repository.js";
import { mockMediaRepository } from "./mock-media-repository.js";
import { mockPlanRepository } from "./mock-plan-repository.js";
import { mockProjectRepository } from "./mock-project-repository.js";
import { mockSettingsRepository } from "./mock-settings-repository.js";

// Chooses the active data source. Supabase repositories are imported lazily so
// mock mode never pulls the Supabase client into the initial bundle.

let repositories = null;

export async function getRepositories() {
  if (repositories) return repositories;

  if (isSupabaseMode()) {
    const [
      { supabaseProjectRepository },
      { supabaseAuthRepository },
      { supabaseMediaRepository },
      { supabasePlanRepository },
      { supabaseContentRepository },
      { supabaseSettingsRepository },
      { supabaseActivityRepository },
    ] = await Promise.all([
      import("./supabase-project-repository.js"),
      import("./supabase-auth-repository.js"),
      import("./supabase-media-repository.js"),
      import("./supabase-plan-repository.js"),
      import("./supabase-content-repository.js"),
      import("./supabase-settings-repository.js"),
      import("./supabase-activity-repository.js"),
    ]);

    repositories = {
      projects: supabaseProjectRepository,
      auth: supabaseAuthRepository,
      media: supabaseMediaRepository,
      plans: supabasePlanRepository,
      content: supabaseContentRepository,
      settings: supabaseSettingsRepository,
      activity: supabaseActivityRepository,
    };
  } else {
    repositories = {
      projects: mockProjectRepository,
      auth: mockAuthRepository,
      media: mockMediaRepository,
      plans: mockPlanRepository,
      content: mockContentRepository,
      settings: mockSettingsRepository,
      activity: mockActivityRepository,
    };
  }

  return repositories;
}

export async function getProjectRepository() {
  return (await getRepositories()).projects;
}

export async function getAuthRepository() {
  return (await getRepositories()).auth;
}

export async function getActivityRepository() {
  return (await getRepositories()).activity;
}

export async function getMediaRepository() {
  return (await getRepositories()).media;
}

export async function getPlanRepository() {
  return (await getRepositories()).plans;
}

export async function getContentRepository() {
  return (await getRepositories()).content;
}

export async function getSettingsRepository() {
  return (await getRepositories()).settings;
}
