import { BedDouble, ImageOff, MapPin, Users } from "lucide-react";
import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { costs, formatInr } from "@/lib/onboarding";
import type { ListingRow } from "@/types/database";

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium">{formatInr(value)}</dd>
    </div>
  );
}

/** A flat with space: photos, size, the honest cost breakdown and perks. */
export function ListingCard({
  listing,
  showPhotos = true,
  corner,
}: {
  listing: ListingRow;
  /** The feed shows flat photos separately, each with its own like. */
  showPhotos?: boolean;
  /** Something pinned to the bottom-right corner, e.g. a like button. */
  corner?: ReactNode;
}) {
  const { monthly, moveIn } = costs(listing);
  return (
    <Card className="relative overflow-hidden">
      {!showPhotos ? null : listing.photos.length > 0 ? (
        <ul
          aria-label="Flat photos"
          className="flex snap-x snap-mandatory gap-1 overflow-x-auto"
        >
          {listing.photos.map((url, index) => (
            <li
              key={url}
              className="bg-accent-soft aspect-[4/3] w-full shrink-0 snap-center"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URL */}
              <img
                src={url}
                alt={`Flat photo ${index + 1} of ${listing.photos.length}`}
                className="size-full object-cover"
              />
            </li>
          ))}
        </ul>
      ) : (
        <div className="bg-accent-soft text-muted flex aspect-[4/3] flex-col items-center justify-center gap-2 text-sm">
          <ImageOff aria-hidden="true" className="size-8" />
          No flat photos yet
        </div>
      )}

      <div className={`space-y-4 p-5 ${corner ? "pb-20" : ""}`}>
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <span className="bg-forest-soft text-forest inline-flex items-center gap-1 rounded-full px-3 py-1">
            <MapPin aria-hidden="true" className="size-4" />
            {listing.society}
          </span>
          <span className="bg-charcoal/5 inline-flex items-center gap-1 rounded-full px-3 py-1">
            <BedDouble aria-hidden="true" className="size-4" />
            {listing.bhk_type}
          </span>
          <span className="bg-charcoal/5 inline-flex items-center gap-1 rounded-full px-3 py-1">
            <Users aria-hidden="true" className="size-4" />
            {listing.vacant_spots}{" "}
            {listing.vacant_spots === 1 ? "spot" : "spots"} open
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-cream rounded-2xl p-3">
            <p className="text-muted text-xs font-semibold uppercase">Monthly</p>
            <p className="font-display text-2xl font-semibold">
              {formatInr(monthly)}
            </p>
          </div>
          <div className="bg-cream rounded-2xl p-3">
            <p className="text-muted text-xs font-semibold uppercase">To move in</p>
            <p className="font-display text-2xl font-semibold">
              {formatInr(moveIn)}
            </p>
          </div>
        </div>

        <dl className="space-y-1.5">
          <Row label="Rent / month" value={listing.rent_per_person} />
          <Row label="Maintenance / month" value={listing.maintenance_per_person} />
          <Row label="Security deposit" value={listing.deposit_per_person} />
          <Row label="One-time setup" value={listing.setup_cost} />
        </dl>

        {listing.amenities.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Flat perks">
            {listing.amenities.map((amenity) => (
              <li
                key={amenity}
                className="border-line rounded-full border px-3 py-1 text-xs font-medium"
              >
                {amenity}
              </li>
            ))}
          </ul>
        )}
      </div>
      {corner}
    </Card>
  );
}
