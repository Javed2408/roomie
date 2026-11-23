/**
 * The discovery engine's database side (migration 013): who may appear in
 * a feed, the four discovery scenarios, blocks, hard filters, private
 * data, and that likes and matches still work.
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

import { as, createDatabase, createLegacyUser, createUser, onboard, rows, type Db } from "./harness.mts";

type Row = {
  candidate_id: string;
  housing: string;
  listing_id: string | null;
  facts: Record<string, unknown>;
  lifestyle: unknown;
  interests: string[];
};

describe("discovery engine", () => {
  let db: Db;
  // Students: a viewer who needs a place, two with a place (one with a live
  // flat), two more looking, plus accounts that must never appear.
  let viewer: string;
  let owner: string;
  let ownerNoFlat: string;
  let hunter: string;
  let hunter2: string;
  let unconfirmed: string;
  let gmail: string;
  let banned: string;
  let unfinished: string;
  let sample: string;
  let flatId: string;

  const feed = (user: string, filters: Record<string, unknown> = {}, exclude: string[] = []) =>
    as(db, user, () =>
      rows<Row>(db, "select * from public.discovery_candidates($1::jsonb, $2::uuid[], 300)", [JSON.stringify(filters), exclude]),
    );
  const idsIn = async (user: string, filters: Record<string, unknown> = {}, exclude: string[] = []) =>
    new Set((await feed(user, filters, exclude)).map((row) => row.candidate_id));
  const discover = (user: string, value: string, seeking = "either") =>
    db.query("update public.discovery_preferences set discover_housing = $2, seeking = $3 where profile_id = $1", [user, value, seeking]);
  const practical = (user: string, sql: string, params: unknown[] = []) =>
    db.query(`update public.practical_preferences set ${sql} where profile_id = $1`, [user, ...params]);

  before(async () => {
    db = await createDatabase();
    viewer = await createUser(db, "viewer@srmist.edu.in");
    owner = await createUser(db, "owner@srmist.edu.in");
    ownerNoFlat = await createUser(db, "ownernoflat@srmist.edu.in");
    hunter = await createUser(db, "hunter@srmist.edu.in");
    hunter2 = await createUser(db, "hunter2@srmist.edu.in");
    unconfirmed = await createUser(db, "unconfirmed@srmist.edu.in", { confirmed: false });
    gmail = await createLegacyUser(db, "someone@gmail.com");
    banned = await createUser(db, "banned@srmist.edu.in");
    unfinished = await createUser(db, "unfinished@srmist.edu.in");
    sample = await createUser(db, "meera@seed.roomie.test", { appMetadata: { roomie_seed: "true" } });

    await onboard(db, viewer, "need_flat", "Viv");
    await onboard(db, owner, "have_flat", "Omar");
    await onboard(db, ownerNoFlat, "have_flat", "Ola");
    await onboard(db, hunter, "need_flat", "Hari");
    await onboard(db, hunter2, "need_flat", "Hema");
    await onboard(db, unconfirmed, "need_flat", "Uma");
    await onboard(db, gmail, "need_flat", "Gita");
    await onboard(db, banned, "need_flat", "Ben");
    await onboard(db, sample, "need_flat", "Meera");
    await db.query("update public.profiles set is_sample = true where id = $1", [sample]);
    // Started signing up, never finished: housing but no name.
    await db.query("insert into public.housing_status (profile_id, status) values ($1, 'needs_accommodation')", [unfinished]);
    await db.query("update auth.users set banned_until = now() + interval '7 days' where id = $1", [banned]);

    const [flat] = await rows<{ id: string }>(
      db,
      `insert into public.listings (owner_id, society, bhk_type, rent_per_person, maintenance_per_person, amenities, is_active)
       values ($1, 'Estancia', '2BHK', 9000, 1000, '{AC,Wi-Fi}', true) returning id`,
      [owner],
    );
    flatId = flat.id;
    await practical(hunter, "budget_min = 12000, budget_max = 15000, preferred_societies = '{Akshaya}', move_in_timeframe = 'july', room_type = 'shared'");
    await practical(viewer, "budget_min = 8000, budget_max = 11000, preferred_societies = '{Estancia}', move_in_timeframe = 'next_month', room_type = 'private', preferred_bhk_types = '{2BHK}', required_amenities = '{AC,Cook}'");
  });

  beforeEach(async () => {
    for (const id of [viewer, owner, ownerNoFlat, hunter, hunter2]) {
      await discover(id, "both");
    }
    await db.query("delete from public.blocks");
    await db.query("delete from public.swipes");
    await db.query("update public.profiles set gender = 'male'");
    await db.query("update public.practical_preferences set flatmate_gender = null");
  });

  describe("eligibility", () => {
    it("shows only confirmed, active, onboarded SRM students, never yourself", async () => {
      const seen = await idsIn(viewer);
      assert.deepEqual(seen, new Set([owner, ownerNoFlat, hunter, hunter2, sample]));
      for (const hidden of [viewer, unconfirmed, gmail, banned, unfinished]) {
        assert.ok(!seen.has(hidden));
      }
    });

    it("hides a deleted account", async () => {
      await db.query("update auth.users set deleted_at = now() where id = $1", [hunter2]);
      try {
        assert.ok(!(await idsIn(viewer)).has(hunter2));
      } finally {
        await db.query("update auth.users set deleted_at = null where id = $1", [hunter2]);
      }
    });

    it("refuses anyone who isn't a confirmed SRM student, checked by the database", async () => {
      for (const user of [unconfirmed, gmail]) {
        await assert.rejects(feed(user), /Only signed-in SRM students/);
      }
      await as(db, null, () => assert.rejects(db.query("select * from public.discovery_candidates()"), /permission denied/));
    });

    it("doesn't trust the profile badge", async () => {
      await db.query("update public.profiles set is_srm_verified = true where id = $1", [gmail]);
      try {
        await assert.rejects(feed(gmail), /Only signed-in SRM students/);
        assert.ok(!(await idsIn(viewer)).has(gmail));
      } finally {
        await db.query("update public.profiles set is_srm_verified = false where id = $1", [gmail]);
      }
    });
  });

  describe("discovery preferences, independent of your own housing", () => {
    it("scenario 1: has a place, wants people who need one", async () => {
      await discover(owner, "needs_accommodation");
      assert.deepEqual(await idsIn(owner), new Set([viewer, hunter, hunter2, sample]));
    });

    it("scenario 2: needs a place, wants people who have one", async () => {
      await discover(viewer, "has_accommodation");
      assert.deepEqual(await idsIn(viewer), new Set([owner, ownerNoFlat]));
    });

    it("scenario 3: needs a place, wants others who need one too", async () => {
      await discover(hunter, "needs_accommodation");
      assert.deepEqual(await idsIn(hunter), new Set([viewer, hunter2, sample]));
    });

    it("scenario 4: has a place, wants both", async () => {
      assert.deepEqual(await idsIn(ownerNoFlat), new Set([viewer, owner, hunter, hunter2, sample]));
    });

    it("follows a changed preference straight away, without onboarding", async () => {
      await discover(viewer, "has_accommodation");
      assert.ok(!(await idsIn(viewer)).has(hunter));
      await as(db, viewer, () =>
        db.query("update public.discovery_preferences set discover_housing = 'needs_accommodation' where profile_id = $1", [viewer]),
      );
      assert.deepEqual(await idsIn(viewer), new Set([hunter, hunter2, sample]));
    });

    it("uses the viewer's saved preference, which the caller can't override", async () => {
      await discover(viewer, "has_accommodation");
      const seen = await idsIn(viewer, { discover_housing: "needs_accommodation" });
      assert.ok(!seen.has(hunter));
    });

    it("only offers a live flat from someone who has a place", async () => {
      const result = await feed(viewer);
      assert.equal(result.find((row) => row.candidate_id === owner)?.listing_id, flatId);
      assert.equal(result.find((row) => row.candidate_id === ownerNoFlat)?.listing_id, null);
    });
  });

  describe("past decisions, blocks and safety", () => {
    it("drops people you've liked or passed, but not the other way round", async () => {
      await as(db, viewer, () =>
        db.query("insert into public.swipes (sender_id, receiver_id, action) values ($1, $2, 'pass')", [viewer, hunter]),
      );
      assert.ok(!(await idsIn(viewer)).has(hunter));
      assert.ok((await idsIn(hunter)).has(viewer));
    });

    it("skips the ids the app has already shown", async () => {
      const seen = await idsIn(viewer, {}, [owner, hunter]);
      assert.ok(!seen.has(owner) && !seen.has(hunter));
      assert.ok(seen.has(hunter2));
    });

    it("hides blocked students both ways, and unblocking brings them back", async () => {
      await as(db, viewer, () => db.query("insert into public.blocks (blocker_id, blocked_id) values ($1, $2)", [viewer, hunter]));
      assert.ok(!(await idsIn(viewer)).has(hunter));
      assert.ok(!(await idsIn(hunter)).has(viewer));
      await as(db, viewer, () => db.query("delete from public.blocks where blocked_id = $1", [hunter]));
      assert.ok((await idsIn(viewer)).has(hunter));
    });

    it("keeps blocks private to the blocker and can't be made for someone else", async () => {
      await as(db, viewer, () => db.query("insert into public.blocks (blocker_id, blocked_id) values ($1, $2)", [viewer, hunter]));
      assert.equal((await as(db, hunter, () => rows(db, "select * from public.blocks"))).length, 0);
      assert.equal((await as(db, viewer, () => rows(db, "select * from public.blocks"))).length, 1);
      await as(db, hunter, () =>
        assert.rejects(
          db.query("insert into public.blocks (blocker_id, blocked_id) values ($1, $2)", [viewer, hunter2]),
          /row-level security/,
        ),
      );
      await as(db, hunter, () =>
        assert.rejects(db.query("select public.is_blocked_pair($1, $2)", [viewer, hunter]), /permission denied/),
      );
    });

    it("refuses new likes and messages across a block, keeping the history", async () => {
      await db.query(
        "insert into public.swipes (sender_id, receiver_id, action) values ($1, $2, 'like'), ($2, $1, 'like')",
        [viewer, hunter],
      );
      const [match] = await rows<{ id: string }>(db, "select id from public.matches where $1 in (user_a, user_b) and $2 in (user_a, user_b)", [viewer, hunter]);
      await as(db, hunter, () =>
        db.query("insert into public.messages (match_id, sender_id, content) values ($1, $2, 'Hi!')", [match.id, hunter]),
      );
      await as(db, viewer, () => db.query("insert into public.blocks (blocker_id, blocked_id) values ($1, $2)", [viewer, hunter]));
      await as(db, hunter, () =>
        assert.rejects(
          db.query("insert into public.messages (match_id, sender_id, content) values ($1, $2, 'Hello?')", [match.id, hunter]),
          /conversation is closed/,
        ),
      );
      // A like either way across a block is refused (here: a fresh pair).
      await as(db, viewer, () => db.query("insert into public.blocks (blocker_id, blocked_id) values ($1, $2)", [viewer, hunter2]));
      await as(db, hunter2, () =>
        assert.rejects(
          db.query("insert into public.swipes (sender_id, receiver_id, action) values ($1, $2, 'like')", [hunter2, viewer]),
          /isn't available/,
        ),
      );
      await as(db, viewer, () =>
        assert.rejects(
          db.query("insert into public.swipes (sender_id, receiver_id, action) values ($1, $2, 'pass')", [viewer, hunter2]),
          /isn't available/,
        ),
      );
      const [{ count }] = await rows<{ count: number }>(db, "select count(*)::int as count from public.messages where match_id = $1", [match.id]);
      assert.equal(count, 1, "earlier messages are kept");
      await db.query("delete from public.matches where id = $1", [match.id]);
    });

    it("respects a student's own flatmate-gender wish", async () => {
      await practical(hunter, "flatmate_gender = 'female'");
      assert.ok(!(await idsIn(viewer)).has(hunter), "a man isn't shown to someone who asked for women");
      await db.query("update public.profiles set gender = 'female' where id = $1", [viewer]);
      assert.ok((await idsIn(viewer)).has(hunter));
    });
  });

  describe("hard filters", () => {
    it("filters by society, keeping people who haven't said", async () => {
      const seen = await idsIn(viewer, { societies: ["Estancia"] });
      assert.ok(seen.has(owner), "their flat is in Estancia");
      assert.ok(!seen.has(hunter), "only wants Akshaya");
      assert.ok(seen.has(hunter2), "no preference given");
    });

    it("filters by budget: a flat's monthly cost, or an overlapping range", async () => {
      const under = await idsIn(viewer, { budget_max: 11000 });
      assert.ok(under.has(owner), "flat costs 10,000");
      assert.ok(!under.has(hunter), "won't go below 12,000");
      assert.ok(under.has(hunter2), "no budget given");
      const over = await idsIn(viewer, { budget_min: 11000 });
      assert.ok(!over.has(owner));
      assert.ok(over.has(hunter));
    });

    it("filters by move-in timing, including when a flat becomes free", async () => {
      const soon = await idsIn(viewer, { move_in: "next_month" });
      assert.ok(!soon.has(hunter), "moving in July");
      assert.ok(soon.has(hunter2), "not said");
      assert.ok(soon.has(owner), "flat free now");
      await db.query("update public.listings set available_from = current_date + 300 where id = $1", [flatId]);
      try {
        assert.ok(!(await idsIn(viewer, { move_in: "immediate" })).has(owner));
      } finally {
        await db.query("update public.listings set available_from = null where id = $1", [flatId]);
      }
    });

    it("filters by amenities only among students with a flat", async () => {
      assert.ok((await idsIn(viewer, { amenities: ["AC"] })).has(owner));
      const cook = await idsIn(viewer, { amenities: ["Cook"] });
      assert.ok(!cook.has(owner), "their flat has no cook");
      assert.ok(cook.has(hunter), "no flat to judge");
    });

    it("filters by room type, flat size and gender, and combines filters", async () => {
      assert.ok(!(await idsIn(viewer, { room_type: "private" })).has(hunter), "wants a shared room");
      assert.ok(!(await idsIn(viewer, { bhk: ["3BHK"] })).has(owner), "their flat is a 2BHK");
      await db.query("update public.profiles set gender = 'female' where id = $1", [hunter2]);
      assert.deepEqual(await idsIn(viewer, { gender: "female" }), new Set([hunter2]));
      assert.deepEqual(await idsIn(viewer, { societies: ["Estancia"], budget_max: 11000, amenities: ["AC"] }), new Set([owner, ownerNoFlat, hunter2, sample]));
    });

    it("ignores malformed filters instead of trusting them", async () => {
      const everyone = await idsIn(viewer);
      assert.deepEqual(await idsIn(viewer, { budget_max: "lots; drop table", move_in: "now", societies: "Estancia" }), everyone);
      await as(db, viewer, () =>
        assert.rejects(db.query("select * from public.discovery_candidates('[]'::jsonb)"), /Filters must be an object/),
      );
    });
  });

  describe("compatibility data and privacy", () => {
    it("returns how private preferences compare, never the values", async () => {
      const result = await feed(viewer);
      const flat = result.find((row) => row.candidate_id === owner);
      assert.deepEqual(flat?.facts, { budget: "match", societies: "match", move_in: "match", bhk: "match", amenities: 0.5 });
      const looking = result.find((row) => row.candidate_id === hunter);
      assert.deepEqual(looking?.facts, { budget: "close", societies: "mismatch", move_in: "mismatch", room_type: "mismatch" });
      const unknown = result.find((row) => row.candidate_id === hunter2);
      assert.deepEqual(unknown?.facts, {}, "nothing to compare means no facts");
      const text = JSON.stringify(result);
      for (const secret of ["12000", "15000", "shared"]) {
        assert.ok(!text.includes(secret), `leaked ${secret}`);
      }
      assert.ok(!text.includes("email"));
    });

    it("still keeps other students' practical preferences unreadable directly", async () => {
      assert.equal((await as(db, viewer, () => rows(db, "select * from public.practical_preferences where profile_id = $1", [hunter]))).length, 0);
    });

    it("returns public lifestyle answers and interests for scoring", async () => {
      await db.query("insert into public.lifestyle_preferences (profile_id, sleep_schedule) values ($1, 'night_owl') on conflict (profile_id) do update set sleep_schedule = 'night_owl'", [hunter]);
      await db.query("insert into public.profile_interests (profile_id, interest) values ($1, 'chess') on conflict do nothing", [hunter]);
      const row = (await feed(viewer)).find((item) => item.candidate_id === hunter);
      assert.equal((row?.lifestyle as { sleep_schedule: string }).sleep_schedule, "night_owl");
      assert.deepEqual(row?.interests, ["chess"]);
    });
  });

  describe("likes and matches", () => {
    it("still turns two likes into one match, and the matched pair leaves both feeds", async () => {
      await as(db, viewer, () =>
        db.query(
          "insert into public.swipes (sender_id, receiver_id, action, liked_target_type, liked_target_ref, comment) values ($1, $2, 'like', 'listing', $3, 'Love the flat')",
          [viewer, owner, flatId],
        ),
      );
      await as(db, owner, () =>
        db.query("insert into public.swipes (sender_id, receiver_id, action) values ($1, $2, 'like')", [owner, viewer]),
      );
      const matches = await rows<{ initial_comment: string }>(
        db,
        "select initial_comment from public.matches where $1 in (user_a, user_b) and $2 in (user_a, user_b)",
        [viewer, owner],
      );
      assert.equal(matches.length, 1);
      assert.equal(matches[0].initial_comment, "Love the flat");
      assert.ok(!(await idsIn(viewer)).has(owner));
      assert.ok(!(await idsIn(owner)).has(viewer));
    });
  });

  it("gives new students 'both' without changing anyone's saved choice", async () => {
    await discover(hunter, "has_accommodation");
    const fresh = await createUser(db, "fresh@srmist.edu.in");
    await onboard(db, fresh, "have_flat", "Fresh");
    const prefs = await rows<{ profile_id: string; discover_housing: string }>(
      db,
      "select profile_id, discover_housing from public.discovery_preferences where profile_id in ($1, $2)",
      [fresh, hunter],
    );
    assert.equal(prefs.find((row) => row.profile_id === fresh)?.discover_housing, "both");
    assert.equal(prefs.find((row) => row.profile_id === hunter)?.discover_housing, "has_accommodation");
    await db.query("delete from auth.users where id = $1", [fresh]);
  });
});
