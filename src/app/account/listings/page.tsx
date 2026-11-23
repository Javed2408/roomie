import { ArrowLeft, BedDouble, Building2, ImageOff, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ListingActions } from "@/components/listings/listing-actions";
import { StatusBadge } from "@/components/listings/status-badge";
import { AppShell } from "@/components/ui/app-shell";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MAX_LISTINGS_PER_STUDENT } from "@/lib/constants/preferences";
import { loadDiscoverySettings } from "@/lib/feed";
import { formatDate, listingTitle, spaceLabel } from "@/lib/listing-display";
import { listingGaps } from "@/lib/listing-validation";
import { loadMyListings } from "@/lib/listings";
import { costs, formatInr } from "@/lib/onboarding";
import { requireStudent } from "@/lib/profile";

export const metadata: Metadata = { title: "Your listings · Roomie" };

async function Listings() {
  const student = await requireStudent();
  const [listings, settings] = await Promise.all([
    loadMyListings(student.user.id),
    loadDiscoverySettings(student.user.id),
  ]);
  const hasPlace = settings.housing === "has_accommodation";
  const atLimit = listings.length >= MAX_LISTINGS_PER_STUDENT;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Your listings</h1>
          <p className="text-muted mt-1 text-sm">One can be live at a time. Drafts are only visible to you.</p>
        </div>
        {hasPlace && !atLimit && (
          <ButtonLink href="/account/listings/new" className="min-h-11 shrink-0 px-4 text-sm">
            <Plus aria-hidden="true" className="size-4" />
            New
          </ButtonLink>
        )}
      </div>

      {!hasPlace && (
        <div className="bg-accent-soft rounded-card p-4 text-sm leading-relaxed">
          Your housing is set to &quot;I need a place&quot;, so you can&apos;t create or publish listings
          right now. Existing ones stay as they are.{" "}
          <Link href="/profile/edit?section=housing" className="font-semibold underline underline-offset-4">
            Change your housing
          </Link>
        </div>
      )}
      {atLimit && (
        <p className="text-muted text-sm">
          You have {MAX_LISTINGS_PER_STUDENT} listings, the most you can keep. Delete an old one to add another.
        </p>
      )}

      {listings.length === 0 ? (
        <div className="rounded-card border-line flex flex-col items-center border border-dashed px-6 py-12 text-center">
          <span className="bg-forest-soft text-forest flex size-14 items-center justify-center rounded-full">
            <Building2 aria-hidden="true" className="size-7" />
          </span>
          <h2 className="font-display mt-4 text-2xl font-semibold">No listings yet</h2>
          <p className="text-muted mt-2 max-w-xs text-sm leading-relaxed">
            Have a room or a spot to share? A listing takes about five minutes, and you can save it as a draft
            along the way.
          </p>
          {hasPlace && (
            <ButtonLink href="/account/listings/new" className="mt-6">
              <Plus aria-hidden="true" className="size-4" />
              Create your first listing
            </ButtonLink>
          )}
        </div>
      ) : (
        <ul className="space-y-4">
          {listings.map((listing) => {
            const gaps = listingGaps(listing);
            const cover = listing.photos[0];
            return (
              <li key={listing.id}>
                <Card className="overflow-hidden">
                  <Link href={`/listings/${listing.id}`} className="focus-visible:outline-accent block focus-visible:outline-2 focus-visible:-outline-offset-2">
                    <div className="bg-accent-soft relative aspect-[16/9]">
                      {cover ? (
                        // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URL
                        <img src={cover} alt="" className="size-full object-cover" />
                      ) : (
                        <div className="text-muted flex size-full flex-col items-center justify-center gap-1 text-sm">
                          <ImageOff aria-hidden="true" className="size-7" />
                          No photos yet
                        </div>
                      )}
                      <span className="absolute top-3 left-3">
                        <StatusBadge status={listing.status} />
                      </span>
                    </div>
                    <div className="p-4 pb-2">
                      <h2 className="font-display text-xl font-semibold">{listingTitle(listing)}</h2>
                      {listing.locality && <p className="text-muted text-sm">{listing.locality}</p>}
                      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                        <strong className="font-display text-lg">{formatInr(costs(listing).monthly)}/mo</strong>
                        <span className="inline-flex items-center gap-1">
                          <BedDouble aria-hidden="true" className="text-forest size-4" />
                          {spaceLabel(listing)}
                        </span>
                      </p>
                      <p className="text-muted mt-1 text-xs">
                        Updated {formatDate(listing.updated_at)}
                        {gaps.length > 0 ? ` · ${gaps.length} ${gaps.length === 1 ? "detail" : "details"} worth adding` : ""}
                      </p>
                    </div>
                  </Link>
                  <div className="px-4 pt-2 pb-4">
                    <ListingActions
                      id={listing.id}
                      title={listingTitle(listing)}
                      status={listing.status}
                      canPublish={hasPlace}
                    />
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ListingsPlaceholder() {
  return (
    <div aria-hidden="true" className="space-y-4">
      <div className="bg-charcoal/5 h-9 w-1/2 animate-pulse rounded-xl" />
      <div className="bg-charcoal/5 rounded-card aspect-[16/9] animate-pulse" />
    </div>
  );
}

export default function ListingsPage() {
  return (
    <AppShell
      header={
        <Link
          href="/account"
          className="hover:bg-charcoal/5 focus-visible:outline-accent -ml-2 inline-flex min-h-12 items-center gap-2 rounded-full pr-4 pl-2 font-semibold focus-visible:outline-2"
        >
          <ArrowLeft aria-hidden="true" className="size-5" />
          Account
        </Link>
      }
    >
      <Suspense fallback={<ListingsPlaceholder />}>
        <Listings />
      </Suspense>
    </AppShell>
  );
}
