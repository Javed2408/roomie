/**
 * Listing rules (src/lib/listing-validation.ts) and wording
 * (src/lib/listing-display.ts).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { availabilityLabel, listingTitle, spaceLabel } from "../../src/lib/listing-display.ts";
import {
  EMPTY_LISTING_FORM,
  firstStepWithProblem,
  formFromListing,
  listingGaps,
  todayInIndia,
  validateAddress,
  validateListing,
  type ListingForm,
} from "../../src/lib/listing-validation.ts";

const TODAY = "2026-11-24";
const valid: ListingForm = {
  ...EMPTY_LISTING_FORM,
  society: "Estancia",
  rent_per_person: "9,000",
  maintenance_per_person: "1000",
  deposit_per_person: "20000",
  setup_cost: "0",
  bhk_type: "2BHK",
  available_rooms: "1",
  vacant_spots: "2",
  current_flatmates: "1",
  amenities: ["AC", "Wi-Fi"],
};
const problemsOf = (change: Partial<ListingForm>) => validateListing({ ...valid, ...change }, TODAY).problems;

describe("listing validation", () => {
  it("accepts a complete listing and tidies the values", () => {
    const { value, problems } = validateListing({ ...valid, locality: "  Near the Arch gate ", description: "   " }, TODAY);
    assert.deepEqual(problems, {});
    assert.equal(value.rent_per_person, 9000);
    assert.equal(value.setup_cost, 0);
    assert.equal(value.locality, "Near the Arch gate");
    assert.equal(value.description, null, "blank text is saved as nothing");
    assert.equal(value.available_from, null, "no date means available now");
  });

  it("requires the basics, and says which step they're on", () => {
    const { problems } = validateListing(EMPTY_LISTING_FORM, TODAY);
    for (const field of ["society", "rent_per_person", "maintenance_per_person", "deposit_per_person", "setup_cost", "bhk_type"]) {
      assert.ok(problems[field], field);
    }
    assert.equal(firstStepWithProblem(problems), "location");
    assert.equal(firstStepWithProblem({ bhk_type: "x" }), "flat");
    assert.equal(firstStepWithProblem({}), null);
  });

  it("never treats a missing amount as zero", () => {
    assert.ok(problemsOf({ deposit_per_person: "" }).deposit_per_person);
    assert.ok(problemsOf({ maintenance_per_person: "   " }).maintenance_per_person);
    assert.deepEqual(problemsOf({ deposit_per_person: "0" }), {});
  });

  it("rejects negative, fractional and out-of-range money", () => {
    assert.ok(problemsOf({ rent_per_person: "-9000" }).rent_per_person);
    assert.ok(problemsOf({ rent_per_person: "500" }).rent_per_person);
    assert.ok(problemsOf({ rent_per_person: "9000.50" }).rent_per_person);
    assert.ok(problemsOf({ deposit_per_person: "-1" }).deposit_per_person);
    assert.ok(problemsOf({ deposit_per_person: "abc" }).deposit_per_person);
    assert.ok(problemsOf({ setup_cost: "99999999" }).setup_cost);
  });

  it("only accepts listed societies, sizes, amenities and options", () => {
    assert.ok(problemsOf({ society: "Atlantis" }).society);
    assert.ok(problemsOf({ bhk_type: "9BHK" }).bhk_type);
    assert.ok(problemsOf({ amenities: ["AC", "Pool"] }).amenities);
    assert.ok(problemsOf({ room_type: "penthouse" }).room_type);
    assert.ok(problemsOf({ furnishing: "palatial" }).furnishing);
    assert.ok(problemsOf({ preferred_flatmate_gender: "robots" }).preferred_flatmate_gender);
  });

  it("keeps rooms and spots consistent with the flat", () => {
    assert.match(problemsOf({ bhk_type: "1BHK", available_rooms: "2" }).available_rooms ?? "", /1BHK has 1 bedroom/);
    assert.ok(problemsOf({ available_rooms: "2", vacant_spots: "1" }).vacant_spots);
    assert.ok(problemsOf({ vacant_spots: "0" }).vacant_spots);
    assert.ok(problemsOf({ current_flatmates: "-1" }).current_flatmates);
  });

  it("checks the move-in date", () => {
    assert.deepEqual(problemsOf({ available_from: "2026-12-15" }), {});
    assert.deepEqual(problemsOf({ available_from: TODAY }), {});
    assert.match(problemsOf({ available_from: "2026-11-01" }).available_from ?? "", /passed/);
    assert.match(problemsOf({ available_from: "2026-02-30" }).available_from ?? "", /real date/);
    assert.match(problemsOf({ available_from: "next week" }).available_from ?? "", /real date/);
    assert.match(problemsOf({ available_from: "2028-01-01" }).available_from ?? "", /next year/);
  });

  it("limits photos and text length", () => {
    assert.ok(problemsOf({ photos: Array.from({ length: 9 }, (_, n) => `https://x/${n}.jpg`) }).photos);
    assert.ok(problemsOf({ photos: ["https://x/a.jpg", "https://x/a.jpg"] }).photos);
    assert.ok(problemsOf({ description: "x".repeat(1001) }).description);
    assert.ok(problemsOf({ locality: "x" }).locality);
  });

  it("checks the private address separately", () => {
    assert.deepEqual(validateAddress("  Tower B, 402 "), { value: "Tower B, 402", problem: null });
    assert.deepEqual(validateAddress(""), { value: null, problem: null });
    assert.ok(validateAddress("x".repeat(201)).problem);
  });

  it("round-trips a saved listing through the editor", () => {
    const { value } = validateListing(valid, TODAY);
    const again = validateListing(formFromListing(value, "Flat 4"), TODAY);
    assert.deepEqual(again.problems, {});
    assert.deepEqual(again.value, value);
    assert.equal(formFromListing(value, "Flat 4").address, "Flat 4");
  });

  it("works out today's date in India", () => {
    assert.equal(todayInIndia(new Date("2026-11-24T20:00:00Z")), "2026-11-25");
    assert.equal(todayInIndia(new Date("2026-11-24T10:00:00Z")), "2026-11-24");
  });
});

describe("listing quality and wording", () => {
  it("lists the details worth adding", () => {
    const bare = validateListing(valid, TODAY).value;
    assert.ok(listingGaps(bare).includes("Add photos of the flat"));
    const complete = {
      ...bare,
      photos: ["a", "b", "c"],
      description: "Bright flat",
      locality: "Potheri",
      room_type: "private" as const,
      furnishing: "furnished" as const,
      house_rules: "Quiet after 11",
    };
    assert.deepEqual(listingGaps(complete), []);
  });

  it("describes availability, space and the title", () => {
    assert.equal(availabilityLabel(null, TODAY), "Available now");
    assert.equal(availabilityLabel("2026-11-01", TODAY), "Available now");
    assert.equal(availabilityLabel("2026-12-15", TODAY), "Available from 15 Dec");
    assert.equal(spaceLabel({ available_rooms: 1, vacant_spots: 2 }), "1 room free · 2 spots open");
    assert.equal(listingTitle({ society: "Estancia", bhk_type: "2BHK" }), "Estancia · 2BHK");
  });
});
