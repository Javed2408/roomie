import { Building2, Check, ChevronRight, Eye, LogOut, Pencil } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { signOut } from "@/app/login/actions";
import { StatusBadge } from "@/components/listings/status-badge";
import { AppShell } from "@/components/ui/app-shell";
import { Avatar } from "@/components/ui/avatar";
import { BottomNav } from "@/components/ui/bottom-nav";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SrmBadge } from "@/components/ui/srm-badge";
import { Wordmark } from "@/components/ui/wordmark";
import {
  DISCOVER_HOUSING_OPTIONS,
  HOUSING_STATUSES,
  SEEKING_OPTIONS,
} from "@/lib/constants/preferences";
import { listingTitle } from "@/lib/listing-display";
import { requireStudent } from "@/lib/profile";
import { loadProfileProgress, type ProfileProgress } from "@/lib/student";
import { firstName, headline } from "@/types/feed";

export const metadata: Metadata = { title: "Your account · Roomie" };

/** The steps to a profile people want to reply to, each linking to its section. */
function checklist(progress: ProfileProgress) {
  return [
    { done: progress.photos >= 3, label: "Add at least 3 photos", section: "photos" },
    { done: progress.hasAbout, label: "Write a short introduction", section: "about" },
    { done: progress.prompts >= 2, label: "Answer 2 or more prompts", section: "prompts" },
    { done: progress.interests >= 3, label: "Pick 3 or more interests", section: "interests" },
    { done: progress.lifestyleAnswered >= 5, label: "Answer 5 lifestyle questions", section: "lifestyle" },
  ];
}

const labelOf = (options: ReadonlyArray<{ value: string; label: string }>, value?: string | null) =>
  options.find((option) => option.value === value)?.label;

/** Your account, your profile's progress, housing settings and your flat. */
async function AccountDetails() {
  const student = await requireStudent();
  const { user, profile, listing } = student;
  const progress = await loadProfileProgress(student);
  const steps = checklist(progress);
  const done = steps.filter((step) => step.done).length;
  const name = firstName(profile);
  const showFlat = progress.housing === "has_accommodation" || Boolean(listing?.is_active);

  return (
    <div className="space-y-8">
      <Card className="flex items-center gap-4 p-5">
        <Avatar url={profile.avatar_url} name={name} className="size-16 rounded-full text-2xl" />
        <div className="min-w-0">
          <p className="font-display text-xl font-semibold">{name}</p>
          {headline(profile) && <p className="text-muted text-sm">{headline(profile)}</p>}
          <p className="text-muted mt-1 truncate text-xs">{user.email}</p>
          <div className="mt-2">
            <SrmBadge verified={profile.is_srm_verified} />
          </div>
        </div>
      </Card>

      <section aria-labelledby="profile-heading">
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2 id="profile-heading" className="font-display text-xl font-semibold">
            Your profile
          </h2>
          <span className="text-muted text-sm">
            {done}/{steps.length} done
          </span>
        </div>
        <div
          role="progressbar"
          aria-label="Profile strength"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={done}
          className="bg-charcoal/10 mb-4 h-2 overflow-hidden rounded-full"
        >
          <div className="bg-forest h-full rounded-full" style={{ width: `${(done / steps.length) * 100}%` }} />
        </div>
        <ul className="bg-surface border-line rounded-card divide-line divide-y overflow-hidden border">
          {steps.map((step) => (
            <li key={step.section}>
              <Link
                href={`/profile/edit?section=${step.section}`}
                className="hover:bg-charcoal/[0.03] focus-visible:outline-accent flex min-h-12 items-center gap-3 px-4 py-2 focus-visible:outline-2 focus-visible:-outline-offset-2"
              >
                <span
                  className={`flex size-6 shrink-0 items-center justify-center rounded-full ${
                    step.done ? "bg-forest text-cream" : "border-line border-2"
                  }`}
                >
                  {step.done && <Check aria-hidden="true" className="size-3.5" strokeWidth={3} />}
                  <span className="sr-only">{step.done ? "Done:" : "To do:"}</span>
                </span>
                <span className={`flex-1 text-sm ${step.done ? "text-muted" : "font-medium"}`}>{step.label}</span>
                <ChevronRight aria-hidden="true" className="text-muted size-4" />
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <ButtonLink href="/profile/edit">
            <Pencil aria-hidden="true" className="size-4" />
            Edit profile
          </ButtonLink>
          <ButtonLink href={`/students/${user.id}`} variant="secondary">
            <Eye aria-hidden="true" className="size-4" />
            View profile
          </ButtonLink>
        </div>
      </section>

      <section aria-labelledby="housing-heading">
        <h2 id="housing-heading" className="font-display mb-3 text-xl font-semibold">
          Housing & discovery
        </h2>
        <Card className="p-4">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Right now</dt>
              <dd className="text-right font-medium">
                {labelOf(HOUSING_STATUSES, progress.housing) ?? "Not set"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Discovering</dt>
              <dd className="text-right font-medium">
                {labelOf(DISCOVER_HOUSING_OPTIONS, progress.discovery?.discover_housing) ?? "Not set"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Looking for</dt>
              <dd className="text-right font-medium">
                {labelOf(SEEKING_OPTIONS, progress.discovery?.seeking) ?? "Not set"}
              </dd>
            </div>
          </dl>
          <ButtonLink href="/profile/edit?section=housing" variant="ghost" fullWidth className="mt-3">
            Change
          </ButtonLink>
        </Card>
      </section>

      {showFlat && (
        <section aria-labelledby="flat-heading">
          <h2 id="flat-heading" className="font-display mb-3 text-xl font-semibold">
            Your listings
          </h2>
          <Link
            href="/account/listings"
            className="bg-surface border-line rounded-card hover:border-charcoal/30 focus-visible:outline-accent flex items-center gap-3 border p-4 focus-visible:outline-2"
          >
            <span className="bg-forest-soft text-forest flex size-11 shrink-0 items-center justify-center rounded-full">
              <Building2 aria-hidden="true" className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              {listing ? (
                <>
                  <span className="block font-semibold">{listingTitle(listing)}</span>
                  <span className="mt-1 block">
                    <StatusBadge status={listing.status} />
                  </span>
                </>
              ) : (
                <>
                  <span className="block font-semibold">No listings yet</span>
                  <span className="text-muted block text-sm">Create one when you have a room to share.</span>
                </>
              )}
            </span>
            <span className="text-sm font-semibold whitespace-nowrap">Manage</span>
            <ChevronRight aria-hidden="true" className="text-muted size-4" />
          </Link>
        </section>
      )}

      <form action={signOut}>
        <Button type="submit" variant="secondary" fullWidth>
          <LogOut aria-hidden="true" className="size-4" />
          Sign out
        </Button>
      </form>
    </div>
  );
}

function AccountPlaceholder() {
  return (
    <div aria-hidden="true" className="space-y-5">
      <div className="bg-charcoal/5 rounded-card h-28 animate-pulse" />
      <div className="bg-charcoal/5 rounded-card h-64 animate-pulse" />
    </div>
  );
}

export default function AccountPage() {
  return (
    <AppShell header={<Wordmark />} footer={<BottomNav current="Account" />}>
      <h1 className="font-display mb-6 text-4xl font-semibold tracking-tight">Your account</h1>
      <Suspense fallback={<AccountPlaceholder />}>
        <AccountDetails />
      </Suspense>
    </AppShell>
  );
}
