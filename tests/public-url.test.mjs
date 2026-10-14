import test from "node:test";
import assert from "node:assert/strict";

import { resolvePublicUrl } from "../src/scripts/public-url.js";

const BASE = "https://spaceunderground.netlify.app/";

test("resolvePublicUrl accepts absolute HTTPS project URLs", () => {
  assert.equal(
    resolvePublicUrl("https://example.com/project", BASE),
    "https://example.com/project",
  );
});

test("resolvePublicUrl resolves bundled relative demos against the public site", () => {
  assert.equal(
    resolvePublicUrl("./termo-digital-demo/?embed=spaceunderground", BASE),
    "https://spaceunderground.netlify.app/termo-digital-demo/?embed=spaceunderground",
  );
});

test("resolvePublicUrl rejects non HTTP(S) destinations", () => {
  assert.equal(resolvePublicUrl("javascript:alert(1)", BASE), "");
  assert.equal(resolvePublicUrl("data:text/html,unsafe", BASE), "");
  assert.equal(resolvePublicUrl("mailto:test@example.com", BASE), "");
});

test("resolvePublicUrl keeps malformed and empty values neutral", () => {
  assert.equal(resolvePublicUrl("", BASE), "");
  assert.equal(resolvePublicUrl(null, BASE), "");
  assert.equal(resolvePublicUrl("https://exa mple.com", BASE), "");
});
