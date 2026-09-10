// Controlled import of the portfolio into Supabase.
//
//   node --env-file=admin/.env --env-file=admin/.env.local scripts/seed-supabase-projects.mjs
//
// Signs in as an administrator and inserts any project from the static registry
// that is not in the database yet, matched by slug. Existing rows are left
// untouched, so running it twice is safe and it never overwrites edits made in
// the admin. No service role key: every write goes through the same RLS the
// admin uses.

import { projects } from "../src/scripts/project-registry.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;

if (!SUPABASE_URL || !ANON_KEY || !EMAIL || !PASSWORD) {
  console.error("Missing env: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, ADMIN_EMAIL, ADMIN_PASSWORD");
  process.exit(2);
}

// The public registry carries editorial copy the database has no column for
// (modules, coordinates, system...). Only the fields the admin owns are
// imported; the site keeps merging the rest from the registry.
const CATEGORY = { ink: "Website", lucas: "Website", jarvis: "AI", despensa: "System", termo: "System" };
const STATUS = { ink: "Live", lucas: "Live", jarvis: "Prototype", despensa: "Live", termo: "MVP" };
const FEATURED = new Set(["ink", "lucas"]);

const slugify = (value) =>
  String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`, "g"), "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");

const isAbsolute = (value) => /^https?:\/\//i.test(String(value ?? ""));

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
const headers = {
  apikey: ANON_KEY,
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};

const existingResponse = await fetch(`${SUPABASE_URL}/rest/v1/projects?select=slug,case_number`, { headers });
const existing = await existingResponse.json();
if (!existingResponse.ok) throw new Error(`Read failed: ${JSON.stringify(existing)}`);

const existingSlugs = new Set(existing.map((row) => row.slug));
const existingCases = new Set(existing.map((row) => row.case_number));
console.log(`${existing.length} project(s) already in the database.`);

const rows = Object.entries(projects)
  .map(([key, project]) => ({ key, project }))
  .filter(({ key, project }) => {
    const slug = slugify(project.name);
    if (existingSlugs.has(slug)) {
      console.log(`  skip ${project.name} — slug already present`);
      return false;
    }
    if (existingCases.has(Number(project.id))) {
      console.log(`  skip ${project.name} — case ${project.id} already present`);
      return false;
    }
    return Boolean(CATEGORY[key]);
  })
  .map(({ key, project }) => ({
    case_number: Number(project.id),
    name: project.name,
    slug: slugify(project.name),
    client: project.client,
    category: CATEGORY[key],
    description: project.description,
    status: STATUS[key],
    editorial_status: "PUBLISHED",
    featured: FEATURED.has(key),
    visible: true,
    year: Number(project.year),
    accent: project.accent,
    tech_stack: String(project.tech || "")
      .split("/")
      .map((item) => item.trim())
      .filter(Boolean),
    // Relative URLs point at pages of this same site; the registry keeps
    // serving those, so only absolute ones are worth storing.
    project_url: isAbsolute(project.url) ? project.url : null,
    preview_url: isAbsolute(project.previewUrl) ? project.previewUrl : null,
    // Posters stay with the registry, which has optimised avif/webp variants.
    // An upload in the admin takes over automatically once it exists.
    poster_url: null,
  }));

if (!rows.length) {
  console.log("Nothing to import.");
  process.exit(0);
}

const insertResponse = await fetch(`${SUPABASE_URL}/rest/v1/projects`, {
  method: "POST",
  headers: { ...headers, Prefer: "return=representation" },
  body: JSON.stringify(rows),
});
const inserted = await insertResponse.json();
if (!insertResponse.ok) throw new Error(`Insert failed: ${JSON.stringify(inserted)}`);

inserted.forEach((row) => console.log(`  imported CASE ${String(row.case_number).padStart(3, "0")} — ${row.name}`));
console.log(`Done: ${inserted.length} project(s) imported.`);
