import { DataError } from "../errors.js";

// Mock media lives as a data URL inside the project record, so images survive a
// reload in development just like they do against Supabase Storage. localStorage
// is small, hence the much tighter size cap.

const MAX_BYTES = 1024 * 1024;

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new DataError("Unable to read the image file.", { code: "read_failed" }));
    reader.readAsDataURL(file);
  });
}

export const mockMediaRepository = {
  maxBytes: MAX_BYTES,
  acceptedTypes: ["image/png", "image/jpeg", "image/webp", "image/avif", "image/gif"],

  async upload({ file }) {
    return readAsDataUrl(file);
  },

  // Data URLs are stored inline in the project record, so removing the
  // reference is all the cleanup there is.
  async remove() {},

  async removeProjectFolder() {
    return { removed: 0 };
  },

  async resolveUrl(value) {
    return value;
  },

  async scanOrphans() {
    return [];
  },
};
