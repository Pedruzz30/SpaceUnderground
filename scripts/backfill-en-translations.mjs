// Fills in curated English translations for the known, versioned editorial
// content: site content sections, site settings SEO, plans and plan features.
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

const summary = { filled: 0, kept: 0, skipped: 0 };

const hasValue = (value) => typeof value === "string" && value.trim() !== "";

/**
 * Merges curated English over an existing translation object, adding only the
 * fields that are missing. Returns null when there is nothing to add.
 */
function mergeMissing(existing, curated, label) {
  const current = existing?.en ?? {};
  const additions = {};

  for (const [field, value] of Object.entries(curated)) {
    if (field === "items") continue;
    if (hasValue(current[field])) {
      summary.kept += 1;
      continue;
    }
    additions[field] = value;
  }

  // Repeatable items are matched by position, which is the identity the base
  // record and its translation share.
  if (Array.isArray(curated.items)) {
    const currentItems = Array.isArray(current.items) ? current.items : [];
    const merged = curated.items.map((item) => {
      const match = currentItems.find((entry) => Number(entry.position) === Number(item.position));
      if (!match) return item;
      const next = { ...item };
      for (const [field, value] of Object.entries(item)) {
        if (field === "position") continue;
        if (hasValue(match[field])) {
          next[field] = match[field];
          summary.kept += 1;
        } else {
          next[field] = value;
        }
      }
      return next;
    });
    const changed = JSON.stringify(merged) !== JSON.stringify(currentItems);
    if (changed) additions.items = merged;
  }

  if (!Object.keys(additions).length) {
    console.log(`keep    ${label} — already translated`);
    return null;
  }

  summary.filled += Object.keys(additions).length;
  console.log(`${APPLY ? "fill   " : "dry-run"} ${label} — ${Object.keys(additions).join(", ")}`);
  return { ...(existing ?? {}), en: { ...current, ...additions } };
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
  const next = mergeMissing(row.translations, curated, `site_content/${seed.key}`);
  if (next && APPLY) await patch(`site_content?key=eq.${encodeURIComponent(seed.key)}`, { translations: next });
}

/* ------------------------------------------------------------- site settings */

const settingsRows = await read("site_settings?select=key,translations&key=eq.public");
if (settingsRows.length && seedSiteSettings.translations?.en) {
  const next = mergeMissing(settingsRows[0].translations, seedSiteSettings.translations.en, "site_settings/public");
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
    const next = mergeMissing(row.translations, seed.translations.en, `plans/${seed.slug}`);
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
    const next = mergeMissing(featureRow.translations, curated, label);
    if (next && APPLY) await patch(`plan_features?id=eq.${encodeURIComponent(featureRow.id)}`, { translations: next });
  }
}

console.log(
  `\n${APPLY ? "applied" : "dry-run"}: ${summary.filled} field(s) to fill, ${summary.kept} existing translation(s) kept, ${summary.skipped} row(s) not found`,
);
if (!APPLY) console.log("Re-run with --apply to write.");
