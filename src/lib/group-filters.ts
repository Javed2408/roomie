/**
 * Filters for the Groups list, kept in the page address. Every filter is
 * optional and only hides a group whose details clearly conflict.
 * Plain module, so it can be tested directly.
 */

import { SOCIETIES } from "./constants/prompts.ts";

export type GroupFilterState = {
  societies: string[];
  budgetMin: number | null;
  budgetMax: number | null;
  moveIn: string | null;
  sizes: number[];
  housing: string | null;
  hasRoom: boolean;
  quiet: boolean;
  smokeFree: boolean;
};

export const NO_GROUP_FILTERS: GroupFilterState = {
  societies: [],
  budgetMin: null,
  budgetMax: null,
  moveIn: null,
  sizes: [],
  housing: null,
  hasRoom: false,
  quiet: false,
  smokeFree: false,
};

export const GROUP_MOVE_IN = [
  { value: "immediate", label: "Now" },
  { value: "next_month", label: "Next month" },
  { value: "next_semester", label: "Next semester" },
  { value: "july", label: "July" },
] as const;
export const GROUP_HOUSING = [
  { value: "has_accommodation", label: "Has a place" },
  { value: "needs_accommodation", label: "Looking for a place" },
] as const;

type Params = Record<string, string | string[] | undefined>;
const all = (params: Params, key: string) => {
  const value = params[key];
  return Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
};
const one = (params: Params, key: string) => all(params, key)[0] ?? null;
const rupees = (value: string | null) =>
  value && /^\d{4,6}$/.test(value) && Number(value) <= 200000 ? Number(value) : null;

export function parseGroupFilters(params: Params): GroupFilterState {
  let budgetMin = rupees(one(params, "min"));
  const budgetMax = rupees(one(params, "max"));
  if (budgetMin !== null && budgetMax !== null && budgetMin > budgetMax) budgetMin = null;
  const moveIn = one(params, "move");
  const housing = one(params, "housing");
  return {
    societies: [...new Set(all(params, "society"))].filter((item) => (SOCIETIES as readonly string[]).includes(item)),
    budgetMin,
    budgetMax,
    moveIn: GROUP_MOVE_IN.some((item) => item.value === moveIn) ? moveIn : null,
    sizes: [...new Set(all(params, "size"))]
      .filter((item) => /^([2-9]|10)$/.test(item))
      .map(Number)
      .sort((a, b) => a - b),
    housing: GROUP_HOUSING.some((item) => item.value === housing) ? housing : null,
    hasRoom: one(params, "room") === "1",
    quiet: one(params, "quiet") === "1",
    smokeFree: one(params, "smokefree") === "1",
  };
}

export function groupFiltersToQuery(filters: GroupFilterState): string {
  const query = new URLSearchParams();
  filters.societies.forEach((society) => query.append("society", society));
  if (filters.budgetMin !== null) query.set("min", String(filters.budgetMin));
  if (filters.budgetMax !== null) query.set("max", String(filters.budgetMax));
  if (filters.moveIn) query.set("move", filters.moveIn);
  filters.sizes.forEach((size) => query.append("size", String(size)));
  if (filters.housing) query.set("housing", filters.housing);
  if (filters.hasRoom) query.set("room", "1");
  if (filters.quiet) query.set("quiet", "1");
  if (filters.smokeFree) query.set("smokefree", "1");
  return query.toString();
}

/** One removable pill per active filter. */
export function activeGroupFilters(filters: GroupFilterState): Array<{ key: string; label: string; without: GroupFilterState }> {
  const pills: Array<{ key: string; label: string; without: GroupFilterState }> = [];
  for (const society of filters.societies) {
    pills.push({ key: `society:${society}`, label: society, without: { ...filters, societies: filters.societies.filter((item) => item !== society) } });
  }
  if (filters.budgetMin !== null || filters.budgetMax !== null) {
    const k = (amount: number) => `₹${amount / 1000}k`;
    const label =
      filters.budgetMin !== null && filters.budgetMax !== null
        ? `${k(filters.budgetMin)}–${k(filters.budgetMax)}`
        : filters.budgetMax !== null
          ? `Up to ${k(filters.budgetMax)}`
          : `From ${k(filters.budgetMin as number)}`;
    pills.push({ key: "budget", label, without: { ...filters, budgetMin: null, budgetMax: null } });
  }
  if (filters.moveIn) {
    pills.push({ key: "move", label: GROUP_MOVE_IN.find((item) => item.value === filters.moveIn)?.label ?? filters.moveIn, without: { ...filters, moveIn: null } });
  }
  for (const size of filters.sizes) {
    pills.push({ key: `size:${size}`, label: `${size} people`, without: { ...filters, sizes: filters.sizes.filter((item) => item !== size) } });
  }
  if (filters.housing) {
    pills.push({ key: "housing", label: GROUP_HOUSING.find((item) => item.value === filters.housing)?.label ?? filters.housing, without: { ...filters, housing: null } });
  }
  if (filters.hasRoom) pills.push({ key: "room", label: "Has room", without: { ...filters, hasRoom: false } });
  if (filters.quiet) pills.push({ key: "quiet", label: "Quiet", without: { ...filters, quiet: false } });
  if (filters.smokeFree) pills.push({ key: "smokefree", label: "Smoke-free", without: { ...filters, smokeFree: false } });
  return pills;
}
