/**
 * The student and everything around them (migrations 007 and 008):
 * profile creation, housing status, discovery preferences, practical and
 * lifestyle preferences, photos and interests, plus who may change them.
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { affected, as, createDatabase, createUser, onboard, rows, type Db } from "./harness.mts";

describe("students: profile, housing status and preferences", () => {
  let db: Db;
  let asha: string;
  let ravi: string;

  before(async () => {
    db = await createDatabase();
    asha = await createUser(db, "asha@srmist.edu.in", { fullName: "Asha" });
    ravi = await createUser(db, "ravi@srmist.edu.in", { fullName: "Ravi" });
  });

  describe("profile creation", () => {
    it("creates the profile, and an empty practical-preferences row, at sign-up", async () => {
      const [profile] = await rows(db, "select full_name, mode from public.profiles where id = $1", [asha]);
      assert.deepEqual(profile, { full_name: "Asha", mode: null });
      const prefs = await rows(db, "select budget_max from public.practical_preferences where profile_id = $1", [asha]);
      assert.equal(prefs.length, 1);
    });

    it("has no housing status or discovery preferences until the student chooses", async () => {
      assert.equal((await rows(db, "select 1 from public.housing_status where profile_id = $1", [asha])).length, 0);
      assert.equal((await rows(db, "select 1 from public.discovery_preferences where profile_id = $1", [asha])).length, 0);
    });
  });

  describe("housing status", () => {
    it("lets a student set their own, and mirrors it to the legacy profiles.mode", async () => {
      await as(db, asha, () =>
        db.query("insert into public.housing_status (profile_id, status) values ($1, 'has_accommodation')", [asha]),
      );
      const [profile] = await rows<{ mode: string }>(db, "select mode from public.profiles where id = $1", [asha]);
      assert.equal(profile.mode, "have_flat");
    });

    it("gives first-time students discovery defaults that match today's feed", async () => {
      const [prefs] = await rows(db, "select discover_housing, seeking from public.discovery_preferences where profile_id = $1", [asha]);
      assert.deepEqual(prefs, { discover_housing: "needs_accommodation", seeking: "either" });
    });

    it("can be changed on its own, and the legacy mode follows", async () => {
      await as(db, asha, () =>
        db.query("update public.housing_status set status = 'needs_accommodation' where profile_id = $1", [asha]),
      );
      const [profile] = await rows<{ mode: string }>(db, "select mode from public.profiles where id = $1", [asha]);
      assert.equal(profile.mode, "need_flat");
    });

    it("follows the legacy column when the current onboarding form writes profiles.mode", async () => {
      await as(db, ravi, () => db.query("update public.profiles set mode = 'have_flat' where id = $1", [ravi]));
      const [status] = await rows<{ status: string }>(db, "select status from public.housing_status where profile_id = $1", [ravi]);
      assert.equal(status.status, "has_accommodation");
    });

    it("can't be set or changed for another student", async () => {
      await as(db, ravi, async () => {
        await assert.rejects(
          db.query("insert into public.housing_status (profile_id, status) values ($1, 'has_accommodation')", [asha]),
          /row-level security/,
        );
        assert.equal(
          await affected(db, "update public.housing_status set status = 'has_accommodation' where profile_id = $1", [asha]),
          0,
        );
      });
    });

    it("rejects unknown statuses", async () => {
      await as(db, asha, () =>
        assert.rejects(
          db.query("update public.housing_status set status = 'homeless' where profile_id = $1", [asha]),
          /check constraint/,
        ),
      );
    });
  });

  describe("discovery preferences", () => {
    it("can be changed at any time without touching the profile", async () => {
      const [before] = await rows<{ updated_at: string }>(db, "select updated_at from public.profiles where id = $1", [asha]);
      await as(db, asha, () =>
        db.query(
          "update public.discovery_preferences set discover_housing = 'both', seeking = 'group' where profile_id = $1",
          [asha],
        ),
      );
      const [prefs] = await rows(db, "select discover_housing, seeking from public.discovery_preferences where profile_id = $1", [asha]);
      assert.deepEqual(prefs, { discover_housing: "both", seeking: "group" });
      const [after] = await rows<{ updated_at: string }>(db, "select updated_at from public.profiles where id = $1", [asha]);
      assert.deepEqual(after.updated_at, before.updated_at);
    });

    it("are not overwritten when the housing status changes", async () => {
      await as(db, asha, () =>
        db.query("update public.housing_status set status = 'has_accommodation' where profile_id = $1", [asha]),
      );
      const [prefs] = await rows(db, "select discover_housing, seeking from public.discovery_preferences where profile_id = $1", [asha]);
      assert.deepEqual(prefs, { discover_housing: "both", seeking: "group" });
    });

    it("support every combination the product needs", async () => {
      for (const discover of ["has_accommodation", "needs_accommodation", "both"]) {
        for (const seeking of ["flatmate", "group", "either"]) {
          await as(db, asha, () =>
            db.query(
              "update public.discovery_preferences set discover_housing = $2, seeking = $3 where profile_id = $1",
              [asha, discover, seeking],
            ),
          );
        }
      }
    });

    it("can be created by a student who has no housing status yet", async () => {
      const newcomer = await createUser(db, "newcomer@srmist.edu.in");
      await as(db, newcomer, () =>
        db.query(
          "insert into public.discovery_preferences (profile_id, discover_housing, seeking) values ($1, 'both', 'flatmate')",
          [newcomer],
        ),
      );
    });

    it("can't be changed by another student, and reject unknown values", async () => {
      await as(db, ravi, async () => {
        assert.equal(
          await affected(db, "update public.discovery_preferences set seeking = 'flatmate' where profile_id = $1", [asha]),
          0,
        );
      });
      await as(db, asha, () =>
        assert.rejects(
          db.query("update public.discovery_preferences set seeking = 'anyone' where profile_id = $1", [asha]),
          /check constraint/,
        ),
      );
    });

    it("are readable by signed-in students but not by anonymous visitors", async () => {
      const seen = await as(db, ravi, () => rows(db, "select profile_id from public.discovery_preferences where profile_id = $1", [asha]));
      assert.equal(seen.length, 1);
      await as(db, null, () =>
        assert.rejects(db.query("select * from public.discovery_preferences"), /permission denied/),
      );
      await as(db, null, () => assert.rejects(db.query("select * from public.housing_status"), /permission denied/));
    });
  });

  describe("practical preferences", () => {
    it("write through to the legacy profile columns", async () => {
      await as(db, asha, () =>
        db.query(
          `update public.practical_preferences
           set budget_min = 8000, budget_max = 15000, preferred_societies = '{Estancia}',
               move_in_timeframe = 'next_month', room_type = 'private', flatmate_gender = 'female'
           where profile_id = $1`,
          [asha],
        ),
      );
      const [profile] = await rows(db, "select preferred_societies, max_budget, move_in_timeframe from public.profiles where id = $1", [asha]);
      assert.deepEqual(profile, { preferred_societies: ["Estancia"], max_budget: 15000, move_in_timeframe: "next_month" });
    });

    it("follow the legacy columns, clearing a minimum that would sit above a new maximum", async () => {
      await as(db, asha, () =>
        db.query("update public.profiles set max_budget = 7000, preferred_societies = '{Akshaya}' where id = $1", [asha]),
      );
      const [prefs] = await rows(db, "select budget_min, budget_max, preferred_societies from public.practical_preferences where profile_id = $1", [asha]);
      assert.deepEqual(prefs, { budget_min: null, budget_max: 7000, preferred_societies: ["Akshaya"] });
    });

    it("reject an impossible budget range and unknown societies", async () => {
      await as(db, asha, async () => {
        await assert.rejects(
          db.query("update public.practical_preferences set budget_min = 20000, budget_max = 10000 where profile_id = $1", [asha]),
          /check constraint/,
        );
        await assert.rejects(
          db.query("update public.practical_preferences set preferred_societies = '{Atlantis}' where profile_id = $1", [asha]),
          /check constraint/,
        );
      });
    });

    it("can't be changed by another student", async () => {
      await as(db, ravi, async () => {
        assert.equal(await affected(db, "update public.practical_preferences set budget_max = 50000 where profile_id = $1", [asha]), 0);
      });
    });
  });

  describe("lifestyle preferences", () => {
    it("are kept separately and readable by other students", async () => {
      await as(db, asha, () =>
        db.query(
          `insert into public.lifestyle_preferences
             (profile_id, sleep_schedule, cleanliness, social_life, study_habits, guests,
              noise_tolerance, smoking, food_habits, personality)
           values ($1, 'early_bird', 'very_tidy', 'balanced', 'library', 'rarely',
                   'low', 'non_smoker', 'vegetarian', 'introvert')`,
          [asha],
        ),
      );
      const seen = await as(db, ravi, () => rows(db, "select sleep_schedule from public.lifestyle_preferences where profile_id = $1", [asha]));
      assert.deepEqual(seen, [{ sleep_schedule: "early_bird" }]);
    });

    it("reject unknown values and writes for other students", async () => {
      await as(db, asha, () =>
        assert.rejects(
          db.query("update public.lifestyle_preferences set smoking = 'chain' where profile_id = $1", [asha]),
          /check constraint/,
        ),
      );
      await as(db, ravi, async () => {
        await assert.rejects(
          db.query("insert into public.lifestyle_preferences (profile_id, smoking) values ($1, 'smoker')", [asha]),
          /row-level security/,
        );
        assert.equal(await affected(db, "update public.lifestyle_preferences set smoking = 'smoker' where profile_id = $1", [asha]), 0);
      });
    });
  });

  // Photos and interests change only through set_profile_photos() and
  // set_profile_interests() since 012; tests/db/profile-editor.test.mts
  // covers them in depth.
  describe("photos", () => {
    const photo = (id: string, name: string) =>
      `https://example.supabase.co/storage/v1/object/public/roomie-media/${id}/${name}.jpg`;

    it("keep the main photo and the legacy avatar_url in step, both ways", async () => {
      await as(db, ravi, () => db.query("select public.set_profile_photos($1)", [[photo(ravi, "one")]]));
      let [profile] = await rows<{ avatar_url: string | null }>(db, "select avatar_url from public.profiles where id = $1", [ravi]);
      assert.equal(profile.avatar_url, photo(ravi, "one"));

      // The onboarding form still writes avatar_url directly.
      await as(db, ravi, () => db.query("update public.profiles set avatar_url = $2 where id = $1", [ravi, photo(ravi, "two")]));
      const [main] = await rows<{ url: string }>(db, "select url from public.profile_photos where profile_id = $1 and position = 0", [ravi]);
      assert.equal(main.url, photo(ravi, "two"));

      await as(db, ravi, () => db.query("select public.set_profile_photos($1)", [[]]));
      [profile] = await rows<{ avatar_url: string | null }>(db, "select avatar_url from public.profiles where id = $1", [ravi]);
      assert.equal(profile.avatar_url, null);
    });

    it("can't be written directly, for yourself or anyone else", async () => {
      await as(db, ravi, async () => {
        await assert.rejects(
          db.query("insert into public.profile_photos (profile_id, url, position) values ($1, $2, 1)", [ravi, photo(ravi, "x")]),
          /permission denied/,
        );
        await assert.rejects(db.query("delete from public.profile_photos where profile_id = $1", [asha]), /permission denied/);
      });
    });
  });

  describe("interests", () => {
    it("come from the catalogue, up to ten per student", async () => {
      const catalogue = await as(db, asha, () => rows<{ slug: string }>(db, "select slug from public.interests order by slug"));
      assert.ok(catalogue.length >= 11);
      await as(db, asha, async () => {
        await db.query("select public.set_profile_interests($1)", [catalogue.slice(0, 10).map((row) => row.slug)]);
        await assert.rejects(
          db.query("select public.set_profile_interests($1)", [catalogue.slice(0, 11).map((row) => row.slug)]),
          /up to 10 interests/,
        );
        await assert.rejects(
          db.query("select public.set_profile_interests($1)", [["underwater-basket-weaving"]]),
          /isn't on the list/,
        );
        await assert.rejects(
          db.query("insert into public.profile_interests (profile_id, interest) values ($1, 'gym')", [asha]),
          /permission denied/,
        );
      });
      const [count] = await rows<{ n: number }>(db, "select count(*)::int as n from public.profile_interests where profile_id = $1", [asha]);
      assert.equal(count.n, 10);
    });

    it("can't be added to the catalogue by students", async () => {
      await as(db, asha, () =>
        assert.rejects(db.query("insert into public.interests (slug, label) values ('hacking', 'Hacking')"), /permission denied/),
      );
    });
  });

  describe("protected profile fields (unchanged from 001)", () => {
    it("still can't be changed by the student", async () => {
      await onboard(db, ravi, "need_flat", "Ravi");
      await as(db, ravi, async () => {
        await assert.rejects(db.query("update public.profiles set is_srm_verified = false where id = $1", [ravi]), /permission denied/);
        await assert.rejects(db.query("update public.profiles set email = 'x@srmist.edu.in' where id = $1", [ravi]), /permission denied/);
      });
    });
  });
});
