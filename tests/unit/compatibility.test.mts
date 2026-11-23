/**
 * The compatibility engine (src/lib/compatibility.ts): rules, missing data,
 * weights, the breakdown and the explanations.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  compare,
  DEFAULT_WEIGHTS,
  scoreCompatibility,
  summarise,
  type LifestyleAnswers,
  type Person,
} from "../../src/lib/compatibility.ts";

const FULL: LifestyleAnswers = {
  sleep_schedule: "early_bird",
  cleanliness: "very_tidy",
  social_life: "homebody",
  study_habits: "quiet_at_home",
  guests: "rarely",
  noise_tolerance: "low",
  smoking: "non_smoker",
  food_habits: "vegetarian",
  personality: "introvert",
  cleaning_rota: true,
  guest_notice: true,
};
const person = (lifestyle: LifestyleAnswers | null, interests: string[] = []): Person => ({ lifestyle, interests });
const scoreOf = (result: ReturnType<typeof scoreCompatibility>, dimension: string) =>
  result.breakdown.find((item) => item.dimension === dimension)?.score;

describe("compatibility", () => {
  describe("lifestyle rules", () => {
    it("scores identical answers as a perfect fit, with reasons from the real answers", () => {
      const result = scoreCompatibility(person(FULL, ["chess", "music"]), person(FULL, ["chess", "music"]));
      assert.equal(result.score, 1);
      assert.equal(result.percent, 100);
      assert.equal(result.sufficient, true);
      assert.deepEqual(result.differences, []);
      assert.equal(result.reasons.length, 3);
      assert.ok(result.reasons.includes("You're both early birds"), result.reasons.join(" | "));
    });

    it("treats a night owl and an early bird as a poor sleep fit, and says so honestly", () => {
      const [sleep] = compare(person({ sleep_schedule: "early_bird" }), person({ sleep_schedule: "night_owl" }));
      assert.equal(sleep.score, 0.2);
      assert.equal(sleep.reason, undefined);
      assert.match(sleep.difference ?? "", /early bird/);
    });

    it("rates some differences as compatible rather than negative", () => {
      const personality = compare(person({ personality: "introvert" }), person({ personality: "extrovert" }))[0];
      assert.ok(personality.score >= 0.5, "opposite personalities can complement each other");
      const study = compare(person({ study_habits: "quiet_at_home" }), person({ study_habits: "library" }))[0];
      assert.ok(study.score >= 0.85, "studying out of the house fits with quiet study at home");
      assert.equal(study.reason, "Your study habits are compatible");
      const flexible = compare(person({ sleep_schedule: "flexible" }), person({ sleep_schedule: "night_owl" }))[0];
      assert.ok(flexible.score > 0.5);
    });

    it("scores conflicting answers low", () => {
      const result = scoreCompatibility(
        person({ smoking: "non_smoker", cleanliness: "very_tidy", noise_tolerance: "low", sleep_schedule: "early_bird" }),
        person({ smoking: "smoker", cleanliness: "relaxed", noise_tolerance: "high", sleep_schedule: "night_owl" }),
      );
      assert.ok((result.score ?? 1) < 0.2, String(result.score));
      assert.equal(result.reasons.length, 0);
      assert.equal(result.differences.length, 1, "at most one difference is shown");
    });

    it("favours two students who both want a heads-up before guests", () => {
      const both = compare(person({ guest_notice: true }), person({ guest_notice: true }))[0];
      const mixed = compare(person({ guest_notice: true }), person({ guest_notice: false }))[0];
      assert.ok(both.score > mixed.score);
      assert.equal(both.reason, "You both want a heads-up before guests visit");
    });
  });

  describe("interests", () => {
    it("measures overlap relative to both students' interests", () => {
      const labels = { chess: "Chess", music: "Music", gym: "Gym", cooking: "Cooking" };
      const [overlap] = compare(person(null, ["chess", "music"]), person(null, ["chess", "gym"]), {}, { interestLabels: labels });
      assert.equal(overlap.score, 0.5); // 2 x 1 shared / (2 + 2)
      assert.equal(overlap.reason, "You're both into Chess");
      const [none] = compare(person(null, ["chess"]), person(null, ["gym"]));
      assert.equal(none.score, 0);
      assert.equal(none.reason, undefined);
      const [many] = compare(
        person(null, ["chess", "music", "gym", "cooking"]),
        person(null, ["chess", "music", "gym"]),
        {},
        { interestLabels: labels },
      );
      assert.match(many.reason ?? "", /^You share 3 interests, including Chess and Gym$/);
    });

    it("skips interests when either student hasn't picked any", () => {
      assert.equal(compare(person(null, ["chess"]), person(null, [])).length, 0);
    });
  });

  describe("missing data", () => {
    it("is neither a mismatch nor a perfect match: nothing to compare means no score", () => {
      const result = scoreCompatibility(person(null), person(FULL, ["chess"]));
      assert.equal(result.score, null);
      assert.equal(result.percent, null);
      assert.equal(result.coverage, 0);
      assert.equal(result.rankScore, 0.5, "unknown sits in the middle of the ranking");
      assert.equal(result.sufficient, false);
    });

    it("only compares questions both students answered", () => {
      const comparisons = compare(person({ sleep_schedule: "night_owl", smoking: "non_smoker" }), person({ sleep_schedule: "night_owl" }));
      assert.deepEqual(comparisons.map((item) => item.key), ["sleep_schedule"]);
    });

    it("leaves out empty dimensions and rescales the remaining weights", () => {
      // Only lifestyle (perfect) and practical (a clash) have data.
      const result = scoreCompatibility(
        person({ sleep_schedule: "night_owl" }),
        person({ sleep_schedule: "night_owl" }),
        { budget: "mismatch" },
      );
      const expected = (1 * DEFAULT_WEIGHTS.lifestyle + 0 * DEFAULT_WEIGHTS.practical) / (DEFAULT_WEIGHTS.lifestyle + DEFAULT_WEIGHTS.practical);
      assert.equal(result.score, expected);
      assert.equal(result.coverage, 0.4);
      assert.equal(scoreOf(result, "habits"), null);
    });

    it("hides the percentage when there's too little to go on, but still ranks sensibly", () => {
      const thin = scoreCompatibility(person({ sleep_schedule: "night_owl" }), person({ sleep_schedule: "night_owl" }));
      assert.equal(thin.score, 1);
      assert.equal(thin.percent, null, "one shared answer is not a 100% match");
      assert.equal(thin.sufficient, false);
      assert.ok(thin.rankScore < 0.7, "and isn't ranked as one either");
      const rich = scoreCompatibility(person(FULL), person(FULL));
      assert.ok(rich.rankScore > thin.rankScore);
    });
  });

  describe("weights and breakdown", () => {
    it("lets the weights change without touching the rules", () => {
      const viewer = person({ sleep_schedule: "night_owl" }, ["chess"]);
      const candidate = person({ sleep_schedule: "night_owl" }, ["gym"]);
      const lifestyleFirst = scoreCompatibility(viewer, candidate);
      const interestsOnly = scoreCompatibility(viewer, candidate, {}, {
        weights: { lifestyle: 0, personality: 100, habits: 0, housing: 0, practical: 0 },
      });
      assert.ok((lifestyleFirst.score ?? 0) > 0.5);
      assert.equal(interestsOnly.score, 0);
    });

    it("reports each dimension's score and how many things it compared", () => {
      const result = scoreCompatibility(person(FULL, ["chess"]), person(FULL, ["chess"]), {
        societies: "match",
        move_in: "close",
        budget: "match",
        amenities: 0.5,
      });
      const housing = result.breakdown.find((item) => item.dimension === "housing");
      assert.equal(housing?.comparisons, 2);
      assert.equal(housing?.score, 0.8); // (1 + 0.6) / 2
      const practical = result.breakdown.find((item) => item.dimension === "practical");
      assert.equal(practical?.score, 0.75); // (1 + 0.5) / 2
      assert.equal(result.compared, 11 + 1 + 4);
      assert.equal(result.coverage, 1);
      assert.deepEqual(result.breakdown.map((item) => item.dimension), ["lifestyle", "personality", "habits", "housing", "practical"]);
    });

    it("weighs interests double inside personality", () => {
      const result = summarise([
        { key: "interests", dimension: "personality", score: 1, weight: 2 },
        { key: "personality", dimension: "personality", score: 0.4, weight: 1 },
      ]);
      const score = result.breakdown.find((item) => item.dimension === "personality")?.score ?? 0;
      assert.ok(Math.abs(score - 0.8) < 1e-9, String(score)); // (1 x 2 + 0.4) / 3
    });
  });

  describe("housing and practical facts", () => {
    it("explains matches in words that fit whether they have a flat", () => {
      const facts = { societies: "match", budget: "match" } as const;
      const flat = scoreCompatibility(person(null), person(null), facts, { candidateHasListing: true });
      assert.deepEqual(flat.reasons.sort(), ["Their flat fits your budget", "Their flat is in a society you prefer"]);
      const hunter = scoreCompatibility(person(null), person(null), facts);
      assert.deepEqual(hunter.reasons.sort(), ["Your budgets overlap", "Your preferred societies overlap"]);
    });

    it("never invents a reason: mismatches, close calls and the gender fact give none", () => {
      const result = scoreCompatibility(person(null), person(null), { societies: "mismatch", move_in: "close", gender: "match" });
      assert.deepEqual(result.reasons, []);
    });

    it("ignores facts it doesn't recognise", () => {
      const result = scoreCompatibility(person(null), person(null), { budget: "great" as never, amenities: 7 });
      assert.equal(result.compared, 0);
    });
  });
});
