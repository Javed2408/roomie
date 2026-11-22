import { DoorOpen, Heart, MapPin, Search, UserRound, Wallet } from "lucide-react";
import type { ReactNode } from "react";

import { ListingCard } from "@/components/feed/listing-card";
import { Card } from "@/components/ui/card";
import { SrmBadge } from "@/components/ui/srm-badge";
import { costs, formatInr } from "@/lib/onboarding";
import type { BioPrompt } from "@/types/database";
import {
  firstName,
  headline,
  type Candidate,
  type LikeTarget,
} from "@/types/feed";

/** The round heart Hinge puts on each part of a profile. */
function HeartButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="bg-surface text-accent border-line focus-visible:outline-accent absolute right-4 bottom-4 z-10 flex size-12 items-center justify-center rounded-full border shadow-md transition-transform duration-150 hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-95"
    >
      <Heart aria-hidden="true" className="size-5" strokeWidth={2.2} />
    </button>
  );
}

function Photo({
  url,
  alt,
  heart,
}: {
  url: string | null;
  alt: string;
  heart?: ReactNode;
}) {
  return (
    <Card className="relative aspect-[4/5] overflow-hidden">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URL
        <img src={url} alt={alt} className="size-full object-cover" />
      ) : (
        <div className="from-accent-soft to-forest-soft text-muted flex size-full flex-col items-center justify-center gap-2 bg-gradient-to-br">
          <UserRound aria-hidden="true" className="size-16" strokeWidth={1.2} />
          <span className="text-sm">No photo yet</span>
        </div>
      )}
      {heart}
    </Card>
  );
}

function PromptCard({
  prompt,
  heart,
}: {
  prompt: BioPrompt;
  heart?: ReactNode;
}) {
  return (
    <Card className={`relative px-6 pt-6 ${heart ? "pb-20" : "pb-6"}`}>
      <p className="text-muted text-sm font-medium">{prompt.question}</p>
      <p className="font-display mt-2 text-2xl leading-snug">{prompt.answer}</p>
      {heart}
    </Card>
  );
}

/** The one-line "what they offer / what they want" under the name. */
function Summary({ candidate }: { candidate: Candidate }) {
  const { profile, listing } = candidate;
  if (profile.mode === "have_flat" && listing) {
    return (
      <p className="text-charcoal/80 flex items-center gap-1.5 text-sm">
        <MapPin aria-hidden="true" className="text-forest size-4 shrink-0" />
        {listing.society} · {listing.bhk_type} ·{" "}
        {formatInr(costs(listing).monthly)}/mo
      </p>
    );
  }
  const societies = profile.preferred_societies;
  return (
    <div className="text-charcoal/80 space-y-1 text-sm">
      {societies.length > 0 && (
        <p className="flex items-center gap-1.5">
          <MapPin aria-hidden="true" className="text-forest size-4 shrink-0" />
          Looking in {societies.slice(0, 2).join(", ")}
          {societies.length > 2 ? ` +${societies.length - 2}` : ""}
        </p>
      )}
      {profile.max_budget && (
        <p className="flex items-center gap-1.5">
          <Wallet aria-hidden="true" className="text-forest size-4 shrink-0" />
          Budget up to {formatInr(profile.max_budget)}/mo
        </p>
      )}
    </div>
  );
}

/**
 * One person in the discovery feed, Hinge-style: a rich profile you scroll
 * through, with a heart on every photo, prompt and their flat, so a like
 * always says exactly what caught your eye.
 *
 * Without `onLike` (e.g. your own profile preview) there are no hearts.
 */
export function FeedCard({
  candidate,
  onLike,
  badge,
}: {
  candidate: Candidate;
  onLike?: (target: LikeTarget) => void;
  /** Shown above the name, e.g. a "Sample" label. */
  badge?: string;
}) {
  const { profile, listing } = candidate;
  const name = firstName(profile);
  const [prompt1, ...otherPrompts] = profile.bio_prompts;
  const isOwner = profile.mode === "have_flat";
  // Invented example students (from `npm run seed`) are always labelled.
  const label = badge ?? (profile.is_sample ? "Sample profile" : undefined);

  const heart = (target: LikeTarget, label: string) =>
    onLike ? <HeartButton label={label} onClick={() => onLike(target)} /> : null;
  const promptHeart = (prompt: BioPrompt) =>
    heart(
      {
        type: "prompt",
        ref: prompt.question,
        title: `Replying to: ${prompt.question}`,
        detail: prompt.answer,
      },
      `Like ${name}'s answer to "${prompt.question}"`,
    );

  return (
    <article aria-label={`${name}'s profile`} className="space-y-3">
      <header className="space-y-2 pb-1">
        {label && (
          <span className="bg-accent-soft text-accent-strong inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold">
            {label}
          </span>
        )}
        <h2 className="font-display text-3xl font-semibold tracking-tight">
          {name}
        </h2>
        {headline(profile) && (
          <p className="text-muted text-sm">{headline(profile)}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <span className="bg-accent-soft text-accent-strong inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold">
            {isOwner ? (
              <DoorOpen aria-hidden="true" className="size-4" />
            ) : (
              <Search aria-hidden="true" className="size-4" />
            )}
            {isOwner ? "Has a flat" : "Looking for a flat"}
          </span>
          {profile.is_srm_verified && <SrmBadge verified />}
        </div>
        <Summary candidate={candidate} />
      </header>

      <Photo
        url={profile.avatar_url}
        alt={`${name}'s photo`}
        heart={
          profile.avatar_url
            ? heart(
                {
                  type: "photo",
                  ref: "avatar",
                  title: `Liked ${name}'s photo`,
                  imageUrl: profile.avatar_url,
                },
                `Like ${name}'s photo`,
              )
            : null
        }
      />

      {prompt1 && <PromptCard prompt={prompt1} heart={promptHeart(prompt1)} />}

      {listing && (
        <ListingCard
          listing={listing}
          showPhotos={false}
          corner={heart(
            {
              type: "listing",
              ref: listing.id,
              title: `Liked: ${listing.society} ${listing.bhk_type} • ${formatInr(costs(listing).monthly)}/mo`,
              detail: `${listing.vacant_spots} ${listing.vacant_spots === 1 ? "spot" : "spots"} open · ${formatInr(costs(listing).moveIn)} to move in`,
            },
            `Like ${name}'s flat`,
          )}
        />
      )}

      {listing?.photos.map((url, index) => (
        <Photo
          key={url}
          url={url}
          alt={`${name}'s flat, photo ${index + 1}`}
          heart={heart(
            {
              type: "photo",
              ref: `listing-photo-${index + 1}`,
              title: `Liked a photo of ${name}'s flat`,
              imageUrl: url,
            },
            `Like photo ${index + 1} of ${name}'s flat`,
          )}
        />
      ))}

      {otherPrompts.map((prompt) => (
        <PromptCard key={prompt.question} prompt={prompt} heart={promptHeart(prompt)} />
      ))}
    </article>
  );
}
