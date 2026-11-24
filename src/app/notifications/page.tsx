import { Bell } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { GroupsTabs } from "@/components/groups/groups-tabs";
import { MarkAllRead } from "@/components/groups/mark-read";
import { AppShell } from "@/components/ui/app-shell";
import { Avatar } from "@/components/ui/avatar";
import { BottomNav } from "@/components/ui/bottom-nav";
import { Wordmark } from "@/components/ui/wordmark";
import { notificationText } from "@/lib/group-display";
import { loadNotifications } from "@/lib/groups";
import { requireStudent } from "@/lib/profile";
import { formatDate } from "@/lib/listing-display";
import { firstName } from "@/types/feed";

export const metadata: Metadata = { title: "Updates · Roomie" };

/** Group updates for you: invitations, answers, changes to your groups. */
async function Updates() {
  const student = await requireStudent();
  const notifications = await loadNotifications(student.user.id);
  const unread = notifications.filter((item) => !item.read).length;

  return (
    <>
      <div className="mb-4 flex items-end justify-between gap-3">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Updates</h1>
        {unread > 0 && <MarkAllRead />}
      </div>
      <GroupsTabs current="updates" unread={unread} />
      {notifications.length === 0 ? (
        <div className="rounded-card border-line flex flex-col items-center border border-dashed px-6 py-12 text-center">
          <span className="bg-accent-soft text-accent-strong flex size-14 items-center justify-center rounded-full">
            <Bell aria-hidden="true" className="size-7" />
          </span>
          <h2 className="font-display mt-4 text-2xl font-semibold">Nothing new</h2>
          <p className="text-muted mt-2 max-w-xs text-sm">Invitations, answers to your requests and group changes show up here.</p>
        </div>
      ) : (
        <ul className="bg-surface border-line rounded-card divide-line divide-y overflow-hidden border">
          {notifications.map((item) => {
            const who = item.kind === "invited" ? item.actor : (item.subject ?? item.actor);
            return (
              <li key={item.id}>
                <Link
                  href={`/groups/${item.groupId}`}
                  className={`hover:bg-charcoal/[0.03] focus-visible:outline-accent flex gap-3 px-4 py-3 focus-visible:outline-2 focus-visible:-outline-offset-2 ${item.read ? "" : "bg-accent-soft/40"}`}
                >
                  <Avatar url={who?.avatar_url ?? null} name={who ? firstName(who) : "Group"} className="size-10 shrink-0 rounded-full text-sm" />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm ${item.read ? "" : "font-semibold"}`}>
                      {notificationText({
                        kind: item.kind,
                        groupName: item.groupName,
                        actor: item.actor ? firstName(item.actor) : null,
                        subject: item.subject ? firstName(item.subject) : null,
                        detail: item.detail,
                      })}
                    </span>
                    {item.detail && (item.kind === "invited" || item.kind === "requested") && (
                      <span className="text-muted mt-0.5 block text-sm italic">“{item.detail}”</span>
                    )}
                    <span className="text-muted mt-0.5 block text-xs">
                      {formatDate(item.at)}
                      {!item.read && <span className="sr-only"> (unread)</span>}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

export default function NotificationsPage() {
  return (
    <AppShell header={<Wordmark />} footer={<BottomNav current="Groups" />}>
      <Suspense fallback={<div aria-hidden="true" className="bg-charcoal/5 rounded-card h-48 animate-pulse" />}>
        <Updates />
      </Suspense>
    </AppShell>
  );
}
