// The live project preview's geometry and posters: the embed is laid out at
// one desktop size and only scaled, and every project gets an image or a
// designed placeholder, never an empty frame.
//
//   npm test

import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import { describe, it } from "node:test";

const { MODE_ZOOM, RENDER_HEIGHT, RENDER_WIDTH, SCROLLBAR_ALLOWANCE, previewScale } = await import("../src/scripts/preview-geometry.js");
const { BUNDLED_POSTERS, resolvePoster } = await import("../src/scripts/project-posters.js");

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

describe("live preview geometry", () => {
  it("lays the embed out at a desktop size, with room for a clipped scrollbar", () => {
    assert.deepEqual([RENDER_WIDTH, RENDER_HEIGHT], [1440, 900]);
    assert.ok(SCROLLBAR_ALLOWANCE >= 17, "wide enough for a Windows scrollbar");
  });

  it("scales the desktop layout to cover the frame, whatever the screen", () => {
    close(previewScale({ width: 830, height: 489 }), 830 / 1440);
    close(previewScale({ width: 581, height: 344 }), 581 / 1440);
    close(previewScale({ width: 431, height: 232 }), 431 / 1440);
    // A frame taller than 16:10 is covered by height, never letterboxed.
    close(previewScale({ width: 600, height: 500 }), 500 / 900);
  });

  it("only zooms in detail mode; the site mode widens the frame instead", () => {
    const frame = { width: 830, height: 489 };
    close(previewScale(frame, "site"), previewScale(frame));
    close(previewScale(frame, "detail"), previewScale(frame) * MODE_ZOOM.detail);
    assert.ok(MODE_ZOOM.detail > 1);
    close(previewScale(frame, "unknown-mode"), previewScale(frame));
  });

  it("gives no scale to a frame that is not laid out yet", () => {
    assert.equal(previewScale({ width: 0, height: 480 }), 0);
    assert.equal(previewScale({}), 0);
    assert.equal(previewScale(), 0);
  });
});

describe("project posters", () => {
  it("ships every bundled poster it points at", () => {
    for (const [slug, poster] of Object.entries(BUNDLED_POSTERS)) {
      for (const format of ["avif", "webp", "png"]) {
        if (!poster[format]) continue;
        assert.ok(existsSync(new URL(`../public/${poster[format].replace("./", "")}`, import.meta.url)), `${slug}: ${poster[format]} is missing`);
      }
      assert.ok(poster.width > 0 && poster.height > 0, `${slug} declares its size`);
    }
  });

  it("uses the uploaded poster first, with the bundled one as its fallback", () => {
    assert.deepEqual(resolvePoster({ slug: "ink-tattoo", poster_url: "https://cdn.example.com/ink.png" }), {
      poster: "https://cdn.example.com/ink.png",
      posterFallback: BUNDLED_POSTERS["ink-tattoo"],
    });
  });

  it("uses a signed storage URL, and falls back to the bundled poster when signing failed", () => {
    const signed = new Map([["projects/ink/poster.png", "https://storage.example.com/signed"]]);
    assert.equal(resolvePoster({ slug: "ink-tattoo", poster_url: "projects/ink/poster.png" }, signed).poster, "https://storage.example.com/signed");
    assert.equal(resolvePoster({ slug: "ink-tattoo", poster_url: "projects/ink/poster.png" }, new Map()).poster, BUNDLED_POSTERS["ink-tattoo"]);
  });

  it("stands in the bundled artwork when nothing was uploaded", () => {
    for (const slug of ["ink-tattoo", "lucas-souza", "jarvis-ai", "despensa-digital"]) {
      assert.deepEqual(resolvePoster({ slug, poster_url: "" }), { poster: BUNDLED_POSTERS[slug], posterFallback: null }, slug);
    }
  });

  it("returns no image for a project with nothing uploaded or shipped, so the placeholder shows", () => {
    assert.deepEqual(resolvePoster({ slug: "new-project", poster_url: null }), { poster: "", posterFallback: null });
    assert.deepEqual(resolvePoster({}), { poster: "", posterFallback: null });
  });
});
