/**
 * Former admins and pending join-request notes (migration 018).
 *
 * Admins are notified of every join request, and while the request is
 * pending its note is the event's detail. 015's read policy let anyone
 * holding a notification read the event, so an admin who was later demoted,
 * left or was removed kept reading the note. 018 narrows only that branch.
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { applyMigrations, as, createDatabase, createUser, onboard, rows, type Db } from "./harness.mts";

type Story = { ids: Record<string, string>; group: string; event: string; inviteEvent: string };

/**
 * Asha, Ravi, Dev and Tara are admins when Kiran asks to join (all four are
 * notified), and Tara invites Zed with a note. Ravi has read his
 * notifications. Then Ravi is demoted, Dev leaves and Tara is removed.
 */
async function story(db: Db): Promise<Story> {
  const call = (user: string, sql: string, params: unknown[] = []) => as(db, user, () => rows(db, sql, params));
  const ids: Record<string, string> = {};
  for (const name of ["asha", "ravi", "dev", "tara", "kiran", "zed"]) {
    ids[name] = await createUser(db, `${name}@srmist.edu.in`);
    await onboard(db, ids[name], "need_flat", name);
  }
  const [{ id: group }] = (await call(ids.asha, "insert into public.groups (name, created_by, is_discoverable) values ('Night owls', $1, true) returning id", [ids.asha])) as Array<{ id: string }>;
  await db.query("update public.groups set max_members = 10");
  for (const name of ["ravi", "dev", "tara"]) {
    await call(ids.asha, "select public.invite_to_group($1, $2, null)", [group, ids[name]]);
    await call(ids[name], "select public.respond_to_group_invite($1, true)", [group]);
    await call(ids.asha, "select public.set_group_member_role($1, $2, 'admin')", [group, ids[name]]);
  }
  await call(ids.kiran, "select public.request_to_join_group($1, 'PRIVATE-NOTE')", [group]);
  await call(ids.tara, "select public.invite_to_group($1, $2, 'INVITE-NOTE')", [group, ids.zed]);
  await db.query("update public.notifications set read_at = now() - interval '1 hour' where recipient_id = $1", [ids.ravi]);
  await call(ids.asha, "select public.set_group_member_role($1, $2, 'member')", [group, ids.ravi]);
  await call(ids.dev, "select public.leave_group($1)", [group]);
  await call(ids.asha, "select public.remove_group_member($1, $2)", [group, ids.tara]);
  const [{ id: event }] = await rows<{ id: string }>(db, "select id from public.group_events where kind = 'requested' and subject_id = $1", [ids.kiran]);
  const [{ id: inviteEvent }] = await rows<{ id: string }>(db, "select id from public.group_events where kind = 'invited' and subject_id = $1", [ids.zed]);
  return { ids, group, event, inviteEvent };
}

/** Every event `who` can read, as "kind:subject:detail". */
async function visible(db: Db, s: Story, who: string): Promise<string[]> {
  const names = new Map(Object.entries(s.ids).map(([name, id]) => [id, name]));
  const found = await as(db, s.ids[who], () =>
    rows<{ kind: string; subject_id: string | null; detail: string | null }>(db, "select kind, subject_id, detail from public.group_events"),
  );
  return found.map((e) => `${e.kind}:${names.get(e.subject_id ?? "") ?? "-"}:${e.detail ?? "-"}`).sort();
}

/** What `who` sees of the pending request, every way a student could ask. */
async function requestNote(db: Db, s: Story, who: string) {
  return as(db, s.ids[who], async () => ({
    history: (await rows<{ detail: string | null }>(db, "select detail from public.group_events where id = $1", [s.event])).map((r) => r.detail),
    notification: (await rows<{ detail: string | null }>(
      db,
      "select e.detail from public.notifications n left join public.group_events e on e.id = n.event_id where n.event_id = $1",
      [s.event],
    )).map((r) => r.detail),
    function: (await rows<{ message: string }>(db, "select message from public.group_membership_notes(array[$1]::uuid[]) where profile_id = $2", [s.group, s.ids.kiran])).map((r) => r.message),
  }));
}

const FORMER = [
  { who: "ravi", how: "demotion" },
  { who: "dev", how: "leaving" },
  { who: "tara", how: "removal" },
] as const;

describe("former admins and pending request notes (018)", () => {
  let db: Db;
  let s: Story;

  before(async () => {
    db = await createDatabase();
    s = await story(db);
  });

  it("1. a current admin reads the pending note: history, notification and note function", async () => {
    assert.deepEqual(await requestNote(db, s, "asha"), { history: ["PRIVATE-NOTE"], notification: ["PRIVATE-NOTE"], function: ["PRIVATE-NOTE"] });
  });

  it("2. a former admin who was notified still holds the notification, but not the note", async () => {
    for (const { who } of FORMER) {
      const [held] = await as(db, s.ids[who], () => rows<{ n: number }>(db, "select count(*)::int as n from public.notifications where event_id = $1", [s.event]));
      assert.equal(held.n, 1, `${who} still has the notification`);
      // The notification is there, its event is not readable while the note is pending.
      assert.deepEqual(await requestNote(db, s, who), { history: [], notification: [null], function: [] }, who);
    }
  });

  for (const { who, how } of FORMER) {
    it(`${how === "demotion" ? 3 : how === "leaving" ? 4 : 5}. a former admin loses access after ${how}`, async () => {
      assert.ok(!(await visible(db, s, who)).some((e) => e.includes("PRIVATE-NOTE")), who);
    });
  }

  it("6. the requesting student still reads their own note", async () => {
    const own = await requestNote(db, s, "kiran");
    assert.deepEqual(own.history, ["PRIVATE-NOTE"]);
    assert.deepEqual(own.function, ["PRIVATE-NOTE"]);
  });

  it("7. invitation notes are unchanged: the invitee, the inviter (even after removal) and current admins", async () => {
    const invite = (who: string) =>
      as(db, s.ids[who], () => rows<{ detail: string }>(db, "select detail from public.group_events where id = $1", [s.inviteEvent]));
    assert.deepEqual(await invite("zed"), [{ detail: "INVITE-NOTE" }], "invitee");
    assert.deepEqual(await invite("tara"), [{ detail: "INVITE-NOTE" }], "the inviter, now removed: her own words");
    assert.deepEqual(await invite("asha"), [{ detail: "INVITE-NOTE" }], "current admin");
    assert.deepEqual(await invite("ravi"), [], "a former admin who wasn't involved never could");
    const [notified] = await as(db, s.ids.zed, () =>
      rows<{ detail: string }>(db, "select e.detail from public.notifications n join public.group_events e on e.id = n.event_id where n.event_id = $1", [s.inviteEvent]),
    );
    assert.equal(notified.detail, "INVITE-NOTE", "the invitee's notification still quotes it");
  });

  it("10. role-change notifications are unaffected", async () => {
    const roles = (await visible(db, s, "ravi")).filter((e) => e.startsWith("role_changed:"));
    assert.deepEqual(roles, ["role_changed:ravi:admin", "role_changed:ravi:member"]);
  });

  it("11. no direct query gets around the policy", async () => {
    await as(db, s.ids.ravi, async () => {
      assert.deepEqual(await rows(db, "select * from public.group_events where detail = 'PRIVATE-NOTE'"), []);
      assert.deepEqual(await rows(db, "select * from public.group_events where id in (select event_id from public.notifications)").then((r) => r.filter((e) => e.detail === "PRIVATE-NOTE")), []);
      assert.deepEqual(await rows(db, "select count(*)::int as n from public.group_events where kind = 'requested' and detail is not null"), [{ n: 0 }]);
      await assert.rejects(rows(db, "select message from public.group_members"), /permission denied/);
      await assert.rejects(rows(db, "update public.group_events set detail = detail"), /permission denied/);
    });
  });

  it("unread badge: the plain unread count still includes the hidden request; counting through visible events doesn't", async () => {
    // Dev hasn't read anything. The app's badge (countUnreadNotifications) counts notification rows.
    const [badge] = await as(db, s.ids.dev, () => rows<{ n: number }>(db, "select count(*)::int as n from public.notifications where read_at is null"));
    const [listed] = await as(db, s.ids.dev, () =>
      rows<{ n: number }>(db, "select count(*)::int as n from public.notifications n join public.group_events e on e.id = n.event_id where n.read_at is null"),
    );
    assert.equal(badge.n, listed.n + 1, "the badge counts one notification the list can't show while the request is pending");
  });

  it("the deployed policy is the narrowed one (the release check V7)", async () => {
    const [policy] = await rows<{ policies: number; narrowed: boolean }>(
      db,
      `select (select count(*)::int from pg_policy where polrelid = 'public.group_events'::regclass) as policies,
              (select pg_get_expr(polqual, polrelid) like '%detail IS NOT NULL%' from pg_policy
                where polrelid = 'public.group_events'::regclass and polname = 'group_events: involved people read') as narrowed`,
    );
    assert.deepEqual(policy, { policies: 1, narrowed: true });
  });
});

describe("018 applied to an existing 017 database", () => {
  let db: Db;
  let s: Story;
  type Snapshot = { events: unknown[]; notifications: unknown[] };
  const snapshot = async (): Promise<Snapshot> => ({
    events: await rows(db, "select * from public.group_events order by id"),
    notifications: await rows(db, "select * from public.notifications order by id"),
  });
  let before018: Snapshot;

  before(async () => {
    db = await createDatabase({ through: "017" });
    s = await story(db);
    before018 = await snapshot();
    await applyMigrations(db, { after: "017" });
  });

  it("8. no event or notification row changes, read state included, and former admins can still mark theirs read", async () => {
    assert.deepEqual(await snapshot(), before018);
    const marked = await as(db, s.ids.dev, () => rows(db, "update public.notifications set read_at = now() where event_id = $1 returning id", [s.event]));
    assert.equal(marked.length, 1, "Dev can still mark the hidden request's notification read");
  });

  it("a second run changes nothing", async () => {
    const policy = () => rows(db, "select polname, polcmd, polroles::text, pg_get_expr(polqual, polrelid) as qual from pg_policy where polrelid = 'public.group_events'::regclass");
    const once = await policy();
    await applyMigrations(db, { after: "017" });
    assert.deepEqual(await policy(), once);
  });

  it("9. once the request is settled, the former admins see the event again, without the note", async () => {
    await as(db, s.ids.asha, () => rows(db, "select public.review_join_request($1, $2, false)", [s.group, s.ids.kiran]));
    for (const { who } of FORMER) {
      assert.deepEqual((await requestNote(db, s, who)).notification, [null], who);
      assert.ok((await visible(db, s, who)).includes("requested:kiran:-"), `${who} sees the settled request, no note`);
    }
  });
});

describe("018 changes exactly one thing (017 alone vs 017 + 018, same story)", () => {
  it("the only difference: former admins no longer see the pending request with its note", async () => {
    const without = await createDatabase({ through: "017" });
    const withIt = await createDatabase();
    const [a, b] = [await story(without), await story(withIt)];
    for (const who of Object.keys(a.ids)) {
      const [old, now] = [await visible(without, a, who), await visible(withIt, b, who)];
      const lost = old.filter((e) => !now.includes(e));
      const gained = now.filter((e) => !old.includes(e));
      const expected = FORMER.some((f) => f.who === who) ? ["requested:kiran:PRIVATE-NOTE"] : [];
      assert.deepEqual({ lost, gained }, { lost: expected, gained: [] }, who);
    }
  });
});
