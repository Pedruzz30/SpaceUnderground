// The still image the project viewer shows before, around and instead of the
// live site: on phones (which never load the embed), while the embed loads,
// when it gives up, and for projects with no live site at all.
//
// A poster uploaded in the Admin (poster_url) always wins. Until one is, the
// artwork shipped with the site stands in, looked up by the project's slug;
// when an uploaded poster fails to load (an expired signed URL, say), the
// shipped one is the fallback. A project with neither gets no image, and the
// viewer shows its designed placeholder instead of an empty frame.

export const BUNDLED_POSTERS = {
  "ink-tattoo": {
    avif: "./tattoo-preview-poster.avif",
    webp: "./tattoo-preview-poster.webp",
    png: "./tattoo-preview-poster.png",
    width: 1440,
    height: 900,
  },
  "lucas-souza": {
    avif: "./LucasNutri.avif",
    webp: "./LucasNutri.webp",
    png: "./LucasNutri.png",
    width: 1849,
    height: 931,
  },
  "jarvis-ai": { png: "./jarvis-preview-poster-pt.svg", width: 1440, height: 900 },
  "despensa-digital": { png: "./gestao-escolar-poster.svg", width: 1440, height: 900 },
  "termo-digital": { png: "./termo-digital-poster.svg", width: 1440, height: 900 },
};

const text = (value) => (typeof value === "string" ? value.trim() : "");

// Storage paths are signed before use; anything else is used as it is.
const isStoragePath = (value) => Boolean(value) && !/^(https?:|data:|blob:|\/|\.{1,2}\/)/i.test(value);

// { poster, posterFallback }: poster is a URL, a { avif, webp, png } set, or
// "" when the project has no image at all.
export function resolvePoster(row = {}, signed = new Map()) {
  const path = text(row.poster_url);
  const uploaded = isStoragePath(path) ? signed.get(path) || "" : path;
  const bundled = BUNDLED_POSTERS[text(row.slug)] ?? null;
  if (uploaded) return { poster: uploaded, posterFallback: bundled };
  return { poster: bundled ?? "", posterFallback: null };
}
