"use client";

import { ArrowLeft, Home, UserRound } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { ProfileLink } from "@/components/chat/profile-link";
import { FeedCard } from "@/components/feed/feed-card";
import { Avatar } from "@/components/ui/avatar";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button, ButtonLink } from "@/components/ui/button";
import { SafetyTip } from "@/components/ui/safety-tip";
import { SrmMark } from "@/components/ui/srm-badge";
import { lookingFor } from "@/lib/likes";
import { profileHref } from "@/lib/profile-links";
import { firstName, type Candidate } from "@/types/feed";

/**
 * The chat's sticky top bar: back, who you're talking to (their photo and
 * name open their full profile page), and a quick look at their profile and
 * flat (with the cost breakdown) in a sheet.
 */
export function ChatHeader({ them }: { them: Candidate }) {
  const [showProfile, setShowProfile] = useState(false);
  const name = firstName(them.profile);
  const hasFlat = Boolean(them.listing);

  return (
    <div className="-mx-2 flex items-center gap-2">
      <Link
        href="/matches"
        aria-label="Back to matches"
        className="hover:bg-charcoal/5 focus-visible:outline-accent flex size-12 shrink-0 items-center justify-center rounded-full focus-visible:outline-2"
      >
        <ArrowLeft aria-hidden="true" className="size-5" />
      </Link>
      <ProfileLink
        href={profileHref(them.profile.id)}
        label={`${name}'s profile`}
        fallback="div"
        className="flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-xl pr-2"
        linkClassName="hover:bg-charcoal/5"
      >
        <Avatar
          url={them.profile.avatar_url}
          name={name}
          className="size-10 rounded-full text-base"
        />
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-1.5 font-semibold">
            <span className="truncate">{name}</span>
            {them.profile.is_srm_verified && <SrmMark />}
          </h1>
          <p className="text-muted truncate text-xs">{lookingFor(them)}</p>
        </div>
      </ProfileLink>
      <Button
        variant="secondary"
        className="shrink-0 px-4 text-sm"
        onClick={() => setShowProfile(true)}
      >
        {hasFlat ? (
          <Home aria-hidden="true" className="size-4" />
        ) : (
          <UserRound aria-hidden="true" className="size-4" />
        )}
        {hasFlat ? "Profile & flat" : "Profile"}
      </Button>

      {showProfile && (
        <BottomSheet
          title={hasFlat ? `${name}'s profile & flat` : `${name}'s profile`}
          onClose={() => setShowProfile(false)}
        >
          <SafetyTip className="mb-5" />
          <FeedCard candidate={them} />
          <ButtonLink href={`/students/${them.profile.id}`} variant="secondary" fullWidth className="mt-5">
            See full profile
          </ButtonLink>
        </BottomSheet>
      )}
    </div>
  );
}
