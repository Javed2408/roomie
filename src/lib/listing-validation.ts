/**
 * The rules for a listing, used by the listing editor in the browser (for
 * quick feedback) and again by the server before saving. The database's
 * CHECK constraints and triggers are the final safety net.
 *
 * Money is never assumed: an empty amount is a problem ("enter 0 if there
 * is none"), not zero.
 *
 * Plain module with relative imports, so it can be tested directly.
 */

import {
  BEDROOMS,
  FLATMATE_GENDER_OPTIONS,
  FURNISHING_OPTIONS,
  LISTING_LIMITS,
  LISTING_ROOM_TYPES,
} from "./constants/listings.ts";
import { AMENITIES, BHK_TYPES, MAX_LISTING_PHOTOS, SOCIETIES } from "./constants/prompts.ts";

/** What the editor holds: text boxes give strings, so numbers may be either. */
export type ListingForm = {
  society: string;
  locality: string;
  location_notes: string;
  /** Private: only the owner ever sees it. */
  address: string;
  rent_per_person: string | number;
  maintenance_per_person: string | number;
  deposit_per_person: string | number;
  setup_cost: string | number;
  bhk_type: string;
  available_rooms: string | number;
  vacant_spots: string | number;
  current_flatmates: string | number;
  room_type: string | null;
  furnishing: string | null;
  /** YYYY-MM-DD, or "" for available now. */
  available_from: string;
  description: string;
  living_arrangement: string;
  house_rules: string;
  amenities: string[];
  preferred_flatmate_gender: string;
  flatmate_preferences: string;
  photos: string[];
};

/** What gets saved. */
export type ListingValues = {
  society: (typeof SOCIETIES)[number];
  locality: string | null;
  location_notes: string | null;
  rent_per_person: number;
  maintenance_per_person: number;
  deposit_per_person: number;
  setup_cost: number;
  bhk_type: (typeof BHK_TYPES)[number];
  available_rooms: number;
  vacant_spots: number;
  current_flatmates: number;
  room_type: (typeof LISTING_ROOM_TYPES)[number]["value"] | null;
  furnishing: (typeof FURNISHING_OPTIONS)[number]["value"] | null;
  available_from: string | null;
  description: string | null;
  living_arrangement: string | null;
  house_rules: string | null;
  amenities: Array<(typeof AMENITIES)[number]>;
  preferred_flatmate_gender: (typeof FLATMATE_GENDER_OPTIONS)[number]["value"];
  flatmate_preferences: string | null;
  photos: string[];
};

export type Problems = Record<string, string>;

/** The editor's steps, and which fields each one holds. */
export const LISTING_STEPS = [
  { id: "location", label: "Location", fields: ["society", "locality", "location_notes", "address"] },
  { id: "costs", label: "Rent & costs", fields: ["rent_per_person", "maintenance_per_person", "deposit_per_person", "setup_cost"] },
  {
    id: "flat",
    label: "The flat",
    fields: ["bhk_type", "available_rooms", "vacant_spots", "room_type", "furnishing", "available_from", "description"],
  },
  { id: "living", label: "Living there", fields: ["current_flatmates", "living_arrangement", "house_rules"] },
  { id: "amenities", label: "Amenities", fields: ["amenities"] },
  { id: "flatmate", label: "Ideal flatmate", fields: ["preferred_flatmate_gender", "flatmate_preferences"] },
  { id: "photos", label: "Photos", fields: ["photos"] },
] as const;
export type ListingStep = (typeof LISTING_STEPS)[number]["id"];

/** The first step with a problem, so the editor can jump there. */
export function firstStepWithProblem(problems: Problems): ListingStep | null {
  return LISTING_STEPS.find((step) => step.fields.some((field) => problems[field]))?.id ?? null;
}

export const EMPTY_LISTING_FORM: ListingForm = {
  society: "",
  locality: "",
  location_notes: "",
  address: "",
  rent_per_person: "",
  maintenance_per_person: "",
  deposit_per_person: "",
  setup_cost: "",
  bhk_type: "",
  available_rooms: 1,
  vacant_spots: 1,
  current_flatmates: 0,
  room_type: null,
  furnishing: null,
  available_from: "",
  description: "",
  living_arrangement: "",
  house_rules: "",
  amenities: [],
  preferred_flatmate_gender: "any",
  flatmate_preferences: "",
  photos: [],
};

const isOneOf = <T extends string>(allowed: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (allowed as readonly string[]).includes(value);
const valuesOf = <T extends string>(options: ReadonlyArray<{ value: T }>) => options.map((option) => option.value);

/** A whole number of rupees from a text box ("12,000" works), or null. */
function amount(value: unknown): number | null {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.replace(/[,\s₹]/g, "") : "";
  return /^\d{1,7}$/.test(text) ? Number(text) : null;
}
function count(value: unknown): number | null {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  return /^\d{1,2}$/.test(text) ? Number(text) : null;
}
/** Trimmed text, or null when empty. */
function optional(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Days from `from` to `to` (both YYYY-MM-DD), or null if either isn't a real date. */
function daysBetween(from: string, to: string): number | null {
  const parse = (text: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
    const date = new Date(`${text}T00:00:00Z`);
    return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text ? null : date.getTime();
  };
  const a = parse(from);
  const b = parse(to);
  return a === null || b === null ? null : Math.round((b - a) / 86400000);
}

/** Today as YYYY-MM-DD in India, where every Roomie listing is. */
export function todayInIndia(now: Date = new Date()): string {
  return new Date(now.getTime() + 5.5 * 3600000).toISOString().slice(0, 10);
}

/**
 * Check a whole listing. `today` is YYYY-MM-DD (passed in, so tests and
 * the server agree on what "today" is). The private address is checked
 * separately (validateAddress), as it's stored apart from the listing.
 */
export function validateListing(
  input: Partial<ListingForm>,
  today: string = todayInIndia(),
): { value: ListingValues; problems: Problems } {
  const problems: Problems = {};
  const limits = LISTING_LIMITS;
  const text = (key: keyof ListingForm, max: number, min = 1) => {
    const value = optional(input[key]);
    if (value && (value.length < min || value.length > max)) {
      problems[key] = min > 1 ? `Use ${min} to ${max} characters.` : `Keep it to ${max} characters.`;
    }
    return value;
  };

  if (!isOneOf(SOCIETIES, input.society)) {
    problems.society = "Choose the society or area.";
  }
  const locality = text("locality", limits.locality, 2);
  const location_notes = text("location_notes", limits.locationNotes);

  const rent = amount(input.rent_per_person);
  if (rent === null || rent < limits.rentMin || rent > limits.rentMax) {
    problems.rent_per_person = "Enter the monthly rent per person: ₹1,000 to ₹2,00,000.";
  }
  const money = (key: "maintenance_per_person" | "deposit_per_person" | "setup_cost") => {
    const value = amount(input[key]);
    if (value === null || value > limits.otherMax) {
      problems[key] = "Enter an amount in whole rupees (0 if there's none).";
    }
    return value ?? 0;
  };
  const maintenance = money("maintenance_per_person");
  const deposit = money("deposit_per_person");
  const setup = money("setup_cost");

  if (!isOneOf(BHK_TYPES, input.bhk_type)) {
    problems.bhk_type = "Choose the flat size.";
  }
  const rooms = count(input.available_rooms);
  const spots = count(input.vacant_spots);
  const flatmates = count(input.current_flatmates);
  const bedrooms = isOneOf(BHK_TYPES, input.bhk_type) ? BEDROOMS[input.bhk_type] : 10;
  if (rooms === null || rooms < 1 || rooms > bedrooms) {
    problems.available_rooms =
      rooms !== null && rooms > bedrooms
        ? `A ${input.bhk_type} has ${bedrooms} ${bedrooms === 1 ? "bedroom" : "bedrooms"}.`
        : "Choose how many rooms are free.";
  }
  if (spots === null || spots < 1 || spots > limits.spots) {
    problems.vacant_spots = `Choose 1 to ${limits.spots} spots.`;
  } else if (rooms !== null && rooms >= 1 && spots < rooms) {
    problems.vacant_spots = "Each free room needs at least one spot.";
  }
  if (flatmates === null || flatmates > limits.flatmates) {
    problems.current_flatmates = `Choose 0 to ${limits.flatmates}.`;
  }
  const roomType = input.room_type ?? null;
  if (roomType !== null && !isOneOf(valuesOf(LISTING_ROOM_TYPES), roomType)) {
    problems.room_type = "Choose a room type from the list.";
  }
  const furnishing = input.furnishing ?? null;
  if (furnishing !== null && !isOneOf(valuesOf(FURNISHING_OPTIONS), furnishing)) {
    problems.furnishing = "Choose an option from the list.";
  }

  const from = optional(input.available_from);
  if (from) {
    const days = daysBetween(today, from);
    if (days === null) {
      problems.available_from = "Enter a real date.";
    } else if (days < 0) {
      problems.available_from = "That date has passed. Leave it empty if the spot is free now.";
    } else if (days > limits.maxDaysAhead) {
      problems.available_from = "Choose a date within the next year.";
    }
  }

  const description = text("description", limits.description);
  const living_arrangement = text("living_arrangement", limits.longText);
  const house_rules = text("house_rules", limits.longText);

  const amenities = [...new Set(input.amenities ?? [])];
  if (!amenities.every((item) => isOneOf(AMENITIES, item))) {
    problems.amenities = "Choose amenities from the list.";
  }
  const gender = input.preferred_flatmate_gender ?? "any";
  if (!isOneOf(valuesOf(FLATMATE_GENDER_OPTIONS), gender)) {
    problems.preferred_flatmate_gender = "Choose an option from the list.";
  }
  const flatmate_preferences = text("flatmate_preferences", limits.flatmateNotes);

  const photos = input.photos ?? [];
  if (photos.length > MAX_LISTING_PHOTOS) {
    problems.photos = `Add up to ${MAX_LISTING_PHOTOS} photos.`;
  } else if (new Set(photos).size !== photos.length) {
    problems.photos = "The same photo is in there twice.";
  }

  return {
    value: {
      society: input.society as ListingValues["society"],
      locality,
      location_notes,
      rent_per_person: rent ?? 0,
      maintenance_per_person: maintenance,
      deposit_per_person: deposit,
      setup_cost: setup,
      bhk_type: input.bhk_type as ListingValues["bhk_type"],
      available_rooms: rooms ?? 1,
      vacant_spots: spots ?? 1,
      current_flatmates: flatmates ?? 0,
      room_type: roomType as ListingValues["room_type"],
      furnishing: furnishing as ListingValues["furnishing"],
      available_from: from,
      description,
      living_arrangement,
      house_rules,
      amenities: amenities as ListingValues["amenities"],
      preferred_flatmate_gender: gender as ListingValues["preferred_flatmate_gender"],
      flatmate_preferences,
      photos,
    },
    problems,
  };
}

/** The editor's starting values for an existing listing. */
export function formFromListing(
  listing: Omit<ListingValues, "society" | "bhk_type" | "room_type" | "furnishing" | "preferred_flatmate_gender" | "amenities"> & {
    society: string;
    bhk_type: string;
    room_type: string | null;
    furnishing: string | null;
    preferred_flatmate_gender: string;
    amenities: readonly string[];
  },
  address: string | null,
): ListingForm {
  return {
    society: listing.society,
    locality: listing.locality ?? "",
    location_notes: listing.location_notes ?? "",
    address: address ?? "",
    rent_per_person: String(listing.rent_per_person),
    maintenance_per_person: String(listing.maintenance_per_person),
    deposit_per_person: String(listing.deposit_per_person),
    setup_cost: String(listing.setup_cost),
    bhk_type: listing.bhk_type,
    available_rooms: String(listing.available_rooms),
    vacant_spots: String(listing.vacant_spots),
    current_flatmates: String(listing.current_flatmates),
    room_type: listing.room_type,
    furnishing: listing.furnishing,
    available_from: listing.available_from ?? "",
    description: listing.description ?? "",
    living_arrangement: listing.living_arrangement ?? "",
    house_rules: listing.house_rules ?? "",
    amenities: [...listing.amenities],
    preferred_flatmate_gender: listing.preferred_flatmate_gender,
    flatmate_preferences: listing.flatmate_preferences ?? "",
    photos: [...listing.photos],
  };
}

/** The private address: optional, 2 to 200 characters. */
export function validateAddress(value: unknown): { value: string | null; problem: string | null } {
  const address = optional(value);
  if (address && (address.length < 2 || address.length > LISTING_LIMITS.address)) {
    return { value: address, problem: `Keep the address to ${LISTING_LIMITS.address} characters.` };
  }
  return { value: address, problem: null };
}

/** Useful details a listing is missing, for the owner's checklist. */
export function listingGaps(listing: {
  photos: readonly string[];
  description: string | null;
  locality: string | null;
  room_type: string | null;
  furnishing: string | null;
  house_rules: string | null;
  living_arrangement: string | null;
}): string[] {
  const gaps: string[] = [];
  if (listing.photos.length === 0) gaps.push("Add photos of the flat");
  else if (listing.photos.length < 3) gaps.push("Add a few more photos");
  if (!listing.description) gaps.push("Write a short description");
  if (!listing.locality) gaps.push("Add the area or locality");
  if (!listing.room_type) gaps.push("Say whether the room is private or shared");
  if (!listing.furnishing) gaps.push("Add the furnishing");
  if (!listing.living_arrangement && !listing.house_rules) gaps.push("Describe life in the flat");
  return gaps;
}
