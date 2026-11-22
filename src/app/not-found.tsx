import { DoorClosed } from "lucide-react";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";
import { ButtonLink } from "@/components/ui/button";
import { Wordmark } from "@/components/ui/wordmark";

export const metadata: Metadata = { title: "Page not found · Roomie" };

/** Any address that doesn't exist, or a page that called notFound(). */
export default function NotFound() {
  return (
    <AppShell header={<Wordmark />}>
      <div className="flex flex-col items-center px-2 pt-12 text-center">
        <span className="bg-accent-soft text-accent-strong flex size-16 items-center justify-center rounded-full">
          <DoorClosed aria-hidden="true" className="size-8" />
        </span>
        <p className="text-muted mt-6 text-sm font-semibold tracking-wide uppercase">404</p>
        <h1 className="font-display mt-1 text-3xl font-semibold tracking-tight">
          This room&apos;s already taken
        </h1>
        <p className="text-muted mt-3 max-w-xs leading-relaxed">
          The page you&apos;re looking for doesn&apos;t exist, or it has moved out.
        </p>
        <div className="mt-8 flex w-full max-w-xs flex-col gap-3">
          {/* Signed-in students are sent on from / to Discover. */}
          <ButtonLink href="/" fullWidth>
            Back to Roomie
          </ButtonLink>
          <ButtonLink href="/matches" variant="secondary" fullWidth>
            Your matches
          </ButtonLink>
        </div>
      </div>
    </AppShell>
  );
}
