"use server";

import { redirect } from "next/navigation";

import { isOwnMediaUrl } from "@/lib/media";
import { removeUnusedMedia } from "@/lib/media-cleanup";
import { checkAll, type OnboardingInput, type Problems } from "@/lib/onboarding";
import { getActionUser, primaryListing } from "@/lib/profile";
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
  const session = await getActionUser();
  if (!session.ok) {
    return { error: session.error };
  }
  const { user } = session;
  const supabase = await createClient();

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
  }
  // Switching to "need a flat" never hides a listing by itself: students
  // hide it explicitly (account page, or the housing settings in the
  // profile editor, which asks first).

  await removeUnusedMedia(user.id);
  redirect(input.isFirstTime ? "/discover" : "/account");
}

/** Show or hide your flat in the feed. */
export async function setListingActive(active: boolean): Promise<void> {
  const session = await getActionUser();
  if (!session.ok) {
    redirect("/login");
  }
  const { user } = session;
  const supabase = await createClient();
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
