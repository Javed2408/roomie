"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { sendSwipe } from "@/app/discover/actions";

/**
 * Answer a like from "Likes You".
 *
 * "match" likes them back: the database trigger turns the two likes into a
 * match, and we go straight to the new chat. "pass" quietly declines; they
 * are never told.
 */
export async function respondToLike(
  senderId: string,
  decision: "match" | "pass",
): Promise<{ error: string }> {
  if (decision !== "match" && decision !== "pass") {
    return { error: "Unknown action." };
  }
  const result = await sendSwipe({
    receiverId: senderId,
    action: decision === "match" ? "like" : "pass",
  });
  if (!result.ok) {
    return { error: result.error };
  }
  if (result.match) {
    redirect(`/matches/${result.match.id}`);
  }
  // A pass, or (rarely) their account is gone so no match could be made:
  // either way, show the updated list.
  refresh();
  return { error: "" };
}
