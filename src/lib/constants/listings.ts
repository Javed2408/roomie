/**
 * Listing choices and their labels. Each list mirrors a CHECK constraint
 * in supabase/migrations/ (009, 014): change both together.
 */

export const LISTING_STATUSES = [
  { value: "draft", label: "Draft", hint: "Only you can see it." },
  { value: "active", label: "Live", hint: "Students can find it." },
  { value: "inactive", label: "Deactivated", hint: "Hidden. You can reactivate it." },
] as const;

export const LISTING_ROOM_TYPES = [
  { value: "private", label: "A room of their own" },
  { value: "shared", label: "A shared room" },
] as const;

export const FURNISHING_OPTIONS = [
  { value: "furnished", label: "Furnished" },
  { value: "semi_furnished", label: "Semi-furnished" },
  { value: "unfurnished", label: "Unfurnished" },
] as const;

export const FLATMATE_GENDER_OPTIONS = [
  { value: "any", label: "Anyone" },
  { value: "female", label: "Women" },
  { value: "male", label: "Men" },
] as const;

/** Bedrooms in each flat size, to sanity-check rooms on offer. */
export const BEDROOMS = { "1BHK": 1, "2BHK": 2, "3BHK": 3, "4BHK": 4 } as const;

/** Limits (the database allows a little more for older listings). */
export const LISTING_LIMITS = {
  spots: 6,
  flatmates: 10,
  rentMin: 1000,
  rentMax: 200000,
  otherMax: 1000000,
  locality: 80,
  locationNotes: 200,
  address: 200,
  description: 1000,
  longText: 500,
  flatmateNotes: 300,
  /** How far ahead a move-in date can be, in days. */
  maxDaysAhead: 365,
} as const;
