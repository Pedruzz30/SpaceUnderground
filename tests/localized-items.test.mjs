import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { findByPosition, mergeLocalizedItems, mergeLocalizedRecord } from "../shared/localized-items.js";

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

describe("findByPosition", () => {
  // The exact shape that slipped past the earlier suite: the translation array
  // holds ONE entry, for position 2. Binding an editor row by array index would
  // hand that translation to position 0.
  const BASE = [
    { position: 0, title: "Sites", description: "PT Sites" },
    { position: 1, title: "Sistemas", description: "PT Sistemas" },
    { position: 2, title: "Automação", description: "PT Automação" },
  ];
  const TRANSLATED = [{ position: 2, title: "Automation" }];

  it("binds each base item to its own translation, or to none", () => {
    assert.equal(findByPosition(TRANSLATED, 0), undefined);
    assert.equal(findByPosition(TRANSLATED, 1), undefined);
    assert.deepEqual(findByPosition(TRANSLATED, 2), { position: 2, title: "Automation" });
  });

  it("would not be satisfied by the index the item happens to sit at", () => {
    // TRANSLATED[0] is the position-2 entry. Index lookup is exactly the bug.
    assert.notEqual(findByPosition(TRANSLATED, 0), TRANSLATED[0]);
  });

  it("matches a position stored as a string", () => {
    assert.deepEqual(findByPosition([{ position: "2", title: "EN" }], 2), { position: "2", title: "EN" });
  });

  it("tolerates a missing list", () => {
    assert.equal(findByPosition(undefined, 0), undefined);
    assert.equal(findByPosition([], 0), undefined);
  });

  it("resolves the whole row set the way the editor does", () => {
    const rows = BASE.map((baseItem) => ({
      position: baseItem.position,
      baseItem,
      item: findByPosition(TRANSLATED, baseItem.position) ?? { position: baseItem.position },
    }));

    assert.equal(rows.length, 3, "one row per base item");
    assert.equal(rows[0].item.title, undefined, "position 0 has no translated title");
    assert.equal(rows[0].baseItem.title, "Sites", "position 0 falls back to its own pt-BR title");
    assert.equal(rows[1].item.title, undefined, "position 1 has no translated title");
    assert.equal(rows[1].baseItem.title, "Sistemas");
    assert.equal(rows[2].item.title, "Automation", "position 2 gets its translation");
    assert.equal(rows[2].baseItem.title, "Automação");
    assert.deepEqual(rows.map((row) => row.position), [0, 1, 2], "positions are preserved");
  });

  it("falls back per field for the item that is translated", () => {
    const merged = mergeLocalizedItems(BASE, TRANSLATED);

    assert.equal(merged[2].title, "Automation", "translated field wins");
    assert.equal(merged[2].description, "PT Automação", "untranslated field keeps pt-BR");
    assert.equal(merged[0].title, "Sites", "untranslated item is untouched");
    assert.equal(merged[1].title, "Sistemas");
  });
});
