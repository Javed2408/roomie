/**
 * Domain models built from the database rows in `src/types/database.ts`.
 *
 * A student is their profile plus independent parts that change on their
 * own: what they have (housing), whom they want to find (discovery), how
 * they live (lifestyle), what they need (practical), and any listings.
 * Housing never decides discovery: they are separate on purpose.
 */

import type {
  DiscoveryPreferencesRow,
  GroupMemberRow,
  GroupRow,
  HousingStatus,
  InterestRow,
  LifestylePreferencesRow,
  ListingRow,
  PracticalPreferencesRow,
  ProfilePhotoRow,
  PublicProfile,
} from "@/types/database";

export type Student = {
  profile: PublicProfile;
  /** Null until they've said whether they have a place. */
  housing: HousingStatus | null;
  /** Null until set (onboarding or the first housing status sets defaults). */
  discovery: Pick<DiscoveryPreferencesRow, "discover_housing" | "seeking"> | null;
  practical: Omit<PracticalPreferencesRow, "profile_id" | "created_at" | "updated_at"> | null;
  /** Null until they answer any lifestyle question. */
  lifestyle: Omit<LifestylePreferencesRow, "profile_id" | "created_at" | "updated_at"> | null;
  /** Ordered by position; the first is the main photo. */
  photos: Pick<ProfilePhotoRow, "id" | "url" | "position">[];
  interests: InterestRow[];
  /** Listings are optional; at most one is live. */
  listings: ListingRow[];
};

/** Someone in a group, with enough of their profile to show them. */
export type GroupMember = Pick<GroupMemberRow, "role" | "status" | "joined_at"> & {
  profile: Pick<PublicProfile, "id" | "full_name" | "avatar_url" | "is_srm_verified">;
};

export type GroupWithMembers = GroupRow & {
  members: GroupMember[];
};
