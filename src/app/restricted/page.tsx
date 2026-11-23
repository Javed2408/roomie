import { LogOut, ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { signOut } from "@/app/login/actions";
import { AppShell } from "@/components/ui/app-shell";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/ui/wordmark";
import { isEligibleUser, isSrmEmail, SRM_EMAIL_DOMAIN } from "@/lib/eligibility";
import { getCurrentUser } from "@/lib/profile";

export const metadata: Metadata = { title: "SRM students only · Roomie" };

/**
 * Where signed-in accounts that can't use Roomie land: accounts created
 * before sign-ups became SRM-only, or SRM addresses not yet confirmed.
 * Their data is kept; they just can't use the app with this account.
 */
async function Explanation() {
  const current = await getCurrentUser();
  if (!current) {
    redirect("/login");
  }
  if (isEligibleUser(current.user)) {
    redirect("/discover");
  }
  const email = current.user.email ?? "this account";
  const needsConfirming = isSrmEmail(email);

  return (
    <div className="flex flex-col items-center px-2 pt-10 text-center">
      <span className="bg-accent-soft text-accent-strong flex size-16 items-center justify-center rounded-full">
        <ShieldAlert aria-hidden="true" className="size-8" />
      </span>
      <h1 className="font-display mt-6 text-3xl font-semibold tracking-tight">
        Roomie is only for SRM students
      </h1>
      {needsConfirming ? (
        <p className="text-muted mt-3 max-w-xs leading-relaxed">
          Confirm <strong className="text-charcoal">{email}</strong> using the link we emailed
          you, then sign in again.
        </p>
      ) : (
        <p className="text-muted mt-3 max-w-xs leading-relaxed">
          You&apos;re signed in as <strong className="text-charcoal break-all">{email}</strong>,
          which isn&apos;t a {SRM_EMAIL_DOMAIN} address. Your account and past conversations are
          kept, but Roomie can only be used with a confirmed SRM email.
        </p>
      )}
      <form action={signOut} className="mt-8 w-full max-w-xs">
        <Button type="submit" fullWidth>
          <LogOut aria-hidden="true" className="size-4" />
          Sign out
        </Button>
      </form>
      <p className="text-muted mt-4 max-w-xs text-sm">
        Then create an account with your {SRM_EMAIL_DOMAIN} email.
      </p>
    </div>
  );
}

export default function RestrictedPage() {
  return (
    <AppShell header={<Wordmark />}>
      <Suspense fallback={<div aria-hidden="true" className="bg-charcoal/5 h-64 animate-pulse rounded-card" />}>
        <Explanation />
      </Suspense>
    </AppShell>
  );
}
