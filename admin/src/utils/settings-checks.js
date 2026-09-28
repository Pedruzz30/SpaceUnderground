// Rules behind the Settings screen: what a valid public configuration is,
// how ready it is to be shared, what a strong enough password is, how each
// data module's health reads and what a backup contains. Pure functions, so
// the page and the tests share one version of each rule.

export const SITE_LOCALES = ["pt-BR", "en"];

// Search engines cut titles around 60 characters and descriptions around
// 160; much shorter reads as thin. Guidance, never a save blocker.
export const SEO_LIMITS = {
  seoTitle: { min: 30, max: 60 },
  seoDescription: { min: 70, max: 160 },
};

// The size every social network renders without cropping.
export const OG_IMAGE = { width: 1200, height: 630 };

export function lengthState(value, { min, max }) {
  const length = String(value ?? "").trim().length;
  if (!length) return "empty";
  if (length < min) return "short";
  if (length > max) return "long";
  return "ok";
}

// What a search result shows: past the limit, cut at the last word that fits
// and close with an ellipsis, the way Google does.
export function clipForPreview(value, max) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:-]+$/, "")}…`;
}

export function isHttpUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A storage path ("projects/…/og.png") or an absolute URL. A bare "/file.png"
// would resolve against the Admin's own host, not the public site.
export function isOgImageReference(value) {
  const text = String(value ?? "").trim();
  if (!text) return true;
  if (isHttpUrl(text)) return true;
  return !text.startsWith("/") && !/\s/.test(text) && !text.includes("..");
}

// Field -> message key. Keys, not text: the page words them in its locale.
export function validateSiteSettings(data = {}) {
  // Every field stays optional, as before: a blank one falls back to the
  // build-time value in site.config.js. Only what is filled in must be valid.
  const errors = {};
  if (String(data.siteUrl ?? "").trim() && !isHttpUrl(data.siteUrl)) errors.siteUrl = "settings.invalidUrl";
  if (data.contactEmail && !EMAIL.test(String(data.contactEmail).trim())) errors.contactEmail = "settings.invalidEmail";
  if (data.locale && !SITE_LOCALES.includes(data.locale)) errors.locale = "settings.validation.localeValid";
  if (!isOgImageReference(data.ogImagePath)) errors.ogImagePath = "settings.invalidOgPath";
  return errors;
}

// "missing" (no image), "unreadable" (did not load), "small" (below the
// recommended size), "ratio" (will be cropped), or "ok".
export function ogImageState(path, image) {
  if (!String(path ?? "").trim()) return "missing";
  if (!image) return "unreadable";
  const { width, height } = image;
  if (!width || !height) return "unreadable";
  if (width < OG_IMAGE.width / 2 || height < OG_IMAGE.height / 2) return "small";
  const ratio = width / height;
  const target = OG_IMAGE.width / OG_IMAGE.height;
  if (Math.abs(ratio - target) / target > 0.08) return "ratio";
  return "ok";
}

// How ready the public configuration is to be shared. "required" failures
// break something visible; "advice" ones only make it look worse.
export function shareReadiness(data = {}, image = null) {
  const title = data.seoTitle || data.siteName;
  const og = ogImageState(data.ogImagePath, image);
  const checks = [
    { key: "siteUrl", ok: isHttpUrl(data.siteUrl) && String(data.siteUrl).startsWith("https://"), severity: "required" },
    { key: "title", ok: lengthState(title, SEO_LIMITS.seoTitle) === "ok", severity: "advice" },
    { key: "description", ok: lengthState(data.seoDescription, SEO_LIMITS.seoDescription) === "ok", severity: "advice" },
    { key: "ogImage", ok: og === "ok", severity: og === "missing" || og === "unreadable" ? "required" : "advice", state: og },
    { key: "english", ok: Boolean(String(data.translations?.en?.seo_description ?? "").trim()), severity: "advice" },
    { key: "contactEmail", ok: EMAIL.test(String(data.contactEmail ?? "").trim()), severity: "advice" },
  ];
  return { checks, score: checks.filter((check) => check.ok).length, total: checks.length };
}

/* --- account ------------------------------------------------------------------ */

export const PASSWORD_MIN = 10;

// Each rule on its own, so the form can tick them off while the user types.
// A local part shorter than three letters ("jo@…") would forbid too much.
export function passwordChecks(password, confirmation, email = "") {
  const value = String(password ?? "");
  const local = String(email ?? "").split("@")[0].toLowerCase();
  return [
    { key: "length", ok: value.length >= PASSWORD_MIN },
    { key: "mix", ok: /\p{L}/u.test(value) && /\d/.test(value) },
    { key: "email", ok: local.length < 3 || !value.toLowerCase().includes(local) },
    { key: "match", ok: value.length > 0 && value === String(confirmation ?? "") },
  ];
}

const PASSWORD_MESSAGES = {
  length: "settings.account.passwordTooShort",
  mix: "settings.account.passwordMix",
  email: "settings.account.passwordEmail",
};

// The first broken rule, on the field it belongs to.
export function validateNewPassword(password, confirmation, email = "") {
  const checks = passwordChecks(password, confirmation, email);
  const broken = checks.find((check) => !check.ok && check.key !== "match");
  if (broken) return { password: PASSWORD_MESSAGES[broken.key] };
  if (!checks.find((check) => check.key === "match").ok) return { confirmation: "settings.account.passwordMismatch" };
  return {};
}

/* --- system health -------------------------------------------------------------- */

// Each data module, the service read that proves it works, and the migration
// that creates what it reads when that migration is the usual reason a read
// fails with a missing table or column.
export const HEALTH_MODULES = [
  { key: "projects", migration: null },
  { key: "clients", migration: "20260928013040_clients_post_review_hardening.sql" },
  { key: "commercial", migration: "20260928035023_commercial_opportunities.sql" },
  { key: "financial", migration: "20260928031922_financial_foundation.sql" },
  { key: "services", migration: null },
  { key: "content", migration: null },
  { key: "settings", migration: null },
  { key: "activity", migration: null },
];

// A failed read, in the words an operator can act on.
export function classifyFailure(error) {
  const code = error?.code ?? "";
  if (code === "schema_outdated" || ["42P01", "42703", "PGRST204", "PGRST205"].includes(code)) return "schema";
  if (code === "unauthorized" || code === "42501") return "unauthorized";
  if (code === "network_error" || error?.name === "TypeError") return "network";
  return "error";
}

export function healthSummary(results = []) {
  const failing = results.filter((result) => result.status !== "ok");
  return {
    ok: results.length - failing.length,
    total: results.length,
    pendingMigrations: failing.filter((result) => result.status === "schema" && result.migration).map((result) => result.migration),
    state: !failing.length ? "ok" : failing.length === results.length ? "down" : "degraded",
  };
}

/* --- backup ----------------------------------------------------------------------- */

export const BACKUP_FORMAT = "space-underground-admin-backup";
export const BACKUP_VERSION = 1;

// Everything the Admin can read, as one JSON document. Modules that failed to
// load are listed as missing instead of silently written as empty.
export function buildBackup({ modules = {}, failed = [], source = "", generatedAt = new Date().toISOString() } = {}) {
  const counts = Object.fromEntries(
    Object.entries(modules).map(([key, value]) => [key, Array.isArray(value) ? value.length : value ? 1 : 0]),
  );
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    generatedAt,
    source,
    counts,
    missing: [...failed],
    data: modules,
  };
}

export function backupFilename(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `space-underground-backup-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.json`;
}
