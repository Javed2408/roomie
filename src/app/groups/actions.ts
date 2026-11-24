"use server";

import { refresh } from "next/cache";

import { validateGroup, validateMessage, type GroupForm, type Problems } from "@/lib/group-validation";
import { isOwnMediaUrl } from "@/lib/media";
import { getActionUser } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/uuid";
import type { GroupInviteCandidate } from "@/types/database";

/**
 * Group actions. Membership only ever changes through the database's
 * group functions (migrations 010, 011, 015), which check who is asking,
 * eligibility, blocks and capacity themselves.
 */

type Done = { ok: true } | { ok: false; error: string };

/** Our own database messages are written for students; anything else isn't. */
function friendly(error: { message: string }, fallback: string): string {
  const message = error.message ?? "";
  return /^[A-Z][^]*[.!]$/.test(message) && !/violates|constraint|permission denied|function|relation|column/i.test(message)
    ? message
    : fallback;
}

const SOMETHING_WENT_WRONG = "That didn't work. Please try again.";

async function session() {
  const current = await getActionUser();
  return current;
}

// --- Creating and editing ------------------------------------------------------

export type SaveGroupResult = { ok: true; id: string } | { ok: false; error: string; problems?: Problems };

function avatarProblem(url: string | null, userId: string, previous: string | null): string | null {
  if (!url || url === previous) return null;
  return isOwnMediaUrl(url, userId) && /\/group-[A-Za-z0-9._-]+$/.test(url) ? null : "Upload the photo again.";
}

/** Create a group. You become its first admin (the database does this). */
export async function createGroup(form: GroupForm): Promise<SaveGroupResult> {
  const current = await session();
  if (!current.ok) return { ok: false, error: current.error };
  const { value, problems } = validateGroup({ ...form, status: undefined });
  const photo = avatarProblem(value.avatar_url, current.user.id, null);
  if (photo) problems.avatar_url = photo;
  if (Object.keys(problems).length > 0) {
    return { ok: false, error: "Some details need another look.", problems };
  }
  const supabase = await createClient();
  // A new group always starts as "forming" (the database default).
  const fields = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "status")) as Omit<
    typeof value,
    "status"
  >;
  const { data, error } = await supabase
    .from("groups")
    .insert({ ...fields, created_by: current.user.id })
    .select("id")
    .single();
  if (error || !data) {
    return { ok: false, error: friendly(error ?? { message: "" }, "Your group couldn't be created. Please try again.") };
  }
  refresh();
  return { ok: true, id: data.id };
}

/** Save changes to a group you run (the database checks you're an admin). */
export async function updateGroup(groupId: string, form: GroupForm): Promise<SaveGroupResult> {
  const current = await session();
  if (!current.ok) return { ok: false, error: current.error };
  if (!isUuid(groupId)) return { ok: false, error: "That group isn't available." };
  const supabase = await createClient();
  const [{ data: existing }, { count }] = await Promise.all([
    supabase.from("groups").select("avatar_url").eq("id", groupId).maybeSingle(),
    supabase.from("group_members").select("profile_id", { count: "exact", head: true }).eq("group_id", groupId).eq("status", "active"),
  ]);
  if (!existing) return { ok: false, error: "That group isn't available." };
  const { value, problems } = validateGroup(form, { memberCount: count ?? 1 });
  const photo = avatarProblem(value.avatar_url, current.user.id, existing.avatar_url);
  if (photo) problems.avatar_url = photo;
  if (Object.keys(problems).length > 0) {
    return { ok: false, error: "Some details need another look.", problems };
  }
  const { data, error } = await supabase.from("groups").update(value).eq("id", groupId).select("id");
  if (error) {
    return { ok: false, error: friendly(error, "Your changes couldn't be saved. Please try again.") };
  }
  if (!data?.length) {
    return { ok: false, error: "Only a group admin can change the group." };
  }
  refresh();
  return { ok: true, id: groupId };
}

// --- Membership (all through the database functions) ---------------------------

async function call(
  run: (supabase: Awaited<ReturnType<typeof createClient>>) => PromiseLike<{ error: { message: string } | null }>,
): Promise<Done> {
  const current = await session();
  if (!current.ok) return { ok: false, error: current.error };
  const supabase = await createClient();
  const { error } = await run(supabase);
  if (error) {
    return { ok: false, error: friendly(error, SOMETHING_WENT_WRONG) };
  }
  refresh();
  return { ok: true };
}

const badInput = (...ids: string[]): Done | null =>
  ids.every((id) => isUuid(id)) ? null : { ok: false, error: "That group isn't available." };

export async function requestToJoin(groupId: string, message: string): Promise<Done> {
  const checked = validateMessage(message);
  if (checked.problem) return { ok: false, error: checked.problem };
  return badInput(groupId) ?? call((db) => db.rpc("request_to_join_group", { p_group: groupId, p_message: checked.value }));
}

export async function respondToInvite(groupId: string, accept: boolean): Promise<Done> {
  return badInput(groupId) ?? call((db) => db.rpc("respond_to_group_invite", { p_group: groupId, p_accept: accept === true }));
}

/** Leave a group, or withdraw your join request. */
export async function leaveGroup(groupId: string): Promise<Done> {
  return badInput(groupId) ?? call((db) => db.rpc("leave_group", { p_group: groupId }));
}

export async function inviteStudent(groupId: string, profileId: string, message: string): Promise<Done> {
  const checked = validateMessage(message);
  if (checked.problem) return { ok: false, error: checked.problem };
  return (
    badInput(groupId, profileId) ??
    call((db) => db.rpc("invite_to_group", { p_group: groupId, p_profile: profileId, p_message: checked.value }))
  );
}

export async function cancelInvite(groupId: string, profileId: string): Promise<Done> {
  return badInput(groupId, profileId) ?? call((db) => db.rpc("cancel_group_invite", { p_group: groupId, p_profile: profileId }));
}

export async function reviewRequest(groupId: string, profileId: string, approve: boolean): Promise<Done> {
  return (
    badInput(groupId, profileId) ??
    call((db) => db.rpc("review_join_request", { p_group: groupId, p_profile: profileId, p_approve: approve === true }))
  );
}

export async function removeMember(groupId: string, profileId: string): Promise<Done> {
  return badInput(groupId, profileId) ?? call((db) => db.rpc("remove_group_member", { p_group: groupId, p_profile: profileId }));
}

export async function setMemberRole(groupId: string, profileId: string, role: "admin" | "member"): Promise<Done> {
  if (role !== "admin" && role !== "member") return { ok: false, error: "Unknown role." };
  return (
    badInput(groupId, profileId) ??
    call((db) => db.rpc("set_group_member_role", { p_group: groupId, p_profile: profileId, p_role: role }))
  );
}

/** Students an admin may invite, by name (the database filters them). */
export async function searchStudents(
  groupId: string,
  query: string,
): Promise<{ ok: true; results: GroupInviteCandidate[] } | { ok: false; error: string }> {
  const current = await session();
  if (!current.ok) return { ok: false, error: current.error };
  if (!isUuid(groupId) || typeof query !== "string") return { ok: false, error: "That group isn't available." };
  const term = query.trim().slice(0, 60);
  if (term.length < 2) return { ok: true, results: [] };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_students_for_group", { p_group: groupId, p_query: term, p_limit: 15 });
  if (error) return { ok: false, error: friendly(error, "Search didn't work. Please try again.") };
  return { ok: true, results: data ?? [] };
}

// --- Notifications ---------------------------------------------------------------

/** Mark all your notifications as read. */
export async function markNotificationsRead(): Promise<Done> {
  const current = await session();
  if (!current.ok) return { ok: false, error: current.error };
  const supabase = await createClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_id", current.user.id)
    .is("read_at", null);
  if (error) return { ok: false, error: SOMETHING_WENT_WRONG };
  refresh();
  return { ok: true };
}
