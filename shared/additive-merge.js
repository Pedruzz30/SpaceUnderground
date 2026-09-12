// Additive merge used by the English backfill.
//
// The rule is absolute: an existing translation always wins. The curated seed
// may only fill in what is missing, so running the backfill can never destroy
// work someone did by hand in the Admin, and running it twice changes nothing
// the second time.
//
// Repeatables start from the EXISTING array, not from the curated one. An item
// the person translated at a position the seed does not know about is carried
// through untouched; a curated item whose position is absent is appended.

const hasValue = (value) => typeof value === "string" && value.trim() !== "";
const positionOf = (item) => Number(item?.position);

/**
 * Merges one repeatable array additively, matching by `position`.
 *
 * @returns {{ items: object[], added: string[], kept: string[] }}
 */
export function mergeAdditiveItems(existingItems, curatedItems) {
  const existing = Array.isArray(existingItems) ? existingItems : [];
  const curated = Array.isArray(curatedItems) ? curatedItems : [];
  const added = [];
  const kept = [];

  // Start from what is already stored, so nothing can be dropped.
  const merged = existing.map((item) => ({ ...item }));

  for (const curatedItem of curated) {
    const index = merged.findIndex((item) => positionOf(item) === positionOf(curatedItem));

    if (index === -1) {
      merged.push({ ...curatedItem });
      added.push(`item@${curatedItem.position}`);
      continue;
    }

    for (const [field, value] of Object.entries(curatedItem)) {
      if (field === "position") continue;
      if (hasValue(merged[index][field])) {
        kept.push(`item@${curatedItem.position}.${field}`);
        continue;
      }
      merged[index][field] = value;
      added.push(`item@${curatedItem.position}.${field}`);
    }
  }

  return { items: merged, added, kept };
}

/**
 * Merges one translation object additively. Scalars are filled only when
 * absent or blank; `items` goes through mergeAdditiveItems above.
 *
 * @returns {{ translation: object, added: string[], kept: string[], changed: boolean }}
 */
export function mergeAdditiveTranslation(existingTranslation, curatedTranslation) {
  const existing = existingTranslation ?? {};
  const curated = curatedTranslation ?? {};
  const translation = { ...existing };
  const added = [];
  const kept = [];

  for (const [field, value] of Object.entries(curated)) {
    if (field === "items") continue;
    if (hasValue(existing[field])) {
      kept.push(field);
      continue;
    }
    translation[field] = value;
    added.push(field);
  }

  if (Array.isArray(curated.items) || Array.isArray(existing.items)) {
    const result = mergeAdditiveItems(existing.items, curated.items);
    added.push(...result.added);
    kept.push(...result.kept);
    // Only write the array back when it actually changed, so an unchanged run
    // reports nothing to do.
    if (JSON.stringify(result.items) !== JSON.stringify(existing.items ?? [])) {
      translation.items = result.items;
    }
  }

  return { translation, added, kept, changed: added.length > 0 };
}

/**
 * Merges the curated English translation into a record's full translations
 * object, leaving every other locale untouched.
 */
export function mergeAdditiveLocale(existingTranslations, curatedEnglish, locale = "en") {
  const existing = existingTranslations ?? {};
  const result = mergeAdditiveTranslation(existing[locale], curatedEnglish);

  return {
    translations: result.changed ? { ...existing, [locale]: result.translation } : existing,
    added: result.added,
    kept: result.kept,
    changed: result.changed,
  };
}
