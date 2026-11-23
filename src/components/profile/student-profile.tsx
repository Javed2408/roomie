import {
  BookOpen,
  DoorOpen,
  MapPin,
  Moon,
  Search,
  Smile,
  Sparkles,
  Users,
  UtensilsCrossed,
  Volume2,
  Wind,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { ListingCard } from "@/components/feed/listing-card";
import { Card } from "@/components/ui/card";
import { SrmBadge } from "@/components/ui/srm-badge";
import {
  LIFESTYLE_QUESTIONS,
  LIFESTYLE_WISHES,
  type LifestyleQuestionKey,
} from "@/lib/constants/preferences";
import { MOVE_IN_TIMEFRAMES } from "@/lib/constants/prompts";
import { formatInr } from "@/lib/onboarding";
import type { PublicStudent } from "@/lib/student";
import { firstName, headline } from "@/types/feed";

const ICONS: Record<LifestyleQuestionKey, LucideIcon> = {
  sleep_schedule: Moon,
  study_habits: BookOpen,
  noise_tolerance: Volume2,
  cleanliness: Sparkles,
  guests: DoorOpen,
  social_life: Users,
  personality: Smile,
  smoking: Wind,
  food_habits: UtensilsCrossed,
};

function Photo({ url, alt, priority }: { url: string; alt: string; priority?: boolean }) {
  return (
    <Card className="aspect-[4/5] overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URL */}
      <img
        src={url}
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        className="size-full object-cover"
      />
    </Card>
  );
}

function Prompt({ question, answer }: { question: string; answer: string }) {
  return (
    <Card className="px-6 py-6">
      <p className="text-muted text-sm font-medium">{question}</p>
      <p className="font-display mt-2 text-2xl leading-snug">{answer}</p>
    </Card>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="p-5">
      <h2 className="font-display text-xl font-semibold">{title}</h2>
      <div className="mt-3">{children}</div>
    </Card>
  );
}

/**
 * A student's profile as other students see it: photos and prompts in
 * turn (Hinge-style), interests, lifestyle highlights and their housing.
 * Never shows email, private flat needs or discovery settings.
 */
export function StudentProfile({ student }: { student: PublicStudent }) {
  const { profile, photos, interests, lifestyle, housing, listing } = student;
  const name = firstName(profile);
  const about = headline(profile);
  const hasPlace = housing === "has_accommodation";

  const answered = LIFESTYLE_QUESTIONS.flatMap(({ key, question, options }) => {
    const value = lifestyle?.[key];
    const option = (options as ReadonlyArray<{ value: string; label: string }>).find(
      (item) => item.value === value,
    );
    return option ? [{ key, question, label: option.label }] : [];
  });
  const wishes = LIFESTYLE_WISHES.filter(({ key }) => lifestyle?.[key] === true);

  // Photos and prompts take turns after the main photo.
  const [mainPhoto, ...otherPhotos] = photos;
  const prompts = profile.bio_prompts;
  const story: ReactNode[] = [];
  const turns = Math.max(prompts.length, otherPhotos.length);
  for (let index = 0; index < turns; index += 1) {
    if (prompts[index]) {
      story.push(<Prompt key={`prompt-${index}`} {...prompts[index]} />);
    }
    if (otherPhotos[index]) {
      story.push(
        <Photo key={otherPhotos[index]} url={otherPhotos[index]} alt={`${name}'s photo ${index + 2}`} />,
      );
    }
  }

  const moveIn = MOVE_IN_TIMEFRAMES.find((item) => item.value === profile.move_in_timeframe)?.label;

  return (
    <article aria-labelledby="student-name" className="space-y-4">
      <header className="space-y-2">
        {profile.is_sample && (
          <span className="bg-accent-soft text-accent-strong inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold">
            Sample profile
          </span>
        )}
        <h1 id="student-name" className="font-display text-4xl font-semibold tracking-tight">
          {name}
        </h1>
        {about && <p className="text-muted">{about}</p>}
        <div className="flex flex-wrap gap-2">
          {housing && (
            <span className="bg-accent-soft text-accent-strong inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold">
              {hasPlace ? (
                <DoorOpen aria-hidden="true" className="size-4" />
              ) : (
                <Search aria-hidden="true" className="size-4" />
              )}
              {hasPlace ? "Has a place" : "Looking for a place"}
            </span>
          )}
          {profile.is_srm_verified && <SrmBadge verified />}
        </div>
        {profile.about && <p className="pt-1 text-base leading-relaxed">{profile.about}</p>}
      </header>

      {mainPhoto ? (
        <Photo url={mainPhoto} alt={`${name}'s main photo`} priority />
      ) : (
        <Card className="from-accent-soft to-forest-soft text-muted flex aspect-[4/5] items-center justify-center bg-gradient-to-br text-sm">
          No photos yet
        </Card>
      )}

      {story}

      {interests.length > 0 && (
        <Panel title="Interests">
          <ul className="flex flex-wrap gap-2">
            {interests.map((interest) => (
              <li
                key={interest.slug}
                className="bg-accent-soft text-accent-strong rounded-full px-3.5 py-1.5 text-sm font-semibold"
              >
                {interest.label}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {(answered.length > 0 || wishes.length > 0) && (
        <Panel title="Lifestyle">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-4">
            {answered.map(({ key, question, label }) => {
              const Icon = ICONS[key];
              return (
                <div key={key} className="flex gap-2">
                  <Icon aria-hidden="true" className="text-forest mt-0.5 size-4 shrink-0" />
                  <div>
                    <dt className="text-muted text-xs">{question}</dt>
                    <dd className="text-sm font-medium">{label}</dd>
                  </div>
                </div>
              );
            })}
          </dl>
          {wishes.length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-2">
              {wishes.map((wish) => (
                <li key={wish.key} className="bg-forest-soft text-forest rounded-full px-3 py-1 text-sm font-medium">
                  {wish.label.replace(/^I'd like /, "Likes ")}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {listing ? (
        <section aria-label={`${name}'s flat`} className="space-y-2">
          <h2 className="font-display text-xl font-semibold">{name}&apos;s flat</h2>
          <ListingCard listing={listing} href={`/listings/${listing.id}`} />
        </section>
      ) : (
        housing === "needs_accommodation" &&
        (profile.preferred_societies.length > 0 || profile.max_budget || moveIn) && (
          <Panel title="Looking for">
            <ul className="space-y-2 text-sm">
              {profile.preferred_societies.length > 0 && (
                <li className="flex gap-2">
                  <MapPin aria-hidden="true" className="text-forest mt-0.5 size-4 shrink-0" />
                  {profile.preferred_societies.join(", ")}
                </li>
              )}
              {profile.max_budget && (
                <li>Budget up to {formatInr(profile.max_budget)} a month</li>
              )}
              {moveIn && <li>Moving in: {moveIn}</li>}
            </ul>
          </Panel>
        )
      )}
    </article>
  );
}
