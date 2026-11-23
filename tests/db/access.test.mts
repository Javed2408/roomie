/**
 * SRM-only access (migration 011): accounts that aren't confirmed
 * @srmist.edu.in addresses keep their data but can't use Roomie, and
 * eligibility comes from the login, never the profile badge.
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import {
  affected,
  as,
  createDatabase,
  createLegacyUser,
  createUser,
  mediaUrl,
  onboard,
  rows,
  type Db,
} from "./harness.mts";

describe("SRM-only access for existing accounts", () => {
  let db: Db;
  let srm: string;
  let other: string;
  let legacy: string;
  let badgeOnly: string;
  let unconfirmed: string;
  let matchId: string;

  before(async () => {
    db = await createDatabase();
    srm = await createUser(db, "srm@srmist.edu.in");
    other = await createUser(db, "other@srmist.edu.in");
    legacy = await createLegacyUser(db, "legacy@gmail.com");
    badgeOnly = await createLegacyUser(db, "badge@gmail.com");
    unconfirmed = await createUser(db, "pending@srmist.edu.in", { confirmed: false });
    await onboard(db, srm, "have_flat", "Srm");
    await onboard(db, other, "need_flat", "Other");
    await onboard(db, legacy, "need_flat", "Legacy");
    await onboard(db, badgeOnly, "need_flat", "Badge");
    // Someone giving themselves the badge directly (only possible for the
    // database owner) must still not get access.
    await db.query("update public.profiles set is_srm_verified = true where id = $1", [badgeOnly]);

    // History from before the restriction: a match with messages.
    await db.query(
      "insert into public.listings (owner_id, society, bhk_type, rent_per_person) values ($1, 'Estancia', '3BHK', 12000)",
      [srm],
    );
    await db.query(
      "insert into public.swipes (sender_id, receiver_id, action, comment) values ($1, $2, 'like', 'Hi!'), ($2, $1, 'like', null)",
      [legacy, srm],
    );
    [{ id: matchId }] = await rows<{ id: string }>(db, "select id from public.matches");
    await db.query(
      "insert into public.messages (match_id, sender_id, content) values ($1, $2, 'Hello'), ($1, $3, 'Hey')",
      [matchId, legacy, srm],
    );
  });

  for (const [who, id] of [
    ["a pre-SRM-only account", () => legacy],
    ["an account with the badge but a non-SRM email", () => badgeOnly],
    ["an SRM address that isn't confirmed", () => unconfirmed],
  ] as const) {
    describe(who, () => {
      it("can't see other students, their flats or their preferences", async () => {
        await as(db, id(), async () => {
          const profiles = await rows<{ id: string }>(db, "select id from public.profiles");
          assert.deepEqual(profiles.map((row) => row.id), [id()]);
          assert.equal((await rows(db, "select 1 from public.listings")).length, 0);
          assert.equal((await rows(db, "select 1 from public.housing_status where profile_id <> $1", [id()])).length, 0);
          assert.equal((await rows(db, "select 1 from public.lifestyle_preferences where profile_id <> $1", [id()])).length, 0);
          assert.equal((await rows(db, "select 1 from public.profile_photos where profile_id <> $1", [id()])).length, 0);
        });
      });

      it("can't like, edit, upload or change settings", async () => {
        await as(db, id(), async () => {
          await assert.rejects(
            db.query("insert into public.swipes (sender_id, receiver_id, action) values ($1, $2, 'like')", [id(), other]),
            /row-level security/,
          );
          assert.equal(await affected(db, "update public.profiles set full_name = 'Changed' where id = $1", [id()]), 0);
          await assert.rejects(
            db.query("insert into storage.objects (bucket_id, name) values ('roomie-media', $1)", [`${id()}/photo-1.jpg`]),
            /row-level security/,
          );
          await assert.rejects(db.query("select public.set_profile_photos($1)", [[mediaUrl(id(), "a.jpg")]]), /SRM students/);
          await assert.rejects(db.query("select public.set_profile_interests($1)", [["gym"]]), /SRM students/);
          await assert.rejects(
            db.query("select public.update_housing_and_discovery('has_accommodation', 'both', 'either', false)"),
            /SRM students/,
          );
          await assert.rejects(
            db.query("insert into public.groups (name, created_by) values ('Nope', $1)", [id()]),
            /row-level security/,
          );
        });
      });

      it("can still read their own profile", async () => {
        const own = await as(db, id(), () => rows(db, "select id from public.profiles where id = $1", [id()]));
        assert.equal(own.length, 1);
      });
    });
  }

  it("keeps the legacy account's history, readable by the people in it", async () => {
    const counts = await rows<{ swipes: number; matches: number; messages: number }>(
      db,
      `select (select count(*)::int from public.swipes) as swipes,
              (select count(*)::int from public.matches) as matches,
              (select count(*)::int from public.messages) as messages`,
    );
    assert.deepEqual(counts, [{ swipes: 2, matches: 1, messages: 2 }]);
    const ownHistory = await as(db, legacy, () => rows(db, "select content from public.messages order by content"));
    assert.equal(ownHistory.length, 2);
  });

  it("stops the legacy account sending messages, but not the SRM student", async () => {
    await as(db, legacy, () =>
      assert.rejects(
        db.query("insert into public.messages (match_id, sender_id, content) values ($1, $2, 'Still here?')", [matchId, legacy]),
        /row-level security/,
      ),
    );
    await as(db, srm, () =>
      db.query("insert into public.messages (match_id, sender_id, content) values ($1, $2, 'Noted')", [matchId, srm]),
    );
    // The SRM student can still see who they matched with.
    const theirProfile = await as(db, srm, () => rows(db, "select full_name from public.profiles where id = $1", [legacy]));
    assert.deepEqual(theirProfile, [{ full_name: "Legacy" }]);
  });

  it("lets confirmed SRM students use everything as before", async () => {
    await as(db, other, async () => {
      assert.ok((await rows(db, "select 1 from public.profiles")).length >= 4);
      assert.equal((await rows(db, "select 1 from public.listings where is_active")).length, 1);
      await db.query("insert into public.swipes (sender_id, receiver_id, action) values ($1, $2, 'pass')", [other, srm]);
    });
  });

  it("keeps practical preferences private to their owner", async () => {
    await as(db, srm, () =>
      db.query("update public.practical_preferences set budget_min = 9000, flatmate_gender = 'any' where profile_id = $1", [srm]),
    );
    const own = await as(db, srm, () => rows(db, "select budget_min from public.practical_preferences where profile_id = $1", [srm]));
    assert.deepEqual(own, [{ budget_min: 9000 }]);
    const someoneElse = await as(db, other, () =>
      rows(db, "select 1 from public.practical_preferences where profile_id = $1", [srm]),
    );
    assert.equal(someoneElse.length, 0);
  });

  it("checks eligibility from the login, not the badge", async () => {
    const check = (id: string) =>
      as(db, id, async () => (await rows<{ ok: boolean }>(db, "select public.is_eligible_student() as ok"))[0].ok);
    assert.equal(await check(srm), true);
    assert.equal(await check(badgeOnly), false);
    assert.equal(await check(unconfirmed), false);
    assert.equal(await check(legacy), false);
  });
});
