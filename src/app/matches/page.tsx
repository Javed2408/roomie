import { HeartHandshake } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ConversationList } from "@/components/matches/conversation-list";
import { LikesYou } from "@/components/matches/likes-you";
import { MatchesLive } from "@/components/matches/matches-live";
import { AppShell } from "@/components/ui/app-shell";
import { BottomNav } from "@/components/ui/bottom-nav";
import { ButtonLink } from "@/components/ui/button";
import { Wordmark } from "@/components/ui/wordmark";
import { loadConversations, loadLikesYou } from "@/lib/matches";
import { getCurrentUser, isOnboarded } from "@/lib/profile";

export const metadata: Metadata = { title: "Matches · Roomie" };

/** Likes waiting for an answer, then every conversation. */
async function MatchesContent() {
  const current = await getCurrentUser();
  if (!current) {
    redirect("/login");
  }
  if (!current.profile || !isOnboarded(current.profile)) {
    redirect("/onboarding");
  }
  const me = { id: current.user.id, profile: current.profile, listing: current.listing };
  const [likes, conversations] = await Promise.all([
    loadLikesYou(me),
    loadConversations(me.id),
  ]);

  return (
    <>
      {likes.length > 0 && <LikesYou likes={likes} />}

      <section aria-labelledby="conversations-heading">
        <h2 id="conversations-heading" className="font-display mb-3 text-xl font-semibold">
          Matches &amp; messages
        </h2>
        {conversations.length > 0 ? (
          <ConversationList conversations={conversations} myId={me.id} />
        ) : (
          <div className="rounded-card border-line flex flex-col items-center border border-dashed px-6 py-12 text-center">
            <span className="bg-accent-soft text-accent-strong flex size-14 items-center justify-center rounded-full">
              <HeartHandshake aria-hidden="true" className="size-7" />
            </span>
            <h3 className="font-display mt-4 text-2xl font-semibold">No matches yet</h3>
            <p className="text-muted mt-2 max-w-xs text-sm leading-relaxed">
              {likes.length > 0
                ? "Like someone back above and your chat will start here."
                : "When someone you liked likes you back, you can chat with them here."}
            </p>
            <ButtonLink href="/discover" className="mt-6">
              Keep discovering
            </ButtonLink>
          </div>
        )}
      </section>

      <MatchesLive />
    </>
  );
}

function MatchesPlaceholder() {
  return (
    <div aria-hidden="true" className="space-y-3">
      <div className="bg-charcoal/5 h-6 w-1/3 animate-pulse rounded-lg" />
      <div className="flex gap-3">
        {[0, 1, 2].map((item) => (
          <div key={item} className="bg-charcoal/5 aspect-[4/5] w-32 animate-pulse rounded-2xl" />
        ))}
      </div>
      <div className="bg-charcoal/5 rounded-card h-48 animate-pulse" />
    </div>
  );
}

export default function MatchesPage() {
  return (
    <AppShell header={<Wordmark />} footer={<BottomNav current="Matches" />}>
      <h1 className="font-display mb-5 text-3xl font-semibold tracking-tight">Matches</h1>
      <Suspense fallback={<MatchesPlaceholder />}>
        <MatchesContent />
      </Suspense>
    </AppShell>
  );
}
