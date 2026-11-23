/**
 * Fixed lists used across the app. Each list that the database also checks
 * (societies, BHK types, amenities, move-in timeframes) must match the
 * CHECK constraints in `supabase/migrations/` exactly.
 */

/**
 * Hinge-style prompts, grouped for the prompt picker. Not everything is
 * about housing: the best profiles show the person first.
 * Never remove a prompt: students may already have answered it.
 */
export const PROMPT_BANK = [
  {
    category: "About me",
    prompts: [
      "Three things that describe me...",
      "Something I can talk about for hours...",
      "A random fact about me...",
      "My social battery usually...",
      "I am most productive when...",
      "The kind of people I get along with...",
    ],
  },
  {
    category: "Living together",
    prompts: [
      "My idea of a perfect living environment...",
      "One thing my future flatmate should know about me...",
      "My biggest flatmate dealbreaker is...",
      "My cleaning style, honestly...",
      "Non-negotiable shared expense rule...",
      "Guest / friends hanging out policy...",
      "Our flat's current vibe & house rules...",
      "The best flatmate I could ask for...",
    ],
  },
  {
    category: "Campus life",
    prompts: [
      "My ideal weekend looks like...",
      "Ideal weekend vibe in Potheri / KTR...",
      "My sleep & study schedule during end-sems...",
      "Before an 8 AM class, I'm...",
      "You'll catch me ordering from...",
      "Late-night food run? I'm heading to...",
      "When the power goes out, I...",
    ],
  },
] as const;

/** Every prompt in the bank. */
export const PROMPTS = PROMPT_BANK.flatMap((group) => group.prompts);
export type Prompt = (typeof PROMPTS)[number];

/** Onboarding asks for this many; the profile editor allows 0 to this many. */
export const PROMPT_COUNT = 3;
/** The longest prompt answer (the database allows up to 300). */
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
export const MAX_VACANT_SPOTS = 6;
/** Photos per listing. */
export const MAX_LISTING_PHOTOS = 8;

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
