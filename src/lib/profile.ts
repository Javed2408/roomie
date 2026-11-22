import type { User } from "@supabase/supabase-js";
import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import {
  PUBLIC_PROFILE_COLUMNS,
  type ListingRow,
  type PublicProfile,
} from "@/types/database";

export type CurrentUser = {
  user: User;
  profile: PublicProfile | null;
  listing: ListingRow | null;
};

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
    supabase.from("listings").select("*").eq("owner_id", user.id).maybeSingle(),
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
