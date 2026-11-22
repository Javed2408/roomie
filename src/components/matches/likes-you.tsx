"use client";

import { ChevronDown, Heart, MessageCircle, X } from "lucide-react";
import { useState, useTransition } from "react";

import { respondToLike } from "@/app/matches/actions";
import { ListingCard } from "@/components/feed/listing-card";
import { Avatar } from "@/components/ui/avatar";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { SrmBadge } from "@/components/ui/srm-badge";
import { lookingFor } from "@/lib/likes";
import { firstName, headline } from "@/types/feed";
import type { IncomingLike } from "@/types/matches";

/**
 * Hinge's "Likes You": everyone waiting for your answer, in a row you can
 * swipe through. Tap one to see what they liked and what they said.
 */
export function LikesYou({ likes }: { likes: IncomingLike[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  // After a pass the list refreshes without them, which closes the sheet.
  const open = likes.find((like) => like.id === openId) ?? null;

  return (
    <section aria-labelledby="likes-you-heading" className="mb-8">
      <div className="flex items-center gap-2">
        <h2 id="likes-you-heading" className="font-display text-xl font-semibold">
          Likes You
        </h2>
        <span className="bg-accent-soft text-accent-strong rounded-full px-2.5 py-0.5 text-sm font-semibold">
          {likes.length}
        </span>
      </div>
      <p className="text-muted mt-0.5 mb-3 text-sm">
        Like them back to start chatting.
      </p>

      <ul className="-mx-5 flex snap-x gap-3 overflow-x-auto px-5 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {likes.map((like) => {
          const name = firstName(like.profile);
          return (
            <li key={like.id} className="w-32 shrink-0 snap-start">
              <button
                type="button"
                onClick={() => setOpenId(like.id)}
                className="focus-visible:outline-accent w-full rounded-2xl text-left focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <span className="relative block">
                  <Avatar
                    url={like.profile.avatar_url}
                    name={name}
                    className="aspect-[4/5] w-full rounded-2xl text-4xl"
                  />
                  <span className="bg-surface text-accent absolute right-2 bottom-2 flex size-8 items-center justify-center rounded-full shadow-md">
                    <Heart aria-hidden="true" className="size-4" fill="currentColor" />
                  </span>
                </span>
                <span className="mt-1.5 block truncate font-semibold">{name}</span>
                <span className="text-muted line-clamp-2 block text-xs leading-snug">
                  {like.comment ? `“${like.comment}”` : `Liked ${like.liked.phrase}`}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {open && (
        <LikeDetail key={open.id} like={open} onClose={() => setOpenId(null)} />
      )}
    </section>
  );
}

/** One like, up close: who, what they liked, their comment, and your answer. */
function LikeDetail({
  like,
  onClose,
}: {
  like: IncomingLike;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [choice, setChoice] = useState<"match" | "pass" | null>(null);
  const [error, setError] = useState("");
  const name = firstName(like.profile);
  const about = headline(like.profile);

  function respond(decision: "match" | "pass") {
    setError("");
    setChoice(decision);
    startTransition(async () => {
      // "match" opens the new chat; we only get a result back otherwise.
      const result = await respondToLike(like.profile.id, decision);
      if (result.error) {
        setError(result.error);
      }
    });
  }

  return (
    <BottomSheet
      title={`${name} likes you`}
      onClose={onClose}
      footer={
        <>
          {error && (
            <p role="alert" className="text-accent-strong mb-2 text-sm font-medium">
              {error}
            </p>
          )}
          <div className="grid grid-cols-[auto_1fr] gap-3">
            <Button
              variant="secondary"
              disabled={isPending}
              onClick={() => respond("pass")}
              aria-label={`Pass on ${name}`}
            >
              <X aria-hidden="true" className="size-5" />
              {isPending && choice === "pass" ? "Passing…" : "Pass"}
            </Button>
            <Button disabled={isPending} onClick={() => respond("match")}>
              <MessageCircle aria-hidden="true" className="size-5" />
              {isPending && choice === "match" ? "Matching…" : "Match & Reply"}
            </Button>
          </div>
        </>
      }
    >
      <div className="flex items-center gap-4">
        <Avatar
          url={like.profile.avatar_url}
          name={name}
          className="size-20 rounded-2xl text-3xl"
        />
        <div className="min-w-0 space-y-1.5">
          {about && <p className="text-muted text-sm">{about}</p>}
          <p className="text-sm font-medium">{lookingFor(like)}</p>
          {like.profile.is_srm_verified && <SrmBadge verified />}
        </div>
      </div>

      <div className="bg-surface border-line mt-5 rounded-2xl border p-4">
        <p className="flex items-start gap-2 text-sm font-semibold">
          <Heart
            aria-hidden="true"
            className="text-accent mt-0.5 size-4 shrink-0"
            fill="currentColor"
          />
          Liked {like.liked.phrase}
        </p>
        {(like.liked.imageUrl || like.liked.detail) && (
          <div className="mt-3 flex items-center gap-3">
            {like.liked.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URL
              <img
                src={like.liked.imageUrl}
                alt=""
                className="size-16 shrink-0 rounded-xl object-cover"
              />
            )}
            {like.liked.detail && (
              <p className="font-display text-lg leading-snug">{like.liked.detail}</p>
            )}
          </div>
        )}
      </div>

      {like.comment && (
        <figure className="mt-3">
          <blockquote className="bg-accent-soft rounded-2xl rounded-tl-md px-4 py-3">
            “{like.comment}”
          </blockquote>
          <figcaption className="text-muted mt-1 text-xs">{name}</figcaption>
        </figure>
      )}

      <details className="group mt-5">
        <summary className="border-line bg-surface focus-visible:outline-accent flex min-h-12 cursor-pointer list-none items-center justify-between rounded-2xl border px-4 font-semibold focus-visible:outline-2 [&::-webkit-details-marker]:hidden">
          See {name}&apos;s full profile
          <ChevronDown
            aria-hidden="true"
            className="size-5 transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="mt-3 space-y-3">
          {like.profile.avatar_url && (
            // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URL
            <img
              src={like.profile.avatar_url}
              alt={`${name}'s photo`}
              className="rounded-card aspect-[4/5] w-full object-cover"
            />
          )}
          {like.profile.bio_prompts.map((prompt) => (
            <div
              key={prompt.question}
              className="bg-surface border-line rounded-2xl border p-4"
            >
              <p className="text-muted text-sm font-medium">{prompt.question}</p>
              <p className="font-display mt-1 text-xl leading-snug">{prompt.answer}</p>
            </div>
          ))}
          {like.listing && <ListingCard listing={like.listing} />}
        </div>
      </details>
    </BottomSheet>
  );
}
