"use server";

import { refresh } from "next/cache";

import { getActionUser } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/uuid";

type Result = { ok: true } | { ok: false; error: string };

/**
 * Block or unblock a student. A block hides you from each other in
 * Discover and stops new likes and messages between you. Only you can
 * see it; they aren't told.
 */
export async function setBlocked(studentId: string, blocked: boolean): Promise<Result> {
  const session = await getActionUser();
  if (!session.ok) {
    return { ok: false, error: session.error };
  }
  if (!isUuid(studentId) || studentId === session.user.id) {
    return { ok: false, error: "That profile isn't available." };
  }
  const supabase = await createClient();
  const { error } = blocked
    ? await supabase
        .from("blocks")
        .upsert({ blocker_id: session.user.id, blocked_id: studentId }, { onConflict: "blocker_id,blocked_id", ignoreDuplicates: true })
    : await supabase.from("blocks").delete().eq("blocker_id", session.user.id).eq("blocked_id", studentId);
  if (error) {
    return { ok: false, error: "That didn't go through. Please try again." };
  }
  refresh();
  return { ok: true };
}
