"use client";

import { saveBasics } from "@/app/profile/edit/actions";
import { SaveBar, SectionIntro, useSectionSave } from "@/components/profile/use-section-save";
import { SelectField, TextAreaField, TextField } from "@/components/ui/fields";
import { DEPARTMENTS } from "@/lib/constants/prompts";
import { ABOUT_MAX, type BasicsInput } from "@/lib/profile-validation";
import type { PublicProfile } from "@/types/database";

const YEAR_OPTIONS = [1, 2, 3, 4, 5].map((year) => ({
  value: String(year),
  label: `${year}${{ 1: "st", 2: "nd", 3: "rd" }[year] ?? "th"} year`,
}));

const GENDER_OPTIONS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
];

/** Name, course, year and a short introduction. Email stays private. */
export function AboutSection({
  profile,
  onDirtyChange,
}: {
  profile: PublicProfile;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const section = useSectionSave<BasicsInput>(
    {
      full_name: profile.full_name ?? "",
      gender: profile.gender ?? "",
      year_of_study: profile.year_of_study ? String(profile.year_of_study) : "",
      department: profile.department ?? "",
      about: profile.about ?? "",
    },
    saveBasics,
    onDirtyChange,
  );
  const { value, update, problems } = section;
  const set = (field: keyof BasicsInput, next: string) =>
    update((current) => ({ ...current, [field]: next }));

  return (
    <section aria-labelledby="about-heading">
      <SectionIntro id="about-heading" title="About you">
        The basics people see first. Your email is never shown to anyone.
      </SectionIntro>

      <div className="space-y-5">
        <TextField
          label="Name"
          autoComplete="name"
          maxLength={80}
          value={value.full_name}
          onChange={(event) => set("full_name", event.target.value)}
          error={problems.full_name}
        />
        <div>
          <TextField
            label="Course or department"
            list="editor-departments"
            maxLength={80}
            placeholder="e.g. CSE"
            value={value.department}
            onChange={(event) => set("department", event.target.value)}
            error={problems.department}
          />
          <datalist id="editor-departments">
            {DEPARTMENTS.map((department) => (
              <option key={department} value={department} />
            ))}
          </datalist>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <SelectField
            label="Year"
            options={YEAR_OPTIONS}
            placeholder="Choose"
            value={String(value.year_of_study)}
            onChange={(event) => set("year_of_study", event.target.value)}
            error={problems.year_of_study}
          />
          <SelectField
            label="Gender"
            options={GENDER_OPTIONS}
            placeholder="Choose"
            value={value.gender}
            onChange={(event) => set("gender", event.target.value)}
            error={problems.gender}
          />
        </div>
        <TextAreaField
          label="A little about you"
          maxLength={ABOUT_MAX}
          rows={4}
          placeholder="e.g. Second-year ECE, early riser, happiest with a clean kitchen and good filter coffee."
          value={value.about}
          onChange={(event) => set("about", event.target.value)}
          error={problems.about}
          hint={`Optional. ${value.about.length}/${ABOUT_MAX} characters.`}
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
