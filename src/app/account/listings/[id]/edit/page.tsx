import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ListingEditor } from "@/components/listings/listing-editor";
import { StatusBadge } from "@/components/listings/status-badge";
import { AppShell } from "@/components/ui/app-shell";
import { loadDiscoverySettings } from "@/lib/feed";
import { listingTitle } from "@/lib/listing-display";
import { formFromListing } from "@/lib/listing-validation";
import { loadOwnListing } from "@/lib/listings";
import { requireStudent } from "@/lib/profile";

export const metadata: Metadata = { title: "Edit listing · Roomie" };

async function EditListing({
  params,
  searchParams,
}: {
  params: PageProps<"/account/listings/[id]/edit">["params"];
  searchParams: PageProps<"/account/listings/[id]/edit">["searchParams"];
}) {
  const student = await requireStudent();
  const [{ id }, { step }] = await Promise.all([params, searchParams]);
  const [own, settings] = await Promise.all([
    loadOwnListing(student.user.id, id),
    loadDiscoverySettings(student.user.id),
  ]);
  if (!own) {
    notFound();
  }
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl font-semibold tracking-tight">{listingTitle(own.listing)}</h1>
        <StatusBadge status={own.listing.status} />
      </div>
      <ListingEditor
        key={own.listing.id}
        userId={student.user.id}
        listingId={own.listing.id}
        status={own.listing.status}
        initial={formFromListing(own.listing, own.address)}
        canPublish={settings.housing === "has_accommodation"}
        initialStep={typeof step === "string" ? step : undefined}
      />
    </>
  );
}

export default function EditListingPage({ params, searchParams }: PageProps<"/account/listings/[id]/edit">) {
  return (
    <AppShell
      header={
        <Link
          href="/account/listings"
          className="hover:bg-charcoal/5 focus-visible:outline-accent -ml-2 inline-flex min-h-12 items-center gap-2 rounded-full pr-4 pl-2 font-semibold focus-visible:outline-2"
        >
          <ArrowLeft aria-hidden="true" className="size-5" />
          Your listings
        </Link>
      }
    >
      <Suspense fallback={<div aria-hidden="true" className="bg-charcoal/5 h-64 animate-pulse rounded-3xl" />}>
        <EditListing params={params} searchParams={searchParams} />
      </Suspense>
    </AppShell>
  );
}
