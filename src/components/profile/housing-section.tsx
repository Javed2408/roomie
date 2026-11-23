"use client";

import { Info } from "lucide-react";
import { useId } from "react";

import { saveHousing } from "@/app/profile/edit/actions";
import { SaveBar, SectionIntro, useSectionSave } from "@/components/profile/use-section-save";
import {
  DISCOVER_HOUSING_OPTIONS,
  HOUSING_STATUSES,
  SEEKING_OPTIONS,
} from "@/lib/constants/preferences";
import type { HousingInput } from "@/lib/profile-validation";
import type { DiscoverHousing, HousingStatus, Seeking } from "@/types/database";

/** A short explanation under each option, per question. */
const STATUS_HINTS: Record<string, string> = {
  has_accommodation: "You live somewhere with space for a flatmate.",
  needs_accommodation: "You're looking for a place to live.",
};
const DISCOVER_HINTS: Record<string, string> = {
  has_accommodation: "People with a room or spot to share.",
  needs_accommodation: "People looking for somewhere to live.",
  both: "Everyone, whatever their housing.",
};
const SEEKING_HINTS: Record<string, string> = {
  flatmate: "One person to share with.",
  group: "Team up with others to rent together.",
  either: "Whatever works out.",
};

/** One choice from a list, shown as tappable cards (real radio buttons). */
function CardChoice<T extends string>({
  legend,
  options,
  hints,
  value,
  onChange,
  error,
}: {
  legend: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  hints: Record<string, string>;
  value: T | "";
  onChange: (value: T) => void;
  error?: string;
}) {
  const name = useId();
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold">{legend}</legend>
      <div className="grid gap-2">
        {options.map((option) => (
          <label
            key={option.value}
            className="border-line bg-surface has-[:checked]:border-charcoal has-[:checked]:bg-charcoal/[0.03] has-[:focus-visible]:outline-accent flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 has-[:focus-visible]:outline-2"
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="accent-charcoal size-5 shrink-0"
            />
            <span>
              <span className="block font-medium">{option.label}</span>
              {hints[option.value] && (
                <span className="text-muted block text-sm">{hints[option.value]}</span>
              )}
            </span>
          </label>
        ))}
      </div>
      {error && <p className="text-accent-strong mt-1.5 text-sm font-medium">{error}</p>}
    </fieldset>
  );
}

/**
 * Housing right now, and whom to discover. Editable any time. Changing
 * housing never touches listings, matches or messages, except that a
 * student can explicitly choose to hide their live listing.
 */
export function HousingSection({
  housing,
  discovery,
  liveListing,
  onDirtyChange,
}: {
  housing: HousingStatus | null;
  discovery: { discover_housing: DiscoverHousing; seeking: Seeking } | null;
  liveListing: { society: string; bhk_type: string } | null;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const section = useSectionSave<HousingInput>(
    {
      status: housing ?? "",
      // Without saved preferences, Discover shows everyone (013).
      discover_housing: discovery?.discover_housing ?? "both",
      seeking: discovery?.seeking ?? "either",
      hide_listings: false,
    },
    saveHousing,
    onDirtyChange,
  );
  const { value, update, problems } = section;
  const offersToHide = Boolean(liveListing) && value.status === "needs_accommodation";

  return (
    <section aria-labelledby="housing-heading">
      <SectionIntro id="housing-heading" title="Housing & discovery">
        Change these whenever your plans change. Nothing else on your profile is affected.
      </SectionIntro>

      <div className="space-y-6">
        <CardChoice
          legend="Your housing right now"
          options={HOUSING_STATUSES}
          hints={STATUS_HINTS}
          value={value.status as HousingStatus | ""}
          onChange={(status) =>
            update((current) => ({
              ...current,
              status,
              hide_listings: status === "needs_accommodation" ? current.hide_listings : false,
            }))
          }
          error={problems.status}
        />

        {offersToHide && (
          <div className="bg-accent-soft rounded-2xl p-4 text-sm leading-relaxed">
            <p className="font-semibold">Your flat listing is still live</p>
            <p className="mt-1">
              Your {liveListing!.society} {liveListing!.bhk_type} listing stays visible unless
              you hide it. You can hide or show it any time from your account.
            </p>
            <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 font-medium">
              <input
                type="checkbox"
                checked={value.hide_listings}
                onChange={(event) =>
                  update((current) => ({ ...current, hide_listings: event.target.checked }))
                }
                className="accent-charcoal size-5"
              />
              Also hide my listing
            </label>
          </div>
        )}

        <CardChoice
          legend="Who you want to discover"
          options={DISCOVER_HOUSING_OPTIONS}
          hints={DISCOVER_HINTS}
          value={value.discover_housing as DiscoverHousing}
          onChange={(discover) => update((current) => ({ ...current, discover_housing: discover }))}
          error={problems.discover_housing}
        />
        <CardChoice
          legend="How you'd like to live"
          options={SEEKING_OPTIONS}
          hints={SEEKING_HINTS}
          value={value.seeking as Seeking}
          onChange={(seeking) => update((current) => ({ ...current, seeking }))}
          error={problems.seeking}
        />

        <p className="text-muted flex gap-2 text-sm leading-relaxed">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          Discover shows exactly who you choose here, whatever your own housing. You can also
          change it from Discover. Group discovery is coming in a later update.
        </p>
      </div>

      <SaveBar
        dirty={section.dirty}
        isSaving={section.isSaving}
        status={section.status}
        error={section.error}
        onSave={() => section.submit()}
      />
    </section>
  );
}
