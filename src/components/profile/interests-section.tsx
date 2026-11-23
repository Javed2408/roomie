"use client";

import { X } from "lucide-react";

import { saveInterests } from "@/app/profile/edit/actions";
import { SaveBar, SectionIntro, useSectionSave } from "@/components/profile/use-section-save";
import { ChipGroup } from "@/components/ui/fields";
import { MAX_INTERESTS } from "@/lib/constants/preferences";
import type { InterestRow } from "@/types/database";

/** Pick up to ten interests from the catalogue in the database. */
export function InterestsSection({
  catalogue,
  initial,
  onDirtyChange,
}: {
  catalogue: InterestRow[];
  initial: string[];
  onDirtyChange: (dirty: boolean) => void;
}) {
  const section = useSectionSave<string[]>(initial, saveInterests, onDirtyChange);
  const selected = section.value;
  const full = selected.length >= MAX_INTERESTS;
  const labels = new Map(catalogue.map((interest) => [interest.slug, interest.label]));

  return (
    <section aria-labelledby="interests-heading">
      <SectionIntro id="interests-heading" title="Interests">
        Pick up to {MAX_INTERESTS} things you&apos;re into. They show on your profile and make
        great conversation starters.
      </SectionIntro>

      <div className="bg-surface border-line rounded-card mb-6 border p-4">
        <p className="text-sm font-semibold">
          Your interests{" "}
          <span className="text-muted font-normal">
            ({selected.length}/{MAX_INTERESTS})
          </span>
        </p>
        {selected.length === 0 ? (
          <p className="text-muted mt-2 text-sm">None yet. Tap some below.</p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {selected.map((slug) => (
              <li key={slug}>
                <button
                  type="button"
                  onClick={() => section.update((list) => list.filter((item) => item !== slug))}
                  aria-label={`Remove ${labels.get(slug) ?? slug}`}
                  className="bg-accent-soft text-accent-strong focus-visible:outline-accent inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-sm font-semibold focus-visible:outline-2"
                >
                  {labels.get(slug) ?? slug}
                  <X aria-hidden="true" className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ChipGroup
        label="All interests"
        options={catalogue.map((interest) => ({ value: interest.slug, label: interest.label }))}
        value={selected}
        onChange={(next) => section.update(next.slice(0, MAX_INTERESTS))}
        isDisabled={() => full}
        hint={full ? `That's ${MAX_INTERESTS}. Remove one to pick another.` : undefined}
        error={section.problems.interests}
      />

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
