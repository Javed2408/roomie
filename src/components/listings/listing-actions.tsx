"use client";

import { Eye, EyeOff, Pencil, Radio, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { deleteListing, setListingStatus } from "@/app/account/listings/actions";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button, ButtonLink } from "@/components/ui/button";
import type { ListingStatus } from "@/types/database";

type Sheet =
  | { kind: "conflict"; live: { id: string; title: string } }
  | { kind: "delete" }
  | null;

/**
 * What a student can do with one of their listings: view or preview, edit,
 * publish / reactivate, deactivate and delete. Publishing while another
 * listing is live asks which one to keep live; deleting asks first.
 */
export function ListingActions({
  id,
  title,
  status,
  canPublish,
  afterDelete = "/account/listings",
  showView = true,
}: {
  id: string;
  title: string;
  status: ListingStatus;
  /** False while the student's housing says they need a place. */
  canPublish: boolean;
  afterDelete?: string;
  showView?: boolean;
}) {
  const router = useRouter();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  function changeStatus(next: "active" | "inactive", replaceId?: string) {
    setError("");
    startTransition(async () => {
      const result = await setListingStatus(id, next, replaceId);
      if (result.ok) {
        setSheet(null);
      } else if ("conflict" in result) {
        setSheet({ kind: "conflict", live: result.conflict });
      } else {
        setError(result.error);
      }
    });
  }

  function remove() {
    setError("");
    startTransition(async () => {
      const result = await deleteListing(id);
      if (result.ok) {
        setSheet(null);
        router.push(afterDelete);
      } else {
        setError(result.error);
      }
    });
  }

  const small = "min-h-11 px-4 text-sm";
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {showView && (
          <ButtonLink href={`/listings/${id}`} variant="secondary" className={small}>
            <Eye aria-hidden="true" className="size-4" />
            {status === "active" ? "View" : "Preview"}
          </ButtonLink>
        )}
        <ButtonLink href={`/account/listings/${id}/edit`} variant="secondary" className={small}>
          <Pencil aria-hidden="true" className="size-4" />
          Edit
        </ButtonLink>
        {status === "active" ? (
          <Button variant="secondary" className={small} disabled={isPending} onClick={() => changeStatus("inactive")}>
            <EyeOff aria-hidden="true" className="size-4" />
            Deactivate
          </Button>
        ) : (
          <Button className={small} disabled={isPending || !canPublish} onClick={() => changeStatus("active")}>
            <Radio aria-hidden="true" className="size-4" />
            {status === "draft" ? "Publish" : "Reactivate"}
          </Button>
        )}
        <Button
          variant="ghost"
          className={`${small} text-accent-strong`}
          disabled={isPending}
          onClick={() => {
            setError("");
            setSheet({ kind: "delete" });
          }}
        >
          <Trash2 aria-hidden="true" className="size-4" />
          Delete
        </Button>
      </div>
      {!canPublish && status !== "active" && (
        <p className="text-muted mt-2 text-sm">
          To publish, set your housing to &quot;I have a place&quot; in your profile.
        </p>
      )}
      {error && !sheet && (
        <p role="alert" className="text-accent-strong mt-2 text-sm font-medium">
          {error}
        </p>
      )}

      {sheet?.kind === "conflict" && (
        <BottomSheet
          title="One live listing at a time"
          onClose={() => setSheet(null)}
          footer={
            <div className="space-y-2">
              {error && (
                <p role="alert" className="text-accent-strong text-sm font-medium">
                  {error}
                </p>
              )}
              <Button fullWidth disabled={isPending} onClick={() => changeStatus("active", sheet.live.id)}>
                {isPending ? "Switching…" : `Deactivate ${sheet.live.title} and publish this`}
              </Button>
              <Button fullWidth variant="secondary" disabled={isPending} onClick={() => setSheet(null)}>
                Keep {sheet.live.title} live
              </Button>
            </div>
          }
        >
          <p className="text-sm leading-relaxed">
            Your <strong>{sheet.live.title}</strong> listing is live right now. Students can see one
            listing of yours at a time, so publishing <strong>{title}</strong> means deactivating it.
            Nothing changes unless you choose.
          </p>
        </BottomSheet>
      )}

      {sheet?.kind === "delete" && (
        <BottomSheet
          title="Delete this listing?"
          onClose={() => setSheet(null)}
          footer={
            <div className="space-y-2">
              {error && (
                <p role="alert" className="text-accent-strong text-sm font-medium">
                  {error}
                </p>
              )}
              <Button fullWidth disabled={isPending} onClick={remove}>
                {isPending ? "Deleting…" : "Delete for good"}
              </Button>
              <Button fullWidth variant="secondary" disabled={isPending} onClick={() => setSheet(null)}>
                Cancel
              </Button>
            </div>
          }
        >
          <p className="text-sm leading-relaxed">
            <strong>{title}</strong> and its photos will be deleted. This can&apos;t be undone. Your
            matches and messages stay as they are.
            {status === "active" ? " If you only want to hide it for now, deactivate it instead." : ""}
          </p>
        </BottomSheet>
      )}
    </div>
  );
}
