import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { seedPlans, seedSiteContent, seedSiteSettings } from "../src/data/plans.js";

const PORTUGUESE = /[áàâãéêíóôõúüç]/i;
const TRANSLATION_LOCALE = "en";

// Fields that identify or configure a record rather than describe it. They live
// once, in the base row, and must never appear inside translations.
const STRUCTURAL_CONTENT_FIELDS = ["primaryCtaUrl", "secondaryCtaUrl", "link", "accent", "brand"];
const STRUCTURAL_PLAN_FIELDS = ["name", "slug", "monogram", "range", "year", "accent", "position", "visible"];
const STRUCTURAL_SETTINGS_FIELDS = ["siteName", "siteUrl", "contactEmail", "ogImagePath", "locale"];

describe("seeded site content", () => {
  it("keeps pt-BR as the base editorial language", () => {
    const hero = seedSiteContent.find((entry) => entry.key === "hero");
    assert.ok(hero, "hero section is seeded");
    assert.match(hero.content.headline, PORTUGUESE, `expected Portuguese base copy, got "${hero.content.headline}"`);
    assert.match(hero.content.description, PORTUGUESE);
  });

  it("ships curated English that differs from the base", () => {
    for (const entry of seedSiteContent) {
      const translation = entry.translations?.[TRANSLATION_LOCALE];
      if (!translation) continue;

      for (const [field, value] of Object.entries(translation)) {
        if (field === "items") continue;
        assert.notEqual(
          value,
          entry.content[field],
          `${entry.key}.${field} is identical in both locales`,
        );
        assert.doesNotMatch(String(value), PORTUGUESE, `${entry.key}.${field} still reads as Portuguese`);
      }
    }
  });

  it("never puts a structural field in a translation", () => {
    for (const entry of seedSiteContent) {
      const translation = entry.translations?.[TRANSLATION_LOCALE] ?? {};
      for (const field of STRUCTURAL_CONTENT_FIELDS) {
        assert.ok(!(field in translation), `${entry.key} translates the structural field ${field}`);
      }
      for (const item of translation.items ?? []) {
        for (const field of STRUCTURAL_CONTENT_FIELDS) {
          assert.ok(!(field in item), `${entry.key} item translates the structural field ${field}`);
        }
      }
    }
  });

  it("aligns repeatable translations with the base items by position", () => {
    for (const entry of seedSiteContent) {
      const baseItems = entry.content.items;
      const translatedItems = entry.translations?.[TRANSLATION_LOCALE]?.items;
      if (!Array.isArray(baseItems) || !Array.isArray(translatedItems)) continue;

      assert.equal(translatedItems.length, baseItems.length, `${entry.key} item count matches`);
      translatedItems.forEach((item, index) => {
        assert.equal(
          Number(item.position),
          Number(baseItems[index].position),
          `${entry.key} item ${index} keeps its position`,
        );
      });
    }
  });
});

describe("seeded plans", () => {
  it("keeps plan names and pricing out of translations", () => {
    for (const plan of seedPlans) {
      const translation = plan.translations?.[TRANSLATION_LOCALE] ?? {};
      for (const field of STRUCTURAL_PLAN_FIELDS) {
        assert.ok(!(field in translation), `${plan.slug} translates the structural field ${field}`);
      }
    }
  });

  it("ships curated English editorial copy for every plan", () => {
    for (const plan of seedPlans) {
      const translation = plan.translations?.[TRANSLATION_LOCALE];
      assert.ok(translation, `${plan.slug} has an English translation`);
      assert.ok(translation.description, `${plan.slug} has an English description`);
      assert.doesNotMatch(translation.description, PORTUGUESE, `${plan.slug} English description reads as Portuguese`);
      assert.match(plan.description, PORTUGUESE, `${plan.slug} base description is Portuguese`);
    }
  });

  it("translates every feature and keeps its position", () => {
    for (const plan of seedPlans) {
      for (const feature of plan.features ?? []) {
        const text = feature.translations?.[TRANSLATION_LOCALE]?.text;
        assert.ok(text, `${plan.slug} feature ${feature.position} has English text`);
        assert.notEqual(text, feature.text, `${plan.slug} feature ${feature.position} is identical in both locales`);
        assert.ok(!("position" in (feature.translations?.[TRANSLATION_LOCALE] ?? {})), "position stays structural");
      }
    }
  });
});

describe("seeded settings", () => {
  it("translates SEO copy only", () => {
    const translation = seedSiteSettings.translations?.[TRANSLATION_LOCALE] ?? {};
    assert.ok(translation.seo_description, "English SEO description is seeded");
    for (const field of STRUCTURAL_SETTINGS_FIELDS) {
      assert.ok(!(field in translation), `settings translate the structural field ${field}`);
    }
  });

  it("keeps the base SEO description in Portuguese", () => {
    assert.match(seedSiteSettings.seoDescription, PORTUGUESE);
  });
});
