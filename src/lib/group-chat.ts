/**
 * The logic of a group chat screen, kept free of React so it can be tested:
 * merging live and fetched messages (each shown once, in the database's
 * order), laying them out in runs under date separators, wording system
 * messages, unread labels, and what happens when access is lost.
 *
 * Follows the same rules as the one-to-one chat (ChatRoom): a message has
 * one id from the moment it's written, so its optimistic copy, the insert's
 * reply and the live echo are all the same message.
 *
 * Plain module with relative imports, so it can be tested directly.
 */

import type { GroupChatSummaryRow, GroupMessageRow } from "../types/database.ts";
import { dayKey } from "./time.ts";

/** Messages closer together than this, from one person, form one run. */
export const RUN_GAP_MS = 5 * 60_000;
/** How many messages a chat opens with, and each "earlier" page. */
export const CHAT_PAGE = 50;

export type MessageStatus = "sent" | "sending" | "failed";

/** A message on screen, including ones still on their way. */
export type GroupChatMessage = GroupMessageRow & { status: MessageStatus };

export type ChatState = {
  messages: GroupChatMessage[];
  /** Access was lost: nothing protected stays in memory or is accepted. */
  revoked: boolean;
};

export type ChatAction =
  /** Rows from the server (history, the live feed, a catch-up, an insert's reply). */
  | { type: "receive"; rows: GroupMessageRow[] }
  /** The person pressed send: show it straight away. */
  | { type: "send"; message: GroupChatMessage }
  | { type: "failed"; id: string }
  | { type: "retry"; id: string }
  /** The group's chat is no longer theirs. */
  | { type: "revoke" };

export function initialChatState(history: GroupMessageRow[]): ChatState {
  return { messages: history.map((row) => ({ ...row, status: "sent" as const })), revoked: false };
}

const byTime = (a: GroupChatMessage, b: GroupChatMessage) =>
  Number(a.status !== "sent") - Number(b.status !== "sent") ||
  Date.parse(a.created_at) - Date.parse(b.created_at) ||
  a.id.localeCompare(b.id);

/**
 * Add rows, each once. The first confirmed copy of a message wins; copies
 * of one still on its way replace it. Confirmed messages follow the
 * database's order; unconfirmed ones stay at the end.
 */
export function mergeGroupMessages(list: GroupChatMessage[], rows: GroupMessageRow[]): GroupChatMessage[] {
  const byId = new Map(list.map((message) => [message.id, message]));
  let changed = false;
  for (const row of rows) {
    if (byId.get(row.id)?.status === "sent") {
      continue;
    }
    byId.set(row.id, { ...row, status: "sent" });
    changed = true;
  }
  return changed ? [...byId.values()].sort(byTime) : list;
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  if (action.type === "revoke") {
    return { messages: [], revoked: true };
  }
  if (state.revoked) {
    return state;
  }
  switch (action.type) {
    case "receive": {
      const messages = mergeGroupMessages(state.messages, action.rows);
      return messages === state.messages ? state : { ...state, messages };
    }
    case "send":
      return state.messages.some((message) => message.id === action.message.id)
        ? state
        : { ...state, messages: [...state.messages, action.message] };
    case "failed":
    case "retry": {
      const status: MessageStatus = action.type === "failed" ? "failed" : "sending";
      let changed = false;
      const messages = state.messages.map((message) => {
        if (message.id !== action.id || message.status === "sent" || message.status === status) {
          return message;
        }
        changed = true;
        return { ...message, status };
      });
      return changed ? { ...state, messages } : state;
    }
  }
}

/** A message for the screen before the database has seen it. */
export function optimisticMessage(args: { id: string; groupId: string; senderId: string; content: string; now?: Date }): GroupChatMessage {
  return {
    id: args.id,
    group_id: args.groupId,
    sender_id: args.senderId,
    message_type: "user",
    content: args.content,
    system_kind: null,
    subject_id: null,
    actor_id: null,
    event_id: null,
    // Only for ordering on this screen; the database sets the real time.
    created_at: (args.now ?? new Date()).toISOString(),
    status: "sending",
  };
}

/** The newest time among confirmed messages: what "read up to here" means. */
export function newestConfirmedAt(messages: readonly GroupChatMessage[]): string | null {
  let newest: string | null = null;
  for (const message of messages) {
    if (message.status === "sent" && (newest === null || Date.parse(message.created_at) > Date.parse(newest))) {
      newest = message.created_at;
    }
  }
  return newest;
}

// --- Layout --------------------------------------------------------------------

export type LayoutItem = {
  message: GroupChatMessage;
  /** First message of a calendar day: show a date separator. */
  startsDay: boolean;
  /** First of a run from one sender: show their name and avatar. */
  startsRun: boolean;
  /** Last of its run: show the time. */
  endsRun: boolean;
};

const isUser = (message: GroupChatMessage) => message.message_type === "user";

/** Work out date separators and runs. System messages always stand alone. */
export function layoutMessages(messages: readonly GroupChatMessage[]): LayoutItem[] {
  return messages.map((message, index) => {
    const previous = messages[index - 1];
    const next = messages[index + 1];
    const day = dayKey(message.created_at);
    const startsDay = !previous || dayKey(previous.created_at) !== day;
    const continues = (other: GroupChatMessage | undefined, from: GroupChatMessage, to: GroupChatMessage) =>
      Boolean(other) &&
      isUser(from) &&
      isUser(to) &&
      from.sender_id === to.sender_id &&
      dayKey(from.created_at) === dayKey(to.created_at) &&
      Math.abs(Date.parse(to.created_at) - Date.parse(from.created_at)) <= RUN_GAP_MS;
    return {
      message,
      startsDay,
      startsRun: !continues(previous, previous ?? message, message),
      endsRun: !(next && continues(next, message, next) && next.status === message.status),
    };
  });
}

// --- Words ---------------------------------------------------------------------

/** Resolve an id to a name; callers decide what an unknown id is called. */
export type NameOf = (id: string | null) => string;

/** A system message in words, e.g. "Ravi joined the group". */
export function systemMessageText(
  message: Pick<GroupMessageRow, "system_kind" | "subject_id" | "actor_id">,
  nameOf: NameOf,
): string {
  const subject = nameOf(message.subject_id);
  switch (message.system_kind) {
    case "joined":
      return `${subject} joined the group`;
    case "left":
      return `${subject} left the group`;
    case "removed":
      return message.actor_id ? `${nameOf(message.actor_id)} removed ${subject}` : `${subject} was removed from the group`;
    case "made_admin":
      return `${subject} is now an admin`;
    case "removed_admin":
      return `${subject} is no longer an admin`;
    default:
      return "";
  }
}

/** "3", "99+", or null for none. */
export function unreadLabel(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count > 99 ? "99+" : String(Math.floor(count));
}

/** The one-line preview of a group's latest message. */
export function chatPreview(summary: Pick<GroupChatSummaryRow, "last_id" | "last_type" | "last_content" | "last_sender_id" | "last_system_kind" | "last_subject_id" | "last_actor_id">, nameOf: NameOf, myId?: string): string {
  if (!summary.last_id) {
    return "No messages yet";
  }
  if (summary.last_type === "system") {
    return systemMessageText(
      { system_kind: summary.last_system_kind, subject_id: summary.last_subject_id, actor_id: summary.last_actor_id },
      nameOf,
    );
  }
  const sender = summary.last_sender_id && summary.last_sender_id === myId ? "You" : nameOf(summary.last_sender_id);
  return `${sender}: ${summary.last_content ?? ""}`;
}

// --- Losing access ---------------------------------------------------------------

/**
 * Does a failed request look like "you're not allowed" (as opposed to a
 * network problem)? Then the screen should check whether it's still a
 * member before showing a plain retry.
 */
export function looksLikeAccessLoss(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42501" || /row-level security|permission denied|not in this group/i.test(error.message ?? "");
}

/** Is a database error "this message id was already saved"? */
export function isAlreadySaved(error: { code?: string | null } | null | undefined): boolean {
  return error?.code === "23505";
}

/** Normalise a name for display in a message run. */
export function displayName(full: string | null | undefined, fallback = "A member"): string {
  return full?.trim().split(/\s+/)[0] || fallback;
}
