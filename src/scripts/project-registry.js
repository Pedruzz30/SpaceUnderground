// Runtime project registry for the Selected Work viewer.
//
// Editorial project content is intentionally not bundled anymore. Supabase is
// the source of truth, and public RLS decides which projects can be read. When
// Supabase is unavailable, the site keeps a neutral Selected Work shell instead
// of leaking stale or unpublished project names.

export const projects = {};

export const defaultProjectKey = "";
