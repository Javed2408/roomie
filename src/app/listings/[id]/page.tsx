import {
  ArrowLeft,
  BedDouble,
  CalendarDays,
  DoorOpen,
  Lock,
  MapPin,
  Pencil,
  Sofa,
  Users,
  UserRound,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { ListingActions } from "@/components/listings/listing-actions";
import { ListingLike } from "@/components/listings/listing-like";
import { StatusBadge } from "@/components/listings/status-badge";
import { AppShell } from "@/components/ui/app-shell";
import { Avatar } from "@/components/ui/avatar";
import { BottomNav } from "@/components/ui/bottom-nav";
import { Card } from "@/components/ui/card";
import { SrmBadge } from "@/components/ui/srm-badge";
import { FLATMATE_GENDER_OPTIONS, FURNISHING_OPTIONS, LISTING_ROOM_TYPES } from "@/lib/constants/listings";
import { loadDiscoverySettings } from "@/lib/feed";
import { availabilityLabel, formatDate, listingTitle } from "@/lib/listing-display";
import { listingGaps, todayInIndia } from "@/lib/listing-validation";
import { loadListingView } from "@/lib/listings";
import { costs, formatInr } from "@/lib/onboarding";
import { requireStudent } from "@/lib/profile";
import { firstName, headline } from "@/types/feed";

export const metadata: Metadata = { title: "Listing · Roomie" };

const labelOf = (options: ReadonlyArray<{ value: string; label: string }>, value: string | null) =>
  options.find((option) => option.value === value)?.label ?? null;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="p-5">
      <h2 className="font-display text-xl font-semibold">{title}</h2>
      <div className="mt-3">{children}</div>
    </Card>
  );
}

function Fact({ icon: Icon, label, value }: { icon: typeof MapPin; label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <Icon aria-hidden="true" className="text-forest mt-0.5 size-4 shrink-0" />
      <div>
        <dt className="text-muted text-xs">{label}</dt>
        <dd className="text-sm font-medium">{value}</dd>
      </div>
    </div>
  );
}

const NOT_SAID = "Not mentioned";

async function ListingPage({ params }: { params: PageProps<"/listings/[id]">["params"] }) {
  const viewer = await requireStudent();
  const { id } = await params;
  const view = await loadListingView(viewer.user.id, id);
  if (!view) {
    notFound();
  }
  const { listing, owner, isOwner, address, interaction } = view;
  const name = firstName(owner);
  const { monthly, moveIn } = costs(listing);
  const today = todayInIndia();
  const settings = isOwner ? await loadDiscoverySettings(viewer.user.id) : null;
  const gaps = isOwner ? listingGaps(listing) : [];

  return (
    <article aria-labelledby="listing-title" className="space-y-4">
      {isOwner && (
        <div className="bg-forest-soft rounded-card space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <StatusBadge status={listing.status} />
            <span>
              {listing.status === "active"
                ? "This is how other students see your listing."
                : listing.status === "draft"
                  ? "Preview: only you can see this draft."
                  : "Deactivated: only you can see it."}
            </span>
          </div>
          <ListingActions
            id={listing.id}
            title={listingTitle(listing)}
            status={listing.status}
            canPublish={settings?.housing === "has_accommodation"}
            showView={false}
          />
          {gaps.length > 0 && (
            <p className="text-sm">
              <strong>Worth adding:</strong> {gaps.join(" · ")}.
            </p>
          )}
        </div>
      )}

      {/* Gallery: swipe sideways through the photos. */}
      {listing.photos.length > 0 ? (
        <div className="-mx-5 sm:mx-0">
          <ul
            aria-label={`Photos of the flat (${listing.photos.length})`}
            className="flex snap-x snap-mandatory gap-2 overflow-x-auto px-5 [scrollbar-width:none] sm:px-0 [&::-webkit-scrollbar]:hidden"
          >
            {listing.photos.map((url, index) => (
              <li key={url} className="bg-accent-soft relative aspect-[4/3] w-[88%] shrink-0 snap-center overflow-hidden rounded-3xl sm:w-full">
                {/* eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URL */}
                <img
                  src={url}
                  alt={`Flat photo ${index + 1} of ${listing.photos.length}`}
                  loading={index === 0 ? "eager" : "lazy"}
                  className="size-full object-cover"
                />
                <span className="bg-charcoal/70 text-cream absolute right-3 bottom-3 rounded-full px-2.5 py-1 text-xs font-semibold">
                  {index + 1}/{listing.photos.length}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="bg-accent-soft text-muted rounded-card flex aspect-[4/3] items-center justify-center text-sm">
          No photos yet
        </div>
      )}

      <header className="space-y-2 pt-1">
        <h1 id="listing-title" className="font-display text-3xl font-semibold tracking-tight">
          {listing.bhk_type} in {listing.society}
        </h1>
        <p className="text-muted flex items-center gap-1.5 text-sm">
          <MapPin aria-hidden="true" className="text-forest size-4 shrink-0" />
          {[listing.locality, listing.society].filter(Boolean).join(", ")}
        </p>
        <div className="flex items-end justify-between gap-3 pt-1">
          <p>
            <span className="font-display text-3xl font-semibold">{formatInr(monthly)}</span>
            <span className="text-muted text-sm"> /month per person</span>
          </p>
          <p className="text-muted text-right text-xs">Updated {formatDate(listing.updated_at)}</p>
        </div>
      </header>

      {!isOwner && (
        <ListingLike
          ownerId={owner.id}
          ownerName={name}
          interaction={interaction}
          target={{
            type: "listing",
            ref: listing.id,
            listingId: listing.id,
            title: `Liked: ${listing.society} ${listing.bhk_type} • ${formatInr(monthly)}/mo`,
            detail: `${listing.vacant_spots} ${listing.vacant_spots === 1 ? "spot" : "spots"} open · ${formatInr(moveIn)} to move in`,
            imageUrl: listing.photos[0],
          }}
        />
      )}

      <Section title="Costs">
        <dl className="space-y-1.5 text-sm">
          {[
            ["Rent / month", listing.rent_per_person],
            ["Maintenance / month", listing.maintenance_per_person],
            ["Security deposit", listing.deposit_per_person],
            ["One-time setup", listing.setup_cost],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between">
              <dt className="text-muted">{label}</dt>
              <dd className="font-medium">{formatInr(value as number)}</dd>
            </div>
          ))}
          <div className="border-line flex justify-between border-t pt-2 font-semibold">
            <dt>To move in</dt>
            <dd>{formatInr(moveIn)}</dd>
          </div>
        </dl>
        <p className="text-muted mt-2 text-xs">All amounts per person.</p>
      </Section>

      <Section title="The flat">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-4">
          <Fact icon={BedDouble} label="Size" value={listing.bhk_type} />
          <Fact
            icon={DoorOpen}
            label="Free"
            value={`${listing.available_rooms} ${listing.available_rooms === 1 ? "room" : "rooms"}, ${listing.vacant_spots} ${listing.vacant_spots === 1 ? "spot" : "spots"}`}
          />
          <Fact icon={UserRound} label="Room" value={labelOf(LISTING_ROOM_TYPES, listing.room_type) ?? NOT_SAID} />
          <Fact icon={Sofa} label="Furnishing" value={labelOf(FURNISHING_OPTIONS, listing.furnishing) ?? NOT_SAID} />
          <Fact icon={CalendarDays} label="Move in" value={availabilityLabel(listing.available_from, today)} />
          <Fact icon={Users} label="Living there now" value={`${listing.current_flatmates} ${listing.current_flatmates === 1 ? "person" : "people"}`} />
        </dl>
        {listing.description && <p className="mt-4 text-sm leading-relaxed whitespace-pre-line">{listing.description}</p>}
      </Section>

      {listing.location_notes && (
        <Section title="Getting there">
          <p className="text-sm leading-relaxed">{listing.location_notes}</p>
        </Section>
      )}

      {isOwner && (
        <Card className="flex items-start gap-3 p-4 text-sm">
          <Lock aria-hidden="true" className="text-forest mt-0.5 size-4 shrink-0" />
          <p>
            <strong>Exact address (only you see this):</strong>{" "}
            {address ?? <span className="text-muted">not added</span>}
          </p>
        </Card>
      )}

      {listing.amenities.length > 0 && (
        <Section title="Amenities">
          <ul className="flex flex-wrap gap-2">
            {listing.amenities.map((amenity) => (
              <li key={amenity} className="border-line rounded-full border px-3 py-1 text-sm font-medium">
                {amenity}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {(listing.living_arrangement || listing.house_rules) && (
        <Section title="Living there">
          {listing.living_arrangement && <p className="text-sm leading-relaxed whitespace-pre-line">{listing.living_arrangement}</p>}
          {listing.house_rules && (
            <>
              <h3 className="mt-4 text-sm font-semibold">House rules</h3>
              <p className="mt-1 text-sm leading-relaxed whitespace-pre-line">{listing.house_rules}</p>
            </>
          )}
        </Section>
      )}

      <Section title="Who they're looking for">
        <p className="text-sm">
          <span className="text-muted">Open to: </span>
          <strong>{labelOf(FLATMATE_GENDER_OPTIONS, listing.preferred_flatmate_gender) ?? "Anyone"}</strong>
        </p>
        {listing.flatmate_preferences && <p className="mt-2 text-sm leading-relaxed">{listing.flatmate_preferences}</p>}
      </Section>

      {/* The student behind the listing: kept visually apart from the flat. */}
      <section aria-labelledby="owner-heading" className="pt-2">
        <h2 id="owner-heading" className="text-muted mb-2 text-xs font-semibold tracking-wide uppercase">
          Listed by
        </h2>
        <Link
          href={`/students/${owner.id}`}
          className="bg-surface border-line rounded-card hover:border-charcoal/30 focus-visible:outline-accent flex items-center gap-4 border p-4 focus-visible:outline-2"
        >
          <Avatar url={owner.avatar_url} name={name} className="size-14 shrink-0 rounded-full text-xl" />
          <div className="min-w-0 flex-1">
            <p className="font-display text-lg font-semibold">{isOwner ? `${name} (you)` : name}</p>
            {headline(owner) && <p className="text-muted text-sm">{headline(owner)}</p>}
            {owner.about && <p className="mt-1 line-clamp-2 text-sm">{owner.about}</p>}
            {owner.is_srm_verified && (
              <div className="mt-2">
                <SrmBadge verified />
              </div>
            )}
          </div>
          <span className="text-sm font-semibold whitespace-nowrap underline underline-offset-4">Profile</span>
        </Link>
      </section>

      {isOwner && (
        <Link
          href={`/account/listings/${listing.id}/edit`}
          className="text-charcoal focus-visible:outline-accent flex min-h-12 items-center justify-center gap-2 text-sm font-semibold underline underline-offset-4 focus-visible:outline-2"
        >
          <Pencil aria-hidden="true" className="size-4" />
          Edit this listing
        </Link>
      )}
    </article>
  );
}

function ListingPlaceholder() {
  return (
    <div aria-hidden="true" className="space-y-4">
      <div className="bg-charcoal/5 aspect-[4/3] animate-pulse rounded-3xl" />
      <div className="bg-charcoal/5 h-10 w-2/3 animate-pulse rounded-xl" />
    </div>
  );
}

export default function ListingDetailPage({ params }: PageProps<"/listings/[id]">) {
  return (
    <AppShell
      header={
        <Link
          href="/discover"
          className="hover:bg-charcoal/5 focus-visible:outline-accent -ml-2 inline-flex min-h-12 items-center gap-2 rounded-full pr-4 pl-2 font-semibold focus-visible:outline-2"
        >
          <ArrowLeft aria-hidden="true" className="size-5" />
          Discover
        </Link>
      }
      footer={<BottomNav />}
    >
      <Suspense fallback={<ListingPlaceholder />}>
        <ListingPage params={params} />
      </Suspense>
    </AppShell>
  );
}
