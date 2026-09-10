export function mapFeaturesFromDatabase(rows) {
  if (!Array.isArray(rows)) return [];
  return [...rows]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((row, index) => ({
      id: row.id ?? null,
      position: Number.isFinite(Number(row.position)) ? Number(row.position) : index,
      text: row.text ?? "",
    }));
}

export function mapPlanFromDatabase(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug ?? "",
    name: row.name ?? "",
    monogram: row.monogram ?? "",
    category: row.category ?? "",
    range: row.range ?? "",
    scope: row.scope ?? "",
    scopeShort: row.scope_short ?? "",
    status: row.status ?? "",
    description: row.description ?? "",
    timeline: row.timeline ?? "",
    year: row.year == null ? "" : String(row.year),
    accent: row.accent ?? "",
    visible: Boolean(row.visible),
    position: Number(row.position) || 0,
    features: mapFeaturesFromDatabase(row.plan_features),
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

export function mapPlanToDatabase(plan) {
  const row = {};
  if (plan.slug !== undefined) row.slug = plan.slug;
  if (plan.name !== undefined) row.name = plan.name;
  if (plan.monogram !== undefined) row.monogram = plan.monogram || null;
  if (plan.category !== undefined) row.category = plan.category || null;
  if (plan.range !== undefined) row.range = plan.range || null;
  if (plan.scope !== undefined) row.scope = plan.scope || null;
  if (plan.scopeShort !== undefined) row.scope_short = plan.scopeShort || null;
  if (plan.status !== undefined) row.status = plan.status || "AVAILABLE";
  if (plan.description !== undefined) row.description = plan.description || null;
  if (plan.timeline !== undefined) row.timeline = plan.timeline || null;
  if (plan.year !== undefined) row.year = plan.year === "" ? null : Number(plan.year);
  if (plan.accent !== undefined) row.accent = plan.accent || null;
  if (plan.visible !== undefined) row.visible = Boolean(plan.visible);
  if (plan.position !== undefined) row.position = Number(plan.position) || 0;
  return row;
}
