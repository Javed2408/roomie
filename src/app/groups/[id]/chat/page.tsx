import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { GroupChatRoom } from "@/components/groups/group-chat-room";
import { AppShell } from "@/components/ui/app-shell";
import { loadGroupChat } from "@/lib/group-chats";
import { requireStudent } from "@/lib/profile";
import { currentDays } from "@/lib/time";

export const metadata: Metadata = { title: "Group chat · Roomie" };

/**
 * Only active members can open a group's chat. The database enforces that
 * on every read and write; here a non-member is simply sent to the group's
 * page, and a missing or hidden group shows "not found".
 */
async function Chat({ params }: { params: PageProps<"/groups/[id]/chat">["params"] }) {
  const student = await requireStudent();
  const { id } = await params;
  const chat = await loadGroupChat(id);
  if (chat === "not-found") {
    notFound();
  }
  if (chat === "not-member") {
    redirect(`/groups/${id}`);
  }
  return <GroupChatRoom myId={student.user.id} days={currentDays()} {...chat} />;
}

/** The chat's frame while it loads: a working back button, then shapes. */
function ChatPlaceholder({ groupId }: { groupId: string }) {
  return (
    <AppShell
      header={
        <div className="-mx-2 flex items-center gap-2">
          <Link
            href={`/groups/${groupId}`}
            aria-label="Back to the group"
            className="hover:bg-charcoal/5 focus-visible:outline-accent flex size-12 shrink-0 items-center justify-center rounded-full focus-visible:outline-2"
          >
            <ArrowLeft aria-hidden="true" className="size-5" />
          </Link>
          <div aria-hidden="true" className="bg-charcoal/5 size-10 animate-pulse rounded-xl" />
          <div aria-hidden="true" className="bg-charcoal/5 h-5 w-28 animate-pulse rounded-lg" />
        </div>
      }
      footer={<div aria-hidden="true" className="h-[4.25rem]" />}
    >
      <div aria-hidden="true" className="space-y-3">
        <div className="bg-charcoal/5 h-10 w-2/3 animate-pulse rounded-3xl" />
        <div className="bg-charcoal/5 ml-auto h-10 w-1/2 animate-pulse rounded-3xl" />
        <div className="bg-charcoal/5 h-10 w-3/5 animate-pulse rounded-3xl" />
      </div>
    </AppShell>
  );
}

async function ChatWithFrame({ params }: { params: PageProps<"/groups/[id]/chat">["params"] }) {
  const { id } = await params;
  return (
    <Suspense fallback={<ChatPlaceholder groupId={id} />}>
      <Chat params={params} />
    </Suspense>
  );
}

export default function GroupChatPage({ params }: PageProps<"/groups/[id]/chat">) {
  return (
    <Suspense fallback={null}>
      <ChatWithFrame params={params} />
    </Suspense>
  );
}
