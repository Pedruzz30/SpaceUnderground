import { DataError, toDataError } from "./errors.js";
import { getMediaRepository } from "./repositories/index.js";
import { t } from "../i18n/index.js";

// Media contract used by the editor. Pages never learn whether an image lives
// in Supabase Storage or as a data URL in the mock store.

// Values that are already displayable as-is: absolute URLs, data URLs, and the
// relative paths the seed data uses. Anything else is a storage path.
const DISPLAYABLE = /^(https?:|data:|blob:|\/|\.{1,2}\/)/i;

function formatBytes(bytes) {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

export function isStoragePath(value) {
  return Boolean(value) && !DISPLAYABLE.test(value);
}

async function validate(file) {
  const repository = await getMediaRepository();

  if (!file) throw new DataError("No file selected.", { code: "invalid_file" });

  if (!repository.acceptedTypes.includes(file.type)) {
    throw new DataError("Unsupported image type. Use PNG, JPEG, WebP, AVIF or GIF.", { code: "invalid_file" });
  }

  if (file.size === 0) {
    throw new DataError("That file is empty.", { code: "invalid_file" });
  }

  if (file.size > repository.maxBytes) {
    throw new DataError(`Image is too large. Maximum is ${formatBytes(repository.maxBytes)}.`, { code: "file_too_large" });
  }

  return repository;
}

export async function uploadProjectImage({ projectId, kind, file }) {
  const repository = await validate(file);

  if (!projectId) {
    throw new DataError("Save the project before uploading images.", { code: "project_required" });
  }

  try {
    return await repository.upload({ projectId, kind, file });
  } catch (error) {
    throw toDataError(error, t("errors.data.uploadImage"));
  }
}

// Used to clean up replaced or removed images once a save succeeds. Failures
// here only leave a file behind, so they never surface as a save failure.
export async function removeProjectImages(paths = []) {
  const storagePaths = paths.filter(isStoragePath);
  if (!storagePaths.length) return;

  try {
    const repository = await getMediaRepository();
    await repository.remove(storagePaths);
  } catch {
    // Intentionally swallowed: an orphaned file is recoverable, a failed save is not.
  }
}

export async function removeProjectFolder(projectId) {
  if (!projectId) return { removed: 0 };

  try {
    const repository = await getMediaRepository();
    return await repository.removeProjectFolder(projectId);
  } catch {
    return { removed: 0 };
  }
}

export async function resolveImageUrl(value) {
  if (!value) return "";
  if (!isStoragePath(value)) return value;

  try {
    const repository = await getMediaRepository();
    return await repository.resolveUrl(value);
  } catch {
    return "";
  }
}

export async function resolveGalleryUrls(gallery = []) {
  return Promise.all(
    gallery.map(async (item) => ({ ...item, displayUrl: await resolveImageUrl(item.path) })),
  );
}

export async function scanOrphanedAssets(usedPaths = []) {
  try {
    const repository = await getMediaRepository();
    if (typeof repository.scanOrphans !== "function") return [];
    return await repository.scanOrphans(usedPaths);
  } catch (error) {
    throw toDataError(error, t("errors.data.scanStorage"));
  }
}
