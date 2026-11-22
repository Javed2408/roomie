import type { User } from "@supabase/supabase-js";
import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import {
  PUBLIC_PROFILE_COLUMNS,
  type ListingRow,
  type PublicProfile,
} from "@/types/database";

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

export type CurrentUser = {
  user: User;
  profile: PublicProfile | null;
  /** Their main listing: the live one, or else the newest (see primaryListing). */
  listing: ListingRow | null;
};

/**
 * A student's main listing. Students may keep several listings (migration
 * 009) with at most one live, and today's screens show one: the live
 * listing if there is one, otherwise the most recently created.
 */
export function primaryListing(supabase: SupabaseServer, ownerId: string) {
  return supabase
    .from("listings")
    .select("*")
    .eq("owner_id", ownerId)
    .order("is_active", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
}

/**
 * Onboarding is finished once the basics are in: a name and a mode.
 * (The wizard only saves when every step is complete.)
 */
export function isOnboarded(profile: PublicProfile | null): boolean {
  return Boolean(profile?.full_name && profile.mode);
}

/**
 * The signed-in person with their profile and listing, or null.
 *
 * Wrapped in React's `cache`, so the page and the tab bar's activity dot
 * share one lookup per request instead of asking Supabase twice.
 */
export const getCurrentUser = cache(async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return null;
  }
  const [profileResult, listingResult] = await Promise.all([
    supabase
      .from("profiles")
      .select(PUBLIC_PROFILE_COLUMNS)
      .eq("id", user.id)
      .maybeSingle(),
    primaryListing(supabase, user.id),
  ]);
  // A failed lookup (database unreachable, a migration not run yet) must not
  // look like "no profile", or pages would send the person back through
  // onboarding. Show the error screen instead.
  const failure = profileResult.error ?? listingResult.error;
  if (failure) {
    throw new Error(`Couldn't load your profile: ${failure.message}`);
  }
  return { user, profile: profileResult.data, listing: listingResult.data };
});
