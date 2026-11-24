"use client";

import { SlidersHorizontal, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { ChipGroup } from "@/components/ui/fields";
import { SOCIETIES } from "@/lib/constants/prompts";
import {
  activeGroupFilters,
  GROUP_HOUSING,
  GROUP_MOVE_IN,
  groupFiltersToQuery,
  NO_GROUP_FILTERS,
  type GroupFilterState,
} from "@/lib/group-filters";

const ANY = "any";
const BUDGETS = [5000, 8000, 10000, 12000, 15000, 20000];
const budgetOptions = [{ value: ANY, label: "Any" }, ...BUDGETS.map((step) => ({ value: String(step), label: `₹${step / 1000}k` }))];
const sizeOptions = Array.from({ length: 9 }, (_, index) => ({ value: String(index + 2), label: String(index + 2) }));

/** Filters for the Groups list, in the address so refresh and back keep them. */
export function GroupFilterBar({ filters }: { filters: GroupFilterState }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(filters);
  const pills = activeGroupFilters(filters);
  const go = (next: GroupFilterState) => {
    setOpen(false);
    const query = groupFiltersToQuery(next);
    router.push(query ? `/groups?${query}` : "/groups");
  };
  const set = (change: Partial<GroupFilterState>) => setDraft((current) => ({ ...current, ...change }));
  const single = (value: string | undefined) => (value && value !== ANY ? value : null);

  return (
    <>
      <div className="-mx-5 mb-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button
          type="button"
          onClick={() => {
            setDraft(filters);
            setOpen(true);
          }}
          className="bg-charcoal text-cream focus-visible:outline-accent inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <SlidersHorizontal aria-hidden="true" className="size-4" />
          Filters{pills.length > 0 ? ` (${pills.length})` : ""}
        </button>
        {pills.map((pill) => (
          <button
            key={pill.key}
            type="button"
            onClick={() => go(pill.without)}
            aria-label={`Remove filter: ${pill.label}`}
            className="bg-surface border-line hover:border-charcoal/40 focus-visible:outline-accent inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full border px-3.5 text-sm font-medium focus-visible:outline-2"
          >
            {pill.label}
            <X aria-hidden="true" className="size-3.5" />
          </button>
        ))}
      </div>

      {open && (
        <BottomSheet
          title="Filter groups"
          onClose={() => setOpen(false)}
          footer={
            <div className="grid grid-cols-2 gap-3">
              <Button variant="secondary" onClick={() => setDraft(NO_GROUP_FILTERS)}>
                Reset
              </Button>
              <Button onClick={() => go(draft)}>Show groups</Button>
            </div>
          }
        >
          <p className="text-muted mb-5 text-sm">Groups that haven&apos;t said still show.</p>
          <div className="space-y-6">
            <ChipGroup
              label="Societies"
              options={SOCIETIES.map((society) => ({ value: society, label: society }))}
              value={draft.societies}
              onChange={(societies) => set({ societies })}
            />
            <ChipGroup
              label="Your budget: up to"
              options={budgetOptions}
              multiple={false}
              value={[draft.budgetMax !== null ? String(draft.budgetMax) : ANY]}
              onChange={([value]) => set({ budgetMax: single(value) ? Number(value) : null })}
            />
            <ChipGroup
              label="Moving in"
              options={[{ value: ANY, label: "Any" }, ...GROUP_MOVE_IN]}
              multiple={false}
              value={[draft.moveIn ?? ANY]}
              onChange={([value]) => set({ moveIn: single(value) })}
            />
            <ChipGroup
              label="Group size"
              options={sizeOptions}
              value={draft.sizes.map(String)}
              onChange={(sizes) => set({ sizes: sizes.map(Number).sort((a, b) => a - b) })}
            />
            <ChipGroup
              label="Housing"
              options={[{ value: ANY, label: "Any" }, ...GROUP_HOUSING]}
              multiple={false}
              value={[draft.housing ?? ANY]}
              onChange={([value]) => set({ housing: single(value) })}
            />
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-semibold">More</legend>
              {(
                [
                  ["hasRoom", "Has room for more members"],
                  ["quiet", "Quiet groups"],
                  ["smokeFree", "Smoke-free groups"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="bg-surface border-line flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-2xl border px-4 text-sm font-medium">
                  {label}
                  <input
                    type="checkbox"
                    checked={draft[key]}
                    onChange={(event) => set({ [key]: event.target.checked })}
                    className="accent-charcoal size-5"
                  />
                </label>
              ))}
              <p className="text-muted text-xs">Lifestyle filters use what members answered; groups without answers still show.</p>
            </fieldset>
          </div>
        </BottomSheet>
      )}
    </>
  );
}
