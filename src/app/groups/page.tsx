import { Plus, Users } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { GroupCard } from "@/components/groups/group-card";
import { GroupFilterBar } from "@/components/groups/group-filter-bar";
import { GroupsTabs } from "@/components/groups/groups-tabs";
import { AppShell } from "@/components/ui/app-shell";
import { BottomNav } from "@/components/ui/bottom-nav";
import { ButtonLink } from "@/components/ui/button";
import { Wordmark } from "@/components/ui/wordmark";
import { activeGroupFilters, parseGroupFilters } from "@/lib/group-filters";
import { countUnreadNotifications, GROUPS_PAGE, loadGroupDirectory } from "@/lib/groups";
import { requireStudent } from "@/lib/profile";

export const metadata: Metadata = { title: "Groups · Roomie" };

async function Directory({ searchParams }: { searchParams: PageProps<"/groups">["searchParams"] }) {
  const student = await requireStudent();
  const filters = parseGroupFilters(await searchParams);
  const [{ groups, total }, unread] = await Promise.all([
    loadGroupDirectory(student.user.id, filters),
    countUnreadNotifications(student.user.id),
  ]);
  const filtered = activeGroupFilters(filters).length > 0;

  return (
    <>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Groups</h1>
          <p className="text-muted mt-1 text-sm">Team up to find a flat, or fill one together.</p>
        </div>
        <ButtonLink href="/groups/new" className="min-h-11 shrink-0 px-4 text-sm">
          <Plus aria-hidden="true" className="size-4" />
          New group
        </ButtonLink>
      </div>
      <GroupsTabs current="discover" unread={unread} />
      <GroupFilterBar filters={filters} />

      {groups.length === 0 ? (
        <div className="rounded-card border-line flex flex-col items-center border border-dashed px-6 py-12 text-center">
          <span className="bg-forest-soft text-forest flex size-14 items-center justify-center rounded-full">
            <Users aria-hidden="true" className="size-7" />
          </span>
          <h2 className="font-display mt-4 text-2xl font-semibold">{filtered ? "No groups match" : "No groups yet"}</h2>
          <p className="text-muted mt-2 max-w-xs text-sm leading-relaxed">
            {filtered
              ? "Try removing a filter. Groups that haven't said something still show."
              : "Be the first: start a group and invite people you'd like to live with."}
          </p>
          <ButtonLink href={filtered ? "/groups" : "/groups/new"} className="mt-6">
            {filtered ? "Clear filters" : "Start a group"}
          </ButtonLink>
        </div>
      ) : (
        <>
          <ul className="space-y-3">
            {groups.map((data) => (
              <li key={data.group.id}>
                <GroupCard data={data} />
              </li>
            ))}
          </ul>
          {total > GROUPS_PAGE && (
            <p className="text-muted mt-4 text-center text-sm">
              Showing the {GROUPS_PAGE} most recently active groups. Use filters to narrow it down.
            </p>
          )}
        </>
      )}
    </>
  );
}

function Placeholder() {
  return (
    <div aria-hidden="true" className="space-y-3">
      <div className="bg-charcoal/5 h-9 w-1/2 animate-pulse rounded-xl" />
      <div className="bg-charcoal/5 rounded-card h-40 animate-pulse" />
      <div className="bg-charcoal/5 rounded-card h-40 animate-pulse" />
    </div>
  );
}

export default function GroupsPage({ searchParams }: PageProps<"/groups">) {
  return (
    <AppShell header={<Wordmark />} footer={<BottomNav current="Groups" />}>
      <Suspense fallback={<Placeholder />}>
        <Directory searchParams={searchParams} />
      </Suspense>
    </AppShell>
  );
}
