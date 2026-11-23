import { Users } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { DiscoverDeck } from "@/components/feed/discover-deck";
import { DiscoverSettings } from "@/components/feed/discover-settings";
import { FilterBar } from "@/components/feed/filter-bar";
import { AppShell } from "@/components/ui/app-shell";
import { BottomNav } from "@/components/ui/bottom-nav";
import { ButtonLink } from "@/components/ui/button";
import { InstallBanner } from "@/components/ui/install-banner";
import { Wordmark } from "@/components/ui/wordmark";
import { loadDiscoverySettings, loadFeedPage } from "@/lib/feed";
import { activeFilters, filtersToQuery, parseFilters } from "@/lib/feed-filters";
import { requireStudent } from "@/lib/profile";

export const metadata: Metadata = { title: "Discover · Roomie" };

const TITLES = {
  has_accommodation: "Students with a place",
  needs_accommodation: "Students looking for a place",
  both: "Students near campus",
} as const;

/** Shown instead of the feed when a student wants a group only. */
function GroupsComingSoon({ query }: { query: string }) {
  return (
    <div className="rounded-card border-line flex flex-col items-center border border-dashed px-6 py-12 text-center">
      <span className="bg-forest-soft text-forest flex size-14 items-center justify-center rounded-full">
        <Users aria-hidden="true" className="size-7" />
      </span>
      <h2 className="font-display mt-4 text-2xl font-semibold">Group discovery is coming soon</h2>
      <p className="text-muted mt-2 max-w-xs text-sm leading-relaxed">
        You said you&apos;d like a group to move in with. Finding groups isn&apos;t ready yet. Until
        then, you can meet individual students who could form one with you.
      </p>
      <ButtonLink href={`/discover?${query ? `${query}&` : ""}people=1`} className="mt-6">
        Browse students for now
      </ButtonLink>
      <p className="text-muted mt-3 text-xs">This doesn&apos;t change your saved preference.</p>
    </div>
  );
}

async function Feed({ searchParams }: { searchParams: PageProps<"/discover">["searchParams"] }) {
  // Signed in, a confirmed SRM student, and onboarded.
  const current = await requireStudent();
  const params = await searchParams;
  const filters = parseFilters(params);
  const query = filtersToQuery(filters);
  const settings = await loadDiscoverySettings(current.user.id);
  const groupOnly = settings.seeking === "group" && params.people !== "1";
  const feed = groupOnly ? null : await loadFeedPage(current.user.id, filters);

  return (
    <>
      <h1 className="font-display mb-3 text-3xl font-semibold tracking-tight">
        {TITLES[settings.discoverHousing]}
      </h1>
      <DiscoverSettings discoverHousing={settings.discoverHousing} seeking={settings.seeking} />
      {groupOnly || !feed ? (
        <GroupsComingSoon query={query} />
      ) : (
        <>
          <FilterBar filters={filters} keep={params.people === "1" ? "people=1" : ""} />
          {settings.seeking === "group" && (
            <p className="bg-forest-soft text-forest mb-4 rounded-2xl px-4 py-3 text-sm">
              Showing individual students while group discovery is on its way.
            </p>
          )}
          {/* A new key whenever the settings or filters change resets the deck. */}
          <DiscoverDeck
            key={`${settings.discoverHousing}:${settings.seeking}:${query}:${feed.candidates
              .map((candidate) => candidate.profile.id)
              .join(",")}`}
            initial={feed.candidates}
            initialHasMore={feed.hasMore}
            query={query}
            hasFilters={activeFilters(filters).length > 0}
          />
        </>
      )}
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
