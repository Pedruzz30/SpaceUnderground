// Controlled plans seed.
//
//   node --env-file=admin/.env --env-file=admin/.env.local scripts/seed-supabase-plans.mjs --dry-run
//   node --env-file=admin/.env --env-file=admin/.env.local scripts/seed-supabase-plans.mjs --apply

import { seedPlans } from "../admin/src/data/plans.js";

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

for (const plan of seedPlans) {
  const slug = plan.slug;
  const existingResponse = await fetch(`${SUPABASE_URL}/rest/v1/plans?select=id&slug=eq.${encodeURIComponent(slug)}`, { headers });
  const existing = await existingResponse.json();
  if (!existingResponse.ok) throw new Error(`Plan read failed: ${JSON.stringify(existing)}`);
  if (existing.length) {
    console.log(`skip ${plan.name} — already exists`);
    continue;
  }

  console.log(`${APPLY ? "insert" : "dry-run"} ${plan.name}`);
  if (!APPLY) continue;

  const insertResponse = await fetch(`${SUPABASE_URL}/rest/v1/plans`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify({
      slug,
      name: plan.name,
      monogram: plan.monogram,
      category: plan.category,
      range: plan.range,
      scope: plan.scope,
      scope_short: plan.scopeShort,
      status: plan.status,
      description: plan.description,
      timeline: plan.timeline,
      year: Number(plan.year),
      accent: plan.accent,
      visible: plan.visible,
      position: plan.position,
    }),
  });
  const inserted = await insertResponse.json();
  if (!insertResponse.ok) throw new Error(`Plan insert failed: ${JSON.stringify(inserted)}`);

  const featureRows = plan.features.map((feature, position) => ({ plan_id: inserted[0].id, position, text: feature.text }));
  const featureResponse = await fetch(`${SUPABASE_URL}/rest/v1/plan_features`, {
    method: "POST",
    headers,
    body: JSON.stringify(featureRows),
  });
  if (!featureResponse.ok) throw new Error(`Feature insert failed: ${await featureResponse.text()}`);
}

if (!APPLY) console.log("Dry-run only. Re-run with --apply to write.");
