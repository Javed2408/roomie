"use server";

import { refresh } from "next/cache";

import { validateAddress, validateListing, type ListingForm, type Problems } from "@/lib/listing-validation";
import { isOwnMediaUrl } from "@/lib/media";
import { removeUnusedMedia } from "@/lib/media-cleanup";
import { getActionUser } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/uuid";

/**
 * Listing actions. Every input is checked again here, and the database
 * checks ownership, eligibility, photos and the one-live-listing rule
 * itself (migration 014), so nothing depends on the browser behaving.
 */

export type SaveListingResult =
  | { ok: true; id: string }
  | { ok: false; error: string; problems?: Problems };

const NEEDS_ANOTHER_LOOK = "Some details need another look.";
const NEEDS_PLACE = 'To list a flat, set your housing to "I have a place" first.';

/** Our own database messages are written for students; anything else isn't. */
function friendly(error: { code?: string; message: string }, fallback: string): string {
  if (error.code === "42501" && /row-level security/i.test(error.message)) {
    return NEEDS_PLACE;
  }
  return /^[A-Z].*[.!]$/.test(error.message) && !/violates|constraint|permission/i.test(error.message)
    ? error.message
    : fallback;
}

/** Create a listing (as a draft) or save changes to one of yours. */
export async function saveListing(form: ListingForm, listingId?: string): Promise<SaveListingResult> {
  const session = await getActionUser();
  if (!session.ok) {
    return { ok: false, error: session.error };
  }
  const { user } = session;
  if (listingId !== undefined && !isUuid(listingId)) {
    return { ok: false, error: "That listing isn't yours." };
  }
  const { value, problems } = validateListing(form ?? {});
  const address = validateAddress(form?.address);
  if (address.problem) {
    problems.address = address.problem;
  }
  const supabase = await createClient();

  // Photos: your own flat uploads, or ones this listing already had.
  let existingPhotos: string[] = [];
  if (listingId) {
    const { data: existing } = await supabase
      .from("listings")
      .select("photos")
      .eq("id", listingId)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (!existing) {
      return { ok: false, error: "That listing isn't yours." };
    }
    existingPhotos = existing.photos;
  }
  const foreign = value.photos.filter(
    (url) =>
      !existingPhotos.includes(url) &&
      !(isOwnMediaUrl(url, user.id) && /\/listing-[A-Za-z0-9._-]+$/.test(url)),
  );
  if (foreign.length > 0) {
    problems.photos = "Upload those photos again: one of them isn't a flat photo of yours.";
  }
  if (Object.keys(problems).length > 0) {
    return { ok: false, error: NEEDS_ANOTHER_LOOK, problems };
  }

  let id = listingId;
  if (id) {
    const { error } = await supabase.from("listings").update(value).eq("id", id).eq("owner_id", user.id);
    if (error) {
      return { ok: false, error: friendly(error, "Your listing couldn't be saved. Please try again.") };
    }
  } else {
    const { data, error } = await supabase
      .from("listings")
      .insert({ ...value, owner_id: user.id })
      .select("id")
      .single();
    if (error || !data) {
      return { ok: false, error: friendly(error ?? { message: "" }, "Your listing couldn't be saved. Please try again.") };
    }
    id = data.id;
  }

  // The exact address lives apart, readable by you only.
  // (Update, then insert if there was none: students may only change the
  // address column, so an upsert would be refused.)
  let detailsError = null;
  if (address.value) {
    const updated = await supabase
      .from("listing_private_details")
      .update({ address: address.value })
      .eq("listing_id", id)
      .select("listing_id");
    detailsError =
      updated.error ??
      (updated.data?.length === 0
        ? (await supabase.from("listing_private_details").insert({ listing_id: id, address: address.value })).error
        : null);
  } else {
    detailsError = (await supabase.from("listing_private_details").delete().eq("listing_id", id)).error;
  }
  if (detailsError) {
    return { ok: false, error: "The listing was saved, but the address couldn't be. Please try again." };
  }

  await removeUnusedMedia(user.id);
  refresh();
  return { ok: true, id };
}

export type StatusResult =
  | { ok: true; status: "active" | "inactive" }
  | { ok: false; error: string }
  | { ok: false; conflict: { id: string; title: string } };

/**
 * Publish, reactivate or deactivate. If another listing is live, nothing
 * changes and the student is asked which one to keep; only when they name
 * it (`replaceId`) is that one deactivated.
 */
export async function setListingStatus(
  listingId: string,
  status: "active" | "inactive",
  replaceId?: string,
): Promise<StatusResult> {
  const session = await getActionUser();
  if (!session.ok) {
    return { ok: false, error: session.error };
  }
  if (!isUuid(listingId) || (replaceId !== undefined && !isUuid(replaceId)) || !["active", "inactive"].includes(status)) {
    return { ok: false, error: "That listing isn't yours." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_listing_status", {
    p_listing: listingId,
    p_status: status,
    p_replace: replaceId ?? null,
  });
  if (error) {
    return { ok: false, error: friendly(error, "That didn't work. Please try again.") };
  }
  if (data === "conflict") {
    const { data: live } = await supabase
      .from("listings")
      .select("id, society, bhk_type")
      .eq("owner_id", session.user.id)
      .eq("is_active", true)
      .maybeSingle();
    if (!live) {
      return { ok: false, error: "That didn't work. Please try again." };
    }
    return { ok: false, conflict: { id: live.id, title: `${live.society} ${live.bhk_type}` } };
  }
  refresh();
  return { ok: true, status: data };
}

/**
 * Delete one of your listings for good. Likes it received and any matches
 * stay; they just no longer point at a listing. Its photos are removed
 * unless something else of yours still uses them.
 */
export async function deleteListing(listingId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getActionUser();
  if (!session.ok) {
    return { ok: false, error: session.error };
  }
  if (!isUuid(listingId)) {
    return { ok: false, error: "That listing isn't yours." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("listings")
    .delete()
    .eq("id", listingId)
    .eq("owner_id", session.user.id)
    .select("id");
  if (error || !data?.length) {
    return { ok: false, error: "That listing couldn't be deleted. Please try again." };
  }
  await removeUnusedMedia(session.user.id);
  refresh();
  return { ok: true };
}
