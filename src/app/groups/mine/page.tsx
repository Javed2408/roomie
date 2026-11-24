import { ChevronRight, Crown, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { GroupPhoto } from "@/components/groups/group-bits";
import { GroupsTabs } from "@/components/groups/groups-tabs";
import { AppShell } from "@/components/ui/app-shell";
import { Avatar } from "@/components/ui/avatar";
import { BottomNav } from "@/components/ui/bottom-nav";
import { ButtonLink } from "@/components/ui/button";
import { Wordmark } from "@/components/ui/wordmark";
import { capacityLabel, GROUP_STATUS_LABELS } from "@/lib/group-display";
import { countUnreadNotifications, loadGroupDashboard } from "@/lib/groups";
import { requireStudent } from "@/lib/profile";
import { formatDate } from "@/lib/listing-display";
import { firstName } from "@/types/feed";

export const metadata: Metadata = { title: "Your groups · Roomie" };

function Block({ title, count, empty, children }: { title: string; count: number; empty: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="font-display mb-2 text-xl font-semibold">
        {title} <span className="text-muted text-base font-normal">({count})</span>
      </h2>
      {count === 0 ? (
        <p className="text-muted bg-surface border-line rounded-card border px-4 py-3 text-sm">{empty}</p>
      ) : (
        <ul className="bg-surface border-line rounded-card divide-line divide-y overflow-hidden border">{children}</ul>
      )}
    </section>
  );
}

function Row({ href, left, title, subtitle, right }: { href: string; left: ReactNode; title: ReactNode; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <li>
      <Link
        href={href}
        className="hover:bg-charcoal/[0.03] focus-visible:outline-accent flex min-h-16 items-center gap-3 px-4 py-2.5 focus-visible:outline-2 focus-visible:-outline-offset-2"
      >
        {left}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{title}</span>
          {subtitle && <span className="text-muted block truncate text-xs">{subtitle}</span>}
        </span>
        {right}
        <ChevronRight aria-hidden="true" className="text-muted size-4 shrink-0" />
      </Link>
    </li>
  );
}

const OUTCOME: Record<string, string> = {
  request_approved: "Accepted",
  request_declined: "Not accepted",
  invite_cancelled: "Invitation withdrawn",
  member_removed: "Removed",
};

async function Dashboard() {
  const student = await requireStudent();
  const [dashboard, unread] = await Promise.all([
    loadGroupDashboard(student.user.id),
    countUnreadNotifications(student.user.id),
  ]);
  const { memberOf, invitations, requests, outcomes, approvals, sentInvites } = dashboard;
  const photo = (group: { avatar_url: string | null; name: string }) => (
    <GroupPhoto url={group.avatar_url} name={group.name} className="size-11 shrink-0 rounded-xl text-sm" />
  );

  return (
    <>
      <div className="mb-4 flex items-end justify-between gap-3">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Your groups</h1>
        <ButtonLink href="/groups/new" className="min-h-11 shrink-0 px-4 text-sm">
          <Plus aria-hidden="true" className="size-4" />
          New group
        </ButtonLink>
      </div>
      <GroupsTabs current="mine" unread={unread} />

      <div className="space-y-7">
        <Block title="Invitations for you" count={invitations.length} empty="No invitations right now.">
          {invitations.map((entry) => (
            <Row
              key={entry.group.id}
              href={`/groups/${entry.group.id}`}
              left={photo(entry.group)}
              title={entry.group.name}
              subtitle={entry.message ? `“${entry.message}”` : "Open to accept or decline"}
            />
          ))}
        </Block>

        <Block title="Waiting for your approval" count={approvals.length} empty="No join requests to answer.">
          {approvals.map((entry) => (
            <Row
              key={`${entry.group.id}:${entry.person.id}`}
              href={`/groups/${entry.group.id}`}
              left={<Avatar url={entry.person.avatar_url} name={firstName(entry.person)} className="size-11 shrink-0 rounded-full" />}
              title={`${firstName(entry.person)} wants to join`}
              subtitle={entry.group.name}
            />
          ))}
        </Block>

        <Block title="Groups you're in" count={memberOf.length} empty="You're not in a group yet. Browse groups or start one.">
          {memberOf.map((entry) => (
            <Row
              key={entry.group.id}
              href={`/groups/${entry.group.id}`}
              left={photo(entry.group)}
              title={entry.group.name}
              subtitle={`${GROUP_STATUS_LABELS[entry.group.status]?.label} · ${capacityLabel(entry.memberCount, entry.group.max_members)}`}
              right={
                entry.role === "admin" ? (
                  <span className="bg-accent-soft text-accent-strong inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold">
                    <Crown aria-hidden="true" className="size-3" />
                    Admin
                  </span>
                ) : null
              }
            />
          ))}
        </Block>

        <Block title="Your join requests" count={requests.length + outcomes.length} empty="You haven't asked to join a group.">
          {requests.map((entry) => (
            <Row
              key={entry.group.id}
              href={`/groups/${entry.group.id}`}
              left={photo(entry.group)}
              title={entry.group.name}
              subtitle={`Waiting since ${formatDate(entry.updatedAt)}`}
              right={<span className="text-muted shrink-0 text-xs">Pending</span>}
            />
          ))}
          {outcomes.map((outcome) => (
            <Row
              key={`${outcome.groupId}:${outcome.at}`}
              href={`/groups/${outcome.groupId}`}
              left={<GroupPhoto url={null} name={outcome.groupName} className="size-11 shrink-0 rounded-xl text-sm" />}
              title={outcome.groupName}
              subtitle={formatDate(outcome.at)}
              right={
                <span className={`shrink-0 text-xs font-semibold ${outcome.kind === "request_approved" ? "text-forest" : "text-muted"}`}>
                  {OUTCOME[outcome.kind]}
                </span>
              }
            />
          ))}
        </Block>

        <Block title="Invitations you've sent" count={sentInvites.length} empty="No open invitations from your groups.">
          {sentInvites.map((entry) => (
            <Row
              key={`${entry.group.id}:${entry.person.id}`}
              href={`/groups/${entry.group.id}`}
              left={<Avatar url={entry.person.avatar_url} name={firstName(entry.person)} className="size-11 shrink-0 rounded-full" />}
              title={firstName(entry.person)}
              subtitle={`Invited to ${entry.group.name}`}
            />
          ))}
        </Block>
      </div>
    </>
  );
}

function Placeholder() {
  return (
    <div aria-hidden="true" className="space-y-4">
      <div className="bg-charcoal/5 h-9 w-1/2 animate-pulse rounded-xl" />
      <div className="bg-charcoal/5 rounded-card h-32 animate-pulse" />
      <div className="bg-charcoal/5 rounded-card h-32 animate-pulse" />
    </div>
  );
}

export default function MyGroupsPage() {
  return (
    <AppShell header={<Wordmark />} footer={<BottomNav current="Groups" />}>
      <Suspense fallback={<Placeholder />}>
        <Dashboard />
      </Suspense>
    </AppShell>
  );
}
