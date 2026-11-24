/**
 * Group rules (group-validation.ts), insights (group-compatibility.ts),
 * filters (group-filters.ts) and wording (group-display.ts).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { groupInsights, singular, type GroupPerson } from "../../src/lib/group-compatibility.ts";
import { capacityLabel, membershipLabel, notificationText } from "../../src/lib/group-display.ts";
import { activeGroupFilters, groupFiltersToQuery, NO_GROUP_FILTERS, parseGroupFilters } from "../../src/lib/group-filters.ts";
import {
  budgetRangeLabel,
  EMPTY_GROUP_FORM,
  firstGroupStepWithProblem,
  formFromGroup,
  validateGroup,
  validateMessage,
} from "../../src/lib/group-validation.ts";

const person = (lifestyle: GroupPerson["lifestyle"], extra: Partial<GroupPerson> = {}): GroupPerson => ({
  lifestyle,
  interests: [],
  max_budget: null,
  preferred_societies: [],
  move_in_timeframe: null,
  ...extra,
});
const terms = { budget_min: null, budget_max: null, preferred_societies: [] as string[], move_in_timeframe: null };

describe("group validation", () => {
  it("only needs a name; everything else is optional", () => {
    const { value, problems } = validateGroup({ ...EMPTY_GROUP_FORM, name: "  Night owls " });
    assert.deepEqual(problems, {});
    assert.equal(value.name, "Night owls");
    assert.equal(value.budget_min, null);
    assert.equal(value.description, null);
    assert.equal(value.is_discoverable, true);
  });

  it("rejects a missing name, bad sizes and unknown values", () => {
    const { problems } = validateGroup({
      ...EMPTY_GROUP_FORM,
      name: "x",
      max_members: "11",
      preferred_societies: ["Atlantis"],
      housing_status: "mansion",
      room_preference: "tent",
      move_in_timeframe: "someday",
      preferred_gender: "robots",
    });
    assert.deepEqual(Object.keys(problems).sort(), [
      "housing_status",
      "max_members",
      "move_in_timeframe",
      "name",
      "preferred_gender",
      "preferred_societies",
      "room_preference",
    ]);
    assert.equal(firstGroupStepWithProblem(problems), "identity");
  });

  it("checks the budget range and never shrinks below current members", () => {
    assert.ok(validateGroup({ ...EMPTY_GROUP_FORM, name: "Group", budget_min: "12000", budget_max: "8000" }).problems.budget_min);
    assert.ok(validateGroup({ ...EMPTY_GROUP_FORM, name: "Group", budget_max: "-5" }).problems.budget_max);
    assert.ok(validateGroup({ ...EMPTY_GROUP_FORM, name: "Group", budget_min: "500" }).problems.budget_min);
    assert.deepEqual(validateGroup({ ...EMPTY_GROUP_FORM, name: "Group", budget_min: "6,000", budget_max: "12000" }).value.budget_min, 6000);
    assert.match(validateGroup({ ...EMPTY_GROUP_FORM, name: "Group", max_members: "3" }, { memberCount: 4 }).problems.max_members ?? "", /already has 4/);
  });

  it("round-trips a saved group through the form", () => {
    const { value } = validateGroup({ ...EMPTY_GROUP_FORM, name: "Group", budget_max: "9000", preferred_societies: ["Estancia"] });
    const again = validateGroup(formFromGroup({ ...value, status: "forming" }));
    assert.deepEqual(again.problems, {});
    assert.deepEqual({ ...again.value, status: undefined }, { ...value, status: undefined });
  });

  it("limits messages and labels budgets", () => {
    assert.deepEqual(validateMessage("  Hi there  "), { value: "Hi there", problem: null });
    assert.ok(validateMessage("x".repeat(301)).problem);
    assert.equal(budgetRangeLabel(6000, 12000), "₹6k–₹12k");
    assert.equal(budgetRangeLabel(null, 9000), "Up to ₹9k");
    assert.equal(budgetRangeLabel(7500, null), "From ₹7,500");
    assert.equal(budgetRangeLabel(null, null), null);
  });
});

describe("group insights", () => {
  it("reports what a clear majority agrees on", () => {
    const members = [person({ noise_tolerance: "low" }), person({ noise_tolerance: "low" }), person({ noise_tolerance: "medium" })];
    const { agreements, splits } = groupInsights(terms, members);
    assert.ok(agreements.includes("Most members prefer a quiet home"));
    assert.deepEqual(splits, []);
  });

  it("reports splits instead of inventing a majority", () => {
    const members = [person({ guests: "rarely" }), person({ guests: "often" })];
    const { agreements, splits } = groupInsights(terms, members);
    assert.deepEqual(agreements, []);
    assert.ok(splits.includes("Members have different guest habits"));
  });

  it("says nothing from a single answer or missing data", () => {
    const { agreements, splits, fit, basis } = groupInsights(terms, [person({ noise_tolerance: "low" }), person(null)], person(null));
    assert.deepEqual([agreements, splits, fit], [[], [], []]);
    assert.equal(basis, 1);
  });

  it("compares a student with the group, not with an average", () => {
    const members = [person({ smoking: "non_smoker" }), person({ smoking: "non_smoker" })];
    const fits = groupInsights(terms, members, person({ smoking: "non_smoker" })).fit;
    assert.ok(fits.some((item) => item.tone === "good" && item.text === "You also don't smoke"));
    const clash = groupInsights(terms, members, person({ smoking: "smoker" }), { who: "Ravi" }).fit;
    assert.ok(clash.some((item) => item.tone === "note" && item.text === "Ravi smokes, unlike most members"));
  });

  it("checks the student's budget against the group's agreed range", () => {
    const range = { ...terms, budget_min: 8000, budget_max: 12000 };
    assert.ok(groupInsights(range, [], person(null, { max_budget: 6000 })).fit.some((item) => item.text === "Your budget is below the group's range"));
    assert.ok(groupInsights(range, [], person(null, { max_budget: 10000 })).fit.some((item) => item.text === "Your budget fits the group's range"));
    assert.equal(groupInsights(terms, [], person(null, { max_budget: 6000 })).fit.length, 0, "no range, no claim");
  });

  it("covers societies, move-in timing and shared interests", () => {
    const group = { ...terms, preferred_societies: ["Estancia"], move_in_timeframe: "july" };
    const members = [
      person(null, { preferred_societies: ["Estancia", "Akshaya"], interests: ["chess"] }),
      person(null, { preferred_societies: ["Estancia"], interests: ["music"] }),
    ];
    const result = groupInsights(group, members, person(null, { preferred_societies: ["Estancia"], move_in_timeframe: "flexible", interests: ["chess"] }), {
      interestLabels: { chess: "Chess" },
    });
    assert.ok(result.agreements.includes("Members' preferred societies overlap: Estancia"));
    const texts = result.fit.map((item) => item.text);
    assert.ok(texts.includes("You also want Estancia"));
    assert.ok(texts.includes("Your move-in timing works for the group"));
    assert.ok(texts.includes("Shared interests with members: Chess"));
    const other = groupInsights(group, members, person(null, { preferred_societies: ["Green Pearl"], move_in_timeframe: "immediate" })).fit;
    assert.ok(other.some((item) => item.tone === "note" && item.text.includes("different societies")));
    assert.ok(other.some((item) => item.tone === "note" && item.text.includes("move-in timing differs")));
  });

  it("words things for a named student", () => {
    assert.equal(singular("prefer a quiet home"), "prefers a quiet home");
    assert.equal(singular("don't smoke"), "doesn't smoke");
    assert.equal(singular("are night owls"), "is a night owl");
    assert.equal(singular("are early birds"), "is an early bird");
    assert.equal(singular("are vegetarian"), "is vegetarian");
  });
});

describe("group filters", () => {
  it("parses, ignores junk and round-trips", () => {
    const filters = parseGroupFilters({ society: ["Estancia", "Atlantis"], min: "15000", max: "9000", move: "july", size: ["4", "99"], housing: "has_accommodation", room: "1", quiet: "1" });
    assert.deepEqual(filters, { ...NO_GROUP_FILTERS, societies: ["Estancia"], budgetMax: 9000, moveIn: "july", sizes: [4], housing: "has_accommodation", hasRoom: true, quiet: true });
    const query = new URLSearchParams(groupFiltersToQuery(filters));
    const params: Record<string, string[]> = {};
    for (const [key, value] of query) params[key] = [...(params[key] ?? []), value];
    assert.deepEqual(parseGroupFilters(params), filters);
  });

  it("makes one removable pill per filter", () => {
    const pills = activeGroupFilters(parseGroupFilters({ society: "Estancia", max: "9000", smokefree: "1" }));
    assert.deepEqual(pills.map((pill) => pill.label), ["Estancia", "Up to ₹9k", "Smoke-free"]);
    assert.deepEqual(pills[0].without.societies, []);
    assert.deepEqual(activeGroupFilters(NO_GROUP_FILTERS), []);
  });
});

describe("group wording", () => {
  it("describes membership, capacity and notifications", () => {
    assert.equal(membershipLabel("active", "admin"), "You're an admin");
    assert.equal(membershipLabel("left"), null);
    assert.equal(capacityLabel(2, 4), "2 of 4 members · 2 spots left");
    assert.equal(capacityLabel(4, 4), "4 of 4 members · full");
    assert.equal(
      notificationText({ kind: "invited", groupName: "Night owls", actor: "Asha", subject: "Ravi", detail: null }),
      "Asha invited you to join “Night owls”",
    );
    assert.equal(
      notificationText({ kind: "role_changed", groupName: "Night owls", actor: "Asha", subject: "Ravi", detail: "admin" }),
      "You're now an admin of “Night owls”",
    );
  });
});
