"use client";

import { LoaderCircle, RotateCcw, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState, useTransition } from "react";

import { loadMoreCandidates, sendSwipe, type SwipeResult } from "@/app/discover/actions";
import { FeedCard } from "@/components/feed/feed-card";
import { LikeSheet, MatchOverlay } from "@/components/feed/like-sheet";
import { Button, ButtonLink } from "@/components/ui/button";
import { firstName, type DiscoveryCandidate, type LikeTarget } from "@/types/feed";

type Match = Extract<SwipeResult, { match: object }>["match"];

/** Start loading the next page this many people before the end. */
const PREFETCH_AT = 2;

/**
 * The discovery feed: one person at a time. Scroll through their profile,
 * like something specific (with an optional comment) or pass. More people
 * load in pages as you go, never repeating anyone already shown.
 */
export function DiscoverDeck({
  initial,
  initialHasMore,
  query,
  hasFilters,
}: {
  initial: DiscoveryCandidate[];
  initialHasMore: boolean;
  /** The page's filter query string, for loading more. */
  query: string;
  hasFilters: boolean;
}) {
  const router = useRouter();
  const [candidates, setCandidates] = useState(initial);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loading = useRef(false);
  const [index, setIndex] = useState(0);
  const [target, setTarget] = useState<LikeTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [match, setMatch] = useState<Match | null>(null);
  const [isPending, startTransition] = useTransition();

  const current = candidates[index];
  const closeSheet = useCallback(() => {
    setTarget(null);
    setError(null);
  }, []);

  const loadMore = useCallback(async () => {
    if (loading.current) {
      return;
    }
    loading.current = true;
    setIsLoadingMore(true);
    setLoadError(null);
    const result = await loadMoreCandidates(
      query,
      candidates.map((candidate) => candidate.profile.id),
    );
    if (result.ok) {
      setCandidates((existing) => {
        const known = new Set(existing.map((candidate) => candidate.profile.id));
        return [...existing, ...result.page.candidates.filter((candidate) => !known.has(candidate.profile.id))];
      });
      setHasMore(result.page.hasMore);
    } else {
      setLoadError(result.error);
    }
    loading.current = false;
    setIsLoadingMore(false);
  }, [candidates, query]);

  function advance() {
    const next = index + 1;
    setIndex(next);
    window.scrollTo({ top: 0 });
    // Fetch the next page shortly before running out.
    if (hasMore && candidates.length - next <= PREFETCH_AT) {
      void loadMore();
    }
  }

  function decide(action: "like" | "pass", comment = "") {
    if (!current) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await sendSwipe({
        receiverId: current.profile.id,
        action,
        targetType: target?.type,
        targetRef: target?.ref,
        comment,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setTarget(null);
      if (result.match) {
        setMatch(result.match);
      }
      advance();
    });
  }

  if (!current && isLoadingMore) {
    return (
      <div className="text-muted flex items-center justify-center gap-2 py-16 text-sm" role="status">
        <LoaderCircle aria-hidden="true" className="size-5 animate-spin" />
        Finding more people…
      </div>
    );
  }

  if (!current) {
    return (
      <div className="rounded-card border-line flex flex-col items-center border border-dashed px-6 py-14 text-center">
        <span className="bg-accent-soft text-accent-strong flex size-14 items-center justify-center rounded-full">
          <Sparkles aria-hidden="true" className="size-7" />
        </span>
        <h2 className="font-display mt-4 text-2xl font-semibold">
          {hasMore
            ? "There are more people to see"
            : candidates.length > 0
              ? "You've seen everyone for now"
              : "No one to show yet"}
        </h2>
        <p className="text-muted mt-2 max-w-xs text-sm leading-relaxed">
          {loadError
            ? loadError
            : hasFilters
              ? "Your filters are narrowing things down. Try removing one, or check back soon."
              : "Roomie is still growing, and new students join all the time. Check back soon, or change who you discover above."}
        </p>
        <div className="mt-6 flex flex-col gap-2">
          {hasMore && (
            <Button onClick={() => void loadMore()}>
              <RotateCcw aria-hidden="true" className="size-4" />
              Load more people
            </Button>
          )}
          {hasFilters && (
            <ButtonLink href="/discover" variant="primary">
              Reset filters
            </ButtonLink>
          )}
          <Button variant="secondary" onClick={() => router.refresh()}>
            <RotateCcw aria-hidden="true" className="size-4" />
            Check again
          </Button>
        </div>
        {match && (
          <MatchOverlay {...match} onContinue={() => setMatch(null)} />
        )}
      </div>
    );
  }

  const name = firstName(current.profile);
  return (
    <>
      <p className="sr-only" aria-live="polite">
        Showing {name}.
      </p>
      <FeedCard
        key={current.profile.id}
        candidate={current}
        onLike={(chosen) => {
          setError(null);
          setTarget(chosen);
        }}
      />

      {/* Pass: floats bottom-left above the tab bar, like Hinge's ✕. */}
      <div className="pointer-events-none sticky bottom-[calc(4rem+env(safe-area-inset-bottom)+1rem)] z-20 mt-6 flex">
        <button
          type="button"
          onClick={() => decide("pass")}
          disabled={isPending}
          aria-label={`Pass on ${name}`}
          className="bg-surface border-line text-charcoal focus-visible:outline-accent pointer-events-auto flex size-16 items-center justify-center rounded-full border shadow-lg transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-95 disabled:opacity-60"
        >
          <X aria-hidden="true" className="size-7" strokeWidth={2.4} />
        </button>
      </div>
      {error && !target && (
        <p role="alert" className="text-accent-strong mt-3 text-sm font-medium">
          {error}
        </p>
      )}

      {target && (
        <LikeSheet
          target={target}
          name={name}
          isSending={isPending}
          error={error}
          onSend={(comment) => decide("like", comment)}
          onClose={closeSheet}
        />
      )}
      {match && <MatchOverlay {...match} onContinue={() => setMatch(null)} />}
      <p className="text-muted mt-6 text-center text-xs">
        {hasMore
          ? "More people after this"
          : `${candidates.length - index - 1} more after ${name}`}{" "}
        ·{" "}
        <Link href="/profile/edit" className="underline">
          Your profile
        </Link>
      </p>
    </>
  );
}
