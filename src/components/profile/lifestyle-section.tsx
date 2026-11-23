"use client";

import { Check } from "lucide-react";

import { saveLifestyle } from "@/app/profile/edit/actions";
import { SaveBar, SectionIntro, useSectionSave } from "@/components/profile/use-section-save";
import { ChipGroup } from "@/components/ui/fields";
import {
  LIFESTYLE_QUESTIONS,
  LIFESTYLE_WISHES,
  type LifestyleQuestionKey,
} from "@/lib/constants/preferences";
import type { Lifestyle } from "@/lib/profile-validation";

/** The questions, in three short groups rather than one long form. */
const GROUPS: Array<{ title: string; keys: LifestyleQuestionKey[] }> = [
  { title: "Daily rhythm", keys: ["sleep_schedule", "study_habits", "noise_tolerance"] },
  { title: "At home", keys: ["cleanliness", "guests", "social_life"] },
  { title: "About you", keys: ["personality", "smoking", "food_habits"] },
];

const EMPTY: Lifestyle = {
  sleep_schedule: null,
  study_habits: null,
  noise_tolerance: null,
  cleanliness: null,
  guests: null,
  social_life: null,
  personality: null,
  smoking: null,
  food_habits: null,
  cleaning_rota: null,
  guest_notice: null,
};

/**
 * How the student lives. Every question is optional: tap an answer to pick
 * it, tap it again to clear it.
 */
export function LifestyleSection({
  initial,
  onDirtyChange,
}: {
  initial: Partial<Lifestyle> | null;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const section = useSectionSave<Lifestyle>(
    { ...EMPTY, ...initial },
    (value) => saveLifestyle(value),
    onDirtyChange,
  );
  const answers = section.value;
  const answered = LIFESTYLE_QUESTIONS.filter(({ key }) => answers[key] !== null).length;

  return (
    <section aria-labelledby="lifestyle-heading">
      <SectionIntro id="lifestyle-heading" title="Lifestyle">
        How you actually live, so flatmates know what to expect. Answer what you like and
        skip the rest ({answered}/{LIFESTYLE_QUESTIONS.length} answered).
      </SectionIntro>

      <div className="space-y-6">
        {GROUPS.map((group) => (
          <div key={group.title} className="bg-surface border-line rounded-card space-y-5 border p-4">
            <h3 className="font-display text-lg font-semibold">{group.title}</h3>
            {group.keys.map((key) => {
              const question = LIFESTYLE_QUESTIONS.find((item) => item.key === key)!;
              const current = answers[key];
              return (
                <ChipGroup
                  key={key}
                  label={question.question}
                  multiple={false}
                  clearable
                  options={question.options}
                  value={current ? [current] : []}
                  onChange={(next) =>
                    section.update((value) => ({ ...value, [key]: next[0] ?? null }))
                  }
                  error={section.problems[key]}
                />
              );
            })}
            {group.title === "At home" && (
              <fieldset>
                <legend className="mb-2 text-sm font-semibold">House wishes</legend>
                <div className="flex flex-wrap gap-2">
                  {LIFESTYLE_WISHES.map((wish) => {
                    const on = answers[wish.key] === true;
                    return (
                      <button
                        key={wish.key}
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          section.update((value) => ({ ...value, [wish.key]: on ? null : true }))
                        }
                        className={`focus-visible:outline-accent inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-left text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 ${
                          on
                            ? "bg-forest text-cream border-forest"
                            : "bg-surface border-line hover:border-charcoal/40"
                        }`}
                      >
                        {on && <Check aria-hidden="true" className="size-4" />}
                        {wish.label}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            )}
          </div>
        ))}
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
