"use client";

import { ArrowLeft, ArrowRight, Camera, Globe, Lock, LoaderCircle, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";

import { createGroup, updateGroup } from "@/app/groups/actions";
import { GroupPhoto } from "@/components/groups/group-bits";
import { Button } from "@/components/ui/button";
import { ChipGroup, TextAreaField, TextField } from "@/components/ui/fields";
import {
  GENDER_PREFERENCES,
  GROUP_SIZE,
  GROUP_STATUSES,
  HOUSING_STATUSES,
  ROOM_TYPES,
} from "@/lib/constants/preferences";
import { BHK_TYPES, MOVE_IN_TIMEFRAMES, SOCIETIES } from "@/lib/constants/prompts";
import {
  budgetRangeLabel,
  firstGroupStepWithProblem,
  GROUP_STEPS,
  validateGroup,
  type GroupForm as Form,
  type GroupStep,
  type Problems,
} from "@/lib/group-validation";
import { ACCEPTED_IMAGES, uploadImage } from "@/lib/media";

type Step = GroupStep | "review";
const asOptions = (values: readonly string[]) => values.map((value) => ({ value, label: value }));

function Intro({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-5">
      <h2 className="font-display text-2xl font-semibold">{title}</h2>
      <p className="text-muted mt-1 text-sm leading-relaxed">{children}</p>
    </div>
  );
}

/**
 * Create or edit a group in short steps. Only the name is required. You
 * become the group's first admin when you create it.
 */
export function GroupForm({
  userId,
  groupId,
  initial,
  memberCount = 1,
}: {
  userId: string;
  /** Present when editing. */
  groupId?: string;
  initial: Form;
  memberCount?: number;
}) {
  const router = useRouter();
  const editing = Boolean(groupId);
  const steps: Array<{ id: Step; label: string }> = [
    ...GROUP_STEPS.map(({ id, label }) => ({ id, label })),
    ...(editing ? [] : [{ id: "review" as const, label: "Review" }]),
  ];
  const [form, setForm] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [step, setStep] = useState<Step>("identity");
  const [problems, setProblems] = useState<Problems>({});
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [isSaving, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const index = steps.findIndex((item) => item.id === step);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
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

  function next() {
    const current = GROUP_STEPS.find((item) => item.id === step);
    if (current) {
      const all = validateGroup(form, { memberCount }).problems;
      const here = Object.fromEntries(Object.entries(all).filter(([field]) => (current.fields as readonly string[]).includes(field)));
      if (Object.keys(here).length > 0) {
        setProblems(here);
        return;
      }
    }
    go(steps[index + 1].id);
  }

  async function upload(file: File) {
    setUploading(true);
    setMessage(null);
    try {
      set("avatar_url", await uploadImage(userId, "group", file));
    } catch (failure) {
      setMessage({ tone: "error", text: failure instanceof Error ? failure.message : "That upload failed." });
    } finally {
      setUploading(false);
    }
  }

  function save() {
    const check = validateGroup(form, { memberCount }).problems;
    if (Object.keys(check).length > 0) {
      setProblems(check);
      setMessage({ tone: "error", text: "Some details need another look." });
      go(firstGroupStepWithProblem(check) ?? step);
      return;
    }
    startTransition(async () => {
      const result = groupId ? await updateGroup(groupId, form) : await createGroup(form);
      if (!result.ok) {
        setProblems(result.problems ?? {});
        setMessage({ tone: "error", text: result.error });
        const problemStep = firstGroupStepWithProblem(result.problems ?? {});
        if (problemStep) go(problemStep);
        return;
      }
      setSaved(form);
      if (groupId) {
        setMessage({ tone: "ok", text: "Saved." });
      } else {
        router.push(`/groups/${result.id}`);
      }
    });
  }

  const { value } = validateGroup(form, { memberCount });
  const budget = budgetRangeLabel(value.budget_min, value.budget_max);

  return (
    <div>
      <nav aria-label="Group steps" className="bg-cream/95 sticky top-[4.75rem] z-10 -mx-5 mb-6 px-5 py-2 backdrop-blur">
        <ol className="-mx-5 flex gap-2 overflow-x-auto px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {steps.map((item, position) => (
            <li key={item.id} className="shrink-0">
              <button
                type="button"
                aria-current={item.id === step ? "step" : undefined}
                onClick={() => go(item.id)}
                className={`focus-visible:outline-accent inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 ${
                  item.id === step ? "bg-charcoal text-cream border-charcoal" : "bg-surface border-line text-charcoal hover:border-charcoal/40"
                }`}
              >
                <span aria-hidden="true" className="tabular-nums opacity-60">
                  {position + 1}
                </span>
                {item.label}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      {step === "identity" && (
        <section className="space-y-6">
          <Intro title="Name your group">Something friendly that says who you are.</Intro>
          <TextField
            label="Group name"
            placeholder="e.g. Potheri Night Owls"
            maxLength={60}
            value={form.name}
            onChange={(event) => set("name", event.target.value)}
            error={problems.name}
          />
          <div>
            <p className="mb-2 text-sm font-semibold">Group photo (optional)</p>
            <div className="flex items-center gap-4">
              <GroupPhoto url={form.avatar_url} name={form.name || "Group"} className="size-20 rounded-2xl text-2xl" />
              <div className="flex flex-col gap-2">
                <Button variant="secondary" className="min-h-11 px-4 text-sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
                  {uploading ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <Camera aria-hidden="true" className="size-4" />}
                  {uploading ? "Uploading…" : form.avatar_url ? "Change photo" : "Add a photo"}
                </Button>
                {form.avatar_url && (
                  <Button variant="ghost" className="min-h-11 px-4 text-sm" onClick={() => set("avatar_url", null)}>
                    <Trash2 aria-hidden="true" className="size-4" />
                    Remove
                  </Button>
                )}
              </div>
            </div>
            {problems.avatar_url && <p className="text-accent-strong mt-2 text-sm font-medium">{problems.avatar_url}</p>}
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPTED_IMAGES}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
                event.target.value = "";
              }}
            />
          </div>
        </section>
      )}

      {step === "about" && (
        <section className="space-y-6">
          <Intro title="About the group">Who you are and what you&apos;re hoping for. Optional, but it helps.</Intro>
          <TextAreaField
            label="Description (optional)"
            placeholder="e.g. Three second-years who want a calm 3BHK near campus for next semester."
            rows={5}
            maxLength={500}
            value={form.description}
            onChange={(event) => set("description", event.target.value)}
            error={problems.description}
            hint={`${form.description.length}/500`}
          />
        </section>
      )}

      {step === "housing" && (
        <section className="space-y-6">
          <Intro title="Housing">What the group is after. Leave anything you haven&apos;t decided.</Intro>
          <ChipGroup
            label="Right now the group…"
            options={HOUSING_STATUSES.map((option) => ({
              value: option.value,
              label: option.value === "has_accommodation" ? "Has a place" : "Needs a place",
            }))}
            multiple={false}
            clearable
            value={form.housing_status ? [form.housing_status as (typeof HOUSING_STATUSES)[number]["value"]] : []}
            onChange={([status]) => set("housing_status", status ?? null)}
            error={problems.housing_status}
          />
          <ChipGroup
            label="Preferred societies"
            options={asOptions(SOCIETIES)}
            value={form.preferred_societies}
            onChange={(societies) => set("preferred_societies", societies)}
            error={problems.preferred_societies}
          />
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Budget from (₹/month)"
              inputMode="numeric"
              placeholder="e.g. 6000"
              value={String(form.budget_min)}
              onChange={(event) => set("budget_min", event.target.value)}
              error={problems.budget_min}
            />
            <TextField
              label="Budget up to (₹/month)"
              inputMode="numeric"
              placeholder="e.g. 12000"
              value={String(form.budget_max)}
              onChange={(event) => set("budget_max", event.target.value)}
              error={problems.budget_max}
            />
          </div>
          <p className="text-muted -mt-3 text-sm">Per person. {budget ? `Range: ${budget}.` : "Leave empty if undecided."}</p>
          <ChipGroup
            label="Moving in"
            options={MOVE_IN_TIMEFRAMES}
            multiple={false}
            clearable
            value={form.move_in_timeframe ? [form.move_in_timeframe as (typeof MOVE_IN_TIMEFRAMES)[number]["value"]] : []}
            onChange={([timeframe]) => set("move_in_timeframe", timeframe ?? null)}
            error={problems.move_in_timeframe}
          />
          <ChipGroup
            label="Flat sizes"
            options={asOptions(BHK_TYPES)}
            value={form.preferred_bhk_types}
            onChange={(sizes) => set("preferred_bhk_types", sizes)}
            error={problems.preferred_bhk_types}
          />
          <ChipGroup
            label="Rooms"
            options={ROOM_TYPES}
            multiple={false}
            clearable
            value={form.room_preference ? [form.room_preference as (typeof ROOM_TYPES)[number]["value"]] : []}
            onChange={([room]) => set("room_preference", room ?? null)}
            error={problems.room_preference}
          />
        </section>
      )}

      {step === "people" && (
        <section className="space-y-6">
          <Intro title="People and lifestyle">How big the group should be, and how you like to live.</Intro>
          <ChipGroup
            label="Group size (including you)"
            options={Array.from({ length: GROUP_SIZE.max - GROUP_SIZE.min + 1 }, (_, n) => ({
              value: String(n + GROUP_SIZE.min),
              label: String(n + GROUP_SIZE.min),
            }))}
            multiple={false}
            value={[String(form.max_members)]}
            isDisabled={(size) => Number(size) < memberCount}
            onChange={([size]) => size && set("max_members", size)}
            error={problems.max_members}
          />
          <ChipGroup
            label="Who can join"
            options={GENDER_PREFERENCES}
            multiple={false}
            value={[form.preferred_gender as (typeof GENDER_PREFERENCES)[number]["value"]]}
            onChange={([gender]) => gender && set("preferred_gender", gender)}
            error={problems.preferred_gender}
          />
          <TextAreaField
            label="Who you're looking for (optional)"
            placeholder="e.g. Final-years, non-smokers, happy to split cooking."
            rows={3}
            maxLength={500}
            value={form.requirements}
            onChange={(event) => set("requirements", event.target.value)}
            error={problems.requirements}
          />
          <TextAreaField
            label="Lifestyle expectations (optional)"
            placeholder="e.g. Quiet after 11 on weekdays, guests welcome on weekends."
            rows={3}
            maxLength={500}
            value={form.lifestyle_notes}
            onChange={(event) => set("lifestyle_notes", event.target.value)}
            error={problems.lifestyle_notes}
          />
        </section>
      )}

      {step === "visibility" && (
        <section className="space-y-6">
          <Intro title="Who can find the group">You can change this any time.</Intro>
          <fieldset className="grid gap-2">
            <legend className="sr-only">Visibility</legend>
            {[
              { value: true, icon: Globe, label: "Discoverable", hint: "Any SRM student can find the group and ask to join." },
              { value: false, icon: Lock, label: "Invite-only", hint: "Hidden from Groups. Only people you invite can see it." },
            ].map((option) => (
              <label
                key={option.label}
                className="border-line bg-surface has-[:checked]:border-charcoal has-[:focus-visible]:outline-accent flex min-h-16 cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 has-[:focus-visible]:outline-2"
              >
                <input
                  type="radio"
                  name="visibility"
                  checked={form.is_discoverable === option.value}
                  onChange={() => set("is_discoverable", option.value)}
                  className="accent-charcoal size-5 shrink-0"
                />
                <option.icon aria-hidden="true" className="text-forest size-5 shrink-0" />
                <span>
                  <span className="block font-medium">{option.label}</span>
                  <span className="text-muted block text-sm">{option.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {editing && (
            <ChipGroup
              label="Status"
              options={GROUP_STATUSES}
              multiple={false}
              value={[form.status as (typeof GROUP_STATUSES)[number]["value"]]}
              onChange={([status]) => status && set("status", status)}
              error={problems.status}
              hint={form.status === "archived" ? "A closed group is hidden and can't take new members." : undefined}
            />
          )}
        </section>
      )}

      {step === "review" && (
        <section className="space-y-4">
          <Intro title="Review">You&apos;ll be the group&apos;s admin. Invite people once it&apos;s created.</Intro>
          <div className="bg-surface border-line rounded-card flex items-center gap-4 border p-4">
            <GroupPhoto url={form.avatar_url} name={form.name || "Group"} className="size-16 rounded-2xl text-xl" />
            <div className="min-w-0">
              <p className="font-display text-xl font-semibold">{form.name || "Unnamed group"}</p>
              <p className="text-muted text-sm">
                Up to {value.max_members} people · {form.is_discoverable ? "Discoverable" : "Invite-only"}
                {budget ? ` · ${budget}/mo` : ""}
              </p>
            </div>
          </div>
          {form.description && <p className="text-sm leading-relaxed">{form.description}</p>}
        </section>
      )}

      <div className="bg-cream/95 border-line sticky bottom-0 z-10 -mx-5 mt-8 border-t px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        {message && (
          <p role={message.tone === "error" ? "alert" : "status"} className={`mb-2 text-sm font-medium ${message.tone === "error" ? "text-accent-strong" : "text-forest"}`}>
            {message.text}
          </p>
        )}
        <div className="flex items-center gap-2">
          {index > 0 && (
            <Button variant="secondary" className="px-4" onClick={() => go(steps[index - 1].id)} aria-label="Previous step">
              <ArrowLeft aria-hidden="true" className="size-4" />
            </Button>
          )}
          {editing ? (
            <Button className="flex-1" disabled={isSaving || uploading || !dirty} onClick={save}>
              {isSaving ? "Saving…" : dirty ? "Save changes" : "Saved"}
            </Button>
          ) : step === "review" ? (
            <Button className="flex-1" disabled={isSaving || uploading} onClick={save}>
              {isSaving ? "Creating…" : "Create group"}
            </Button>
          ) : (
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
