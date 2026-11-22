/**
 * Accommodation listings (migration 009): independent of the profile,
 * several per student with one live, and owner-only changes.
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { affected, as, createDatabase, createUser, onboard, rows, type Db } from "./harness.mts";

const NEW_LISTING = `
  insert into public.listings
    (owner_id, society, bhk_type, vacant_spots, rent_per_person, maintenance_per_person,
     deposit_per_person, amenities, description, available_rooms, current_flatmates,
     available_from, preferred_flatmate_gender, flatmate_preferences, is_active)
  values ($1, 'Abode Valley', '3BHK', 1, 11500, 1500, 25000, '{AC,Wi-Fi}',
          'Sunny 3BHK near the Arch gate.', 1, 2, '2026-12-01', 'any', 'Non-smokers please', $2)
  returning id`;

describe("listings", () => {
  let db: Db;
  let owner: string;
  let hunter: string;
  let stranger: string;
  let listingId: string;

  before(async () => {
    db = await createDatabase();
    owner = await createUser(db, "owner@srmist.edu.in");
    hunter = await createUser(db, "hunter@srmist.edu.in");
    stranger = await createUser(db, "stranger@srmist.edu.in");
    await onboard(db, owner, "have_flat", "Owner");
    await onboard(db, hunter, "need_flat", "Hunter");
  });

  it("can be created with all the new details by a student who has accommodation", async () => {
    const [row] = await as(db, owner, () => rows<{ id: string }>(db, NEW_LISTING, [owner, true]));
    listingId = row.id;
    const [listing] = await rows(
      db,
      "select available_rooms, current_flatmates, preferred_flatmate_gender, description from public.listings where id = $1",
      [listingId],
    );
    assert.deepEqual(listing, {
      available_rooms: 1,
      current_flatmates: 2,
      preferred_flatmate_gender: "any",
      description: "Sunny 3BHK near the Arch gate.",
    });
  });

  it("can't be created by a student who needs accommodation or hasn't said", async () => {
    await as(db, hunter, () => assert.rejects(db.query(NEW_LISTING, [hunter, true]), /row-level security/));
    await as(db, stranger, () => assert.rejects(db.query(NEW_LISTING, [stranger, true]), /row-level security/));
  });

  it("can't be created for someone else", async () => {
    await as(db, hunter, () => assert.rejects(db.query(NEW_LISTING, [owner, false]), /row-level security/));
  });

  it("can be edited by its owner, which updates updated_at", async () => {
    const [before] = await rows<{ updated_at: Date }>(db, "select updated_at from public.listings where id = $1", [listingId]);
    await as(db, owner, () => db.query("update public.listings set rent_per_person = 12000 where id = $1", [listingId]));
    const [after] = await rows<{ rent_per_person: number; updated_at: Date }>(
      db,
      "select rent_per_person, updated_at from public.listings where id = $1",
      [listingId],
    );
    assert.equal(after.rent_per_person, 12000);
    assert.ok(after.updated_at >= before.updated_at);
  });

  it("can't be edited by anyone else", async () => {
    await as(db, hunter, async () => {
      assert.equal(await affected(db, "update public.listings set rent_per_person = 1 where id = $1", [listingId]), 0);
      assert.equal(await affected(db, "delete from public.listings where id = $1", [listingId]), 0);
    });
  });

  it("can be deactivated without touching the owner's profile", async () => {
    const [before] = await rows(db, "select * from public.profiles where id = $1", [owner]);
    await as(db, owner, () => db.query("update public.listings set is_active = false where id = $1", [listingId]));
    const [after] = await rows(db, "select * from public.profiles where id = $1", [owner]);
    assert.deepEqual(after, before);
    // Hidden from others, still visible to the owner.
    assert.equal((await as(db, hunter, () => rows(db, "select 1 from public.listings where id = $1", [listingId]))).length, 0);
    assert.equal((await as(db, owner, () => rows(db, "select 1 from public.listings where id = $1", [listingId]))).length, 1);
  });

  it("allows several listings per owner, but only one live at a time", async () => {
    await as(db, owner, async () => {
      await db.query(NEW_LISTING, [owner, true]); // a second listing, live
      await db.query(NEW_LISTING, [owner, false]); // a third, as a draft
      await assert.rejects(db.query(NEW_LISTING, [owner, true]), /listings_one_active_per_owner|duplicate key/);
      // Reactivating the first while another is live is refused too.
      await assert.rejects(
        db.query("update public.listings set is_active = true where id = $1", [listingId]),
        /listings_one_active_per_owner|duplicate key/,
      );
    });
    const [count] = await rows<{ n: number }>(db, "select count(*)::int as n from public.listings where owner_id = $1", [owner]);
    assert.equal(count.n, 3);
  });

  it("can't go live again once the owner needs accommodation, but can still be hidden", async () => {
    await as(db, owner, async () => {
      await db.query("update public.housing_status set status = 'needs_accommodation' where profile_id = $1", [owner]);
      await db.query("update public.listings set is_active = false where owner_id = $1", [owner]);
      await assert.rejects(
        db.query("update public.listings set is_active = true where id = $1", [listingId]),
        /row-level security/,
      );
      await db.query("update public.housing_status set status = 'has_accommodation' where profile_id = $1", [owner]);
      await db.query("update public.listings set is_active = true where id = $1", [listingId]);
    });
  });

  it("protects ids, owners and timestamps from direct writes", async () => {
    await as(db, owner, async () => {
      await assert.rejects(db.query("update public.listings set owner_id = $2 where id = $1", [listingId, hunter]), /permission denied/);
      await assert.rejects(db.query("update public.listings set created_at = now() where id = $1", [listingId]), /permission denied/);
    });
  });

  it("caps a student at ten listings", async () => {
    await as(db, owner, async () => {
      for (let n = 3; n < 10; n += 1) {
        await db.query(NEW_LISTING, [owner, false]);
      }
      await assert.rejects(db.query(NEW_LISTING, [owner, false]), /up to 10 listings/);
    });
  });

  it("are not required: a student with accommodation can have none", async () => {
    const solo = await createUser(db, "solo@srmist.edu.in");
    await onboard(db, solo, "have_flat", "Solo");
    const [status] = await rows<{ status: string }>(db, "select status from public.housing_status where profile_id = $1", [solo]);
    assert.equal(status.status, "has_accommodation");
    assert.equal((await rows(db, "select 1 from public.listings where owner_id = $1", [solo])).length, 0);
  });
});
