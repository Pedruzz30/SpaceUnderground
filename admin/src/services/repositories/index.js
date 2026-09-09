import { isSupabaseMode } from "../../config/env.js";
import { mockActivityRepository } from "./mock-activity-repository.js";
import { mockAuthRepository } from "./mock-auth-repository.js";
import { mockProjectRepository } from "./mock-project-repository.js";

// Chooses the active data source. Supabase repositories are imported lazily so
// mock mode never pulls the Supabase client into the initial bundle.

let repositories = null;

export async function getRepositories() {
  if (repositories) return repositories;

  if (isSupabaseMode()) {
    const [{ supabaseProjectRepository }, { supabaseAuthRepository }] = await Promise.all([
      import("./supabase-project-repository.js"),
      import("./supabase-auth-repository.js"),
    ]);

    repositories = {
      projects: supabaseProjectRepository,
      auth: supabaseAuthRepository,
      // There is no activity table yet, so the log stays local in both modes.
      activity: mockActivityRepository,
    };
  } else {
    repositories = {
      projects: mockProjectRepository,
      auth: mockAuthRepository,
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
