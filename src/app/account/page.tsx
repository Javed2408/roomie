import { Eye, EyeOff, LogOut, Pencil } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { signOut } from "@/app/login/actions";
import { setListingActive } from "@/app/onboarding/actions";
import { FeedCard } from "@/components/feed/feed-card";
import { ListingCard } from "@/components/feed/listing-card";
import { AppShell } from "@/components/ui/app-shell";
import { BottomNav } from "@/components/ui/bottom-nav";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SrmBadge } from "@/components/ui/srm-badge";
import { Wordmark } from "@/components/ui/wordmark";
import { MOVE_IN_TIMEFRAMES } from "@/lib/constants/prompts";
import { formatInr } from "@/lib/onboarding";
import { getCurrentUser, isOnboarded } from "@/lib/profile";

export const metadata: Metadata = { title: "Your account · Roomie" };

function SectionHeading({
  title,
  editHref,
  editLabel,
}: {
  title: string;
  editHref: string;
  editLabel: string;
}) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="font-display text-xl font-semibold">{title}</h2>
      <ButtonLink
        href={editHref}
        variant="ghost"
        className="min-h-11 px-3 text-sm"
        aria-label={editLabel}
      >
        <Pencil aria-hidden="true" className="size-4" />
        Edit
      </ButtonLink>
    </div>
  );
}

/** Your profile as others see it, your flat or preferences, and settings. */
async function AccountDetails() {
  const current = await getCurrentUser();
  if (!current) {
    redirect("/login");
  }
  const { user, profile, listing } = current;
  if (!profile || !isOnboarded(profile)) {
    redirect("/onboarding");
  }

  const isOwner = profile.mode === "have_flat";
  const timeframe = MOVE_IN_TIMEFRAMES.find(
    (item) => item.value === profile.move_in_timeframe,
  )?.label;

  return (
    <div className="space-y-10">
      <Card className="p-5">
        <p className="text-muted text-sm">Signed in as</p>
        <p className="mt-0.5 font-semibold break-all">{user.email}</p>
        <div className="mt-3">
          <SrmBadge verified={profile.is_srm_verified} />
        </div>
      </Card>

      <section aria-labelledby="profile-heading">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="profile-heading" className="font-display text-xl font-semibold">
            Your profile
          </h2>
          <span className="text-muted text-xs">As others see it</span>
        </div>
        <FeedCard candidate={{ profile, listing: isOwner ? listing : null }} />
        <div className="mt-4 grid grid-cols-2 gap-3">
          <ButtonLink href="/onboarding?step=about" variant="secondary">
            Edit details
          </ButtonLink>
          <ButtonLink href="/onboarding?step=prompts" variant="secondary">
            Edit prompts
          </ButtonLink>
        </div>
      </section>

      {isOwner ? (
        <section aria-label="Your flat">
          <SectionHeading
            title="Your flat"
            editHref="/onboarding?step=details"
            editLabel="Edit your flat"
          />
          {listing ? (
            <>
              <ListingCard listing={listing} />
              <form
                action={setListingActive.bind(null, !listing.is_active)}
                className="mt-3"
              >
                <Card className="flex items-center justify-between gap-3 p-4">
                  <p className="text-sm">
                    {listing.is_active ? (
                      <>
                        <strong className="text-forest">Live</strong>: students
                        can find your flat.
                      </>
                    ) : (
                      <>
                        <strong>Hidden</strong>: nobody can see your flat.
                      </>
                    )}
                  </p>
                  <Button
                    type="submit"
                    variant="secondary"
                    className="min-h-11 shrink-0 px-4 text-sm"
                  >
                    {listing.is_active ? (
                      <EyeOff aria-hidden="true" className="size-4" />
                    ) : (
                      <Eye aria-hidden="true" className="size-4" />
                    )}
                    {listing.is_active ? "Hide" : "Show"}
                  </Button>
                </Card>
              </form>
            </>
          ) : (
            <Card className="p-5">
              <p className="text-muted text-sm">
                Your flat isn&apos;t listed yet.
              </p>
              <ButtonLink href="/onboarding?step=details" className="mt-3">
                Add your flat
              </ButtonLink>
            </Card>
          )}
        </section>
      ) : (
        <section aria-label="What you're looking for">
          <SectionHeading
            title="What you're looking for"
            editHref="/onboarding?step=details"
            editLabel="Edit what you're looking for"
          />
          <Card className="p-5">
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-muted">Societies</dt>
                <dd className="mt-1 flex flex-wrap gap-1.5">
                  {profile.preferred_societies.map((society) => (
                    <span
                      key={society}
                      className="bg-forest-soft text-forest rounded-full px-3 py-1 font-medium"
                    >
                      {society}
                    </span>
                  ))}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Max budget</dt>
                <dd className="font-medium">
                  {profile.max_budget ? `${formatInr(profile.max_budget)} / month` : "Not set"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Move in</dt>
                <dd className="font-medium">{timeframe ?? "Not set"}</dd>
              </div>
            </dl>
          </Card>
        </section>
      )}

      <div className="space-y-3">
        <ButtonLink href="/onboarding?step=intent" variant="ghost" fullWidth>
          Switch between &ldquo;have a flat&rdquo; and &ldquo;need a flat&rdquo;
        </ButtonLink>
        <form action={signOut}>
          <Button type="submit" variant="secondary" fullWidth>
            <LogOut aria-hidden="true" className="size-4" />
            Sign out
          </Button>
        </form>
      </div>
    </div>
  );
}

function AccountPlaceholder() {
  return (
    <div aria-hidden="true" className="space-y-5">
      <div className="bg-charcoal/5 rounded-card h-32 animate-pulse" />
      <div className="bg-charcoal/5 rounded-card aspect-[4/5] animate-pulse" />
    </div>
  );
}

export default function AccountPage() {
  return (
    <AppShell header={<Wordmark />} footer={<BottomNav current="Account" />}>
      <h1 className="font-display mb-6 text-4xl font-semibold tracking-tight">
        Your account
      </h1>
      <Suspense fallback={<AccountPlaceholder />}>
        <AccountDetails />
      </Suspense>
    </AppShell>
  );
}
