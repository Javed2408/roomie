/**
 * Shapes used by the matches screen and chat, built from the database rows
 * in `src/types/database.ts`.
 */

import type { MessageRow } from "@/types/database";
import type { Candidate } from "@/types/feed";

/** What a like was for, in words, e.g. "your answer to “…”". */
export type LikedThing = {
  /** Reads after "liked": "your photo", "Asha's flat", ... */
  phrase: string;
  /** The prompt's answer or the flat's details, when there are any. */
  detail?: string;
  imageUrl?: string;
};

/** Someone who liked you and is waiting for your answer. */
export type IncomingLike = Candidate & {
  /** The like's id. */
  id: string;
  liked: LikedThing;
  comment: string | null;
  createdAt: string;
};

/** One row in the matches list. */
export type Conversation = Candidate & {
  matchId: string;
  lastMessage: MessageRow | null;
  initialComment: string | null;
  /** The latest message's time, or when you matched. */
  activityAt: string;
};

/** How a conversation started, pinned to the top of the chat, Hinge-style. */
export type ChatOpener = {
  /** "You" or the other person's first name. */
  liker: string;
  liked: LikedThing;
  comment: string | null;
  /** "You" or the other person's first name. */
  commenter: string;
};

/** A message in the chat, including ones still on their way. */
export type ChatMessage = MessageRow & {
  status: "sent" | "sending" | "failed";
};
