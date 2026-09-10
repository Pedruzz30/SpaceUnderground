import { isSupabaseMode } from "../../config/env.js";
import { mockActivityRepository } from "./mock-activity-repository.js";
import { mockAuthRepository } from "./mock-auth-repository.js";
import { mockMediaRepository } from "./mock-media-repository.js";
import { mockProjectRepository } from "./mock-project-repository.js";

// Chooses the active data source. Supabase repositories are imported lazily so
// mock mode never pulls the Supabase client into the initial bundle.

let repositories = null;

export async function getRepositories() {
  if (repositories) return repositories;

  if (isSupabaseMode()) {
    const [{ supabaseProjectRepository }, { supabaseAuthRepository }, { supabaseMediaRepository }] = await Promise.all([
      import("./supabase-project-repository.js"),
      import("./supabase-auth-repository.js"),
      import("./supabase-media-repository.js"),
    ]);

    repositories = {
      projects: supabaseProjectRepository,
      auth: supabaseAuthRepository,
      media: supabaseMediaRepository,
      // There is no activity table yet, so the log stays local in both modes.
      activity: mockActivityRepository,
    };
  } else {
    repositories = {
      projects: mockProjectRepository,
      auth: mockAuthRepository,
      media: mockMediaRepository,
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
