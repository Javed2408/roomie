import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ChatRoom } from "@/components/chat/chat-room";
import { AppShell } from "@/components/ui/app-shell";
import { loadChat } from "@/lib/matches";
import { getCurrentUser, isOnboarded } from "@/lib/profile";
import { currentDays } from "@/lib/time";

export const metadata: Metadata = { title: "Chat · Roomie" };

/**
 * Only the two people in a match can open its chat. Anyone else (or a
 * broken link) goes back to their matches.
 */
async function Chat({ params }: { params: PageProps<"/matches/[matchId]">["params"] }) {
  const current = await getCurrentUser();
  if (!current) {
    redirect("/login");
  }
  if (!current.profile || !isOnboarded(current.profile)) {
    redirect("/onboarding");
  }
  const { matchId } = await params;
  const chat = await loadChat(matchId, {
    id: current.user.id,
    profile: current.profile,
    listing: current.listing,
  });
  if (!chat) {
    redirect("/matches");
  }
  return <ChatRoom myId={current.user.id} days={currentDays()} {...chat} />;
}

/** The chat's frame while it loads: a working back button, then shapes. */
function ChatPlaceholder() {
  return (
    <AppShell
      header={
        <div className="-mx-2 flex items-center gap-2">
          <Link
            href="/matches"
            aria-label="Back to matches"
            className="hover:bg-charcoal/5 focus-visible:outline-accent flex size-12 shrink-0 items-center justify-center rounded-full focus-visible:outline-2"
          >
            <ArrowLeft aria-hidden="true" className="size-5" />
          </Link>
          <div aria-hidden="true" className="bg-charcoal/5 size-10 animate-pulse rounded-full" />
          <div aria-hidden="true" className="bg-charcoal/5 h-5 w-28 animate-pulse rounded-lg" />
        </div>
      }
      footer={<div aria-hidden="true" className="h-[4.25rem]" />}
    >
      <div aria-hidden="true" className="space-y-3">
        <div className="bg-charcoal/5 rounded-card h-28 animate-pulse" />
        <div className="bg-charcoal/5 h-10 w-2/3 animate-pulse rounded-3xl" />
        <div className="bg-charcoal/5 ml-auto h-10 w-1/2 animate-pulse rounded-3xl" />
      </div>
    </AppShell>
  );
}

export default function ChatPage({ params }: PageProps<"/matches/[matchId]">) {
  return (
    <Suspense fallback={<ChatPlaceholder />}>
      <Chat params={params} />
    </Suspense>
  );
}
