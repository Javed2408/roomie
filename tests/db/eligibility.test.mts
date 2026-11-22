/**
 * SRM-only eligibility (migration 006) and the badge rules from 001.
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { isSrmEmail } from "../../src/lib/eligibility.ts";
import { createDatabase, createUser, rows, type Db } from "./harness.mts";

const SEED = { roomie_seed: true };

describe("SRM email eligibility", () => {
  let db: Db;
  before(async () => {
    db = await createDatabase();
  });

  it("lets an @srmist.edu.in address register and creates its profile", async () => {
    const id = await createUser(db, "ab1234@srmist.edu.in");
    const [profile] = await rows<{ email: string; is_srm_verified: boolean }>(
      db,
      "select email, is_srm_verified from public.profiles where id = $1",
      [id],
    );
    assert.equal(profile.email, "ab1234@srmist.edu.in");
    assert.equal(profile.is_srm_verified, true);
  });

  it("accepts SRM addresses in any letter case", async () => {
    await createUser(db, "MixedCase@SRMIST.EDU.IN");
  });

  for (const email of [
    "someone@gmail.com",
    "student@srmist.edu.in.example.com",
    "student@student.srmist.edu.in",
    "srmist.edu.in@gmail.com",
  ]) {
    it(`refuses to register ${email}`, async () => {
      await assert.rejects(createUser(db, email), /only for SRM students/);
    });
  }

  it("still requires a confirmed email before the Verified SRM Student badge", async () => {
    const id = await createUser(db, "pending@srmist.edu.in", { confirmed: false });
    const verified = async () =>
      (await rows<{ v: boolean }>(db, "select is_srm_verified as v from public.profiles where id = $1", [id]))[0].v;
    assert.equal(await verified(), false);

    await db.query("update auth.users set email_confirmed_at = now() where id = $1", [id]);
    assert.equal(await verified(), true);
  });

  it("refuses to change an account's email to a non-SRM address", async () => {
    const id = await createUser(db, "changer@srmist.edu.in");
    await assert.rejects(
      db.query("update auth.users set email = 'changer@gmail.com' where id = $1", [id]),
      /@srmist\.edu\.in/,
    );
    await assert.rejects(
      db.query("update auth.users set email_change = 'changer@gmail.com' where id = $1", [id]),
      /@srmist\.edu\.in/,
    );
    // Moving to another SRM address is fine.
    await db.query("update auth.users set email = 'changer2@srmist.edu.in' where id = $1", [id]);
  });

  it("allows sample students only with the service-role flag and the seed domain", async () => {
    await createUser(db, "aarav.sharma@seed.roomie.test", { appMetadata: SEED });
    await assert.rejects(createUser(db, "fake@seed.roomie.test"), /only for SRM students/);
    await assert.rejects(createUser(db, "fake@gmail.com", { appMetadata: SEED }), /only for SRM students/);
  });

  it("lets existing non-SRM accounts keep working (only sign-up and email changes are checked)", async () => {
    // An account from before migration 006, inserted with the check bypassed.
    await db.exec("alter table auth.users disable trigger before_auth_user_created_srm_only");
    const legacy = await createUser(db, "legacy@gmail.com");
    await db.exec("alter table auth.users enable trigger before_auth_user_created_srm_only");

    // Signing in updates other columns; that must keep working.
    await db.query("update auth.users set updated_at = now() where id = $1", [legacy]);
    const [profile] = await rows<{ is_srm_verified: boolean }>(
      db,
      "select is_srm_verified from public.profiles where id = $1",
      [legacy],
    );
    assert.equal(profile.is_srm_verified, false);
  });

  it("matches the app's isSrmEmail() for the same addresses", async () => {
    const samples = [
      "ab1234@srmist.edu.in",
      "AB1234@SRMIST.EDU.IN",
      "someone@gmail.com",
      "student@srmist.edu.in.example.com",
      "student@student.srmist.edu.in",
      "srmist.edu.in@gmail.com",
    ];
    for (const email of samples) {
      const [{ ok }] = await rows<{ ok: boolean }>(db, "select public.is_srm_email($1) as ok", [email]);
      assert.equal(isSrmEmail(email), ok, email);
    }
  });
});
