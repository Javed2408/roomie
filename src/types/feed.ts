/**
 * Shapes used by the discovery feed, built from the database rows in
 * `src/types/database.ts`.
 */

import type {
  LikedTargetType,
  ListingRow,
  PublicProfile,
} from "@/types/database";

/** One person in the feed, with their flat if they're offering one. */
export type Candidate = {
  profile: PublicProfile;
  /** Only for 'have_flat' people, and only while their flat is live. */
  listing: ListingRow | null;
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
