// Single place where the UI model (camelCase) meets the database row
// (snake_case). Pages and services never do this conversion themselves.
//
// Two identifiers coexist on purpose:
//   - `dbId`       uuid, the real primary key in Postgres
//   - `id`         the padded case number ("001"), what the admin router uses
// Keeping `id` as the case number lets `#/projects/001` keep working while the
// database uses a proper uuid primary key.

export function formatCaseNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value ?? "");
  return String(number).padStart(3, "0");
}

export function parseCaseNumber(value) {
  const number = Number(String(value ?? "").replace(/^0+(?=\d)/, ""));
  return Number.isFinite(number) ? number : null;
}

export function mapGalleryFromDatabase(rows) {
  if (!Array.isArray(rows)) return [];

  return [...rows]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((row) => ({
      id: row.id,
      path: row.url ?? "",
      alt: row.alt ?? "",
      caption: row.caption ?? "",
    }));
}

export function mapProjectFromDatabase(row) {
  if (!row) return null;

  return {
    id: formatCaseNumber(row.case_number),
    dbId: row.id,
    caseNumber: formatCaseNumber(row.case_number),
    name: row.name ?? "",
    slug: row.slug ?? "",
    client: row.client ?? "",
    category: row.category ?? "Website",
    description: row.description ?? "",
    status: row.status ?? "In Development",
    editorialStatus: row.editorial_status ?? "DRAFT",
    featured: Boolean(row.featured),
    visible: Boolean(row.visible),
    year: row.year == null ? "" : String(row.year),
    accent: row.accent ?? "",
    techStack: Array.isArray(row.tech_stack) ? row.tech_stack : [],
    // Either a storage path inside the project-media bucket or an absolute URL.
    poster: row.poster_url ?? "",
    // Gallery rows live in project_gallery; the repository attaches them.
    gallery: mapGalleryFromDatabase(row.project_gallery),
    projectUrl: row.project_url ?? "",
    previewUrl: row.preview_url ?? "",
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
    publishedAt: row.published_at ?? null,
  };
}

export function mapProjectToDatabase(model) {
  const row = {};

  if (model.caseNumber !== undefined) row.case_number = parseCaseNumber(model.caseNumber);
  if (model.name !== undefined) row.name = model.name;
  if (model.slug !== undefined) row.slug = model.slug;
  if (model.client !== undefined) row.client = model.client;
  if (model.category !== undefined) row.category = model.category;
  if (model.description !== undefined) row.description = model.description;
  if (model.status !== undefined) row.status = model.status;
  if (model.editorialStatus !== undefined) row.editorial_status = model.editorialStatus;
  if (model.featured !== undefined) row.featured = Boolean(model.featured);
  if (model.visible !== undefined) row.visible = Boolean(model.visible);
  if (model.year !== undefined) row.year = model.year === "" ? null : Number(model.year);
  if (model.accent !== undefined) row.accent = model.accent || null;
  if (model.techStack !== undefined) row.tech_stack = model.techStack ?? [];
  if (model.poster !== undefined) row.poster_url = model.poster || null;
  if (model.projectUrl !== undefined) row.project_url = model.projectUrl || null;
  if (model.previewUrl !== undefined) row.preview_url = model.previewUrl || null;

  return row;
}
