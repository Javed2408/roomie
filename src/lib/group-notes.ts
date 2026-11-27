import type { GroupMembershipNoteRow } from "@/types/database";

/** group_membership_notes() refuses more groups than this in one call (017). */
export const NOTES_BATCH = 200;

/** One group_membership_notes() call for these groups (at most NOTES_BATCH). */
export type FetchNotes = (
  groupIds: string[],
) => PromiseLike<{ data: GroupMembershipNoteRow[] | null; error: { message: string } | null }>;

export const noteKey = (groupId: string, profileId: string) => `${groupId}:${profileId}`;

/**
 * Every note `fetchNotes` returns for these groups, keyed by noteKey(): one
 * call per NOTES_BATCH distinct groups, none for an empty list. A failed
 * call fails the whole load rather than returning part of the notes.
 */
export async function notesInBatches(fetchNotes: FetchNotes, groupIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(groupIds)];
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += NOTES_BATCH) batches.push(ids.slice(i, i + NOTES_BATCH));
  const notes = new Map<string, string>();
  for (const { data, error } of await Promise.all(batches.map((batch) => fetchNotes(batch)))) {
    if (error) {
      throw new Error(`Couldn't load notes: ${error.message}`);
    }
    for (const note of data ?? []) notes.set(noteKey(note.group_id, note.profile_id), note.message);
  }
  return notes;
}
