// The HTTP security headers Netlify sends with the Admin (netlify.toml). The
// e2e suites run once against a build served with exactly these headers; this
// keeps the policy from being loosened by accident.
//
//   npm test

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const TOML = readFileSync(new URL("../../netlify.toml", import.meta.url), "utf8");
const HEADERS = Object.fromEntries(
  [...TOML.slice(TOML.indexOf("[headers.values]")).matchAll(/^\s*([A-Za-z-]+) = "(.*)"$/gm)].map((match) => [match[1], match[2]]),
);
const CSP = Object.fromEntries(
  (HEADERS["Content-Security-Policy"] ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [name, ...values] = part.split(/\s+/);
      return [name, values];
    }),
);
const INDEX = readFileSync(new URL("../index.html", import.meta.url), "utf8");

describe("security headers", () => {
  it("applies to every path of the Admin", () => {
    assert.match(TOML, /\[\[headers\]\]\s+for = "\/\*"/);
  });

  it("runs only the bundle's own scripts: no inline script, no eval", () => {
    assert.deepEqual(CSP["script-src"], ["'self'"]);
    assert.deepEqual(CSP["default-src"], ["'self'"]);
    assert.deepEqual(CSP["object-src"], ["'none'"]);
    assert.deepEqual(CSP["base-uri"], ["'self'"]);
    assert.deepEqual(CSP["form-action"], ["'self'"]);
    assert.doesNotMatch(INDEX.replace(/<script type="module" src="[^"]+"><\/script>/g, ""), /<script/i, "index.html has no other script");
  });

  it("refuses to be framed", () => {
    assert.deepEqual(CSP["frame-ancestors"], ["'none'"]);
    assert.equal(HEADERS["X-Frame-Options"], "DENY");
  });

  it("talks only to Supabase", () => {
    assert.deepEqual(CSP["connect-src"], ["'self'", "https://*.supabase.co", "wss://*.supabase.co"]);
  });

  it("keeps the transport and content-type protections", () => {
    assert.match(HEADERS["Strict-Transport-Security"], /max-age=(\d+)/);
    assert.ok(Number(HEADERS["Strict-Transport-Security"].match(/max-age=(\d+)/)[1]) >= 31536000);
    assert.equal(HEADERS["X-Content-Type-Options"], "nosniff");
    assert.equal(HEADERS["Referrer-Policy"], "strict-origin-when-cross-origin");
    assert.match(HEADERS["Permissions-Policy"], /camera=\(\)/);
    assert.match(HEADERS["Permissions-Policy"], /microphone=\(\)/);
    assert.ok("upgrade-insecure-requests" in CSP);
  });
});
