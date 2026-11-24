/**
 * How a student would fit into a group: insights built from what the
 * group and its members actually stored. Not an average of individual
 * percentages: it looks at where members agree (a clear majority) and
 * where they're split, then at how the student compares with that.
 *
 * Individual comparisons reuse the compatibility engine's rules
 * (compatibility.ts), so "quiet" and "lively" mean the same everywhere.
 *
 * Plain module, so it can be tested directly.
 */

import { compare, type LifestyleAnswers } from "./compatibility.ts";

/** What a member or applicant shares publicly. */
export type GroupPerson = {
  lifestyle: LifestyleAnswers | null;
  interests: readonly string[];
  /** Public mirrors of their flat-hunting preferences. */
  max_budget: number | null;
  preferred_societies: readonly string[];
  move_in_timeframe: string | null;
};

export type GroupTerms = {
  budget_min: number | null;
  budget_max: number | null;
  preferred_societies: readonly string[];
  move_in_timeframe: string | null;
};

export type Insight = { tone: "good" | "note"; text: string };

export type GroupInsights = {
  /** What most members agree on. */
  agreements: string[];
  /** Where members are split. */
  splits: string[];
  /** How the student compares (only when a student is given). */
  fit: Insight[];
  /** Members with any lifestyle answers. */
  basis: number;
};

/** A clear majority: at least this share of the members who answered. */
export const MAJORITY = 0.6;
/** At least this many answers before speaking for the group. */
export const MIN_ANSWERS = 2;

type Topic = {
  key: keyof LifestyleAnswers;
  /** For a split: "Members have different …". */
  topic: string;
  /** For agreement: "Most members …" / "… also …". */
  phrases: Record<string, string>;
};

const TOPICS: Topic[] = [
  {
    key: "noise_tolerance",
    topic: "noise preferences",
    phrases: { low: "prefer a quiet home", medium: "are fine with some noise", high: "enjoy a lively home" },
  },
  {
    key: "sleep_schedule",
    topic: "sleep schedules",
    phrases: { early_bird: "are early birds", night_owl: "are night owls", flexible: "keep flexible hours" },
  },
  {
    key: "cleanliness",
    topic: "standards of tidiness",
    phrases: { very_tidy: "like a very tidy home", tidy: "like a tidy home", relaxed: "are relaxed about tidiness" },
  },
  {
    key: "guests",
    topic: "guest habits",
    phrases: { rarely: "rarely have guests", sometimes: "have friends over now and then", often: "often host at home" },
  },
  {
    key: "smoking",
    topic: "views on smoking",
    phrases: { non_smoker: "don't smoke", outside_only: "smoke outside only", smoker: "smoke" },
  },
  {
    key: "food_habits",
    topic: "food habits",
    phrases: { vegetarian: "are vegetarian", vegan: "are vegan", eggetarian: "are eggetarian", non_vegetarian: "eat non-veg" },
  },
];

/** "prefer a quiet home" -> "prefers a quiet home", for a named student. */
const SINGULAR: Array<[RegExp, string]> = [
  [/^are early birds$/, "is an early bird"],
  [/^are night owls$/, "is a night owl"],
  [/^are /, "is "],
  [/^don't /, "doesn't "],
  [/^prefer /, "prefers "],
  [/^rarely have /, "rarely has "],
  [/^have /, "has "],
  [/^often host /, "often hosts "],
  [/^smoke/, "smokes"],
  [/^eat /, "eats "],
  [/^enjoy /, "enjoys "],
  [/^keep /, "keeps "],
  [/^like /, "likes "],
];
export function singular(phrase: string): string {
  const rule = SINGULAR.find(([pattern]) => pattern.test(phrase));
  return rule ? phrase.replace(rule[0], rule[1]) : phrase;
}

/** The value a clear majority picked, if there is one, and whether members are split. */
function consensus(values: string[]): { majority: string | null; split: boolean } {
  if (values.length < MIN_ANSWERS) {
    return { majority: null, split: false };
  }
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const [top, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  if (topCount / values.length >= MAJORITY) {
    return { majority: top, split: false };
  }
  return { majority: null, split: counts.size > 1 };
}

const answer = (person: GroupPerson, key: keyof LifestyleAnswers) => {
  const value = person.lifestyle?.[key];
  return typeof value === "string" && value ? value : null;
};

/**
 * Insights for a group, and optionally for a student joining it.
 * `who` words the fit: "You" (the student looking) or a first name (an
 * admin reviewing a request). Only what's in the data is said.
 */
export function groupInsights(
  group: GroupTerms,
  members: readonly GroupPerson[],
  student?: GroupPerson,
  options: { who?: string; interestLabels?: Record<string, string> } = {},
): GroupInsights {
  const who = options.who ?? "You";
  const doesWord = who === "You" ? "" : "s";
  const agreements: string[] = [];
  const splits: string[] = [];
  const fit: Insight[] = [];

  for (const topic of TOPICS) {
    const values = members.map((member) => answer(member, topic.key)).filter((value): value is string => value !== null);
    const { majority, split } = consensus(values);
    if (majority) {
      agreements.push(`Most members ${topic.phrases[majority]}`);
      const theirs = student ? answer(student, topic.key) : null;
      if (theirs) {
        const [comparison] = compare({ lifestyle: { [topic.key]: majority }, interests: [] }, { lifestyle: { [topic.key]: theirs }, interests: [] });
        const phrase = topic.phrases[theirs];
        const said = phrase ? (who === "You" ? phrase : singular(phrase)) : null;
        if (said && comparison && comparison.score >= 0.85) {
          fit.push({ tone: "good", text: `${who} also ${said}` });
        } else if (said && comparison && comparison.score <= 0.3) {
          fit.push({ tone: "note", text: `${who} ${said}, unlike most members` });
        }
      }
    } else if (split) {
      splits.push(`Members have different ${topic.topic}`);
    }
  }

  // Societies all members are open to.
  const withSocieties = members.filter((member) => member.preferred_societies.length > 0);
  if (withSocieties.length >= MIN_ANSWERS) {
    const common = withSocieties
      .map((member) => new Set(member.preferred_societies))
      .reduce((shared, next) => new Set([...shared].filter((item) => next.has(item))));
    if (common.size > 0) {
      agreements.push(`Members' preferred societies overlap: ${[...common].slice(0, 2).join(", ")}`);
    } else {
      splits.push("Members prefer different societies");
    }
  }

  if (student) {
    // Budget: the most the student can pay against the group's range.
    if (student.max_budget !== null && group.budget_min !== null) {
      if (student.max_budget < group.budget_min) {
        fit.push({ tone: "note", text: `${who === "You" ? "Your" : `${who}'s`} budget is below the group's range` });
      } else if (group.budget_max === null || student.max_budget <= group.budget_max * 1.5) {
        fit.push({ tone: "good", text: `${who === "You" ? "Your" : `${who}'s`} budget fits the group's range` });
      }
    }
    // Societies.
    if (student.preferred_societies.length > 0 && group.preferred_societies.length > 0) {
      const overlap = student.preferred_societies.filter((item) => group.preferred_societies.includes(item));
      fit.push(
        overlap.length > 0
          ? { tone: "good", text: `${who} also want${doesWord} ${overlap.slice(0, 2).join(", ")}` }
          : { tone: "note", text: `${who} prefer${doesWord} different societies from the group` },
      );
    }
    // Move-in timing.
    if (student.move_in_timeframe && group.move_in_timeframe) {
      const flexible = [student.move_in_timeframe, group.move_in_timeframe].includes("flexible");
      fit.push(
        flexible || student.move_in_timeframe === group.move_in_timeframe
          ? { tone: "good", text: `${who === "You" ? "Your" : `${who}'s`} move-in timing works for the group` }
          : { tone: "note", text: `${who === "You" ? "Your" : `${who}'s`} move-in timing differs from the group's` },
      );
    }
    // Shared interests with anyone in the group.
    const memberInterests = new Set(members.flatMap((member) => member.interests));
    const shared = [...new Set(student.interests)].filter((slug) => memberInterests.has(slug)).sort();
    if (shared.length > 0) {
      const labels = shared.map((slug) => options.interestLabels?.[slug] ?? slug);
      fit.push({
        tone: "good",
        text: `Shared interests with members: ${labels.slice(0, 3).join(", ")}${labels.length > 3 ? ` +${labels.length - 3}` : ""}`,
      });
    }
  }

  return {
    agreements,
    splits,
    fit,
    basis: members.filter((member) => member.lifestyle && Object.values(member.lifestyle).some((value) => value !== null && value !== undefined)).length,
  };
}
