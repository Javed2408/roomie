import type { Metadata } from "next";
import { Suspense } from "react";

import { DiscoverDeck } from "@/components/feed/discover-deck";
import { FilterBar } from "@/components/feed/filter-bar";
import { AppShell } from "@/components/ui/app-shell";
import { BottomNav } from "@/components/ui/bottom-nav";
import { InstallBanner } from "@/components/ui/install-banner";
import { Wordmark } from "@/components/ui/wordmark";
import { loadFeed } from "@/lib/feed";
import { parseFilters } from "@/lib/feed-filters";
import { requireStudent } from "@/lib/profile";

export const metadata: Metadata = { title: "Discover · Roomie" };

async function Feed({
  searchParams,
}: {
  searchParams: PageProps<"/discover">["searchParams"];
}) {
  // Signed in, a confirmed SRM student, and onboarded.
  const current = await requireStudent();
  const filters = parseFilters(await searchParams);
  const candidates = await loadFeed(current.profile, current.listing, filters);
  const hasFilters =
    Boolean(filters.society || filters.maxBudget || filters.gender) ||
    filters.srmOnly;
  const wantsFlats = current.profile.mode === "need_flat";

  return (
    <>
      <h1 className="font-display mb-4 text-3xl font-semibold tracking-tight">
        {wantsFlats ? "Flats with a spot for you" : "Students looking for a flat"}
      </h1>
      <FilterBar
        filters={filters}
        budgetLabel={
          wantsFlats ? "Max monthly cost (rent + maintenance)" : "Their max budget"
        }
      />
      {/* A new key whenever the list changes resets the deck to the first card. */}
      <DiscoverDeck
        key={candidates.map((candidate) => candidate.profile.id).join(",")}
        candidates={candidates}
        hasFilters={hasFilters}
      />
    </>
  );
}

function FeedPlaceholder() {
  return (
    <div aria-hidden="true" className="space-y-3">
      <div className="bg-charcoal/5 h-9 w-2/3 animate-pulse rounded-xl" />
      <div className="bg-charcoal/5 h-10 w-1/2 animate-pulse rounded-full" />
      <div className="bg-charcoal/5 h-24 animate-pulse rounded-xl" />
      <div className="bg-charcoal/5 rounded-card aspect-[4/5] animate-pulse" />
    </div>
  );
}

export default function DiscoverPage({ searchParams }: PageProps<"/discover">) {
  return (
    <AppShell header={<Wordmark />} footer={<BottomNav current="Discover" />}>
      <InstallBanner />
      <Suspense fallback={<FeedPlaceholder />}>
        <Feed searchParams={searchParams} />
      </Suspense>
    </AppShell>
  );
}
