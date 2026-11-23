import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/uuid";
import { PUBLIC_PROFILE_COLUMNS, type ListingRow, type PublicProfile } from "@/types/database";

/** Throw on a failed read: an error screen beats showing nothing. */
function must<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) {
    throw new Error(`Couldn't load ${what}: ${result.error.message}`);
  }
  return result.data;
}

/** All of a student's listings, live first, then the most recently edited. */
export async function loadMyListings(userId: string): Promise<ListingRow[]> {
  const supabase = await createClient();
  const rows = must(
    await supabase
      .from("listings")
      .select("*")
      .eq("owner_id", userId)
      .order("is_active", { ascending: false })
      .order("updated_at", { ascending: false }),
    "your listings",
  );
  return rows ?? [];
}

/** One of your own listings with its private address, or null. */
export async function loadOwnListing(
  userId: string,
  listingId: string,
): Promise<{ listing: ListingRow; address: string | null } | null> {
  if (!isUuid(listingId)) {
    return null;
  }
  const supabase = await createClient();
  const [listing, details] = await Promise.all([
    supabase.from("listings").select("*").eq("id", listingId).eq("owner_id", userId).maybeSingle(),
    supabase.from("listing_private_details").select("address").eq("listing_id", listingId).maybeSingle(),
  ]);
  const row = must(listing, "the listing");
  return row ? { listing: row, address: must(details, "the address")?.address ?? null } : null;
}

/** Where the viewer stands with the listing's owner. */
export type Interaction =
  | { kind: "none" }
  | { kind: "liked"; at: string; thisListing: boolean }
  | { kind: "passed" }
  | { kind: "matched"; matchId: string };

export type ListingView = {
  listing: ListingRow;
  owner: PublicProfile;
  isOwner: boolean;
  /** Only for the owner. */
  address: string | null;
  interaction: Interaction;
};

/**
 * A listing as a page shows it. Others can only open live listings (the
 * database hides drafts and deactivated ones from them); owners can open
 * any of their own, e.g. to preview a draft.
 */
export async function loadListingView(viewerId: string, listingId: string): Promise<ListingView | null> {
  if (!isUuid(listingId)) {
    return null;
  }
  const supabase = await createClient();
  const listing = must(await supabase.from("listings").select("*").eq("id", listingId).maybeSingle(), "the listing");
  if (!listing) {
    return null;
  }
  const isOwner = listing.owner_id === viewerId;
  const [owner, details, swipe, match] = await Promise.all([
    supabase.from("profiles").select(PUBLIC_PROFILE_COLUMNS).eq("id", listing.owner_id).maybeSingle(),
    isOwner
      ? supabase.from("listing_private_details").select("address").eq("listing_id", listingId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    isOwner
      ? Promise.resolve({ data: null, error: null })
      : supabase
          .from("swipes")
          .select("action, liked_listing_id, created_at")
          .eq("sender_id", viewerId)
          .eq("receiver_id", listing.owner_id)
          .maybeSingle(),
    isOwner
      ? Promise.resolve({ data: null, error: null })
      : supabase
          .from("matches")
          .select("id")
          .eq("user_a", [viewerId, listing.owner_id].sort()[0])
          .eq("user_b", [viewerId, listing.owner_id].sort()[1])
          .maybeSingle(),
  ]);
  const profile = must(owner, "the owner's profile");
  if (!profile?.full_name) {
    return null;
  }
  const decision = must(swipe, "your likes");
  const matched = must(match, "your matches");
  const interaction: Interaction = matched
    ? { kind: "matched", matchId: matched.id }
    : decision?.action === "like"
      ? { kind: "liked", at: decision.created_at, thisListing: decision.liked_listing_id === listing.id }
      : decision?.action === "pass"
        ? { kind: "passed" }
        : { kind: "none" };
  return {
    listing,
    owner: profile,
    isOwner,
    address: must(details, "the address")?.address ?? null,
    interaction,
  };
}
