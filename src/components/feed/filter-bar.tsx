"use client";

import { ShieldCheck, SlidersHorizontal, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { ChipGroup } from "@/components/ui/fields";
import { SOCIETIES } from "@/lib/constants/prompts";
import { BUDGET_STEPS, type FeedFilters } from "@/lib/feed-filters";

const ANY = "any";

const SOCIETY_OPTIONS = [
  { value: ANY, label: "All" },
  ...SOCIETIES.filter((society) => society !== "Other").map((society) => ({
    value: society,
    label: society,
  })),
];
const BUDGET_OPTIONS = [
  { value: ANY, label: "Any" },
  ...BUDGET_STEPS.map((step) => ({
    value: String(step),
    label: `≤ ₹${step / 1000}k`,
  })),
];
const GENDER_OPTIONS = [
  { value: ANY, label: "All" },
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
];

function toQuery(filters: FeedFilters): string {
  const params = new URLSearchParams();
  if (filters.society) params.set("society", filters.society);
  if (filters.maxBudget) params.set("budget", String(filters.maxBudget));
  if (filters.gender) params.set("gender", filters.gender);
  if (filters.srmOnly) params.set("srm", "1");
  const query = params.toString();
  return query ? `/discover?${query}` : "/discover";
}

/**
 * The filters, kept in the page address so a refresh or the back button
 * keeps them. Active filters show as pills you can tap to remove.
 */
export function FilterBar({
  filters,
  budgetLabel,
}: {
  filters: FeedFilters;
  /** What the budget filter means for this user. */
  budgetLabel: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(filters);
  const titleId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const go = (next: FeedFilters) => {
    setOpen(false);
    router.push(toQuery(next));
  };

  const pills: Array<{ label: string; clear: Partial<FeedFilters> }> = [];
  if (filters.society) pills.push({ label: filters.society, clear: { society: null } });
  if (filters.maxBudget)
    pills.push({
      label: `≤ ₹${filters.maxBudget / 1000}k`,
      clear: { maxBudget: null },
    });
  if (filters.gender)
    pills.push({
      label: filters.gender === "male" ? "Male" : "Female",
      clear: { gender: null },
    });
  if (filters.srmOnly) pills.push({ label: "SRM verified", clear: { srmOnly: false } });

  return (
    <>
      <div className="-mx-5 mb-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button
          type="button"
          onClick={() => {
            setDraft(filters);
            setOpen(true);
          }}
          className="bg-charcoal text-cream focus-visible:outline-accent inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <SlidersHorizontal aria-hidden="true" className="size-4" />
          Filters{pills.length > 0 ? ` (${pills.length})` : ""}
        </button>
        {pills.map((pill) => (
          <button
            key={pill.label}
            type="button"
            onClick={() => go({ ...filters, ...pill.clear })}
            aria-label={`Remove filter: ${pill.label}`}
            className="bg-surface border-line hover:border-charcoal/40 inline-flex min-h-10 shrink-0 items-center gap-1 rounded-full border px-3.5 text-sm font-medium"
          >
            {pill.label}
            <X aria-hidden="true" className="size-3.5" />
          </button>
        ))}
        {pills.length === 0 && (
          <button
            type="button"
            onClick={() => go({ ...filters, srmOnly: true })}
            className="bg-surface border-line hover:border-charcoal/40 inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium"
          >
            <ShieldCheck aria-hidden="true" className="text-forest size-4" />
            SRM verified only
          </button>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <button
            type="button"
            aria-label="Close filters"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="bg-charcoal/50 absolute inset-0"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="bg-cream relative max-h-[85dvh] w-full max-w-[480px] overflow-y-auto rounded-t-[2rem] px-5 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-2xl"
          >
            <div className="bg-charcoal/15 mx-auto mb-4 h-1.5 w-12 rounded-full" />
            <h2 id={titleId} className="font-display mb-5 text-2xl font-semibold">
              Filters
            </h2>
            <div className="space-y-6">
              <ChipGroup
                label="Society"
                options={SOCIETY_OPTIONS}
                multiple={false}
                value={[draft.society ?? ANY]}
                onChange={([value]) =>
                  setDraft({
                    ...draft,
                    society:
                      SOCIETIES.find((society) => society === value) ?? null,
                  })
                }
              />
              <ChipGroup
                label={budgetLabel}
                options={BUDGET_OPTIONS}
                multiple={false}
                value={[draft.maxBudget ? String(draft.maxBudget) : ANY]}
                onChange={([value]) =>
                  setDraft({
                    ...draft,
                    maxBudget: value && value !== ANY ? Number(value) : null,
                  })
                }
              />
              <ChipGroup
                label="Gender"
                options={GENDER_OPTIONS}
                multiple={false}
                value={[draft.gender ?? ANY]}
                onChange={([value]) =>
                  setDraft({
                    ...draft,
                    gender: value === "male" || value === "female" ? value : null,
                  })
                }
              />
              <label className="bg-surface border-line flex min-h-14 cursor-pointer items-center justify-between gap-3 rounded-2xl border px-4">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <ShieldCheck aria-hidden="true" className="text-forest size-5" />
                  SRM verified only
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={draft.srmOnly}
                  onChange={(event) =>
                    setDraft({ ...draft, srmOnly: event.target.checked })
                  }
                  className="accent-forest size-5"
                />
              </label>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <Button
                variant="secondary"
                onClick={() =>
                  go({ society: null, maxBudget: null, gender: null, srmOnly: false })
                }
              >
                Reset
              </Button>
              <Button onClick={() => go(draft)}>Show people</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
