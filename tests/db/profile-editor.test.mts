/**
 * The profile editor's database side (migration 012): the introduction,
 * photos, interests, lifestyle, practical preferences, housing and
 * discovery, and that each save leaves everything else alone.
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { affected, as, createDatabase, createUser, mediaUrl, onboard, rows, type Db } from "./harness.mts";

describe("profile editor", () => {
  let db: Db;
  let asha: string;
  let ravi: string;

  const photosOf = async (id: string) =>
    (await rows<{ url: string }>(db, "select url from public.profile_photos where profile_id = $1 order by position", [id])).map(
      (row) => row.url,
    );
  const avatarOf = async (id: string) =>
    (await rows<{ avatar_url: string | null }>(db, "select avatar_url from public.profiles where id = $1", [id]))[0].avatar_url;

  before(async () => {
    db = await createDatabase();
    asha = await createUser(db, "asha@srmist.edu.in");
    ravi = await createUser(db, "ravi@srmist.edu.in");
    await onboard(db, asha, "have_flat", "Asha");
    await onboard(db, ravi, "need_flat", "Ravi");
    await db.query(
      `update public.profiles set bio_prompts = '[{"question": "A random fact about me...", "answer": "I can juggle"}]' where id = $1`,
      [asha],
    );
  });

  describe("basic information", () => {
    it("saves a short introduction without touching anything else", async () => {
      const [before] = await rows(db, "select full_name, bio_prompts, mode from public.profiles where id = $1", [asha]);
      await as(db, asha, () =>
        db.query("update public.profiles set about = 'Night owl, tidy, loves filter coffee.' where id = $1", [asha]),
      );
      const [after] = await rows(db, "select full_name, bio_prompts, mode, about from public.profiles where id = $1", [asha]);
      assert.equal(after.about, "Night owl, tidy, loves filter coffee.");
      assert.deepEqual({ ...after, about: undefined }, { ...before, about: undefined });
    });

    it("rejects an introduction that's too long, and edits to someone else's profile", async () => {
      await as(db, asha, () =>
        assert.rejects(db.query("update public.profiles set about = $2 where id = $1", [asha, "x".repeat(301)]), /check constraint/),
      );
      await as(db, ravi, async () => {
        assert.equal(await affected(db, "update public.profiles set about = 'Hacked' where id = $1", [asha]), 0);
      });
    });

    it("lets students edit prompts, including removing all of them", async () => {
      const prompts = JSON.stringify([
        { question: "My social battery usually...", answer: "Recharges with chai" },
        { question: "A random fact about me...", answer: "I can juggle" },
      ]);
      await as(db, asha, () => db.query("update public.profiles set bio_prompts = $2::jsonb where id = $1", [asha, prompts]));
      await as(db, ravi, () => db.query("update public.profiles set bio_prompts = '[]' where id = $1", [ravi]));
      await as(db, asha, () =>
        assert.rejects(
          db.query("update public.profiles set bio_prompts = $2::jsonb where id = $1", [
            asha,
            JSON.stringify(Array.from({ length: 4 }, (_, n) => ({ question: `Q${n}`, answer: "A" }))),
          ]),
          /check constraint/,
        ),
      );
    });
  });

  describe("photos", () => {
    it("uploads to the student's own storage folder only", async () => {
      await as(db, asha, async () => {
        await db.query("insert into storage.objects (bucket_id, name) values ('roomie-media', $1)", [`${asha}/photo-1.jpg`]);
        await assert.rejects(
          db.query("insert into storage.objects (bucket_id, name) values ('roomie-media', $1)", [`${ravi}/photo-1.jpg`]),
          /row-level security/,
        );
      });
    });

    it("saves the set in order, with the first as the main photo", async () => {
      const set = [mediaUrl(asha, "photo-a.jpg"), mediaUrl(asha, "photo-b.jpg"), mediaUrl(asha, "photo-c.jpg")];
      await as(db, asha, () => db.query("select public.set_profile_photos($1)", [set]));
      assert.deepEqual(await photosOf(asha), set);
      assert.equal(await avatarOf(asha), set[0]);
    });

    it("reorders, and choosing another main photo updates the profile photo", async () => {
      const [a, b, c] = await photosOf(asha);
      await as(db, asha, () => db.query("select public.set_profile_photos($1)", [[c, a, b]]));
      assert.deepEqual(await photosOf(asha), [c, a, b]);
      assert.equal(await avatarOf(asha), c);
    });

    it("removes photos", async () => {
      const [c, , b] = await photosOf(asha);
      await as(db, asha, () => db.query("select public.set_profile_photos($1)", [[c, b]]));
      assert.deepEqual(await photosOf(asha), [c, b]);
    });

    it("allows six photos, never seven, and never the same photo twice", async () => {
      const six = Array.from({ length: 6 }, (_, n) => mediaUrl(asha, `photo-${n}.jpg`));
      await as(db, asha, async () => {
        await db.query("select public.set_profile_photos($1)", [six]);
        await assert.rejects(
          db.query("select public.set_profile_photos($1)", [[...six, mediaUrl(asha, "photo-7.jpg")]]),
          /up to 6 photos/,
        );
        await assert.rejects(
          db.query("select public.set_profile_photos($1)", [[six[0], six[0]]]),
          /only be added once/,
        );
      });
      // A failed save changes nothing.
      assert.deepEqual(await photosOf(asha), six);
    });

    it("refuses photos that aren't the student's own", async () => {
      await as(db, ravi, async () => {
        for (const url of [
          mediaUrl(asha, "photo-0.jpg"), // someone else's folder
          "https://evil.example.com/photo.jpg", // not our storage
          mediaUrl(ravi, ".."), // not a file name
          `${mediaUrl(ravi, "x")}/../../${asha}/photo-0.jpg`, // path tricks
        ]) {
          await assert.rejects(db.query("select public.set_profile_photos($1)", [[url]]), /isn't yours/, url);
        }
      });
      assert.equal((await photosOf(asha)).length, 6);
    });

    it("keeps an existing photo even when it isn't from the student's folder", async () => {
      // e.g. a photo set before the editor existed.
      await db.query("update public.profiles set avatar_url = '/seed/avatar-ravi.svg' where id = $1", [ravi]);
      await as(db, ravi, () =>
        db.query("select public.set_profile_photos($1)", [[mediaUrl(ravi, "photo-new.jpg"), "/seed/avatar-ravi.svg"]]),
      );
      assert.deepEqual(await photosOf(ravi), [mediaUrl(ravi, "photo-new.jpg"), "/seed/avatar-ravi.svg"]);
    });

    it("keeps listing photos completely separate", async () => {
      await db.query(
        "insert into public.listings (owner_id, society, bhk_type, rent_per_person, photos) values ($1, 'Akshaya', '2BHK', 9000, $2)",
        [asha, [mediaUrl(asha, "listing-1.jpg")]],
      );
      await as(db, asha, () => db.query("select public.set_profile_photos($1)", [[mediaUrl(asha, "photo-only.jpg")]]));
      const [listing] = await rows<{ photos: string[] }>(db, "select photos from public.listings where owner_id = $1", [asha]);
      assert.deepEqual(listing.photos, [mediaUrl(asha, "listing-1.jpg")]);
    });
  });

  describe("interests", () => {
    it("replace the selection in one go, ignoring duplicates", async () => {
      await as(db, asha, () => db.query("select public.set_profile_interests($1)", [["gym", "yoga", "gym", "coding"]]));
      const chosen = await rows<{ interest: string }>(db, "select interest from public.profile_interests where profile_id = $1 order by interest", [asha]);
      assert.deepEqual(chosen.map((row) => row.interest), ["coding", "gym", "yoga"]);

      await as(db, asha, () => db.query("select public.set_profile_interests($1)", [["chess"]]));
      const replaced = await rows(db, "select interest from public.profile_interests where profile_id = $1", [asha]);
      assert.deepEqual(replaced, [{ interest: "chess" }]);
    });

    it("leave the previous selection intact when a save is refused", async () => {
      await as(db, asha, async () => {
        await assert.rejects(db.query("select public.set_profile_interests($1)", [["chess", "not-a-thing"]]), /isn't on the list/);
        const all = (await rows<{ slug: string }>(db, "select slug from public.interests")).map((row) => row.slug);
        await assert.rejects(db.query("select public.set_profile_interests($1)", [all.slice(0, 11)]), /up to 10/);
      });
      const still = await rows(db, "select interest from public.profile_interests where profile_id = $1", [asha]);
      assert.deepEqual(still, [{ interest: "chess" }]);
    });

    it("only ever change the caller's own interests", async () => {
      await as(db, ravi, () => db.query("select public.set_profile_interests($1)", [["music"]]));
      const ashas = await rows(db, "select interest from public.profile_interests where profile_id = $1", [asha]);
      assert.deepEqual(ashas, [{ interest: "chess" }]);
    });
  });

  describe("lifestyle", () => {
    it("saves answers, the new options and the house wishes, and allows blanks", async () => {
      await as(db, asha, () =>
        db.query(
          `insert into public.lifestyle_preferences (profile_id, study_habits, cleaning_rota, guest_notice, smoking)
           values ($1, 'in_groups', true, true, null)`,
          [asha],
        ),
      );
      const [row] = await rows(db, "select study_habits, cleaning_rota, guest_notice, smoking, sleep_schedule from public.lifestyle_preferences where profile_id = $1", [asha]);
      assert.deepEqual(row, { study_habits: "in_groups", cleaning_rota: true, guest_notice: true, smoking: null, sleep_schedule: null });
      await as(db, asha, () =>
        assert.rejects(
          db.query("update public.lifestyle_preferences set smoking = 'sometimes' where profile_id = $1", [asha]),
          /check constraint/,
        ),
      );
    });
  });

  describe("practical preferences", () => {
    it("save the owner's choices and mirror the public ones onto the profile", async () => {
      await as(db, ravi, () =>
        db.query(
          `update public.practical_preferences
           set budget_min = 8000, budget_max = 14000, preferred_societies = '{Estancia,Akshaya}',
               move_in_timeframe = 'next_month', room_type = 'private', preferred_bhk_types = '{2BHK}',
               required_amenities = '{Wi-Fi}', flatmate_gender = 'any'
           where profile_id = $1`,
          [ravi],
        ),
      );
      const [profile] = await rows(db, "select preferred_societies, max_budget, move_in_timeframe from public.profiles where id = $1", [ravi]);
      assert.deepEqual(profile, { preferred_societies: ["Estancia", "Akshaya"], max_budget: 14000, move_in_timeframe: "next_month" });
    });

    it("reject a minimum above the maximum and unknown values", async () => {
      await as(db, ravi, async () => {
        await assert.rejects(
          db.query("update public.practical_preferences set budget_min = 20000 where profile_id = $1", [ravi]),
          /check constraint/,
        );
        await assert.rejects(
          db.query("update public.practical_preferences set room_type = 'penthouse' where profile_id = $1", [ravi]),
          /check constraint/,
        );
      });
    });
  });

  describe("housing and discovery", () => {
    it("change together, and never hide a listing unless asked", async () => {
      await db.query("update public.listings set is_active = true where owner_id = $1", [asha]);
      await as(db, asha, () =>
        db.query("select public.update_housing_and_discovery('needs_accommodation', 'both', 'group', false)"),
      );
      const [state] = await rows(
        db,
        `select h.status, d.discover_housing, d.seeking, p.mode,
                (select bool_or(is_active) from public.listings where owner_id = $1) as listing_live
         from public.housing_status h
         join public.discovery_preferences d using (profile_id)
         join public.profiles p on p.id = h.profile_id
         where h.profile_id = $1`,
        [asha],
      );
      assert.deepEqual(state, {
        status: "needs_accommodation",
        discover_housing: "both",
        seeking: "group",
        mode: "need_flat",
        listing_live: true,
      });
    });

    it("hide the student's live listing only when explicitly asked", async () => {
      await as(db, asha, () =>
        db.query("select public.update_housing_and_discovery('needs_accommodation', 'both', 'group', true)"),
      );
      const [listing] = await rows<{ is_active: boolean }>(db, "select is_active from public.listings where owner_id = $1", [asha]);
      assert.equal(listing.is_active, false);
    });

    it("save nothing when any value is invalid", async () => {
      await as(db, asha, () =>
        assert.rejects(
          db.query("select public.update_housing_and_discovery('has_accommodation', 'everyone', 'group', false)"),
          /check constraint/,
        ),
      );
      const [status] = await rows<{ status: string }>(db, "select status from public.housing_status where profile_id = $1", [asha]);
      assert.equal(status.status, "needs_accommodation");
    });

    it("work for a student setting them for the first time", async () => {
      const fresh = await createUser(db, "fresh@srmist.edu.in");
      await as(db, fresh, () =>
        db.query("select public.update_housing_and_discovery('needs_accommodation', 'has_accommodation', 'either', false)"),
      );
      const [prefs] = await rows(db, "select discover_housing, seeking from public.discovery_preferences where profile_id = $1", [fresh]);
      assert.deepEqual(prefs, { discover_housing: "has_accommodation", seeking: "either" });
    });
  });

  it("leaves matches and messages alone whatever the student edits", async () => {
    await db.query(
      "insert into public.swipes (sender_id, receiver_id, action) values ($1, $2, 'like'), ($2, $1, 'like')",
      [asha, ravi],
    );
    const [{ id: match }] = await rows<{ id: string }>(db, "select id from public.matches");
    await db.query("insert into public.messages (match_id, sender_id, content) values ($1, $2, 'Hi')", [match, asha]);
    await as(db, asha, async () => {
      await db.query("select public.update_housing_and_discovery('has_accommodation', 'needs_accommodation', 'flatmate', false)");
      await db.query("select public.set_profile_photos($1)", [[]]);
      await db.query("select public.set_profile_interests($1)", [[]]);
    });
    const [counts] = await rows(
      db,
      "select (select count(*)::int from public.matches) as matches, (select count(*)::int from public.messages) as messages",
    );
    assert.deepEqual(counts, { matches: 1, messages: 1 });
  });
});
