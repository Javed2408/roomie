/**
 * Group chat (migration 016): who can read and write, what happens the
 * moment membership ends, system messages, read state and unread counts,
 * and that one-to-one chat is untouched.
 *
 * Realtime itself can't run in this test database. It applies the SAME
 * row-level security policy to every event it delivers, so "what a student
 * can select right now" is exactly "what they would receive live": the
 * revocation tests check that.
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

import { affected, as, createDatabase, createLegacyUser, createUser, onboard, rows, type Db } from "./harness.mts";

describe("group chat", () => {
  let db: Db;
  let asha: string; // admin of the group
  let ravi: string; // active member
  let kiran: string; // invited, hasn't answered
  let dev: string; // asked to join, not approved
  let nila: string; // was a member, removed
  let meera: string; // outsider; admin of another group
  let gita: string; // non-SRM account
  let group: string;
  let other: string;

  function rpc<T = Record<string, unknown>>(user: string, sql: string, params: unknown[] = []) {
    return as(db, user, () => rows<T>(db, sql, params));
  }
  const say = (user: string, text: string, groupId = group) =>
    rpc(user, "insert into public.group_messages (group_id, sender_id, content) values ($1, $2, $3)", [groupId, user, text]);
  /** What a student can read right now: ordinary messages, oldest first. */
  async function readText(user: string, groupId = group) {
    return (
      await rpc<{ content: string }>(
        user,
        "select content from public.group_messages where group_id = $1 and message_type = 'user' order by created_at, id",
        [groupId],
      )
    ).map((row) => row.content);
  }
  const systemKinds = async (user: string, groupId = group) =>
    (
      await rpc<{ system_kind: string }>(
        user,
        "select system_kind from public.group_messages where group_id = $1 and message_type = 'system' order by created_at, id",
        [groupId],
      )
    ).map((row) => row.system_kind);
  const countAll = async (user: string, groupId = group) =>
    (await rpc<{ n: number }>(user, "select count(*)::int as n from public.group_messages where group_id = $1", [groupId]))[0].n;
  const unreadFor = async (user: string, groupId = group) =>
    (await rpc<{ unread_count: number }>(user, "select unread_count from public.group_chat_summaries() where group_id = $1", [groupId]))[0]?.unread_count;
  const setTimes = (text: string, iso: string) =>
    db.query("update public.group_messages set created_at = $2 where content = $1", [text, iso]);
  const call = (user: string, sql: string, params: unknown[]) => rpc(user, sql, params);

  before(async () => {
    db = await createDatabase();
    asha = await createUser(db, "asha@srmist.edu.in");
    ravi = await createUser(db, "ravi@srmist.edu.in");
    kiran = await createUser(db, "kiran@srmist.edu.in");
    dev = await createUser(db, "dev@srmist.edu.in");
    nila = await createUser(db, "nila@srmist.edu.in");
    meera = await createUser(db, "meera@srmist.edu.in");
    gita = await createLegacyUser(db, "gita@gmail.com");
    for (const [id, name] of [[asha, "Asha"], [ravi, "Ravi"], [kiran, "Kiran"], [dev, "Dev"], [nila, "Nila"], [meera, "Meera"]] as const) {
      await onboard(db, id, "need_flat", name);
    }
  });

  beforeEach(async () => {
    await db.query("delete from public.groups");
    await db.query("delete from public.blocks");
    await db.query("update auth.users set email_confirmed_at = now() where email_confirmed_at is null");
    group = (await rpc<{ id: string }>(asha, "insert into public.groups (name, created_by, max_members) values ('Night owls', $1, 6) returning id", [asha]))[0].id;
    other = (await rpc<{ id: string }>(meera, "insert into public.groups (name, created_by, max_members) values ('Other crew', $1, 6) returning id", [meera]))[0].id;
    for (const student of [ravi, nila]) {
      await call(asha, "select public.invite_to_group($1, $2)", [group, student]);
      await call(student, "select public.respond_to_group_invite($1, true)", [group]);
    }
    await call(asha, "select public.remove_group_member($1, $2)", [group, nila]);
    await call(asha, "select public.invite_to_group($1, $2, 'Secret invite note')", [group, kiran]);
    await call(dev, "select public.request_to_join_group($1, 'Secret request note')", [group]);
  });

  describe("who can read and write", () => {
    it("lets an active member read and send, with the database setting the time", async () => {
      await say(asha, "Welcome, night owls");
      await say(ravi, "Hi all!");
      assert.deepEqual(await readText(ravi), ["Welcome, night owls", "Hi all!"]);
      const [row] = await rpc<{ created_at: Date; message_type: string }>(ravi, "select created_at, message_type from public.group_messages where content = 'Hi all!'");
      assert.equal(row.message_type, "user");
      assert.ok(Math.abs(row.created_at.getTime() - Date.now()) < 60_000);
    });

    it("keeps non-members out, both ways, even with the right group id", async () => {
      await say(asha, "Members only");
      assert.equal(await countAll(meera), 0);
      await as(db, meera, () => assert.rejects(say(meera, "Let me in"), /row-level security/));
      assert.equal(await countAll(gita), 0);
    });

    it("keeps invited and requested students out, with their notes private", async () => {
      await say(asha, "Not for you yet");
      for (const student of [kiran, dev]) {
        assert.equal(await countAll(student), 0);
        await as(db, student, () => assert.rejects(say(student, "Hello?"), /row-level security/));
      }
      const everything = JSON.stringify(await rpc(ravi, "select * from public.group_messages"));
      assert.ok(!everything.includes("Secret"), "no invitation or request note in any message");
    });

    it("keeps anonymous visitors out", async () => {
      await as(db, null, () => assert.rejects(db.query("select * from public.group_messages"), /permission denied/));
      await as(db, null, () => assert.rejects(db.query("select * from public.group_chat_summaries()"), /permission denied/));
    });

    it("refuses accounts that aren't eligible SRM students, even as active members", async () => {
      // A non-SRM account made an active member behind the app's back.
      await db.query("insert into public.group_members (group_id, profile_id, role, status, joined_at) values ($1, $2, 'member', 'active', now())", [group, gita]);
      await say(asha, "Hello group");
      assert.equal(await countAll(gita), 0);
      await as(db, gita, () => assert.rejects(say(gita, "Hi"), /row-level security/));
      // And an SRM member whose email stops being confirmed loses it too.
      await db.query("update auth.users set email_confirmed_at = null where id = $1", [ravi]);
      assert.equal(await countAll(ravi), 0);
      await as(db, ravi, () => assert.rejects(say(ravi, "Still here?"), /row-level security/));
    });

    it("refuses sends to a closed group but keeps its history readable", async () => {
      await say(asha, "Before closing");
      await call(asha, "update public.groups set status = 'archived' where id = $1", [group]);
      await as(db, ravi, () => assert.rejects(say(ravi, "Too late"), /row-level security/));
      assert.deepEqual(await readText(ravi), ["Before closing"]);
    });

    it("limits message length and refuses empty messages", async () => {
      await say(ravi, "x".repeat(2000));
      for (const bad of ["", "   ", "x".repeat(2001)]) {
        await as(db, ravi, () => assert.rejects(say(ravi, bad), /check constraint/));
      }
    });
  });

  describe("integrity", () => {
    it("can't send as someone else", async () => {
      await as(db, ravi, () =>
        assert.rejects(
          db.query("insert into public.group_messages (group_id, sender_id, content) values ($1, $2, 'I am Asha')", [group, asha]),
          /row-level security/,
        ),
      );
    });

    it("can't send into another group", async () => {
      await as(db, ravi, () => assert.rejects(say(ravi, "Wrong room", other), /row-level security/));
      await say(meera, "Other crew only", other);
      assert.equal(await countAll(ravi, other), 0);
      assert.equal(await countAll(ravi, group) > 0, true, "their own group is unaffected");
    });

    it("can't write system messages, timestamps or kinds directly", async () => {
      const attempts = [
        "insert into public.group_messages (group_id, sender_id, content, message_type) values ($1, $2, 'x', 'user')",
        "insert into public.group_messages (group_id, message_type, system_kind, event_id) values ($1, 'system', 'joined', gen_random_uuid())",
        "insert into public.group_messages (group_id, sender_id, content, created_at) values ($1, $2, 'backdated', '2020-01-01')",
        "insert into public.group_messages (group_id, sender_id, content, system_kind) values ($1, $2, 'x', 'joined')",
      ];
      for (const sql of attempts) {
        await as(db, ravi, () => assert.rejects(db.query(sql, sql.includes("$2") ? [group, ravi] : [group]), /permission denied/));
      }
    });

    it("keeps messages immutable: no edits, no deletes", async () => {
      await say(ravi, "Final words");
      await as(db, ravi, async () => {
        await assert.rejects(db.query("update public.group_messages set content = 'edited' where content = 'Final words'"), /permission denied/);
        await assert.rejects(db.query("update public.group_messages set created_at = now() where content = 'Final words'"), /permission denied/);
        await assert.rejects(db.query("delete from public.group_messages where content = 'Final words'"), /permission denied/);
      });
      await as(db, asha, () => assert.rejects(db.query("delete from public.group_messages"), /permission denied/));
    });

    it("gives every message one stable id: a retried send can't duplicate", async () => {
      const id = "5b2f6a40-9a0b-4f0e-9d63-5d6a8b0c1d11";
      const send = () => rpc(ravi, "insert into public.group_messages (id, group_id, sender_id, content) values ($1, $2, $3, 'once')", [id, group, ravi]);
      await send();
      await as(db, ravi, () => assert.rejects(send(), /duplicate key/));
      assert.deepEqual((await readText(asha)).filter((text) => text === "once"), ["once"]);
    });
  });

  describe("membership ends: access ends with it", () => {
    it("cuts off a removed member from every message, old and new", async () => {
      await say(asha, "Before");
      await say(ravi, "Ravi's message");
      assert.equal((await readText(ravi)).length, 2);
      await call(asha, "select public.remove_group_member($1, $2)", [group, ravi]);

      assert.equal(await countAll(ravi), 0, "history is gone");
      await as(db, ravi, () => assert.rejects(say(ravi, "Still talking"), /row-level security/));
      await say(asha, "After removal"); // what a live subscription would be offered
      assert.equal(await countAll(ravi), 0, "new messages are not visible either");
      assert.deepEqual(await readText(asha), ["Before", "Ravi's message", "After removal"]);
    });

    it("cuts off a member who leaves, including everything they wrote", async () => {
      await say(ravi, "Written while a member");
      await call(ravi, "select public.leave_group($1)", [group]);
      assert.equal(await countAll(ravi), 0);
      await as(db, ravi, () => assert.rejects(say(ravi, "Goodbye"), /row-level security/));
      await as(db, ravi, () => assert.rejects(db.query("select public.mark_group_chat_read($1)", [group]), /not in this group/));
      assert.deepEqual(await readText(asha), ["Written while a member"], "the others keep the history");
      assert.equal(await unreadFor(ravi), undefined, "no longer in their chat list");
    });

    it("restores access only once membership is active again, with the full history", async () => {
      await say(asha, "Before leaving");
      await call(ravi, "select public.leave_group($1)", [group]);
      await say(asha, "While away");
      await call(ravi, "select public.request_to_join_group($1)", [group]);
      assert.equal(await countAll(ravi), 0, "requested is not enough");
      await call(asha, "select public.review_join_request($1, $2, true)", [group, ravi]);
      assert.deepEqual(await readText(ravi), ["Before leaving", "While away"]);
      await say(ravi, "I'm back");
    });

    it("lets a new member read what was said before they joined", async () => {
      await say(asha, "Before Kiran");
      await call(kiran, "select public.respond_to_group_invite($1, true)", [group]);
      assert.deepEqual(await readText(kiran), ["Before Kiran"]);
    });

    it("never lets a removed member back in on their own", async () => {
      await say(asha, "Private");
      await as(db, nila, () => assert.rejects(db.query("select public.request_to_join_group($1)", [group]), /can't rejoin/));
      assert.equal(await countAll(nila), 0);
    });
  });

  describe("system messages", () => {
    it("announces joins, leaves, removals and role changes, once each", async () => {
      // beforeEach: ravi and nila joined, nila removed.
      assert.deepEqual(await systemKinds(asha), ["joined", "joined", "removed"]);
      await call(asha, "select public.set_group_member_role($1, $2, 'admin')", [group, ravi]);
      await call(asha, "select public.set_group_member_role($1, $2, 'member')", [group, ravi]);
      await call(ravi, "select public.leave_group($1)", [group]);
      assert.deepEqual(await systemKinds(asha), ["joined", "joined", "removed", "made_admin", "removed_admin", "left"]);
      const removal = await rpc<{ subject_id: string; actor_id: string }>(asha, "select subject_id, actor_id from public.group_messages where system_kind = 'removed'");
      assert.deepEqual(removal, [{ subject_id: nila, actor_id: asha }]);
    });

    it("announces an automatic hand-over when the only admin leaves", async () => {
      await call(asha, "select public.leave_group($1)", [group]);
      const kinds = await systemKinds(ravi);
      assert.deepEqual([...kinds.slice(-2)].sort(), ["left", "made_admin"]);
      // "left" is stamped first. This test database's clock ticks once per
      // millisecond, so the two can share a time here (and then tie-break by
      // id); real Postgres stamps in microseconds. So check the stamps, not
      // the displayed order.
      const [{ in_order }] = await rpc<{ in_order: boolean }>(
        ravi,
        `select (select max(created_at) from public.group_messages where group_id = $1 and system_kind = 'left')
             <= (select max(created_at) from public.group_messages where group_id = $1 and system_kind = 'made_admin') as in_order`,
        [group],
      );
      assert.equal(in_order, true, "left is stamped no later than made_admin");
    });

    it("doesn't repeat itself when operations are repeated", async () => {
      await call(asha, "select public.set_group_member_role($1, $2, 'admin')", [group, ravi]);
      await call(asha, "select public.set_group_member_role($1, $2, 'admin')", [group, ravi]);
      await call(asha, "select public.invite_to_group($1, $2)", [group, kiran]);
      await call(dev, "select public.request_to_join_group($1)", [group]);
      assert.deepEqual(await systemKinds(asha), ["joined", "joined", "removed", "made_admin"]);
      // And the database refuses a second message for one event.
      const [message] = await rows<{ event_id: string }>(db, "select event_id from public.group_messages where message_type = 'system' limit 1");
      await assert.rejects(
        db.query("insert into public.group_messages (group_id, message_type, system_kind, event_id) values ($1, 'system', 'joined', $2)", [group, message.event_id]),
        /duplicate key/,
      );
    });

    it("says nothing about invitations, requests, declines or cancellations", async () => {
      await call(asha, "select public.cancel_group_invite($1, $2)", [group, kiran]);
      await call(asha, "select public.review_join_request($1, $2, false)", [group, dev]);
      assert.deepEqual(await systemKinds(asha), ["joined", "joined", "removed"]);
      const dump = JSON.stringify(await rpc(asha, "select * from public.group_messages"));
      assert.ok(!dump.includes("Secret"));
    });

    it("is visible to members, and to nobody else", async () => {
      assert.equal((await systemKinds(ravi)).length, 3);
      assert.equal((await systemKinds(meera)).length, 0);
      assert.equal((await systemKinds(kiran)).length, 0);
    });
  });

  describe("read state and unread counts", () => {
    it("counts other people's messages since you last read, never your own", async () => {
      await say(asha, "one");
      await say(asha, "two");
      await say(ravi, "mine");
      await setTimes("one", "2026-01-01T10:00:00Z");
      await setTimes("two", "2026-01-01T10:05:00Z");
      await setTimes("mine", "2026-01-01T10:06:00Z");
      await db.query("update public.group_members set joined_at = '2025-12-31T00:00:00Z' where profile_id = $1 and group_id = $2", [ravi, group]);
      assert.equal(await unreadFor(ravi), 2);
      await call(ravi, "select public.mark_group_chat_read($1, '2026-01-01T10:00:00Z')", [group]);
      assert.equal(await unreadFor(ravi), 1);
      await call(ravi, "select public.mark_group_chat_read($1, '2026-01-01T10:05:00Z')", [group]);
      assert.equal(await unreadFor(ravi), 0);
    });

    it("doesn't count system messages or history from before you joined", async () => {
      await say(asha, "ancient");
      await setTimes("ancient", "2020-01-01T00:00:00Z");
      await call(kiran, "select public.respond_to_group_invite($1, true)", [group]);
      assert.equal(await unreadFor(kiran), 0);
      await say(asha, "fresh");
      assert.equal(await unreadFor(kiran), 1);
      await call(ravi, "select public.leave_group($1)", [group]);
      assert.equal(await unreadFor(kiran), 1, "'Ravi left' is not an unread message");
    });

    it("never moves backwards or into the future, and persists", async () => {
      await say(asha, "hello");
      const first = (await call(ravi, "select public.mark_group_chat_read($1, '2031-01-01T00:00:00Z') as at", [group]))[0].at as Date;
      assert.ok(first.getTime() <= Date.now() + 5000, "clamped to now");
      const second = (await call(ravi, "select public.mark_group_chat_read($1, '2020-01-01T00:00:00Z') as at", [group]))[0].at as Date;
      assert.equal(second.getTime(), first.getTime(), "an older mark changes nothing");
      const [stored] = await rows<{ last_read_at: Date }>(db, "select last_read_at from public.group_chat_reads where group_id = $1 and profile_id = $2", [group, ravi]);
      assert.equal(stored.last_read_at.getTime(), first.getTime());
    });

    it("keeps each member's read state to themselves", async () => {
      await call(ravi, "select public.mark_group_chat_read($1)", [group]);
      await call(asha, "select public.mark_group_chat_read($1)", [group]);
      assert.equal((await rpc(ravi, "select * from public.group_chat_reads")).length, 1);
      assert.equal((await rpc(meera, "select * from public.group_chat_reads")).length, 0);
      await as(db, ravi, async () => {
        await assert.rejects(db.query("insert into public.group_chat_reads (group_id, profile_id, last_read_at) values ($1, $2, now())", [group, ravi]), /permission denied/);
        await assert.rejects(db.query("update public.group_chat_reads set last_read_at = 'epoch'"), /permission denied/);
      });
      assert.equal(await affected(db, "select 1"), 0);
    });

    it("only lets active members mark a group read", async () => {
      for (const student of [meera, kiran, dev, nila]) {
        await as(db, student, () => assert.rejects(db.query("select public.mark_group_chat_read($1)", [group]), /not in this group/));
      }
    });

    it("caps big counts at 100 without loading every message", async () => {
      await db.query(
        `insert into public.group_messages (group_id, sender_id, content, created_at)
         select $1, $2, 'bulk ' || n, now() + (n || ' seconds')::interval from generate_series(1, 130) as n`,
        [group, asha],
      );
      assert.equal(await unreadFor(ravi), 100);
    });

    it("summarises each chat: newest message and unread, only for groups you're in", async () => {
      await say(asha, "latest words");
      const [summary] = await rpc<{ last_type: string; last_content: string; unread_count: number }>(
        ravi,
        "select last_type, last_content, unread_count from public.group_chat_summaries() where group_id = $1",
        [group],
      );
      assert.deepEqual(summary, { last_type: "user", last_content: "latest words", unread_count: 1 });
      const ids = (await rpc<{ group_id: string }>(ravi, "select group_id from public.group_chat_summaries()")).map((row) => row.group_id);
      assert.deepEqual(ids, [group]);
    });
  });

  describe("blocks (either direction, as in 013)", () => {
    // Ravi blocks Asha. Kiran joins as an unrelated third member.
    async function setUp() {
      await call(kiran, "select public.respond_to_group_invite($1, true)", [group]);
      await say(asha, "from Asha");
      await say(ravi, "from Ravi");
      await say(kiran, "from Kiran");
      // Distinct times (just after joining, so they still count as unread).
      for (const [index, text] of ["from Asha", "from Ravi", "from Kiran"].entries()) {
        await setTimes(text, new Date(Date.now() + (index + 1) * 1000).toISOString());
      }
      await rpc(ravi, "insert into public.blocks (blocker_id, blocked_id) values ($1, $2)", [ravi, asha]);
    }

    it("A blocks B: A can't read B's messages", async () => {
      await setUp();
      assert.deepEqual(await readText(ravi), ["from Ravi", "from Kiran"]);
      await say(asha, "after the block");
      assert.ok(!(await readText(ravi)).includes("after the block"), "nor any new ones");
    });

    it("A blocks B: B can't read A's messages either", async () => {
      await setUp();
      assert.deepEqual(await readText(asha), ["from Asha", "from Kiran"]);
      await say(ravi, "Ravi again");
      assert.ok(!(await readText(asha)).includes("Ravi again"), "nor any new ones");
    });

    it("both still read everyone else, and everyone else reads both", async () => {
      await setUp();
      assert.ok((await readText(ravi)).includes("from Kiran"));
      assert.ok((await readText(asha)).includes("from Kiran"));
      assert.deepEqual(await readText(kiran), ["from Asha", "from Ravi", "from Kiran"]);
    });

    it("keeps system messages readable by every eligible active member", async () => {
      await setUp();
      const everyone = await systemKinds(kiran);
      assert.deepEqual(everyone, ["joined", "joined", "removed", "joined"]);
      assert.deepEqual(await systemKinds(ravi), everyone);
      assert.deepEqual(await systemKinds(asha), everyone);
    });

    it("leaves hidden messages out of unread counts and previews, both ways", async () => {
      await setUp();
      await say(ravi, "latest from Ravi");
      const summary = async (user: string) =>
        (await rpc<{ unread_count: number; last_content: string | null }>(user, "select unread_count, last_content from public.group_chat_summaries() where group_id = $1", [group]))[0];
      assert.deepEqual(await summary(asha), { unread_count: 1, last_content: "from Kiran" });
      assert.equal((await summary(ravi)).unread_count, 1, "only Kiran's: his own don't count and Asha's are hidden");
    });

    it("shows everything again once the block is lifted", async () => {
      await setUp();
      await rpc(ravi, "delete from public.blocks where blocker_id = $1 and blocked_id = $2", [ravi, asha]);
      assert.deepEqual(await readText(asha), ["from Asha", "from Ravi", "from Kiran"]);
      assert.deepEqual(await readText(ravi), ["from Asha", "from Ravi", "from Kiran"]);
    });

    it("can't be used to find out who blocked you outside your own chats", async () => {
      await setUp();
      const [{ id }] = await rows<{ id: string }>(db, "select id from public.group_messages where content = 'from Ravi'");
      const ask = (user: string) =>
        rpc<{ hidden: boolean }>(user, "select public.group_message_blocked($1) as hidden", [id]).then(([row]) => row.hidden);
      assert.equal(await ask(asha), true, "inside the chat: matches what she sees");
      assert.equal(await ask(kiran), false, "no block: nothing hidden");
      assert.equal(await ask(ravi), false, "never your own message");
      // Meera blocks Ravi but isn't in the group: no answer either way.
      await rpc(meera, "insert into public.blocks (blocker_id, blocked_id) values ($1, $2)", [meera, ravi]);
      assert.equal(await ask(meera), false);
      // Asha leaves: she loses the answer along with the chat.
      await call(asha, "select public.leave_group($1)", [group]);
      assert.equal(await ask(asha), false);
      await as(db, null, () => assert.rejects(db.query("select public.group_message_blocked($1)", [id]), /permission denied/));
    });

    it("tells an ineligible account nothing, even as an active member with a block and a message id", async () => {
      await setUp();
      const [{ id }] = await rows<{ id: string }>(db, "select id from public.group_messages where content = 'from Asha'");
      const ask = (user: string) =>
        rpc<{ hidden: boolean }>(user, "select public.group_message_blocked($1) as hidden", [id]).then(([row]) => row.hidden);
      // A non-SRM account made an active member, with a block, behind the app's back.
      await db.query("insert into public.group_members (group_id, profile_id, role, status, joined_at) values ($1, $2, 'member', 'active', now())", [group, gita]);
      await db.query("insert into public.blocks (blocker_id, blocked_id) values ($1, $2)", [gita, asha]);
      assert.equal(await ask(gita), false);
      // An SRM member whose email stops being confirmed: Ravi, who blocked Asha.
      assert.equal(await ask(ravi), true, "while eligible, it matches what he sees");
      await db.query("update auth.users set email_confirmed_at = null where id = $1", [ravi]);
      assert.equal(await ask(ravi), false);
    });
  });

  describe("realtime and individual chat", () => {
    it("publishes group messages and notifications to Realtime, alongside the one-to-one messages", async () => {
      const tables = (await rows<{ tablename: string }>(db, "select tablename from pg_publication_tables where pubname = 'supabase_realtime'")).map((row) => row.tablename);
      for (const table of ["messages", "group_messages", "notifications"]) {
        assert.ok(tables.includes(table), table);
      }
    });

    it("leaves one-to-one chat exactly as it was", async () => {
      await db.query("insert into public.swipes (sender_id, receiver_id, action, comment) values ($1, $2, 'like', 'Hi'), ($2, $1, 'like', null)", [asha, meera]);
      const [match] = await rows<{ id: string }>(db, "select id from public.matches");
      await rpc(asha, "insert into public.messages (id, match_id, sender_id, content) values (gen_random_uuid(), $1, $2, 'Hello Meera')", [match.id, asha]);
      assert.deepEqual((await rpc(meera, "select content from public.messages where match_id = $1", [match.id])).map((row) => row.content), ["Hello Meera"]);
      assert.equal((await rpc(ravi, "select * from public.messages")).length, 0, "other pairs still can't read it");
      await as(db, ravi, () => assert.rejects(db.query("insert into public.messages (match_id, sender_id, content) values ($1, $2, 'Intruder')", [match.id, ravi]), /row-level security/));
      assert.equal((await rpc(meera, "select content from public.latest_messages where match_id = $1", [match.id])).length, 1);
      assert.equal(await countAll(meera, group), 0, "and group chat doesn't leak into it, or the other way round");
      await db.query("delete from public.matches");
    });
  });
});
