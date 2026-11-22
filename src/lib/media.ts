import { createClient } from "@/lib/supabase/client";

export const MEDIA_BUCKET = "roomie-media";
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
export const ACCEPTED_IMAGES = Object.keys(EXTENSIONS).join(",");

/** A reason the file can't be used, or null if it's fine. */
export function imageProblem(file: File): string | null {
  if (!EXTENSIONS[file.type]) {
    return "Use a JPG, PNG or WebP image.";
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return "That image is over 5 MB. Choose a smaller one.";
  }
  return null;
}

/**
 * Upload an image to `<user id>/<prefix>-<time>-<random>.<ext>` and return
 * its public URL. The storage rules only allow writing to your own folder,
 * and the bucket itself refuses other file types and anything over 5 MB.
 */
export async function uploadImage(
  userId: string,
  prefix: "avatar" | "listing",
  file: File,
): Promise<string> {
  const problem = imageProblem(file);
  if (problem) {
    throw new Error(problem);
  }
  const supabase = createClient();
  const random = Math.random().toString(36).slice(2, 8);
  const path = `${userId}/${prefix}-${Date.now()}-${random}.${EXTENSIONS[file.type]}`;
  const { error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .upload(path, file, { contentType: file.type, cacheControl: "31536000" });
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
