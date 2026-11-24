"use client";

import { Check, LogOut, Send, UserPlus, X } from "lucide-react";
import { useState, useTransition } from "react";

import { leaveGroup, requestToJoin, respondToInvite } from "@/app/groups/actions";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { TextAreaField } from "@/components/ui/fields";

type Sheet = "request" | "leave" | null;

/**
 * Your part in a group: ask to join, withdraw a request, answer an
 * invitation, or leave. The database decides what's allowed; this shows
 * the options that make sense and explains when something isn't possible.
 */
export function MembershipPanel({
  groupId,
  groupName,
  status,
  role,
  invitedBy,
  inviteMessage,
  canRequest,
  closedReason,
  successor,
  memberCount,
}: {
  groupId: string;
  groupName: string;
  status: string | null;
  role: string | null;
  invitedBy: string | null;
  inviteMessage: string | null;
  /** Discoverable, forming, not full. */
  canRequest: boolean;
  /** Why you can't ask to join right now, if you can't. */
  closedReason: string | null;
  /** When you're the only admin: who'd take over if you left. */
  successor: string | null;
  memberCount: number;
}) {
  const [sheet, setSheet] = useState<Sheet>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError("");
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        setSheet(null);
        setNote("");
      } else {
        setError(result.error);
      }
    });
  }

  const errorLine = error && !sheet && (
    <p role="alert" className="text-accent-strong mt-2 text-sm font-medium">
      {error}
    </p>
  );

  if (status === "invited") {
    return (
      <div className="bg-forest-soft rounded-card space-y-3 p-4">
        <p className="text-sm">
          <strong>{invitedBy ?? "An admin"}</strong> invited you to join <strong>{groupName}</strong>.
        </p>
        {inviteMessage && <p className="bg-surface rounded-2xl p-3 text-sm italic">“{inviteMessage}”</p>}
        <div className="grid grid-cols-2 gap-2">
          <Button disabled={isPending} onClick={() => run(() => respondToInvite(groupId, true))}>
            <Check aria-hidden="true" className="size-4" />
            Accept
          </Button>
          <Button variant="secondary" disabled={isPending} onClick={() => run(() => respondToInvite(groupId, false))}>
            <X aria-hidden="true" className="size-4" />
            Decline
          </Button>
        </div>
        {errorLine}
      </div>
    );
  }

  if (status === "requested") {
    return (
      <div className="bg-surface border-line rounded-card space-y-3 border p-4">
        <p className="text-sm">
          <strong>Request sent.</strong> An admin will accept or decline it; you&apos;ll see the answer in Updates.
        </p>
        <Button variant="secondary" disabled={isPending} onClick={() => run(() => leaveGroup(groupId))}>
          Withdraw request
        </Button>
        {errorLine}
      </div>
    );
  }

  if (status === "active") {
    const onlyAdmin = role === "admin" && successor !== null;
    return (
      <>
        <Button variant="ghost" className="text-accent-strong min-h-11 px-3 text-sm" onClick={() => setSheet("leave")}>
          <LogOut aria-hidden="true" className="size-4" />
          Leave group
        </Button>
        {errorLine}
        {sheet === "leave" && (
          <BottomSheet
            title={`Leave ${groupName}?`}
            onClose={() => setSheet(null)}
            footer={
              <div className="space-y-2">
                {error && (
                  <p role="alert" className="text-accent-strong text-sm font-medium">
                    {error}
                  </p>
                )}
                <Button fullWidth disabled={isPending} onClick={() => run(() => leaveGroup(groupId))}>
                  {isPending ? "Leaving…" : "Leave group"}
                </Button>
                <Button fullWidth variant="secondary" onClick={() => setSheet(null)}>
                  Stay
                </Button>
              </div>
            }
          >
            <p className="text-sm leading-relaxed">
              {memberCount <= 1
                ? "You're the last member, so the group will close."
                : onlyAdmin && successor
                  ? `You're the only admin. If you leave, ${successor} becomes the admin. To choose someone else, make them an admin first in the members list.`
                  : "You can ask to join again later if the group is open."}
            </p>
          </BottomSheet>
        )}
      </>
    );
  }

  if (status === "removed") {
    return <p className="text-muted text-sm">You were removed from this group, so you can&apos;t rejoin it.</p>;
  }

  return (
    <>
      {canRequest ? (
        <Button fullWidth onClick={() => setSheet("request")}>
          <UserPlus aria-hidden="true" className="size-4" />
          Ask to join
        </Button>
      ) : (
        closedReason && <p className="text-muted text-sm">{closedReason}</p>
      )}
      {errorLine}
      {sheet === "request" && (
        <BottomSheet
          title={`Ask to join ${groupName}`}
          onClose={() => setSheet(null)}
          footer={
            <div className="space-y-2">
              {error && (
                <p role="alert" className="text-accent-strong text-sm font-medium">
                  {error}
                </p>
              )}
              <Button fullWidth disabled={isPending} onClick={() => run(() => requestToJoin(groupId, note))}>
                <Send aria-hidden="true" className="size-4" />
                {isPending ? "Sending…" : "Send request"}
              </Button>
            </div>
          }
        >
          <TextAreaField
            label="Introduce yourself (optional)"
            placeholder="e.g. Second-year CSE, tidy, usually up early. Looking at Estancia too!"
            rows={4}
            maxLength={300}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            hint={`${note.length}/300 · Admins see your profile too.`}
          />
        </BottomSheet>
      )}
    </>
  );
}
