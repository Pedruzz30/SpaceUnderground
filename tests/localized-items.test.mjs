import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { mergeLocalizedItems, mergeLocalizedRecord } from "../shared/localized-items.js";

describe("mergeLocalizedItems", () => {
  it("applies a partial translation to the matching position only", () => {
    const base = [
      { position: 0, title: "PT 0" },
      { position: 1, title: "PT 1" },
      { position: 2, title: "PT 2" },
    ];
    const translated = [{ position: 2, title: "EN 2" }];

    assert.deepEqual(mergeLocalizedItems(base, translated), [
      { position: 0, title: "PT 0" },
      { position: 1, title: "PT 1" },
      { position: 2, title: "EN 2" },
    ]);
  });

  it("never shifts a translation onto the wrong item", () => {
    // Matching by array index would put "EN 2" on position 0.
    const base = [
      { position: 0, title: "PT 0" },
      { position: 1, title: "PT 1" },
      { position: 2, title: "PT 2" },
    ];
    const merged = mergeLocalizedItems(base, [{ position: 2, title: "EN 2" }]);

    assert.equal(merged[0].title, "PT 0");
    assert.equal(merged[1].title, "PT 1");
  });

  it("falls back per field when a translation covers only some of them", () => {
    const base = [{ position: 1, title: "Título PT", description: "Descrição PT", kicker: "Kicker PT" }];
    const merged = mergeLocalizedItems(base, [{ position: 1, title: "EN title" }]);

    assert.deepEqual(merged, [
      { position: 1, title: "EN title", description: "Descrição PT", kicker: "Kicker PT" },
    ]);
  });

  it("treats a blank translated value as untranslated", () => {
    const base = [{ position: 0, title: "PT", description: "Descrição PT" }];
    const merged = mergeLocalizedItems(base, [{ position: 0, title: "", description: "   " }]);

    assert.deepEqual(merged, [{ position: 0, title: "PT", description: "Descrição PT" }]);
  });

  it("keeps pt-BR in charge of the structure", () => {
    const base = [{ position: 0, title: "PT 0" }];
    // A translation for an item that no longer exists is ignored rather than
    // reintroducing the item.
    const merged = mergeLocalizedItems(base, [
      { position: 0, title: "EN 0" },
      { position: 7, title: "EN orphan" },
    ]);

    assert.equal(merged.length, 1);
    assert.deepEqual(merged, [{ position: 0, title: "EN 0" }]);
  });

  it("never lets a translation change a position", () => {
    const base = [{ position: 3, title: "PT" }];
    const merged = mergeLocalizedItems(base, [{ position: 3, title: "EN", }]);

    assert.equal(merged[0].position, 3);
  });

  it("returns the base list untouched when there is no translation", () => {
    const base = [{ position: 0, title: "PT" }];
    assert.equal(mergeLocalizedItems(base, undefined), base);
    assert.equal(mergeLocalizedItems(base, []), base);
  });

  it("tolerates a missing base list", () => {
    assert.deepEqual(mergeLocalizedItems(undefined, [{ position: 0 }]), []);
  });

  it("matches positions stored as strings", () => {
    const base = [{ position: 0, title: "PT 0" }, { position: 1, title: "PT 1" }];
    const merged = mergeLocalizedItems(base, [{ position: "1", title: "EN 1" }]);

    assert.equal(merged[1].title, "EN 1");
    assert.equal(merged[0].title, "PT 0");
  });
});

describe("mergeLocalizedRecord", () => {
  it("merges scalars and defers items to the position-aware merge", () => {
    const base = {
      headline: "Manchete PT",
      description: "Descrição PT",
      primaryCtaUrl: "#project-request",
      items: [
        { position: 0, title: "PT 0", link: "#plans" },
        { position: 1, title: "PT 1", link: "#plans" },
      ],
    };
    const translation = {
      headline: "EN headline",
      items: [{ position: 1, title: "EN 1" }],
    };

    assert.deepEqual(mergeLocalizedRecord(base, translation), {
      headline: "EN headline",
      description: "Descrição PT",
      primaryCtaUrl: "#project-request",
      items: [
        { position: 0, title: "PT 0", link: "#plans" },
        { position: 1, title: "EN 1", link: "#plans" },
      ],
    });
  });

  it("keeps structural fields from the base when a translation omits them", () => {
    const base = { items: [{ position: 0, title: "PT", link: "#plans", accent: "#c6ff00" }] };
    const merged = mergeLocalizedRecord(base, { items: [{ position: 0, title: "EN" }] });

    assert.equal(merged.items[0].link, "#plans");
    assert.equal(merged.items[0].accent, "#c6ff00");
  });

  it("copies the base record when there is no translation", () => {
    const base = { headline: "PT", items: [{ position: 0, title: "PT" }] };
    const merged = mergeLocalizedRecord(base, null);

    assert.deepEqual(merged, base);
    assert.notEqual(merged, base, "returns a copy rather than the original");
  });

  it("survives an empty record", () => {
    assert.deepEqual(mergeLocalizedRecord(undefined, undefined), {});
  });
});
