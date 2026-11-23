import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AuthForm } from "@/components/auth/auth-form";
import { AppShell } from "@/components/ui/app-shell";
import { Wordmark } from "@/components/ui/wordmark";
import { isEligibleUser } from "@/lib/eligibility";
import { getCurrentUser, isOnboarded } from "@/lib/profile";

export const metadata: Metadata = { title: "Sign in · Roomie" };

/**
 * Reads the session cookie, so it only runs when someone visits (inside
 * <Suspense>); the rest of the page is ready instantly.
 */
async function LoginContent({
  searchParams,
}: {
  searchParams: PageProps<"/login">["searchParams"];
}) {
  // Already signed in: finish onboarding first, otherwise go to the account.
  const current = await getCurrentUser();
  if (current) {
    redirect(
      !isEligibleUser(current.user)
        ? "/restricted"
        : isOnboarded(current.profile)
          ? "/discover"
          : "/onboarding",
    );
  }
  const { error } = await searchParams;
  return <AuthForm linkError={error === "confirm"} />;
}

function FormPlaceholder() {
  return (
    <div aria-hidden="true" className="space-y-4">
      <div className="bg-forest-soft rounded-card h-28 animate-pulse" />
      <div className="bg-charcoal/5 h-12 animate-pulse rounded-full" />
      <div className="bg-charcoal/5 h-12 animate-pulse rounded-2xl" />
      <div className="bg-charcoal/5 h-12 animate-pulse rounded-2xl" />
    </div>
  );
}

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <AppShell header={<Wordmark />}>
      <h1 className="font-display text-4xl leading-tight font-semibold tracking-tight">
        Welcome to Roomie
      </h1>
      <p className="text-muted mt-2 mb-6 text-base">
        Sign in, or create an account in a few seconds.
      </p>
      <Suspense fallback={<FormPlaceholder />}>
        <LoginContent searchParams={searchParams} />
      </Suspense>
    </AppShell>
  );
}
