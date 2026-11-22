import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import {
  OnboardingWizard,
  type Draft,
} from "@/components/onboarding/onboarding-wizard";
import { AppShell } from "@/components/ui/app-shell";
import { Wordmark } from "@/components/ui/wordmark";
import { PROMPT_COUNT } from "@/lib/constants/prompts";
import { getCurrentUser, isOnboarded, type CurrentUser } from "@/lib/profile";

export const metadata: Metadata = { title: "Set up your profile · Roomie" };

const STEP_NAMES: Record<string, number> = {
  intent: 0,
  about: 1,
  prompts: 2,
  details: 3,
};

/** Fill the wizard with what's already saved, so editing starts from it. */
function draftFrom({ profile, listing }: CurrentUser): Draft {
  const prompts = profile?.bio_prompts ?? [];
  return {
    mode: profile?.mode ?? "",
    full_name: profile?.full_name ?? "",
    gender: profile?.gender ?? "",
    year_of_study: profile?.year_of_study ? String(profile.year_of_study) : "",
    department: profile?.department ?? "",
    avatar_url: profile?.avatar_url ?? null,
    prompts: Array.from(
      { length: PROMPT_COUNT },
      (_, index) => prompts[index] ?? { question: "", answer: "" },
    ),
    listing: {
      society: listing?.society ?? "",
      bhk_type: listing?.bhk_type ?? "",
      vacant_spots: String(listing?.vacant_spots ?? 1),
      rent_per_person: listing ? String(listing.rent_per_person) : "",
      maintenance_per_person: listing
        ? String(listing.maintenance_per_person)
        : "",
      deposit_per_person: listing ? String(listing.deposit_per_person) : "",
      setup_cost: listing ? String(listing.setup_cost) : "",
      amenities: listing?.amenities ?? [],
      photos: listing?.photos ?? [],
    },
    preferences: {
      preferred_societies: profile?.preferred_societies ?? [],
      max_budget: profile?.max_budget ? String(profile.max_budget) : "",
      move_in_timeframe: profile?.move_in_timeframe ?? "",
    },
  };
}

async function Onboarding({
  searchParams,
}: {
  searchParams: PageProps<"/onboarding">["searchParams"];
}) {
  const current = await getCurrentUser();
  if (!current) {
    redirect("/login");
  }
  const isEditing = isOnboarded(current.profile);
  const { step } = await searchParams;
  const initialStep =
    isEditing && typeof step === "string" ? (STEP_NAMES[step] ?? 0) : 0;
  return (
    <OnboardingWizard
      userId={current.user.id}
      initial={draftFrom(current)}
      initialStep={initialStep}
      isEditing={isEditing}
    />
  );
}

function WizardPlaceholder() {
  return (
    <div aria-hidden="true" className="space-y-4">
      <div className="bg-charcoal/10 h-1.5 rounded-full" />
      <div className="bg-charcoal/5 h-10 w-3/4 animate-pulse rounded-xl" />
      <div className="bg-charcoal/5 rounded-card h-40 animate-pulse" />
      <div className="bg-charcoal/5 rounded-card h-40 animate-pulse" />
    </div>
  );
}

export default function OnboardingPage({
  searchParams,
}: PageProps<"/onboarding">) {
  return (
    <AppShell header={<Wordmark />}>
      <Suspense fallback={<WizardPlaceholder />}>
        <Onboarding searchParams={searchParams} />
      </Suspense>
    </AppShell>
  );
}
