/**
 * Discovery filters: kept in the page address, safe in the browser and on
 * the server. Every filter is optional. The database applies them
 * (discovery_candidates, migration 013) and never filters someone out just
 * because they haven't given that detail.
 *
 * Plain module with relative imports, so it can be tested directly.
 */

import { AMENITIES, BHK_TYPES, SOCIETIES, type Amenity, type BhkType, type Society } from "./constants/prompts.ts";

export type MoveInFilter = "immediate" | "next_month" | "next_semester" | "july";
export type RoomFilter = "private" | "shared";
export type GenderFilter = "male" | "female";

export type FeedFilters = {
  societies: Society[];
  /** Monthly rupees per person. */
  budgetMin: number | null;
  budgetMax: number | null;
  moveIn: MoveInFilter | null;
  roomType: RoomFilter | null;
  bhk: BhkType[];
  /** Only narrows students who have listed a flat. */
  amenities: Amenity[];
  gender: GenderFilter | null;
};

export const EMPTY_FILTERS: FeedFilters = {
  societies: [],
  budgetMin: null,
  budgetMax: null,
  moveIn: null,
  roomType: null,
  bhk: [],
  amenities: [],
  gender: null,
};

/** Budget steps offered in the filter sheet. */
export const BUDGET_STEPS = [5000, 8000, 10000, 12000, 15000, 20000, 25000] as const;

export const MOVE_IN_FILTERS: ReadonlyArray<{ value: MoveInFilter; label: string }> = [
  { value: "immediate", label: "Within a month" },
  { value: "next_month", label: "By next month" },
  { value: "next_semester", label: "Next semester" },
  { value: "july", label: "By July" },
];
export const ROOM_FILTERS: ReadonlyArray<{ value: RoomFilter; label: string }> = [
  { value: "private", label: "Own room" },
  { value: "shared", label: "Shared room" },
];
export const GENDER_FILTERS: ReadonlyArray<{ value: GenderFilter; label: string }> = [
  { value: "female", label: "Women" },
  { value: "male", label: "Men" },
];

type Params = Record<string, string | string[] | undefined>;

function all(params: Params, key: string): string[] {
  const value = params[key];
  return Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
}
function one(params: Params, key: string): string | null {
  return all(params, key)[0] ?? null;
}
function pick<T extends string>(allowed: readonly T[], values: string[]): T[] {
  return [...new Set(values)].filter((value): value is T => (allowed as readonly string[]).includes(value));
}
function rupees(value: string | null): number | null {
  if (!value || !/^\d{4,6}$/.test(value)) {
    return null;
  }
  const amount = Number(value);
  return amount >= 1000 && amount <= 200000 ? amount : null;
}
function oneOf<T extends string>(options: ReadonlyArray<{ value: T }>, value: string | null): T | null {
  return options.find((option) => option.value === value)?.value ?? null;
}

/**
 * Read filters from the address, ignoring anything invalid:
 * `?society=Estancia&society=Akshaya&min=6000&max=15000&move=next_month`
 * `&room=private&bhk=2BHK&amenity=AC&gender=female`.
 * The old `?budget=` (a maximum) still works.
 */
export function parseFilters(params: Params): FeedFilters {
  let budgetMin = rupees(one(params, "min"));
  const budgetMax = rupees(one(params, "max")) ?? rupees(one(params, "budget"));
  if (budgetMin !== null && budgetMax !== null && budgetMin > budgetMax) {
    budgetMin = null;
  }
  return {
    societies: pick(SOCIETIES, all(params, "society")),
    budgetMin,
    budgetMax,
    moveIn: oneOf(MOVE_IN_FILTERS, one(params, "move")),
    roomType: oneOf(ROOM_FILTERS, one(params, "room")),
    bhk: pick(BHK_TYPES, all(params, "bhk")),
    amenities: pick(AMENITIES, all(params, "amenity")),
    gender: oneOf(GENDER_FILTERS, one(params, "gender")),
  };
}

/** The address query for a set of filters ("" when there are none). */
export function filtersToQuery(filters: FeedFilters): string {
  const query = new URLSearchParams();
  filters.societies.forEach((society) => query.append("society", society));
  if (filters.budgetMin !== null) query.set("min", String(filters.budgetMin));
  if (filters.budgetMax !== null) query.set("max", String(filters.budgetMax));
  if (filters.moveIn) query.set("move", filters.moveIn);
  if (filters.roomType) query.set("room", filters.roomType);
  filters.bhk.forEach((bhk) => query.append("bhk", bhk));
  filters.amenities.forEach((amenity) => query.append("amenity", amenity));
  if (filters.gender) query.set("gender", filters.gender);
  return query.toString();
}

/** What the database function expects. */
export function filtersToRpc(filters: FeedFilters): Record<string, unknown> {
  return {
    societies: filters.societies,
    budget_min: filters.budgetMin,
    budget_max: filters.budgetMax,
    move_in: filters.moveIn,
    room_type: filters.roomType,
    bhk: filters.bhk,
    amenities: filters.amenities,
    gender: filters.gender,
  };
}

function inr(amount: number): string {
  return amount % 1000 === 0 ? `₹${amount / 1000}k` : `₹${amount.toLocaleString("en-IN")}`;
}

/** One removable pill per active filter value. */
export function activeFilters(filters: FeedFilters): Array<{ key: string; label: string; without: FeedFilters }> {
  const pills: Array<{ key: string; label: string; without: FeedFilters }> = [];
  for (const society of filters.societies) {
    pills.push({
      key: `society:${society}`,
      label: society,
      without: { ...filters, societies: filters.societies.filter((item) => item !== society) },
    });
  }
  if (filters.budgetMin !== null || filters.budgetMax !== null) {
    const label =
      filters.budgetMin !== null && filters.budgetMax !== null
        ? `${inr(filters.budgetMin)}–${inr(filters.budgetMax)}`
        : filters.budgetMax !== null
          ? `Up to ${inr(filters.budgetMax)}`
          : `From ${inr(filters.budgetMin as number)}`;
    pills.push({ key: "budget", label, without: { ...filters, budgetMin: null, budgetMax: null } });
  }
  if (filters.moveIn) {
    pills.push({
      key: "move",
      label: MOVE_IN_FILTERS.find((option) => option.value === filters.moveIn)?.label ?? filters.moveIn,
      without: { ...filters, moveIn: null },
    });
  }
  if (filters.roomType) {
    pills.push({
      key: "room",
      label: ROOM_FILTERS.find((option) => option.value === filters.roomType)?.label ?? filters.roomType,
      without: { ...filters, roomType: null },
    });
  }
  for (const bhk of filters.bhk) {
    pills.push({ key: `bhk:${bhk}`, label: bhk, without: { ...filters, bhk: filters.bhk.filter((item) => item !== bhk) } });
  }
  for (const amenity of filters.amenities) {
    pills.push({
      key: `amenity:${amenity}`,
      label: amenity,
      without: { ...filters, amenities: filters.amenities.filter((item) => item !== amenity) },
    });
  }
  if (filters.gender) {
    pills.push({
      key: "gender",
      label: GENDER_FILTERS.find((option) => option.value === filters.gender)?.label ?? filters.gender,
      without: { ...filters, gender: null },
    });
  }
  return pills;
}
