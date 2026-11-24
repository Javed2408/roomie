import { ArrowLeft, Lock, MessagesSquare, Pencil } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { GroupPhoto, InsightsList } from "@/components/groups/group-bits";
import { InvitePanel, MemberList, RequestList } from "@/components/groups/group-manage";
import { MembershipPanel } from "@/components/groups/membership-panel";
import { AppShell } from "@/components/ui/app-shell";
import { BottomNav } from "@/components/ui/bottom-nav";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { GENDER_PREFERENCES, ROOM_TYPES } from "@/lib/constants/preferences";
import { MOVE_IN_TIMEFRAMES } from "@/lib/constants/prompts";
import { capacityLabel, GROUP_STATUS_LABELS } from "@/lib/group-display";
import { unreadLabel } from "@/lib/group-chat";
import { loadChatSummaries } from "@/lib/group-chats";
import { budgetRangeLabel } from "@/lib/group-validation";
import { loadGroupView } from "@/lib/groups";
import { requireStudent } from "@/lib/profile";
import { firstName, headline } from "@/types/feed";

export const metadata: Metadata = { title: "Group · Roomie" };

const labelOf = (options: ReadonlyArray<{ value: string; label: string }>, value: string | null) =>
  options.find((option) => option.value === value)?.label ?? null;

function Section({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <Card className="p-5">
      <h2 id={id} className="font-display text-xl font-semibold">
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium">{value ?? "Not decided"}</dd>
    </div>
  );
}

async function GroupProfile({ params }: { params: PageProps<"/groups/[id]">["params"] }) {
  const student = await requireStudent();
  const { id } = await params;
  const view = await loadGroupView(student.user.id, id);
  if (!view) {
    notFound();
  }
  const { group, members, mine, isAdmin, requests, invites, insights, invitedBy } = view;
  const memberCount = members.length;
  const full = memberCount >= group.max_members;
  const isMember = mine?.status === "active";
  // Only members have a chat (and only they can count its unread messages).
  const unreadChat = isMember
    ? unreadLabel((await loadChatSummaries(student.user.id)).find((row) => row.group_id === group.id)?.unread_count ?? 0)
    : null;
  const admins = members.filter((member) => member.role === "admin");
  const successor =
    isAdmin && admins.length === 1
      ? (members
          .filter((member) => member.profile.id !== student.user.id)
          .sort((a, b) => (a.joinedAt ?? "").localeCompare(b.joinedAt ?? ""))[0]?.profile ?? null)
      : null;
  const closedReason =
    group.status === "archived"
      ? "This group has closed."
      : group.status === "housed"
        ? "This group has found a place and isn't taking new members."
        : group.status === "searching"
          ? "This group is complete and isn't taking new members."
          : !group.is_discoverable
            ? "This group is invite-only."
            : full
              ? "This group is full."
              : null;
  const person = (entry: (typeof members)[number]) => ({
    id: entry.profile.id,
    name: firstName(entry.profile),
    avatarUrl: entry.profile.avatar_url,
    headline: headline(entry.profile),
  });

  return (
    <article aria-labelledby="group-name" className="space-y-4">
      <header className="flex items-center gap-4">
        <GroupPhoto url={group.avatar_url} name={group.name} className="size-20 shrink-0 rounded-3xl text-2xl" />
        <div className="min-w-0">
          <h1 id="group-name" className="font-display text-3xl font-semibold tracking-tight">
            {group.name}
          </h1>
          <p className="text-muted text-sm">
            {GROUP_STATUS_LABELS[group.status]?.label} · {capacityLabel(memberCount || 0, group.max_members)}
          </p>
          {!group.is_discoverable && (
            <span className="bg-charcoal/5 mt-1 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold">
              <Lock aria-hidden="true" className="size-3" />
              Invite-only
            </span>
          )}
        </div>
      </header>

      <MembershipPanel
        groupId={group.id}
        groupName={group.name}
        status={mine?.status ?? null}
        role={mine?.role ?? null}
        invitedBy={invitedBy ? firstName(invitedBy) : null}
        inviteMessage={mine?.status === "invited" ? mine.message : null}
        canRequest={closedReason === null}
        closedReason={closedReason}
        successor={successor ? firstName(successor) : null}
        memberCount={memberCount}
      />

      {isMember && (
        <ButtonLink href={`/groups/${group.id}/chat`} fullWidth>
          <MessagesSquare aria-hidden="true" className="size-4" />
          Open group chat
          {unreadChat && (
            <span className="bg-accent text-cream ml-1 rounded-full px-2 text-xs leading-5 tabular-nums">
              {unreadChat}
              <span className="sr-only"> unread</span>
            </span>
          )}
        </ButtonLink>
      )}

      {isAdmin && (
        <ButtonLink href={`/groups/${group.id}/edit`} variant="secondary" fullWidth>
          <Pencil aria-hidden="true" className="size-4" />
          Edit group details
        </ButtonLink>
      )}

      {group.description && (
        <Section title="About">
          <p className="text-sm leading-relaxed whitespace-pre-line">{group.description}</p>
        </Section>
      )}

      <Section title="Housing">
        <dl className="space-y-2">
          <Detail
            label="Right now"
            value={group.housing_status === "has_accommodation" ? "Has a place" : group.housing_status === "needs_accommodation" ? "Looking for a place" : null}
          />
          <Detail label="Societies" value={group.preferred_societies.length ? group.preferred_societies.join(", ") : null} />
          <Detail label="Budget per person" value={budgetRangeLabel(group.budget_min, group.budget_max)?.concat("/mo") ?? null} />
          <Detail label="Moving in" value={labelOf(MOVE_IN_TIMEFRAMES, group.move_in_timeframe)} />
          <Detail label="Flat sizes" value={group.preferred_bhk_types.length ? group.preferred_bhk_types.join(", ") : null} />
          <Detail label="Rooms" value={labelOf(ROOM_TYPES, group.room_preference)} />
        </dl>
      </Section>

      <Section title="Who they're looking for">
        <dl className="space-y-2">
          <Detail label="Open to" value={labelOf(GENDER_PREFERENCES, group.preferred_gender)} />
          <Detail label="Group size" value={`Up to ${group.max_members} people`} />
        </dl>
        {group.requirements && <p className="mt-3 text-sm leading-relaxed">{group.requirements}</p>}
        {group.lifestyle_notes && (
          <>
            <h3 className="mt-4 text-sm font-semibold">Lifestyle expectations</h3>
            <p className="mt-1 text-sm leading-relaxed">{group.lifestyle_notes}</p>
          </>
        )}
      </Section>

      {(memberCount > 0 || !isMember) && (
        <Section title={isMember ? "Group insights" : "How you'd fit"}>
          <InsightsList insights={insights} />
          <p className="text-muted mt-3 text-xs">
            Based on what members{isMember ? "" : " and you"} shared on their profiles. Missing answers aren&apos;t counted.
          </p>
        </Section>
      )}

      <Section title={`Members (${memberCount})`} id="members">
        {members.length > 0 ? (
          <MemberList
            groupId={group.id}
            viewerId={student.user.id}
            isAdmin={isAdmin}
            members={members.map((member) => ({ ...person(member), role: member.role }))}
          />
        ) : (
          <p className="text-muted text-sm">You&apos;ll see the members once you join.</p>
        )}
      </Section>

      {isAdmin && (
        <>
          <Section title={`Join requests (${requests.length})`}>
            <RequestList
              groupId={group.id}
              full={full}
              requests={requests.map((request) => ({ ...person({ ...request, role: "member", joinedAt: null }), message: request.message, insights: request.insights }))}
            />
          </Section>
          <Section title="Invite students">
            <InvitePanel
              groupId={group.id}
              full={full}
              invites={invites.map((invite) => person({ ...invite, role: "member", joinedAt: null }))}
            />
          </Section>
        </>
      )}
    </article>
  );
}

function Placeholder() {
  return (
    <div aria-hidden="true" className="space-y-4">
      <div className="bg-charcoal/5 h-20 animate-pulse rounded-3xl" />
      <div className="bg-charcoal/5 rounded-card h-48 animate-pulse" />
    </div>
  );
}

export default function GroupPage({ params }: PageProps<"/groups/[id]">) {
  return (
    <AppShell
      header={
        <Link
          href="/groups"
          className="hover:bg-charcoal/5 focus-visible:outline-accent -ml-2 inline-flex min-h-12 items-center gap-2 rounded-full pr-4 pl-2 font-semibold focus-visible:outline-2"
        >
          <ArrowLeft aria-hidden="true" className="size-5" />
          Groups
        </Link>
      }
      footer={<BottomNav current="Groups" />}
    >
      <Suspense fallback={<Placeholder />}>
        <GroupProfile params={params} />
      </Suspense>
    </AppShell>
  );
}
