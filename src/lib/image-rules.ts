/**
 * Which images Roomie accepts, and how big they get before upload. The
 * roomie-media bucket enforces the same types and 5 MB limit (001).
 * (No imports, so tests can load this file directly.)
 */

export const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
export const ACCEPTED_IMAGES = Object.keys(IMAGE_EXTENSIONS).join(",");
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Photos are scaled down so their longest side is at most this. */
export const MAX_IMAGE_SIDE = 1600;

/** A reason the file can't be used, or null if it's fine. */
export function imageProblem(file: { type: string; size: number }): string | null {
  if (!IMAGE_EXTENSIONS[file.type]) {
    return "Use a JPG, PNG or WebP image.";
  }
  if (file.size === 0) {
    return "That file is empty. Choose another photo.";
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return "That image is over 5 MB. Choose a smaller one.";
  }
  return null;
}

/** The size to scale an image to, keeping its shape (never enlarges). */
export function fitWithin(
  width: number,
  height: number,
  max: number = MAX_IMAGE_SIDE,
): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}
