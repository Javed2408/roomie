"use server";

import { refresh } from "next/cache";

import { removeUnusedMedia } from "@/lib/media-cleanup";
import { getActionUser } from "@/lib/profile";
import {
  validateBasics,
  validateHousing,
  validateInterests,
  validateLifestyle,
  validatePhotoList,
  validatePractical,
  validatePrompts,
  type BasicsInput,
  type HousingInput,
  type PracticalInput,
  type Problems,
  type PromptInput,
} from "@/lib/profile-validation";
import { getInterestCatalogue } from "@/lib/student";
import { createClient } from "@/lib/supabase/server";

/**
 * One action per profile editor section. Each saves only its own data
 * (one table, or one all-or-nothing database function), so editing one
 * section can never overwrite another. Every input is checked again here;
 * the browser's checks are only for quick feedback.
 */
export type SaveResult = { ok: true } | { ok: false; error: string; problems?: Problems };

const NEEDS_ANOTHER_LOOK = "Some answers need another look.";

function invalid(problems: Problems): SaveResult | null {
  return Object.keys(problems).length > 0
    ? { ok: false, error: NEEDS_ANOTHER_LOOK, problems }
    : null;
}

/**
 * Our database functions raise plain-language messages; constraint errors
 * are technical, so those get a general message instead.
 */
function saveFailed(error: { message: string }): SaveResult {
  const technical = /violates|duplicate key|syntax|relation|column|permission denied/i.test(
    error.message,
  );
  return {
    ok: false,
    error: technical ? "That didn't save. Check your answers and try again." : error.message,
  };
}

async function start() {
  const session = await getActionUser();
  return session.ok
    ? { ok: true as const, userId: session.user.id, supabase: await createClient() }
    : { ok: false as const, result: { ok: false, error: session.error } satisfies SaveResult };
}

export async function saveBasics(input: BasicsInput): Promise<SaveResult> {
  const session = await start();
  if (!session.ok) {
    return session.result;
  }
  const { value, problems } = validateBasics(input);
  const problem = invalid(problems);
  if (problem) {
    return problem;
  }
  const { error } = await session.supabase.from("profiles").update(value).eq("id", session.userId);
  if (error) {
    return saveFailed(error);
  }
  refresh();
  return { ok: true };
}

export async function savePrompts(prompts: PromptInput[]): Promise<SaveResult> {
  const session = await start();
  if (!session.ok) {
    return session.result;
  }
  const { value, problems } = validatePrompts(prompts);
  const problem = invalid(problems);
  if (problem) {
    return problem;
  }
  const { error } = await session.supabase
    .from("profiles")
    .update({ bio_prompts: value })
    .eq("id", session.userId);
  if (error) {
    return saveFailed(error);
  }
  refresh();
  return { ok: true };
}

/** The whole ordered photo set; the first is the main photo. */
export async function savePhotos(urls: string[]): Promise<SaveResult> {
  const session = await start();
  if (!session.ok) {
    return session.result;
  }
  const { value, problems } = validatePhotoList(urls);
  const problem = invalid(problems);
  if (problem) {
    return problem;
  }
  // Checks each photo is the student's own, then replaces the set in one go.
  const { error } = await session.supabase.rpc("set_profile_photos", { p_urls: value });
  if (error) {
    return saveFailed(error);
  }
  await removeUnusedMedia(session.userId);
  refresh();
  return { ok: true };
}

export async function saveInterests(slugs: string[]): Promise<SaveResult> {
  const session = await start();
  if (!session.ok) {
    return session.result;
  }
  const catalogue = (await getInterestCatalogue()).map((interest) => interest.slug);
  const { value, problems } = validateInterests(slugs, catalogue);
  const problem = invalid(problems);
  if (problem) {
    return problem;
  }
  const { error } = await session.supabase.rpc("set_profile_interests", { p_interests: value });
  if (error) {
    return saveFailed(error);
  }
  refresh();
  return { ok: true };
}

export async function saveLifestyle(input: Record<string, unknown>): Promise<SaveResult> {
  const session = await start();
  if (!session.ok) {
    return session.result;
  }
  const { value, problems } = validateLifestyle(input);
  const problem = invalid(problems);
  if (problem) {
    return problem;
  }
  // Update their answers, or create the row the first time.
  const updated = await session.supabase
    .from("lifestyle_preferences")
    .update(value)
    .eq("profile_id", session.userId)
    .select("profile_id");
  const { error } =
    updated.error || (updated.data && updated.data.length > 0)
      ? updated
      : await session.supabase
          .from("lifestyle_preferences")
          .insert({ profile_id: session.userId, ...value });
  if (error) {
    return saveFailed(error);
  }
  refresh();
  return { ok: true };
}

export async function savePractical(input: PracticalInput): Promise<SaveResult> {
  const session = await start();
  if (!session.ok) {
    return session.result;
  }
  const { value, problems } = validatePractical(input);
  const problem = invalid(problems);
  if (problem) {
    return problem;
  }
  // Every profile has this row (created at sign-up); insert if it's missing.
  const updated = await session.supabase
    .from("practical_preferences")
    .update(value)
    .eq("profile_id", session.userId)
    .select("profile_id");
  const { error } =
    updated.error || (updated.data && updated.data.length > 0)
      ? updated
      : await session.supabase
          .from("practical_preferences")
          .insert({ profile_id: session.userId, ...value });
  if (error) {
    return saveFailed(error);
  }
  refresh();
  return { ok: true };
}

/**
 * Housing status and discovery preferences together. Listings are hidden
 * only when the student ticked the box to do so.
 */
export async function saveHousing(input: HousingInput): Promise<SaveResult> {
  const session = await start();
  if (!session.ok) {
    return session.result;
  }
  const { value, problems } = validateHousing(input);
  const problem = invalid(problems);
  if (problem) {
    return problem;
  }
  const { error } = await session.supabase.rpc("update_housing_and_discovery", {
    p_status: value.status,
    p_discover: value.discover_housing,
    p_seeking: value.seeking,
    p_hide_listings: value.hide_listings,
  });
  if (error) {
    return saveFailed(error);
  }
  refresh();
  return { ok: true };
}
