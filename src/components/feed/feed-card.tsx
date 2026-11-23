import { ArrowRight, DoorOpen, Heart, MapPin, Search, UserRound, Users, Wallet } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { CompatibilityPanel } from "@/components/feed/compatibility-panel";
import { ListingCard } from "@/components/feed/listing-card";
import { Card } from "@/components/ui/card";
import { SrmBadge } from "@/components/ui/srm-badge";
import { LIFESTYLE_QUESTIONS } from "@/lib/constants/preferences";
import { costs, formatInr } from "@/lib/onboarding";
import type { BioPrompt } from "@/types/database";
import {
  firstName,
  headline,
  type Candidate,
  type DiscoveryCandidate,
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
  if (listing) {
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

/** Up to four lifestyle answers, in the editor's order. */
function lifestyleHighlights(lifestyle: DiscoveryCandidate["lifestyle"] | undefined): string[] {
  if (!lifestyle) {
    return [];
  }
  return LIFESTYLE_QUESTIONS.flatMap(({ key, options }) => {
    const value = lifestyle[key];
    const option = (options as ReadonlyArray<{ value: string; label: string }>).find((item) => item.value === value);
    return option ? [option.label] : [];
  }).slice(0, 4);
}

/**
 * One person in the discovery feed, Hinge-style: a rich profile you scroll
 * through, with a heart on every photo, prompt and their flat, so a like
 * always says exactly what caught your eye.
 *
 * Discover passes the full details (photos, interests, lifestyle,
 * compatibility). Elsewhere (the landing page sample, the chat header) a
 * plain profile is enough. Without `onLike` there are no hearts.
 */
export function FeedCard({
  candidate,
  onLike,
  badge,
}: {
  candidate: Candidate & Partial<Omit<DiscoveryCandidate, keyof Candidate>>;
  onLike?: (target: LikeTarget) => void;
  /** Shown above the name, e.g. a "Sample" label. */
  badge?: string;
}) {
  const { profile, listing } = candidate;
  const name = firstName(profile);
  const [prompt1, ...otherPrompts] = profile.bio_prompts;
  const hasPlace = candidate.housing
    ? candidate.housing === "has_accommodation"
    : profile.mode === "have_flat";
  const photos = candidate.photos?.length ? candidate.photos : profile.avatar_url ? [profile.avatar_url] : [];
  const [mainPhoto, ...otherPhotos] = photos;
  const interests = candidate.interests ?? [];
  const highlights = lifestyleHighlights(candidate.lifestyle);
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
        {profile.about && (
          <p className="text-charcoal/90 text-base leading-relaxed">{profile.about}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <span className="bg-accent-soft text-accent-strong inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold">
            {hasPlace ? (
              <DoorOpen aria-hidden="true" className="size-4" />
            ) : (
              <Search aria-hidden="true" className="size-4" />
            )}
            {hasPlace ? "Has a place" : "Looking for a place"}
          </span>
          {candidate.seeking === "group" && (
            <span className="bg-charcoal/5 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium">
              <Users aria-hidden="true" className="size-4" />
              Wants to form a group
            </span>
          )}
          {profile.is_srm_verified && <SrmBadge verified />}
        </div>
        <Summary candidate={candidate} />
      </header>

      <Photo
        url={mainPhoto ?? null}
        alt={`${name}'s photo`}
        heart={
          mainPhoto
            ? heart(
                {
                  type: "photo",
                  ref: "avatar",
                  title: `Liked ${name}'s photo`,
                  imageUrl: mainPhoto,
                },
                `Like ${name}'s photo`,
              )
            : null
        }
      />

      {candidate.compatibility && <CompatibilityPanel compatibility={candidate.compatibility} />}

      {prompt1 && <PromptCard prompt={prompt1} heart={promptHeart(prompt1)} />}

      {(interests.length > 0 || highlights.length > 0) && (
        <Card className="space-y-4 p-5">
          {interests.length > 0 && (
            <div>
              <h3 className="text-muted mb-2 text-xs font-semibold tracking-wide uppercase">Interests</h3>
              <ul className="flex flex-wrap gap-2">
                {interests.map((interest) => (
                  <li
                    key={interest.slug}
                    className="bg-accent-soft text-accent-strong rounded-full px-3 py-1 text-sm font-semibold"
                  >
                    {interest.label}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {highlights.length > 0 && (
            <div>
              <h3 className="text-muted mb-2 text-xs font-semibold tracking-wide uppercase">Lifestyle</h3>
              <ul className="flex flex-wrap gap-2">
                {highlights.map((highlight) => (
                  <li key={highlight} className="bg-forest-soft text-forest rounded-full px-3 py-1 text-sm font-medium">
                    {highlight}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {otherPhotos[0] && (
        <Photo
          url={otherPhotos[0]}
          alt={`${name}'s photo 2`}
          heart={heart(
            { type: "photo", ref: "photo-2", title: `Liked ${name}'s photo`, imageUrl: otherPhotos[0] },
            `Like ${name}'s photo 2`,
          )}
        />
      )}

      {listing && (
        <ListingCard
          listing={listing}
          showPhotos={false}
          href={onLike ? `/listings/${listing.id}` : undefined}
          corner={heart(
            {
              type: "listing",
              ref: listing.id,
              listingId: listing.id,
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
              listingId: listing.id,
            },
            `Like photo ${index + 1} of ${name}'s flat`,
          )}
        />
      ))}

      {otherPrompts.map((prompt) => (
        <PromptCard key={prompt.question} prompt={prompt} heart={promptHeart(prompt)} />
      ))}

      {otherPhotos.slice(1).map((url, index) => (
        <Photo
          key={url}
          url={url}
          alt={`${name}'s photo ${index + 3}`}
          heart={heart(
            { type: "photo", ref: `photo-${index + 3}`, title: `Liked ${name}'s photo`, imageUrl: url },
            `Like ${name}'s photo ${index + 3}`,
          )}
        />
      ))}

      {onLike && (
        <Link
          href={`/students/${profile.id}`}
          className="text-charcoal hover:bg-charcoal/5 focus-visible:outline-accent flex min-h-12 items-center justify-center gap-2 rounded-full text-sm font-semibold focus-visible:outline-2"
        >
          View {name}&apos;s full profile
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      )}
    </article>
  );
}
