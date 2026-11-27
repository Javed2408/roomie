/**
 * The SQL an operator runs from ROOMIE_PHASE_7A_7B_DEPLOYMENT_RUNBOOK.md,
 * read from the runbook itself (no copies here) and run on PGlite: the
 * checks P2, P3, P7, V2, V3, V4 and V7, and the rollbacks R18 and R017.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { before, describe, it } from "node:test";

import { applyMigrations, createDatabase, rows, type Db } from "./harness.mts";

const RUNBOOK = await readFile(join(import.meta.dirname, "..", "..", "ROOMIE_PHASE_7A_7B_DEPLOYMENT_RUNBOOK.md"), "utf8");

/** The runbook's SQL block that starts with "-- <tag>. "; there must be exactly one. */
function sql(tag: string): string {
  const found = [...RUNBOOK.matchAll(/```sql\n([\s\S]*?)```/g)]
    .map((match) => match[1])
    .filter((block) => block.trimStart().startsWith(`-- ${tag}. `));
  assert.equal(found.length, 1, `the runbook has exactly one ${tag} block`);
  return found[0];
}

/** Rows of the block's last statement. */
const run = async (db: Db, tag: string) => (await db.exec(sql(tag))).at(-1)!.rows as Array<Record<string, unknown>>;
async function oneRow(db: Db, tag: string) {
  const result = await run(db, tag);
  assert.equal(result.length, 1, `${tag} returns exactly one row`);
  return result[0];
}

const OK = (narrowed: boolean) => ({ policy_count: 1, narrowed, other_select_policies: 0, check_state: "ok" });
const P7_STAGE = "FAIL: 018 is already applied (P7 expects the pre-018 policy)";
const V7_STAGE = "FAIL: 018 is not applied (V7 expects the narrowed policy)";
const TRIGGERS_017 = [
  "group_events_clear_orphaned_note",
  "group_members_clear_deleted_event_notes",
  "group_members_clear_settled_event_notes",
  "group_members_clear_settled_note",
];
const FUNCTIONS_017 = [
  "clear_orphaned_event_note",
  "clear_settled_group_member_note",
  "clear_settled_membership_event_notes",
  "group_membership_notes",
];
const ALL_017 = { functions: FUNCTIONS_017, triggers: TRIGGERS_017, constraints: ["group_members_note_only_while_pending"] };
const NONE_017 = { functions: [], triggers: [], constraints: [] };

/** 017's functions, triggers and constraint as the runbook's V2, V3 and V4 find them, sorted by name. */
async function structure017(db: Db) {
  const names = async (tag: string, column: string) => (await run(db, tag)).map((row) => row[column] as string).sort();
  return {
    functions: await names("V2", "proname"),
    // V3 lists every trigger on the two tables; only 017's four matter here.
    triggers: (await names("V3", "tgname")).filter((name) => TRIGGERS_017.includes(name)),
    constraints: await names("V4", "conname"),
  };
}

const eventsPolicies = (db: Db) =>
  rows(db, "select policyname, permissive, roles::text as roles, cmd, qual from pg_policies where schemaname = 'public' and tablename = 'group_events'");

/** Run `work` inside a transaction that is always rolled back. */
async function rolledBack(db: Db, work: () => Promise<void>) {
  await db.exec("begin");
  try {
    await work();
  } finally {
    await db.exec("rollback");
  }
}

describe("runbook checks P7 and V7 (stage-aware, always one row)", () => {
  let db017: Db;
  let db018: Db;

  before(async () => {
    db017 = await createDatabase({ through: "017" });
    db018 = await createDatabase();
  });

  it("P7 passes on 017 alone, and fails once 018 is applied", async () => {
    assert.deepEqual(await oneRow(db017, "P7"), OK(false));
    assert.deepEqual(await oneRow(db018, "P7"), { ...OK(true), check_state: P7_STAGE });
  });

  it("V7 passes after 018, and fails on 017 alone", async () => {
    assert.deepEqual(await oneRow(db018, "V7"), OK(true));
    assert.deepEqual(await oneRow(db017, "V7"), { ...OK(false), check_state: V7_STAGE });
  });

  it("both report a missing policy, at either stage", async () => {
    for (const db of [db017, db018]) {
      await rolledBack(db, async () => {
        await db.exec(`drop policy "group_events: involved people read" on public.group_events`);
        for (const tag of ["P7", "V7"]) {
          assert.deepEqual(await oneRow(db, tag), { policy_count: 0, narrowed: false, other_select_policies: 0, check_state: "FAIL: policy missing" });
        }
      });
    }
  });

  it("both report an extra permissive SELECT or ALL policy; a restrictive one is not a failure", async () => {
    for (const [db, narrowed] of [[db017, false], [db018, true]] as const) {
      for (const command of ["for select", "for all"]) {
        await rolledBack(db, async () => {
          await db.exec(`create policy "extra" on public.group_events ${command} to authenticated using (true)`);
          for (const tag of ["P7", "V7"]) {
            assert.deepEqual(await oneRow(db, tag), {
              policy_count: 1, narrowed, other_select_policies: 1, check_state: "FAIL: another permissive SELECT policy on group_events",
            });
          }
        });
      }
      await rolledBack(db, async () => {
        await db.exec(`create policy "narrower" on public.group_events as restrictive for select to authenticated using (true)`);
        assert.deepEqual(await oneRow(db, narrowed ? "V7" : "P7"), OK(narrowed));
      });
    }
  });
});

describe("runbook rollbacks R18 and R017", () => {
  let before018: unknown[];

  before(async () => {
    before018 = await eventsPolicies(await createDatabase({ through: "017" }));
  });

  it("R18 restores exactly the policy 017 alone has; P7 then passes and 018 re-applies", async () => {
    const db = await createDatabase();
    await db.exec(sql("R18"));
    assert.deepEqual(await eventsPolicies(db), before018);
    assert.deepEqual(await oneRow(db, "P7"), OK(false));
    await applyMigrations(db, { after: "017" });
    assert.deepEqual(await oneRow(db, "V7"), OK(true));
  });

  it("R017 alone removes 017's functions, triggers and constraint and restores the table-wide read, but leaves 018's policy", async () => {
    const db = await createDatabase();
    assert.deepEqual(await structure017(db), ALL_017, "V2, V3 and V4 find all of 017 before the rollback");
    await db.exec(sql("R017"));
    assert.deepEqual(await structure017(db), NONE_017, "V2, V3 and V4 find nothing of 017 after the rollback");
    assert.deepEqual(await oneRow(db, "P2"), { already_applied: false });
    assert.deepEqual(await oneRow(db, "P3"), { authenticated_table_select: true, authenticated_note_select: true, anon_table_select: false });
    assert.deepEqual(await oneRow(db, "V7"), OK(true), "R017 does not touch the group_events policy");
  });

  it("R18 then R017: every check reads as before the window", async () => {
    const db = await createDatabase();
    await db.exec(sql("R18"));
    assert.deepEqual(await structure017(db), ALL_017, "R18 leaves all of 017 in place");
    await db.exec(sql("R017"));
    assert.deepEqual(await structure017(db), NONE_017, "V2, V3 and V4 find nothing of 017 after the rollback");
    assert.deepEqual(await oneRow(db, "P2"), { already_applied: false });
    assert.deepEqual(await oneRow(db, "P3"), { authenticated_table_select: true, authenticated_note_select: true, anon_table_select: false });
    assert.deepEqual(await oneRow(db, "P7"), OK(false));
    assert.deepEqual(await eventsPolicies(db), before018);
  });
});
