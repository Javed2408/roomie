import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ListingEditor } from "@/components/listings/listing-editor";
import { AppShell } from "@/components/ui/app-shell";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { loadDiscoverySettings } from "@/lib/feed";
import { EMPTY_LISTING_FORM } from "@/lib/listing-validation";
import { requireStudent } from "@/lib/profile";

export const metadata: Metadata = { title: "New listing · Roomie" };

async function NewListing() {
  const student = await requireStudent();
  const settings = await loadDiscoverySettings(student.user.id);
  if (settings.housing !== "has_accommodation") {
    return (
      <Card className="p-5">
        <h1 className="font-display text-2xl font-semibold">Listings are for students with a place</h1>
        <p className="text-muted mt-2 text-sm leading-relaxed">
          Your housing is set to &quot;I need a place&quot;. If you have a room or spot to share, change it
          first.
        </p>
        <ButtonLink href="/profile/edit?section=housing" className="mt-4">
          Change your housing
        </ButtonLink>
      </Card>
    );
  }
  return (
    <>
      <h1 className="font-display mb-4 text-3xl font-semibold tracking-tight">New listing</h1>
      <ListingEditor userId={student.user.id} initial={EMPTY_LISTING_FORM} canPublish />
    </>
  );
}

export default function NewListingPage() {
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
        <NewListing />
      </Suspense>
    </AppShell>
  );
}
