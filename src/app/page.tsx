import { Heart, MessageCircle, ShieldCheck, UserRound, type LucideIcon } from "lucide-react";
import Link from "next/link";

import { FeedCard } from "@/components/feed/feed-card";
import { AppShell } from "@/components/ui/app-shell";
import { ButtonLink } from "@/components/ui/button";
import { Wordmark } from "@/components/ui/wordmark";
import type { Candidate } from "@/types/feed";

// The areas Roomie starts with, around SRM Kattankulathur.
const SOCIETIES = ["Abode Valley", "Estancia", "Akshaya", "Green Pearl", "Potheri"];

const STEPS: Array<{ icon: LucideIcon; title: string; text: string }> = [
  {
    icon: UserRound,
    title: "Make your profile",
    text: "Three prompts, your society and your budget. Sign up with your @srmist.edu.in email for the Verified SRM Student badge.",
  },
  {
    icon: Heart,
    title: "Like what catches your eye",
    text: "A prompt, a photo or the flat itself, with a comment, so every like starts a real conversation.",
  },
  {
    icon: MessageCircle,
    title: "Match and chat",
    text: "Talk rent split, house rules and move-in dates, then visit the flat together.",
  },
];

// An invented example so visitors can see what a profile looks like.
// Not a real person; labelled "Sample" on screen.
const SAMPLE: Candidate = {
  profile: {
    id: "sample",
    full_name: "Meera",
    gender: "female",
    year_of_study: 3,
    department: "CSE",
    mode: "have_flat",
    is_srm_verified: true,
    avatar_url: "/seed/avatar-meera.svg",
    bio_prompts: [
      {
        question: "Our flat's current vibe & house rules...",
        answer: "Calm on weekdays, movie nights on Fridays. Dishes done the same day, rent split on the 5th.",
      },
      {
        question: "Before an 8 AM class, I'm...",
        answer: "Out of the door by 7:40 with filter coffee, sharing an auto to the Arch gate.",
      },
    ],
    about: "Third-year CSE, happiest with filter coffee and a quiet desk. Looking for one easy-going flatmate.",
    preferred_societies: [],
    max_budget: null,
    move_in_timeframe: null,
    is_sample: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
  listing: {
    id: "sample-flat",
    owner_id: "sample",
    society: "Abode Valley",
    bhk_type: "3BHK",
    vacant_spots: 1,
    rent_per_person: 11000,
    maintenance_per_person: 1500,
    deposit_per_person: 22000,
    setup_cost: 0,
    amenities: ["AC", "Wi-Fi", "Cook", "Power Backup"],
    photos: ["/seed/flat-abode-living.svg", "/seed/flat-abode-bedroom.svg"],
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    description: null,
    available_rooms: 1,
    current_flatmates: 2,
    available_from: null,
    preferred_flatmate_gender: "any",
    flatmate_preferences: null,
    updated_at: "2026-01-01T00:00:00Z",
    status: "active",
    locality: null,
    location_notes: null,
    room_type: null,
    furnishing: null,
    house_rules: null,
    living_arrangement: null,
  },
};

/**
 * Landing screen for visitors who aren't signed in (signed-in students are
 * sent straight to /discover by src/proxy.ts).
 */
export default function Home() {
  return (
    <AppShell header={<Wordmark />}>
      <section className="space-y-4">
        <h1 className="font-display text-[2.5rem] leading-[1.05] font-semibold tracking-tight">
          Find your people.
          <br />
          <span className="text-accent">Then</span> your place.
        </h1>
        <p className="text-muted text-lg leading-relaxed">
          Roomie is for SRM KTR students: meet flatmates you&apos;ll actually get along with,
          and find a spot in a flat near campus, with the real monthly cost up front.
        </p>
        <ul className="flex flex-wrap gap-2" aria-label="Areas near campus">
          {SOCIETIES.map((name) => (
            <li key={name} className="bg-surface border-line rounded-full border px-3 py-1.5 text-sm">
              {name}
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-8 space-y-3">
        <ButtonLink href="/login" fullWidth>
          Get started
        </ButtonLink>
        <p className="text-muted text-center text-sm">
          Already on Roomie?{" "}
          <Link
            href="/login"
            className="text-charcoal font-semibold underline underline-offset-2"
          >
            Sign in
          </Link>
        </p>
      </div>

      <section aria-labelledby="how-heading" className="mt-12">
        <h2 id="how-heading" className="font-display text-2xl font-semibold">
          How it works
        </h2>
        <ol className="mt-4 space-y-4">
          {STEPS.map(({ icon: Icon, title, text }, index) => (
            <li key={title} className="flex gap-4">
              <span className="bg-accent-soft text-accent-strong flex size-11 shrink-0 items-center justify-center rounded-full">
                <Icon aria-hidden="true" className="size-5" />
              </span>
              <div>
                <p className="font-semibold">
                  <span className="sr-only">Step {index + 1}: </span>
                  {title}
                </p>
                <p className="text-muted mt-0.5 text-sm leading-relaxed">{text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="preview-heading" className="mt-12">
        <h2 id="preview-heading" className="font-display text-2xl font-semibold">
          What you&apos;ll see
        </h2>
        <p className="text-muted mt-1 mb-4 text-sm">
          Every flat shows rent, maintenance, deposit and what it costs to move in.
        </p>
        <FeedCard candidate={SAMPLE} badge="Sample" />
      </section>

      <p className="text-muted mt-10 flex items-start gap-2 text-sm leading-relaxed">
        <ShieldCheck aria-hidden="true" className="text-forest mt-0.5 size-5 shrink-0" />
        Built for students: profiles show the society, never a flat number or address.
      </p>
    </AppShell>
  );
}
