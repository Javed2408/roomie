/**
 * Links from a chat to a member's public profile (the existing
 * /students/[id] page, which enforces sign-in, SRM eligibility and RLS).
 *
 * Pure (no React or Next) so the rules are unit-tested;
 * src/components/chat/profile-link.tsx renders them.
 */
import type { GroupMessageRow } from "../types/database.ts";
import { isUuid } from "./uuid.ts";

/** A student's profile page, or null when there's no usable id. */
export function profileHref(id: string | null | undefined): string | null {
  return id && isUuid(id) ? `/students/${id}` : null;
}

/**
 * Where a group message's photo and name lead. Null for system messages
 * (their text stays plain) and when the sender's profile isn't available:
 * a deleted account (no sender) or a profile the chat couldn't load.
 */
export function groupSenderProfile(
  message: Pick<GroupMessageRow, "message_type" | "sender_id">,
  people: Readonly<Record<string, unknown>>,
): string | null {
  if (message.message_type !== "user" || !message.sender_id || !Object.hasOwn(people, message.sender_id)) {
    return null;
  }
  return profileHref(message.sender_id);
}

/**
 * Keyboard and screen-reader behaviour. The name is the link people Tab to
 * and hear; a photo beside it repeats the same link for pointer and touch,
 * so it's skipped by Tab and hidden from screen readers (no double stops).
 */
export function profileLinkAttributes(role: "name" | "photo"): { tabIndex?: -1; "aria-hidden"?: true } {
  return role === "photo" ? { tabIndex: -1, "aria-hidden": true } : {};
}

/**
 * A profile link only opens the profile: the click stops at the link, so it
 * can never also trigger something on the message around it. (It doesn't
 * prevent the navigation itself.)
 */
export function keepClickOnLink(event: { stopPropagation(): void }): void {
  event.stopPropagation();
}
