/**
 * Upgrading to migration 014 with listings and likes already in place (as
 * on the live project): live listings stay live, hidden ones become
 * deactivated (not drafts), and past listing likes are linked to the
 * listing they were about. Nothing else changes.
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { applyMigrations, createDatabase, createUser, onboard, rows, type Db } from "./harness.mts";

describe("upgrading listings to migration 014", () => {
  let db: Db;
  let live: string;
  let hidden: string;
  let owner: string;
  let hunter: string;
  let before014: unknown[];

  before(async () => {
    db = await createDatabase({ through: "013" });
    owner = await createUser(db, "owner@srmist.edu.in");
    hunter = await createUser(db, "hunter@srmist.edu.in");
    await onboard(db, owner, "have_flat", "Owner");
    await onboard(db, hunter, "need_flat", "Hunter");
    [{ id: hidden }] = await rows<{ id: string }>(
      db,
      "insert into public.listings (owner_id, society, bhk_type, rent_per_person, is_active) values ($1, 'Akshaya', '2BHK', 8000, false) returning id",
      [owner],
    );
    [{ id: live }] = await rows<{ id: string }>(
      db,
      "insert into public.listings (owner_id, society, bhk_type, rent_per_person, is_active) values ($1, 'Estancia', '3BHK', 11000, true) returning id",
      [owner],
    );
    await db.query(
      "insert into public.swipes (sender_id, receiver_id, action, liked_target_type, liked_target_ref, comment) values ($1, $2, 'like', 'listing', $3, 'Nice flat')",
      [hunter, owner, live],
    );
    await db.query("insert into public.swipes (sender_id, receiver_id, action) values ($1, $2, 'like')", [owner, hunter]);
    before014 = await rows(db, "select id, owner_id, society, rent_per_person, is_active, photos from public.listings order by id");
    await applyMigrations(db, { after: "013" });
  });

  it("keeps live listings live and turns hidden ones into deactivated, not drafts", async () => {
    const statuses = await rows<{ id: string; status: string; is_active: boolean }>(
      db,
      "select id, status, is_active from public.listings",
    );
    assert.deepEqual(
      statuses.find((row) => row.id === live),
      { id: live, status: "active", is_active: true },
    );
    assert.deepEqual(
      statuses.find((row) => row.id === hidden),
      { id: hidden, status: "inactive", is_active: false },
    );
  });

  it("changes nothing else about the listings, likes or matches", async () => {
    assert.deepEqual(
      await rows(db, "select id, owner_id, society, rent_per_person, is_active, photos from public.listings order by id"),
      before014,
    );
    const [like] = await rows<{ comment: string; liked_target_ref: string }>(
      db,
      "select comment, liked_target_ref from public.swipes where sender_id = $1",
      [hunter],
    );
    assert.deepEqual(like, { comment: "Nice flat", liked_target_ref: live });
    assert.equal((await rows(db, "select 1 from public.matches")).length, 1);
  });

  it("links a past listing like to its listing", async () => {
    const [like] = await rows<{ liked_listing_id: string }>(
      db,
      "select liked_listing_id from public.swipes where sender_id = $1",
      [hunter],
    );
    assert.equal(like.liked_listing_id, live);
  });

  it("is safe to run again, without turning new drafts into anything else", async () => {
    await db.query("set request.jwt.claim.sub = ''");
    const [{ id: draft }] = await rows<{ id: string }>(
      db,
      "insert into public.listings (owner_id, society, bhk_type, rent_per_person, is_active) values ($1, 'Green Pearl', '1BHK', 7000, false) returning id",
      [owner],
    );
    await db.query("update public.listings set status = 'draft' where id = $1", [draft]);
    await applyMigrations(db, { after: "013" });
    const [row] = await rows<{ status: string }>(db, "select status from public.listings where id = $1", [draft]);
    assert.equal(row.status, "draft");
  });
});
