"use client";

import { EyeOff } from "lucide-react";

import { savePractical } from "@/app/profile/edit/actions";
import { SaveBar, SectionIntro, useSectionSave } from "@/components/profile/use-section-save";
import { ChipGroup, TextField, asOptions } from "@/components/ui/fields";
import { GENDER_PREFERENCES, ROOM_TYPES } from "@/lib/constants/preferences";
import { AMENITIES, BHK_TYPES, MOVE_IN_TIMEFRAMES, SOCIETIES } from "@/lib/constants/prompts";
import type { PracticalInput } from "@/lib/profile-validation";
import type { PracticalPreferencesRow } from "@/types/database";

type Saved = Omit<PracticalPreferencesRow, "profile_id" | "created_at" | "updated_at">;

/** Budget, places and requirements. Everything is optional. */
export function PracticalSection({
  initial,
  onDirtyChange,
}: {
  initial: Saved | null;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const section = useSectionSave<PracticalInput>(
    {
      budget_min: initial?.budget_min != null ? String(initial.budget_min) : "",
      budget_max: initial?.budget_max != null ? String(initial.budget_max) : "",
      preferred_societies: initial?.preferred_societies ?? [],
      move_in_timeframe: initial?.move_in_timeframe ?? null,
      room_type: initial?.room_type ?? null,
      preferred_bhk_types: initial?.preferred_bhk_types ?? [],
      required_amenities: initial?.required_amenities ?? [],
      flatmate_gender: initial?.flatmate_gender ?? null,
    },
    savePractical,
    onDirtyChange,
  );
  const { value, update, problems } = section;
  const set = <K extends keyof PracticalInput>(field: K, next: PracticalInput[K]) =>
    update((current) => ({ ...current, [field]: next }));

  return (
    <section aria-labelledby="practical-heading">
      <SectionIntro id="practical-heading" title="Flat needs">
        What you need from a place. Leave anything blank if you don&apos;t mind.
      </SectionIntro>

      <p className="bg-forest-soft text-charcoal mb-6 flex gap-2 rounded-2xl p-3 text-sm leading-relaxed">
        <EyeOff aria-hidden="true" className="text-forest mt-0.5 size-4 shrink-0" />
        <span>
          Your profile shows your preferred societies, maximum budget and move-in time. Your
          minimum budget, room, flat size, amenities and flatmate preference stay private.
        </span>
      </p>

      <div className="space-y-6">
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">Monthly budget per person (₹)</legend>
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Minimum"
              inputMode="numeric"
              placeholder="e.g. 8000"
              value={value.budget_min ?? ""}
              onChange={(event) => set("budget_min", event.target.value.replace(/[^\d]/g, ""))}
              error={problems.budget_min}
            />
            <TextField
              label="Maximum"
              inputMode="numeric"
              placeholder="e.g. 15000"
              value={value.budget_max ?? ""}
              onChange={(event) => set("budget_max", event.target.value.replace(/[^\d]/g, ""))}
              error={problems.budget_max}
            />
          </div>
          <p className="text-muted mt-1.5 text-sm">Rent plus maintenance, whole rupees.</p>
        </fieldset>

        <ChipGroup
          label="Societies you'd live in"
          options={asOptions(SOCIETIES)}
          value={value.preferred_societies}
          onChange={(next) => set("preferred_societies", next)}
          error={problems.preferred_societies}
        />
        <ChipGroup
          label="When you want to move in"
          multiple={false}
          clearable
          options={MOVE_IN_TIMEFRAMES}
          value={value.move_in_timeframe ? [value.move_in_timeframe] : []}
          onChange={(next) => set("move_in_timeframe", next[0] ?? null)}
          error={problems.move_in_timeframe}
        />
        <ChipGroup
          label="Room"
          multiple={false}
          clearable
          options={ROOM_TYPES}
          value={value.room_type ? [value.room_type] : []}
          onChange={(next) => set("room_type", next[0] ?? null)}
          error={problems.room_type}
        />
        <ChipGroup
          label="Flat size"
          options={asOptions(BHK_TYPES)}
          value={value.preferred_bhk_types}
          onChange={(next) => set("preferred_bhk_types", next)}
          error={problems.preferred_bhk_types}
        />
        <ChipGroup
          label="Must-have amenities"
          options={asOptions(AMENITIES)}
          value={value.required_amenities}
          onChange={(next) => set("required_amenities", next)}
          error={problems.required_amenities}
        />
        <ChipGroup
          label="Flatmates you'd live with"
          multiple={false}
          clearable
          options={GENDER_PREFERENCES}
          value={value.flatmate_gender ? [value.flatmate_gender] : []}
          onChange={(next) => set("flatmate_gender", next[0] ?? null)}
          error={problems.flatmate_gender}
        />
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
