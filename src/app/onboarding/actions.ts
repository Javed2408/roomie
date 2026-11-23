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
    // Update their main listing, or create their first one, then publish
    // it (014: going live only happens through set_listing_status). Their
    // main listing is the live one if any, so this never replaces another.
    const { data: existing, error: lookupError } = await primaryListing(supabase, user.id);
    const fields = input.listing!;
    let problem: string | null = lookupError?.message ?? null;
    let listingId = existing?.id ?? null;
    if (!problem) {
      if (existing) {
        problem = (await supabase.from("listings").update(fields).eq("id", existing.id)).error?.message ?? null;
      } else {
        const created = await supabase
          .from("listings")
          .insert({ ...fields, owner_id: user.id })
          .select("id")
          .single();
        problem = created.error?.message ?? null;
        listingId = created.data?.id ?? null;
      }
    }
    if (!problem && listingId) {
      const published = await supabase.rpc("set_listing_status", { p_listing: listingId, p_status: "active" });
      problem =
        published.error?.message ??
        (published.data === "conflict" ? "another listing is live. Choose one in Your listings." : null);
    }
    if (problem) {
      return { error: `Your profile was saved, but the flat couldn't be: ${problem}` };
    }
  }
  // Switching to "need a flat" never hides a listing by itself: students
  // hide it explicitly (Your listings, or the housing settings in the
  // profile editor, which asks first).

  await removeUnusedMedia(user.id);
  redirect(input.isFirstTime ? "/discover" : "/account");
}
