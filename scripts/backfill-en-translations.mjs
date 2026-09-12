// Fills in curated English translations for the known, versioned editorial
// content: site content sections, site settings SEO, plans, plan features,
// the seeded projects and their presentation modules.
//
//   node --env-file=admin/.env --env-file=admin/.env.local scripts/backfill-en-translations.mjs
//   node --env-file=admin/.env --env-file=admin/.env.local scripts/backfill-en-translations.mjs --apply
//
// Dry-run by default: nothing is written without --apply.
//
// Idempotent, and deliberately additive only. A field that already has an
// English value is never touched, so a translation written by hand in the Admin
// always wins over the curated one here. Nothing is machine-translated, and
// content created later by the user is left alone entirely.

import { seedPlans, seedSiteContent, seedSiteSettings } from "../admin/src/data/plans.js";
import { projectPresentationSeed } from "./data/project-presentation-seed.mjs";
import { mergeAdditiveLocale } from "../shared/additive-merge.js";

const SUPABASE_URL = String(process.env.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "");
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

async function read(path) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers });
  const body = await response.json();
  if (!response.ok) throw new Error(`Read failed (${path}): ${JSON.stringify(body)}`);
  return body;
}

async function patch(path, payload) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Write failed (${path}): ${await response.text()}`);
}

// Every table this script touches needs the translations column from migration
// 008. Checked up front so a project that has not run the migration gets one
// clear instruction instead of a PostgREST error mid-run.
async function assertSchemaReady() {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/site_content?select=translations&limit=1`, { headers });
  if (response.ok) return;

  const body = await response.json().catch(() => ({}));
  if (body?.code === "42703") {
    console.error(
      "This project does not have the editorial translations column yet." +
        " Apply supabase/migrations/008_editorial_i18n.sql first, then re-run this script.",
    );
    process.exit(3);
  }
  throw new Error(`Schema check failed: ${JSON.stringify(body)}`);
}

await assertSchemaReady();

const summary = { filled: 0, kept: 0, skipped: 0 };

/**
 * Applies curated English over an existing translations object, additively.
 * Returns the object to write, or null when there is nothing to add.
 */
function additionsFor(existingTranslations, curated, label) {
  const { translations, added, kept, changed } = mergeAdditiveLocale(existingTranslations, curated);

  summary.kept += kept.length;
  if (!changed) {
    console.log(`keep    ${label} — already translated`);
    return null;
  }

  summary.filled += added.length;
  console.log(`${APPLY ? "fill   " : "dry-run"} ${label} — ${added.join(", ")}`);
  return translations;
}

/* -------------------------------------------------------------- site content */

const contentRows = await read("site_content?select=key,translations");
for (const seed of seedSiteContent) {
  const curated = seed.translations?.en;
  if (!curated) continue;
  const row = contentRows.find((entry) => entry.key === seed.key);
  if (!row) {
    summary.skipped += 1;
    console.log(`skip    site_content/${seed.key} — row does not exist`);
    continue;
  }
  const next = additionsFor(row.translations, curated, `site_content/${seed.key}`);
  if (next && APPLY) await patch(`site_content?key=eq.${encodeURIComponent(seed.key)}`, { translations: next });
}

/* ------------------------------------------------------------- site settings */

const settingsRows = await read("site_settings?select=key,translations&key=eq.public");
if (settingsRows.length && seedSiteSettings.translations?.en) {
  const next = additionsFor(settingsRows[0].translations, seedSiteSettings.translations.en, "site_settings/public");
  if (next && APPLY) await patch("site_settings?key=eq.public", { translations: next });
} else if (!settingsRows.length) {
  summary.skipped += 1;
  console.log("skip    site_settings/public — row does not exist");
}

/* --------------------------------------------------------- plans and features */

const planRows = await read("plans?select=id,slug,translations,plan_features(id,position,text,translations)");
for (const seed of seedPlans) {
  const row = planRows.find((entry) => entry.slug === seed.slug);
  if (!row) {
    summary.skipped += 1;
    console.log(`skip    plans/${seed.slug} — row does not exist`);
    continue;
  }

  if (seed.translations?.en) {
    const next = additionsFor(row.translations, seed.translations.en, `plans/${seed.slug}`);
    if (next && APPLY) await patch(`plans?id=eq.${encodeURIComponent(row.id)}`, { translations: next });
  }

  // Features are matched by position, so reordering in the Admin never attaches
  // a translation to the wrong line.
  for (const seedFeature of seed.features ?? []) {
    const curated = seedFeature.translations?.en;
    if (!curated) continue;
    const featureRow = (row.plan_features ?? []).find(
      (entry) => Number(entry.position) === Number(seedFeature.position),
    );
    if (!featureRow) {
      summary.skipped += 1;
      console.log(`skip    plan_features/${seed.slug}#${seedFeature.position} — row does not exist`);
      continue;
    }
    const label = `plan_features/${seed.slug}#${seedFeature.position}`;
    const next = additionsFor(featureRow.translations, curated, label);
    if (next && APPLY) await patch(`plan_features?id=eq.${encodeURIComponent(featureRow.id)}`, { translations: next });
  }
}

/* ----------------------------------------------- projects and their modules */

// Located by case_number, the versioned identity of a known case. Only
// editorial copy is written: the description and the presentation
// system/label/type. Name, client, slug, URLs, tech stack, coordinates,
// origin, year, accent, status and category are structural and never appear
// in a translation.
function curatedProjectTranslation(curated) {
  const out = {};
  if (curated.description) out.description = curated.description;
  const presentation = curated.presentation ?? {};
  if (presentation.system) out.presentation_system = presentation.system;
  if (presentation.label) out.presentation_label = presentation.label;
  if (presentation.type) out.presentation_type = presentation.type;
  return out;
}

const caseLabel = (caseNumber) => `case-${String(caseNumber).padStart(3, "0")}`;

for (const seed of projectPresentationSeed) {
  const curated = seed.translations?.en;
  if (!curated) continue;

  const projectRows = await read(
    `projects?select=id,case_number,translations&case_number=eq.${encodeURIComponent(seed.caseNumber)}`,
  );
  const row = projectRows[0];
  if (!row) {
    summary.skipped += 1;
    console.log(`skip    projects/${caseLabel(seed.caseNumber)} — row does not exist`);
    continue;
  }

  const next = additionsFor(
    row.translations,
    curatedProjectTranslation(curated),
    `projects/${caseLabel(seed.caseNumber)}`,
  );
  if (next && APPLY) await patch(`projects?id=eq.${encodeURIComponent(row.id)}`, { translations: next });

  // Modules are matched by project_id + position, so an Admin reorder never
  // moves a translation onto a different module.
  const curatedModules = Array.isArray(curated.modules) ? curated.modules : [];
  if (!curatedModules.length) continue;

  const moduleRows = await read(
    `project_modules?select=id,position,translations&project_id=eq.${encodeURIComponent(row.id)}`,
  );

  for (const [position, tuple] of curatedModules.entries()) {
    const [, title, description] = tuple;
    const moduleRow = moduleRows.find((entry) => Number(entry.position) === position);
    if (!moduleRow) {
      summary.skipped += 1;
      console.log(`skip    project_modules/${caseLabel(seed.caseNumber)}#${position} — row does not exist`);
      continue;
    }

    const moduleNext = additionsFor(
      moduleRow.translations,
      { title, description },
      `project_modules/${caseLabel(seed.caseNumber)}#${position}`,
    );
    if (moduleNext && APPLY) {
      await patch(`project_modules?id=eq.${encodeURIComponent(moduleRow.id)}`, { translations: moduleNext });
    }
  }
}

console.log(
  `\n${APPLY ? "applied" : "dry-run"}: ${summary.filled} field(s) to fill, ${summary.kept} existing translation(s) kept, ${summary.skipped} row(s) not found`,
);
if (!APPLY) console.log("Re-run with --apply to write.");
