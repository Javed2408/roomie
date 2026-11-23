/**
 * Discovery filters (src/lib/feed-filters.ts) and feed ordering
 * (src/lib/discovery-ranking.ts).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { nextPage, rankCandidates, type Rankable } from "../../src/lib/discovery-ranking.ts";
import {
  activeFilters,
  EMPTY_FILTERS,
  filtersToQuery,
  filtersToRpc,
  parseFilters,
} from "../../src/lib/feed-filters.ts";

const item = (id: string, rankScore: number, clusterKey = id, lastActive = "2026-11-20T00:00:00Z"): Rankable => ({
  id,
  rankScore,
  clusterKey,
  lastActive,
});
const ids = (items: Rankable[]) => items.map((entry) => entry.id);

describe("discovery filters", () => {
  it("reads every filter from the address and round-trips it", () => {
    const filters = parseFilters({
      society: ["Estancia", "Akshaya"],
      min: "6000",
      max: "15000",
      move: "next_month",
      room: "private",
      bhk: ["2BHK", "3BHK"],
      amenity: ["AC", "Wi-Fi"],
      gender: "female",
    });
    assert.deepEqual(filters, {
      societies: ["Estancia", "Akshaya"],
      budgetMin: 6000,
      budgetMax: 15000,
      moveIn: "next_month",
      roomType: "private",
      bhk: ["2BHK", "3BHK"],
      amenities: ["AC", "Wi-Fi"],
      gender: "female",
    });
    const again = parseFilters(Object.fromEntries(
      [...new URLSearchParams(filtersToQuery(filters)).keys()].map((key) => [
        key,
        new URLSearchParams(filtersToQuery(filters)).getAll(key),
      ]),
    ));
    assert.deepEqual(again, filters);
  });

  it("ignores junk, repeats and an impossible budget range", () => {
    const filters = parseFilters({
      society: ["Atlantis", "Estancia", "Estancia"],
      min: "20000",
      max: "10000",
      move: "yesterday",
      room: "penthouse",
      bhk: "9BHK",
      amenity: "Pool",
      gender: "robot",
    });
    assert.deepEqual(filters, { ...EMPTY_FILTERS, societies: ["Estancia"], budgetMax: 10000 });
    assert.equal(parseFilters({ max: "12.5" }).budgetMax, null);
    assert.equal(parseFilters({ max: "999999999" }).budgetMax, null);
  });

  it("keeps the old ?budget= links working", () => {
    assert.equal(parseFilters({ budget: "12000" }).budgetMax, 12000);
  });

  it("has no active filters by default, and sends nothing restrictive to the database", () => {
    assert.deepEqual(parseFilters({}), EMPTY_FILTERS);
    assert.equal(filtersToQuery(EMPTY_FILTERS), "");
    assert.deepEqual(activeFilters(EMPTY_FILTERS), []);
    const rpc = filtersToRpc(EMPTY_FILTERS);
    assert.deepEqual(rpc.societies, []);
    assert.equal(rpc.budget_max, null);
  });

  it("shows one removable pill per value, each removing only itself", () => {
    const filters = parseFilters({ society: ["Estancia", "Akshaya"], max: "15000", amenity: "AC" });
    const pills = activeFilters(filters);
    assert.deepEqual(pills.map((pill) => pill.label), ["Estancia", "Akshaya", "Up to ₹15k", "AC"]);
    assert.deepEqual(pills[0].without.societies, ["Akshaya"]);
    assert.equal(pills[0].without.budgetMax, 15000);
    assert.equal(pills[2].without.budgetMax, null);
    assert.equal(activeFilters(parseFilters({ min: "6000", max: "15000" }))[0].label, "₹6k–₹15k");
  });
});

describe("feed ranking", () => {
  it("puts the best fit first, breaking ties by recent activity, then id", () => {
    const ranked = rankCandidates([
      item("c", 0.5, "c", "2026-11-01T00:00:00Z"),
      item("a", 0.9),
      item("b", 0.5, "b", "2026-11-10T00:00:00Z"),
      item("d", 0.5, "d", "2026-11-10T00:00:00Z"),
    ]);
    assert.deepEqual(ids(ranked), ["a", "b", "d", "c"]);
  });

  it("is deterministic whatever order the pool arrives in", () => {
    const pool = [item("a", 0.7), item("b", 0.7), item("c", 0.6), item("d", 0.9)];
    assert.deepEqual(ids(rankCandidates(pool)), ids(rankCandidates([...pool].reverse())));
  });

  it("breaks up long runs of look-alike candidates when scores are close", () => {
    const ranked = rankCandidates([
      item("flat1", 0.8, "flat"),
      item("flat2", 0.79, "flat"),
      item("flat3", 0.78, "flat"),
      item("hunter", 0.76, "needs"),
    ]);
    assert.deepEqual(ids(ranked), ["flat1", "flat2", "hunter", "flat3"]);
  });

  it("never lets variety jump a much better match", () => {
    const ranked = rankCandidates([
      item("flat1", 0.9, "flat"),
      item("flat2", 0.9, "flat"),
      item("flat3", 0.9, "flat"),
      item("hunter", 0.4, "needs"),
    ]);
    assert.deepEqual(ids(ranked), ["flat1", "flat2", "flat3", "hunter"]);
  });
});

describe("pagination", () => {
  const ranked = rankCandidates(Array.from({ length: 25 }, (_, n) => item(`p${String(n).padStart(2, "0")}`, 1 - n / 100)));

  it("pages through everyone exactly once", () => {
    const seen: string[] = [];
    let more = true;
    let pages = 0;
    while (more) {
      const { page, hasMore } = nextPage(ranked, seen, 10);
      seen.push(...page.map((entry) => entry.id));
      more = hasMore;
      pages += 1;
    }
    assert.equal(pages, 3);
    assert.equal(seen.length, 25);
    assert.equal(new Set(seen).size, 25);
    assert.deepEqual(seen, ids(ranked));
  });

  it("never repeats someone already shown, or a duplicate in the pool", () => {
    const withDuplicate = [ranked[0], ranked[0], ranked[1], ranked[2]];
    const { page, hasMore } = nextPage(withDuplicate, [ranked[1].id], 10);
    assert.deepEqual(ids(page), [ranked[0].id, ranked[2].id]);
    assert.equal(hasMore, false);
  });

  it("returns an empty last page", () => {
    assert.deepEqual(nextPage([], [], 10), { page: [], hasMore: false });
  });
});
