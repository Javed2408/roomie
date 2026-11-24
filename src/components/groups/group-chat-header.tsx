"use client";

import { ArrowLeft, Crown, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { GroupPhoto } from "@/components/groups/group-bits";
import { Avatar } from "@/components/ui/avatar";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button, ButtonLink } from "@/components/ui/button";
import type { ChatPerson } from "@/lib/group-chats";

export type Connection = "connecting" | "live" | "offline";

const CONNECTION: Record<Connection, { label: string; dot: string }> = {
  connecting: { label: "Connecting…", dot: "bg-muted" },
  live: { label: "Live", dot: "bg-forest" },
  offline: { label: "Offline, reconnecting…", dot: "bg-accent" },
};

/**
 * The group chat's top bar: back to the group, who it is, how many are in,
 * whether live updates are working, and the active members one tap away.
 */
export function GroupChatHeader({
  groupId,
  name,
  avatarUrl,
  members,
  connection,
  myId,
}: {
  groupId: string;
  name: string;
  avatarUrl: string | null;
  members: Array<ChatPerson & { isAdmin: boolean }>;
  connection: Connection;
  myId: string;
}) {
  const [open, setOpen] = useState(false);
  const status = CONNECTION[connection];

  return (
    <div className="-mx-2 flex items-center gap-2">
      <Link
        href={`/groups/${groupId}`}
        aria-label="Back to the group"
        className="hover:bg-charcoal/5 focus-visible:outline-accent flex size-12 shrink-0 items-center justify-center rounded-full focus-visible:outline-2"
      >
        <ArrowLeft aria-hidden="true" className="size-5" />
      </Link>
      <GroupPhoto url={avatarUrl} name={name} className="size-10 shrink-0 rounded-xl text-sm" />
      <div className="min-w-0 flex-1">
        <h1 className="truncate font-semibold">{name}</h1>
        <p className="text-muted flex items-center gap-1.5 truncate text-xs">
          <span>
            {members.length} {members.length === 1 ? "member" : "members"}
          </span>
          <span aria-hidden="true">·</span>
          <span role="status" className="inline-flex items-center gap-1">
            <span aria-hidden="true" className={`size-1.5 rounded-full ${status.dot}`} />
            {status.label}
          </span>
        </p>
      </div>
      <Button variant="secondary" className="shrink-0 px-4 text-sm" onClick={() => setOpen(true)}>
        <Users aria-hidden="true" className="size-4" />
        Members
      </Button>

      {open && (
        <BottomSheet title={`Members (${members.length})`} onClose={() => setOpen(false)}>
          <ul className="divide-line divide-y">
            {members.map((member) => (
              <li key={member.id}>
                <Link
                  href={`/students/${member.id}`}
                  className="focus-visible:outline-accent flex min-h-14 items-center gap-3 rounded-2xl py-2 focus-visible:outline-2"
                >
                  <Avatar url={member.avatarUrl} name={member.name} className="size-11 shrink-0 rounded-full text-base" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 font-semibold">
                      <span className="truncate">{member.name}</span>
                      {member.id === myId && <span className="text-muted text-xs font-normal">(you)</span>}
                      {member.isAdmin && (
                        <span className="bg-accent-soft text-accent-strong inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold">
                          <Crown aria-hidden="true" className="size-3" />
                          Admin
                        </span>
                      )}
                    </span>
                    {member.headline && <span className="text-muted block truncate text-xs">{member.headline}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <ButtonLink href={`/groups/${groupId}`} variant="secondary" fullWidth className="mt-4">
            View group page
          </ButtonLink>
        </BottomSheet>
      )}
    </div>
  );
}
