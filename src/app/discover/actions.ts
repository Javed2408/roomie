"use server";

import { refresh } from "next/cache";

import { DISCOVER_HOUSING_OPTIONS, SEEKING_OPTIONS } from "@/lib/constants/preferences";
import { LIKE_COMMENT_MAX } from "@/lib/constants/prompts";
import { loadFeedPage, type FeedPage } from "@/lib/feed";
import { parseFilters } from "@/lib/feed-filters";
import { getActionUser } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import type { DiscoverHousing, LikedTargetType, Seeking, SwipeAction } from "@/types/database";

/**
 * The next page of the feed. `query` is the page's filter query string;
 * `shown` the people already loaded, so nobody appears twice.
 */
export async function loadMoreCandidates(
  query: string,
  shown: string[],
): Promise<{ ok: true; page: FeedPage } | { ok: false; error: string }> {
  const session = await getActionUser();
  if (!session.ok) {
    return { ok: false, error: session.error };
  }
  if (typeof query !== "string" || query.length > 2000 || !Array.isArray(shown) || shown.length > 1000) {
    return { ok: false, error: "Couldn't load more people." };
  }
  const params: Record<string, string[]> = {};
  for (const [key, value] of new URLSearchParams(query)) {
    params[key] = [...(params[key] ?? []), value];
  }
  try {
    const page = await loadFeedPage(
      session.user.id,
      parseFilters(params),
      shown.filter((id) => typeof id === "string" && UUID.test(id)),
    );
    return { ok: true, page };
  } catch {
    return { ok: false, error: "Couldn't load more people. Please try again." };
  }
}

/**
 * Save whom to discover and how they'd like to live, from Discover itself.
 * Only these two settings change; the feed then reloads with them.
 */
export async function saveDiscoverySettings(input: {
  discoverHousing: DiscoverHousing;
  seeking: Seeking;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getActionUser();
  if (!session.ok) {
    return { ok: false, error: session.error };
  }
  const discover = DISCOVER_HOUSING_OPTIONS.find((option) => option.value === input?.discoverHousing)?.value;
  const seeking = SEEKING_OPTIONS.find((option) => option.value === input?.seeking)?.value;
  if (!discover || !seeking) {
    return { ok: false, error: "Choose who to discover and how you'd like to live." };
  }
  const supabase = await createClient();
  // Update in place (students may only change these two columns); create
  // the row only if this student somehow has none yet.
  const updated = await supabase
    .from("discovery_preferences")
    .update({ discover_housing: discover, seeking })
    .eq("profile_id", session.user.id)
    .select("profile_id");
  const error =
    updated.error ??
    (updated.data?.length === 0
      ? (
          await supabase
            .from("discovery_preferences")
            .insert({ profile_id: session.user.id, discover_housing: discover, seeking })
        ).error
      : null);
  if (error) {
    return { ok: false, error: "That didn't save. Please try again." };
  }
  refresh();
  return { ok: true };
}

export type SwipeInput = {
  receiverId: string;
  action: SwipeAction;
  targetType?: LikedTargetType;
  targetRef?: string;
  /** The listing a like is about (a flat, or one of its photos). */
  listingId?: string;
  comment?: string;
};

export type SwipeResult =
  | { ok: false; error: string }
  | { ok: true; match: null }
  | {
      ok: true;
      match: {
        id: string;
        name: string;
        photoUrl: string | null;
        myPhotoUrl: string | null;
        comment: string | null;
      };
    };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TARGET_TYPES: LikedTargetType[] = ["photo", "prompt", "listing"];

/**
 * Record a like or a pass. Decisions are final (the database refuses a
 * second one for the same person).
 *
 * Matches are created by the database itself: a trigger on `swipes` turns
 * two likes that meet into exactly one match row, even if both people tap
 * at the same moment. This action then just looks for that row.
 */
export async function sendSwipe(input: SwipeInput): Promise<SwipeResult> {
  // Signed in and a confirmed SRM student (the database checks this too).
  const session = await getActionUser();
  if (!session.ok) {
    return { ok: false, error: session.error };
  }
  const { user } = session;
  const supabase = await createClient();
  if (!UUID.test(input.receiverId) || input.receiverId === user.id) {
    return { ok: false, error: "That profile isn't available." };
  }
  if (input.action !== "like" && input.action !== "pass") {
    return { ok: false, error: "Unknown action." };
  }

  const isLike = input.action === "like";
  const comment = isLike ? input.comment?.trim().slice(0, LIKE_COMMENT_MAX) || null : null;
  const targetType =
    isLike && input.targetType && TARGET_TYPES.includes(input.targetType)
      ? input.targetType
      : null;
  const targetRef = targetType ? (input.targetRef ?? "").slice(0, 200) || null : null;
  // The database checks that the listing is live and belongs to them (014).
  const listingId =
    targetType && input.listingId && UUID.test(input.listingId) ? input.listingId : null;

  const { error } = await supabase.from("swipes").insert({
    sender_id: user.id,
    receiver_id: input.receiverId,
    action: input.action,
    liked_target_type: targetType,
    liked_target_ref: targetRef,
    liked_listing_id: listingId,
    comment,
  });
  // 23505: already decided on this person (e.g. a double tap). Not an error
  // for the person using the app: they simply move on.
  if (error && error.code !== "23505") {
    return {
      ok: false,
      error: /isn't available/.test(error.message)
        ? "That flat isn't available any more."
        : "That didn't go through. Please try again.",
    };
  }
  if (!isLike) {
    return { ok: true, match: null };
  }

  const [userA, userB] = [user.id, input.receiverId].sort();
  const { data: match } = await supabase
    .from("matches")
    .select("id, initial_comment")
    .eq("user_a", userA)
    .eq("user_b", userB)
    .maybeSingle();
  if (!match) {
    return { ok: true, match: null };
  }

  const { data: people } = await supabase
    .from("profiles")
    .select("id, full_name, avatar_url")
    .in("id", [user.id, input.receiverId]);
  const them = people?.find((person) => person.id === input.receiverId);
  const me = people?.find((person) => person.id === user.id);
  return {
    ok: true,
    match: {
      id: match.id,
      name: them?.full_name?.split(" ")[0] ?? "your new match",
      photoUrl: them?.avatar_url ?? null,
      myPhotoUrl: me?.avatar_url ?? null,
      comment: match.initial_comment,
    },
  };
}
