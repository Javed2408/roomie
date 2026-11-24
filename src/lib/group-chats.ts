import { cache } from "react";

import { CHAT_PAGE, chatPreview, displayName } from "@/lib/group-chat";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/uuid";
import type { GroupChatSummaryRow, GroupMessageRow, GroupRow } from "@/types/database";

/**
 * Loaders for group chat. They use the signed-in student's own session, so
 * the database's rules (active members only) decide what comes back; the
 * checks here are for good error handling, not for security.
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

function must<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) {
    throw new Error(`Couldn't load ${what}: ${result.error.message}`);
  }
  return result.data;
}

export type ChatPerson = { id: string; name: string; avatarUrl: string | null; headline: string | null };

const PERSON_COLUMNS = "id, full_name, avatar_url, department, year_of_study";

async function loadChatPeople(supabase: Supabase, ids: string[]): Promise<Map<string, ChatPerson>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) {
    return new Map();
  }
  const rows = must(await supabase.from("profiles").select(PERSON_COLUMNS).in("id", unique), "people") ?? [];
  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        name: displayName(row.full_name),
        avatarUrl: row.avatar_url,
        headline: [row.department, row.year_of_study ? `Year ${row.year_of_study}` : null].filter(Boolean).join(" · ") || null,
      },
    ]),
  );
}

export type GroupChatData = {
  group: Pick<GroupRow, "id" | "name" | "avatar_url" | "status" | "max_members">;
  /** Active members, admins first. */
  members: Array<ChatPerson & { isAdmin: boolean }>;
  /** Everyone mentioned in the loaded messages, including former members. */
  people: Record<string, ChatPerson>;
  /** The newest messages, oldest first. */
  messages: GroupMessageRow[];
  hasEarlier: boolean;
};

/**
 * A group's chat for a member: the group, its active members and the
 * newest messages. "not-found" for a missing or invisible group;
 * "not-member" when the student isn't an active member (no messages are
 * even requested then).
 */
export async function loadGroupChat(
  groupId: string,
): Promise<GroupChatData | "not-found" | "not-member"> {
  if (!isUuid(groupId)) {
    return "not-found";
  }
  const supabase = await createClient();
  const [group, member] = await Promise.all([
    supabase.from("groups").select("id, name, avatar_url, status, max_members").eq("id", groupId).maybeSingle(),
    supabase.rpc("is_group_member", { p_group: groupId }),
  ]);
  const row = must(group, "the group");
  if (!row) {
    return "not-found";
  }
  if (must(member, "your membership") !== true) {
    return "not-member";
  }

  const [messages, memberships] = await Promise.all([
    supabase
      .from("group_messages")
      .select("*")
      .eq("group_id", groupId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(CHAT_PAGE + 1),
    supabase
      .from("group_members")
      .select("profile_id, role, joined_at")
      .eq("group_id", groupId)
      .eq("status", "active"),
  ]);
  const newest = must(messages, "messages") ?? [];
  const active = must(memberships, "members") ?? [];
  const history = newest.slice(0, CHAT_PAGE).reverse();

  const people = await loadChatPeople(supabase, [
    ...active.map((entry) => entry.profile_id),
    ...history.flatMap((message) => [message.sender_id, message.subject_id, message.actor_id]).filter((id): id is string => Boolean(id)),
  ]);
  const members = active
    .sort((a, b) => (a.role === b.role ? (a.joined_at ?? "").localeCompare(b.joined_at ?? "") : a.role === "admin" ? -1 : 1))
    .flatMap((entry) => {
      const person = people.get(entry.profile_id);
      return person ? [{ ...person, isAdmin: entry.role === "admin" }] : [];
    });

  return {
    group: row,
    members,
    people: Object.fromEntries(people),
    messages: history,
    hasEarlier: newest.length > CHAT_PAGE,
  };
}

/** Unread counts and newest messages for the groups you're in. Cached per request. */
export const loadChatSummaries = cache(async function loadChatSummaries(userId: string): Promise<GroupChatSummaryRow[]> {
  void userId; // part of the cache key: one lookup per student per request
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("group_chat_summaries");
  // Chat extras never break the page around them (e.g. before 016 is applied).
  return error ? [] : (data ?? []);
});

/** Total unread group messages (for the tab bar's dot). */
export const countUnreadChat = cache(async function countUnreadChat(userId: string): Promise<number> {
  return (await loadChatSummaries(userId)).reduce((sum, row) => sum + row.unread_count, 0);
});

export type ChatListEntry = {
  group: Pick<GroupRow, "id" | "name" | "avatar_url" | "status">;
  unread: number;
  lastAt: string | null;
  preview: string;
};

/** One entry per group chat you can open, most recent activity first. */
export async function loadChatList(userId: string): Promise<ChatListEntry[]> {
  const summaries = await loadChatSummaries(userId);
  if (summaries.length === 0) {
    return [];
  }
  const supabase = await createClient();
  const groups = must(
    await supabase
      .from("groups")
      .select("id, name, avatar_url, status, updated_at")
      .in("id", summaries.map((row) => row.group_id)),
    "groups",
  ) ?? [];
  const people = await loadChatPeople(
    supabase,
    summaries.flatMap((row) => [row.last_sender_id, row.last_subject_id, row.last_actor_id]).filter((id): id is string => Boolean(id)),
  );
  const nameOf = (id: string | null) => (id ? (people.get(id)?.name ?? "A member") : "A member");
  const byId = new Map(groups.map((group) => [group.id, group]));
  const entries = summaries.flatMap((row) => {
    const group = byId.get(row.group_id);
    if (!group) return [];
    return [
      {
        group,
        unread: row.unread_count,
        lastAt: row.last_at,
        preview: chatPreview(row, nameOf, userId),
        activity: row.last_at ?? group.updated_at,
      },
    ];
  });
  entries.sort((a, b) => b.activity.localeCompare(a.activity));
  return entries.map((entry) => ({ group: entry.group, unread: entry.unread, lastAt: entry.lastAt, preview: entry.preview }));
}
