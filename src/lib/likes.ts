import { costs, formatInr } from "@/lib/onboarding";
import type { ListingRow, PublicProfile, SwipeRow } from "@/types/database";
import type { LikedThing } from "@/types/matches";

/**
 * Turn a like's target back into words, using the profile and flat of the
 * person who was liked.
 *
 * `possessive` is "your" when they liked you, or e.g. "Asha's".
 * (Targets come from `FeedCard`: "avatar", "listing-photo-2", a prompt's
 * question or the listing id.)
 */
export function describeLikedThing(
  like: Pick<SwipeRow, "liked_target_type" | "liked_target_ref">,
  owner: {
    profile: Pick<PublicProfile, "avatar_url" | "bio_prompts">;
    listing: ListingRow | null;
  },
  possessive: string,
): LikedThing {
  const ref = like.liked_target_ref ?? "";

  switch (like.liked_target_type) {
    case "photo": {
      const flatPhoto = /^listing-photo-(\d+)$/.exec(ref);
      if (flatPhoto) {
        return {
          phrase: `a photo of ${possessive} flat`,
          imageUrl: owner.listing?.photos[Number(flatPhoto[1]) - 1],
        };
      }
      return {
        phrase: `${possessive} photo`,
        imageUrl: owner.profile.avatar_url ?? undefined,
      };
    }
    case "prompt":
      return {
        phrase: `${possessive} answer to “${ref}”`,
        // The answer may have been edited (or the prompt swapped) since.
        detail: owner.profile.bio_prompts.find((prompt) => prompt.question === ref)
          ?.answer,
      };
    case "listing": {
      const listing = owner.listing;
      return {
        phrase: `${possessive} flat`,
        detail: listing
          ? `${listing.society} · ${listing.bhk_type} · ${formatInr(costs(listing).monthly)}/mo`
          : undefined,
      };
    }
    default:
      return { phrase: `${possessive} profile` };
  }
}

/** "Abode Valley • 3BHK", "Has a flat" or "Looking for a flat". */
export function lookingFor(candidate: {
  profile: Pick<PublicProfile, "mode">;
  listing: ListingRow | null;
}): string {
  if (candidate.listing) {
    return `${candidate.listing.society} • ${candidate.listing.bhk_type}`;
  }
  return candidate.profile.mode === "have_flat" ? "Has a flat" : "Looking for a flat";
}
