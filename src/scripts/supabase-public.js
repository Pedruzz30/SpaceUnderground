// Read-only access to Supabase for the public site.
//
// Deliberately built on fetch instead of @supabase/supabase-js: the site only
// needs two endpoints, and the client library would add ~224 kB to every
// visitor's download. Row level security is identical either way — the
// publishable key is just an apikey header, and the database decides what it
// can see.

const SUPABASE_URL = String(import.meta.env?.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "");
const PUBLISHABLE_KEY = String(import.meta.env?.VITE_SUPABASE_ANON_KEY ?? "");

const BUCKET = "project-media";
const SIGN_TTL_SECONDS = 3600;
// Re-sign well before the token dies, so a URL handed to an <img> is never
// about to expire.
const RENEW_MARGIN_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 6000;

const PROJECT_COLUMNS = [
  "case_number",
  "name",
  "slug",
  "client",
  "category",
  "description",
  "status",
  "year",
  "accent",
  "tech_stack",
  "presentation_system",
  "presentation_label",
  "presentation_address",
  "presentation_type",
  "origin",
  "coordinates",
  "poster_url",
  "project_url",
  "preview_url",
  "live_preview_enabled",
  "translations",
  "project_gallery(url,alt,caption,position,translations)",
  "project_modules(code,title,description,position,translations)",
].join(",");

const PLAN_COLUMNS = [
  "id",
  "slug",
  "name",
  "monogram",
  "category",
  "range",
  "scope",
  "scope_short",
  "status",
  "description",
  "timeline",
  "year",
  "accent",
  "position",
  "translations",
  "plan_features(text,position,translations)",
].join(",");

export function isConfigured() {
  return Boolean(SUPABASE_URL && PUBLISHABLE_KEY);
}

function headers(extra = {}) {
  return { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${PUBLISHABLE_KEY}`, ...extra };
}

// A slow or unreachable backend must never hold the page hostage.
async function request(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`Supabase responded ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchPublishedProjects() {
  // The filter is explicit even though row level security already enforces it:
  // two independent guarantees that a draft can never reach the public site.
  const query =
    `${SUPABASE_URL}/rest/v1/projects` +
    `?select=${encodeURIComponent(PROJECT_COLUMNS)}` +
    `&editorial_status=eq.PUBLISHED&visible=eq.true&order=case_number.asc`;

  const rows = await request(query, { headers: headers() });
  return Array.isArray(rows) ? rows : [];
}

export async function fetchVisiblePlans() {
  const query =
    `${SUPABASE_URL}/rest/v1/plans` +
    `?select=${encodeURIComponent(PLAN_COLUMNS)}` +
    `&visible=eq.true&order=position.asc`;

  const rows = await request(query, { headers: headers() });
  return Array.isArray(rows) ? rows : [];
}

export async function fetchSiteContent() {
  const query = `${SUPABASE_URL}/rest/v1/site_content?select=key,content,translations`;
  const rows = await request(query, { headers: headers() });
  return Array.isArray(rows) ? rows : [];
}

export async function fetchSiteSettings() {
  const query = `${SUPABASE_URL}/rest/v1/site_settings?select=site_name,site_url,contact_email,locale,seo_title,seo_description,og_image_path,translations&key=eq.public`;
  const rows = await request(query, { headers: headers() });
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

// path -> { url, expiresAt }
const signedCache = new Map();

function cachedUrl(path) {
  const entry = signedCache.get(path);
  if (!entry) return null;
  if (entry.expiresAt - Date.now() <= RENEW_MARGIN_MS) return null;
  return entry.url;
}

/**
 * Signs storage paths in a single batched request, reusing anything still
 * comfortably valid. Paths the viewer may not read come back as null, which is
 * exactly what happens to an image whose project is not published.
 */
export async function signPaths(paths) {
  const resolved = new Map();
  const missing = [];

  for (const path of new Set(paths.filter(Boolean))) {
    const cached = cachedUrl(path);
    if (cached) resolved.set(path, cached);
    else missing.push(path);
  }

  if (!missing.length) return resolved;

  const results = await request(`${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}`, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ expiresIn: SIGN_TTL_SECONDS, paths: missing }),
  });

  const expiresAt = Date.now() + SIGN_TTL_SECONDS * 1000;

  for (const result of Array.isArray(results) ? results : []) {
    if (!result?.signedURL) continue;
    const url = `${SUPABASE_URL}/storage/v1${result.signedURL}`;
    signedCache.set(result.path, { url, expiresAt });
    resolved.set(result.path, url);
  }

  return resolved;
}

export function forgetSignedPath(path) {
  signedCache.delete(path);
}
