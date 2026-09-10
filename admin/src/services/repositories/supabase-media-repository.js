import { getSupabaseClient } from "../../lib/supabase.js";
import { toDataError } from "../errors.js";

const BUCKET = "project-media";
const SIGNED_URL_TTL_SECONDS = 3600;
const FOLDERS = ["poster", "gallery"];

const EXTENSION_BY_TYPE = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
};

function extensionFor(file) {
  return EXTENSION_BY_TYPE[file.type] ?? "bin";
}

export const supabaseMediaRepository = {
  // Mirrors the bucket configuration in 002_project_media_storage.sql. The
  // storage API enforces these too; checking here just fails faster and nicer.
  maxBytes: 5 * 1024 * 1024,
  acceptedTypes: Object.keys(EXTENSION_BY_TYPE),

  async upload({ projectId, kind, file }) {
    const supabase = getSupabaseClient();
    const path = `projects/${projectId}/${kind}/${crypto.randomUUID()}.${extensionFor(file)}`;

    const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
      contentType: file.type,
      cacheControl: "3600",
      upsert: false,
    });
    if (error) throw toDataError(error, "Unable to upload the image.");

    return path;
  },

  async remove(paths) {
    if (!paths.length) return;
    const supabase = getSupabaseClient();
    const { error } = await supabase.storage.from(BUCKET).remove(paths);
    if (error) throw toDataError(error, "Unable to remove the image.");
  },

  // Best effort: a storage hiccup must not block deleting the project itself,
  // it would only leave files behind.
  async removeProjectFolder(projectId) {
    const supabase = getSupabaseClient();
    const paths = [];

    for (const folder of FOLDERS) {
      const prefix = `projects/${projectId}/${folder}`;
      const { data, error } = await supabase.storage.from(BUCKET).list(prefix, { limit: 1000 });
      if (error || !data) continue;
      paths.push(...data.map((object) => `${prefix}/${object.name}`));
    }

    if (!paths.length) return { removed: 0 };
    const { error } = await supabase.storage.from(BUCKET).remove(paths);
    return { removed: error ? 0 : paths.length, error: error ?? null };
  },

  // Private bucket: everything is served through a short-lived signed URL,
  // which anon can only mint for objects the read policy already allows.
  async resolveUrl(path) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    // A missing or forbidden object should render as "no image", never as a
    // thrown error that takes the whole editor down.
    if (error || !data?.signedUrl) return "";
    return data.signedUrl;
  },
};
