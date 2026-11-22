/**
 * Fixed lists used across the app. Each list that the database also checks
 * (societies, BHK types, amenities, move-in timeframes) must match the
 * CHECK constraints in `supabase/migrations/` exactly.
 */

/** Hinge-style prompts, written for flat hunting around SRM KTR. */
export const PROMPTS = [
  "My biggest flatmate dealbreaker is...",
  "Ideal weekend vibe in Potheri / KTR...",
  "My sleep & study schedule during end-sems...",
  "Our flat's current vibe & house rules...",
  "You'll catch me ordering from...",
  "Non-negotiable shared expense rule...",
  "Guest / friends hanging out policy...",
  "My cleaning style, honestly...",
  "Before an 8 AM class, I'm...",
  "When the power goes out, I...",
  "Late-night food run? I'm heading to...",
  "The best flatmate I could ask for...",
] as const;

/** How many prompts a profile shows, and the longest answer allowed. */
export const PROMPT_COUNT = 3;
export const PROMPT_ANSWER_MAX = 150;

export const SOCIETIES = [
  "Abode Valley",
  "Estancia",
  "Akshaya",
  "Green Pearl",
  "Potheri Independent",
  "Other",
] as const;
export type Society = (typeof SOCIETIES)[number];

export const BHK_TYPES = ["1BHK", "2BHK", "3BHK", "4BHK"] as const;
export type BhkType = (typeof BHK_TYPES)[number];

/** Flat perks shown as chips on a listing. */
export const AMENITIES = [
  "AC",
  "Wi-Fi",
  "Washing Machine",
  "Cook",
  "Maid",
  "Power Backup",
  "Geyser",
  "No Owner Interference",
  "Bachelor Friendly",
  "Balcony",
] as const;
export type Amenity = (typeof AMENITIES)[number];

export const MOVE_IN_TIMEFRAMES = [
  { value: "immediate", label: "Immediately" },
  { value: "next_month", label: "Next month" },
  { value: "next_semester", label: "Next semester" },
  { value: "july", label: "July (new academic year)" },
  { value: "flexible", label: "Flexible" },
] as const;
export type MoveInTimeframe = (typeof MOVE_IN_TIMEFRAMES)[number]["value"];

/** Suggestions for the department field (anything can still be typed). */
export const DEPARTMENTS = [
  "CSE",
  "CSE (AI/ML)",
  "IT",
  "ECE",
  "EEE",
  "Mechanical",
  "Civil",
  "Biotech",
  "Aerospace",
  "Automobile",
  "Chemical",
  "Data Science",
  "BBA",
  "MBA",
  "Architecture",
  "Medicine",
] as const;

/** Vacant spots a listing can offer. */
export const MAX_VACANT_SPOTS = 4;
/** Photos per listing. */
export const MAX_LISTING_PHOTOS = 4;

/** The longest comment that can go with a like. */
export const LIKE_COMMENT_MAX = 140;

/** The longest chat message (the database allows the same). */
export const MESSAGE_MAX = 2000;

/** One-tap openers for an empty chat, depending on who has the flat. */
export const CHAT_STARTERS = {
  theyHaveFlat: [
    "Is the rent inclusive of maintenance & Wi-Fi?",
    "Can we visit the flat this week?",
    "Hey! When would the spot be free to move in?",
  ],
  iHaveFlat: [
    "Hey! When are you planning to move in?",
    "Want to come see the flat this week?",
    "What's your monthly budget looking like?",
  ],
  bothHunting: [
    "Hey! When are you planning to move in?",
    "Which societies are you looking at?",
    "Want to go flat-hunting together this week?",
  ],
} as const;
