"use client";

import { Check, Heart, MessageCircle } from "lucide-react";
import { useState, useTransition } from "react";

import { sendSwipe, type SwipeResult } from "@/app/discover/actions";
import { LikeSheet, MatchOverlay } from "@/components/feed/like-sheet";
import { Button, ButtonLink } from "@/components/ui/button";
import type { Interaction } from "@/lib/listings";
import type { LikeTarget } from "@/types/feed";

type Match = Extract<SwipeResult, { match: object }>["match"];

/**
 * Like this exact listing (with an optional comment), or see where you
 * already stand with its owner. Uses the same likes and matches as
 * Discover: one decision per person, and two likes make a match.
 */
export function ListingLike({
  ownerId,
  ownerName,
  target,
  interaction,
}: {
  ownerId: string;
  ownerName: string;
  target: LikeTarget;
  interaction: Interaction;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [match, setMatch] = useState<Match | null>(null);
  const [liked, setLiked] = useState(false);
  const [isSending, startTransition] = useTransition();

  function send(comment: string) {
    setError(null);
    startTransition(async () => {
      const result = await sendSwipe({
        receiverId: ownerId,
        action: "like",
        targetType: "listing",
        targetRef: target.ref,
        listingId: target.listingId,
        comment,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setLiked(true);
      if (result.match) {
        setMatch(result.match);
      }
    });
  }

  if (interaction.kind === "matched") {
    return (
      <ButtonLink href={`/matches/${interaction.matchId}`} fullWidth>
        <MessageCircle aria-hidden="true" className="size-4" />
        You matched with {ownerName}: open chat
      </ButtonLink>
    );
  }
  if (liked || interaction.kind === "liked") {
    return (
      <>
        <p className="bg-forest-soft text-forest flex items-center gap-2 rounded-2xl p-4 text-sm font-medium" role="status">
          <Check aria-hidden="true" className="size-4 shrink-0" />
          {liked || (interaction.kind === "liked" && interaction.thisListing)
            ? `You liked this flat. If ${ownerName} likes you back, you'll match.`
            : `You've already liked ${ownerName}. If they like you back, you'll match.`}
        </p>
        {match && <MatchOverlay {...match} onContinue={() => setMatch(null)} />}
      </>
    );
  }
  if (interaction.kind === "passed") {
    return <p className="text-muted text-sm">You passed on {ownerName} in Discover.</p>;
  }
  return (
    <>
      <Button fullWidth onClick={() => setOpen(true)}>
        <Heart aria-hidden="true" className="size-4" />
        Like this flat
      </Button>
      {open && (
        <LikeSheet
          target={target}
          name={ownerName}
          isSending={isSending}
          error={error}
          onSend={send}
          onClose={() => {
            setOpen(false);
            setError(null);
          }}
        />
      )}
    </>
  );
}
