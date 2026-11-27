import { cache } from "react";

import { groupInsights, type GroupInsights, type GroupPerson } from "@/lib/group-compatibility";
import { noteKey, notesInBatches } from "@/lib/group-notes";
import type { GroupFilterState } from "@/lib/group-filters";
import { getInterestCatalogue } from "@/lib/student";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/uuid";
import {
  PUBLIC_PROFILE_COLUMNS,
  type GroupEventKind,
  type GroupMemberRow,
  type GroupMembershipStatus,
  type GroupRow,
  type LifestylePreferencesRow,
  type PublicProfile,
} from "@/types/database";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Lifestyle = Partial<Omit<LifestylePreferencesRow, "profile_id" | "created_at" | "updated_at">>;

/** Groups shown per Discover load. */
export const GROUPS_PAGE = 24;

function must<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) {
    throw new Error(`Couldn't load ${what}: ${result.error.message}`);
  }
  return result.data;
}

/**
 * The membership columns students can read. The invitation / join-request
 * note (message) is private: only loadNotes() reads it (017).
 */
const MEMBERSHIP_COLUMNS = "profile_id, role, status, invited_by, joined_at, updated_at";

/**
 * Pending notes the signed-in student may read in these groups (the
 * database decides: every pending note in a group they run, and the one on
 * their own pending row). Keyed by noteKey(), fetched in batches of 200.
 */
function loadNotes(supabase: Supabase, groupIds: string[]): Promise<Map<string, string>> {
  return notesInBatches((p_groups) => supabase.rpc("group_membership_notes", { p_groups }), groupIds);
}

/** A student as groups show them: public profile, lifestyle and interests. */
export type GroupPersonView = {
  profile: PublicProfile;
  lifestyle: Lifestyle | null;
  interests: string[];
};

const LIFESTYLE_COLUMNS =
  "profile_id, sleep_schedule, cleanliness, social_life, study_habits, guests, noise_tolerance, smoking, food_habits, personality, cleaning_rota, guest_notice";

/** Public details for several students in three queries (no N+1). */
async function loadPeople(supabase: Supabase, ids: string[]): Promise<Map<string, GroupPersonView>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) {
    return new Map();
  }
  const [profiles, lifestyles, interests] = await Promise.all([
    supabase.from("profiles").select(PUBLIC_PROFILE_COLUMNS).in("id", unique),
    supabase.from("lifestyle_preferences").select(LIFESTYLE_COLUMNS).in("profile_id", unique),
    supabase.from("profile_interests").select("profile_id, interest").in("profile_id", unique),
  ]);
  const lifestyleById = new Map((must(lifestyles, "lifestyles") ?? []).map(({ profile_id, ...rest }) => [profile_id, rest]));
  const interestsById = new Map<string, string[]>();
  for (const row of must(interests, "interests") ?? []) {
    interestsById.set(row.profile_id, [...(interestsById.get(row.profile_id) ?? []), row.interest]);
  }
  return new Map(
    (must(profiles, "profiles") ?? [])
      .filter((profile) => profile.full_name)
      .map((profile) => [
        profile.id,
        { profile, lifestyle: lifestyleById.get(profile.id) ?? null, interests: interestsById.get(profile.id) ?? [] },
      ]),
  );
}

/** What group insights need about a person. */
export function asGroupPerson(person: GroupPersonView): GroupPerson {
  return {
    lifestyle: person.lifestyle,
    interests: person.interests,
    max_budget: person.profile.max_budget,
    preferred_societies: person.profile.preferred_societies,
    move_in_timeframe: person.profile.move_in_timeframe,
  };
}

/** The signed-in student as a group sees them. Cached per request. */
export const loadMe = cache(async function loadMe(userId: string): Promise<GroupPersonView | null> {
  const supabase = await createClient();
  return (await loadPeople(supabase, [userId])).get(userId) ?? null;
});

async function interestLabels(): Promise<Record<string, string>> {
  return Object.fromEntries((await getInterestCatalogue()).map((interest) => [interest.slug, interest.label]));
}

// --- Discover ---------------------------------------------------------------

/** Lifestyle filters only hide groups whose members clearly lean the other way. */
export type GroupFilters = GroupFilterState;

export type GroupCardData = {
  group: GroupRow;
  memberCount: number;
  myStatus: GroupMembershipStatus | null;
  /** Up to four, admins first. */
  members: PublicProfile[];
  insights: GroupInsights;
};

/** Discoverable groups for the signed-in student, with fit insights. */
export async function loadGroupDirectory(
  userId: string,
  filters: GroupFilters,
): Promise<{ groups: GroupCardData[]; total: number }> {
  const supabase = await createClient();
  const found = must(
    await supabase.rpc("discover_groups", {
      p_filters: {
        societies: filters.societies,
        budget_min: filters.budgetMin,
        budget_max: filters.budgetMax,
        move_in: filters.moveIn,
        sizes: filters.sizes,
        housing: filters.housing,
        has_room: filters.hasRoom,
      },
      p_limit: 200,
    }),
    "groups",
  ) ?? [];
  const page = found.slice(0, GROUPS_PAGE);
  if (page.length === 0) {
    return { groups: [], total: 0 };
  }
  const ids = page.map((row) => row.group_id);
  const [groups, memberships, me, labels] = await Promise.all([
    supabase.from("groups").select("*").in("id", ids),
    supabase.from("group_members").select("group_id, profile_id, role, joined_at").in("group_id", ids).eq("status", "active"),
    loadMe(userId),
    interestLabels(),
  ]);
  const rows = must(memberships, "members") ?? [];
  const people = await loadPeople(supabase, rows.map((row) => row.profile_id));
  const groupById = new Map((must(groups, "groups") ?? []).map((group) => [group.id, group]));

  const cards: GroupCardData[] = [];
  for (const entry of page) {
    const group = groupById.get(entry.group_id);
    if (!group) continue;
    const memberRows = rows
      .filter((row) => row.group_id === group.id)
      .sort((a, b) => (a.role === b.role ? (a.joined_at ?? "").localeCompare(b.joined_at ?? "") : a.role === "admin" ? -1 : 1));
    const members = memberRows.flatMap((row) => {
      const person = people.get(row.profile_id);
      return person ? [person] : [];
    });
    const insights = groupInsights(
      group,
      members.map(asGroupPerson),
      entry.my_status === "active" || !me ? undefined : asGroupPerson(me),
      { interestLabels: labels },
    );
    // Lifestyle filters: hide only a group whose members clearly lean the other way.
    const leans = (phrase: string) => insights.agreements.some((text) => text.includes(phrase));
    if (filters.quiet && (leans("lively home") || leans("some noise"))) continue;
    if (filters.smokeFree && (leans("smoke outside") || leans("Most members smoke"))) continue;
    cards.push({
      group,
      memberCount: entry.member_count,
      myStatus: entry.my_status,
      members: members.slice(0, 4).map((person) => person.profile),
      insights,
    });
  }
  return { groups: cards, total: found.length };
}

// --- One group --------------------------------------------------------------

export type PendingPerson = GroupPersonView & {
  message: string | null;
  since: string;
  insights?: GroupInsights;
};

export type GroupView = {
  group: GroupRow;
  /** Active members, admins first. */
  members: Array<GroupPersonView & { role: "admin" | "member"; joinedAt: string | null }>;
  /** Your own membership row, if any. */
  mine: Pick<GroupMemberRow, "status" | "role" | "message" | "invited_by"> | null;
  isAdmin: boolean;
  /** Admins only: join requests (with fit insights) and open invitations. */
  requests: PendingPerson[];
  invites: PendingPerson[];
  /** Group-level insights, plus how you'd fit if you're not a member. */
  insights: GroupInsights;
  invitedBy: PublicProfile | null;
};

export async function loadGroupView(userId: string, groupId: string): Promise<GroupView | null> {
  if (!isUuid(groupId)) {
    return null;
  }
  const supabase = await createClient();
  const [groupResult, rowsResult, labels] = await Promise.all([
    supabase.from("groups").select("*").eq("id", groupId).maybeSingle(),
    // What the database lets you see: everything in your groups, your own
    // row, and the active roster of discoverable groups (never the notes).
    supabase
      .from("group_members")
      .select(MEMBERSHIP_COLUMNS)
      .eq("group_id", groupId)
      .in("status", ["active", "requested", "invited"]),
    interestLabels(),
  ]);
  const group = must(groupResult, "the group");
  if (!group) {
    return null;
  }
  const rows = must(rowsResult, "members") ?? [];
  const ownRow = rows.find((row) => row.profile_id === userId)
    ?? must(
      await supabase
        .from("group_members")
        .select(MEMBERSHIP_COLUMNS)
        .eq("group_id", groupId)
        .eq("profile_id", userId)
        .maybeSingle(),
      "your membership",
    );
  const isAdmin = ownRow?.status === "active" && ownRow.role === "admin";
  const ownPending = ownRow?.status === "invited" || ownRow?.status === "requested";
  const [people, notes] = await Promise.all([
    loadPeople(
      supabase,
      [...rows.map((row) => row.profile_id), userId, ...(ownRow?.invited_by ? [ownRow.invited_by] : [])],
    ),
    // Only admins and the student a pending note belongs to can read it.
    isAdmin || ownPending ? loadNotes(supabase, [groupId]) : Promise.resolve(new Map<string, string>()),
  ]);
  const noteFor = (profileId: string) => notes.get(noteKey(groupId, profileId)) ?? null;

  const members = rows
    .filter((row) => row.status === "active")
    .flatMap((row) => {
      const person = people.get(row.profile_id);
      return person ? [{ ...person, role: row.role, joinedAt: row.joined_at }] : [];
    })
    .sort((a, b) => (a.role === b.role ? (a.joinedAt ?? "").localeCompare(b.joinedAt ?? "") : a.role === "admin" ? -1 : 1));
  const memberPeople = members.map(asGroupPerson);
  const pending = (status: "requested" | "invited", withInsights: boolean): PendingPerson[] =>
    isAdmin
      ? rows
          .filter((row) => row.status === status)
          .flatMap((row) => {
            const person = people.get(row.profile_id);
            if (!person) return [];
            return [
              {
                ...person,
                message: noteFor(row.profile_id),
                since: row.updated_at,
                insights: withInsights
                  ? groupInsights(group, memberPeople, asGroupPerson(person), {
                      who: person.profile.full_name?.split(" ")[0] ?? "They",
                      interestLabels: labels,
                    })
                  : undefined,
              },
            ];
          })
      : [];
  const me = people.get(userId);
  const isMember = ownRow?.status === "active";

  return {
    group,
    members,
    mine: ownRow ? { status: ownRow.status, role: ownRow.role, message: noteFor(userId), invited_by: ownRow.invited_by } : null,
    isAdmin,
    requests: pending("requested", true),
    invites: pending("invited", false),
    insights: groupInsights(group, memberPeople, !isMember && me ? asGroupPerson(me) : undefined, { interestLabels: labels }),
    invitedBy: ownRow?.invited_by ? (people.get(ownRow.invited_by)?.profile ?? null) : null,
  };
}

// --- Your groups --------------------------------------------------------------

export type MyGroupEntry = {
  group: GroupRow;
  status: GroupMembershipStatus;
  role: "admin" | "member";
  message: string | null;
  updatedAt: string;
  memberCount: number;
};

export type GroupDashboard = {
  /** Groups you're an active member of (admin or not). */
  memberOf: MyGroupEntry[];
  /** Invitations waiting for your answer. */
  invitations: MyGroupEntry[];
  /** Your join requests still waiting. */
  requests: MyGroupEntry[];
  /** Recent answers to your requests (from the activity log). */
  outcomes: Array<{ groupId: string; groupName: string; kind: GroupEventKind; at: string }>;
  /** In groups you run: requests to answer and invitations you've sent. */
  approvals: Array<{ group: GroupRow; person: PublicProfile; message: string | null; since: string }>;
  sentInvites: Array<{ group: GroupRow; person: PublicProfile; since: string }>;
};

export async function loadGroupDashboard(userId: string): Promise<GroupDashboard> {
  const supabase = await createClient();
  const [mineResult, outcomesResult] = await Promise.all([
    supabase
      .from("group_members")
      .select("group_id, status, role, updated_at")
      .eq("profile_id", userId)
      .in("status", ["active", "invited", "requested"]),
    supabase
      .from("group_events")
      .select("group_id, group_name, kind, created_at")
      .eq("subject_id", userId)
      .in("kind", ["request_approved", "request_declined", "invite_cancelled", "member_removed"])
      .order("created_at", { ascending: false })
      .limit(10),
  ]);
  const mine = must(mineResult, "your groups") ?? [];
  const groupIds = mine.map((row) => row.group_id);
  const adminOf = mine.filter((row) => row.status === "active" && row.role === "admin").map((row) => row.group_id);
  // Notes: on your own pending rows, and on pending rows in groups you run.
  const noteGroups = mine
    .filter((row) => row.status !== "active" || adminOf.includes(row.group_id))
    .map((row) => row.group_id);
  const [groupsResult, activeResult, pendingResult, notes] = await Promise.all([
    groupIds.length ? supabase.from("groups").select("*").in("id", groupIds) : Promise.resolve({ data: [], error: null }),
    groupIds.length
      ? supabase.from("group_members").select("group_id").in("group_id", groupIds).eq("status", "active")
      : Promise.resolve({ data: [], error: null }),
    adminOf.length
      ? supabase
          .from("group_members")
          .select("group_id, profile_id, status, updated_at")
          .in("group_id", adminOf)
          .in("status", ["requested", "invited"])
      : Promise.resolve({ data: [], error: null }),
    loadNotes(supabase, noteGroups),
  ]);
  const noteFor = (groupId: string, profileId: string) => notes.get(noteKey(groupId, profileId)) ?? null;
  const groupById = new Map((must(groupsResult, "groups") ?? []).map((group) => [group.id, group]));
  const counts = new Map<string, number>();
  for (const row of must(activeResult, "members") ?? []) {
    counts.set(row.group_id, (counts.get(row.group_id) ?? 0) + 1);
  }
  const pending = must(pendingResult, "requests") ?? [];
  const people = await loadPeople(supabase, pending.map((row) => row.profile_id));

  const entries = mine.flatMap((row): MyGroupEntry[] => {
    const group = groupById.get(row.group_id);
    return group
      ? [{ group, status: row.status, role: row.role, message: noteFor(row.group_id, userId), updatedAt: row.updated_at, memberCount: counts.get(row.group_id) ?? 0 }]
      : [];
  });
  const byRecent = (a: { updatedAt: string }, b: { updatedAt: string }) => b.updatedAt.localeCompare(a.updatedAt);
  const withPerson = <T extends { group_id: string; profile_id: string }>(row: T) => {
    const group = groupById.get(row.group_id);
    const person = people.get(row.profile_id)?.profile;
    return group && person ? [{ group, person, row }] : [];
  };

  return {
    memberOf: entries.filter((entry) => entry.status === "active").sort(byRecent),
    invitations: entries.filter((entry) => entry.status === "invited").sort(byRecent),
    requests: entries.filter((entry) => entry.status === "requested").sort(byRecent),
    outcomes: (must(outcomesResult, "updates") ?? []).map((event) => ({
      groupId: event.group_id,
      groupName: event.group_name,
      kind: event.kind,
      at: event.created_at,
    })),
    approvals: pending
      .filter((row) => row.status === "requested")
      .flatMap(withPerson)
      .map(({ group, person, row }) => ({ group, person, message: noteFor(row.group_id, row.profile_id), since: row.updated_at })),
    sentInvites: pending
      .filter((row) => row.status === "invited")
      .flatMap(withPerson)
      .map(({ group, person, row }) => ({ group, person, since: row.updated_at })),
  };
}

// --- Notifications ------------------------------------------------------------

export type NotificationView = {
  id: string;
  read: boolean;
  at: string;
  kind: GroupEventKind;
  groupId: string;
  groupName: string;
  detail: string | null;
  actor: PublicProfile | null;
  subject: PublicProfile | null;
};

/** Your newest notifications (up to 50), with who did what. */
export async function loadNotifications(userId: string): Promise<NotificationView[]> {
  const supabase = await createClient();
  const rows = must(
    await supabase
      .from("notifications")
      .select("id, read_at, created_at, event_id")
      .eq("recipient_id", userId)
      .order("created_at", { ascending: false })
      .limit(50),
    "notifications",
  ) ?? [];
  if (rows.length === 0) {
    return [];
  }
  const events = must(
    await supabase.from("group_events").select("*").in("id", rows.map((row) => row.event_id)),
    "notifications",
  ) ?? [];
  const eventById = new Map(events.map((event) => [event.id, event]));
  const people = await loadPeople(
    supabase,
    events.flatMap((event) => [event.actor_id, event.subject_id]).filter((id): id is string => Boolean(id)),
  );
  return rows.flatMap((row) => {
    const event = eventById.get(row.event_id);
    if (!event) return [];
    return [
      {
        id: row.id,
        read: row.read_at !== null,
        at: row.created_at,
        kind: event.kind,
        groupId: event.group_id,
        groupName: event.group_name,
        detail: event.detail,
        actor: event.actor_id ? (people.get(event.actor_id)?.profile ?? null) : null,
        subject: event.subject_id ? (people.get(event.subject_id)?.profile ?? null) : null,
      },
    ];
  });
}

/** How many notifications you haven't read. Cached per request (tab bar). */
export const countUnreadNotifications = cache(async function countUnreadNotifications(userId: string): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("recipient_id", userId)
    .is("read_at", null);
  return count ?? 0;
});
