"use client";

import { ChevronDown, Compass } from "lucide-react";
import { useState, useTransition } from "react";

import { saveDiscoverySettings } from "@/app/discover/actions";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { ChipGroup } from "@/components/ui/fields";
import { DISCOVER_HOUSING_OPTIONS, SEEKING_OPTIONS } from "@/lib/constants/preferences";
import type { DiscoverHousing, Seeking } from "@/types/database";

const labelOf = <T extends string>(options: ReadonlyArray<{ value: T; label: string }>, value: T) =>
  options.find((option) => option.value === value)?.label ?? value;

/** "Showing: Students with a place", the short form used in the header. */
export function discoverySummary(discover: DiscoverHousing): string {
  return discover === "both" ? "Everyone" : labelOf(DISCOVER_HOUSING_OPTIONS, discover);
}

/**
 * Whom you discover and how you'd like to live, editable right from
 * Discover. Saving reloads the feed with the new settings. Your own
 * housing doesn't limit who you can see.
 */
export function DiscoverSettings({
  discoverHousing,
  seeking,
  openInitially = false,
}: {
  discoverHousing: DiscoverHousing;
  seeking: Seeking;
  openInitially?: boolean;
}) {
  const [open, setOpen] = useState(openInitially);
  const [draft, setDraft] = useState({ discoverHousing, seeking });
  const [error, setError] = useState("");
  const [isSaving, startTransition] = useTransition();
  const changed = draft.discoverHousing !== discoverHousing || draft.seeking !== seeking;

  function save() {
    setError("");
    startTransition(async () => {
      const result = await saveDiscoverySettings(draft);
      if (result.ok) {
        setOpen(false);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setDraft({ discoverHousing, seeking });
          setError("");
          setOpen(true);
        }}
        className="bg-surface border-line hover:border-charcoal/40 focus-visible:outline-accent mb-3 inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border px-4 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <Compass aria-hidden="true" className="text-forest size-4 shrink-0" />
        <span className="truncate">
          <span className="text-muted">Showing: </span>
          <span className="font-semibold">{discoverySummary(discoverHousing)}</span>
        </span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0" />
        <span className="sr-only">. Change who you discover</span>
      </button>

      {open && (
        <BottomSheet
          title="Who you discover"
          onClose={() => setOpen(false)}
          footer={
            <div className="space-y-2">
              {error && (
                <p role="alert" className="text-accent-strong text-sm font-medium">
                  {error}
                </p>
              )}
              <Button fullWidth onClick={save} disabled={!changed || isSaving}>
                {isSaving ? "Saving…" : "Save and refresh"}
              </Button>
            </div>
          }
        >
          <p className="text-muted mb-5 text-sm leading-relaxed">
            Whatever your own housing, you choose who shows up. Change it any time.
          </p>
          <div className="space-y-6">
            <ChipGroup
              label="Show me"
              options={DISCOVER_HOUSING_OPTIONS}
              multiple={false}
              value={[draft.discoverHousing]}
              onChange={([value]) => value && setDraft((current) => ({ ...current, discoverHousing: value }))}
            />
            <ChipGroup
              label="I'm looking for"
              options={SEEKING_OPTIONS}
              multiple={false}
              value={[draft.seeking]}
              onChange={([value]) => value && setDraft((current) => ({ ...current, seeking: value }))}
              hint={
                draft.seeking === "group"
                  ? "Group discovery is coming in a later update. Until then, you can still browse individual students."
                  : undefined
              }
            />
          </div>
        </BottomSheet>
      )}
    </>
  );
}
