/**
 * Group foundations (migration 010): creation, the membership flows and
 * their authorization, capacity, leaving, and who can see what.
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { affected, as, createDatabase, createUser, rows, type Db } from "./harness.mts";

async function createGroup(db: Db, creator: string, extra = ""): Promise<string> {
  const [group] = await as(db, creator, () =>
    rows<{ id: string }>(
      db,
      `insert into public.groups (name, created_by, max_members${extra ? ", is_discoverable" : ""})
       values ('Abode Valley trio', $1, 3${extra ? `, ${extra}` : ""})
       returning id`,
      [creator],
    ),
  );
  return group.id;
}

async function membership(db: Db, group: string, profile: string) {
  const [row] = await rows<{ status: string; role: string }>(
    db,
    "select status, role from public.group_members where group_id = $1 and profile_id = $2",
    [group, profile],
  );
  return row ?? null;
}

const call = (db: Db, user: string, sql: string, params: unknown[]) =>
  as(db, user, async () => (await rows<Record<string, string>>(db, sql, params))[0]);

describe("groups", () => {
  let db: Db;
  let admin: string;
  let asha: string;
  let ravi: string;
  let meera: string;
  let outsider: string;
  let legacy: string;
  let group: string;

  before(async () => {
    db = await createDatabase();
    admin = await createUser(db, "admin@srmist.edu.in");
    asha = await createUser(db, "asha@srmist.edu.in");
    ravi = await createUser(db, "ravi@srmist.edu.in");
    meera = await createUser(db, "meera@srmist.edu.in");
    outsider = await createUser(db, "outsider@srmist.edu.in");
    // A pre-006 account that isn't SRM-verified.
    await db.exec("alter table auth.users disable trigger before_auth_user_created_srm_only");
    legacy = await createUser(db, "legacy@gmail.com");
    await db.exec("alter table auth.users enable trigger before_auth_user_created_srm_only");
  });

  describe("creation", () => {
    it("makes the creator the group's first admin", async () => {
      group = await createGroup(db, admin);
      assert.deepEqual(await membership(db, group, admin), { status: "active", role: "admin" });
      const [row] = await rows(db, "select status, is_discoverable from public.groups where id = $1", [group]);
      assert.deepEqual(row, { status: "forming", is_discoverable: true });
    });

    it("works for private (invite-only) groups too", async () => {
      const privateGroup = await createGroup(db, admin, "false");
      assert.deepEqual(await membership(db, privateGroup, admin), { status: "active", role: "admin" });
    });

    it("can't be done on someone else's behalf, or by an unverified account", async () => {
      await as(db, asha, () =>
        assert.rejects(
          db.query("insert into public.groups (name, created_by) values ('Fake', $1)", [admin]),
          /row-level security/,
        ),
      );
      await as(db, legacy, () =>
        assert.rejects(
          db.query("insert into public.groups (name, created_by) values ('Nope', $1)", [legacy]),
          /row-level security/,
        ),
      );
    });
  });

  describe("membership authorization", () => {
    it("never lets anyone write memberships directly, not even their own", async () => {
      await as(db, asha, async () => {
        await assert.rejects(
          db.query(
            "insert into public.group_members (group_id, profile_id, role, status, joined_at) values ($1, $2, 'admin', 'active', now())",
            [group, asha],
          ),
          /permission denied/,
        );
        await assert.rejects(
          db.query("update public.group_members set role = 'member' where group_id = $1", [group]),
          /permission denied/,
        );
      });
    });

    it("turns a join request into membership only when an admin approves", async () => {
      assert.equal((await call(db, asha, "select public.request_to_join_group($1) as s", [group])).s, "requested");
      assert.deepEqual(await membership(db, group, asha), { status: "requested", role: "member" });

      // A non-member, and the requester themselves, can't approve.
      for (const who of [outsider, asha]) {
        await as(db, who, () =>
          assert.rejects(db.query("select public.review_join_request($1, $2, true)", [group, asha]), /Only a group admin/),
        );
      }
      assert.equal((await call(db, admin, "select public.review_join_request($1, $2, true) as s", [group, asha])).s, "active");
      assert.deepEqual(await membership(db, group, asha), { status: "active", role: "member" });
    });

    it("lets only admins invite, and the invitee decide", async () => {
      await as(db, asha, () =>
        assert.rejects(db.query("select public.invite_to_group($1, $2)", [group, ravi]), /Only a group admin/),
      );
      assert.equal((await call(db, admin, "select public.invite_to_group($1, $2) as s", [group, ravi])).s, "invited");
      // Nobody can answer someone else's invitation.
      await as(db, outsider, () =>
        assert.rejects(db.query("select public.respond_to_group_invite($1, true)", [group]), /no invitation/),
      );
      assert.equal((await call(db, ravi, "select public.respond_to_group_invite($1, true) as s", [group])).s, "active");
    });

    it("won't invite or admit accounts that aren't SRM-verified", async () => {
      await as(db, admin, () =>
        assert.rejects(db.query("select public.invite_to_group($1, $2)", [group, legacy]), /verified SRM/),
      );
      await as(db, legacy, () =>
        assert.rejects(db.query("select public.request_to_join_group($1)", [group]), /verified SRM/),
      );
    });

    it("stops at the group's size limit", async () => {
      // admin + asha + ravi = 3 = max_members.
      await as(db, meera, () =>
        assert.rejects(db.query("select public.request_to_join_group($1)", [group]), /full/),
      );
      await as(db, admin, () =>
        assert.rejects(db.query("update public.groups set max_members = 2 where id = $1", [group]), /more members/),
      );
    });

    it("lets admins remove members, who then can't ask to rejoin", async () => {
      assert.equal((await call(db, admin, "select public.remove_group_member($1, $2) as s", [group, ravi])).s, "removed");
      await as(db, ravi, () =>
        assert.rejects(db.query("select public.request_to_join_group($1)", [group]), /can't rejoin/),
      );
      await as(db, asha, () =>
        assert.rejects(db.query("select public.remove_group_member($1, $2)", [group, admin]), /Only a group admin/),
      );
    });

    it("always keeps an admin: no demoting the last one, and leaving hands the role on", async () => {
      await as(db, admin, () =>
        assert.rejects(db.query("select public.set_group_member_role($1, $2, 'member')", [group, admin]), /at least one admin/),
      );
      assert.equal((await call(db, admin, "select public.leave_group($1) as s", [group])).s, "left");
      assert.deepEqual(await membership(db, group, asha), { status: "active", role: "admin" });
      // The last member leaving closes the group.
      await call(db, asha, "select public.leave_group($1) as s", [group]);
      const [row] = await rows<{ status: string }>(db, "select status from public.groups where id = $1", [group]);
      assert.equal(row.status, "archived");
    });
  });

  describe("visibility and editing", () => {
    let privateGroup: string;
    let openGroup: string;

    before(async () => {
      privateGroup = await createGroup(db, meera, "false");
      openGroup = await createGroup(db, admin);
      await call(db, asha, "select public.request_to_join_group($1) as s", [openGroup]);
    });

    it("hides private groups from outsiders but shows them to invitees", async () => {
      const seen = (user: string) =>
        as(db, user, () => rows(db, "select id from public.groups where id = $1", [privateGroup]));
      assert.equal((await seen(outsider)).length, 0);
      await call(db, meera, "select public.invite_to_group($1, $2) as s", [privateGroup, outsider]);
      assert.equal((await seen(outsider)).length, 1);
    });

    it("keeps private groups invite-only", async () => {
      await as(db, ravi, () =>
        assert.rejects(db.query("select public.request_to_join_group($1)", [privateGroup]), /isn't available|invite-only/),
      );
    });

    it("shows a discoverable group's members to everyone, but pending requests only to the group", async () => {
      const outsiderView = await as(db, outsider, () =>
        rows<{ profile_id: string; status: string }>(db, "select profile_id, status from public.group_members where group_id = $1", [openGroup]),
      );
      assert.deepEqual(outsiderView.map((row) => row.status), ["active"]);
      const adminView = await as(db, admin, () =>
        rows<{ status: string }>(db, "select status from public.group_members where group_id = $1 order by status", [openGroup]),
      );
      assert.deepEqual(adminView.map((row) => row.status), ["active", "requested"]);
    });

    it("lets admins, and only admins, edit the group", async () => {
      await as(db, admin, () =>
        db.query(
          "update public.groups set description = 'Three CSE juniors', budget_max = 12000, preferred_societies = '{Estancia}' where id = $1",
          [openGroup],
        ),
      );
      await as(db, asha, async () => {
        assert.equal(await affected(db, "update public.groups set name = 'Hijacked' where id = $1", [openGroup]), 0);
      });
      await as(db, admin, () =>
        assert.rejects(db.query("update public.groups set created_by = $2 where id = $1", [openGroup, asha]), /permission denied/),
      );
    });

    it("is closed to anonymous visitors", async () => {
      await as(db, null, () => assert.rejects(db.query("select * from public.groups"), /permission denied/));
      await as(db, null, () =>
        assert.rejects(db.query("select public.request_to_join_group($1)", [openGroup]), /permission denied/),
      );
    });
  });
});
