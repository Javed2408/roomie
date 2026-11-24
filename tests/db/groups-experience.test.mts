/**
 * The group experience (migration 015) on top of 010/011: richer group
 * details, messages, cancelling invitations, blocks, searching for people
 * to invite, discovering groups, and the audit log and notifications.
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

import { affected, as, createDatabase, createLegacyUser, createUser, mediaUrl, onboard, rows, type Db } from "./harness.mts";

describe("group experience", () => {
  let db: Db;
  let asha: string; // admin
  let ravi: string; // member
  let meera: string;
  let kiran: string;
  let unconfirmed: string;
  let gmail: string;
  let groupId: string;

  function rpc<T = Record<string, unknown>>(user: string, sql: string, params: unknown[] = []) {
    return as(db, user, () => rows<T>(db, sql, params));
  }
  const statusOf = async (profile: string, group = groupId) =>
    (await rows<{ status: string }>(db, "select status from public.group_members where group_id = $1 and profile_id = $2", [group, profile]))[0]?.status ?? null;
  const notificationsFor = (user: string) =>
    rpc<{ kind: string; group_name: string; detail: string | null; actor_id: string | null; subject_id: string | null }>(
      user,
      "select e.kind, e.group_name, e.detail, e.actor_id, e.subject_id from public.notifications n join public.group_events e on e.id = n.event_id order by n.created_at, e.kind",
    );
  const newGroup = async (owner: string, extra = "") =>
    (await rpc<{ id: string }>(owner, `insert into public.groups (name, created_by${extra ? ", " + extra.split("=")[0] : ""}) values ('Night owls', $1${extra ? ", " + extra.split("=")[1] : ""}) returning id`, [owner]))[0].id;

  before(async () => {
    db = await createDatabase();
    asha = await createUser(db, "asha@srmist.edu.in");
    ravi = await createUser(db, "ravi@srmist.edu.in");
    meera = await createUser(db, "meera@srmist.edu.in");
    kiran = await createUser(db, "kiran@srmist.edu.in");
    unconfirmed = await createUser(db, "uma@srmist.edu.in", { confirmed: false });
    gmail = await createLegacyUser(db, "gita@gmail.com");
    await onboard(db, asha, "need_flat", "Asha Rao");
    await onboard(db, ravi, "need_flat", "Ravi Kumar");
    await onboard(db, meera, "need_flat", "Meera Iyer");
    await onboard(db, kiran, "have_flat", "Kiran Das");
    await onboard(db, unconfirmed, "need_flat", "Uma Nair");
    await onboard(db, gmail, "need_flat", "Gita Menon");
  });

  beforeEach(async () => {
    await db.query("delete from public.blocks");
    await db.query("delete from public.groups");
    groupId = await newGroup(asha);
  });

  describe("creating groups", () => {
    it("stores the new details, and the creator becomes admin", async () => {
      const [id] = await rpc<{ id: string }>(
        asha,
        `insert into public.groups (name, created_by, budget_min, budget_max, housing_status, room_preference, lifestyle_notes, is_discoverable)
         values ('Quiet 3BHK', $1, 6000, 12000, 'needs_accommodation', 'private', 'Quiet after 11', false) returning id`,
        [asha],
      );
      const [group] = await rows(db, "select budget_min, budget_max, housing_status, room_preference, lifestyle_notes, is_discoverable, status from public.groups where id = $1", [id.id]);
      assert.deepEqual(group, {
        budget_min: 6000,
        budget_max: 12000,
        housing_status: "needs_accommodation",
        room_preference: "private",
        lifestyle_notes: "Quiet after 11",
        is_discoverable: false,
        status: "forming",
      });
      const [member] = await rows(db, "select role, status from public.group_members where group_id = $1", [id.id]);
      assert.deepEqual(member, { role: "admin", status: "active" });
    });

    it("rejects invalid details in the database too", async () => {
      const bad = [
        "budget_min, budget_max) values ('X Group', $1, 15000, 10000",
        "housing_status) values ('X Group', $1, 'mansion'",
        "room_preference) values ('X Group', $1, 'tent'",
        "max_members) values ('X Group', $1, 11",
        "preferred_societies) values ('X Group', $1, '{Atlantis}'",
      ];
      for (const columns of bad) {
        await as(db, asha, () =>
          assert.rejects(db.query(`insert into public.groups (name, created_by, ${columns}) returning id`, [asha]), /check constraint/),
        );
      }
      await as(db, asha, () =>
        assert.rejects(db.query("insert into public.groups (name, created_by) values (' ', $1)", [asha]), /check constraint/),
      );
    });

    it("only accepts the uploader's own group photos", async () => {
      await rpc(asha, "update public.groups set avatar_url = $2 where id = $1", [groupId, mediaUrl(asha, "group-1.jpg")]);
      for (const url of [mediaUrl(ravi, "group-1.jpg"), mediaUrl(asha, "photo-1.jpg"), "https://evil.example/group-1.jpg"]) {
        await as(db, asha, () =>
          assert.rejects(db.query("update public.groups set avatar_url = $2 where id = $1", [groupId, url]), /your own uploads/),
        );
      }
    });

    it("can't be created or edited by non-SRM accounts or non-admins", async () => {
      for (const user of [gmail, unconfirmed]) {
        await as(db, user, () =>
          assert.rejects(db.query("insert into public.groups (name, created_by) values ('Mine', $1)", [user]), /row-level security/),
        );
      }
      await as(db, ravi, async () => {
        assert.equal(await affected(db, "update public.groups set name = 'Hijacked' where id = $1", [groupId]), 0);
      });
    });
  });

  describe("invitations", () => {
    it("carries an optional message to the invitee, and duplicates change nothing", async () => {
      assert.deepEqual(await rpc(asha, "select public.invite_to_group($1, $2, 'Join our night owls!') as s", [groupId, ravi]), [{ s: "invited" }]);
      assert.deepEqual(await rpc(asha, "select public.invite_to_group($1, $2, 'Again?') as s", [groupId, ravi]), [{ s: "invited" }]);
      const [row] = await rows(db, "select message from public.group_members where group_id = $1 and profile_id = $2", [groupId, ravi]);
      assert.equal(row.message, "Join our night owls!");
      const mine = await notificationsFor(ravi);
      assert.equal(mine.length, 1, "no duplicate notification");
      assert.equal(mine[0].kind, "invited");
      assert.equal(mine[0].detail, "Join our night owls!");
    });

    it("lets only the invitee answer it", async () => {
      await rpc(asha, "select public.invite_to_group($1, $2)", [groupId, ravi]);
      await as(db, meera, () => assert.rejects(db.query("select public.respond_to_group_invite($1, true)", [groupId]), /no invitation/));
      assert.equal(await statusOf(ravi), "invited");
      await rpc(ravi, "select public.respond_to_group_invite($1, false)", [groupId]);
      assert.equal(await statusOf(ravi), "declined");
    });

    it("can be cancelled by an admin, without banning the student", async () => {
      await rpc(asha, "select public.invite_to_group($1, $2)", [groupId, ravi]);
      await as(db, ravi, () => assert.rejects(db.query("select public.cancel_group_invite($1, $2)", [groupId, ravi]), /Only a group admin/));
      assert.deepEqual(await rpc(asha, "select public.cancel_group_invite($1, $2) as s", [groupId, ravi]), [{ s: "cancelled" }]);
      await as(db, ravi, () => assert.rejects(db.query("select public.respond_to_group_invite($1, true)", [groupId]), /no invitation/));
      assert.deepEqual(await rpc(asha, "select public.invite_to_group($1, $2) as s", [groupId, ravi]), [{ s: "invited" }], "can be invited again");
      await as(db, asha, () => assert.rejects(db.query("select public.cancel_group_invite($1, $2)", [groupId, meera]), /no open invitation/));
    });

    it("refuses non-SRM, unconfirmed and too-long messages", async () => {
      for (const user of [gmail, unconfirmed]) {
        await as(db, asha, () => assert.rejects(db.query("select public.invite_to_group($1, $2)", [groupId, user]), /verified SRM/));
      }
      await as(db, asha, () =>
        assert.rejects(db.query("select public.invite_to_group($1, $2, $3)", [groupId, ravi, "x".repeat(301)]), /300 characters/),
      );
    });
  });

  describe("join requests", () => {
    it("carry an introduction, are answered by admins only, and notify the right people", async () => {
      assert.deepEqual(await rpc(meera, "select public.request_to_join_group($1, 'Hi! Tidy CSE student') as s", [groupId]), [{ s: "requested" }]);
      assert.deepEqual(await rpc(meera, "select public.request_to_join_group($1) as s", [groupId]), [{ s: "requested" }], "no duplicate request");
      const toAdmin = await notificationsFor(asha);
      assert.deepEqual(toAdmin.map((item) => [item.kind, item.detail]), [["requested", "Hi! Tidy CSE student"]]);

      await as(db, ravi, () => assert.rejects(db.query("select public.review_join_request($1, $2, true)", [groupId, meera]), /Only a group admin/));
      await rpc(asha, "select public.review_join_request($1, $2, true)", [groupId, meera]);
      assert.equal(await statusOf(meera), "active");
      assert.deepEqual((await notificationsFor(meera)).map((item) => item.kind), ["request_approved"]);
    });

    it("checks capacity when approving, not only when asking", async () => {
      await rpc(asha, "update public.groups set max_members = 2 where id = $1", [groupId]);
      await rpc(meera, "select public.request_to_join_group($1)", [groupId]);
      await rpc(ravi, "select public.request_to_join_group($1)", [groupId]);
      await rpc(asha, "select public.review_join_request($1, $2, true)", [groupId, meera]);
      await as(db, asha, () => assert.rejects(db.query("select public.review_join_request($1, $2, true)", [groupId, ravi]), /full/));
      assert.equal(await statusOf(ravi), "requested");
    });

    it("can be withdrawn by the student, and declined requests notify them", async () => {
      await rpc(meera, "select public.request_to_join_group($1)", [groupId]);
      await rpc(meera, "select public.leave_group($1)", [groupId]);
      assert.equal(await statusOf(meera), "left");
      await rpc(ravi, "select public.request_to_join_group($1)", [groupId]);
      await rpc(asha, "select public.review_join_request($1, $2, false)", [groupId, ravi]);
      assert.deepEqual((await notificationsFor(ravi)).map((item) => item.kind), ["request_declined"]);
    });

    it("are refused for private groups and non-SRM accounts", async () => {
      await rpc(asha, "update public.groups set is_discoverable = false where id = $1", [groupId]);
      await as(db, meera, () => assert.rejects(db.query("select public.request_to_join_group($1)", [groupId]), /invite-only|isn't available/));
      await as(db, gmail, () => assert.rejects(db.query("select public.request_to_join_group($1)", [groupId]), /verified SRM/));
    });
  });

  describe("blocks", () => {
    it("stop invitations and requests across a block, either way, without saying why", async () => {
      await rpc(ravi, "insert into public.blocks (blocker_id, blocked_id) values ($1, $2)", [ravi, asha]);
      await as(db, asha, () => assert.rejects(db.query("select public.invite_to_group($1, $2)", [groupId, ravi]), /can't be invited/));
      await as(db, ravi, () => assert.rejects(db.query("select public.request_to_join_group($1)", [groupId]), /isn't available/));
    });

    it("count any active member, not just the admin", async () => {
      await rpc(asha, "select public.invite_to_group($1, $2)", [groupId, ravi]);
      await rpc(ravi, "select public.respond_to_group_invite($1, true)", [groupId]);
      await rpc(meera, "insert into public.blocks (blocker_id, blocked_id) values ($1, $2)", [meera, ravi]);
      await as(db, meera, () => assert.rejects(db.query("select public.request_to_join_group($1)", [groupId]), /isn't available/));
      await as(db, asha, () => assert.rejects(db.query("select public.invite_to_group($1, $2)", [groupId, meera]), /can't be invited/));
    });

    it("hide each other from invite search and group discovery", async () => {
      await rpc(kiran, "insert into public.blocks (blocker_id, blocked_id) values ($1, $2)", [kiran, asha]);
      const found = await rpc<{ profile_id: string }>(asha, "select profile_id from public.search_students_for_group($1, 'kiran')", [groupId]);
      assert.equal(found.length, 0);
      const groups = await rpc<{ group_id: string }>(kiran, "select group_id from public.discover_groups()");
      assert.ok(!groups.some((row) => row.group_id === groupId));
      assert.ok((await rpc<{ group_id: string }>(meera, "select group_id from public.discover_groups()")).some((row) => row.group_id === groupId));
    });
  });

  describe("searching for students to invite", () => {
    it("finds eligible students by name, never yourself or ineligible accounts, with their standing", async () => {
      await rpc(asha, "select public.invite_to_group($1, $2)", [groupId, ravi]);
      const results = await rpc<{ full_name: string; membership: string | null }>(asha, "select full_name, membership from public.search_students_for_group($1, 'a')", [groupId]);
      assert.equal(results.length, 0, "needs at least two letters");
      const found = await rpc<{ full_name: string; membership: string | null }>(asha, "select full_name, membership from public.search_students_for_group($1, 'ra')", [groupId]);
      const names = found.map((row) => row.full_name);
      assert.ok(names.includes("Ravi Kumar"));
      assert.ok(!names.includes("Asha Rao"), "never yourself");
      assert.equal(found.find((row) => row.full_name === "Ravi Kumar")?.membership, "invited");
      const everyone = await rpc<{ full_name: string }>(asha, "select full_name from public.search_students_for_group($1, 'n')", [groupId]);
      assert.equal(everyone.length, 0);
      const nair = await rpc<{ full_name: string }>(asha, "select full_name from public.search_students_for_group($1, 'Nair')", [groupId]);
      assert.equal(nair.length, 0, "unconfirmed accounts aren't offered");
      const menon = await rpc<{ full_name: string }>(asha, "select full_name from public.search_students_for_group($1, 'Menon')", [groupId]);
      assert.equal(menon.length, 0, "non-SRM accounts aren't offered");
    });

    it("is for admins only, and treats wildcards literally", async () => {
      await as(db, ravi, () => assert.rejects(db.query("select * from public.search_students_for_group($1, 'ra')", [groupId]), /Only a group admin/));
      assert.equal((await rpc(asha, "select * from public.search_students_for_group($1, '%%')", [groupId])).length, 0);
    });
  });

  describe("discovering groups", () => {
    it("lists discoverable groups with member counts, never private ones", async () => {
      const hidden = await newGroup(kiran);
      await rpc(kiran, "update public.groups set is_discoverable = false where id = $1", [hidden]);
      const listed = await rpc<{ group_id: string; member_count: number; my_status: string | null }>(meera, "select * from public.discover_groups()");
      assert.deepEqual(listed.find((row) => row.group_id === groupId), { group_id: groupId, member_count: 1, my_status: null });
      assert.ok(!listed.some((row) => row.group_id === hidden));
      await as(db, meera, async () => assert.equal((await rows(db, "select 1 from public.groups where id = $1", [hidden])).length, 0));
    });

    it("filters without excluding groups that haven't said", async () => {
      await rpc(asha, "update public.groups set preferred_societies = '{Estancia}', budget_min = 6000, budget_max = 9000, move_in_timeframe = 'july', max_members = 4, housing_status = 'needs_accommodation' where id = $1", [groupId]);
      const silent = await newGroup(kiran);
      const ids = async (filters: Record<string, unknown>) =>
        (await rpc<{ group_id: string }>(meera, "select group_id from public.discover_groups($1::jsonb)", [JSON.stringify(filters)])).map((row) => row.group_id);

      assert.deepEqual(new Set(await ids({ societies: ["Estancia"] })), new Set([groupId, silent]));
      assert.deepEqual(await ids({ societies: ["Akshaya"] }), [silent]);
      assert.deepEqual(await ids({ budget_max: 5000 }), [silent], "group starts at 6000");
      assert.ok((await ids({ budget_max: 7000 })).includes(groupId));
      assert.deepEqual(await ids({ move_in: "next_month" }), [silent]);
      assert.deepEqual(new Set(await ids({ sizes: [4] })), new Set([groupId, silent]));
      assert.deepEqual(await ids({ sizes: [6] }), []);
      assert.deepEqual(await ids({ housing: "has_accommodation" }), [silent]);
    });

    it("can hide full groups, and refuses ineligible callers", async () => {
      await rpc(asha, "update public.groups set max_members = 2 where id = $1", [groupId]);
      await rpc(asha, "select public.invite_to_group($1, $2)", [groupId, ravi]);
      await rpc(ravi, "select public.respond_to_group_invite($1, true)", [groupId]);
      assert.ok(!(await rpc<{ group_id: string }>(meera, "select group_id from public.discover_groups('{\"has_room\": true}')")).some((row) => row.group_id === groupId));
      await as(db, gmail, () => assert.rejects(db.query("select * from public.discover_groups()"), /SRM students/));
      await as(db, null, () => assert.rejects(db.query("select * from public.discover_groups()"), /permission denied/));
    });
  });

  describe("membership changes and notifications", () => {
    beforeEach(async () => {
      await rpc(asha, "select public.invite_to_group($1, $2)", [groupId, ravi]);
      await rpc(ravi, "select public.respond_to_group_invite($1, true)", [groupId]);
    });

    it("tells admins when an invitation is accepted or a member leaves", async () => {
      await rpc(ravi, "select public.leave_group($1)", [groupId]);
      assert.deepEqual((await notificationsFor(asha)).map((item) => item.kind), ["invite_accepted", "member_left"]);
    });

    it("tells a removed member, and keeps their profile", async () => {
      await rpc(asha, "select public.remove_group_member($1, $2)", [groupId, ravi]);
      assert.ok((await notificationsFor(ravi)).some((item) => item.kind === "member_removed"));
      assert.equal((await rows(db, "select 1 from public.profiles where id = $1", [ravi])).length, 1);
    });

    it("tells a member when their role changes, including taking over from a leaving admin", async () => {
      await rpc(asha, "select public.set_group_member_role($1, $2, 'admin')", [groupId, ravi]);
      await rpc(asha, "select public.set_group_member_role($1, $2, 'member')", [groupId, ravi]);
      await rpc(asha, "select public.leave_group($1)", [groupId]);
      const roles = (await notificationsFor(ravi)).filter((item) => item.kind === "role_changed").map((item) => item.detail);
      assert.deepEqual(roles, ["admin", "member", "admin"]);
      const [admin] = await rows(db, "select profile_id from public.group_members where group_id = $1 and role = 'admin'", [groupId]);
      assert.equal(admin.profile_id, ravi, "the group always keeps an admin");
    });

    it("never notifies the person who acted", async () => {
      await rpc(asha, "select public.set_group_member_role($1, $2, 'admin')", [groupId, ravi]);
      assert.ok(!(await notificationsFor(asha)).some((item) => item.kind === "role_changed"));
    });

    it("keeps notifications private, read-only except for marking them read", async () => {
      assert.equal((await notificationsFor(meera)).length, 0);
      await as(db, meera, async () => {
        assert.equal(await affected(db, "update public.notifications set read_at = now()"), 0);
        await assert.rejects(
          db.query("insert into public.notifications (recipient_id, event_id) select $1, id from public.group_events limit 1", [meera]),
          /permission denied/,
        );
        await assert.rejects(db.query("insert into public.group_events (group_id, group_name, kind) values ($1, 'x', 'created')", [groupId]), /permission denied/);
      });
      await as(db, asha, async () => {
        assert.ok((await affected(db, "update public.notifications set read_at = now() where read_at is null")) > 0);
        await assert.rejects(db.query("update public.notifications set recipient_id = $1", [meera]), /permission denied/);
      });
    });

    it("keeps an audit log for admins and the people involved, not outsiders", async () => {
      const forAdmin = await rpc<{ kind: string }>(asha, "select kind from public.group_events where group_id = $1 order by created_at", [groupId]);
      assert.deepEqual(forAdmin.map((row) => row.kind), ["created", "invited", "invite_accepted"]);
      assert.equal((await rpc(meera, "select 1 from public.group_events where group_id = $1", [groupId])).length, 0);
    });

    it("stops direct writes to memberships", async () => {
      await as(db, meera, () =>
        assert.rejects(
          db.query("insert into public.group_members (group_id, profile_id, role, status) values ($1, $2, 'member', 'active')", [groupId, meera]),
          /permission denied/,
        ),
      );
    });
  });
});
