"use client";

import { Check, Crown, MailPlus, MoreHorizontal, Search, UserMinus, X } from "lucide-react";
import Link from "next/link";
import { useState, useTransition, type FormEvent, type ReactNode } from "react";

import { cancelInvite, inviteStudent, removeMember, reviewRequest, searchStudents, setMemberRole } from "@/app/groups/actions";
import { InsightsList } from "@/components/groups/group-bits";
import { Avatar } from "@/components/ui/avatar";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { TextAreaField, TextField } from "@/components/ui/fields";
import type { GroupInsights } from "@/lib/group-compatibility";
import type { GroupInviteCandidate } from "@/types/database";

type Person = {
  id: string;
  name: string;
  avatarUrl: string | null;
  headline: string | null;
};

type Result = { ok: true } | { ok: false; error: string };

/** Run a membership action and keep track of its error. */
function useAction() {
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const run = (action: () => Promise<Result>, onDone?: () => void) => {
    setError("");
    startTransition(async () => {
      const result = await action();
      if (result.ok) onDone?.();
      else setError(result.error);
    });
  };
  return { error, isPending, run, setError };
}

function PersonLine({ person, extra }: { person: Person; extra?: ReactNode }) {
  return (
    <Link
      href={`/students/${person.id}`}
      className="focus-visible:outline-accent flex min-w-0 flex-1 items-center gap-3 rounded-2xl focus-visible:outline-2"
    >
      <Avatar url={person.avatarUrl} name={person.name} className="size-11 shrink-0 rounded-full text-base" />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 font-semibold">
          <span className="truncate">{person.name}</span>
          {extra}
        </span>
        {person.headline && <span className="text-muted block truncate text-xs">{person.headline}</span>}
      </span>
    </Link>
  );
}

/**
 * The members, each linking to their public profile. Admins can make
 * someone an admin, step them back to member, or remove them.
 */
export function MemberList({
  groupId,
  members,
  viewerId,
  isAdmin,
}: {
  groupId: string;
  members: Array<Person & { role: "admin" | "member" }>;
  viewerId: string;
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState<(Person & { role: "admin" | "member" }) | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const { error, isPending, run, setError } = useAction();
  const close = () => {
    setOpen(null);
    setConfirmRemove(false);
    setError("");
  };

  return (
    <>
      <ul className="divide-line divide-y">
        {members.map((member) => (
          <li key={member.id} className="flex items-center gap-2 py-2.5">
            <PersonLine
              person={member}
              extra={
                <>
                  {member.role === "admin" && (
                    <span className="bg-accent-soft text-accent-strong inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold">
                      <Crown aria-hidden="true" className="size-3" />
                      Admin
                    </span>
                  )}
                  {member.id === viewerId && <span className="text-muted text-xs font-normal">(you)</span>}
                </>
              }
            />
            {isAdmin && member.id !== viewerId && (
              <button
                type="button"
                onClick={() => setOpen(member)}
                aria-label={`Manage ${member.name}`}
                className="hover:bg-charcoal/5 focus-visible:outline-accent flex size-11 shrink-0 items-center justify-center rounded-full focus-visible:outline-2"
              >
                <MoreHorizontal aria-hidden="true" className="size-5" />
              </button>
            )}
          </li>
        ))}
      </ul>

      {open && (
        <BottomSheet title={open.name} onClose={close}>
          {confirmRemove ? (
            <div className="space-y-3">
              <p className="text-sm leading-relaxed">
                Remove <strong>{open.name}</strong> from the group? They won&apos;t be able to ask to rejoin. Their
                profile isn&apos;t affected.
              </p>
              {error && <p role="alert" className="text-accent-strong text-sm font-medium">{error}</p>}
              <div className="grid grid-cols-2 gap-2">
                <Button disabled={isPending} onClick={() => run(() => removeMember(groupId, open.id), close)}>
                  {isPending ? "Removing…" : "Remove"}
                </Button>
                <Button variant="secondary" onClick={() => setConfirmRemove(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {error && <p role="alert" className="text-accent-strong text-sm font-medium">{error}</p>}
              <Button
                fullWidth
                variant="secondary"
                disabled={isPending}
                onClick={() => run(() => setMemberRole(groupId, open.id, open.role === "admin" ? "member" : "admin"), close)}
              >
                <Crown aria-hidden="true" className="size-4" />
                {open.role === "admin" ? "Make a member (not admin)" : "Make an admin"}
              </Button>
              <Button fullWidth variant="ghost" className="text-accent-strong" onClick={() => setConfirmRemove(true)}>
                <UserMinus aria-hidden="true" className="size-4" />
                Remove from group
              </Button>
            </div>
          )}
        </BottomSheet>
      )}
    </>
  );
}

/** Join requests for admins: who's asking, their note, how they'd fit. */
export function RequestList({
  groupId,
  requests,
  full,
}: {
  groupId: string;
  requests: Array<Person & { message: string | null; insights?: GroupInsights }>;
  full: boolean;
}) {
  const { error, isPending, run } = useAction();
  if (requests.length === 0) {
    return <p className="text-muted text-sm">No requests right now.</p>;
  }
  return (
    <ul className="space-y-4">
      {error && <li role="alert" className="text-accent-strong text-sm font-medium">{error}</li>}
      {requests.map((request) => (
        <li key={request.id} className="bg-cream rounded-2xl p-3">
          <PersonLine person={request} />
          {request.message && <p className="mt-2 text-sm italic">“{request.message}”</p>}
          {request.insights && (
            <div className="mt-2">
              <p className="text-muted mb-1 text-xs font-semibold tracking-wide uppercase">How they&apos;d fit</p>
              <InsightsList insights={request.insights} showGroup={false} />
            </div>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button className="min-h-11 text-sm" disabled={isPending || full} onClick={() => run(() => reviewRequest(groupId, request.id, true))}>
              <Check aria-hidden="true" className="size-4" />
              Accept
            </Button>
            <Button variant="secondary" className="min-h-11 text-sm" disabled={isPending} onClick={() => run(() => reviewRequest(groupId, request.id, false))}>
              <X aria-hidden="true" className="size-4" />
              Decline
            </Button>
          </div>
          {full && <p className="text-muted mt-2 text-xs">The group is full. Make room or raise the group size to accept.</p>}
        </li>
      ))}
    </ul>
  );
}

const STANDING: Record<string, string> = {
  active: "Already a member",
  invited: "Invited",
};

/** Find SRM students by name and invite them; see and cancel open invitations. */
export function InvitePanel({
  groupId,
  invites,
  full,
}: {
  groupId: string;
  invites: Person[];
  full: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GroupInviteCandidate[] | null>(null);
  const [searching, startSearch] = useTransition();
  const [inviting, setInviting] = useState<GroupInviteCandidate | null>(null);
  const [note, setNote] = useState("");
  const { error, isPending, run, setError } = useAction();

  function search(event: FormEvent) {
    event.preventDefault();
    setError("");
    startSearch(async () => {
      const result = await searchStudents(groupId, query);
      if (result.ok) setResults(result.results);
      else setError(result.error);
    });
  }

  return (
    <div className="space-y-4">
      <form onSubmit={search} className="flex items-end gap-2" role="search">
        <div className="flex-1">
          <TextField
            label="Find students by name"
            placeholder="At least 2 letters"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={60}
          />
        </div>
        <Button type="submit" variant="secondary" className="px-4" disabled={searching || query.trim().length < 2} aria-label="Search">
          <Search aria-hidden="true" className="size-4" />
        </Button>
      </form>
      {error && !inviting && <p role="alert" className="text-accent-strong text-sm font-medium">{error}</p>}
      {results && (
        <div aria-live="polite">
          {results.length === 0 ? (
            <p className="text-muted text-sm">No SRM students found with that name.</p>
          ) : (
            <ul className="divide-line divide-y">
              {results.map((student) => {
                const standing = student.membership ? (STANDING[student.membership] ?? null) : null;
                // Inviting someone who asked to join accepts them, so that's allowed too.
                const canInvite = !full && student.membership !== "active" && student.membership !== "invited";
                return (
                  <li key={student.profile_id} className="flex items-center gap-2 py-2.5">
                    <PersonLine
                      person={{
                        id: student.profile_id,
                        name: student.full_name ?? "Student",
                        avatarUrl: student.avatar_url,
                        headline: [student.department, student.year_of_study ? `Year ${student.year_of_study}` : null].filter(Boolean).join(" · ") || null,
                      }}
                    />
                    {canInvite ? (
                      <Button className="min-h-11 shrink-0 px-4 text-sm" onClick={() => { setInviting(student); setNote(""); setError(""); }}>
                        <MailPlus aria-hidden="true" className="size-4" />
                        Invite
                      </Button>
                    ) : (
                      <span className="text-muted shrink-0 text-xs">{standing ?? (full ? "Group full" : "")}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <div>
        <h3 className="mb-2 text-sm font-semibold">Waiting for an answer ({invites.length})</h3>
        {invites.length === 0 ? (
          <p className="text-muted text-sm">No open invitations.</p>
        ) : (
          <ul className="divide-line divide-y">
            {invites.map((invite) => (
              <li key={invite.id} className="flex items-center gap-2 py-2.5">
                <PersonLine person={invite} />
                <Button variant="ghost" className="min-h-11 shrink-0 px-3 text-sm" disabled={isPending} onClick={() => run(() => cancelInvite(groupId, invite.id))}>
                  Cancel
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {inviting && (
        <BottomSheet
          title={`Invite ${inviting.full_name?.split(" ")[0] ?? "this student"}`}
          onClose={() => setInviting(null)}
          footer={
            <div className="space-y-2">
              {error && <p role="alert" className="text-accent-strong text-sm font-medium">{error}</p>}
              <Button
                fullWidth
                disabled={isPending}
                onClick={() =>
                  run(
                    () => inviteStudent(groupId, inviting.profile_id, note),
                    () => {
                      setInviting(null);
                      setResults((current) =>
                        current?.map((item) => (item.profile_id === inviting.profile_id ? { ...item, membership: "invited" } : item)) ?? null,
                      );
                    },
                  )
                }
              >
                <MailPlus aria-hidden="true" className="size-4" />
                {isPending ? "Sending…" : "Send invitation"}
              </Button>
            </div>
          }
        >
          {inviting.about && <p className="text-muted mb-4 text-sm">{inviting.about}</p>}
          <TextAreaField
            label="Add a note (optional)"
            placeholder="e.g. We're three tidy second-years looking at Estancia. Want to join?"
            rows={3}
            maxLength={300}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            hint={`${note.length}/300`}
          />
        </BottomSheet>
      )}
    </div>
  );
}
