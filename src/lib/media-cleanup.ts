import { MEDIA_BUCKET } from "@/lib/media";
import { createClient } from "@/lib/supabase/server";

/**
 * Delete files in this student's storage folder that nothing uses any more:
 * replaced or removed photos, and uploads abandoned before saving.
 *
 * "In use" means referenced by their profile (main photo), their profile
 * photo gallery, or any of their listings (live or hidden). It's read back
 * from the database after saving. If anything can't be read, nothing is
 * deleted; clean-up never blocks a save.
 */
export async function removeUnusedMedia(userId: string): Promise<void> {
  const supabase = await createClient();
  const [profile, photos, listings, files] = await Promise.all([
    supabase.from("profiles").select("avatar_url").eq("id", userId).maybeSingle(),
    supabase.from("profile_photos").select("url").eq("profile_id", userId),
    supabase.from("listings").select("photos").eq("owner_id", userId),
    supabase.storage.from(MEDIA_BUCKET).list(userId, { limit: 1000 }),
  ]);
  if (profile.error || photos.error || listings.error || files.error || !files.data) {
    return;
  }

  const inUse = new Set(
    [
      profile.data?.avatar_url,
      ...(photos.data ?? []).map((photo) => photo.url),
      ...(listings.data ?? []).flatMap((listing) => listing.photos),
    ]
      .filter((url): url is string => Boolean(url))
      .map((url) => url.split(`/public/${MEDIA_BUCKET}/`)[1]),
  );
  const unused = files.data
    .map((file) => `${userId}/${file.name}`)
    .filter((path) => !inUse.has(path));
  if (unused.length > 0) {
    await supabase.storage.from(MEDIA_BUCKET).remove(unused);
  }
}
