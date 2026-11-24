/**
 * The rules for a group's details, used by the group form in the browser
 * and again on the server. The database's CHECK constraints are the final
 * safety net. Only the name is required; everything else is optional.
 *
 * Plain module with relative imports, so it can be tested directly.
 */

import {
  GENDER_PREFERENCES,
  GROUP_SIZE,
  GROUP_STATUSES,
  HOUSING_STATUSES,
  ROOM_TYPES,
} from "./constants/preferences.ts";
import { BHK_TYPES, MOVE_IN_TIMEFRAMES, SOCIETIES } from "./constants/prompts.ts";

export type GroupForm = {
  name: string;
  description: string;
  avatar_url: string | null;
  max_members: string | number;
  preferred_gender: string;
  requirements: string;
  lifestyle_notes: string;
  housing_status: string | null;
  preferred_societies: string[];
  budget_min: string | number;
  budget_max: string | number;
  move_in_timeframe: string | null;
  preferred_bhk_types: string[];
  room_preference: string | null;
  is_discoverable: boolean;
  /** Editing only. */
  status?: string;
};

export type GroupValues = {
  name: string;
  description: string | null;
  avatar_url: string | null;
  max_members: number;
  preferred_gender: (typeof GENDER_PREFERENCES)[number]["value"];
  requirements: string | null;
  lifestyle_notes: string | null;
  housing_status: (typeof HOUSING_STATUSES)[number]["value"] | null;
  preferred_societies: Array<(typeof SOCIETIES)[number]>;
  budget_min: number | null;
  budget_max: number | null;
  move_in_timeframe: (typeof MOVE_IN_TIMEFRAMES)[number]["value"] | null;
  preferred_bhk_types: Array<(typeof BHK_TYPES)[number]>;
  room_preference: (typeof ROOM_TYPES)[number]["value"] | null;
  is_discoverable: boolean;
  status?: (typeof GROUP_STATUSES)[number]["value"];
};

export type Problems = Record<string, string>;

export const GROUP_STEPS = [
  { id: "identity", label: "Name & photo", fields: ["name", "avatar_url"] },
  { id: "about", label: "About", fields: ["description"] },
  {
    id: "housing",
    label: "Housing",
    fields: ["housing_status", "preferred_societies", "budget_min", "budget_max", "move_in_timeframe", "preferred_bhk_types", "room_preference"],
  },
  { id: "people", label: "People & lifestyle", fields: ["max_members", "preferred_gender", "requirements", "lifestyle_notes"] },
  { id: "visibility", label: "Visibility", fields: ["is_discoverable", "status"] },
] as const;
export type GroupStep = (typeof GROUP_STEPS)[number]["id"];

export function firstGroupStepWithProblem(problems: Problems): GroupStep | null {
  return GROUP_STEPS.find((step) => step.fields.some((field) => problems[field]))?.id ?? null;
}

export const EMPTY_GROUP_FORM: GroupForm = {
  name: "",
  description: "",
  avatar_url: null,
  max_members: 4,
  preferred_gender: "any",
  requirements: "",
  lifestyle_notes: "",
  housing_status: null,
  preferred_societies: [],
  budget_min: "",
  budget_max: "",
  move_in_timeframe: null,
  preferred_bhk_types: [],
  room_preference: null,
  is_discoverable: true,
};

const isOneOf = <T extends string>(allowed: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (allowed as readonly string[]).includes(value);
const valuesOf = <T extends string>(options: ReadonlyArray<{ value: T }>) => options.map((option) => option.value);
const optional = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

/** An optional amount in whole rupees; blank means "not set". */
function optionalAmount(value: unknown): { amount: number | null; valid: boolean } {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.replace(/[,\s₹]/g, "") : "";
  if (!text) return { amount: null, valid: true };
  if (!/^\d{1,6}$/.test(text)) return { amount: null, valid: false };
  const amount = Number(text);
  return { amount, valid: amount >= 1000 && amount <= 200000 };
}

/** Check a group's details. `memberCount` stops shrinking below the current members. */
export function validateGroup(
  input: Partial<GroupForm>,
  { memberCount = 1 }: { memberCount?: number } = {},
): { value: GroupValues; problems: Problems } {
  const problems: Problems = {};
  const text = (key: keyof GroupForm, max: number) => {
    const value = optional(input[key]);
    if (value && value.length > max) problems[key] = `Keep it to ${max} characters.`;
    return value;
  };

  const name = optional(input.name) ?? "";
  if (name.length < 2 || name.length > 60) {
    problems.name = "Give the group a name (2 to 60 characters).";
  }
  const description = text("description", 500);
  const requirements = text("requirements", 500);
  const lifestyle_notes = text("lifestyle_notes", 500);

  const sizeText = String(input.max_members ?? "").trim();
  const size = /^\d{1,2}$/.test(sizeText) ? Number(sizeText) : NaN;
  if (!(size >= GROUP_SIZE.min && size <= GROUP_SIZE.max)) {
    problems.max_members = `Choose ${GROUP_SIZE.min} to ${GROUP_SIZE.max} people.`;
  } else if (size < memberCount) {
    problems.max_members = `The group already has ${memberCount} members.`;
  }

  const gender = input.preferred_gender ?? "any";
  if (!isOneOf(valuesOf(GENDER_PREFERENCES), gender)) {
    problems.preferred_gender = "Choose an option from the list.";
  }
  const housing = input.housing_status ?? null;
  if (housing !== null && !isOneOf(valuesOf(HOUSING_STATUSES), housing)) {
    problems.housing_status = "Choose an option from the list.";
  }
  const societies = [...new Set(input.preferred_societies ?? [])];
  if (!societies.every((item) => isOneOf(SOCIETIES, item))) {
    problems.preferred_societies = "Choose societies from the list.";
  }
  const min = optionalAmount(input.budget_min);
  const max = optionalAmount(input.budget_max);
  if (!min.valid) problems.budget_min = "Enter ₹1,000 to ₹2,00,000, or leave it empty.";
  if (!max.valid) problems.budget_max = "Enter ₹1,000 to ₹2,00,000, or leave it empty.";
  if (min.valid && max.valid && min.amount !== null && max.amount !== null && min.amount > max.amount) {
    problems.budget_min = "The minimum can't be more than the maximum.";
  }
  const moveIn = input.move_in_timeframe ?? null;
  if (moveIn !== null && !isOneOf(valuesOf(MOVE_IN_TIMEFRAMES), moveIn)) {
    problems.move_in_timeframe = "Choose an option from the list.";
  }
  const bhk = [...new Set(input.preferred_bhk_types ?? [])];
  if (!bhk.every((item) => isOneOf(BHK_TYPES, item))) {
    problems.preferred_bhk_types = "Choose flat sizes from the list.";
  }
  const room = input.room_preference ?? null;
  if (room !== null && !isOneOf(valuesOf(ROOM_TYPES), room)) {
    problems.room_preference = "Choose an option from the list.";
  }
  if (input.status !== undefined && !isOneOf(valuesOf(GROUP_STATUSES), input.status)) {
    problems.status = "Choose a status from the list.";
  }

  return {
    value: {
      name,
      description,
      avatar_url: optional(input.avatar_url),
      max_members: Number.isFinite(size) ? size : 4,
      preferred_gender: gender as GroupValues["preferred_gender"],
      requirements,
      lifestyle_notes,
      housing_status: housing as GroupValues["housing_status"],
      preferred_societies: societies as GroupValues["preferred_societies"],
      budget_min: min.amount,
      budget_max: max.amount,
      move_in_timeframe: moveIn as GroupValues["move_in_timeframe"],
      preferred_bhk_types: bhk as GroupValues["preferred_bhk_types"],
      room_preference: room as GroupValues["room_preference"],
      is_discoverable: input.is_discoverable !== false,
      ...(input.status !== undefined ? { status: input.status as GroupValues["status"] } : {}),
    },
    problems,
  };
}

/** The form's starting values for an existing group. */
export function formFromGroup(group: Omit<GroupValues, "status"> & { status: string }): GroupForm {
  return {
    name: group.name,
    description: group.description ?? "",
    avatar_url: group.avatar_url,
    max_members: String(group.max_members),
    preferred_gender: group.preferred_gender,
    requirements: group.requirements ?? "",
    lifestyle_notes: group.lifestyle_notes ?? "",
    housing_status: group.housing_status,
    preferred_societies: [...group.preferred_societies],
    budget_min: group.budget_min === null ? "" : String(group.budget_min),
    budget_max: group.budget_max === null ? "" : String(group.budget_max),
    move_in_timeframe: group.move_in_timeframe,
    preferred_bhk_types: [...group.preferred_bhk_types],
    room_preference: group.room_preference,
    is_discoverable: group.is_discoverable,
    status: group.status,
  };
}

/** A short optional message with an invitation or request: 300 characters. */
export function validateMessage(value: unknown): { value: string | null; problem: string | null } {
  const message = optional(value);
  return message && message.length > 300
    ? { value: message, problem: "Keep your message to 300 characters." }
    : { value: message, problem: null };
}

/** "₹6k–₹12k", "Up to ₹12k", "From ₹6k", or null. */
export function budgetRangeLabel(min: number | null, max: number | null): string | null {
  const k = (amount: number) => (amount % 1000 === 0 ? `₹${amount / 1000}k` : `₹${amount.toLocaleString("en-IN")}`);
  if (min !== null && max !== null) return min === max ? k(min) : `${k(min)}–${k(max)}`;
  if (max !== null) return `Up to ${k(max)}`;
  if (min !== null) return `From ${k(min)}`;
  return null;
}
