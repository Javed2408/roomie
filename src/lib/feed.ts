import { scoreCompatibility, type Compatibility } from "@/lib/compatibility";
import { rankCandidates, nextPage } from "@/lib/discovery-ranking";
import { filtersToRpc, type FeedFilters } from "@/lib/feed-filters";
import { getInterestCatalogue } from "@/lib/student";
import { createClient } from "@/lib/supabase/server";
import {
  PUBLIC_PROFILE_COLUMNS,
  type DiscoverHousing,
  type DiscoveryCandidateRow,
  type HousingStatus,
  type Seeking,
} from "@/types/database";
import type { CompatibilityView, DiscoveryCandidate } from "@/types/feed";

/** People per page of the feed. */
export const PAGE_SIZE = 10;
/** How many eligible people are scored per load (newest activity first). */
const POOL_SIZE = 300;

/** Throw on a failed read: an error screen beats a silently empty feed. */
function must<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) {
    throw new Error(`Couldn't load ${what}: ${result.error.message}`);
  }
  return result.data;
}

export type DiscoverySettings = {
  housing: HousingStatus | null;
  discoverHousing: DiscoverHousing;
  seeking: Seeking;
};

/** The viewer's own discovery settings (whom they see, and how they want to live). */
export async function loadDiscoverySettings(userId: string): Promise<DiscoverySettings> {
  const supabase = await createClient();
  const [housing, discovery] = await Promise.all([
    supabase.from("housing_status").select("status").eq("profile_id", userId).maybeSingle(),
    supabase.from("discovery_preferences").select("discover_housing, seeking").eq("profile_id", userId).maybeSingle(),
  ]);
  const prefs = must(discovery, "discovery preferences");
  return {
    housing: must(housing, "housing status")?.status ?? null,
    discoverHousing: prefs?.discover_housing ?? "both",
    seeking: prefs?.seeking ?? "either",
  };
}

/** Only what the card needs; the full breakdown of comparisons stays here. */
function toView(result: Compatibility): CompatibilityView {
  return {
    percent: result.percent,
    reasons: result.reasons,
    differences: result.differences,
    compared: result.compared,
    breakdown: result.breakdown
      .filter((item) => item.weight > 0)
      .map((item) => ({
        label: item.label,
        score: result.sufficient && item.score !== null ? Math.round(item.score * 100) : null,
      })),
  };
}

export type FeedPage = {
  candidates: DiscoveryCandidate[];
  /** More people are waiting after this page. */
  hasMore: boolean;
};

/**
 * The next page of the feed for the signed-in student.
 *
 * 1. The database returns everyone they may see (eligibility, their
 *    discovery preference, blocks, past likes and passes, hard filters).
 * 2. Each person is scored here against the viewer (compatibility.ts).
 * 3. Ranked (best first, varied), minus anyone already shown (`shown`).
 * 4. Photos, profiles and flats are loaded for this page only.
 *
 * Nothing comes from the browser except the filters and the ids already
 * shown; scores are always worked out on the server.
 */
export async function loadFeedPage(userId: string, filters: FeedFilters, shown: string[] = []): Promise<FeedPage> {
  const supabase = await createClient();
  const [pool, mine, myInterests, catalogue] = await Promise.all([
    supabase.rpc("discovery_candidates", {
      p_filters: filtersToRpc(filters),
      p_exclude: shown,
      p_limit: POOL_SIZE,
    }),
    supabase
      .from("lifestyle_preferences")
      .select(
        "sleep_schedule, cleanliness, social_life, study_habits, guests, noise_tolerance, smoking, food_habits, personality, cleaning_rota, guest_notice",
      )
      .eq("profile_id", userId)
      .maybeSingle(),
    supabase.from("profile_interests").select("interest").eq("profile_id", userId),
    getInterestCatalogue(),
  ]);
  const rows: DiscoveryCandidateRow[] = must(pool, "discovery") ?? [];
  const viewer = {
    lifestyle: must(mine, "your lifestyle"),
    interests: (must(myInterests, "your interests") ?? []).map((row) => row.interest),
  };
  const labels = Object.fromEntries(catalogue.map((interest) => [interest.slug, interest.label]));

  const scored = rows.map((row) => {
    const compatibility = scoreCompatibility(
      viewer,
      { lifestyle: row.lifestyle, interests: row.interests },
      row.facts ?? {},
      { candidateHasListing: Boolean(row.listing_id), interestLabels: labels },
    );
    return {
      id: row.candidate_id,
      row,
      compatibility,
      rankScore: compatibility.rankScore,
      lastActive: row.last_active,
      // People with a flat look alike when their flats do; people without
      // one when they're after the same thing.
      clusterKey: row.listing_id ? `flat` : `${row.housing}:${row.seeking}`,
    };
  });
  const { page, hasMore } = nextPage(rankCandidates(scored), shown, PAGE_SIZE);
  if (page.length === 0) {
    return { candidates: [], hasMore: false };
  }

  const ids = page.map((item) => item.id);
  const listingIds = page.flatMap((item) => (item.row.listing_id ? [item.row.listing_id] : []));
  const [profiles, photos, listings] = await Promise.all([
    supabase.from("profiles").select(PUBLIC_PROFILE_COLUMNS).in("id", ids),
    supabase.from("profile_photos").select("profile_id, url, position").in("profile_id", ids).order("position"),
    listingIds.length > 0
      ? supabase.from("listings").select("*").in("id", listingIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const profileById = new Map((must(profiles, "profiles") ?? []).map((profile) => [profile.id, profile]));
  const listingById = new Map((must(listings, "flats") ?? []).map((listing) => [listing.id, listing]));
  const photosById = new Map<string, string[]>();
  for (const photo of must(photos, "photos") ?? []) {
    photosById.set(photo.profile_id, [...(photosById.get(photo.profile_id) ?? []), photo.url]);
  }

  const candidates = page.flatMap(({ id, row, compatibility }): DiscoveryCandidate[] => {
    const profile = profileById.get(id);
    if (!profile) {
      return [];
    }
    return [
      {
        profile,
        listing: row.listing_id ? (listingById.get(row.listing_id) ?? null) : null,
        photos: photosById.get(id) ?? (profile.avatar_url ? [profile.avatar_url] : []),
        interests: catalogue.filter((interest) => row.interests.includes(interest.slug)),
        lifestyle: row.lifestyle,
        housing: row.housing,
        seeking: row.seeking,
        compatibility: toView(compatibility),
      },
    ];
  });
  return { candidates, hasMore };
}
