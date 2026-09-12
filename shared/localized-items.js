// Position-aware merge for repeatable editorial content.
//
// pt-BR always defines the structure: which items exist, how many there are and
// in what order. A translation is allowed to be partial -- it may cover one item
// out of four, and one field out of three -- so it is matched to the base item
// by `position`, never by array index. Matching by index would shift a
// translation onto the wrong item as soon as the translated array were shorter
// than the base one.
//
// Shared by the Admin CMS preview and the public renderer so both resolve
// content the same way.

const positionOf = (item) => Number(item?.position);

/** Blank strings are treated as "not translated", so the base value stands. */
function translatedEntries(item) {
  return Object.entries(item ?? {}).filter(
    ([field, value]) => field !== "position" && String(value ?? "").trim() !== "",
  );
}

/**
 * Returns the base items with any matching translation applied on top.
 *
 * - items present only in the base keep their base copy;
 * - items present only in the translation are ignored, because pt-BR owns the
 *   structure;
 * - `position` always comes from the base item.
 */
export function mergeLocalizedItems(baseItems, translatedItems) {
  if (!Array.isArray(baseItems)) return [];
  if (!Array.isArray(translatedItems) || !translatedItems.length) return baseItems;

  return baseItems.map((baseItem) => {
    const translated = translatedItems.find((item) => positionOf(item) === positionOf(baseItem));
    if (!translated) return baseItem;

    return {
      ...baseItem,
      ...Object.fromEntries(translatedEntries(translated)),
      position: baseItem.position,
    };
  });
}

/**
 * Resolves one content record for a locale: scalar fields merge normally, while
 * `items` goes through the position-aware merge above.
 */
export function mergeLocalizedRecord(baseContent, translation) {
  const base = baseContent ?? {};
  if (!translation) return { ...base };

  const merged = { ...base };
  Object.entries(translation).forEach(([field, value]) => {
    if (field === "items") return;
    if (String(value ?? "").trim() !== "") merged[field] = value;
  });

  if (Array.isArray(base.items)) {
    merged.items = mergeLocalizedItems(base.items, translation.items);
  }

  return merged;
}
