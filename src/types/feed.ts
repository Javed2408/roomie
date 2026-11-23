/**
 * Shapes used by the discovery feed, built from the database rows in
 * `src/types/database.ts`.
 */

import type {
  HousingStatus,
  InterestRow,
  LifestylePreferencesRow,
  LikedTargetType,
  ListingRow,
  PublicProfile,
  Seeking,
} from "@/types/database";

/** A person with their flat, if they're offering one. */
export type Candidate = {
  profile: PublicProfile;
  /** Only for people with a place, and only while their flat is live. */
  listing: ListingRow | null;
};

/** What the card shows about compatibility: only what the server worked out. */
export type CompatibilityView = {
  /** 0-100, only when there is enough data to stand behind it. */
  percent: number | null;
  reasons: string[];
  differences: string[];
  /** How many things were compared. */
  compared: number;
  breakdown: Array<{ label: string; score: number | null }>;
};

/** One person in the Discover feed, with everything the card shows. */
export type DiscoveryCandidate = Candidate & {
  /** In order; the first is the main photo. */
  photos: string[];
  interests: InterestRow[];
  lifestyle: Partial<Omit<LifestylePreferencesRow, "profile_id" | "created_at" | "updated_at">> | null;
  housing: HousingStatus;
  seeking: Seeking;
  compatibility: CompatibilityView;
};

/** The exact thing someone liked, Hinge-style. */
export type LikeTarget = {
  type: LikedTargetType;
  /** "avatar", "listing-photo-2", a prompt's question, or the listing id. */
  ref: string;
  /** What the like sheet shows, e.g. "Replying to: My biggest...". */
  title: string;
  detail?: string;
  imageUrl?: string;
  /** For a flat or a flat photo: which listing (014). */
  listingId?: string;
};

/** "2" -> "2nd year" */
export function yearLabel(year: number): string {
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[year] ?? "th";
  return `${year}${suffix} year`;
}

/** "CSE · 2nd year", or null when neither is set. */
export function headline(profile: PublicProfile): string | null {
  const parts = [
    profile.department,
    profile.year_of_study ? yearLabel(profile.year_of_study) : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function firstName(profile: Pick<PublicProfile, "full_name">): string {
  return profile.full_name?.trim().split(/\s+/)[0] ?? "Student";
}
