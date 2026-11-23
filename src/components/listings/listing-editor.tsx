"use client";

import { ArrowLeft, ArrowRight, Check, CircleAlert, Lock, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";

import { saveListing } from "@/app/account/listings/actions";
import { ListingActions } from "@/components/listings/listing-actions";
import { ListingPhotos } from "@/components/listings/listing-photos";
import { Button } from "@/components/ui/button";
import { ChipGroup, TextAreaField, TextField } from "@/components/ui/fields";
import {
  BEDROOMS,
  FLATMATE_GENDER_OPTIONS,
  FURNISHING_OPTIONS,
  LISTING_LIMITS,
  LISTING_ROOM_TYPES,
} from "@/lib/constants/listings";
import { AMENITIES, BHK_TYPES, SOCIETIES } from "@/lib/constants/prompts";
import {
  firstStepWithProblem,
  LISTING_STEPS,
  listingGaps,
  todayInIndia,
  validateListing,
  type ListingForm,
  type ListingStep,
  type Problems,
} from "@/lib/listing-validation";
import { formatInr } from "@/lib/onboarding";
import type { ListingStatus } from "@/types/database";

type Step = ListingStep | "review";
const STEPS: Array<{ id: Step; label: string }> = [...LISTING_STEPS, { id: "review", label: "Review" }];

const asOptions = (values: readonly string[]) => values.map((value) => ({ value, label: value }));
const numbers = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => ({ value: String(from + index), label: String(from + index) }));

function StepIntro({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-5">
      <h2 className="font-display text-2xl font-semibold">{title}</h2>
      <p className="text-muted mt-1 text-sm leading-relaxed">{children}</p>
    </div>
  );
}

/**
 * Create or edit a listing, one short step at a time. Saving keeps it as a
 * draft (or saves changes to a live listing straight away); publishing is
 * a separate, explicit step on the last page.
 */
export function ListingEditor({
  userId,
  listingId,
  status,
  initial,
  canPublish,
  initialStep,
}: {
  userId: string;
  /** Missing for a new listing until it's first saved. */
  listingId?: string;
  status?: ListingStatus;
  initial: ListingForm;
  canPublish: boolean;
  /** A step id from the address, e.g. "review" after the first save. */
  initialStep?: string;
}) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [step, setStep] = useState<Step>(STEPS.find((item) => item.id === initialStep)?.id ?? "location");
  const [problems, setProblems] = useState<Problems>({});
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [isSaving, startTransition] = useTransition();
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const index = STEPS.findIndex((item) => item.id === step);
  const today = todayInIndia();

  useEffect(() => {
    if (!dirty) {
      return;
    }
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const set = <K extends keyof ListingForm>(key: K, value: ListingForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setMessage(null);
    setProblems((current) => {
      const rest = { ...current };
      delete rest[key];
      return rest;
    });
  };

  function go(next: Step) {
    setStep(next);
    window.scrollTo({ top: 0 });
  }

  /** Next: check this step's fields first, so problems show where they are. */
  function next() {
    const current = LISTING_STEPS.find((item) => item.id === step);
    if (current) {
      const all = validateListing(form, today).problems;
      const here = Object.fromEntries(Object.entries(all).filter(([field]) => (current.fields as readonly string[]).includes(field)));
      if (Object.keys(here).length > 0) {
        setProblems(here);
        return;
      }
    }
    setProblems({});
    go(STEPS[index + 1].id);
  }

  function save() {
    const check = validateListing(form, today).problems;
    if (Object.keys(check).length > 0) {
      setProblems(check);
      setMessage({ tone: "error", text: "Some details need another look." });
      go(firstStepWithProblem(check) ?? step);
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const result = await saveListing(form, listingId);
      if (!result.ok) {
        setProblems(result.problems ?? {});
        setMessage({ tone: "error", text: result.error });
        const problemStep = firstStepWithProblem(result.problems ?? {});
        if (problemStep) go(problemStep);
        return;
      }
      setSaved(form);
      setMessage({
        tone: "ok",
        text: status === "active" ? "Saved. Your live listing is updated." : "Saved as a draft. Only you can see it.",
      });
      if (!listingId) {
        router.replace(`/account/listings/${result.id}/edit?step=review`);
      }
    });
  }

  const { value } = validateListing(form, today);
  const monthly = Number(value.rent_per_person) + Number(value.maintenance_per_person);
  const bedrooms = BHK_TYPES.includes(form.bhk_type as (typeof BHK_TYPES)[number])
    ? BEDROOMS[form.bhk_type as keyof typeof BEDROOMS]
    : 4;
  const gaps = listingGaps(value);

  return (
    <div>
      <nav aria-label="Listing steps" className="bg-cream/95 sticky top-[4.75rem] z-10 -mx-5 mb-6 px-5 py-2 backdrop-blur">
        <ol className="-mx-5 flex gap-2 overflow-x-auto px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {STEPS.map((item, position) => {
            const isCurrent = item.id === step;
            const hasProblem = LISTING_STEPS.find((entry) => entry.id === item.id)?.fields.some((field) => problems[field]);
            return (
              <li key={item.id} className="shrink-0">
                <button
                  type="button"
                  aria-current={isCurrent ? "step" : undefined}
                  onClick={() => go(item.id)}
                  className={`focus-visible:outline-accent inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 ${
                    isCurrent ? "bg-charcoal text-cream border-charcoal" : "bg-surface border-line text-charcoal hover:border-charcoal/40"
                  }`}
                >
                  <span aria-hidden="true" className="tabular-nums opacity-60">
                    {position + 1}
                  </span>
                  {item.label}
                  {hasProblem && (
                    <>
                      <CircleAlert aria-hidden="true" className="text-accent size-4" />
                      <span className="sr-only"> (needs attention)</span>
                    </>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {step === "location" && (
        <section className="space-y-6">
          <StepIntro title="Where is it?">
            Students search by society and area. Your exact address stays private.
          </StepIntro>
          <ChipGroup
            label="Society or area"
            options={asOptions(SOCIETIES)}
            multiple={false}
            value={form.society ? [form.society] : []}
            onChange={([society]) => set("society", society ?? "")}
            error={problems.society}
          />
          <TextField
            label="Locality (optional)"
            placeholder="e.g. Near the SRM Arch gate"
            maxLength={LISTING_LIMITS.locality}
            value={form.locality}
            onChange={(event) => set("locality", event.target.value)}
            error={problems.locality}
          />
          <TextAreaField
            label="Nearby landmarks (optional)"
            placeholder="e.g. 5 minutes' walk to Potheri station, opposite the bakery"
            rows={2}
            maxLength={LISTING_LIMITS.locationNotes}
            value={form.location_notes}
            onChange={(event) => set("location_notes", event.target.value)}
            error={problems.location_notes}
          />
          <div className="bg-forest-soft rounded-2xl p-4">
            <TextField
              label="Exact address (private, optional)"
              placeholder="Tower, flat number"
              maxLength={LISTING_LIMITS.address}
              value={form.address}
              onChange={(event) => set("address", event.target.value)}
              error={problems.address}
              hint={
                <span className="inline-flex items-start gap-1.5">
                  <Lock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                  Never shown to other students. Share it in chat when you&apos;re ready.
                </span>
              }
            />
          </div>
        </section>
      )}

      {step === "costs" && (
        <section className="space-y-5">
          <StepIntro title="Rent and costs">
            Per person, in rupees. Enter 0 where there&apos;s no cost, so nobody has to guess.
          </StepIntro>
          <TextField
            label="Monthly rent per person"
            inputMode="numeric"
            placeholder="e.g. 9000"
            value={String(form.rent_per_person)}
            onChange={(event) => set("rent_per_person", event.target.value)}
            error={problems.rent_per_person}
          />
          <TextField
            label="Maintenance per month"
            inputMode="numeric"
            placeholder="0 if included"
            value={String(form.maintenance_per_person)}
            onChange={(event) => set("maintenance_per_person", event.target.value)}
            error={problems.maintenance_per_person}
          />
          <TextField
            label="Security deposit"
            inputMode="numeric"
            placeholder="e.g. 20000"
            value={String(form.deposit_per_person)}
            onChange={(event) => set("deposit_per_person", event.target.value)}
            error={problems.deposit_per_person}
          />
          <TextField
            label="One-time setup cost"
            inputMode="numeric"
            placeholder="0 if none"
            hint="e.g. a share of furniture or a broker's fee."
            value={String(form.setup_cost)}
            onChange={(event) => set("setup_cost", event.target.value)}
            error={problems.setup_cost}
          />
          {!problems.rent_per_person && value.rent_per_person > 0 && (
            <p className="bg-surface border-line rounded-2xl border p-4 text-sm">
              <span className="text-muted">Monthly per person:</span>{" "}
              <strong className="font-display text-lg">{formatInr(monthly)}</strong>
              <span className="text-muted"> · to move in: </span>
              <strong>{formatInr(monthly + value.deposit_per_person + value.setup_cost)}</strong>
            </p>
          )}
        </section>
      )}

      {step === "flat" && (
        <section className="space-y-6">
          <StepIntro title="The flat">What&apos;s on offer, and from when.</StepIntro>
          <ChipGroup
            label="Flat size"
            options={asOptions(BHK_TYPES)}
            multiple={false}
            value={form.bhk_type ? [form.bhk_type] : []}
            onChange={([bhk]) => set("bhk_type", bhk ?? "")}
            error={problems.bhk_type}
          />
          <ChipGroup
            label="Rooms free"
            options={numbers(1, bedrooms)}
            multiple={false}
            value={[String(form.available_rooms)]}
            onChange={([rooms]) => rooms && set("available_rooms", rooms)}
            error={problems.available_rooms}
          />
          <ChipGroup
            label="Spots open (people you're looking for)"
            options={numbers(1, LISTING_LIMITS.spots)}
            multiple={false}
            value={[String(form.vacant_spots)]}
            onChange={([spots]) => spots && set("vacant_spots", spots)}
            error={problems.vacant_spots}
          />
          <ChipGroup
            label="Room type (optional)"
            options={LISTING_ROOM_TYPES}
            multiple={false}
            clearable
            value={form.room_type ? [form.room_type as (typeof LISTING_ROOM_TYPES)[number]["value"]] : []}
            onChange={([type]) => set("room_type", type ?? null)}
            error={problems.room_type}
          />
          <ChipGroup
            label="Furnishing (optional)"
            options={FURNISHING_OPTIONS}
            multiple={false}
            clearable
            value={form.furnishing ? [form.furnishing as (typeof FURNISHING_OPTIONS)[number]["value"]] : []}
            onChange={([furnishing]) => set("furnishing", furnishing ?? null)}
            error={problems.furnishing}
          />
          <TextField
            label="Available from (optional)"
            type="date"
            min={today}
            value={form.available_from}
            onChange={(event) => set("available_from", event.target.value)}
            error={problems.available_from}
            hint="Leave empty if the spot is free now."
          />
          <TextAreaField
            label="Description (optional)"
            placeholder="What's the flat like? Light, space, the building, the commute…"
            rows={5}
            maxLength={LISTING_LIMITS.description}
            value={form.description}
            onChange={(event) => set("description", event.target.value)}
            error={problems.description}
            hint={`${form.description.length}/${LISTING_LIMITS.description}`}
          />
        </section>
      )}

      {step === "living" && (
        <section className="space-y-6">
          <StepIntro title="Living there">
            Help people picture day-to-day life. Don&apos;t share other residents&apos; names or personal
            details.
          </StepIntro>
          <ChipGroup
            label="People living there now"
            options={numbers(0, 6)}
            multiple={false}
            value={[String(form.current_flatmates)]}
            onChange={([people]) => people && set("current_flatmates", people)}
            error={problems.current_flatmates}
          />
          <TextAreaField
            label="The living arrangement (optional)"
            placeholder="e.g. Two final-year students, quiet on weekdays, we cook together on Sundays."
            rows={4}
            maxLength={LISTING_LIMITS.longText}
            value={form.living_arrangement}
            onChange={(event) => set("living_arrangement", event.target.value)}
            error={problems.living_arrangement}
          />
          <TextAreaField
            label="House rules (optional)"
            placeholder="e.g. No smoking indoors, guests out by 11, rent split on the 5th."
            rows={4}
            maxLength={LISTING_LIMITS.longText}
            value={form.house_rules}
            onChange={(event) => set("house_rules", event.target.value)}
            error={problems.house_rules}
          />
        </section>
      )}

      {step === "amenities" && (
        <section className="space-y-4">
          <StepIntro title="Amenities">Pick everything the flat has.</StepIntro>
          <ChipGroup
            label="The flat has"
            options={asOptions(AMENITIES)}
            value={form.amenities}
            onChange={(amenities) => set("amenities", amenities)}
            error={problems.amenities}
          />
          <p className="text-muted text-sm">{form.amenities.length} selected</p>
        </section>
      )}

      {step === "flatmate" && (
        <section className="space-y-6">
          <StepIntro title="Your ideal flatmate">
            What matters for living well together. Keep it about habits and lifestyle.
          </StepIntro>
          <ChipGroup
            label="Who can apply"
            options={FLATMATE_GENDER_OPTIONS}
            multiple={false}
            value={[form.preferred_flatmate_gender as (typeof FLATMATE_GENDER_OPTIONS)[number]["value"]]}
            onChange={([gender]) => gender && set("preferred_flatmate_gender", gender)}
            error={problems.preferred_flatmate_gender}
          />
          <TextAreaField
            label="Notes on the ideal flatmate (optional)"
            placeholder="e.g. Someone tidy who's fine with early mornings."
            rows={3}
            maxLength={LISTING_LIMITS.flatmateNotes}
            value={form.flatmate_preferences}
            onChange={(event) => set("flatmate_preferences", event.target.value)}
            error={problems.flatmate_preferences}
          />
        </section>
      )}

      {step === "photos" && (
        <section>
          <StepIntro title="Photos">
            Bright, honest photos of the room, the common areas and the kitchen get the most replies.
          </StepIntro>
          <ListingPhotos
            userId={userId}
            value={form.photos}
            onChange={(update) => {
              setForm((current) => ({ ...current, photos: update(current.photos) }));
              setMessage(null);
            }}
            error={problems.photos}
          />
        </section>
      )}

      {step === "review" && (
        <section className="space-y-5">
          <StepIntro title="Review">
            {status === "active"
              ? "Your listing is live. Saving updates it straight away."
              : "Save it as a draft, preview it, then publish when you're happy."}
          </StepIntro>
          {gaps.length > 0 ? (
            <div className="bg-accent-soft rounded-2xl p-4 text-sm">
              <p className="font-semibold">Worth adding</p>
              <ul className="mt-2 list-inside list-disc space-y-1">
                {gaps.map((gap) => (
                  <li key={gap}>{gap}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="bg-forest-soft text-forest flex items-center gap-2 rounded-2xl p-4 text-sm font-medium">
              <Check aria-hidden="true" className="size-4" />
              Nicely complete.
            </p>
          )}
          {listingId && status && !dirty ? (
            <ListingActions
              id={listingId}
              title={`${form.society} ${form.bhk_type}`}
              status={status}
              canPublish={canPublish}
            />
          ) : (
            <p className="text-muted text-sm">Save first to preview or publish.</p>
          )}
        </section>
      )}

      <div className="bg-cream/95 border-line sticky bottom-0 z-10 -mx-5 mt-8 border-t px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        {message && (
          <p
            role={message.tone === "error" ? "alert" : "status"}
            className={`mb-2 text-sm font-medium ${message.tone === "error" ? "text-accent-strong" : "text-forest"}`}
          >
            {message.text}
          </p>
        )}
        <div className="flex items-center gap-2">
          {index > 0 && (
            <Button variant="secondary" className="px-4" onClick={() => go(STEPS[index - 1].id)} aria-label="Previous step">
              <ArrowLeft aria-hidden="true" className="size-4" />
            </Button>
          )}
          <Button variant="secondary" className="flex-1" disabled={isSaving || (!dirty && Boolean(listingId))} onClick={save}>
            <Save aria-hidden="true" className="size-4" />
            {isSaving ? "Saving…" : listingId ? (dirty ? "Save changes" : "Saved") : "Save draft"}
          </Button>
          {step !== "review" && (
            <Button className="flex-1" onClick={next}>
              Next
              <ArrowRight aria-hidden="true" className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
