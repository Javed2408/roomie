"use client"; // Error screens must run in the browser (React error boundary).

import { RotateCcw, Wrench } from "lucide-react";
import { useEffect } from "react";

import { AppShell } from "@/components/ui/app-shell";
import { Button, ButtonLink } from "@/components/ui/button";
import { Wordmark } from "@/components/ui/wordmark";

/**
 * Shown when a page fails unexpectedly (e.g. Supabase can't be reached).
 * `retry` loads the page's data again and re-renders it.
 */
export default function ErrorScreen({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    // Visible in the browser console (and the dev server log) for debugging.
    console.error(error);
  }, [error]);

  // In production, server errors carry only this short reference, never
  // their details, so it's safe to show.
  const reference =
    error instanceof Error && "digest" in error && typeof error.digest === "string"
      ? error.digest
      : null;

  return (
    <AppShell header={<Wordmark />}>
      <div className="flex flex-col items-center px-2 pt-12 text-center">
        <span className="bg-accent-soft text-accent-strong flex size-16 items-center justify-center rounded-full">
          <Wrench aria-hidden="true" className="size-8" />
        </span>
        <h1 className="font-display mt-6 text-3xl font-semibold tracking-tight">
          Something went wrong
        </h1>
        <p className="text-muted mt-3 max-w-xs leading-relaxed">
          It&apos;s not you, it&apos;s us. Check your connection and try again.
        </p>
        <div className="mt-8 flex w-full max-w-xs flex-col gap-3">
          <Button fullWidth onClick={() => retry()}>
            <RotateCcw aria-hidden="true" className="size-4" />
            Try again
          </Button>
          <ButtonLink href="/" variant="secondary" fullWidth>
            Back to Roomie
          </ButtonLink>
        </div>
        {reference && (
          <p className="text-muted mt-6 text-xs">Reference: {reference}</p>
        )}
      </div>
    </AppShell>
  );
}
