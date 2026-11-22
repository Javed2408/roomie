"use client";

import { Heart, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { LIKE_COMMENT_MAX } from "@/lib/constants/prompts";
import type { LikeTarget } from "@/types/feed";

const ICEBREAKERS: Record<LikeTarget["type"], string[]> = {
  listing: [
    "Is Wi-Fi & cook split included?",
    "When can I come see the flat?",
    "Is the deposit negotiable?",
  ],
  prompt: ["Haha, same here!", "Tell me more 👀", "Okay, this is a green flag"],
  photo: ["Love the vibe!", "We'd get along, I think", "Coffee in Potheri sometime?"],
};

/**
 * Hinge's "send a like": shows exactly what's being liked, with an
 * optional comment and one-tap icebreakers.
 */
export function LikeSheet({
  target,
  name,
  isSending,
  error,
  onSend,
  onClose,
}: {
  target: LikeTarget;
  name: string;
  isSending: boolean;
  error: string | null;
  onSend: (comment: string) => void;
  onClose: () => void;
}) {
  const [comment, setComment] = useState("");
  const titleId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="bg-charcoal/50 absolute inset-0 backdrop-blur-[2px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-cream relative w-full max-w-[480px] rounded-t-[2rem] px-5 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-2xl"
      >
        <div className="bg-charcoal/15 mx-auto mb-4 h-1.5 w-12 rounded-full" />
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="font-display text-2xl font-semibold">
            Like {name}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="hover:bg-charcoal/5 -mt-1 -mr-2 flex size-11 items-center justify-center rounded-full"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>

        <div className="bg-surface border-line mt-3 flex gap-3 rounded-2xl border p-3">
          {target.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URL
            <img
              src={target.imageUrl}
              alt=""
              className="size-16 shrink-0 rounded-xl object-cover"
            />
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold">{target.title}</p>
            {target.detail && (
              <p className="text-muted mt-0.5 line-clamp-2 text-sm">
                {target.detail}
              </p>
            )}
          </div>
        </div>

        <label htmlFor={`${titleId}-comment`} className="sr-only">
          Add a comment
        </label>
        <textarea
          id={`${titleId}-comment`}
          ref={inputRef}
          value={comment}
          maxLength={LIKE_COMMENT_MAX}
          onChange={(event) => setComment(event.target.value)}
          placeholder={
            target.type === "listing"
              ? "Add a comment or question... e.g. Is Wi-Fi & cook split included?"
              : "Add a comment (optional)"
          }
          className="bg-surface border-line focus:border-charcoal mt-3 min-h-20 w-full resize-none rounded-2xl border px-4 py-3 text-base outline-none"
        />
        <div className="text-muted mt-1 text-right text-xs">
          {comment.length}/{LIKE_COMMENT_MAX}
        </div>

        <div className="-mx-5 mt-1 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {ICEBREAKERS[target.type].map((line) => (
            <button
              key={line}
              type="button"
              onClick={() => setComment(line)}
              className="border-line bg-surface hover:border-charcoal/40 min-h-10 shrink-0 rounded-full border px-3.5 text-sm"
            >
              {line}
            </button>
          ))}
        </div>

        {error && (
          <p role="alert" className="text-accent-strong mt-3 text-sm font-medium">
            {error}
          </p>
        )}

        <Button
          fullWidth
          className="mt-4"
          disabled={isSending}
          onClick={() => onSend(comment)}
        >
          <Heart aria-hidden="true" className="size-4" fill="currentColor" />
          {isSending ? "Sending…" : "Send Like"}
        </Button>
      </div>
    </div>
  );
}

function Face({ url, label }: { url: string | null; label: string }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URL
    <img
      src={url}
      alt={label}
      className="border-cream size-28 rounded-full border-4 object-cover shadow-lg"
    />
  ) : (
    <span
      aria-label={label}
      className="border-cream bg-accent-soft font-display text-accent-strong flex size-28 items-center justify-center rounded-full border-4 text-3xl font-semibold shadow-lg"
    >
      {label.charAt(0)}
    </span>
  );
}

/** The celebration when a like completes a match. */
export function MatchOverlay({
  id,
  name,
  photoUrl,
  myPhotoUrl,
  comment,
  onContinue,
}: {
  /** The new match, so "Say Hi" opens its chat. */
  id: string;
  name: string;
  photoUrl: string | null;
  myPhotoUrl: string | null;
  comment: string | null;
  onContinue: () => void;
}) {
  const titleId = useId();
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="bg-charcoal/95 fixed inset-0 z-50 flex items-center justify-center p-6"
    >
      <div className="w-full max-w-sm text-center">
        <div className="flex justify-center">
          <span className="-rotate-6">
            <Face url={myPhotoUrl} label="You" />
          </span>
          <span className="-ml-6 rotate-6">
            <Face url={photoUrl} label={name} />
          </span>
        </div>
        <h2
          id={titleId}
          className="font-display text-cream mt-8 text-4xl font-semibold"
        >
          It&apos;s a Match!
        </h2>
        <p className="text-cream/80 mt-2">
          You and {name} liked each other.
        </p>
        {comment && (
          <p className="bg-cream/10 text-cream mt-5 rounded-2xl p-4 text-left text-sm italic">
            &ldquo;{comment}&rdquo;
          </p>
        )}
        <div className="mt-8 space-y-3">
          <Link
            href={`/matches/${id}`}
            className="bg-accent text-charcoal flex min-h-12 items-center justify-center rounded-full font-semibold"
          >
            Say Hi
          </Link>
          <button
            type="button"
            onClick={onContinue}
            className="text-cream min-h-12 w-full rounded-full font-semibold hover:bg-white/10"
          >
            Keep browsing
          </button>
        </div>
      </div>
    </div>
  );
}
