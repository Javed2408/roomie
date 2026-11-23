/**
 * Accommodation listings (migrations 009 and 014): the lifecycle (draft,
 * live, deactivated), the one-live-listing rule, owner-only changes,
 * photos, the private address and listing-specific likes.
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

import { affected, as, createDatabase, createLegacyUser, createUser, mediaUrl, onboard, rows, type Db } from "./harness.mts";

const NEW_LISTING = `
  insert into public.listings
    (owner_id, society, bhk_type, vacant_spots, rent_per_person, maintenance_per_person,
     deposit_per_person, amenities, description, available_rooms, current_flatmates,
     available_from, preferred_flatmate_gender, flatmate_preferences, locality, room_type,
     furnishing, house_rules, living_arrangement)
  values ($1, 'Abode Valley', '3BHK', 1, 11500, 1500, 25000, '{AC,Wi-Fi}',
          'Sunny 3BHK near the Arch gate.', 1, 2, '2026-12-01', 'any', 'Non-smokers please',
          'Near the Arch gate', 'private', 'semi_furnished', 'No smoking indoors', 'Two quiet seniors')
  returning id`;

describe("listings", () => {
  let db: Db;
  let owner: string;
  let hunter: string;
  let stranger: string;

  const create = async (user = owner) => (await as(db, user, () => rows<{ id: string }>(db, NEW_LISTING, [user])))[0].id;
  const statusOf = async (id: string) =>
    (await rows<{ status: string; is_active: boolean }>(db, "select status, is_active from public.listings where id = $1", [id]))[0];
  const setStatus = (user: string, id: string, status: string, replace: string | null = null) =>
    as(db, user, async () =>
      (await rows<{ result: string }>(db, "select public.set_listing_status($1, $2, $3) as result", [id, status, replace]))[0].result,
    );

  before(async () => {
    db = await createDatabase();
    owner = await createUser(db, "owner@srmist.edu.in");
    hunter = await createUser(db, "hunter@srmist.edu.in");
    stranger = await createUser(db, "stranger@srmist.edu.in");
    await onboard(db, owner, "have_flat", "Owner");
    await onboard(db, hunter, "need_flat", "Hunter");
  });

  beforeEach(async () => {
    await db.query("delete from public.swipes");
    await db.query("delete from public.listings");
    await db.query("update public.housing_status set status = 'has_accommodation' where profile_id = $1", [owner]);
  });

  describe("lifecycle", () => {
    it("creates a new listing as a private draft with all its details", async () => {
      const id = await create();
      assert.deepEqual(await statusOf(id), { status: "draft", is_active: false });
      const [listing] = await rows(
        db,
        "select available_rooms, current_flatmates, room_type, furnishing, locality from public.listings where id = $1",
        [id],
      );
      assert.deepEqual(listing, {
        available_rooms: 1,
        current_flatmates: 2,
        room_type: "private",
        furnishing: "semi_furnished",
        locality: "Near the Arch gate",
      });
      assert.equal((await as(db, hunter, () => rows(db, "select 1 from public.listings where id = $1", [id]))).length, 0);
    });

    it("can't be published by writing is_active or status directly", async () => {
      const id = await create();
      await as(db, owner, async () => {
        await assert.rejects(db.query("update public.listings set is_active = true where id = $1", [id]), /permission denied/);
        await assert.rejects(db.query("update public.listings set status = 'active' where id = $1", [id]), /permission denied/);
        await assert.rejects(
          db.query("insert into public.listings (owner_id, society, bhk_type, rent_per_person, is_active) values ($1, 'Estancia', '2BHK', 9000, true)", [owner]),
          /permission denied/,
        );
      });
    });

    it("publishes, deactivates and reactivates through set_listing_status", async () => {
      const id = await create();
      assert.equal(await setStatus(owner, id, "active"), "active");
      assert.deepEqual(await statusOf(id), { status: "active", is_active: true });
      assert.equal((await as(db, hunter, () => rows(db, "select 1 from public.listings where id = $1", [id]))).length, 1);

      assert.equal(await setStatus(owner, id, "inactive"), "inactive");
      assert.deepEqual(await statusOf(id), { status: "inactive", is_active: false });
      assert.equal((await as(db, hunter, () => rows(db, "select 1 from public.listings where id = $1", [id]))).length, 0);

      assert.equal(await setStatus(owner, id, "active"), "active");
    });

    it("can't deactivate a draft that was never published", async () => {
      const id = await create();
      await assert.rejects(setStatus(owner, id, "inactive"), /hasn't been published/);
    });

    it("saves edits without changing the status, and updates updated_at", async () => {
      const id = await create();
      await setStatus(owner, id, "active");
      const [before] = await rows<{ updated_at: Date }>(db, "select updated_at from public.listings where id = $1", [id]);
      await as(db, owner, () => db.query("update public.listings set rent_per_person = 12000, house_rules = 'Quiet after 11' where id = $1", [id]));
      const [after] = await rows<{ rent_per_person: number; status: string; updated_at: Date }>(
        db,
        "select rent_per_person, status, updated_at from public.listings where id = $1",
        [id],
      );
      assert.equal(after.rent_per_person, 12000);
      assert.equal(after.status, "active");
      assert.ok(after.updated_at >= before.updated_at);
    });

    it("deletes a listing but keeps the likes and matches that came from it", async () => {
      const id = await create();
      await setStatus(owner, id, "active");
      await as(db, hunter, () =>
        db.query(
          "insert into public.swipes (sender_id, receiver_id, action, liked_target_type, liked_target_ref, liked_listing_id) values ($1, $2, 'like', 'listing', $3::text, $3::uuid)",
          [hunter, owner, id],
        ),
      );
      await as(db, owner, () => db.query("insert into public.swipes (sender_id, receiver_id, action) values ($1, $2, 'like')", [owner, hunter]));
      await as(db, owner, async () => {
        assert.equal(await affected(db, "delete from public.listings where id = $1", [id]), 1);
      });
      const [like] = await rows<{ liked_listing_id: string | null; liked_target_ref: string }>(
        db,
        "select liked_listing_id, liked_target_ref from public.swipes where sender_id = $1",
        [hunter],
      );
      assert.equal(like.liked_listing_id, null, "the like stays but no longer points anywhere");
      assert.equal(like.liked_target_ref, id);
      assert.equal((await rows(db, "select 1 from public.matches where $1 in (user_a, user_b)", [owner])).length, 1);
      await db.query("delete from public.matches");
    });
  });

  describe("one live listing at a time", () => {
    it("allows several listings, and refuses to publish a second without a choice", async () => {
      const first = await create();
      const second = await create();
      await setStatus(owner, first, "active");
      assert.equal(await setStatus(owner, second, "active"), "conflict");
      assert.deepEqual(await statusOf(first), { status: "active", is_active: true }, "nothing changed silently");
      assert.deepEqual(await statusOf(second), { status: "draft", is_active: false });
    });

    it("swaps the live listing only when the student names the one to deactivate", async () => {
      const first = await create();
      const second = await create();
      await setStatus(owner, first, "active");
      assert.equal(await setStatus(owner, second, "active", second), "conflict", "naming the wrong listing changes nothing");
      assert.equal(await setStatus(owner, second, "active", first), "active");
      assert.deepEqual(await statusOf(first), { status: "inactive", is_active: false });
      assert.deepEqual(await statusOf(second), { status: "active", is_active: true });
    });

    it("is enforced by the database even outside the function", async () => {
      const first = await create();
      const second = await create();
      await setStatus(owner, first, "active");
      await assert.rejects(
        db.query("update public.listings set status = 'active' where id = $1", [second]),
        /listings_one_active_per_owner|duplicate key/,
      );
    });

    it("caps a student at ten listings", async () => {
      for (let n = 0; n < 10; n += 1) {
        await create();
      }
      await as(db, owner, () => assert.rejects(db.query(NEW_LISTING, [owner]), /up to 10 listings/));
    });
  });

  describe("who may do what", () => {
    it("only lets students with a place create or publish, but anyone can deactivate their own", async () => {
      const id = await create();
      await setStatus(owner, id, "active");
      await as(db, hunter, () => assert.rejects(db.query(NEW_LISTING, [hunter]), /row-level security/));
      await as(db, stranger, () => assert.rejects(db.query(NEW_LISTING, [stranger]), /row-level security/));

      await db.query("update public.housing_status set status = 'needs_accommodation' where profile_id = $1", [owner]);
      assert.equal(await setStatus(owner, id, "inactive"), "inactive");
      await assert.rejects(setStatus(owner, id, "active"), /I have a place/);
    });

    it("never lets anyone else edit, publish, delete or take over a listing", async () => {
      const id = await create();
      await as(db, hunter, async () => {
        assert.equal(await affected(db, "update public.listings set rent_per_person = 1 where id = $1", [id]), 0);
        assert.equal(await affected(db, "delete from public.listings where id = $1", [id]), 0);
      });
      await assert.rejects(setStatus(hunter, id, "active"), /isn't yours/);
      await as(db, owner, async () => {
        await assert.rejects(db.query("update public.listings set owner_id = $2 where id = $1", [id, hunter]), /permission denied/);
        await assert.rejects(db.query("update public.listings set created_at = now() where id = $1", [id]), /permission denied/);
      });
      await as(db, hunter, () => assert.rejects(db.query(NEW_LISTING, [owner]), /row-level security/));
    });

    it("refuses non-SRM accounts, even with a place", async () => {
      const legacy = await createLegacyUser(db, "flatowner@gmail.com");
      await onboard(db, legacy, "have_flat", "Legacy");
      const [row] = await rows<{ id: string }>(
        db,
        "insert into public.listings (owner_id, society, bhk_type, rent_per_person) values ($1, 'Estancia', '2BHK', 9000) returning id",
        [legacy],
      );
      await assert.rejects(setStatus(legacy, row.id, "active"), /Only SRM students/);
      await as(db, legacy, async () => {
        assert.equal(await affected(db, "update public.listings set rent_per_person = 1 where id = $1", [row.id]), 0);
      });
    });

    it("validates new details in the database too", async () => {
      const id = await create();
      await as(db, owner, async () => {
        await assert.rejects(db.query("update public.listings set rent_per_person = -5 where id = $1", [id]), /check constraint/);
        await assert.rejects(db.query("update public.listings set deposit_per_person = -1 where id = $1", [id]), /check constraint/);
        await assert.rejects(db.query("update public.listings set society = 'Atlantis' where id = $1", [id]), /check constraint/);
        await assert.rejects(db.query("update public.listings set amenities = '{Pool}' where id = $1", [id]), /check constraint/);
        await assert.rejects(db.query("update public.listings set furnishing = 'palatial' where id = $1", [id]), /check constraint/);
      });
    });
  });

  describe("photos", () => {
    it("accepts the owner's own flat uploads, in order, and reordering them", async () => {
      const id = await create();
      const photos = [mediaUrl(owner, "listing-1.jpg"), mediaUrl(owner, "listing-2.jpg")];
      await as(db, owner, () => db.query("update public.listings set photos = $2 where id = $1", [id, photos]));
      await as(db, owner, () => db.query("update public.listings set photos = $2 where id = $1", [id, [...photos].reverse()]));
      const [row] = await rows<{ photos: string[] }>(db, "select photos from public.listings where id = $1", [id]);
      assert.deepEqual(row.photos, [...photos].reverse(), "the first is the cover");
      await as(db, owner, () => db.query("update public.listings set photos = $2 where id = $1", [id, [photos[1]]]));
    });

    it("refuses someone else's files, profile photos, repeats and too many", async () => {
      const id = await create();
      const attempts: Array<[string[], RegExp]> = [
        [[mediaUrl(hunter, "listing-1.jpg")], /your own uploads/],
        [[mediaUrl(owner, "photo-1.jpg")], /your own uploads/],
        [["https://evil.example/listing-1.jpg"], /your own uploads/],
        [[mediaUrl(owner, "listing-1.jpg"), mediaUrl(owner, "listing-1.jpg")], /twice/],
        [Array.from({ length: 9 }, (_, n) => mediaUrl(owner, `listing-${n}.jpg`)), /up to 8/],
      ];
      for (const [photos, error] of attempts) {
        await as(db, owner, () =>
          assert.rejects(db.query("update public.listings set photos = $2 where id = $1", [id, photos]), error),
        );
      }
    });

    it("keeps each listing's photos to itself", async () => {
      const first = await create();
      const second = await create();
      await as(db, owner, async () => {
        await db.query("update public.listings set photos = $2 where id = $1", [first, [mediaUrl(owner, "listing-a.jpg")]]);
        await db.query("update public.listings set photos = $2 where id = $1", [second, [mediaUrl(owner, "listing-b.jpg")]]);
        await db.query("update public.listings set photos = '{}' where id = $1", [first]);
      });
      const [row] = await rows<{ photos: string[] }>(db, "select photos from public.listings where id = $1", [second]);
      assert.deepEqual(row.photos, [mediaUrl(owner, "listing-b.jpg")]);
    });
  });

  describe("private address", () => {
    it("is readable and editable by the owner only", async () => {
      const id = await create();
      await setStatus(owner, id, "active");
      await as(db, owner, () =>
        db.query("insert into public.listing_private_details (listing_id, address) values ($1, 'Tower B, flat 402')", [id]),
      );
      const mine = await as(db, owner, () => rows<{ address: string }>(db, "select address from public.listing_private_details where listing_id = $1", [id]));
      assert.equal(mine[0].address, "Tower B, flat 402");
      await as(db, hunter, async () => {
        assert.equal((await rows(db, "select * from public.listing_private_details")).length, 0);
        assert.equal(await affected(db, "update public.listing_private_details set address = 'x' where listing_id = $1", [id]), 0);
        await assert.rejects(
          db.query("insert into public.listing_private_details (listing_id, address) values ($1, 'Fake')", [id]),
          /row-level security|duplicate key/,
        );
      });
      const listing = await as(db, hunter, () => rows<Record<string, unknown>>(db, "select * from public.listings where id = $1", [id]));
      assert.ok(!JSON.stringify(listing).includes("402"), "the public listing never carries the address");
    });

    it("goes when the listing is deleted", async () => {
      const id = await create();
      await as(db, owner, () => db.query("insert into public.listing_private_details (listing_id, address) values ($1, 'Flat 9')", [id]));
      await as(db, owner, () => db.query("delete from public.listings where id = $1", [id]));
      assert.equal((await rows(db, "select 1 from public.listing_private_details where listing_id = $1", [id])).length, 0);
    });
  });

  describe("listing likes", () => {
    it("records which listing a like was about", async () => {
      const id = await create();
      await setStatus(owner, id, "active");
      await as(db, hunter, () =>
        db.query(
          "insert into public.swipes (sender_id, receiver_id, action, liked_target_type, liked_target_ref, liked_listing_id, comment) values ($1, $2, 'like', 'listing', $3::text, $3::uuid, 'Love the balcony')",
          [hunter, owner, id],
        ),
      );
      const [like] = await rows<{ liked_listing_id: string }>(db, "select liked_listing_id from public.swipes where sender_id = $1", [hunter]);
      assert.equal(like.liked_listing_id, id);
    });

    it("works out the listing for older clients that only sent the reference", async () => {
      const id = await create();
      await setStatus(owner, id, "active");
      await as(db, hunter, () =>
        db.query("insert into public.swipes (sender_id, receiver_id, action, liked_target_type, liked_target_ref) values ($1, $2, 'like', 'photo', 'listing-photo-1')", [hunter, owner]),
      );
      const [like] = await rows<{ liked_listing_id: string }>(db, "select liked_listing_id from public.swipes where sender_id = $1", [hunter]);
      assert.equal(like.liked_listing_id, id);
    });

    it("refuses a like on a draft, a deactivated listing or someone else's listing", async () => {
      const draft = await create();
      const like = (listing: string, receiver = owner) =>
        as(db, hunter, () =>
          db.query(
            "insert into public.swipes (sender_id, receiver_id, action, liked_target_type, liked_target_ref, liked_listing_id) values ($1, $2, 'like', 'listing', $3::text, $3::uuid)",
            [hunter, receiver, listing],
          ),
        );
      await assert.rejects(like(draft), /isn't available/);
      await setStatus(owner, draft, "active");
      await assert.rejects(like(draft, stranger), /isn't available/, "the listing must belong to the person liked");
      await setStatus(owner, draft, "inactive");
      await assert.rejects(like(draft), /isn't available/);
      await as(db, hunter, () =>
        assert.rejects(
          db.query("insert into public.swipes (sender_id, receiver_id, action, liked_listing_id) values ($1, $2, 'pass', $3)", [hunter, owner, draft]),
          /check constraint|isn't available/,
        ),
      );
    });

    it("keeps one decision per person, so liking twice isn't possible", async () => {
      const id = await create();
      await setStatus(owner, id, "active");
      const insert = () =>
        as(db, hunter, () =>
          db.query(
            "insert into public.swipes (sender_id, receiver_id, action, liked_target_type, liked_target_ref, liked_listing_id) values ($1, $2, 'like', 'listing', $3::text, $3::uuid)",
            [hunter, owner, id],
          ),
        );
      await insert();
      await assert.rejects(insert(), /duplicate key/);
    });

    it("still makes exactly one match from two likes", async () => {
      const id = await create();
      await setStatus(owner, id, "active");
      await as(db, hunter, () =>
        db.query(
          "insert into public.swipes (sender_id, receiver_id, action, liked_target_type, liked_target_ref, liked_listing_id, comment) values ($1, $2, 'like', 'listing', $3::text, $3::uuid, 'Can I visit?')",
          [hunter, owner, id],
        ),
      );
      await as(db, owner, () => db.query("insert into public.swipes (sender_id, receiver_id, action) values ($1, $2, 'like')", [owner, hunter]));
      const matches = await rows<{ initial_comment: string }>(db, "select initial_comment from public.matches where $1 in (user_a, user_b)", [owner]);
      assert.equal(matches.length, 1);
      assert.equal(matches[0].initial_comment, "Can I visit?");
      await db.query("delete from public.matches");
    });
  });
});
