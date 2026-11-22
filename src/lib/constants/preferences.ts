/**
 * Allowed values for housing status, discovery, compatibility and groups,
 * with the words the app shows for each. Every list mirrors a CHECK
 * constraint in `supabase/migrations/` (007, 008, 009, 010) exactly: change
 * both together.
 */

// --- Housing status and discovery (007) ------------------------------------

export const HOUSING_STATUSES = [
  { value: "has_accommodation", label: "I have a place" },
  { value: "needs_accommodation", label: "I need a place" },
] as const;
export type HousingStatus = (typeof HOUSING_STATUSES)[number]["value"];

/** Whom a student wants to discover. */
export const DISCOVER_HOUSING_OPTIONS = [
  { value: "has_accommodation", label: "Students with a place" },
  { value: "needs_accommodation", label: "Students looking for a place" },
  { value: "both", label: "Both" },
] as const;
export type DiscoverHousing = (typeof DISCOVER_HOUSING_OPTIONS)[number]["value"];

/** One flatmate, a group, or either. */
export const SEEKING_OPTIONS = [
  { value: "flatmate", label: "A flatmate" },
  { value: "group", label: "A group to move in with" },
  { value: "either", label: "Open to either" },
] as const;
export type Seeking = (typeof SEEKING_OPTIONS)[number]["value"];

// --- Lifestyle and personality (008) ---------------------------------------

export const SLEEP_SCHEDULES = [
  { value: "early_bird", label: "Early bird" },
  { value: "night_owl", label: "Night owl" },
  { value: "flexible", label: "Flexible" },
] as const;
export type SleepSchedule = (typeof SLEEP_SCHEDULES)[number]["value"];

export const CLEANLINESS_LEVELS = [
  { value: "very_tidy", label: "Very tidy" },
  { value: "tidy", label: "Tidy" },
  { value: "relaxed", label: "Relaxed" },
] as const;
export type Cleanliness = (typeof CLEANLINESS_LEVELS)[number]["value"];

export const SOCIAL_LIVES = [
  { value: "homebody", label: "Homebody" },
  { value: "balanced", label: "Balanced" },
  { value: "outgoing", label: "Outgoing" },
] as const;
export type SocialLife = (typeof SOCIAL_LIVES)[number]["value"];

export const STUDY_HABITS = [
  { value: "quiet_at_home", label: "Quiet, at home" },
  { value: "home_with_music", label: "At home, with music" },
  { value: "library", label: "In the library" },
  { value: "varies", label: "It varies" },
] as const;
export type StudyHabits = (typeof STUDY_HABITS)[number]["value"];

export const GUEST_FREQUENCIES = [
  { value: "rarely", label: "Rarely" },
  { value: "sometimes", label: "Sometimes" },
  { value: "often", label: "Often" },
] as const;
export type GuestFrequency = (typeof GUEST_FREQUENCIES)[number]["value"];

export const NOISE_TOLERANCES = [
  { value: "low", label: "I need quiet" },
  { value: "medium", label: "Some noise is fine" },
  { value: "high", label: "Noise doesn't bother me" },
] as const;
export type NoiseTolerance = (typeof NOISE_TOLERANCES)[number]["value"];

export const SMOKING_HABITS = [
  { value: "non_smoker", label: "Non-smoker" },
  { value: "outside_only", label: "Smoke outside only" },
  { value: "smoker", label: "Smoker" },
] as const;
export type SmokingHabit = (typeof SMOKING_HABITS)[number]["value"];

export const FOOD_HABITS = [
  { value: "vegetarian", label: "Vegetarian" },
  { value: "eggetarian", label: "Eggetarian" },
  { value: "non_vegetarian", label: "Non-vegetarian" },
  { value: "vegan", label: "Vegan" },
] as const;
export type FoodHabit = (typeof FOOD_HABITS)[number]["value"];

export const PERSONALITIES = [
  { value: "introvert", label: "Introvert" },
  { value: "ambivert", label: "Ambivert" },
  { value: "extrovert", label: "Extrovert" },
] as const;
export type Personality = (typeof PERSONALITIES)[number]["value"];

// --- Practical requirements (008, 009, 010) --------------------------------

export const ROOM_TYPES = [
  { value: "private", label: "My own room" },
  { value: "shared", label: "A shared room" },
  { value: "either", label: "Either" },
] as const;
export type RoomType = (typeof ROOM_TYPES)[number]["value"];

/** Flatmate gender preference, for students, listings and groups. */
export const GENDER_PREFERENCES = [
  { value: "any", label: "Anyone" },
  { value: "male", label: "Men" },
  { value: "female", label: "Women" },
] as const;
export type GenderPreference = (typeof GENDER_PREFERENCES)[number]["value"];

// --- Groups (010) -------------------------------------------------------------

export const GROUP_STATUSES = [
  { value: "forming", label: "Looking for members" },
  { value: "searching", label: "Looking for a flat" },
  { value: "housed", label: "Found a place" },
  { value: "archived", label: "Closed" },
] as const;
export type GroupStatus = (typeof GROUP_STATUSES)[number]["value"];

export const GROUP_ROLES = ["admin", "member"] as const;
export type GroupRole = (typeof GROUP_ROLES)[number];

export const GROUP_MEMBERSHIP_STATUSES = [
  "invited",
  "requested",
  "active",
  "declined",
  "left",
  "removed",
] as const;
export type GroupMembershipStatus = (typeof GROUP_MEMBERSHIP_STATUSES)[number];

/** Limits the database enforces. */
export const MAX_PROFILE_PHOTOS = 6;
export const MAX_INTERESTS = 10;
export const MAX_LISTINGS_PER_STUDENT = 10;
export const GROUP_SIZE = { min: 2, max: 10 } as const;
