// Controlled project presentation seed.
//
//   node --env-file=admin/.env --env-file=admin/.env.local scripts/seed-supabase-project-presentation.mjs --dry-run
//   node --env-file=admin/.env --env-file=admin/.env.local scripts/seed-supabase-project-presentation.mjs --apply

import { projectPresentationSeed } from "./data/project-presentation-seed.mjs";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
const APPLY = process.argv.includes("--apply");

if (!SUPABASE_URL || !ANON_KEY || !EMAIL || !PASSWORD) {
  console.error("Missing env: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, ADMIN_EMAIL, ADMIN_PASSWORD");
  process.exit(2);
}

async function signIn() {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`Sign-in failed: ${body.error_description ?? body.msg ?? response.status}`);
  return body.access_token;
}

const token = await signIn();
const headers = { apikey: ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

for (const project of projectPresentationSeed) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/projects?select=id,name&case_number=eq.${project.caseNumber}`, { headers });
  const rows = await response.json();
  if (!response.ok) throw new Error(`Read failed for CASE ${project.caseNumber}: ${JSON.stringify(rows)}`);
  const existing = rows[0];
  if (!existing) {
    console.log(`skip CASE ${String(project.caseNumber).padStart(3, "0")} — project does not exist yet`);
    continue;
  }

  const patch = {
    presentation_system: project.presentation.system,
    presentation_label: project.presentation.label,
    presentation_address: project.presentation.address,
    presentation_type: project.presentation.type,
    origin: project.presentation.origin,
    coordinates: project.presentation.coordinates,
  };

  console.log(`${APPLY ? "update" : "dry-run"} CASE ${String(project.caseNumber).padStart(3, "0")} — ${project.name}`);
  if (!APPLY) continue;

  const update = await fetch(`${SUPABASE_URL}/rest/v1/projects?id=eq.${existing.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(patch),
  });
  if (!update.ok) throw new Error(`Project update failed: ${await update.text()}`);

  const existingModulesResponse = await fetch(`${SUPABASE_URL}/rest/v1/project_modules?select=id&project_id=eq.${existing.id}`, { headers });
  const existingModules = await existingModulesResponse.json();
  if (!existingModulesResponse.ok) throw new Error(`Module read failed: ${JSON.stringify(existingModules)}`);
  if (existingModules.length) {
    console.log(`  modules already exist (${existingModules.length}); preserving admin edits`);
    continue;
  }

  const modules = project.modules.map(([code, title, description], position) => ({
    project_id: existing.id,
    position,
    code,
    title,
    description,
  }));
  const insert = await fetch(`${SUPABASE_URL}/rest/v1/project_modules`, {
    method: "POST",
    headers,
    body: JSON.stringify(modules),
  });
  if (!insert.ok) throw new Error(`Module insert failed: ${await insert.text()}`);
}

if (!APPLY) console.log("Dry-run only. Re-run with --apply to write.");
