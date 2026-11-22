/**
 * The onboarding answers, and the rules they must follow.
 *
 * Used twice: in the browser for instant feedback, and again in the server
 * action, because anything sent from a browser can be tampered with. The
 * database CHECK constraints are the final safety net.
 */

import {
  AMENITIES,
  BHK_TYPES,
  MAX_LISTING_PHOTOS,
  MAX_VACANT_SPOTS,
  MOVE_IN_TIMEFRAMES,
  PROMPT_ANSWER_MAX,
  PROMPT_COUNT,
  PROMPTS,
  SOCIETIES,
  type Amenity,
  type BhkType,
  type MoveInTimeframe,
  type Society,
} from "@/lib/constants/prompts";
import { GENDERS, MODES, type Gender, type Mode } from "@/types/database";

export type ListingInput = {
  society: Society;
  bhk_type: BhkType;
  vacant_spots: number;
  rent_per_person: number;
  maintenance_per_person: number;
  deposit_per_person: number;
  setup_cost: number;
  amenities: Amenity[];
  photos: string[];
};

export type PreferencesInput = {
  preferred_societies: Society[];
  max_budget: number;
  move_in_timeframe: MoveInTimeframe;
};

export type OnboardingInput = {
  mode: Mode;
  full_name: string;
  gender: Gender;
  year_of_study: number;
  department: string;
  avatar_url: string | null;
  prompts: Array<{ question: string; answer: string }>;
  /** Required when mode is have_flat. */
  listing: ListingInput | null;
  /** Required when mode is need_flat. */
  preferences: PreferencesInput | null;
  /** First onboarding (go to the feed) rather than an edit (go back to the account). */
  isFirstTime?: boolean;
};

/** Field name -> message, for every problem found. */
export type Problems = Record<string, string>;

const has = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (list as readonly string[]).includes(value);

const isWhole = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= min &&
  value <= max;

/** Step 2: who you are. */
export function checkBasics(input: Partial<OnboardingInput>): Problems {
  const problems: Problems = {};
  const name = input.full_name?.trim() ?? "";
  if (name.length < 2 || name.length > 80) {
    problems.full_name = "Enter your name (2 to 80 characters).";
  }
  if (!has(GENDERS, input.gender)) {
    problems.gender = "Choose an option.";
  }
  if (!isWhole(input.year_of_study, 1, 5)) {
    problems.year_of_study = "Choose your year.";
  }
  const department = input.department?.trim() ?? "";
  if (department.length < 2 || department.length > 80) {
    problems.department = "Enter your department, e.g. CSE.";
  }
  return problems;
}

/** Step 3: exactly three different prompts, each answered. */
export function checkPrompts(input: Partial<OnboardingInput>): Problems {
  const problems: Problems = {};
  const prompts = input.prompts ?? [];
  if (prompts.length !== PROMPT_COUNT) {
    problems.prompts = `Answer ${PROMPT_COUNT} prompts.`;
    return problems;
  }
  const questions = new Set<string>();
  prompts.forEach((prompt, index) => {
    if (!has(PROMPTS, prompt.question)) {
      problems[`prompt_${index}`] = "Choose a prompt.";
    } else if (questions.has(prompt.question)) {
      problems[`prompt_${index}`] = "Pick a different prompt for each.";
    }
    questions.add(prompt.question);
    const answer = prompt.answer.trim();
    if (!answer) {
      problems[`answer_${index}`] = "Write an answer.";
    } else if (answer.length > PROMPT_ANSWER_MAX) {
      problems[`answer_${index}`] =
        `Keep it to ${PROMPT_ANSWER_MAX} characters.`;
    }
  });
  return problems;
}

/** Step 4 for flat owners. */
export function checkListing(listing: Partial<ListingInput> | null): Problems {
  const problems: Problems = {};
  if (!listing) {
    return { listing: "Add your flat's details." };
  }
  if (!has(SOCIETIES, listing.society)) {
    problems.society = "Choose the society.";
  }
  if (!has(BHK_TYPES, listing.bhk_type)) {
    problems.bhk_type = "Choose the flat size.";
  }
  if (!isWhole(listing.vacant_spots, 1, MAX_VACANT_SPOTS)) {
    problems.vacant_spots = `Choose 1 to ${MAX_VACANT_SPOTS}.`;
  }
  if (!isWhole(listing.rent_per_person, 1000, 200000)) {
    problems.rent_per_person = "Enter the rent: ₹1,000 to ₹2,00,000.";
  }
  for (const key of [
    "maintenance_per_person",
    "deposit_per_person",
    "setup_cost",
  ] as const) {
    if (!isWhole(listing[key], 0, 1000000)) {
      problems[key] = "Enter ₹0 or more (whole rupees).";
    }
  }
  const amenities = listing.amenities ?? [];
  if (!amenities.every((item) => has(AMENITIES, item))) {
    problems.amenities = "Choose perks from the list.";
  }
  if ((listing.photos ?? []).length > MAX_LISTING_PHOTOS) {
    problems.photos = `Add up to ${MAX_LISTING_PHOTOS} photos.`;
  }
  return problems;
}

/** Step 4 for flat hunters. */
export function checkPreferences(
  preferences: Partial<PreferencesInput> | null,
): Problems {
  const problems: Problems = {};
  if (!preferences) {
    return { preferences: "Tell us what you're looking for." };
  }
  const societies = preferences.preferred_societies ?? [];
  if (societies.length === 0) {
    problems.preferred_societies = "Choose at least one society.";
  } else if (!societies.every((item) => has(SOCIETIES, item))) {
    problems.preferred_societies = "Choose societies from the list.";
  }
  if (!isWhole(preferences.max_budget, 1000, 200000)) {
    problems.max_budget = "Enter a budget: ₹1,000 to ₹2,00,000.";
  }
  const timeframes = MOVE_IN_TIMEFRAMES.map((item) => item.value);
  if (!has(timeframes, preferences.move_in_timeframe)) {
    problems.move_in_timeframe = "Choose when you want to move in.";
  }
  return problems;
}

/** Everything, as the server checks it before saving. */
export function checkAll(input: Partial<OnboardingInput>): Problems {
  const problems: Problems = {};
  if (!has(MODES, input.mode)) {
    problems.mode = "Choose what you're looking for.";
  }
  Object.assign(problems, checkBasics(input), checkPrompts(input));
  if (input.mode === "have_flat") {
    Object.assign(problems, checkListing(input.listing ?? null));
  } else if (input.mode === "need_flat") {
    Object.assign(problems, checkPreferences(input.preferences ?? null));
  }
  return problems;
}

/** Monthly cost and the cost of moving in, per person. */
export function costs(listing: {
  rent_per_person: number;
  maintenance_per_person: number;
  deposit_per_person: number;
  setup_cost: number;
}): { monthly: number; moveIn: number } {
  const monthly = listing.rent_per_person + listing.maintenance_per_person;
  return {
    monthly,
    moveIn: monthly + listing.deposit_per_person + listing.setup_cost,
  };
}

/** 12000 -> "₹12,000" */
export function formatInr(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}
