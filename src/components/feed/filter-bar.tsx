"use client";

import { SlidersHorizontal, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { ChipGroup } from "@/components/ui/fields";
import { AMENITIES, BHK_TYPES, SOCIETIES } from "@/lib/constants/prompts";
import {
  activeFilters,
  BUDGET_STEPS,
  EMPTY_FILTERS,
  filtersToQuery,
  GENDER_FILTERS,
  MOVE_IN_FILTERS,
  ROOM_FILTERS,
  type FeedFilters,
} from "@/lib/feed-filters";

const ANY = "any";
const withAny = <T extends string>(options: ReadonlyArray<{ value: T; label: string }>) => [
  { value: ANY, label: "Any" },
  ...options,
];
const budgetOptions = withAny(BUDGET_STEPS.map((step) => ({ value: String(step), label: `₹${step / 1000}k` })));
const asOptions = (values: readonly string[]) => values.map((value) => ({ value, label: value }));

function href(filters: FeedFilters, keep: string): string {
  const query = [filtersToQuery(filters), keep].filter(Boolean).join("&");
  return query ? `/discover?${query}` : "/discover";
}

/**
 * Filters live in the page address, so a refresh or the back button keeps
 * them. Each active filter is a pill you can tap to remove; the sheet
 * edits them all without leaving Discover.
 */
export function FilterBar({
  filters,
  keep = "",
}: {
  filters: FeedFilters;
  /** Other address parameters to keep, e.g. "people=1". */
  keep?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(filters);
  const pills = activeFilters(filters);
  const go = (next: FeedFilters) => {
    setOpen(false);
    router.push(href(next, keep));
  };
  const set = (change: Partial<FeedFilters>) => setDraft((current) => ({ ...current, ...change }));
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
        {pills.length > 1 && (
          <button
            type="button"
            onClick={() => go(EMPTY_FILTERS)}
            className="text-charcoal focus-visible:outline-accent inline-flex min-h-11 shrink-0 items-center rounded-full px-3 text-sm font-semibold underline underline-offset-4 focus-visible:outline-2"
          >
            Clear all
          </button>
        )}
      </div>

      {open && (
        <BottomSheet
          title="Filters"
          onClose={() => setOpen(false)}
          footer={
            <div className="grid grid-cols-2 gap-3">
              <Button variant="secondary" onClick={() => setDraft(EMPTY_FILTERS)}>
                Reset
              </Button>
              <Button onClick={() => go(draft)}>Show people</Button>
            </div>
          }
        >
          <p className="text-muted mb-5 text-sm leading-relaxed">
            Filters only hide people whose details clash. Someone who hasn&apos;t said still shows.
          </p>
          <div className="space-y-6">
            <ChipGroup
              label="Societies"
              options={asOptions(SOCIETIES)}
              value={draft.societies}
              onChange={(societies) => set({ societies: societies as FeedFilters["societies"] })}
            />
            <ChipGroup
              label="Monthly budget: from"
              options={budgetOptions}
              multiple={false}
              value={[draft.budgetMin !== null ? String(draft.budgetMin) : ANY]}
              isDisabled={(value) => value !== ANY && draft.budgetMax !== null && Number(value) > draft.budgetMax}
              onChange={([value]) => set({ budgetMin: single(value) ? Number(value) : null })}
            />
            <ChipGroup
              label="Monthly budget: up to"
              hint="A flat's rent plus maintenance, or what someone looking can spend."
              options={budgetOptions}
              multiple={false}
              value={[draft.budgetMax !== null ? String(draft.budgetMax) : ANY]}
              isDisabled={(value) => value !== ANY && draft.budgetMin !== null && Number(value) < draft.budgetMin}
              onChange={([value]) => set({ budgetMax: single(value) ? Number(value) : null })}
            />
            <ChipGroup
              label="Moving in"
              options={withAny(MOVE_IN_FILTERS)}
              multiple={false}
              value={[draft.moveIn ?? ANY]}
              onChange={([value]) => set({ moveIn: single(value) as FeedFilters["moveIn"] })}
            />
            <ChipGroup
              label="Room"
              options={withAny(ROOM_FILTERS)}
              multiple={false}
              value={[draft.roomType ?? ANY]}
              onChange={([value]) => set({ roomType: single(value) as FeedFilters["roomType"] })}
            />
            <ChipGroup
              label="Flat size"
              options={asOptions(BHK_TYPES)}
              value={draft.bhk}
              onChange={(bhk) => set({ bhk: bhk as FeedFilters["bhk"] })}
            />
            <ChipGroup
              label="Flat must have"
              hint="Only applies to students who've listed a flat."
              options={asOptions(AMENITIES)}
              value={draft.amenities}
              onChange={(amenities) => set({ amenities: amenities as FeedFilters["amenities"] })}
            />
            <ChipGroup
              label="Gender"
              options={withAny(GENDER_FILTERS)}
              multiple={false}
              value={[draft.gender ?? ANY]}
              onChange={([value]) => set({ gender: single(value) as FeedFilters["gender"] })}
            />
          </div>
        </BottomSheet>
      )}
    </>
  );
}
