/**
 * Loading pending notes for many groups (src/lib/group-notes.ts, used by
 * loadNotes() in src/lib/groups.ts). group_membership_notes() refuses more
 * than 200 groups per call (017), so the app asks in batches. These tests
 * run the real function: if batching broke, the database would refuse.
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { NOTES_BATCH, noteKey, notesInBatches, type FetchNotes } from "../../src/lib/group-notes.ts";
import type { GroupMembershipNoteRow } from "../../src/types/database.ts";
import { as, createDatabase, createUser, onboard, rows, type Db } from "./harness.mts";

describe("pending notes for more groups than one call allows", () => {
  let db: Db;
  let asha: string;
  let kiran: string;
  const groups: string[] = [];
  /** Kiran asks to join these groups (by index), spread across batches. */
  const ASKED = [0, 199, 200, 399, 449];

  /** A FetchNotes that calls the real function as `user`, one call at a time, recording each call's size. */
  let queue: Promise<unknown> = Promise.resolve();
  const fetchAs = (user: string | null, calls: number[]): FetchNotes => (groupIds) => {
    calls.push(groupIds.length);
    const call = queue.then(async () => {
      try {
        const data = await as(db, user, () =>
          rows<GroupMembershipNoteRow>(db, "select group_id, profile_id, status, message from public.group_membership_notes($1::uuid[])", [
            `{${groupIds.join(",")}}`,
          ]),
        );
        return { data, error: null };
      } catch (error) {
        return { data: null, error: { message: (error as Error).message } };
      }
    });
    queue = call;
    return call;
  };
  const expectedNotes = (indexes: number[]) => new Map(indexes.map((i) => [noteKey(groups[i], kiran), `NOTE-${i}`]));

  before(async () => {
    db = await createDatabase();
    asha = await createUser(db, "asha@srmist.edu.in");
    kiran = await createUser(db, "kiran@srmist.edu.in");
    await onboard(db, asha, "need_flat", "Asha");
    await onboard(db, kiran, "need_flat", "Kiran");
    for (let i = 0; i < 450; i++) {
      const [{ id }] = await as(db, asha, () =>
        rows<{ id: string }>(db, "insert into public.groups (name, created_by, is_discoverable) values ($1, $2, true) returning id", [`Group ${i}`, asha]),
      );
      groups.push(id);
    }
    for (const i of ASKED) {
      await as(db, kiran, () => rows(db, "select public.request_to_join_group($1, $2)", [groups[i], `NOTE-${i}`]));
    }
  });

  it("the database still refuses more than 200 groups in one call (017 unchanged)", async () => {
    assert.equal(NOTES_BATCH, 200);
    await assert.rejects(
      as(db, asha, () => rows(db, "select * from public.group_membership_notes($1::uuid[])", [`{${groups.slice(0, 201).join(",")}}`])),
      /at most 200 groups/,
    );
  });

  it("200 groups: one call", async () => {
    const calls: number[] = [];
    assert.deepEqual(await notesInBatches(fetchAs(asha, calls), groups.slice(0, 200)), expectedNotes([0, 199]));
    assert.deepEqual(calls, [200]);
  });

  it("201 groups: two calls, and the notes from both are merged", async () => {
    const calls: number[] = [];
    assert.deepEqual(await notesInBatches(fetchAs(asha, calls), groups.slice(0, 201)), expectedNotes([0, 199, 200]));
    assert.deepEqual(calls, [200, 1]);
  });

  it("450 groups: three calls, every note", async () => {
    const calls: number[] = [];
    assert.deepEqual(await notesInBatches(fetchAs(asha, calls), groups), expectedNotes(ASKED));
    assert.deepEqual(calls, [200, 200, 50]);
  });

  it("duplicate group ids: the same notes and the same calls as the distinct list", async () => {
    const calls: number[] = [];
    const twice = [...groups, ...groups.slice().reverse()];
    assert.deepEqual(await notesInBatches(fetchAs(asha, calls), twice), expectedNotes(ASKED));
    assert.deepEqual(calls, [200, 200, 50]);
  });

  it("no groups: no call", async () => {
    const calls: number[] = [];
    assert.deepEqual(await notesInBatches(fetchAs(asha, calls), []), new Map());
    assert.deepEqual(calls, []);
  });

  it("a refused call is surfaced, not swallowed: a signed-out caller (anon may not call the function)", async () => {
    await assert.rejects(
      notesInBatches(fetchAs(null, []), groups),
      /^Error: Couldn't load notes: permission denied for function group_membership_notes$/,
    );
  });

  it("one failed batch fails the whole load: no partial notes", async () => {
    let call = 0;
    const real = fetchAs(asha, []);
    const failSecond: FetchNotes = (groupIds) =>
      ++call === 2 ? Promise.resolve({ data: null, error: { message: "network down" } }) : real(groupIds);
    await assert.rejects(notesInBatches(failSecond, groups), /^Error: Couldn't load notes: network down$/);
  });
});
