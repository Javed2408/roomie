import type { FeedFilters } from "@/lib/feed-filters";
import { costs } from "@/lib/onboarding";
import { createClient } from "@/lib/supabase/server";
import {
  PUBLIC_PROFILE_COLUMNS,
  type ListingRow,
  type PublicProfile,
} from "@/types/database";
import type { Candidate } from "@/types/feed";

/** How many people one feed load returns. */
const FEED_SIZE = 30;

/**
 * The people this user should see next:
 * - flat hunters see students offering a live flat; flat owners see hunters;
 * - never themselves, and never anyone they already liked or passed;
 * - the filters narrow it down;
 * - the best fits come first (their preferred society, within budget), but
 *   everyone else who passes the filters still follows.
 */
export async function loadFeed(
  me: PublicProfile,
  myListing: ListingRow | null,
  filters: FeedFilters,
): Promise<Candidate[]> {
  const supabase = await createClient();
  const wantsOwners = me.mode === "need_flat";

  const { data: swiped } = await supabase
    .from("swipes")
    .select("receiver_id")
    .eq("sender_id", me.id);
  const excluded = [me.id, ...(swiped ?? []).map((row) => row.receiver_id)];

  let query = supabase
    .from("profiles")
    .select(PUBLIC_PROFILE_COLUMNS)
    .eq("mode", wantsOwners ? "have_flat" : "need_flat")
    .not("full_name", "is", null)
    // Only SRM students appear: accounts from before sign-ups became
    // SRM-only can't use Roomie, so they aren't shown either (011).
    .eq("is_srm_verified", true)
    .not("id", "in", `(${excluded.join(",")})`)
    .order("updated_at", { ascending: false })
    .limit(200);
  if (filters.gender) {
    query = query.eq("gender", filters.gender);
  }
  if (filters.srmOnly) {
    query = query.eq("is_srm_verified", true);
  }
  if (!wantsOwners && filters.society) {
    query = query.contains("preferred_societies", [filters.society]);
  }
  if (!wantsOwners && filters.maxBudget) {
    query = query.lte("max_budget", filters.maxBudget);
  }
  const { data: profiles } = await query;
  if (!profiles || profiles.length === 0) {
    return [];
  }

  let candidates: Candidate[];
  if (wantsOwners) {
    // Owners only appear while their flat is live.
    const { data: listings } = await supabase
      .from("listings")
      .select("*")
      .eq("is_active", true)
      .in(
        "owner_id",
        profiles.map((profile) => profile.id),
      );
    const byOwner = new Map((listings ?? []).map((row) => [row.owner_id, row]));
    candidates = [];
    for (const profile of profiles) {
      const listing = byOwner.get(profile.id);
      if (
        listing &&
        (!filters.society || listing.society === filters.society) &&
        (!filters.maxBudget || costs(listing).monthly <= filters.maxBudget)
      ) {
        candidates.push({ profile, listing });
      }
    }
  } else {
    candidates = profiles.map((profile) => ({ profile, listing: null }));
  }

  const score = (candidate: Candidate): number => {
    if (wantsOwners && candidate.listing) {
      const monthly = costs(candidate.listing).monthly;
      return (
        (me.preferred_societies.includes(candidate.listing.society) ? 2 : 0) +
        (me.max_budget && monthly <= me.max_budget ? 1 : 0)
      );
    }
    if (myListing) {
      const monthly = costs(myListing).monthly;
      return (
        (candidate.profile.preferred_societies.includes(myListing.society)
          ? 2
          : 0) +
        (candidate.profile.max_budget && candidate.profile.max_budget >= monthly
          ? 1
          : 0)
      );
    }
    return 0;
  };

  // Stable sort: equal scores keep the most-recently-updated order.
  return candidates
    .map((candidate) => ({ candidate, score: score(candidate) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, FEED_SIZE)
    .map(({ candidate }) => candidate);
}
