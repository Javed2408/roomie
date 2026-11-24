/**
 * How groups and their events are described in words, the same everywhere.
 * Plain module, so it can be tested directly.
 */

import type { GroupEventKind } from "../types/database.ts";

export const GROUP_STATUS_LABELS: Record<string, { label: string; hint: string }> = {
  forming: { label: "Looking for members", hint: "Open to new members." },
  searching: { label: "Looking for a flat", hint: "The group is complete and flat-hunting." },
  housed: { label: "Found a place", hint: "Not looking any more." },
  archived: { label: "Closed", hint: "This group has closed." },
};

/** Your relationship to a group, in a few words. */
export function membershipLabel(status: string | null, role?: string | null): string | null {
  switch (status) {
    case "active":
      return role === "admin" ? "You're an admin" : role === "member" ? "You're a member" : "You're in this group";
    case "invited":
      return "You're invited";
    case "requested":
      return "Request sent";
    default:
      return null;
  }
}

/** "2 of 4 members · 2 spots left" */
export function capacityLabel(members: number, max: number): string {
  const left = Math.max(0, max - members);
  return `${members} of ${max} members · ${left === 0 ? "full" : `${left} ${left === 1 ? "spot" : "spots"} left`}`;
}

/**
 * A notification in words, from the recipient's point of view. Names are
 * first names; `actor` did it, `subject` is whose membership changed.
 */
export function notificationText(event: {
  kind: GroupEventKind;
  groupName: string;
  actor: string | null;
  subject: string | null;
  detail: string | null;
}): string {
  const group = `“${event.groupName}”`;
  const actor = event.actor ?? "Someone";
  const subject = event.subject ?? "A student";
  switch (event.kind) {
    case "invited":
      return `${actor} invited you to join ${group}`;
    case "invite_accepted":
      return `${subject} accepted the invitation to ${group}`;
    case "invite_declined":
      return `${subject} declined the invitation to ${group}`;
    case "invite_cancelled":
      return `Your invitation to ${group} was withdrawn`;
    case "requested":
      return `${subject} asked to join ${group}`;
    case "request_approved":
      return `You're in! Your request to join ${group} was accepted`;
    case "request_declined":
      return `Your request to join ${group} wasn't accepted`;
    case "request_withdrawn":
      return `${subject} withdrew their request to join ${group}`;
    case "member_left":
      return `${subject} left ${group}`;
    case "member_removed":
      return `You were removed from ${group}`;
    case "role_changed":
      return event.detail === "admin" ? `You're now an admin of ${group}` : `You're no longer an admin of ${group}`;
    case "created":
      return `${group} was created`;
  }
}
