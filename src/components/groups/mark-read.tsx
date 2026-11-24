"use client";

import { CheckCheck } from "lucide-react";
import { useState, useTransition } from "react";

import { markNotificationsRead } from "@/app/groups/actions";
import { Button } from "@/components/ui/button";

/** Mark every update as read. */
export function MarkAllRead() {
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  return (
    <div>
      <Button
        variant="secondary"
        className="min-h-11 px-4 text-sm"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await markNotificationsRead();
            setError(result.ok ? "" : result.error);
          })
        }
      >
        <CheckCheck aria-hidden="true" className="size-4" />
        Mark all read
      </Button>
      {error && <p role="alert" className="text-accent-strong mt-1 text-sm">{error}</p>}
    </div>
  );
}
