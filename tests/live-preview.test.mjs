// The live project preview's geometry: the embed is laid out at one desktop
// size and only scaled.
//
//   npm test

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

const { MODE_ZOOM, RENDER_HEIGHT, RENDER_WIDTH, SCROLLBAR_ALLOWANCE, previewScale } = await import("../src/scripts/preview-geometry.js");

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
