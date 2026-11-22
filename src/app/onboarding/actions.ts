"use server";

import { redirect } from "next/navigation";

import { MEDIA_BUCKET, isOwnMediaUrl } from "@/lib/media";
import { checkAll, type OnboardingInput, type Problems } from "@/lib/onboarding";
import { primaryListing } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";

export type SaveResult = { error: string; problems?: Problems };

/**
 * Save the whole onboarding in one go: the profile, then the listing (flat
 * owners) or the preferences (flat hunters). Everything is checked again
 * here; the browser's checks are only for quick feedback.
 */
export async function saveOnboarding(
  input: OnboardingInput,
): Promise<SaveResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Your session has ended. Please sign in again." };
  }

  const problems = checkAll(input);
  const photos = [
    ...(input.avatar_url ? [input.avatar_url] : []),
    ...(input.listing?.photos ?? []),
  ];
  if (!photos.every((url) => isOwnMediaUrl(url, user.id))) {
    problems.photos = "Upload photos again: one of them isn't yours.";
  }
  if (Object.keys(problems).length > 0) {
    return { error: "Some answers need another look.", problems };
  }

  const isOwner = input.mode === "have_flat";
  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      mode: input.mode,
      full_name: input.full_name.trim(),
      gender: input.gender,
      year_of_study: input.year_of_study,
      department: input.department.trim(),
      avatar_url: input.avatar_url,
      bio_prompts: input.prompts.map((prompt) => ({
        question: prompt.question,
        answer: prompt.answer.trim(),
      })),
      preferred_societies: isOwner ? [] : input.preferences!.preferred_societies,
      max_budget: isOwner ? null : input.preferences!.max_budget,
      move_in_timeframe: isOwner ? null : input.preferences!.move_in_timeframe,
    })
    .eq("id", user.id);
  if (profileError) {
    return { error: `Your profile couldn't be saved: ${profileError.message}` };
  }

  if (isOwner) {
    // Update their main listing (and make sure it's live), or create their
    // first one. Students may keep several listings, so this goes by id.
    const { data: existing, error: lookupError } = await primaryListing(supabase, user.id);
    const fields = { ...input.listing!, is_active: true };
    let listingError = lookupError;
    if (!listingError) {
      const saved = existing
        ? await supabase.from("listings").update(fields).eq("id", existing.id)
        : await supabase.from("listings").insert({ ...fields, owner_id: user.id });
      listingError = saved.error;
    }
    if (listingError) {
      return {
        error: `Your profile was saved, but the flat couldn't be: ${listingError.message}`,
      };
    }
  } else {
    // Switched to looking for a flat: hide any flat they listed before.
    await supabase
      .from("listings")
      .update({ is_active: false })
      .eq("owner_id", user.id);
  }

  await removeUnusedMedia(user.id);
  redirect(input.isFirstTime ? "/discover" : "/account");
}

/**
 * Delete files in this user's storage folder that nothing uses any more:
 * replaced or removed photos, and uploads abandoned before saving.
 *
 * "In use" is read back from the database after saving, so a hidden
 * listing keeps its photos. Clean-up never blocks a save: if it fails, the
 * files simply stay until the next save.
 */
async function removeUnusedMedia(userId: string): Promise<void> {
  const supabase = await createClient();
  const [profileResult, listingsResult, { data: files }] = await Promise.all([
    supabase.from("profiles").select("avatar_url").eq("id", userId).maybeSingle(),
    // Every listing, live or not: their photos all stay.
    supabase.from("listings").select("photos").eq("owner_id", userId),
    supabase.storage.from(MEDIA_BUCKET).list(userId, { limit: 1000 }),
  ]);
  // If we can't tell what's in use, delete nothing.
  if (!files || profileResult.error || listingsResult.error) {
    return;
  }
  const inUse = new Set(
    [
      profileResult.data?.avatar_url,
      ...(listingsResult.data ?? []).flatMap((listing) => listing.photos),
    ]
      .filter((url): url is string => Boolean(url))
      .map((url) => url.split(`/public/${MEDIA_BUCKET}/`)[1]),
  );
  const unused = files
    .map((file) => `${userId}/${file.name}`)
    .filter((path) => !inUse.has(path));
  if (unused.length > 0) {
    await supabase.storage.from(MEDIA_BUCKET).remove(unused);
  }
}

/** Show or hide your flat in the feed. */
export async function setListingActive(active: boolean): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }
  if (active) {
    // Only someone offering a flat can put it back in the feed.
    const { data: profile } = await supabase
      .from("profiles")
      .select("mode")
      .eq("id", user.id)
      .maybeSingle();
    if (profile?.mode !== "have_flat") {
      redirect("/account");
    }
  }
  // The main listing only: a student can keep several, one of them live.
  const { data: listing } = await primaryListing(supabase, user.id);
  if (listing) {
    await supabase
      .from("listings")
      .update({ is_active: active })
      .eq("id", listing.id);
  }
  redirect("/account");
}
