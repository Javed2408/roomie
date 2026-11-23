"use client";

import { Ban } from "lucide-react";
import { useState, useTransition } from "react";

import { setBlocked } from "@/app/students/[id]/actions";
import { Button } from "@/components/ui/button";

/**
 * Block or unblock a student, with a confirmation step on the page. A
 * block hides you from each other in Discover and stops new likes and
 * messages. They aren't told.
 */
export function BlockControl({
  studentId,
  name,
  blocked,
}: {
  studentId: string;
  name: string;
  blocked: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  function apply(next: boolean) {
    setError("");
    startTransition(async () => {
      const result = await setBlocked(studentId, next);
      if (result.ok) {
        setConfirming(false);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <section aria-label="Safety" className="border-line mt-8 border-t pt-6">
      {blocked ? (
        <div className="space-y-3">
          <p className="text-sm">
            You&apos;ve blocked {name}. You won&apos;t see each other in Discover, and neither of you can send
            new likes or messages.
          </p>
          <Button variant="secondary" onClick={() => apply(false)} disabled={isPending}>
            {isPending ? "Unblocking…" : `Unblock ${name}`}
          </Button>
        </div>
      ) : confirming ? (
        <div className="bg-accent-soft space-y-3 rounded-2xl p-4">
          <p className="text-sm leading-relaxed">
            <strong>Block {name}?</strong> You won&apos;t see each other in Discover, and neither of you can send
            new likes or messages. They won&apos;t be told. You can unblock them here later.
          </p>
          <div className="flex gap-2">
            <Button onClick={() => apply(true)} disabled={isPending}>
              {isPending ? "Blocking…" : "Block"}
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={isPending}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="text-muted hover:text-charcoal focus-visible:outline-accent inline-flex min-h-12 items-center gap-2 rounded-full text-sm font-semibold focus-visible:outline-2"
        >
          <Ban aria-hidden="true" className="size-4" />
          Block {name}
        </button>
      )}
      {error && (
        <p role="alert" className="text-accent-strong mt-2 text-sm font-medium">
          {error}
        </p>
      )}
    </section>
  );
}
