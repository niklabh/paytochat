import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { storage } from "./client";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/avif",
] as const;

export class ImageUploadError extends Error {}

export async function uploadMessageImage(opts: {
  userId: string;
  file: File;
}): Promise<{ url: string; path: string }> {
  const { userId, file } = opts;

  if (!ALLOWED_IMAGE_TYPES.includes(file.type as (typeof ALLOWED_IMAGE_TYPES)[number])) {
    throw new ImageUploadError(
      `Unsupported image type: ${file.type || "unknown"}.`
    );
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new ImageUploadError(
      `Image is too large (max ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB).`
    );
  }

  const ext = (file.name.split(".").pop() || "img").replace(/[^a-z0-9]/gi, "").slice(0, 8) || "img";
  const path = `message-images/${userId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const storageRef = ref(storage, path);
  const snap = await uploadBytes(storageRef, file, {
    contentType: file.type,
    cacheControl: "public, max-age=31536000, immutable",
  });
  const url = await getDownloadURL(snap.ref);
  return { url, path };
}
