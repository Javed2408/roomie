"use server";

import { LIKE_COMMENT_MAX } from "@/lib/constants/prompts";
import { createClient } from "@/lib/supabase/server";
import type { LikedTargetType, SwipeAction } from "@/types/database";

export type SwipeInput = {
  receiverId: string;
  action: SwipeAction;
  targetType?: LikedTargetType;
  targetRef?: string;
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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Your session has ended. Please sign in again." };
  }
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

  const { error } = await supabase.from("swipes").insert({
    sender_id: user.id,
    receiver_id: input.receiverId,
    action: input.action,
    liked_target_type: targetType,
    liked_target_ref: targetRef,
    comment,
  });
  // 23505: already decided on this person (e.g. a double tap). Not an error
  // for the person using the app: they simply move on.
  if (error && error.code !== "23505") {
    return { ok: false, error: "That didn't go through. Please try again." };
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
