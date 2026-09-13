// Where the public site lives, for links that leave the Admin.
//
// The Admin is deployed on its own host, so a relative link like "../#work"
// resolves against the Admin's domain and lands nowhere. Every "view public"
// link goes through here instead.
//
// The canonical URL is the one the public build already uses, so a domain
// change stays a single edit in site.config.js. A site_url configured in
// Settings wins when it is present, which is what lets the Admin point at a
// staging deploy without a code change.

import { SITE_URL } from "../../../site.config.js";

export const PUBLIC_SITE_URL = SITE_URL;

function normalize(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.href.endsWith("/") ? url.href : `${url.href}/`;
  } catch {
    return "";
  }
}

/**
 * Absolute URL on the public site.
 *
 * @param path      hash or path to append, e.g. "#work"
 * @param settings  site settings, when the caller already has them loaded
 */
export function publicSiteUrl(path = "", settings = null) {
  const base = normalize(settings?.siteUrl) || normalize(PUBLIC_SITE_URL) || PUBLIC_SITE_URL;
  const suffix = String(path ?? "").trim();
  if (!suffix) return base;

  try {
    return new URL(suffix, base).href;
  } catch {
    return base;
  }
}
