/**
 * The rules for each profile editor section. Used in the browser for quick
 * feedback and again on the server before saving, because anything sent
 * from a browser can be tampered with. The database CHECK constraints and
 * functions (migrations 008, 011, 012) are the final safety net.
 *
 * Imports use relative paths with extensions so tests can load this file
 * directly with Node.
 */

import {
  AMENITIES,
  BHK_TYPES,
  MOVE_IN_TIMEFRAMES,
  PROMPT_ANSWER_MAX,
  PROMPT_COUNT,
  PROMPTS,
  SOCIETIES,
  type Amenity,
  type BhkType,
  type MoveInTimeframe,
  type Society,
} from "./constants/prompts.ts";
import {
  DISCOVER_HOUSING_OPTIONS,
  GENDER_PREFERENCES,
  HOUSING_STATUSES,
  LIFESTYLE_QUESTIONS,
  LIFESTYLE_WISHES,
  MAX_INTERESTS,
  MAX_PROFILE_PHOTOS,
  ROOM_TYPES,
  SEEKING_OPTIONS,
  type DiscoverHousing,
  type GenderPreference,
  type HousingStatus,
  type LifestyleQuestionKey,
  type LifestyleWishKey,
  type RoomType,
  type Seeking,
} from "./constants/preferences.ts";

/** Field name -> message, for every problem found. */
export type Problems = Record<string, string>;
type Checked<T> = { value: T; problems: Problems };

export const NAME_LENGTH = { min: 2, max: 80 } as const;
export const DEPARTMENT_LENGTH = { min: 2, max: 80 } as const;
export const ABOUT_MAX = 300;
export const BUDGET_RANGE = { min: 1000, max: 200000 } as const;

const GENDERS = ["male", "female", "other"] as const;
type Gender = (typeof GENDERS)[number];

const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (list as readonly string[]).includes(value);
const valuesOf = <T extends string>(options: ReadonlyArray<{ value: T }>): T[] =>
  options.map((option) => option.value);
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

// --- About you ------------------------------------------------------------------

export type BasicsInput = {
  full_name: string;
  gender: string;
  year_of_study: number | string;
  department: string;
  about: string;
};
export type Basics = {
  full_name: string;
  gender: Gender;
  year_of_study: number;
  department: string;
  /** Null when left empty. */
  about: string | null;
};

export function validateBasics(input: BasicsInput): Checked<Basics> {
  const problems: Problems = {};
  const fullName = text(input.full_name);
  if (fullName.length < NAME_LENGTH.min || fullName.length > NAME_LENGTH.max) {
    problems.full_name = `Enter your name (${NAME_LENGTH.min} to ${NAME_LENGTH.max} characters).`;
  }
  if (!isOneOf(GENDERS, input.gender)) {
    problems.gender = "Choose an option.";
  }
  const year = Number(input.year_of_study);
  if (!Number.isInteger(year) || year < 1 || year > 5) {
    problems.year_of_study = "Choose your year.";
  }
  const department = text(input.department);
  if (department.length < DEPARTMENT_LENGTH.min || department.length > DEPARTMENT_LENGTH.max) {
    problems.department = "Enter your course or department, e.g. CSE.";
  }
  const about = text(input.about);
  if (about.length > ABOUT_MAX) {
    problems.about = `Keep it to ${ABOUT_MAX} characters.`;
  }
  return {
    value: {
      full_name: fullName,
      gender: input.gender as Gender,
      year_of_study: year,
      department,
      about: about || null,
    },
    problems,
  };
}

// --- Prompts --------------------------------------------------------------------

export type PromptInput = { question: string; answer: string };

/** 0 to 3 prompts from the bank, each different, each answered. */
export function validatePrompts(prompts: PromptInput[]): Checked<PromptInput[]> {
  const problems: Problems = {};
  if (prompts.length > PROMPT_COUNT) {
    problems.prompts = `Choose up to ${PROMPT_COUNT} prompts.`;
  }
  const seen = new Set<string>();
  const value = prompts.slice(0, PROMPT_COUNT).map((prompt, index) => {
    const answer = text(prompt.answer);
    if (!isOneOf(PROMPTS, prompt.question)) {
      problems[`prompt_${index}`] = "Choose a prompt from the list.";
    } else if (seen.has(prompt.question)) {
      problems[`prompt_${index}`] = "You've already answered this prompt.";
    }
    seen.add(prompt.question);
    if (!answer) {
      problems[`answer_${index}`] = "Write an answer, or remove this prompt.";
    } else if (answer.length > PROMPT_ANSWER_MAX) {
      problems[`answer_${index}`] = `Keep it to ${PROMPT_ANSWER_MAX} characters.`;
    }
    return { question: prompt.question, answer };
  });
  return { value, problems };
}

// --- Photos and interests -------------------------------------------------------

/** Up to six photos, each once. Ownership is checked by the database. */
export function validatePhotoList(urls: string[]): Checked<string[]> {
  const problems: Problems = {};
  const value = urls.map(text).filter(Boolean);
  if (value.length > MAX_PROFILE_PHOTOS) {
    problems.photos = `You can have up to ${MAX_PROFILE_PHOTOS} photos.`;
  } else if (new Set(value).size !== value.length) {
    problems.photos = "Each photo can only be added once.";
  }
  return { value, problems };
}

/** Up to ten interests; duplicates are dropped. */
export function validateInterests(slugs: string[], catalogue?: readonly string[]): Checked<string[]> {
  const problems: Problems = {};
  const value = [...new Set(slugs.map(text).filter(Boolean))];
  if (value.length > MAX_INTERESTS) {
    problems.interests = `Pick up to ${MAX_INTERESTS} interests.`;
  } else if (catalogue && value.some((slug) => !catalogue.includes(slug))) {
    problems.interests = "Choose interests from the list.";
  }
  return { value, problems };
}

// --- Lifestyle ------------------------------------------------------------------

/** The allowed answers to one lifestyle question. */
type AnswerTo<K extends LifestyleQuestionKey> = Extract<
  (typeof LIFESTYLE_QUESTIONS)[number],
  { key: K }
>["options"][number]["value"];

export type Lifestyle = { [K in LifestyleQuestionKey]: AnswerTo<K> | null } & {
  [K in LifestyleWishKey]: boolean | null;
};

/** Every question is optional; answers must be one of the offered options. */
export function validateLifestyle(input: Partial<Record<string, unknown>>): Checked<Lifestyle> {
  const problems: Problems = {};
  const value: Record<string, string | boolean | null> = {};
  for (const { key, options } of LIFESTYLE_QUESTIONS) {
    const answer = input[key];
    if (answer === null || answer === undefined || answer === "") {
      value[key] = null;
    } else if (isOneOf(valuesOf(options), answer)) {
      value[key] = answer;
    } else {
      problems[key] = "Choose one of the options.";
      value[key] = null;
    }
  }
  for (const { key } of LIFESTYLE_WISHES) {
    const wish = input[key];
    value[key] = typeof wish === "boolean" ? wish : null;
  }
  return { value: value as Lifestyle, problems };
}

// --- Practical preferences ------------------------------------------------------

export type PracticalInput = {
  budget_min: number | string | null;
  budget_max: number | string | null;
  preferred_societies: string[];
  move_in_timeframe: string | null;
  room_type: string | null;
  preferred_bhk_types: string[];
  required_amenities: string[];
  flatmate_gender: string | null;
};
export type Practical = {
  budget_min: number | null;
  budget_max: number | null;
  preferred_societies: Society[];
  move_in_timeframe: MoveInTimeframe | null;
  room_type: RoomType | null;
  preferred_bhk_types: BhkType[];
  required_amenities: Amenity[];
  flatmate_gender: GenderPreference | null;
};

/** Empty means "no preference"; anything else must be whole rupees in range. */
function budget(value: number | string | null, field: string, problems: Problems): number | null {
  if (value === null || value === "") {
    return null;
  }
  const amount = typeof value === "number" ? value : Number(String(value).replace(/[,\s₹]/g, ""));
  if (!Number.isInteger(amount) || amount < BUDGET_RANGE.min || amount > BUDGET_RANGE.max) {
    problems[field] = "Enter whole rupees from ₹1,000 to ₹2,00,000, or leave it empty.";
    return null;
  }
  return amount;
}

export function validatePractical(input: PracticalInput): Checked<Practical> {
  const problems: Problems = {};
  const budgetMin = budget(input.budget_min, "budget_min", problems);
  const budgetMax = budget(input.budget_max, "budget_max", problems);
  if (budgetMin !== null && budgetMax !== null && budgetMin > budgetMax) {
    problems.budget_min = "Your minimum can't be more than your maximum.";
  }

  const societies = [...new Set(input.preferred_societies)];
  if (!societies.every((item) => isOneOf(SOCIETIES, item))) {
    problems.preferred_societies = "Choose societies from the list.";
  }
  const bhk = [...new Set(input.preferred_bhk_types)];
  if (!bhk.every((item) => isOneOf(BHK_TYPES, item))) {
    problems.preferred_bhk_types = "Choose flat sizes from the list.";
  }
  const amenities = [...new Set(input.required_amenities)];
  if (!amenities.every((item) => isOneOf(AMENITIES, item))) {
    problems.required_amenities = "Choose amenities from the list.";
  }

  const pick = <T extends string>(list: readonly T[], raw: string | null, field: string): T | null => {
    if (raw === null || raw === "") {
      return null;
    }
    if (!isOneOf(list, raw)) {
      problems[field] = "Choose one of the options.";
      return null;
    }
    return raw;
  };

  return {
    value: {
      budget_min: budgetMin,
      budget_max: budgetMax,
      preferred_societies: societies as Society[],
      move_in_timeframe: pick(valuesOf(MOVE_IN_TIMEFRAMES), input.move_in_timeframe, "move_in_timeframe"),
      room_type: pick(valuesOf(ROOM_TYPES), input.room_type, "room_type"),
      preferred_bhk_types: bhk as BhkType[],
      required_amenities: amenities as Amenity[],
      flatmate_gender: pick(valuesOf(GENDER_PREFERENCES), input.flatmate_gender, "flatmate_gender"),
    },
    problems,
  };
}

// --- Housing and discovery ------------------------------------------------------

export type HousingInput = {
  status: string;
  discover_housing: string;
  seeking: string;
  hide_listings: boolean;
};
export type Housing = {
  status: HousingStatus;
  discover_housing: DiscoverHousing;
  seeking: Seeking;
  hide_listings: boolean;
};

export function validateHousing(input: HousingInput): Checked<Housing> {
  const problems: Problems = {};
  if (!isOneOf(valuesOf(HOUSING_STATUSES), input.status)) {
    problems.status = "Choose your current housing.";
  }
  if (!isOneOf(valuesOf(DISCOVER_HOUSING_OPTIONS), input.discover_housing)) {
    problems.discover_housing = "Choose who you want to discover.";
  }
  if (!isOneOf(valuesOf(SEEKING_OPTIONS), input.seeking)) {
    problems.seeking = "Choose how you'd like to live.";
  }
  return {
    value: {
      status: input.status as HousingStatus,
      discover_housing: input.discover_housing as DiscoverHousing,
      seeking: input.seeking as Seeking,
      // Hiding listings only ever happens when explicitly asked for.
      hide_listings: input.hide_listings === true,
    },
    problems,
  };
}
