import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { mergeAdditiveItems, mergeAdditiveLocale, mergeAdditiveTranslation } from "../shared/additive-merge.js";

describe("mergeAdditiveItems", () => {
  it("matches the documented example exactly", () => {
    const existing = [
      { position: 0, title: "Manual 0" },
      { position: 9, title: "Manual custom" },
    ];
    const curated = [
      { position: 0, title: "Curated 0", description: "Curated desc" },
      { position: 1, title: "Curated 1" },
    ];

    assert.deepEqual(mergeAdditiveItems(existing, curated).items, [
      { position: 0, title: "Manual 0", description: "Curated desc" },
      { position: 9, title: "Manual custom" },
      { position: 1, title: "Curated 1" },
    ]);
  });

  it("never overwrites an existing translated field", () => {
    const { items } = mergeAdditiveItems(
      [{ position: 0, title: "Manual" }],
      [{ position: 0, title: "Curated" }],
    );
    assert.equal(items[0].title, "Manual");
  });

  it("fills a field that is absent or blank", () => {
    const { items } = mergeAdditiveItems(
      [{ position: 0, title: "Manual", description: "   " }],
      [{ position: 0, description: "Curated desc", kicker: "Curated kicker" }],
    );
    assert.equal(items[0].description, "Curated desc");
    assert.equal(items[0].kicker, "Curated kicker");
  });

  it("preserves an existing item the curated seed knows nothing about", () => {
    const { items } = mergeAdditiveItems(
      [{ position: 42, title: "Hand written" }],
      [{ position: 0, title: "Curated 0" }],
    );
    assert.ok(items.some((item) => item.position === 42 && item.title === "Hand written"));
  });

  it("appends a curated item whose position is missing", () => {
    const { items } = mergeAdditiveItems([], [{ position: 2, title: "Curated 2" }]);
    assert.deepEqual(items, [{ position: 2, title: "Curated 2" }]);
  });

  it("never changes a position", () => {
    const { items } = mergeAdditiveItems(
      [{ position: 5, title: "Manual" }],
      [{ position: 5, description: "Curated" }],
    );
    assert.equal(items[0].position, 5);
  });

  it("is idempotent", () => {
    const existing = [{ position: 0, title: "Manual 0" }];
    const curated = [{ position: 0, title: "Curated 0", description: "Curated desc" }];

    const once = mergeAdditiveItems(existing, curated).items;
    const twice = mergeAdditiveItems(once, curated);

    assert.deepEqual(twice.items, once);
    assert.deepEqual(twice.added, [], "a second run has nothing to add");
  });

  it("does not mutate the input", () => {
    const existing = [{ position: 0, title: "Manual" }];
    mergeAdditiveItems(existing, [{ position: 0, description: "Curated" }]);
    assert.deepEqual(existing, [{ position: 0, title: "Manual" }]);
  });
});

describe("mergeAdditiveTranslation", () => {
  it("keeps an existing scalar and fills a missing one", () => {
    const { translation, added, kept } = mergeAdditiveTranslation(
      { headline: "Manual headline" },
      { headline: "Curated headline", description: "Curated description" },
    );

    assert.equal(translation.headline, "Manual headline");
    assert.equal(translation.description, "Curated description");
    assert.deepEqual(added, ["description"]);
    assert.deepEqual(kept, ["headline"]);
  });

  it("reports no change when everything is already translated", () => {
    const result = mergeAdditiveTranslation(
      { headline: "Manual", description: "Manual too" },
      { headline: "Curated", description: "Curated too" },
    );

    assert.equal(result.changed, false);
    assert.deepEqual(result.added, []);
  });

  it("routes items through the additive item merge", () => {
    const { translation } = mergeAdditiveTranslation(
      { items: [{ position: 3, title: "Manual 3" }] },
      { items: [{ position: 0, title: "Curated 0" }] },
    );

    assert.equal(translation.items.length, 2);
    assert.equal(translation.items[0].title, "Manual 3");
  });

  it("is idempotent across a full round", () => {
    const curated = {
      headline: "Curated headline",
      items: [{ position: 0, title: "Curated 0" }],
    };

    const first = mergeAdditiveTranslation({}, curated);
    const second = mergeAdditiveTranslation(first.translation, curated);

    assert.equal(second.changed, false);
    assert.deepEqual(second.translation, first.translation);
  });
});

describe("mergeAdditiveLocale", () => {
  it("leaves other locales untouched", () => {
    const existing = { en: { headline: "Manual EN" }, es: { headline: "Manual ES" } };
    const { translations } = mergeAdditiveLocale(existing, { description: "Curated" });

    assert.deepEqual(translations.es, { headline: "Manual ES" });
    assert.equal(translations.en.headline, "Manual EN");
    assert.equal(translations.en.description, "Curated");
  });

  it("returns the original translations object when nothing changes", () => {
    const existing = { en: { headline: "Manual" } };
    const result = mergeAdditiveLocale(existing, { headline: "Curated" });

    assert.equal(result.changed, false);
    assert.equal(result.translations, existing);
  });

  it("creates the locale when the record has no translations at all", () => {
    const { translations, changed } = mergeAdditiveLocale(undefined, { description: "Curated" });

    assert.equal(changed, true);
    assert.deepEqual(translations, { en: { description: "Curated" } });
  });
});
