import { strict as assert } from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import ptBR from "../src/scripts/i18n/locales/pt-BR.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const scriptsRoot = join(root, "src", "scripts");
const indexHtml = join(root, "index.html");

function flatten(dictionary, prefix = "") {
  return Object.entries(dictionary).flatMap(([key, value]) => {
    const name = prefix ? `${prefix}.${key}` : key;
    return value && typeof value === "object" ? flatten(value, name) : [name];
  });
}

const PT_KEYS = new Set(flatten(ptBR));

const LITERAL_CALL = /\bt\(\s*"([^"]*)"|\bt\(\s*'([^']*)'/g;
const ATTRIBUTE = /data-i18n(?:-html|-aria-label|-placeholder|-title)?\s*=\s*"([^"]*)"/g;

function scriptFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return scriptFiles(full);
    return extname(entry) === ".js" ? [full] : [];
  });
}

function usages() {
  const found = [];
  const files = [...scriptFiles(scriptsRoot), indexHtml];

  for (const file of files) {
    const contents = readFileSync(file, "utf8");
    const label = relative(root, file).replaceAll("\\", "/");

    for (const match of contents.matchAll(LITERAL_CALL)) {
      found.push({ key: match[1] ?? match[2], file: label });
    }
    for (const match of contents.matchAll(ATTRIBUTE)) {
      if (match[1].includes("${")) continue;
      found.push({ key: match[1], file: label });
    }
  }

  return found;
}

describe("public i18n key usage", () => {
  it("finds translation usages to audit", () => {
    assert.ok(usages().length > 100, "expected the scanner to find translation usages");
  });

  it("only uses keys that exist in the pt-BR dictionary", () => {
    const missing = usages()
      .filter((usage) => !PT_KEYS.has(usage.key))
      .map((usage) => `${usage.file}: ${usage.key}`);

    assert.deepEqual([...new Set(missing)].sort(), []);
  });
});

// The build ships pt-BR markup for SEO, so a visible English sentence in
// index.html means a block was written in the wrong language, or was left
// unmarked and can never switch. Proper names, technical tokens and code are
// not copy and are excluded.
const ALLOWED_IN_HTML = [
  /^(?:SPACE|UNDERGROUND|SPACE UNDERGROUND)$/i,
  /^(?:SU|S\/|P\+|P•|P×|CAP)$/,
  /^(?:Studio|Labs|GitHub|Instagram|LinkedIn|E-commerce|JARVIS)$/,
  /^(?:Plus|Pro|Max)$/,
  /^(?:Landing Pages?|Portfolio)$/,
  /^CASE[\s/]/,
  /^(?:PLANO|LAB_001|OBJECT_00A|MEM_00A|EST\.)/,
  /^ROT\b/,
  /^\d/,
  /^[A-Z0-9_\-./°'"\s·×•+—–]+$/,
];

// Words that only appear in English prose. Portuguese copy never contains them.
const ENGLISH_MARKERS = /\b(?:the|and|with|from|built|without|design|projects|launch|ways|start|included|what|your|our|for a|to be|remembered)\b/i;

describe("public static audit", () => {
  it("ships pt-BR copy in index.html, with no unmarked English blocks", () => {
    const html = readFileSync(indexHtml, "utf8");

    // Text between tags that carries no data-i18n attribute on its element.
    const offenders = [];
    const blocks = html.matchAll(/<([a-z0-9]+)([^>]*)>([^<>{}]{4,})<\/\1>/gi);

    for (const [, , attrs, rawText] of blocks) {
      const text = rawText.trim();
      if (!text || attrs.includes("data-i18n")) continue;
      if (ALLOWED_IN_HTML.some((rule) => rule.test(text))) continue;
      if (!ENGLISH_MARKERS.test(text)) continue;
      offenders.push(text);
    }

    assert.deepEqual(offenders, []);
  });

  it("declares pt-BR as the served language", () => {
    const html = readFileSync(indexHtml, "utf8");
    assert.match(html, /<html lang="pt-BR">/);
  });

  it("marks up the locale switcher for both supported locales", () => {
    const html = readFileSync(indexHtml, "utf8");
    assert.match(html, /data-locale-switch="pt-BR"/);
    assert.match(html, /data-locale-switch="en"/);
  });
});
