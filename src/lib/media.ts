import { createClient } from "@/lib/supabase/client";

import { IMAGE_EXTENSIONS, fitWithin, imageProblem } from "./image-rules";

export { ACCEPTED_IMAGES, imageProblem, MAX_IMAGE_BYTES } from "./image-rules";

export const MEDIA_BUCKET = "roomie-media";

/**
 * What a file is for. Profile photos and flat photos live in the same
 * per-student folder but never mix: each has its own file prefix and its
 * own table (profile_photos vs listings.photos).
 */
export type MediaKind = "avatar" | "photo" | "listing";

/**
 * Make a phone photo upload-friendly: scale it so its longest side is at
 * most 1600px and save it as JPEG. Small images are left alone. If the
 * browser can't decode it, the original is used (and checked as usual).
 */
export async function prepareImage(file: File): Promise<File> {
  if (!IMAGE_EXTENSIONS[file.type] || typeof createImageBitmap !== "function") {
    return file;
  }
  try {
    const bitmap = await createImageBitmap(file);
    const size = fitWithin(bitmap.width, bitmap.height);
    const isSmall =
      size.width === bitmap.width && file.size <= 1.5 * 1024 * 1024;
    if (isSmall) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, size.width, size.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    );
    if (!blob) {
      return file;
    }
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", {
      type: "image/jpeg",
    });
  } catch {
    return file;
  }
}

/**
 * Upload an image to `<user id>/<kind>-<time>-<random>.<ext>` and return
 * its public URL. The storage rules only allow writing to your own folder
 * (and only for eligible SRM accounts), and the bucket itself refuses other
 * file types and anything over 5 MB.
 */
export async function uploadImage(
  userId: string,
  kind: MediaKind,
  file: File,
): Promise<string> {
  const ready = await prepareImage(file);
  const problem = imageProblem(ready);
  if (problem) {
    throw new Error(problem);
  }
  const supabase = createClient();
  const random = Math.random().toString(36).slice(2, 8);
  const path = `${userId}/${kind}-${Date.now()}-${random}.${IMAGE_EXTENSIONS[ready.type]}`;
  const { error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .upload(path, ready, { contentType: ready.type, cacheControl: "31536000" });
  if (error) {
    throw new Error("The upload failed. Check your connection and try again.");
  }
  return supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * True when `url` is a public file in this user's own folder. The server
 * uses this so nobody can save someone else's photo as their own.
 */
export function isOwnMediaUrl(url: string, userId: string): boolean {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) {
    return false;
  }
  const prefix = `${base}/storage/v1/object/public/${MEDIA_BUCKET}/${userId}/`;
  return url.startsWith(prefix) && !url.slice(prefix.length).includes("..");
}
