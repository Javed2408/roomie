import { cache } from "react";

import { CHAT_STARTERS } from "@/lib/constants/prompts";
import { describeLikedThing } from "@/lib/likes";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/uuid";
import {
  PUBLIC_PROFILE_COLUMNS,
  type ListingRow,
  type MessageRow,
  type PublicProfile,
  type SwipeRow,
} from "@/types/database";
import { firstName, type Candidate } from "@/types/feed";
import type { ChatOpener, Conversation, IncomingLike } from "@/types/matches";

/** The signed-in, onboarded person, as the loaders below need them. */
export type Me = {
  id: string;
  profile: PublicProfile;
  listing: ListingRow | null;
};

/** How many recent messages a chat opens with. */
const MESSAGE_HISTORY = 200;

/**
 * Likes sent to this person that they haven't answered yet: not liked back
 * (that would be a match) and not passed. Newest first.
 *
 * Cached per request, so the matches page and the tab bar's dot share it.
 */
export const getPendingLikes = cache(async function getPendingLikes(
  userId: string,
): Promise<SwipeRow[]> {
  const supabase = await createClient();
  const [{ data: received }, { data: answered }] = await Promise.all([
    supabase
      .from("swipes")
      .select("*")
      .eq("receiver_id", userId)
      .eq("action", "like")
      .order("created_at", { ascending: false }),
    supabase.from("swipes").select("receiver_id").eq("sender_id", userId),
  ]);
  const decided = new Set((answered ?? []).map((row) => row.receiver_id));
  return (received ?? []).filter((like) => !decided.has(like.sender_id));
});

/** People's profiles with their flat (only flat owners' live flats show). */
async function loadPeople(ids: string[]): Promise<Map<string, Candidate>> {
  if (ids.length === 0) {
    return new Map();
  }
  const supabase = await createClient();
  const [{ data: profiles }, { data: listings }] = await Promise.all([
    supabase.from("profiles").select(PUBLIC_PROFILE_COLUMNS).in("id", ids),
    // Other people's flats are only readable while live.
    supabase.from("listings").select("*").in("owner_id", ids),
  ]);
  const flats = new Map((listings ?? []).map((listing) => [listing.owner_id, listing]));
  const people = new Map<string, Candidate>();
  for (const profile of profiles ?? []) {
    if (profile.full_name) {
      people.set(profile.id, {
        profile,
        listing: profile.mode === "have_flat" ? (flats.get(profile.id) ?? null) : null,
      });
    }
  }
  return people;
}

/** "Likes You": each waiting like with who sent it and what they liked. */
export async function loadLikesYou(me: Me): Promise<IncomingLike[]> {
  const likes = await getPendingLikes(me.id);
  const people = await loadPeople([...new Set(likes.map((like) => like.sender_id))]);
  return likes.flatMap((like) => {
    const person = people.get(like.sender_id);
    if (!person) {
      return [];
    }
    return [
      {
        ...person,
        id: like.id,
        liked: describeLikedThing(like, me, "your"),
        comment: like.comment,
        createdAt: like.created_at,
      },
    ];
  });
}

/** Every match, the most recently active first. */
export async function loadConversations(userId: string): Promise<Conversation[]> {
  const supabase = await createClient();
  const { data: matches } = await supabase
    .from("matches")
    .select("*")
    .or(`user_a.eq.${userId},user_b.eq.${userId}`);
  if (!matches || matches.length === 0) {
    return [];
  }

  const otherId = (match: { user_a: string; user_b: string }) =>
    match.user_a === userId ? match.user_b : match.user_a;
  const [people, { data: latest }] = await Promise.all([
    loadPeople(matches.map(otherId)),
    supabase
      .from("latest_messages")
      .select("*")
      .in(
        "match_id",
        matches.map((match) => match.id),
      ),
  ]);
  const lastByMatch = new Map((latest ?? []).map((message) => [message.match_id, message]));

  return matches
    .flatMap((match) => {
      const person = people.get(otherId(match));
      if (!person) {
        return [];
      }
      const lastMessage = lastByMatch.get(match.id) ?? null;
      return [
        {
          ...person,
          matchId: match.id,
          lastMessage,
          initialComment: match.initial_comment,
          activityAt: lastMessage?.created_at ?? match.created_at,
        },
      ];
    })
    .sort((a, b) => Date.parse(b.activityAt) - Date.parse(a.activityAt));
}

export type ChatData = {
  matchId: string;
  matchedAt: string;
  them: Candidate;
  opener: ChatOpener | null;
  /** Oldest first. */
  messages: MessageRow[];
  starters: readonly string[];
};

/**
 * Everything the chat screen needs, or null if this isn't one of your
 * matches (or the link is broken).
 */
export async function loadChat(matchId: string, me: Me): Promise<ChatData | null> {
  if (!isUuid(matchId)) {
    return null;
  }
  const supabase = await createClient();

  // Row-level security only returns matches you're in; checking again here
  // keeps that rule visible in the code.
  const { data: match } = await supabase
    .from("matches")
    .select("*")
    .eq("id", matchId)
    .maybeSingle();
  if (!match || (match.user_a !== me.id && match.user_b !== me.id)) {
    return null;
  }
  const theirId = match.user_a === me.id ? match.user_b : match.user_a;

  const [people, { data: likes }, { data: recent }] = await Promise.all([
    loadPeople([theirId]),
    supabase
      .from("swipes")
      .select("*")
      .eq("action", "like")
      .or(
        `and(sender_id.eq.${me.id},receiver_id.eq.${theirId}),and(sender_id.eq.${theirId},receiver_id.eq.${me.id})`,
      )
      .order("created_at", { ascending: true }),
    supabase
      .from("messages")
      .select("*")
      .eq("match_id", matchId)
      .order("created_at", { ascending: false })
      .limit(MESSAGE_HISTORY),
  ]);
  const them = people.get(theirId);
  if (!them) {
    return null;
  }
  const name = firstName(them.profile);

  // The like that started it all: the one whose comment is pinned, or
  // else the first like.
  const openingLike =
    likes?.find((like) => like.comment && like.comment === match.initial_comment) ??
    likes?.[0];
  let opener: ChatOpener | null = null;
  if (openingLike) {
    const iLiked = openingLike.sender_id === me.id;
    opener = {
      liker: iLiked ? "You" : name,
      liked: describeLikedThing(openingLike, iLiked ? them : me, iLiked ? `${name}'s` : "your"),
      comment: openingLike.comment,
      commenter: iLiked ? "You" : name,
    };
  }

  const iHaveFlat = me.profile.mode === "have_flat";
  const theyHaveFlat = them.profile.mode === "have_flat";
  const starters =
    theyHaveFlat && !iHaveFlat
      ? CHAT_STARTERS.theyHaveFlat
      : iHaveFlat && !theyHaveFlat
        ? CHAT_STARTERS.iHaveFlat
        : CHAT_STARTERS.bothHunting;

  return {
    matchId,
    matchedAt: match.created_at,
    them,
    opener,
    messages: (recent ?? []).reverse(),
    starters,
  };
}
