import { cache } from "react";

import { primaryListing, type Student } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/uuid";
import {
  PUBLIC_PROFILE_COLUMNS,
  type DiscoverHousing,
  type HousingStatus,
  type InterestRow,
  type LifestylePreferencesRow,
  type ListingRow,
  type PracticalPreferencesRow,
  type PublicProfile,
  type Seeking,
} from "@/types/database";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Throw on a failed read: an error screen beats showing an empty profile. */
function must<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) {
    throw new Error(`Couldn't load ${what}: ${result.error.message}`);
  }
  return result.data;
}

/** The 20 interests students pick from, alphabetically. Cached per request. */
export const getInterestCatalogue = cache(async function getInterestCatalogue(): Promise<InterestRow[]> {
  const supabase = await createClient();
  return must(await supabase.from("interests").select("slug, label").order("label"), "interests") ?? [];
});

async function photoUrls(supabase: Supabase, profileId: string): Promise<string[]> {
  const photos = must(
    await supabase.from("profile_photos").select("url").eq("profile_id", profileId).order("position"),
    "photos",
  );
  return (photos ?? []).map((photo) => photo.url);
}

async function interestSlugs(supabase: Supabase, profileId: string): Promise<string[]> {
  const rows = must(
    await supabase.from("profile_interests").select("interest").eq("profile_id", profileId),
    "interests",
  );
  return (rows ?? []).map((row) => row.interest);
}

type Answers = Omit<LifestylePreferencesRow, "profile_id" | "created_at" | "updated_at">;
type PracticalAnswers = Omit<PracticalPreferencesRow, "profile_id" | "created_at" | "updated_at">;

/** Everything the profile editor needs, for the signed-in student only. */
export type EditorData = {
  userId: string;
  profile: PublicProfile;
  /** In order; the first is the main photo. */
  photos: string[];
  catalogue: InterestRow[];
  interests: string[];
  lifestyle: Answers | null;
  /** Private: only the owner can read these (migration 011). */
  practical: PracticalAnswers | null;
  housing: HousingStatus | null;
  discovery: { discover_housing: DiscoverHousing; seeking: Seeking } | null;
  /** Their live listing, so changing housing can offer to hide it. */
  liveListing: Pick<ListingRow, "id" | "society" | "bhk_type"> | null;
};

export async function loadEditorData(student: Student): Promise<EditorData> {
  const supabase = await createClient();
  const id = student.user.id;
  const [photos, catalogue, interests, lifestyle, practical, housing, discovery] = await Promise.all([
    photoUrls(supabase, id),
    getInterestCatalogue(),
    interestSlugs(supabase, id),
    supabase
      .from("lifestyle_preferences")
      .select(
        "sleep_schedule, cleanliness, social_life, study_habits, guests, noise_tolerance, smoking, food_habits, personality, cleaning_rota, guest_notice",
      )
      .eq("profile_id", id)
      .maybeSingle(),
    supabase
      .from("practical_preferences")
      .select(
        "budget_min, budget_max, preferred_societies, move_in_timeframe, room_type, preferred_bhk_types, required_amenities, flatmate_gender",
      )
      .eq("profile_id", id)
      .maybeSingle(),
    supabase.from("housing_status").select("status").eq("profile_id", id).maybeSingle(),
    supabase.from("discovery_preferences").select("discover_housing, seeking").eq("profile_id", id).maybeSingle(),
  ]);
  const listing = student.listing?.is_active ? student.listing : null;
  return {
    userId: id,
    profile: student.profile,
    photos,
    catalogue,
    interests,
    lifestyle: must(lifestyle, "lifestyle preferences"),
    practical: must(practical, "practical preferences"),
    housing: must(housing, "housing status")?.status ?? null,
    discovery: must(discovery, "discovery preferences"),
    liveListing: listing ? { id: listing.id, society: listing.society, bhk_type: listing.bhk_type } : null,
  };
}

/** What other students see on someone's profile. Nothing private. */
export type PublicStudent = {
  profile: PublicProfile;
  photos: string[];
  interests: InterestRow[];
  lifestyle: Answers | null;
  housing: HousingStatus | null;
  /** Only a live listing, and only for students who have a place. */
  listing: ListingRow | null;
};

export async function loadPublicStudent(profileId: string): Promise<PublicStudent | null> {
  if (!isUuid(profileId)) {
    return null;
  }
  const supabase = await createClient();
  const profile = must(
    await supabase.from("profiles").select(PUBLIC_PROFILE_COLUMNS).eq("id", profileId).maybeSingle(),
    "profile",
  );
  if (!profile?.full_name) {
    return null;
  }
  const [photos, catalogue, slugs, lifestyle, housing, listing] = await Promise.all([
    photoUrls(supabase, profileId),
    getInterestCatalogue(),
    interestSlugs(supabase, profileId),
    supabase
      .from("lifestyle_preferences")
      .select(
        "sleep_schedule, cleanliness, social_life, study_habits, guests, noise_tolerance, smoking, food_habits, personality, cleaning_rota, guest_notice",
      )
      .eq("profile_id", profileId)
      .maybeSingle(),
    supabase.from("housing_status").select("status").eq("profile_id", profileId).maybeSingle(),
    primaryListing(supabase, profileId),
  ]);
  const status = must(housing, "housing status")?.status ?? null;
  const live = must(listing, "listing");
  return {
    profile,
    photos,
    interests: catalogue.filter((interest) => slugs.includes(interest.slug)),
    lifestyle: must(lifestyle, "lifestyle preferences"),
    housing: status,
    listing: live?.is_active && status === "has_accommodation" ? live : null,
  };
}

/** Has this student blocked that one? (Blocks are visible to the blocker only.) */
export async function hasBlocked(blockerId: string, blockedId: string): Promise<boolean> {
  const supabase = await createClient();
  const row = must(
    await supabase
      .from("blocks")
      .select("blocked_id")
      .eq("blocker_id", blockerId)
      .eq("blocked_id", blockedId)
      .maybeSingle(),
    "blocks",
  );
  return Boolean(row);
}

/** How complete a profile is, for the account page's checklist. */
export type ProfileProgress = {
  photos: number;
  prompts: number;
  interests: number;
  lifestyleAnswered: number;
  hasAbout: boolean;
  housing: HousingStatus | null;
  discovery: { discover_housing: DiscoverHousing; seeking: Seeking } | null;
};

export async function loadProfileProgress(student: Student): Promise<ProfileProgress> {
  const supabase = await createClient();
  const id = student.user.id;
  const [photos, interests, lifestyle, housing, discovery] = await Promise.all([
    photoUrls(supabase, id),
    interestSlugs(supabase, id),
    supabase
      .from("lifestyle_preferences")
      .select(
        "sleep_schedule, cleanliness, social_life, study_habits, guests, noise_tolerance, smoking, food_habits, personality",
      )
      .eq("profile_id", id)
      .maybeSingle(),
    supabase.from("housing_status").select("status").eq("profile_id", id).maybeSingle(),
    supabase.from("discovery_preferences").select("discover_housing, seeking").eq("profile_id", id).maybeSingle(),
  ]);
  const answers = must(lifestyle, "lifestyle preferences");
  return {
    photos: photos.length,
    prompts: student.profile.bio_prompts.length,
    interests: interests.length,
    lifestyleAnswered: answers ? Object.values(answers).filter((value) => value !== null).length : 0,
    hasAbout: Boolean(student.profile.about),
    housing: must(housing, "housing status")?.status ?? null,
    discovery: must(discovery, "discovery preferences"),
  };
}
