/**
 * Compatibility between two students: deterministic, rule-based and
 * explainable. No AI, no guessing from free text.
 *
 * Five dimensions, each built from simple comparisons that score 0 to 1:
 *   lifestyle    sleep, cleanliness, noise, smoking, food
 *   personality  interests, personality, social life
 *   habits       guests, heads-up before guests, cleaning rota, studying
 *   housing      societies, move-in timing, room type
 *   practical    budget, flat size, amenities, flatmate gender
 * Housing and practical comparisons use "facts" worked out by the database
 * (match / close / mismatch), because the underlying preferences are
 * private to each student.
 *
 * Missing data counts as neither good nor bad: a comparison only happens
 * when both sides answered, a dimension with no comparisons is left out,
 * and the remaining weights are rescaled. `coverage` says how much of the
 * full picture the score stands on, and a percentage is only shown when
 * there is enough to go on.
 *
 * Plain module (no server or browser APIs), so it can be tested directly.
 */

export const DIMENSIONS = ["lifestyle", "personality", "habits", "housing", "practical"] as const;
export type Dimension = (typeof DIMENSIONS)[number];
export type Weights = Record<Dimension, number>;

/** Initial weights (relative; they needn't add up to 100). Tune freely. */
export const DEFAULT_WEIGHTS: Weights = {
  lifestyle: 30,
  personality: 25,
  habits: 20,
  housing: 15,
  practical: 10,
};

export const DIMENSION_LABELS: Record<Dimension, string> = {
  lifestyle: "Lifestyle",
  personality: "Personality & interests",
  habits: "Living habits",
  housing: "Housing plans",
  practical: "Practical needs",
};

/** A percentage is only shown above both of these. */
export const MIN_COVERAGE = 0.5;
export const MIN_COMPARISONS = 4;

/** Lifestyle answers as stored (all optional). */
export type LifestyleAnswers = Partial<{
  sleep_schedule: string | null;
  cleanliness: string | null;
  social_life: string | null;
  study_habits: string | null;
  guests: string | null;
  noise_tolerance: string | null;
  smoking: string | null;
  food_habits: string | null;
  personality: string | null;
  cleaning_rota: boolean | null;
  guest_notice: boolean | null;
}>;

export type Fact = "match" | "close" | "mismatch";

/** How the candidate compares with the viewer's private preferences. */
export type Facts = Partial<{
  budget: Fact;
  societies: Fact;
  move_in: Fact;
  room_type: Fact;
  bhk: Fact;
  /** Share (0-1) of the viewer's must-have amenities their flat has. */
  amenities: number;
  gender: Fact;
}>;

export type Person = {
  lifestyle: LifestyleAnswers | null;
  /** Interest slugs. */
  interests: readonly string[];
};

export type Comparison = {
  key: string;
  dimension: Dimension;
  /** 0 (clash) to 1 (great fit). */
  score: number;
  /** Relative weight inside its dimension. */
  weight: number;
  /** Shown when the score is high: why they fit. */
  reason?: string;
  /** Shown for a real clash in what they both told us. */
  difference?: string;
};

export type DimensionResult = {
  dimension: Dimension;
  label: string;
  weight: number;
  /** 0-1, or null when nothing in it could be compared. */
  score: number | null;
  comparisons: number;
};

export type Compatibility = {
  /** 0-100, only when `sufficient`; otherwise null. */
  percent: number | null;
  /** 0-1 over the dimensions that had data, or null with no data at all. */
  score: number | null;
  /** Used to order the feed: the score, pulled towards neutral by missing data. */
  rankScore: number;
  /** 0-1: the share of the total weight that had data. */
  coverage: number;
  /** How many things were compared. */
  compared: number;
  sufficient: boolean;
  breakdown: DimensionResult[];
  /** Up to three, from the strongest comparisons. */
  reasons: string[];
  /** At most one honest note about a real difference. */
  differences: string[];
};

// --- Rules --------------------------------------------------------------------

/** Score for an unordered pair of answers from a table; same answer = 1. */
function pairScore(table: Record<string, number>, a: string, b: string): number {
  if (a === b) {
    return 1;
  }
  return table[`${a}|${b}`] ?? table[`${b}|${a}`] ?? 0.5;
}

/** Ordered scales: closeness by steps apart. */
function scaleScore(scale: readonly string[], steps: readonly number[], a: string, b: string): number | null {
  const i = scale.indexOf(a);
  const j = scale.indexOf(b);
  if (i < 0 || j < 0) {
    return null;
  }
  return steps[Math.abs(i - j)] ?? 0;
}

const SLEEP: Record<string, number> = {
  "early_bird|night_owl": 0.2,
  "early_bird|flexible": 0.75,
  "night_owl|flexible": 0.75,
};
const SMOKING: Record<string, number> = {
  "non_smoker|outside_only": 0.6,
  "non_smoker|smoker": 0,
  "outside_only|smoker": 0.7,
};
// A shared kitchen matters, but different diets aren't a dealbreaker.
const FOOD: Record<string, number> = {
  "vegetarian|vegan": 0.85,
  "vegetarian|eggetarian": 0.7,
  "vegan|eggetarian": 0.55,
  "eggetarian|non_vegetarian": 0.8,
  "vegetarian|non_vegetarian": 0.4,
  "vegan|non_vegetarian": 0.3,
};
// Opposites can complement each other: an introvert and an extrovert
// aren't a clash.
const PERSONALITY: Record<string, number> = {
  "introvert|ambivert": 0.85,
  "extrovert|ambivert": 0.85,
  "introvert|extrovert": 0.6,
};
// Studying out of the house fits with anything; quiet study at home and
// group study at home don't mix well.
const STUDY: Record<string, number> = {
  "quiet_at_home|home_with_music": 0.45,
  "quiet_at_home|in_groups": 0.3,
  "home_with_music|in_groups": 0.75,
  "library|quiet_at_home": 0.9,
  "library|home_with_music": 0.9,
  "library|in_groups": 0.85,
  "varies|quiet_at_home": 0.8,
  "varies|home_with_music": 0.85,
  "varies|in_groups": 0.8,
  "varies|library": 0.9,
};

const CLEANLINESS_SCALE = ["very_tidy", "tidy", "relaxed"] as const;
const NOISE_SCALE = ["low", "medium", "high"] as const;
const SOCIAL_SCALE = ["homebody", "balanced", "outgoing"] as const;
const GUEST_SCALE = ["rarely", "sometimes", "often"] as const;

const FACT_SCORE: Record<Fact, number> = { match: 1, close: 0.6, mismatch: 0 };

/** Phrases for shared answers. */
const SAME_SLEEP: Record<string, string> = {
  early_bird: "You're both early birds",
  night_owl: "You're both night owls",
  flexible: "You both keep flexible hours",
};
const SAME_CLEAN: Record<string, string> = {
  very_tidy: "You both like a very tidy home",
  tidy: "You both like a tidy home",
  relaxed: "You're both relaxed about tidiness",
};
const SAME_NOISE: Record<string, string> = {
  low: "You both prefer a quiet home",
  medium: "You're both fine with some noise",
  high: "You both enjoy a lively home",
};
const SAME_FOOD: Record<string, string> = {
  vegetarian: "You're both vegetarian",
  vegan: "You're both vegan",
  eggetarian: "You're both eggetarian",
  non_vegetarian: "You both eat non-veg",
};
const SAME_PERSONALITY: Record<string, string> = {
  introvert: "You're both introverts",
  ambivert: "You're both ambiverts",
  extrovert: "You're both extroverts",
};

function listPhrase(items: readonly string[]): string {
  if (items.length <= 1) {
    return items[0] ?? "";
  }
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}
function flag(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

// --- Comparisons ----------------------------------------------------------------

/** Every comparison both students have data for. */
export function compare(
  viewer: Person,
  candidate: Person,
  facts: Facts = {},
  options: { candidateHasListing?: boolean; interestLabels?: Record<string, string> } = {},
): Comparison[] {
  const out: Comparison[] = [];
  const a = viewer.lifestyle ?? {};
  const b = candidate.lifestyle ?? {};
  const both = (key: keyof LifestyleAnswers): [string, string] | null => {
    const x = text(a[key]);
    const y = text(b[key]);
    return x && y ? [x, y] : null;
  };

  // Lifestyle
  const sleep = both("sleep_schedule");
  if (sleep) {
    const score = pairScore(SLEEP, ...sleep);
    out.push({
      key: "sleep_schedule",
      dimension: "lifestyle",
      score,
      weight: 1,
      reason: score === 1 ? SAME_SLEEP[sleep[0]] : undefined,
      difference: score <= 0.2 ? "One of you is an early bird, the other a night owl" : undefined,
    });
  }
  const clean = both("cleanliness");
  if (clean) {
    const score = scaleScore(CLEANLINESS_SCALE, [1, 0.6, 0.15], ...clean);
    if (score !== null) {
      out.push({
        key: "cleanliness",
        dimension: "lifestyle",
        score,
        weight: 1,
        reason: score === 1 ? SAME_CLEAN[clean[0]] : undefined,
        difference: score <= 0.15 ? "You have quite different ideas of tidy" : undefined,
      });
    }
  }
  const noise = both("noise_tolerance");
  if (noise) {
    const score = scaleScore(NOISE_SCALE, [1, 0.65, 0.2], ...noise);
    if (score !== null) {
      out.push({
        key: "noise_tolerance",
        dimension: "lifestyle",
        score,
        weight: 1,
        reason: score === 1 ? SAME_NOISE[noise[0]] : undefined,
        difference: score <= 0.2 ? "One of you likes it quiet, the other lively" : undefined,
      });
    }
  }
  const smoking = both("smoking");
  if (smoking) {
    const score = pairScore(SMOKING, ...smoking);
    out.push({
      key: "smoking",
      dimension: "lifestyle",
      score,
      weight: 1,
      reason: score === 1 ? (smoking[0] === "non_smoker" ? "Neither of you smokes" : "You agree on smoking") : undefined,
      difference: score === 0 ? "One of you smokes and the other doesn't" : undefined,
    });
  }
  const food = both("food_habits");
  if (food) {
    const score = pairScore(FOOD, ...food);
    out.push({
      key: "food_habits",
      dimension: "lifestyle",
      score,
      weight: 1,
      reason: score === 1 ? SAME_FOOD[food[0]] : undefined,
    });
  }

  // Personality and interests
  if (viewer.interests.length > 0 && candidate.interests.length > 0) {
    const mine = new Set(viewer.interests);
    const shared = [...new Set(candidate.interests)].filter((slug) => mine.has(slug)).sort();
    // Overlap relative to both students' interests (Dice coefficient).
    const score = (2 * shared.length) / (mine.size + new Set(candidate.interests).size);
    const labels = shared.map((slug) => options.interestLabels?.[slug] ?? slug);
    out.push({
      key: "interests",
      dimension: "personality",
      score,
      // The richest signal here, so it counts double.
      weight: 2,
      reason:
        shared.length >= 3
          ? `You share ${shared.length} interests, including ${listPhrase(labels.slice(0, 2))}`
          : shared.length > 0
            ? `You're both into ${listPhrase(labels)}`
            : undefined,
    });
  }
  const personality = both("personality");
  if (personality) {
    const score = pairScore(PERSONALITY, ...personality);
    out.push({
      key: "personality",
      dimension: "personality",
      score,
      weight: 1,
      reason: score === 1 ? SAME_PERSONALITY[personality[0]] : undefined,
    });
  }
  const social = both("social_life");
  if (social) {
    const score = scaleScore(SOCIAL_SCALE, [1, 0.75, 0.4], ...social);
    if (score !== null) {
      out.push({
        key: "social_life",
        dimension: "personality",
        score,
        weight: 1,
        reason: score === 1 ? "Your social lives look alike" : undefined,
      });
    }
  }

  // Living habits
  const guests = both("guests");
  if (guests) {
    const score = scaleScore(GUEST_SCALE, [1, 0.7, 0.3], ...guests);
    if (score !== null) {
      out.push({
        key: "guests",
        dimension: "habits",
        score,
        weight: 1,
        reason: score === 1 ? "You see guests the same way" : undefined,
        difference: score <= 0.3 ? "You feel differently about having guests over" : undefined,
      });
    }
  }
  const notice = [flag(a.guest_notice), flag(b.guest_notice)] as const;
  if (notice[0] !== null && notice[1] !== null) {
    const score = notice[0] === notice[1] ? 1 : 0.45;
    out.push({
      key: "guest_notice",
      dimension: "habits",
      score,
      weight: 1,
      reason: notice[0] && notice[1] ? "You both want a heads-up before guests visit" : undefined,
    });
  }
  const rota = [flag(a.cleaning_rota), flag(b.cleaning_rota)] as const;
  if (rota[0] !== null && rota[1] !== null) {
    const score = rota[0] && rota[1] ? 1 : rota[0] === rota[1] ? 0.9 : 0.5;
    out.push({
      key: "cleaning_rota",
      dimension: "habits",
      score,
      weight: 1,
      reason: rota[0] && rota[1] ? "You'd both like a cleaning rota" : undefined,
    });
  }
  const study = both("study_habits");
  if (study) {
    const score = pairScore(STUDY, ...study);
    out.push({
      key: "study_habits",
      dimension: "habits",
      score,
      weight: 1,
      reason: score >= 0.85 ? "Your study habits are compatible" : undefined,
    });
  }

  // Housing and practical (facts from the database)
  const flat = options.candidateHasListing === true;
  const fact = (
    key: keyof Facts,
    dimension: Dimension,
    reasons: { flat: string; person: string },
  ) => {
    const value = facts[key];
    if (value === "match" || value === "close" || value === "mismatch") {
      out.push({
        key,
        dimension,
        score: FACT_SCORE[value],
        weight: 1,
        reason: value === "match" ? (flat ? reasons.flat : reasons.person) : undefined,
      });
    }
  };
  fact("societies", "housing", {
    flat: "Their flat is in a society you prefer",
    person: "Your preferred societies overlap",
  });
  fact("move_in", "housing", {
    flat: "Their flat is free when you want to move",
    person: "You're planning to move around the same time",
  });
  fact("room_type", "housing", {
    flat: "You want the same kind of room",
    person: "You want the same kind of room",
  });
  fact("budget", "practical", {
    flat: "Their flat fits your budget",
    person: "Your budgets overlap",
  });
  fact("bhk", "practical", {
    flat: "Their flat is a size you're after",
    person: "You're after the same flat size",
  });
  fact("gender", "practical", { flat: "", person: "" });
  if (typeof facts.amenities === "number" && facts.amenities >= 0 && facts.amenities <= 1) {
    out.push({
      key: "amenities",
      dimension: "practical",
      score: facts.amenities,
      weight: 1,
      reason: facts.amenities === 1 ? "Their flat has everything you need" : undefined,
    });
  }
  // Empty reasons (the gender fact) are never shown.
  return out.map((item) => (item.reason === "" ? { ...item, reason: undefined } : item));
}

// --- Score ------------------------------------------------------------------------

/** Turn comparisons into a weighted, normalised score with a breakdown. */
export function summarise(comparisons: readonly Comparison[], weights: Weights = DEFAULT_WEIGHTS): Compatibility {
  const total = DIMENSIONS.reduce((sum, dimension) => sum + Math.max(0, weights[dimension]), 0);
  const breakdown: DimensionResult[] = DIMENSIONS.map((dimension) => {
    const items = comparisons.filter((item) => item.dimension === dimension);
    const itemWeight = items.reduce((sum, item) => sum + item.weight, 0);
    return {
      dimension,
      label: DIMENSION_LABELS[dimension],
      weight: Math.max(0, weights[dimension]),
      score:
        itemWeight > 0 ? items.reduce((sum, item) => sum + item.score * item.weight, 0) / itemWeight : null,
      comparisons: items.length,
    };
  });

  const available = breakdown.filter((result) => result.score !== null && result.weight > 0);
  const availableWeight = available.reduce((sum, result) => sum + result.weight, 0);
  const score =
    availableWeight > 0
      ? available.reduce((sum, result) => sum + (result.score ?? 0) * result.weight, 0) / availableWeight
      : null;
  const coverage = total > 0 ? availableWeight / total : 0;
  const compared = comparisons.length;
  const sufficient = score !== null && coverage >= MIN_COVERAGE && compared >= MIN_COMPARISONS;

  // Strongest reasons first: by dimension weight, then by score.
  const order = (item: Comparison) => weights[item.dimension] * item.weight;
  const reasons = [...comparisons.filter((item) => item.reason && item.score >= 0.85)]
    .sort((x, y) => order(y) - order(x) || y.score - x.score)
    .map((item) => item.reason as string)
    .slice(0, 3);
  const differences = [...comparisons.filter((item) => item.difference)]
    .sort((x, y) => x.score - y.score || order(y) - order(x))
    .map((item) => item.difference as string)
    .slice(0, 1);

  return {
    percent: sufficient && score !== null ? Math.round(score * 100) : null,
    score,
    // With little data, stay close to neutral (0.5) instead of trusting a
    // score built on one or two answers.
    rankScore: score === null ? 0.5 : coverage * score + (1 - coverage) * 0.5,
    coverage,
    compared,
    sufficient,
    breakdown,
    reasons,
    differences,
  };
}

/** Compare two students and score the result. */
export function scoreCompatibility(
  viewer: Person,
  candidate: Person,
  facts: Facts = {},
  options: {
    candidateHasListing?: boolean;
    interestLabels?: Record<string, string>;
    weights?: Weights;
  } = {},
): Compatibility {
  return summarise(compare(viewer, candidate, facts, options), options.weights);
}
