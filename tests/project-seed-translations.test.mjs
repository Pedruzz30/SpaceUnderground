import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { projectPresentationSeed } from "../scripts/data/project-presentation-seed.mjs";

const DIACRITICS = /[áàâãéêíóôõúüç]/i;
// Case 005's Portuguese description happens to carry no diacritics, so the
// base-language check also looks for Portuguese function words.
const PORTUGUESE = /[áàâãéêíóôõúüç]|\b(?:para|com|que|uma?|dos|das|em|por|sobre|entre|escolar)\b/i;
const KNOWN_CASES = [1, 2, 3, 4, 5];

// Fields that identify, price or technically configure a project. None of them
// may ever appear inside a translation.
const STRUCTURAL_FIELDS = [
  "name",
  "client",
  "slug",
  "caseNumber",
  "category",
  "status",
  "year",
  "accent",
  "techStack",
  "projectUrl",
  "previewUrl",
  "featured",
  "visible",
];

const seedFor = (caseNumber) => projectPresentationSeed.find((entry) => entry.caseNumber === caseNumber);

describe("seeded project translations", () => {
  it("covers every known case from 001 to 005", () => {
    for (const caseNumber of KNOWN_CASES) {
      const seed = seedFor(caseNumber);
      assert.ok(seed, `case ${caseNumber} is seeded`);
      assert.ok(seed.translations?.en, `case ${caseNumber} has curated English`);
    }
  });

  it("does not invent a case 006", () => {
    assert.equal(seedFor(6), undefined, "case 006 must stay out of the curated seed");
    assert.deepEqual(
      projectPresentationSeed.map((entry) => entry.caseNumber).sort((a, b) => a - b),
      KNOWN_CASES,
    );
  });

  it("keeps pt-BR as the editorial base", () => {
    for (const seed of projectPresentationSeed) {
      assert.match(seed.description, PORTUGUESE, `case ${seed.caseNumber} base description is Portuguese`);
    }
  });

  it("translates the description into real English", () => {
    for (const seed of projectPresentationSeed) {
      const english = seed.translations.en.description;
      assert.ok(english, `case ${seed.caseNumber} has an English description`);
      assert.notEqual(english, seed.description, `case ${seed.caseNumber} description differs`);
      assert.doesNotMatch(english, DIACRITICS, `case ${seed.caseNumber} English description reads as Portuguese`);
    }
  });

  it("translates the presentation system, label and type", () => {
    for (const seed of projectPresentationSeed) {
      const presentation = seed.translations.en.presentation;
      assert.ok(presentation, `case ${seed.caseNumber} has presentation translations`);
      for (const field of ["system", "label", "type"]) {
        assert.ok(presentation[field], `case ${seed.caseNumber} presentation.${field} is translated`);
      }
      // "PERFORMANCE" happens to be the same word in both languages, so only
      // the fields that genuinely change are compared.
      assert.notEqual(presentation.system, seed.presentation.system);
      assert.notEqual(presentation.type, seed.presentation.type);
    }
  });

  it("never translates a proper name or a structural field", () => {
    for (const seed of projectPresentationSeed) {
      const translation = seed.translations.en;
      for (const field of STRUCTURAL_FIELDS) {
        assert.ok(!(field in translation), `case ${seed.caseNumber} translates the structural field ${field}`);
      }
    }
  });

  it("keeps technical presentation fields out of the translation", () => {
    for (const seed of projectPresentationSeed) {
      const presentation = seed.translations.en.presentation ?? {};
      // The address is a brand-based technical address and the origin and
      // coordinates are geographic tokens: all three stay as stored.
      for (const field of ["address", "origin", "coordinates"]) {
        assert.ok(!(field in presentation), `case ${seed.caseNumber} translates presentation.${field}`);
      }
    }
  });

  it("keeps a module translation for every base module, aligned by position", () => {
    for (const seed of projectPresentationSeed) {
      const baseModules = seed.modules;
      const translatedModules = seed.translations.en.modules;

      assert.equal(
        translatedModules.length,
        baseModules.length,
        `case ${seed.caseNumber} translates every module`,
      );

      translatedModules.forEach(([code, title, description], position) => {
        const [baseCode, baseTitle] = baseModules[position];
        assert.equal(code, baseCode, `case ${seed.caseNumber} module ${position} keeps its code`);
        assert.ok(title, `case ${seed.caseNumber} module ${position} has an English title`);
        assert.ok(description, `case ${seed.caseNumber} module ${position} has an English caption`);
        assert.doesNotMatch(title, DIACRITICS, `case ${seed.caseNumber} module ${position} title is English`);
        // Titles like "PERFORMANCE" and "SECURITY"/"SEGURANÇA" differ; a few
        // are legitimately identical, so only Portuguese diacritics are ruled
        // out rather than requiring a difference.
        void baseTitle;
      });
    }
  });

  it("preserves the tech stack and URLs exactly as stored", () => {
    const ink = seedFor(1);
    assert.deepEqual(ink.techStack, ["HTML", "CSS", "JAVASCRIPT"]);
    assert.equal(ink.name, "INK Tattoo");
    assert.equal(ink.projectUrl, "https://pedruzz30.github.io/TattooSite/");
    assert.ok(!JSON.stringify(ink.translations.en).includes("pedruzz30"), "no URL leaks into the translation");
    assert.ok(!JSON.stringify(ink.translations.en).includes("INK Tattoo"), "no project name in the translation");
  });
});
