/**
 * What the current app does today must keep working after 006-010:
 * onboarding writes, likes becoming matches, chat permissions, the
 * latest-message view, and the media bucket rules.
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { affected, as, createDatabase, createUser, rows, type Db } from "./harness.mts";

describe("backward compatibility with the current app", () => {
  let db: Db;
  let owner: string;
  let hunter: string;
  let outsider: string;
  let matchId: string;
  let listingId: string;

  before(async () => {
    db = await createDatabase();
    owner = await createUser(db, "owner@srmist.edu.in");
    hunter = await createUser(db, "hunter@srmist.edu.in");
    outsider = await createUser(db, "outsider@srmist.edu.in");
  });

  it("accepts the onboarding form's profile update, then its listing", async () => {
    // What saveOnboarding() sends for a student with a flat.
    await as(db, owner, async () => {
      await db.query(
        `update public.profiles
         set mode = 'have_flat', full_name = 'Owner', gender = 'female', year_of_study = 3,
             department = 'CSE', avatar_url = 'https://x/owner.jpg',
             bio_prompts = '[{"question": "Before an 8 AM class, I''m...", "answer": "Up early"}]',
             preferred_societies = '{}', max_budget = null, move_in_timeframe = null
         where id = $1`,
        [owner],
      );
      // Since 014 the listing is saved, then published through
      // set_listing_status (students can't write is_active).
      const [created] = await rows<{ id: string }>(
        db,
        `insert into public.listings (owner_id, society, bhk_type, vacant_spots, rent_per_person,
           maintenance_per_person, deposit_per_person, setup_cost, amenities, photos)
         values ($1, 'Abode Valley', '3BHK', 1, 11500, 1500, 25000, 0, '{AC}', '{}')
         returning id`,
        [owner],
      );
      listingId = created.id;
      await db.query("select public.set_listing_status($1, 'active')", [listingId]);
    });
    // And for a student looking for one.
    await as(db, hunter, () =>
      db.query(
        `update public.profiles
         set mode = 'need_flat', full_name = 'Hunter', gender = 'male', year_of_study = 2,
             department = 'ECE', preferred_societies = '{Abode Valley}', max_budget = 15000,
             move_in_timeframe = 'immediate'
         where id = $1`,
        [hunter],
      ),
    );
    const [profile] = await rows(db, "select mode, max_budget from public.profiles where id = $1", [hunter]);
    assert.deepEqual(profile, { mode: "need_flat", max_budget: 15000 });
  });

  it("still feeds Discover by mode: hunters see live listings from owners", async () => {
    const owners = await as(db, hunter, () =>
      rows(db, "select id from public.profiles where mode = 'have_flat' and full_name is not null"),
    );
    assert.deepEqual(owners, [{ id: owner }]);
    const listings = await as(db, hunter, () => rows(db, "select owner_id from public.listings where is_active"));
    assert.deepEqual(listings, [{ owner_id: owner }]);
  });

  it("still turns two likes into exactly one match (the trigger from 001)", async () => {
    await as(db, hunter, () =>
      db.query(
        // The app sends the listing id as the reference (014 checks it).
        "insert into public.swipes (sender_id, receiver_id, action, liked_target_type, liked_target_ref, comment) values ($1, $2, 'like', 'listing', $3, 'Is Wi-Fi included?')",
        [hunter, owner, listingId],
      ),
    );
    await as(db, owner, () =>
      db.query("insert into public.swipes (sender_id, receiver_id, action) values ($1, $2, 'like')", [owner, hunter]),
    );
    const matches = await rows<{ id: string; initial_comment: string }>(db, "select id, initial_comment from public.matches");
    assert.equal(matches.length, 1);
    assert.equal(matches[0].initial_comment, "Is Wi-Fi included?");
    matchId = matches[0].id;
  });

  it("still lets only the two matched students read and send messages", async () => {
    await as(db, owner, () =>
      db.query("insert into public.messages (id, match_id, sender_id, content) values (gen_random_uuid(), $1, $2, 'Hi!')", [matchId, owner]),
    );
    const seen = await as(db, hunter, () => rows(db, "select content from public.messages where match_id = $1", [matchId]));
    assert.deepEqual(seen, [{ content: "Hi!" }]);

    await as(db, outsider, async () => {
      assert.equal((await rows(db, "select 1 from public.messages")).length, 0);
      await assert.rejects(
        db.query("insert into public.messages (match_id, sender_id, content) values ($1, $2, 'Intruding')", [matchId, outsider]),
        /row-level security/,
      );
    });
    // Nobody can backdate a message (004).
    await as(db, owner, () =>
      assert.rejects(
        db.query("insert into public.messages (match_id, sender_id, content, created_at) values ($1, $2, 'Old', '2020-01-01')", [matchId, owner]),
        /permission denied/,
      ),
    );
  });

  it("still serves the latest message per match to its members", async () => {
    const latest = await as(db, hunter, () => rows(db, "select content from public.latest_messages where match_id = $1", [matchId]));
    assert.deepEqual(latest, [{ content: "Hi!" }]);
  });

  it("still keeps likes private to the people involved", async () => {
    const outsiderSees = await as(db, outsider, () => rows(db, "select 1 from public.swipes"));
    assert.equal(outsiderSees.length, 0);
    // Decisions are final: nobody can delete likes, not even their own.
    await as(db, hunter, () => assert.rejects(db.query("delete from public.swipes"), /permission denied/));
    await as(db, outsider, async () => {
      assert.equal(await affected(db, "update public.profiles set full_name = 'Hacked' where id = $1", [hunter]), 0);
    });
  });

  it("still deactivates a listing when the student switches to looking for a flat", async () => {
    await as(db, owner, async () => {
      await db.query("update public.profiles set mode = 'need_flat' where id = $1", [owner]);
      await db.query("select public.set_listing_status($1, 'inactive')", [listingId]);
    });
    const [status] = await rows<{ status: string }>(db, "select status from public.housing_status where profile_id = $1", [owner]);
    assert.equal(status.status, "needs_accommodation");
    const [listing] = await rows<{ status: string }>(db, "select status from public.listings where id = $1", [listingId]);
    assert.equal(listing.status, "inactive");
  });

  it("still restricts media uploads to the student's own folder", async () => {
    const own = `${owner}/avatar-1.jpg`;
    const other = `${hunter}/avatar-1.jpg`;
    await as(db, owner, async () => {
      await db.query("insert into storage.objects (bucket_id, name) values ('roomie-media', $1)", [own]);
      await assert.rejects(
        db.query("insert into storage.objects (bucket_id, name) values ('roomie-media', $1)", [other]),
        /row-level security/,
      );
    });
  });
});
