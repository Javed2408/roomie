/**
 * Upgrading a database that already has students (001-005 applied), the way
 * the live project will be upgraded: nothing is lost, and every existing
 * student gets equivalent rows in the new tables.
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { applyMigrations, createDatabase, createUser, rows, type Db } from "./harness.mts";

/** Everything that existed before the upgrade, in a comparable form. */
const SNAPSHOT_QUERIES = {
  users: "select id, email, email_confirmed_at from auth.users order by id",
  profiles: `select id, email, full_name, gender, year_of_study, department, mode, is_srm_verified,
                    avatar_url, bio_prompts, preferred_societies, max_budget, move_in_timeframe,
                    is_sample, created_at
             from public.profiles order by id`,
  listings: `select id, owner_id, society, bhk_type, vacant_spots, rent_per_person,
                    maintenance_per_person, deposit_per_person, setup_cost, amenities, photos,
                    is_active, created_at
             from public.listings order by id`,
  swipes: "select * from public.swipes order by id",
  matches: "select * from public.matches order by id",
  messages: "select * from public.messages order by id",
};

async function snapshot(db: Db) {
  const result: Record<string, unknown[]> = {};
  for (const [name, sql] of Object.entries(SNAPSHOT_QUERIES)) {
    result[name] = await rows(db, sql);
  }
  return result;
}

describe("upgrading a database that already has students", () => {
  let db: Db;
  let before005: Record<string, unknown[]>;
  const ids: Record<string, string> = {};

  before(async () => {
    db = await createDatabase({ through: "005" });

    // Mirrors the live project: an SRM student with a flat, a non-SRM test
    // account looking for one, and an account that never onboarded.
    ids.owner = await createUser(db, "owner@srmist.edu.in", { fullName: "Owner" });
    ids.hunter = await createUser(db, "hunter@gmail.com", { fullName: "Hunter" });
    ids.fresh = await createUser(db, "fresh@gmail.com");
    await db.query(
      `update public.profiles set mode = 'have_flat', avatar_url = 'https://x/owner.jpg',
         bio_prompts = '[{"question": "My cleaning style, honestly...", "answer": "Tidy"}]'
       where id = $1`,
      [ids.owner],
    );
    await db.query(
      `update public.profiles set mode = 'need_flat', preferred_societies = '{Abode Valley}',
         max_budget = 28000, move_in_timeframe = 'next_month'
       where id = $1`,
      [ids.hunter],
    );
    await db.query(
      `insert into public.listings (owner_id, society, bhk_type, rent_per_person, maintenance_per_person,
         deposit_per_person, amenities, photos)
       values ($1, 'Estancia', '3BHK', 12000, 1500, 25000, '{AC}', '{https://x/flat.jpg}')`,
      [ids.owner],
    );
    await db.query(
      `insert into public.swipes (sender_id, receiver_id, action, liked_target_type, liked_target_ref, comment)
       values ($1, $2, 'like', 'prompt', 'My cleaning style, honestly...', null),
              ($2, $1, 'like', 'listing', 'flat', 'Haha, same here!')`,
      [ids.hunter, ids.owner],
    );
    const [match] = await rows<{ id: string }>(db, "select id from public.matches");
    for (const [sender, content] of [
      [ids.owner, "Hey! When are you planning to move in?"],
      [ids.hunter, "Next month!"],
      [ids.owner, "Great"],
      [ids.hunter, "Can I visit this week?"],
    ]) {
      await db.query("insert into public.messages (match_id, sender_id, content) values ($1, $2, $3)", [
        match.id,
        sender,
        content,
      ]);
    }

    before005 = await snapshot(db);
    const applied = await applyMigrations(db, { after: "005" });
    assert.ok(applied.length >= 5, `applied ${applied.join(", ")}`);
  });

  it("keeps every account, profile, listing, like, match and message exactly as it was", async () => {
    assert.deepEqual(await snapshot(db), before005);
    assert.equal(before005.messages.length, 4);
    assert.equal(before005.matches.length, 1);
  });

  it("gives onboarded students a housing status matching their old mode", async () => {
    const statuses = await rows(db, "select profile_id, status from public.housing_status order by status");
    assert.deepEqual(statuses, [
      { profile_id: ids.owner, status: "has_accommodation" },
      { profile_id: ids.hunter, status: "needs_accommodation" },
    ]);
  });

  it("gives them discovery preferences that reproduce today's feed", async () => {
    const prefs = await rows(db, "select profile_id, discover_housing, seeking from public.discovery_preferences order by discover_housing");
    assert.deepEqual(prefs, [
      { profile_id: ids.hunter, discover_housing: "has_accommodation", seeking: "either" },
      { profile_id: ids.owner, discover_housing: "needs_accommodation", seeking: "either" },
    ]);
  });

  it("leaves students who never onboarded without a housing status", async () => {
    assert.equal((await rows(db, "select 1 from public.housing_status where profile_id = $1", [ids.fresh])).length, 0);
  });

  it("carries flat-hunting preferences into practical_preferences", async () => {
    const [prefs] = await rows(
      db,
      "select preferred_societies, budget_max, move_in_timeframe from public.practical_preferences where profile_id = $1",
      [ids.hunter],
    );
    assert.deepEqual(prefs, { preferred_societies: ["Abode Valley"], budget_max: 28000, move_in_timeframe: "next_month" });
    const [count] = await rows<{ n: number }>(db, "select count(*)::int as n from public.practical_preferences");
    assert.equal(count.n, 3);
  });

  it("carries the existing photo into profile_photos as the main photo", async () => {
    const photos = await rows(db, "select profile_id, url, position from public.profile_photos");
    assert.deepEqual(photos, [{ profile_id: ids.owner, url: "https://x/owner.jpg", position: 0 }]);
  });

  it("gives the existing listing safe defaults for the new fields", async () => {
    const [listing] = await rows(
      db,
      `select available_rooms, current_flatmates, preferred_flatmate_gender, description,
              available_from, updated_at = created_at as unchanged_since_creation
       from public.listings`,
    );
    assert.deepEqual(listing, {
      available_rooms: 1,
      current_flatmates: 0,
      preferred_flatmate_gender: "any",
      description: null,
      available_from: null,
      unchanged_since_creation: true,
    });
  });

  it("changes nothing when the new migrations run a second time", async () => {
    const tables = ["housing_status", "discovery_preferences", "practical_preferences", "profile_photos", "interests"];
    const read = async () =>
      Promise.all(tables.map((table) => rows(db, `select * from public.${table} order by 1, 2`)));
    const first = await read();
    await applyMigrations(db, { after: "005" });
    assert.deepEqual(await read(), first);
    assert.deepEqual(await snapshot(db), before005);
  });
});
