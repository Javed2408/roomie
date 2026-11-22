/** Discovery filters: safe to use in the browser and on the server. */

import { SOCIETIES, type Society } from "@/lib/constants/prompts";
import type { Gender } from "@/types/database";

/** The filter bar's choices, as read from the page address. */
export type FeedFilters = {
  society: Society | null;
  /** Monthly rupees: flats costing at most this, or hunters budgeting at most this. */
  maxBudget: number | null;
  gender: Exclude<Gender, "other"> | null;
  srmOnly: boolean;
};

export const BUDGET_STEPS = [8000, 12000, 16000, 20000] as const;

/** Read filters from `?society=&budget=&gender=&srm=1`, ignoring junk. */
export function parseFilters(
  params: Record<string, string | string[] | undefined>,
): FeedFilters {
  const one = (key: string) => {
    const value = params[key];
    return typeof value === "string" ? value : null;
  };
  const society = one("society");
  const budget = Number(one("budget"));
  const gender = one("gender");
  return {
    society: SOCIETIES.find((item) => item === society) ?? null,
    maxBudget: BUDGET_STEPS.find((step) => step === budget) ?? null,
    gender: gender === "male" || gender === "female" ? gender : null,
    srmOnly: one("srm") === "1",
  };
}
