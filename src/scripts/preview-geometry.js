// Geometry of the live preview. The embedded site is always laid out at one
// desktop size, whatever the size of the frame showing it, and only the scale
// changes. Laying it out at the frame's own width (the old behaviour) put the
// client's site in its tablet layout on a 1024 px screen, and every mode
// change re-laid it out mid-animation.

export const RENDER_WIDTH = 1440;
export const RENDER_HEIGHT = 900;

// Rendered past the right edge of the frame and clipped by it: a classic
// scrollbar (about 17 px on Windows) lands there instead of on the preview.
// Nobody can scroll the embed anyway; it takes no pointer events.
export const SCROLLBAR_ALLOWANCE = 24;

// How far each mode zooms into the site. The site mode needs no zoom of its
// own: it widens the frame, and the scale follows the frame.
export const MODE_ZOOM = {
  overview: 1,
  site: 1,
  detail: 1.24,
  origin: 1,
};

// The scale that makes the desktop layout cover the frame, then the mode's
// zoom. 0 while the frame has no size yet (hidden, or not laid out).
export function previewScale({ width, height } = {}, mode = "overview") {
  if (!(width > 0) || !(height > 0)) return 0;
  const cover = Math.max(width / RENDER_WIDTH, height / RENDER_HEIGHT);
  return cover * (MODE_ZOOM[mode] ?? 1);
}
