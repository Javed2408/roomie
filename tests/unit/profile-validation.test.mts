/**
 * The rules the profile editor applies in the browser and again on the
 * server (src/lib/profile-validation.ts), plus account eligibility and the
 * image checks.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PROMPT_BANK, PROMPTS } from "../../src/lib/constants/prompts.ts";
import { isEligibleUser } from "../../src/lib/eligibility.ts";
import { fitWithin, imageProblem, MAX_IMAGE_BYTES } from "../../src/lib/image-rules.ts";
import {
  validateBasics,
  validateHousing,
  validateInterests,
  validateLifestyle,
  validatePhotoList,
  validatePractical,
  validatePrompts,
  type PracticalInput,
} from "../../src/lib/profile-validation.ts";

const practical = (change: Partial<PracticalInput> = {}): PracticalInput => ({
  budget_min: "",
  budget_max: "",
  preferred_societies: [],
  move_in_timeframe: null,
  room_type: null,
  preferred_bhk_types: [],
  required_amenities: [],
  flatmate_gender: null,
  ...change,
});

describe("profile validation", () => {
  describe("basics", () => {
    const valid = { full_name: " Asha Rao ", gender: "female", year_of_study: "2", department: "CSE", about: "" };

    it("accepts a complete profile, trimming text and treating an empty intro as none", () => {
      const { value, problems } = validateBasics(valid);
      assert.deepEqual(problems, {});
      assert.deepEqual(value, { full_name: "Asha Rao", gender: "female", year_of_study: 2, department: "CSE", about: null });
    });

    it("flags each missing or invalid field", () => {
      const { problems } = validateBasics({ full_name: "A", gender: "unknown", year_of_study: "9", department: "", about: "x".repeat(301) });
      assert.deepEqual(Object.keys(problems).sort(), ["about", "department", "full_name", "gender", "year_of_study"]);
    });
  });

  describe("prompts", () => {
    it("has a bigger bank that isn't all about housing, with no duplicates", () => {
      assert.ok(PROMPTS.length >= 20);
      assert.equal(new Set(PROMPTS).size, PROMPTS.length);
      assert.ok(PROMPT_BANK.some((group) => group.category === "About me"));
      for (const prompt of ["My ideal weekend looks like...", "Three things that describe me...", "My social battery usually..."]) {
        assert.ok((PROMPTS as readonly string[]).includes(prompt), prompt);
      }
    });

    it("allows none, up to three, each answered once", () => {
      assert.deepEqual(validatePrompts([]).problems, {});
      const two = [
        { question: "A random fact about me...", answer: "  I can juggle  " },
        { question: "My social battery usually...", answer: "Recharges with chai" },
      ];
      const { value, problems } = validatePrompts(two);
      assert.deepEqual(problems, {});
      assert.equal(value[0].answer, "I can juggle");
    });

    it("rejects too many, repeats, unknown prompts and empty or long answers", () => {
      const four = PROMPTS.slice(0, 4).map((question) => ({ question, answer: "Yes" }));
      assert.ok(validatePrompts(four).problems.prompts);
      const repeat = validatePrompts([
        { question: PROMPTS[0], answer: "One" },
        { question: PROMPTS[0], answer: "Two" },
      ]);
      assert.ok(repeat.problems.prompt_1);
      assert.ok(validatePrompts([{ question: "Made up?", answer: "Hi" }]).problems.prompt_0);
      assert.ok(validatePrompts([{ question: PROMPTS[0], answer: "   " }]).problems.answer_0);
      assert.ok(validatePrompts([{ question: PROMPTS[0], answer: "x".repeat(151) }]).problems.answer_0);
    });
  });

  describe("photos and interests", () => {
    it("allows six photos, not seven, and no repeats", () => {
      const six = Array.from({ length: 6 }, (_, n) => `https://x/${n}.jpg`);
      assert.deepEqual(validatePhotoList(six).problems, {});
      assert.ok(validatePhotoList([...six, "https://x/7.jpg"]).problems.photos);
      assert.ok(validatePhotoList(["https://x/a.jpg", "https://x/a.jpg"]).problems.photos);
    });

    it("allows ten interests, drops duplicates and checks the catalogue", () => {
      const catalogue = Array.from({ length: 20 }, (_, n) => `interest_${n}`);
      const { value, problems } = validateInterests(["interest_1", "interest_1", "interest_2"], catalogue);
      assert.deepEqual(problems, {});
      assert.deepEqual(value, ["interest_1", "interest_2"]);
      assert.ok(validateInterests(catalogue.slice(0, 11), catalogue).problems.interests);
      assert.ok(validateInterests(["not_real"], catalogue).problems.interests);
    });
  });

  describe("lifestyle", () => {
    it("keeps valid answers, leaves the rest unanswered", () => {
      const { value, problems } = validateLifestyle({ sleep_schedule: "night_owl", study_habits: "in_groups", cleaning_rota: true });
      assert.deepEqual(problems, {});
      assert.equal(value.sleep_schedule, "night_owl");
      assert.equal(value.study_habits, "in_groups");
      assert.equal(value.smoking, null);
      assert.equal(value.cleaning_rota, true);
      assert.equal(value.guest_notice, null);
    });

    it("rejects answers that aren't offered (only database values are allowed)", () => {
      assert.ok(validateLifestyle({ smoking: "sometimes" }).problems.smoking);
      assert.ok(validateLifestyle({ food_habits: "pescatarian" }).problems.food_habits);
    });
  });

  describe("practical preferences", () => {
    it("treats empty fields as no preference", () => {
      const { value, problems } = validatePractical(practical());
      assert.deepEqual(problems, {});
      assert.equal(value.budget_min, null);
      assert.equal(value.budget_max, null);
    });

    it("parses budgets and requires the minimum not to exceed the maximum", () => {
      assert.equal(validatePractical(practical({ budget_min: "8,000", budget_max: 15000 })).value.budget_min, 8000);
      assert.ok(validatePractical(practical({ budget_min: "16000", budget_max: "12000" })).problems.budget_min);
      assert.ok(validatePractical(practical({ budget_max: "500" })).problems.budget_max);
      assert.ok(validatePractical(practical({ budget_max: "12.5" })).problems.budget_max);
    });

    it("only accepts the shared lists of societies, flat sizes and amenities", () => {
      const ok = validatePractical(
        practical({ preferred_societies: ["Estancia"], preferred_bhk_types: ["2BHK"], required_amenities: ["Wi-Fi"], room_type: "private", flatmate_gender: "any", move_in_timeframe: "july" }),
      );
      assert.deepEqual(ok.problems, {});
      assert.ok(validatePractical(practical({ preferred_societies: ["Atlantis"] })).problems.preferred_societies);
      assert.ok(validatePractical(practical({ room_type: "penthouse" })).problems.room_type);
    });
  });

  describe("housing and discovery", () => {
    it("accepts every product combination", () => {
      for (const status of ["has_accommodation", "needs_accommodation"]) {
        for (const discover of ["has_accommodation", "needs_accommodation", "both"]) {
          for (const seeking of ["flatmate", "group", "either"]) {
            assert.deepEqual(validateHousing({ status, discover_housing: discover, seeking, hide_listings: false }).problems, {});
          }
        }
      }
    });

    it("only hides listings when explicitly asked", () => {
      const input = { status: "needs_accommodation", discover_housing: "both", seeking: "either" };
      assert.equal(validateHousing({ ...input, hide_listings: false }).value.hide_listings, false);
      assert.equal(validateHousing({ ...input, hide_listings: "yes" as unknown as boolean }).value.hide_listings, false);
      assert.equal(validateHousing({ ...input, hide_listings: true }).value.hide_listings, true);
    });

    it("rejects unknown values", () => {
      const { problems } = validateHousing({ status: "homeless", discover_housing: "everyone", seeking: "anyone", hide_listings: false });
      assert.deepEqual(Object.keys(problems).sort(), ["discover_housing", "seeking", "status"]);
    });
  });
});

describe("account eligibility", () => {
  it("needs a confirmed @srmist.edu.in login", () => {
    const confirmed = "2026-11-23T10:00:00Z";
    assert.equal(isEligibleUser({ email: "ab1234@srmist.edu.in", email_confirmed_at: confirmed }), true);
    assert.equal(isEligibleUser({ email: "ab1234@srmist.edu.in", email_confirmed_at: null }), false);
    assert.equal(isEligibleUser({ email: "someone@gmail.com", email_confirmed_at: confirmed }), false);
    assert.equal(isEligibleUser(null), false);
  });
});

describe("images", () => {
  it("accepts JPG, PNG and WebP up to 5 MB", () => {
    assert.equal(imageProblem({ type: "image/jpeg", size: 1024 }), null);
    assert.equal(imageProblem({ type: "image/webp", size: MAX_IMAGE_BYTES }), null);
    assert.match(imageProblem({ type: "image/gif", size: 1024 }) ?? "", /JPG, PNG or WebP/);
    assert.match(imageProblem({ type: "image/png", size: MAX_IMAGE_BYTES + 1 }) ?? "", /over 5 MB/);
    assert.match(imageProblem({ type: "image/png", size: 0 }) ?? "", /empty/);
  });

  it("scales big photos down to 1600px, keeping their shape, and never enlarges", () => {
    assert.deepEqual(fitWithin(4000, 3000), { width: 1600, height: 1200 });
    assert.deepEqual(fitWithin(3000, 4000), { width: 1200, height: 1600 });
    assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600 });
  });
});
