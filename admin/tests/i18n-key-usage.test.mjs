import { strict as assert } from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { CATEGORIES, EDITORIAL_STATUSES, PROJECT_STATUSES } from "../src/data/projects.js";
import { SUPPORTED_LOCALES, hasKey, setLocale, statusLabel } from "../src/i18n/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const adminRoot = join(here, "..");
const sourceRoot = join(adminRoot, "src");

const SCANNABLE_EXTENSIONS = new Set([".js", ".html"]);

// Literal t("...") / t('...') calls. Keys assembled at runtime, such as
// t(`status.${value}`), are deliberately out of scope for this scanner: they are
// covered by the dynamic-family assertions below instead of a fragile regex.
const LITERAL_CALL = /\bt\(\s*"([^"]*)"|\bt\(\s*'([^']*)'/g;
const ATTRIBUTE = /data-i18n(?:-html|-aria-label|-placeholder)?\s*=\s*"([^"]*)"/g;
// Keys held in data structures rather than passed to t() directly, such as the
// sidebar's navGroups. These reach the UI through t(item.labelKey) or
// data-i18n="${item.labelKey}", both invisible to the scanners above -- which is
// how a missing nav.dashboard shipped and rendered as a raw key.
const KEY_PROPERTY = /\b(?:labelKey|detailKey|hintKey|ariaKey|titleKey|placeholderKey|optionKeyPrefix)\s*:\s*"([^"]*)"/g;
// plural("key", count) resolves to key.one / key.other at call time.
const PLURAL_CALL = /\bplural\(\s*"([^"]*)"/g;

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return SCANNABLE_EXTENSIONS.has(extname(entry)) ? [full] : [];
  });
}

function scan() {
  const usages = [];
  const files = [...sourceFiles(sourceRoot), join(adminRoot, "index.html")];

  for (const file of files) {
    const contents = readFileSync(file, "utf8");
    const label = relative(adminRoot, file).replaceAll("\\", "/");

    for (const match of contents.matchAll(LITERAL_CALL)) {
      usages.push({ key: match[1] ?? match[2], file: label });
    }
    for (const match of contents.matchAll(KEY_PROPERTY)) {
      // optionKeyPrefix names a family, not a leaf, so only its children exist.
      if (match[0].startsWith("optionKeyPrefix")) continue;
      usages.push({ key: match[1], file: label });
    }
    for (const match of contents.matchAll(PLURAL_CALL)) {
      usages.push({ key: `${match[1]}.one`, file: label });
      usages.push({ key: `${match[1]}.other`, file: label });
    }
    for (const match of contents.matchAll(ATTRIBUTE)) {
      // data-i18n="${item.labelKey}" resolves at render time, not statically.
      if (match[1].includes("${")) continue;
      usages.push({ key: match[1], file: label });
    }
  }

  return usages;
}

describe("admin i18n key usage", () => {
  it("finds translation usages to audit", () => {
    assert.ok(scan().length > 100, "expected the scanner to find translation usages");
  });

  it("only uses keys that exist in the pt-BR dictionary", () => {
    const missing = scan()
      .filter((usage) => !hasKey(usage.key, "pt-BR"))
      .map((usage) => `${usage.file}: ${usage.key}`);

    assert.deepEqual([...new Set(missing)].sort(), []);
  });
});

// t(`status.${value}`) is assembled at runtime, so the scanner above cannot see
// it. These are the enum values that actually reach statusLabel(): project and
// editorial state, client lifecycle, pipeline stage, priority, and transaction
// state. They stay stored in English -- only their presentation is localized.
const DYNAMIC_STATUS_VALUES = [
  ...CATEGORIES,
  ...PROJECT_STATUSES,
  ...EDITORIAL_STATUSES,
  "ACTIVE",
  "INACTIVE",
  "ARCHIVED",
  "LEAD",
  "COMPLETED",
  "NEW",
  "CONTACTED",
  "PROPOSAL",
  "NEGOTIATION",
  "WON",
  "HIGH",
  "MEDIUM",
  "LOW",
  "PAID",
  "PENDING",
  "RECEIVED",
];

function statusKey(value) {
  return `status.${String(value).toLowerCase().replaceAll(" ", "")}`;
}

describe("admin i18n dynamic status keys", () => {
  it("resolves every known status value in the pt-BR dictionary", () => {
    const missing = DYNAMIC_STATUS_VALUES.filter((value) => !hasKey(statusKey(value), "pt-BR"));
    assert.deepEqual(missing, []);
  });

  it("presents every known status value in both locales", () => {
    for (const locale of SUPPORTED_LOCALES) {
      setLocale(locale, { persist: false });
      for (const value of DYNAMIC_STATUS_VALUES) {
        const label = statusLabel(value);
        assert.ok(label, `${locale}: ${value} produced an empty label`);
        assert.ok(!label.startsWith("status."), `${locale}: ${value} leaked the raw key ${label}`);
      }
    }
    setLocale("pt-BR", { persist: false });
  });

  it("localizes project status presentation without changing the stored value", () => {
    setLocale("pt-BR", { persist: false });
    assert.equal(statusLabel("In Development"), "Em desenvolvimento");
    setLocale("en", { persist: false });
    assert.equal(statusLabel("In Development"), "In Development");
    assert.ok(PROJECT_STATUSES.includes("In Development"));
    setLocale("pt-BR", { persist: false });
  });
});
