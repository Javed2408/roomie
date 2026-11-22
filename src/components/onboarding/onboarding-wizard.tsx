"use client";

import { ArrowLeft, DoorOpen, Search, type LucideIcon } from "lucide-react";
import { useRef, useState, useTransition } from "react";

import { saveOnboarding } from "@/app/onboarding/actions";
import {
  AvatarPicker,
  ListingPhotosPicker,
} from "@/components/onboarding/photo-pickers";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  ChipGroup,
  SelectField,
  TextAreaField,
  TextField,
  asOptions,
} from "@/components/ui/fields";
import {
  AMENITIES,
  BHK_TYPES,
  DEPARTMENTS,
  MAX_LISTING_PHOTOS,
  MAX_VACANT_SPOTS,
  MOVE_IN_TIMEFRAMES,
  PROMPT_ANSWER_MAX,
  PROMPTS,
  SOCIETIES,
  type Amenity,
  type Society,
} from "@/lib/constants/prompts";
import {
  checkBasics,
  checkListing,
  checkPreferences,
  checkPrompts,
  costs,
  formatInr,
  type ListingInput,
  type OnboardingInput,
  type PreferencesInput,
  type Problems,
} from "@/lib/onboarding";
import type { Gender, Mode } from "@/types/database";

// --- The draft: everything typed so far, as the inputs hold it -------------

export type Draft = {
  mode: Mode | "";
  full_name: string;
  gender: Gender | "";
  year_of_study: string;
  department: string;
  avatar_url: string | null;
  prompts: Array<{ question: string; answer: string }>;
  listing: {
    society: Society | "";
    bhk_type: string;
    vacant_spots: string;
    rent_per_person: string;
    maintenance_per_person: string;
    deposit_per_person: string;
    setup_cost: string;
    amenities: Amenity[];
    photos: string[];
  };
  preferences: {
    preferred_societies: Society[];
    max_budget: string;
    move_in_timeframe: string;
  };
};

/** "12000" -> 12000; "" -> fallback; anything else -> NaN (fails checks). */
function whole(value: string, fallback = Number.NaN): number {
  const trimmed = value.trim().replace(/,/g, "");
  if (!trimmed) {
    return fallback;
  }
  return /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

function toListing(draft: Draft): ListingInput {
  const l = draft.listing;
  return {
    society: l.society as Society,
    bhk_type: l.bhk_type as ListingInput["bhk_type"],
    vacant_spots: whole(l.vacant_spots),
    rent_per_person: whole(l.rent_per_person),
    maintenance_per_person: whole(l.maintenance_per_person, 0),
    deposit_per_person: whole(l.deposit_per_person, 0),
    setup_cost: whole(l.setup_cost, 0),
    amenities: l.amenities,
    photos: l.photos,
  };
}

function toPreferences(draft: Draft): PreferencesInput {
  return {
    preferred_societies: draft.preferences.preferred_societies,
    max_budget: whole(draft.preferences.max_budget),
    move_in_timeframe: draft.preferences
      .move_in_timeframe as PreferencesInput["move_in_timeframe"],
  };
}

function toInput(draft: Draft): OnboardingInput {
  return {
    mode: draft.mode as Mode,
    full_name: draft.full_name,
    gender: draft.gender as Gender,
    year_of_study: whole(draft.year_of_study),
    department: draft.department,
    avatar_url: draft.avatar_url,
    prompts: draft.prompts,
    listing: draft.mode === "have_flat" ? toListing(draft) : null,
    preferences: draft.mode === "need_flat" ? toPreferences(draft) : null,
  };
}

const STEPS = ["Intent", "About you", "Prompts", "Details"] as const;

const MODE_CHOICES: Array<{
  value: Mode;
  icon: LucideIcon;
  title: string;
  description: string;
}> = [
  {
    value: "have_flat",
    icon: DoorOpen,
    title: "I have a flat & need a flatmate",
    description: "List your flat, show the real costs and meet students who fit.",
  },
  {
    value: "need_flat",
    icon: Search,
    title: "I need a flat / flatmates",
    description: "Find a room in a flat you'll like, or people to rent one with.",
  },
];

const YEAR_OPTIONS = [1, 2, 3, 4, 5].map((year) => ({
  value: String(year),
  label: `${year}${{ 1: "st", 2: "nd", 3: "rd" }[year] ?? "th"} year`,
}));

const GENDER_OPTIONS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
] as const;

// --- Steps ------------------------------------------------------------------

type StepProps = {
  draft: Draft;
  update: (change: (draft: Draft) => Draft) => void;
  problems: Problems;
};

function IntentStep({
  draft,
  onChoose,
  problems,
}: {
  draft: Draft;
  onChoose: (mode: Mode) => void;
  problems: Problems;
}) {
  return (
    <div className="space-y-3">
      {MODE_CHOICES.map(({ value, icon: Icon, title, description }) => {
        const isOn = draft.mode === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={isOn}
            onClick={() => onChoose(value)}
            className={`rounded-card focus-visible:outline-accent w-full border-2 p-5 text-left transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-[0.98] ${
              isOn
                ? "border-charcoal bg-surface shadow-md"
                : "border-line bg-surface hover:border-charcoal/30"
            }`}
          >
            <span
              className={`flex size-12 items-center justify-center rounded-full ${
                isOn ? "bg-accent text-cream" : "bg-accent-soft text-accent-strong"
              }`}
            >
              <Icon aria-hidden="true" className="size-6" />
            </span>
            <span className="font-display mt-4 block text-xl font-semibold">
              {title}
            </span>
            <span className="text-muted mt-1 block text-sm leading-relaxed">
              {description}
            </span>
          </button>
        );
      })}
      {problems.mode && (
        <p role="alert" className="text-accent-strong text-sm font-medium">
          {problems.mode}
        </p>
      )}
    </div>
  );
}

function BasicsStep({
  draft,
  update,
  problems,
  userId,
}: StepProps & { userId: string }) {
  const set = (field: "full_name" | "department", value: string) =>
    update((current) => ({ ...current, [field]: value }));
  return (
    <div className="space-y-5">
      <AvatarPicker
        userId={userId}
        value={draft.avatar_url}
        onChange={(url) => update((current) => ({ ...current, avatar_url: url }))}
      />
      <TextField
        label="Full name"
        name="full_name"
        autoComplete="name"
        maxLength={80}
        value={draft.full_name}
        onChange={(event) => set("full_name", event.target.value)}
        error={problems.full_name}
      />
      <ChipGroup
        label="Gender"
        options={GENDER_OPTIONS}
        multiple={false}
        value={draft.gender ? [draft.gender] : []}
        onChange={([gender]) =>
          update((current) => ({ ...current, gender: gender ?? "" }))
        }
        error={problems.gender}
      />
      <SelectField
        label="Year of study"
        placeholder="Choose your year"
        options={YEAR_OPTIONS}
        value={draft.year_of_study}
        onChange={(event) =>
          update((current) => ({ ...current, year_of_study: event.target.value }))
        }
        error={problems.year_of_study}
      />
      <div>
        <TextField
          label="Department"
          name="department"
          list="departments"
          maxLength={80}
          placeholder="e.g. CSE"
          value={draft.department}
          onChange={(event) => set("department", event.target.value)}
          error={problems.department}
        />
        <datalist id="departments">
          {DEPARTMENTS.map((department) => (
            <option key={department} value={department} />
          ))}
        </datalist>
      </div>
    </div>
  );
}

function PromptsStep({ draft, update, problems }: StepProps) {
  function setPrompt(index: number, change: Partial<Draft["prompts"][number]>) {
    update((current) => ({
      ...current,
      prompts: current.prompts.map((prompt, position) =>
        position === index ? { ...prompt, ...change } : prompt,
      ),
    }));
  }
  return (
    <div className="space-y-4">
      {draft.prompts.map((prompt, index) => {
        const usedElsewhere = draft.prompts
          .filter((_, position) => position !== index)
          .map((item) => item.question);
        return (
          <Card key={index} className="space-y-3 p-5">
            <SelectField
              label={`Prompt ${index + 1}`}
              placeholder="Choose a prompt"
              options={asOptions(PROMPTS).filter(
                (option) => !usedElsewhere.includes(option.value),
              )}
              value={prompt.question}
              onChange={(event) =>
                setPrompt(index, { question: event.target.value })
              }
              error={problems[`prompt_${index}`]}
            />
            <TextAreaField
              label="Your answer"
              maxLength={PROMPT_ANSWER_MAX}
              placeholder="Keep it short and honest"
              value={prompt.answer}
              onChange={(event) => setPrompt(index, { answer: event.target.value })}
              error={problems[`answer_${index}`]}
              hint={`${prompt.answer.length}/${PROMPT_ANSWER_MAX}`}
            />
          </Card>
        );
      })}
    </div>
  );
}

function CostPreview({ draft }: { draft: Draft }) {
  const listing = toListing(draft);
  const safe = (value: number) => (Number.isFinite(value) ? value : 0);
  const amounts = {
    rent_per_person: safe(listing.rent_per_person),
    maintenance_per_person: safe(listing.maintenance_per_person),
    deposit_per_person: safe(listing.deposit_per_person),
    setup_cost: safe(listing.setup_cost),
  };
  const { monthly, moveIn } = costs(amounts);
  return (
    <div
      aria-live="polite"
      className="bg-forest-soft rounded-card grid grid-cols-2 gap-3 p-4"
    >
      <div>
        <p className="text-forest text-xs font-semibold tracking-wide uppercase">
          Monthly total
        </p>
        <p className="font-display mt-1 text-2xl font-semibold">
          {formatInr(monthly)}
        </p>
        <p className="text-muted text-xs">rent + maintenance</p>
      </div>
      <div>
        <p className="text-forest text-xs font-semibold tracking-wide uppercase">
          Move-in total
        </p>
        <p className="font-display mt-1 text-2xl font-semibold">
          {formatInr(moveIn)}
        </p>
        <p className="text-muted text-xs">first month + deposit + setup</p>
      </div>
    </div>
  );
}

function ListingStep({
  draft,
  update,
  problems,
  userId,
}: StepProps & { userId: string }) {
  const setListing = (change: Partial<Draft["listing"]>) =>
    update((current) => ({
      ...current,
      listing: { ...current.listing, ...change },
    }));
  const money = (
    field:
      | "rent_per_person"
      | "maintenance_per_person"
      | "deposit_per_person"
      | "setup_cost",
    label: string,
    hint?: string,
  ) => (
    <TextField
      label={label}
      inputMode="numeric"
      placeholder="₹0"
      value={draft.listing[field]}
      onChange={(event) =>
        setListing({ [field]: event.target.value.replace(/[^\d]/g, "") })
      }
      error={problems[field]}
      hint={hint}
    />
  );

  return (
    <div className="space-y-5">
      <SelectField
        label="Society"
        placeholder="Choose the society"
        options={asOptions(SOCIETIES)}
        value={draft.listing.society}
        onChange={(event) =>
          setListing({ society: event.target.value as Society | "" })
        }
        error={problems.society}
        hint="Only the society is shown, never your flat number."
      />
      <ChipGroup
        label="Flat size"
        options={asOptions(BHK_TYPES)}
        multiple={false}
        value={draft.listing.bhk_type ? [draft.listing.bhk_type] : []}
        onChange={([bhk]) => setListing({ bhk_type: bhk ?? "" })}
        error={problems.bhk_type}
      />
      <ChipGroup
        label="Vacant spots"
        options={Array.from({ length: MAX_VACANT_SPOTS }, (_, index) => ({
          value: String(index + 1),
          label: String(index + 1),
        }))}
        multiple={false}
        value={[draft.listing.vacant_spots]}
        onChange={([spots]) => setListing({ vacant_spots: spots ?? "1" })}
        error={problems.vacant_spots}
      />

      <fieldset className="space-y-4">
        <legend className="font-display mb-1 text-lg font-semibold">
          Cost breakdown (per person)
        </legend>
        <div className="grid grid-cols-2 gap-3">
          {money("rent_per_person", "Monthly rent")}
          {money("maintenance_per_person", "Maintenance / month")}
          {money("deposit_per_person", "Security deposit")}
          {money("setup_cost", "One-time setup", "Brokerage, furniture, etc.")}
        </div>
        <CostPreview draft={draft} />
      </fieldset>

      <ChipGroup
        label="Flat perks"
        options={asOptions(AMENITIES)}
        value={draft.listing.amenities}
        onChange={(amenities) => setListing({ amenities })}
        error={problems.amenities}
      />
      <ListingPhotosPicker
        userId={userId}
        value={draft.listing.photos}
        onChange={(photos) => setListing({ photos })}
        max={MAX_LISTING_PHOTOS}
      />
      {problems.photos && (
        <p role="alert" className="text-accent-strong text-sm font-medium">
          {problems.photos}
        </p>
      )}
    </div>
  );
}

function PreferencesStep({ draft, update, problems }: StepProps) {
  const setPreferences = (change: Partial<Draft["preferences"]>) =>
    update((current) => ({
      ...current,
      preferences: { ...current.preferences, ...change },
    }));
  return (
    <div className="space-y-5">
      <ChipGroup
        label="Societies you'd live in"
        options={asOptions(SOCIETIES)}
        value={draft.preferences.preferred_societies}
        onChange={(preferred_societies) => setPreferences({ preferred_societies })}
        error={problems.preferred_societies}
        hint="Pick all that work for you."
      />
      <TextField
        label="Max monthly budget (₹, per person)"
        inputMode="numeric"
        placeholder="e.g. 12000"
        value={draft.preferences.max_budget}
        onChange={(event) =>
          setPreferences({
            max_budget: event.target.value.replace(/[^\d]/g, ""),
          })
        }
        error={problems.max_budget}
        hint="Rent plus maintenance you can afford each month."
      />
      <ChipGroup
        label="When do you want to move in?"
        options={MOVE_IN_TIMEFRAMES}
        multiple={false}
        value={
          draft.preferences.move_in_timeframe
            ? [draft.preferences.move_in_timeframe]
            : []
        }
        onChange={([timeframe]) =>
          setPreferences({ move_in_timeframe: timeframe ?? "" })
        }
        error={problems.move_in_timeframe}
      />
    </div>
  );
}

// --- The wizard --------------------------------------------------------------

const HEADINGS = [
  { title: "What brings you to Roomie?", subtitle: "You can change this later." },
  { title: "About you", subtitle: "This is what other students see first." },
  {
    title: "Pick 3 prompts",
    subtitle: "Short, honest answers get the best matches.",
  },
  { title: "", subtitle: "" },
] as const;

export function OnboardingWizard({
  userId,
  initial,
  initialStep = 0,
  isEditing = false,
}: {
  userId: string;
  initial: Draft;
  initialStep?: number;
  isEditing?: boolean;
}) {
  const [draft, setDraft] = useState(initial);
  const [step, setStep] = useState(initialStep);
  const [problems, setProblems] = useState<Problems>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();
  const topRef = useRef<HTMLDivElement>(null);

  const update = (change: (current: Draft) => Draft) => {
    setDraft(change);
    setFormError(null);
  };

  function goTo(next: number) {
    setProblems({});
    setStep(next);
    topRef.current?.scrollIntoView({ block: "start" });
  }

  function problemsFor(current: number): Problems {
    const input = toInput(draft);
    if (current === 0) {
      return draft.mode ? {} : { mode: "Choose one to continue." };
    }
    if (current === 1) {
      return checkBasics(input);
    }
    if (current === 2) {
      return checkPrompts(input);
    }
    return draft.mode === "have_flat"
      ? checkListing(input.listing)
      : checkPreferences(input.preferences);
  }

  function next() {
    const found = problemsFor(step);
    setProblems(found);
    if (Object.keys(found).length > 0) {
      return;
    }
    if (step < STEPS.length - 1) {
      goTo(step + 1);
      return;
    }
    startSaving(async () => {
      const result = await saveOnboarding({
        ...toInput(draft),
        isFirstTime: !isEditing,
      });
      // On success the action redirects, so only failures come back.
      if (result) {
        setFormError(result.error);
        setProblems(result.problems ?? {});
      }
    });
  }

  const heading =
    step === 3
      ? draft.mode === "have_flat"
        ? { title: "Your flat", subtitle: "Real costs up front build trust." }
        : {
            title: "What you're looking for",
            subtitle: "We'll use this to show you the right flats.",
          }
      : HEADINGS[step];
  const progress = ((step + 1) / STEPS.length) * 100;

  return (
    <div ref={topRef} className="scroll-mt-20">
      <div className="mb-6">
        <div className="text-muted mb-2 flex items-center justify-between text-xs font-semibold">
          <span>
            Step {step + 1} of {STEPS.length} · {STEPS[step]}
          </span>
          {isEditing && <span>Editing your profile</span>}
        </div>
        <div
          role="progressbar"
          aria-label="Onboarding progress"
          aria-valuemin={1}
          aria-valuemax={STEPS.length}
          aria-valuenow={step + 1}
          className="bg-charcoal/10 h-1.5 overflow-hidden rounded-full"
        >
          <div
            className="bg-accent h-full rounded-full transition-[width] duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <h1 className="font-display text-3xl leading-tight font-semibold tracking-tight">
        {heading.title}
      </h1>
      <p className="text-muted mt-1 mb-6">{heading.subtitle}</p>

      {step === 0 && (
        <IntentStep
          draft={draft}
          problems={problems}
          onChoose={(mode) => {
            update((current) => ({ ...current, mode }));
            goTo(1);
          }}
        />
      )}
      {step === 1 && (
        <BasicsStep
          draft={draft}
          update={update}
          problems={problems}
          userId={userId}
        />
      )}
      {step === 2 && (
        <PromptsStep draft={draft} update={update} problems={problems} />
      )}
      {step === 3 &&
        (draft.mode === "have_flat" ? (
          <ListingStep
            draft={draft}
            update={update}
            problems={problems}
            userId={userId}
          />
        ) : (
          <PreferencesStep draft={draft} update={update} problems={problems} />
        ))}

      {formError && (
        <p
          role="alert"
          className="bg-accent-soft text-accent-strong mt-6 rounded-2xl p-3 text-sm font-medium"
        >
          {formError}
        </p>
      )}

      {step > 0 && (
        <div className="mt-8 flex items-center gap-3">
          <Button
            variant="ghost"
            onClick={() => goTo(step - 1)}
            disabled={isSaving}
            aria-label="Back"
            className="px-4"
          >
            <ArrowLeft aria-hidden="true" className="size-5" />
          </Button>
          <Button onClick={next} fullWidth disabled={isSaving}>
            {step < STEPS.length - 1
              ? "Continue"
              : isSaving
                ? "Saving…"
                : isEditing
                  ? "Save changes"
                  : "Finish"}
          </Button>
        </div>
      )}
    </div>
  );
}
