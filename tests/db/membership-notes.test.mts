/**
 * Private invitation and join-request notes (migration 017, audit F-01).
 *
 * First the leak itself, on a database built from 001-016 exactly as live
 * is today, then 017 applied on top of that same database. Then, on a fresh
 * database, who can read which note, and what happens to a note as its
 * membership moves on.
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

import { applyMigrations, as, createDatabase, createLegacyUser, createUser, onboard, rows, type Db } from "./harness.mts";

type Note = { group_id: string; profile_id: string; status: string; message: string };

const MEMBER_COLUMNS = ["group_id", "profile_id", "role", "status", "invited_by", "joined_at", "created_at", "updated_at"];

function helpers(db: () => Db) {
  const call = <T = Record<string, unknown>,>(user: string | null, sql: string, params: unknown[] = []) =>
    as(db(), user, () => rows<T>(db(), sql, params));
  const uuids = (ids: string[]) => `{${ids.join(",")}}`;
  return {
    call,
    notes: (user: string | null, groups: string[]) =>
      call<Note>(user, "select group_id, profile_id, status, message from public.group_membership_notes($1::uuid[]) order by profile_id", [uuids(groups)]),
    /** The stored note and status, read as the database owner. */
    stored: async (group: string, profile: string) =>
      (await rows<{ status: string; message: string | null; role: string; invited_by: string | null; joined_at: string | null; updated_at: string }>(
        db(),
        "select status, message, role, invited_by, joined_at, updated_at from public.group_members where group_id = $1 and profile_id = $2",
        [group, profile],
      ))[0],
    newGroup: async (owner: string, name = "Night owls") =>
      (await call<{ id: string }>(owner, "insert into public.groups (name, created_by, is_discoverable) values ($1, $2, true) returning id", [name, owner]))[0].id,
    invite: (admin: string, group: string, who: string, note: string | null) =>
      call(admin, "select public.invite_to_group($1, $2, $3)", [group, who, note]),
    request: (who: string, group: string, note: string | null) =>
      call(who, "select public.request_to_join_group($1, $2)", [group, note]),
    respond: (who: string, group: string, accept: boolean) =>
      call(who, "select public.respond_to_group_invite($1, $2)", [group, accept]),
    review: (admin: string, group: string, who: string, approve: boolean) =>
      call(admin, "select public.review_join_request($1, $2, $3)", [group, who, approve]),
  };
}

describe("membership notes before and after 017 (an existing database)", () => {
  let db: Db;
  const h = helpers(() => db);
  let asha: string; // admin
  let ravi: string; // invited with a note, accepted: an active member
  let kiran: string; // pending request with a note
  let dev: string; // pending invitation with a note
  let meera: string; // unrelated eligible student
  let groupId: string;
  let raviUpdatedAt: unknown;

  before(async () => {
    db = await createDatabase({ through: "016" });
    asha = await createUser(db, "asha@srmist.edu.in");
    ravi = await createUser(db, "ravi@srmist.edu.in");
    kiran = await createUser(db, "kiran@srmist.edu.in");
    dev = await createUser(db, "dev@srmist.edu.in");
    meera = await createUser(db, "meera@srmist.edu.in");
    for (const [id, name] of [[asha, "Asha"], [ravi, "Ravi"], [kiran, "Kiran"], [dev, "Dev"], [meera, "Meera"]]) {
      await onboard(db, id, "need_flat", name);
    }
    groupId = await h.newGroup(asha);
    await h.invite(asha, groupId, ravi, "SECRET-INVITE-RAVI");
    await h.respond(ravi, groupId, true);
    await h.request(kiran, groupId, "SECRET-REQUEST-KIRAN");
    await h.invite(asha, groupId, dev, "SECRET-INVITE-DEV");
    raviUpdatedAt = (await h.stored(groupId, ravi)).updated_at;
  });

  it("reproduces F-01 on 001-016: a member reads a pending request's note (leak A)", async () => {
    const leaked = await h.call<{ message: string }>(ravi, "select message from public.group_members where group_id = $1 and profile_id = $2", [groupId, kiran]);
    assert.deepEqual(leaked, [{ message: "SECRET-REQUEST-KIRAN" }]);
  });

  it("reproduces F-01 on 001-016: an unrelated student reads an accepted invitation's note (leak B)", async () => {
    const leaked = await h.call<{ message: string }>(meera, "select message from public.group_members where group_id = $1 and profile_id = $2", [groupId, ravi]);
    assert.deepEqual(leaked, [{ message: "SECRET-INVITE-RAVI" }]);
  });

  describe("after applying 017 to that database", () => {
    before(async () => {
      assert.deepEqual(await applyMigrations(db, { after: "016", through: "017" }), ["017_group_membership_notes_privacy.sql"]);
    });

    it("leak A is closed: the member can't read the column", async () => {
      await assert.rejects(
        h.call(ravi, "select message from public.group_members where group_id = $1 and profile_id = $2", [groupId, kiran]),
        /permission denied/,
      );
      assert.deepEqual(await h.notes(ravi, [groupId]), []);
    });

    it("leak B is closed: the column is unreadable and the stale note is gone", async () => {
      await assert.rejects(
        h.call(meera, "select message from public.group_members where group_id = $1 and profile_id = $2", [groupId, ravi]),
        /permission denied/,
      );
      assert.equal((await h.stored(groupId, ravi)).message, null);
      assert.deepEqual(await h.notes(meera, [groupId]), []);
    });

    it("cleared the stale note without touching anything else on the row", async () => {
      const row = await h.stored(groupId, ravi);
      assert.equal(row.status, "active");
      assert.equal(row.role, "member");
      assert.equal(row.invited_by, asha);
      assert.ok(row.joined_at);
      assert.deepEqual(row.updated_at, raviUpdatedAt, "updated_at kept");
    });

    it("kept the pending notes, readable by the admin and by their own student", async () => {
      assert.equal((await h.stored(groupId, kiran)).message, "SECRET-REQUEST-KIRAN");
      assert.equal((await h.stored(groupId, dev)).message, "SECRET-INVITE-DEV");
      const forAdmin = (await h.notes(asha, [groupId])).map((n) => n.message).sort();
      assert.deepEqual(forAdmin, ["SECRET-INVITE-DEV", "SECRET-REQUEST-KIRAN"]);
      assert.deepEqual((await h.notes(kiran, [groupId])).map((n) => n.message), ["SECRET-REQUEST-KIRAN"]);
      assert.deepEqual((await h.notes(dev, [groupId])).map((n) => n.message), ["SECRET-INVITE-DEV"]);
    });

    it("can be run again safely", async () => {
      await applyMigrations(db, { after: "016" });
      assert.equal((await h.stored(groupId, kiran)).message, "SECRET-REQUEST-KIRAN");
      assert.deepEqual((await h.stored(groupId, ravi)).updated_at, raviUpdatedAt);
      assert.deepEqual((await h.notes(asha, [groupId])).length, 2);
    });
  });
});

describe("membership notes (017)", () => {
  let db: Db;
  const h = helpers(() => db);
  let asha: string; // admin of the group
  let ravi: string; // ordinary active member
  let meera: string; // unrelated eligible student
  let kiran: string; // asks to join, with a note
  let dev: string; // invited, with a note
  let omar: string; // admin of a different group
  let rita: string; // will be removed
  let unconfirmed: string;
  let gmail: string;
  let groupId: string;
  let otherGroup: string;

  before(async () => {
    db = await createDatabase();
    asha = await createUser(db, "asha@srmist.edu.in");
    ravi = await createUser(db, "ravi@srmist.edu.in");
    meera = await createUser(db, "meera@srmist.edu.in");
    kiran = await createUser(db, "kiran@srmist.edu.in");
    dev = await createUser(db, "dev@srmist.edu.in");
    omar = await createUser(db, "omar@srmist.edu.in");
    rita = await createUser(db, "rita@srmist.edu.in");
    unconfirmed = await createUser(db, "uma@srmist.edu.in", { confirmed: false });
    gmail = await createLegacyUser(db, "gita@gmail.com");
    for (const id of [asha, ravi, meera, kiran, dev, omar, rita, unconfirmed, gmail]) {
      await onboard(db, id, "need_flat");
    }
  });

  beforeEach(async () => {
    await db.query("delete from public.groups");
    groupId = await h.newGroup(asha);
    await db.query("update public.groups set max_members = 10 where id = $1", [groupId]);
    await h.invite(asha, groupId, ravi, null);
    await h.respond(ravi, groupId, true);
    await h.request(kiran, groupId, "REQUEST-KIRAN");
    await h.invite(asha, groupId, dev, "INVITE-DEV");
    otherGroup = await h.newGroup(omar, "Early birds");
    await h.request(meera, otherGroup, "REQUEST-MEERA");
  });

  describe("who can read a note", () => {
    it("1. an ordinary member can't read another person's pending request note", async () => {
      assert.deepEqual(await h.notes(ravi, [groupId]), []);
    });

    it("2. an unrelated eligible student can't read an invitation note", async () => {
      assert.deepEqual(await h.notes(meera, [groupId]), []);
    });

    it("3. no one can read notes from active members (there are none left)", async () => {
      await h.invite(asha, groupId, rita, "WELCOME-RITA");
      await h.respond(rita, groupId, true);
      for (const user of [asha, ravi, meera, rita]) {
        assert.ok(!(await h.notes(user, [groupId])).some((n) => n.message === "WELCOME-RITA"), user);
      }
      assert.equal((await h.stored(groupId, rita)).message, null);
    });

    it("4. a removed member can't read notes (and their own is cleared)", async () => {
      await h.call(asha, "select public.remove_group_member($1, $2)", [groupId, ravi]);
      assert.deepEqual(await h.notes(ravi, [groupId]), []);
      // A pending student removed by the admin: their note goes too.
      await h.call(asha, "select public.remove_group_member($1, $2)", [groupId, kiran]);
      assert.equal((await h.stored(groupId, kiran)).message, null);
      assert.deepEqual(await h.notes(kiran, [groupId]), []);
    });

    it("5. a declined or cancelled invitation no longer exposes its note", async () => {
      await h.call(asha, "select public.cancel_group_invite($1, $2)", [groupId, dev]);
      assert.equal((await h.stored(groupId, dev)).message, null);
      assert.deepEqual(await h.notes(dev, [groupId]), []);
      assert.ok(!(await h.notes(asha, [groupId])).some((n) => n.profile_id === dev));

      await h.invite(asha, groupId, rita, "INVITE-RITA");
      await h.respond(rita, groupId, false);
      assert.equal((await h.stored(groupId, rita)).message, null);
      assert.deepEqual(await h.notes(rita, [groupId]), []);
    });

    it("6. ineligible and signed-out callers are refused", async () => {
      for (const user of [unconfirmed, gmail]) {
        await assert.rejects(h.notes(user, [groupId]), /Only signed-in SRM students/, user);
      }
      // Holding the admin role isn't enough without an eligible account.
      await db.query(
        "insert into public.group_members (group_id, profile_id, role, status, joined_at) values ($1, $2, 'admin', 'active', now())",
        [groupId, gmail],
      );
      await assert.rejects(h.notes(gmail, [groupId]), /Only signed-in SRM students/);
      // A signed-in role with no account behind it.
      await assert.rejects(h.notes("00000000-0000-4000-8000-000000000000", [groupId]), /Only signed-in SRM students/);
    });

    it("7. a student reads only the note on their own pending row", async () => {
      assert.deepEqual(await h.notes(kiran, [groupId]), [
        { group_id: groupId, profile_id: kiran, status: "requested", message: "REQUEST-KIRAN" },
      ]);
      assert.deepEqual(await h.notes(dev, [groupId]), [
        { group_id: groupId, profile_id: dev, status: "invited", message: "INVITE-DEV" },
      ]);
      // Asking about every group at once still returns only their own.
      assert.deepEqual((await h.notes(kiran, [groupId, otherGroup])).map((n) => n.message), ["REQUEST-KIRAN"]);
    });

    it("8. an admin reads the pending notes of the group they run", async () => {
      const notes = await h.notes(asha, [groupId]);
      assert.deepEqual(
        notes.map((n) => [n.profile_id, n.status, n.message]).sort(),
        [[dev, "invited", "INVITE-DEV"], [kiran, "requested", "REQUEST-KIRAN"]].sort(),
      );
    });

    it("9. an admin of another group can't read this group's notes", async () => {
      assert.deepEqual(await h.notes(omar, [groupId]), []);
      assert.deepEqual((await h.notes(omar, [groupId, otherGroup])).map((n) => n.message), ["REQUEST-MEERA"]);
      assert.deepEqual((await h.notes(asha, [otherGroup])), []);
    });

    it("a former admin loses access the moment they step down or leave", async () => {
      await h.call(asha, "select public.set_group_member_role($1, $2, 'admin')", [groupId, ravi]);
      assert.equal((await h.notes(ravi, [groupId])).length, 2);
      await h.call(asha, "select public.set_group_member_role($1, $2, 'member')", [groupId, ravi]);
      assert.deepEqual(await h.notes(ravi, [groupId]), []);
      await h.call(asha, "select public.leave_group($1)", [groupId]);
      assert.deepEqual(await h.notes(asha, [groupId]), []);
    });

    it("10. anonymous visitors can't call the function or read the table", async () => {
      await assert.rejects(h.notes(null, [groupId]), /permission denied for function group_membership_notes/);
      await assert.rejects(h.call(null, "select profile_id from public.group_members"), /permission denied/);
    });

    it("11. students can't read the column directly, as admin or as its author", async () => {
      for (const user of [asha, ravi, meera, kiran, dev]) {
        await assert.rejects(
          h.call(user, "select message from public.group_members where group_id = $1", [groupId]),
          /permission denied/,
          user,
        );
        await assert.rejects(h.call(user, "select * from public.group_members"), /permission denied/, user);
        await assert.rejects(
          h.call(user, "select count(*) from public.group_members where message is not null"),
          /permission denied/,
          user,
        );
      }
    });

    it("12. every other membership column stays readable, with the same rows as before", async () => {
      const columns = MEMBER_COLUMNS.join(", ");
      // A member sees the whole group, pending rows included.
      const forRavi = await h.call<{ profile_id: string; status: string }>(ravi, `select ${columns} from public.group_members where group_id = $1`, [groupId]);
      assert.deepEqual(forRavi.map((r) => r.status).sort(), ["active", "active", "invited", "requested"]);
      // An unrelated student sees the active roster of a discoverable group.
      const forMeera = await h.call<{ status: string }>(meera, `select ${columns} from public.group_members where group_id = $1`, [groupId]);
      assert.deepEqual(forMeera.map((r) => r.status), ["active", "active"]);
      // Students see their own pending rows.
      assert.equal((await h.call(kiran, `select ${columns} from public.group_members where profile_id = $1`, [kiran])).length, 1);
    });

    it("grants: table-wide SELECT replaced by column SELECT on everything but the note", async () => {
      const [table] = await rows<{ authenticated: boolean; anon: boolean }>(
        db,
        `select has_table_privilege('authenticated', 'public.group_members', 'select') as authenticated,
                has_table_privilege('anon', 'public.group_members', 'select') as anon`,
      );
      assert.deepEqual(table, { authenticated: false, anon: false });
      const cols = await rows<{ column_name: string; authenticated: boolean; anon: boolean; writable: boolean }>(
        db,
        `select column_name,
                has_column_privilege('authenticated', 'public.group_members', column_name, 'select') as authenticated,
                has_column_privilege('anon', 'public.group_members', column_name, 'select') as anon,
                has_column_privilege('authenticated', 'public.group_members', column_name, 'insert, update') as writable
         from information_schema.columns
         where table_schema = 'public' and table_name = 'group_members' order by column_name`,
      );
      assert.deepEqual(
        cols.filter((c) => c.authenticated).map((c) => c.column_name).sort(),
        [...MEMBER_COLUMNS].sort(),
        "every column except message, and nothing new slipped in",
      );
      assert.ok(cols.some((c) => c.column_name === "message" && !c.authenticated));
      assert.ok(cols.every((c) => !c.anon && !c.writable));
    });

    it("the function: security definer, empty search_path, executable only by authenticated", async () => {
      const [fn] = await rows<{ definer: boolean; config: string[]; anon: boolean; authenticated: boolean; pub: boolean }>(
        db,
        `select p.prosecdef as definer, p.proconfig as config,
                has_function_privilege('anon', p.oid, 'execute') as anon,
                has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
                exists (select 1 from aclexplode(p.proacl) as a where a.grantee = 0 and a.privilege_type = 'EXECUTE') as pub
         from pg_proc as p where p.oid = 'public.group_membership_notes(uuid[])'::regprocedure`,
      );
      assert.deepEqual(fn, { definer: true, config: ['search_path=""'], anon: false, authenticated: true, pub: false });
      const [trigger] = await rows<{ authenticated: boolean }>(
        db,
        "select has_function_privilege('authenticated', 'public.clear_settled_group_member_note()', 'execute') as authenticated",
      );
      assert.equal(trigger.authenticated, false);
    });

    it("limits how many groups one call may ask about, and handles empty input", async () => {
      assert.deepEqual(await h.notes(asha, []), []);
      assert.deepEqual(await h.call(asha, "select * from public.group_membership_notes(null)"), []);
      const many = Array.from({ length: 201 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
      await assert.rejects(h.notes(asha, many), /at most 200 groups/);
    });
  });

  describe("what happens to a note as the membership moves on", () => {
    it("invitation accepted: note cleared, the rest of the row kept", async () => {
      await h.respond(dev, groupId, true);
      const row = await h.stored(groupId, dev);
      assert.deepEqual([row.status, row.message, row.role, row.invited_by], ["active", null, "member", asha]);
      assert.ok(row.joined_at);
    });

    it("invitation accepted by asking to join: note cleared", async () => {
      assert.deepEqual(await h.request(dev, groupId, "ME TOO"), [{ request_to_join_group: "active" }]);
      assert.equal((await h.stored(groupId, dev)).message, null);
    });

    it("join request approved: note cleared", async () => {
      await h.review(asha, groupId, kiran, true);
      const row = await h.stored(groupId, kiran);
      assert.deepEqual([row.status, row.message], ["active", null]);
    });

    it("join request answered with an invitation: note cleared", async () => {
      assert.deepEqual(await h.invite(asha, groupId, kiran, "COME IN"), [{ invite_to_group: "active" }]);
      const row = await h.stored(groupId, kiran);
      assert.deepEqual([row.status, row.message, row.invited_by], ["active", null, asha]);
    });

    it("join request declined or withdrawn: note cleared", async () => {
      await h.review(asha, groupId, kiran, false);
      assert.equal((await h.stored(groupId, kiran)).message, null);
      await h.request(rita, groupId, "REQUEST-RITA");
      await h.call(rita, "select public.leave_group($1)", [groupId]);
      assert.deepEqual([(await h.stored(groupId, rita)).status, (await h.stored(groupId, rita)).message], ["left", null]);
    });

    it("pending notes stay until the answer comes", async () => {
      // Repeating the request or invitation changes nothing.
      await h.request(kiran, groupId, "SOMETHING ELSE");
      await h.invite(asha, groupId, dev, "SOMETHING ELSE");
      assert.equal((await h.stored(groupId, kiran)).message, "REQUEST-KIRAN");
      assert.equal((await h.stored(groupId, dev)).message, "INVITE-DEV");
      // Unrelated changes to the group don't touch them either.
      await h.call(asha, "select public.set_group_member_role($1, $2, 'admin')", [groupId, ravi]);
      assert.equal((await h.stored(groupId, kiran)).message, "REQUEST-KIRAN");
    });

    it("rejoining: the old note never comes back", async () => {
      await h.review(asha, groupId, kiran, true);
      await h.call(kiran, "select public.leave_group($1)", [groupId]);
      await h.request(kiran, groupId, null);
      assert.deepEqual(await h.notes(asha, [groupId]).then((n) => n.filter((x) => x.profile_id === kiran)), []);
      assert.equal((await h.stored(groupId, kiran)).message, null);
      await h.call(kiran, "select public.leave_group($1)", [groupId]);
      await h.request(kiran, groupId, "SECOND TIME");
      assert.deepEqual((await h.notes(kiran, [groupId])).map((n) => n.message), ["SECOND TIME"]);
    });

    it("re-invited after a cancellation: only the new note", async () => {
      await h.call(asha, "select public.cancel_group_invite($1, $2)", [groupId, dev]);
      await h.invite(asha, groupId, dev, null);
      assert.deepEqual(await h.notes(dev, [groupId]), []);
    });

    it("no code path can leave a note on a settled row", async () => {
      // Even the database owner writing directly: the trigger clears it.
      await db.query(
        "insert into public.group_members (group_id, profile_id, role, status, joined_at, message) values ($1, $2, 'member', 'active', now(), 'DIRECT')",
        [groupId, rita],
      );
      assert.equal((await h.stored(groupId, rita)).message, null);
      await db.query("update public.group_members set status = 'declined' where group_id = $1 and profile_id = $2", [groupId, dev]);
      assert.equal((await h.stored(groupId, dev)).message, null);
      // And the constraint holds the rule if the trigger were ever bypassed.
      await db.exec("alter table public.group_members disable trigger group_members_clear_settled_note");
      try {
        await assert.rejects(
          db.query("update public.group_members set message = 'X' where group_id = $1 and profile_id = $2", [groupId, ravi]),
          /group_members_note_only_while_pending/,
        );
      } finally {
        await db.exec("alter table public.group_members enable trigger group_members_clear_settled_note");
      }
    });

    it("notifications and group history still carry each note to the right people", async () => {
      const seen = (user: string) =>
        h.call<{ kind: string; detail: string | null }>(
          user,
          "select e.kind, e.detail from public.notifications n join public.group_events e on e.id = n.event_id where e.group_id = $1 order by e.kind",
          [groupId],
        );
      assert.deepEqual(await seen(asha), [
        { kind: "invite_accepted", detail: null },
        { kind: "requested", detail: "REQUEST-KIRAN" },
      ]);
      assert.deepEqual(await seen(dev), [{ kind: "invited", detail: "INVITE-DEV" }]);
      // Ravi only has the notification for his own invitation (sent without a note).
      assert.deepEqual(await seen(ravi), [{ kind: "invited", detail: null }]);
      assert.deepEqual(await h.call(meera, "select detail from public.group_events where group_id = $1", [groupId]), []);
    });

    it("joining still posts the group chat system message, without the note", async () => {
      await h.review(asha, groupId, kiran, true);
      const posted = await h.call<{ system_kind: string; content: string | null }>(
        ravi,
        "select system_kind, content from public.group_messages where group_id = $1 and subject_id = $2",
        [groupId, kiran],
      );
      assert.deepEqual(posted, [{ system_kind: "joined", content: null }]);
    });
  });
});

// --- Notes in the group history (events and notifications) -------------------

type History = {
  events: Array<{ id: string; kind: string; subject_id: string | null; detail: string | null } & Record<string, unknown>>;
  notifications: Array<Record<string, unknown> & { id: string; read_at: unknown }>;
};

/** Every event and notification, as the database owner sees them. */
async function history(db: Db): Promise<History> {
  return {
    events: await rows(db, "select id, group_id, group_name, subject_id, actor_id, kind, detail, created_at from public.group_events order by id"),
    notifications: await rows(db, "select id, recipient_id, event_id, read_at, created_at from public.notifications order by id"),
  };
}

/** The same rows, ids and values, apart from event details. */
function assertOnlyDetailsChanged(before: History, after: History) {
  const withoutDetail = (events: History["events"]) =>
    events.map((event) => Object.fromEntries(Object.entries(event).filter(([column]) => column !== "detail")));
  assert.deepEqual(withoutDetail(after.events), withoutDetail(before.events), "events: same rows, ids and metadata");
  assert.deepEqual(after.notifications, before.notifications, "notifications: same rows, ids, times and read state");
}

/** Which event details changed, as "kind:old text -> new text". */
function changedDetails(before: History, after: History): string[] {
  const was = new Map(before.events.map((e) => [e.id, e.detail]));
  return after.events
    .filter((e) => was.get(e.id) !== e.detail)
    .map((e) => `${e.kind}:${was.get(e.id)} -> ${e.detail}`)
    .sort();
}

/** Invitation and request notes still in the history, as "kind:text". */
async function historyNotes(db: Db, group?: string): Promise<string[]> {
  const found = await rows<{ note: string }>(
    db,
    `select kind || ':' || detail as note from public.group_events
     where kind in ('invited', 'requested') and detail is not null ${group ? "and group_id = $1" : ""}
     order by 1`,
    group ? [group] : [],
  );
  return found.map((r) => r.note);
}

describe("history notes before and after 017 (an existing database)", () => {
  let db: Db;
  const h = helpers(() => db);
  const ids: Record<string, string> = {};
  let groupId: string;
  let otherGroup: string;
  let before017: History;

  before(async () => {
    db = await createDatabase({ through: "016" });
    for (const name of ["asha", "omar", "ravi", "kiran", "dev", "meera", "tara", "sam", "zed"]) {
      ids[name] = await createUser(db, `${name}@srmist.edu.in`);
      await onboard(db, ids[name], "need_flat", name);
    }
    const { asha, omar, ravi, kiran, dev, meera, tara, sam, zed } = ids;
    groupId = await h.newGroup(asha);
    otherGroup = await h.newGroup(omar, "Early birds");
    await db.query("update public.groups set max_members = 10");

    // Settled: an accepted invitation, then a role change (an unrelated detail).
    await h.invite(asha, groupId, ravi, "H-INVITE-RAVI");
    await h.respond(ravi, groupId, true);
    await h.call(asha, "select public.set_group_member_role($1, $2, 'admin')", [groupId, ravi]);
    // A declined request, then a second, still pending, request.
    await h.request(kiran, groupId, "H-REQ-KIRAN-1");
    await h.review(asha, groupId, kiran, false);
    await h.request(kiran, groupId, "H-REQ-KIRAN-2");
    // A pending invitation.
    await h.invite(asha, groupId, dev, "H-INVITE-DEV");
    // A withdrawn request here, and a pending one in another group.
    await h.request(meera, groupId, "H-REQ-MEERA");
    await h.call(meera, "select public.leave_group($1)", [groupId]);
    await h.request(meera, otherGroup, "H-REQ-MEERA-OTHER");
    // A cancelled invitation.
    await h.invite(asha, groupId, tara, "H-INVITE-TARA");
    await h.call(asha, "select public.cancel_group_invite($1, $2)", [groupId, tara]);
    // The same text twice: declined, then asked again (pending). The first
    // round is dated a minute earlier so the order is certain.
    await h.request(sam, groupId, "H-SAME");
    const [first] = await rows<{ id: string }>(db, "select id from public.group_events where subject_id = $1 and kind = 'requested'", [sam]);
    await db.query("update public.group_events set created_at = created_at - interval '1 minute' where id = $1", [first.id]);
    await h.review(asha, groupId, sam, false);
    await h.request(sam, groupId, "H-SAME");
    // A pending request from an account that is then deleted.
    await h.request(zed, groupId, "H-REQ-ZED");
    await db.query("delete from auth.users where id = $1", [zed]);
    // Some notifications already read.
    await db.query("update public.notifications set read_at = now() - interval '1 hour' where recipient_id = $1", [asha]);

    before017 = await history(db);
  });

  it("on 001-016 the history keeps every note, settled or not", async () => {
    assert.deepEqual(await historyNotes(db), [
      "invited:H-INVITE-DEV",
      "invited:H-INVITE-RAVI",
      "invited:H-INVITE-TARA",
      "requested:H-REQ-KIRAN-1",
      "requested:H-REQ-KIRAN-2",
      "requested:H-REQ-MEERA",
      "requested:H-REQ-MEERA-OTHER",
      "requested:H-REQ-ZED",
      "requested:H-SAME",
      "requested:H-SAME",
    ]);
    // e.g. the admin still reads an answered request's note in the history.
    const seen = await h.call(ids.asha, "select detail from public.group_events where detail = 'H-REQ-KIRAN-1'");
    assert.equal(seen.length, 1);
  });

  describe("after applying 017", () => {
    let after017: History;

    before(async () => {
      await applyMigrations(db, { after: "016" });
      after017 = await history(db);
    });

    it("clears exactly the settled notes, and keeps the pending ones", async () => {
      assert.deepEqual(changedDetails(before017, after017), [
        "invited:H-INVITE-RAVI -> null",
        "invited:H-INVITE-TARA -> null",
        "requested:H-REQ-KIRAN-1 -> null",
        "requested:H-REQ-MEERA -> null",
        "requested:H-REQ-ZED -> null",
        "requested:H-SAME -> null",
      ]);
      assert.deepEqual(await historyNotes(db), [
        "invited:H-INVITE-DEV",
        "requested:H-REQ-KIRAN-2",
        "requested:H-REQ-MEERA-OTHER",
        "requested:H-SAME",
      ]);
    });

    it("keeps the current round of an identical note, not the earlier one", async () => {
      const sams = await rows<{ detail: string | null }>(
        db,
        "select detail from public.group_events where subject_id = $1 and kind = 'requested' order by created_at",
        [ids.sam],
      );
      assert.deepEqual(sams.map((e) => e.detail), [null, "H-SAME"]);
    });

    it("keeps every event and notification row, with all other values unchanged", async () => {
      assertOnlyDetailsChanged(before017, after017);
      assert.ok(after017.events.some((e) => e.kind === "role_changed" && e.detail === "admin"), "role detail kept");
      assert.ok(after017.notifications.some((n) => n.read_at !== null), "read state kept");
    });

    it("pending notes still reach their readers through the history", async () => {
      const seen = async (user: string) =>
        (await h.call<{ detail: string }>(
          user,
          "select e.detail from public.notifications n join public.group_events e on e.id = n.event_id where e.detail like 'H-%' order by 1",
        )).map((r) => r.detail);
      assert.deepEqual(await seen(ids.asha), ["H-REQ-KIRAN-2", "H-SAME"]);
      assert.deepEqual(await seen(ids.dev), ["H-INVITE-DEV"]);
      assert.deepEqual(await seen(ids.omar), ["H-REQ-MEERA-OTHER"]);
      // Ravi (an admin since before the later requests) sees those, but not
      // his own invitation's note any more.
      assert.deepEqual(await seen(ids.ravi), ["H-REQ-KIRAN-2", "H-SAME"]);
    });

    it("a second run changes nothing", async () => {
      await applyMigrations(db, { after: "016" });
      assert.deepEqual(await history(db), after017);
    });
  });
});

describe("history notes as invitations and requests are settled (017)", () => {
  let db: Db;
  const h = helpers(() => db);
  const ids: Record<string, string> = {};
  let groupId: string;
  let otherGroup: string;
  let extra = 0;

  before(async () => {
    db = await createDatabase();
    for (const name of ["asha", "omar", "ravi", "kiran", "dev", "rita", "sam"]) {
      ids[name] = await createUser(db, `${name}@srmist.edu.in`);
      await onboard(db, ids[name], "need_flat", name);
    }
  });

  beforeEach(async () => {
    const { asha, omar, ravi, kiran, dev, rita, sam } = ids;
    await db.query("delete from public.groups");
    groupId = await h.newGroup(asha);
    otherGroup = await h.newGroup(omar, "Early birds");
    await db.query("update public.groups set max_members = 10");
    await h.invite(asha, groupId, ravi, null);
    await h.respond(ravi, groupId, true);
    // Two pending requests and two pending invitations in the group, and
    // Kiran also asking to join another group.
    await h.request(kiran, groupId, "N-REQ-KIRAN");
    await h.request(rita, groupId, "N-REQ-RITA");
    await h.invite(asha, groupId, dev, "N-INV-DEV");
    await h.invite(asha, groupId, sam, "N-INV-SAM");
    await h.request(kiran, otherGroup, "N-REQ-KIRAN-OTHER");
    // Ravi becomes an admin afterwards (an unrelated role detail).
    await h.call(asha, "select public.set_group_member_role($1, $2, 'admin')", [groupId, ravi]);
  });

  const ALL = ["invited:N-INV-DEV", "invited:N-INV-SAM", "requested:N-REQ-KIRAN", "requested:N-REQ-KIRAN-OTHER", "requested:N-REQ-RITA"];
  const without = (...gone: string[]) => ALL.filter((note) => !gone.includes(note));

  /** Run `settle`, then check that only the `gone` notes left the history and nothing else changed. */
  async function settling(settle: () => Promise<unknown>, gone: string[]) {
    const before = await history(db);
    await settle();
    const after = await history(db);
    const afterEvents = new Set(after.events.map((e) => e.id));
    const afterNotifications = new Set(after.notifications.map((n) => n.id));
    assert.ok(before.events.every((e) => afterEvents.has(e.id)), "no event deleted");
    assert.ok(before.notifications.every((n) => afterNotifications.has(n.id)), "no notification deleted");
    // Earlier rows: unchanged apart from the settled note. (New rows are the
    // settlement's own event and notifications.)
    const beforeEvents = new Set(before.events.map((e) => e.id));
    const beforeNotifications = new Set(before.notifications.map((n) => n.id));
    const earlier: History = {
      events: after.events.filter((e) => beforeEvents.has(e.id)),
      notifications: after.notifications.filter((n) => beforeNotifications.has(n.id)),
    };
    assertOnlyDetailsChanged(before, earlier);
    assert.deepEqual(changedDetails(before, earlier), gone.map((note) => `${note} -> null`).sort());
    assert.deepEqual(await historyNotes(db), without(...gone));
  }

  it("1-2. pending requests and invitations keep their notes for their readers", async () => {
    assert.deepEqual(await historyNotes(db), ALL);
    const seen = async (user: string) =>
      (await h.call<{ detail: string }>(
        user,
        "select e.detail from public.notifications n join public.group_events e on e.id = n.event_id where e.detail like 'N-%' order by 1",
      )).map((r) => r.detail);
    assert.deepEqual(await seen(ids.asha), ["N-REQ-KIRAN", "N-REQ-RITA"]);
    assert.deepEqual(await seen(ids.ravi), [], "the requests came in before Ravi was an admin");
    assert.deepEqual(await seen(ids.dev), ["N-INV-DEV"]);
    assert.deepEqual(await seen(ids.omar), ["N-REQ-KIRAN-OTHER"]);
    // Current admins read their group's history, as before.
    const forRavi = await h.call<{ detail: string }>(ids.ravi, "select detail from public.group_events where group_id = $1 and detail like 'N-%' order by 1", [groupId]);
    assert.deepEqual(forRavi.map((r) => r.detail), ["N-INV-DEV", "N-INV-SAM", "N-REQ-KIRAN", "N-REQ-RITA"]);
  });

  it("3. approving a request clears only that request's note", async () => {
    await settling(() => h.review(ids.asha, groupId, ids.kiran, true), ["requested:N-REQ-KIRAN"]);
  });

  it("3. a request answered with an invitation: only that note", async () => {
    await settling(() => h.invite(ids.asha, groupId, ids.rita, "N-WELCOME"), ["requested:N-REQ-RITA"]);
  });

  it("4. declining a request clears its note", async () => {
    await settling(() => h.review(ids.asha, groupId, ids.rita, false), ["requested:N-REQ-RITA"]);
  });

  it("4. withdrawing a request clears its note (in that group only)", async () => {
    await settling(() => h.call(ids.kiran, "select public.leave_group($1)", [groupId]), ["requested:N-REQ-KIRAN"]);
  });

  it("5. accepting an invitation clears its note", async () => {
    await settling(() => h.respond(ids.dev, groupId, true), ["invited:N-INV-DEV"]);
  });

  it("5. accepting by asking to join clears its note", async () => {
    await settling(() => h.request(ids.sam, groupId, "N-IGNORED"), ["invited:N-INV-SAM"]);
  });

  it("5. declining an invitation clears its note", async () => {
    await settling(() => h.respond(ids.sam, groupId, false), ["invited:N-INV-SAM"]);
  });

  it("6. cancelling an invitation clears its note", async () => {
    await settling(() => h.call(ids.asha, "select public.cancel_group_invite($1, $2)", [groupId, ids.dev]), ["invited:N-INV-DEV"]);
  });

  it("removing a pending student clears their note", async () => {
    await settling(() => h.call(ids.asha, "select public.remove_group_member($1, $2)", [groupId, ids.rita]), ["requested:N-REQ-RITA"]);
  });

  it("7-8. a new round keeps only the new note; other members' notes stay", async () => {
    await h.review(ids.asha, groupId, ids.kiran, false);
    await h.request(ids.kiran, groupId, "N-REQ-KIRAN-AGAIN");
    assert.deepEqual(await historyNotes(db, groupId), ["invited:N-INV-DEV", "invited:N-INV-SAM", "requested:N-REQ-KIRAN-AGAIN", "requested:N-REQ-RITA"]);
    await h.call(ids.asha, "select public.cancel_group_invite($1, $2)", [groupId, ids.dev]);
    await h.invite(ids.asha, groupId, ids.dev, "N-INV-DEV-AGAIN");
    assert.deepEqual(await historyNotes(db, groupId), ["invited:N-INV-DEV-AGAIN", "invited:N-INV-SAM", "requested:N-REQ-KIRAN-AGAIN", "requested:N-REQ-RITA"]);
    assert.deepEqual(await historyNotes(db, otherGroup), ["requested:N-REQ-KIRAN-OTHER"]);
  });

  it("9-10. read state, times, ids and unrelated details survive a settlement", async () => {
    await db.query("update public.notifications set read_at = now() - interval '1 day' where recipient_id = $1", [ids.asha]);
    const roleBefore = await rows<{ id: string; detail: string }>(db, "select id, detail from public.group_events where kind = 'role_changed'");
    await settling(() => h.review(ids.asha, groupId, ids.kiran, true), ["requested:N-REQ-KIRAN"]);
    assert.deepEqual(await rows(db, "select id, detail from public.group_events where kind = 'role_changed'"), roleBefore);
    assert.deepEqual(roleBefore.map((r) => r.detail), ["admin"]);
  });

  it("a deleted account takes its pending note out of the history, keeping the event", async () => {
    const zed = await createUser(db, `zed${++extra}@srmist.edu.in`);
    await onboard(db, zed, "need_flat", "Zed");
    await h.request(zed, groupId, "N-REQ-ZED");
    const [event] = await rows<{ id: string }>(db, "select id from public.group_events where subject_id = $1 and kind = 'requested'", [zed]);
    const notified = "select id, recipient_id, read_at from public.notifications where event_id = $1 order by id";
    const notifiedBefore = await rows(db, notified, [event.id]);
    assert.equal(notifiedBefore.length, 2, "both admins were told");
    await db.query("delete from auth.users where id = $1", [zed]);
    const [after] = await rows(db, "select subject_id, detail, kind from public.group_events where id = $1", [event.id]);
    assert.deepEqual(after, { subject_id: null, detail: null, kind: "requested" });
    assert.deepEqual(await rows(db, notified, [event.id]), notifiedBefore, "notifications kept");
    assert.deepEqual(await historyNotes(db), ALL);
  });

  it("a deleted inviter doesn't clear a still-pending invitation's note", async () => {
    const inviter = await createUser(db, `inviter${++extra}@srmist.edu.in`);
    await onboard(db, inviter, "need_flat", "Ivy");
    await db.query("insert into public.group_members (group_id, profile_id, role, status, joined_at) values ($1, $2, 'admin', 'active', now())", [groupId, inviter]);
    const guest = await createUser(db, `guest${extra}@srmist.edu.in`);
    await onboard(db, guest, "need_flat", "Gus");
    await h.invite(inviter, groupId, guest, "N-INV-GUEST");
    await db.query("delete from auth.users where id = $1", [inviter]);
    assert.ok((await historyNotes(db, groupId)).includes("invited:N-INV-GUEST"));
  });

  it("a pending membership row deleted directly takes its note too", async () => {
    await settling(() => db.query("delete from public.group_members where group_id = $1 and profile_id = $2", [groupId, ids.sam]), ["invited:N-INV-SAM"]);
  });

  it("11. deleting a whole group still works", async () => {
    await db.query("delete from public.groups where id = $1", [groupId]);
    assert.deepEqual(await historyNotes(db), ["requested:N-REQ-KIRAN-OTHER"]);
  });

  it("the new functions aren't callable by students, and every trigger is enabled", async () => {
    for (const fn of ["clear_settled_membership_event_notes()", "clear_orphaned_event_note()", "clear_settled_group_member_note()"]) {
      const [row] = await rows<{ authenticated: boolean; anon: boolean }>(
        db,
        `select has_function_privilege('authenticated', 'public.${fn}', 'execute') as authenticated,
                has_function_privilege('anon', 'public.${fn}', 'execute') as anon`,
      );
      assert.deepEqual(row, { authenticated: false, anon: false }, fn);
    }
    const triggers = await rows<{ tgname: string; tgenabled: string }>(
      db,
      `select tgname, tgenabled from pg_trigger
       where tgrelid in ('public.group_members'::regclass, 'public.group_events'::regclass) and not tgisinternal
       order by tgname`,
    );
    for (const name of ["group_events_clear_orphaned_note", "group_members_clear_deleted_event_notes", "group_members_clear_settled_event_notes", "group_members_clear_settled_note"]) {
      assert.equal(triggers.find((t) => t.tgname === name)?.tgenabled, "O", name);
    }
    // Students still can't write the history themselves.
    const [write] = await rows<{ can: boolean }>(db, "select has_table_privilege('authenticated', 'public.group_events', 'update') as can");
    assert.equal(write.can, false);
  });
});

describe("identical notes with identical timestamps (017 cleanup, privacy first)", () => {
  type Pair = { student: string; note: string; earlier: string; current: string; currentIdHigher: boolean };
  let db: Db;
  const h = helpers(() => db);
  let asha: string;
  let kiran: string;
  let twin: string;
  let triple: { student: string; note: string; tied: string[]; current: string };
  let twinEvent: string;
  let groupId: string;
  const pairs: Pair[] = [];
  let before017: History;
  let after017: History;

  const detailOf = async (event: string) =>
    (await rows<{ detail: string | null }>(db, "select detail from public.group_events where id = $1", [event]))[0]?.detail;
  const eventRow = async (event: string) =>
    (await rows(db, "select id, group_id, subject_id, actor_id, kind, created_at from public.group_events where id = $1", [event]))[0];
  const requestEvents = async (student: string) =>
    (await rows<{ id: string }>(db, "select id from public.group_events where subject_id = $1 and kind = 'requested' order by created_at, id", [student])).map((e) => e.id);
  const sameTime = (events: string[]) =>
    db.query("update public.group_events set created_at = (select min(created_at) from public.group_events where id = any ($1::uuid[])) where id = any ($1::uuid[])", [`{${events.join(",")}}`]);

  before(async () => {
    db = await createDatabase({ through: "016" });
    asha = await createUser(db, "asha@srmist.edu.in");
    await onboard(db, asha, "need_flat", "Asha");
    groupId = await h.newGroup(asha);
    await db.query("update public.groups set max_members = 10");
    // Another member's pending request, to show it's left alone.
    kiran = await createUser(db, "kiran@srmist.edu.in");
    await onboard(db, kiran, "need_flat", "Kiran");
    await h.request(kiran, groupId, "T-OTHER-PENDING");

    // Each round: ask with a note, get declined, ask again with the same note
    // (pending), then force both 'requested' events to the same created_at.
    // Event ids are random, so keep going until both orders have happened:
    // the current round's id sorting higher, and the earlier round's. The
    // rule must not depend on which.
    for (let i = 0; i < 64 && !(pairs.some((p) => p.currentIdHigher) && pairs.some((p) => !p.currentIdHigher)); i++) {
      const student = await createUser(db, `tie${i}@srmist.edu.in`);
      await onboard(db, student, "need_flat", `Tie ${i}`);
      const note = `T-SAME-${i}`;
      await h.request(student, groupId, note);
      const [earlier] = await requestEvents(student);
      await h.review(asha, groupId, student, false);
      await h.request(student, groupId, note);
      const current = (await requestEvents(student)).find((id) => id !== earlier)!;
      await sameTime([earlier, current]);
      const [order] = await rows<{ higher: boolean }>(db, "select $1::uuid > $2::uuid as higher", [current, earlier]);
      pairs.push({ student, note, earlier, current, currentIdHigher: order.higher });
    }

    // Two earlier rounds tied with each other, then a strictly later current
    // round with the same text: the times do tell which one is current.
    const student = await createUser(db, "triple@srmist.edu.in");
    await onboard(db, student, "need_flat", "Triple");
    for (let round = 0; round < 3; round++) {
      await h.request(student, groupId, "T-TRIPLE");
      if (round < 2) await h.review(asha, groupId, student, false);
    }
    const all = await requestEvents(student);
    const tied = all.slice(0, 2);
    await sameTime(tied);
    await db.query("update public.group_events set created_at = created_at - interval '1 minute' where id = any ($1::uuid[])", [`{${tied.join(",")}}`]);
    triple = { student, note: "T-TRIPLE", tied, current: all[2] };

    // Someone else in the same group, pending with the very same text at the
    // very same time as the first tied pair: a different member, so not a tie.
    twin = await createUser(db, "twin@srmist.edu.in");
    await onboard(db, twin, "need_flat", "Twin");
    await h.request(twin, groupId, pairs[0].note);
    [twinEvent] = await requestEvents(twin);
    await db.query(
      "update public.group_events set created_at = (select created_at from public.group_events where id = $2) where id = $1",
      [twinEvent, pairs[0].current],
    );

    before017 = await history(db);
    await applyMigrations(db, { after: "016" });
    after017 = await history(db);
  });

  it("event ids are random version-4 UUIDs (they carry no time order)", async () => {
    const [sample] = await rows<{ version: string; variant: string }>(
      db,
      "select substr(id::text, 15, 1) as version, substr(id::text, 20, 1) as variant from (select gen_random_uuid() as id) as u",
    );
    assert.equal(sample.version, "4");
    assert.match(sample.variant, /[89ab]/);
  });

  it("set-up: both events of each pair really share created_at, and both id orders occurred", async () => {
    for (const pair of pairs) {
      const [tie] = await rows<{ same: boolean }>(
        db,
        "select (select created_at from public.group_events where id = $1) = (select created_at from public.group_events where id = $2) as same",
        [pair.earlier, pair.current],
      );
      assert.equal(tie.same, true, pair.note);
    }
    assert.ok(pairs.some((p) => p.currentIdHigher), "a pair where the current round's id is higher");
    assert.ok(pairs.some((p) => !p.currentIdHigher), "a pair where the earlier round's id is higher");
  });

  it("on 001-016 both tied events carry the note", async () => {
    for (const pair of pairs) {
      const was = (id: string) => before017.events.find((e) => e.id === id)?.detail;
      assert.equal(was(pair.earlier), pair.note);
      assert.equal(was(pair.current), pair.note);
    }
  });

  it("both tied events lose the note, whichever id sorts higher", async () => {
    for (const pair of pairs) {
      assert.equal(await detailOf(pair.earlier), null, `${pair.note}: earlier round`);
      assert.equal(await detailOf(pair.current), null, `${pair.note}: current round`);
    }
    assert.ok(pairs.some((p) => p.currentIdHigher) && pairs.some((p) => !p.currentIdHigher));
  });

  it("both event records remain, with every other value unchanged", async () => {
    for (const pair of pairs) {
      for (const id of [pair.earlier, pair.current]) {
        const was = before017.events.find((e) => e.id === id)!;
        assert.deepEqual(await eventRow(id), {
          id,
          group_id: was.group_id,
          subject_id: pair.student,
          actor_id: was.actor_id,
          kind: "requested",
          created_at: was.created_at,
        });
      }
    }
  });

  it("both notification records remain unchanged", async () => {
    for (const pair of pairs) {
      for (const id of [pair.earlier, pair.current]) {
        const was = before017.notifications.filter((n) => n.event_id === id);
        assert.equal(was.length, 1, "the admin was told about each request");
        assert.deepEqual(after017.notifications.filter((n) => n.event_id === id), was);
      }
    }
  });

  it("the pending membership row keeps its note", async () => {
    for (const pair of pairs) {
      const row = await h.stored(groupId, pair.student);
      assert.equal(row.status, "requested");
      assert.equal(row.message, pair.note);
    }
  });

  it("the authorized readers still get the pending note from group_membership_notes()", async () => {
    const adminSees = await h.notes(asha, [groupId]);
    for (const pair of pairs) {
      assert.ok(
        adminSees.some((n) => n.profile_id === pair.student && n.status === "requested" && n.message === pair.note),
        `admin reads ${pair.note}`,
      );
      assert.deepEqual(await h.notes(pair.student, [groupId]), [
        { group_id: groupId, profile_id: pair.student, status: "requested", message: pair.note },
      ]);
    }
    // Another requester reads only their own.
    assert.deepEqual((await h.notes(kiran, [groupId])).map((n) => n.message), ["T-OTHER-PENDING"]);
  });

  it("a strictly later round still keeps its note when only earlier rounds tie", async () => {
    for (const id of triple.tied) assert.equal(await detailOf(id), null);
    assert.equal(await detailOf(triple.current), triple.note);
    assert.equal((await h.stored(groupId, triple.student)).message, triple.note);
  });

  it("unrelated members' notes are unchanged, even with the same text at the same time", async () => {
    assert.equal(await detailOf(twinEvent), pairs[0].note);
    assert.equal((await h.stored(groupId, twin)).message, pairs[0].note);
    assert.ok((await historyNotes(db, groupId)).includes("requested:T-OTHER-PENDING"));
    assert.equal((await h.stored(groupId, kiran)).message, "T-OTHER-PENDING");
  });

  it("exactly the tied and earlier copies are cleared; nothing else changes", async () => {
    assertOnlyDetailsChanged(before017, after017);
    const expected = [
      ...pairs.flatMap((p) => [`requested:${p.note} -> null`, `requested:${p.note} -> null`]),
      "requested:T-TRIPLE -> null",
      "requested:T-TRIPLE -> null",
    ].sort();
    assert.deepEqual(changedDetails(before017, after017), expected);
  });

  it("a second run changes nothing", async () => {
    await applyMigrations(db, { after: "016" });
    assert.deepEqual(await history(db), after017);
    for (const pair of pairs) assert.equal((await h.stored(groupId, pair.student)).message, pair.note);
  });
});
