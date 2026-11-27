/**
 * Migration 018 under real concurrency: a disposable PostgreSQL in Docker,
 * several independent connections (one psql process, so one server backend,
 * each), with lock waits observed in pg_stat_activity / pg_locks.
 *
 * Not part of `npm test` (it needs Docker). From the project folder:
 *
 *   node --disable-warning=ExperimentalWarning --test tests/concurrency/former-admin-notes.concurrency.mts
 *
 * The container has no network, sees the migrations read-only and is removed
 * at the end. Nothing here talks to Supabase.
 *
 * shortcut: the Docker / psql plumbing below is a trimmed copy of the one in
 * membership-notes.concurrency.mts, a frozen Phase 7A artifact; move both
 * onto one shared helper module once Phase 7A has shipped.
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { SUPABASE_STAND_IN } from "../db/harness.mts";

const IMAGE = process.env.ROOMIE_PG_IMAGE ?? "postgres:17-alpine";
const CONTAINER = `roomie-018-${process.pid}`;
const MIGRATIONS = join(import.meta.dirname, "..", "..", "supabase", "migrations");
const FILE_017 = "/migrations/017_group_membership_notes_privacy.sql";
const FILE_018 = "/migrations/018_revoke_former_admin_membership_note_access.sql";
const BS = "\\";

type Exit = { code: number; stdout: string; stderr: string };

function docker(args: string[], input = ""): Promise<Exit> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    child.stdin.end(input);
  });
}

async function psql(db: string, sql: string, single = true): Promise<void> {
  const run = await docker(["exec", "-i", CONTAINER, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", ...(single ? ["-1"] : []), "-U", "postgres", "-d", db, "-f", "-"], sql);
  if (run.code !== 0) throw new Error(`psql on ${db}: ${run.stderr}`);
}

/** Migration files run the way the SQL Editor runs a script: as ONE query (one implicit transaction). */
function runAsEditor(db: string, app: string, files: string[]): Promise<Exit> {
  return docker([
    "exec", "-e", `PGAPPNAME=${app}`, "-e", "PGOPTIONS=-c client_min_messages=warning", CONTAINER,
    "sh", "-c", `exec psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$1" -c "$(cat ${files.join(" ")})"`, "sh", db,
  ]);
}

type Outcome = { out: string; sqlstate: string; error: string };

/** One independent connection: a long-lived psql process. */
class Connection {
  pid = 0;
  readonly name: string;
  private readonly child: ChildProcessWithoutNullStreams;
  private stdout = "";
  private stderr = "";
  private readonly waiting: Array<(outcome: Outcome) => void> = [];

  private constructor(db: string, name: string) {
    this.name = name;
    this.child = spawn("docker", [
      "exec", "-i", "-e", `PGAPPNAME=${name}`, "-e", "PGOPTIONS=-c client_min_messages=warning", CONTAINER,
      "psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=0", "-U", "postgres", "-d", db,
    ]);
    this.child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      this.stdout += chunk;
      for (let m = /^__END__ (\w+)\n/m.exec(this.stdout); m; m = /^__END__ (\w+)\n/m.exec(this.stdout)) {
        const out = this.stdout.slice(0, m.index);
        const sqlstate = m[1];
        this.stdout = this.stdout.slice(m.index + m[0].length);
        const resolve = this.waiting.shift()!;
        setTimeout(() => {
          const error = this.stderr;
          this.stderr = "";
          resolve({ out, sqlstate, error });
        }, sqlstate === "00000" ? 0 : 100);
      }
    });
    this.child.stderr.setEncoding("utf8").on("data", (chunk: string) => (this.stderr += chunk));
    this.child.on("close", () => {
      for (const resolve of this.waiting.splice(0)) resolve({ out: "", sqlstate: "EXITED", error: this.stderr });
    });
  }

  static async open(db: string, name: string): Promise<Connection> {
    const connection = new Connection(db, name);
    connection.pid = Number((await connection.ok("select pg_backend_pid();")).trim());
    return connection;
  }

  send(sql: string): Promise<Outcome> {
    const outcome = new Promise<Outcome>((resolve) => this.waiting.push(resolve));
    this.child.stdin.write(`${BS}set LAST_ERROR_SQLSTATE 00000\n${sql}\n${BS}echo __END__ :LAST_ERROR_SQLSTATE\n`);
    return outcome;
  }

  async ok(sql: string): Promise<string> {
    const outcome = await this.send(sql);
    if (outcome.sqlstate !== "00000") throw new Error(`${this.name}: ${outcome.sqlstate} ${outcome.error}`);
    return outcome.out;
  }

  async rows<T = Record<string, unknown>>(query: string): Promise<T[]> {
    return JSON.parse(await this.ok(`with q as (${query}) select coalesce(json_agg(q), '[]'::json) from q;`)) as T[];
  }

  async close() {
    this.child.stdin.end();
    await Promise.race([new Promise((resolve) => this.child.once("close", resolve)), delay(3000)]);
    this.child.kill();
  }
}

function track<T>(promise: Promise<T>) {
  const state = { settled: false, promise };
  promise.then(() => (state.settled = true), () => (state.settled = true));
  return state;
}

/** Poll until `pid` waits for a lock that every one of `blockers` holds or is ahead for. */
async function waitUntilBlocked(observer: Connection, pid: number, blockers: number[]) {
  for (const deadline = Date.now() + 15_000; ; await delay(20)) {
    const [w] = await observer.rows<{ wait_event_type: string | null; blocking: number[] }>(
      `select wait_event_type, pg_blocking_pids(pid) as blocking from pg_stat_activity where pid = ${pid}`,
    );
    if (w?.wait_event_type === "Lock" && blockers.every((b) => w.blocking.includes(b))) return;
    if (Date.now() > deadline) throw new Error(`pid ${pid} never waited on ${blockers.join(", ")}: ${JSON.stringify(w)}`);
  }
}

async function pidOf(observer: Connection, app: string): Promise<number> {
  for (const deadline = Date.now() + 15_000; ; await delay(20)) {
    const [found] = await observer.rows<{ pid: number }>(`select pid from pg_stat_activity where application_name = '${app}'`);
    if (found) return found.pid;
    if (Date.now() > deadline) throw new Error(`no connection named ${app}`);
  }
}

const asStudent = (user: string) => `begin;\nset local role authenticated;\nset local request.jwt.claim.sub = '${user}';\n`;

/** The notifications page's event lookup (loadNotifications), as one statement. */
const eventsQuery = (ids: string[]) =>
  `select coalesce(json_agg(t), '[]'::json) from (select * from public.group_events where id = any('{${ids.join(",")}}'::uuid[])) as t;`;

// --- A world: Asha and Ravi were admins when Kiran asked to join; Ravi has since been demoted. ---

type World = { db: string; observer: Connection; ids: Record<string, string>; group: string; event: string; connections: Connection[] };

let admin: Connection;
let databases = 0;

async function world(template: "t016" | "t017"): Promise<World> {
  const db = `w${++databases}`;
  await admin.ok(`create database ${db} template ${template};`);
  const observer = await Connection.open(db, "observer");
  const ids: Record<string, string> = {};
  for (const name of ["asha", "ravi", "kiran"]) {
    ids[name] = randomUUID();
    await observer.ok(
      `insert into auth.users (id, email, email_confirmed_at) values ('${ids[name]}', '${name}@srmist.edu.in', now());
       update public.profiles set full_name = '${name}', mode = 'need_flat', gender = 'male', year_of_study = 2, department = 'CSE' where id = '${ids[name]}';`,
    );
  }
  const act = (who: string, sql: string) => observer.ok(`${asStudent(ids[who])}${sql}\ncommit;`);
  await observer.ok(asStudent(ids.asha));
  const [{ id: group }] = await observer.rows<{ id: string }>(
    `insert into public.groups (name, created_by, is_discoverable) values ('Night owls', '${ids.asha}', true) returning id`,
  );
  await observer.ok("commit;");
  await act("asha", `select public.invite_to_group('${group}', '${ids.ravi}', null);`);
  await act("ravi", `select public.respond_to_group_invite('${group}', true);`);
  await act("asha", `select public.set_group_member_role('${group}', '${ids.ravi}', 'admin');`);
  await act("kiran", `select public.request_to_join_group('${group}', 'PRIVATE-NOTE');`);
  await act("asha", `select public.set_group_member_role('${group}', '${ids.ravi}', 'member');`);
  const [{ id: event }] = await observer.rows<{ id: string }>(`select id from public.group_events where kind = 'requested'`);
  return { db, observer, ids, group, event, connections: [observer] };
}

async function connect(w: World, name: string) {
  const connection = await Connection.open(w.db, name);
  w.connections.push(connection);
  return connection;
}

async function closeWorld(w: World) {
  for (const connection of w.connections) await connection.close();
  await admin.ok(`drop database if exists ${w.db} with (force);`);
}

/** The pending request's note as `who` reads it through their notification (null: event not readable). */
async function seenBy(w: World, who: string): Promise<Array<string | null>> {
  await w.observer.ok(asStudent(w.ids[who]));
  const found = await w.observer.rows<{ detail: string | null }>(
    `select e.detail from public.notifications n left join public.group_events e on e.id = n.event_id where n.event_id = '${w.event}'`,
  );
  await w.observer.ok("rollback;");
  return found.map((r) => r.detail);
}

async function narrowed(o: Connection): Promise<boolean> {
  const [p] = await o.rows<{ narrowed: boolean }>(
    `select pg_get_expr(polqual, polrelid) like '%detail IS NOT NULL%' as narrowed from pg_policy
     where polrelid = 'public.group_events'::regclass and polname = 'group_events: involved people read'`,
  );
  return p.narrowed;
}

describe("migration 018 under real concurrency (disposable PostgreSQL in Docker)", { timeout: 600_000 }, () => {
  before(async () => {
    assert.equal((await docker(["version", "--format", "{{.Server.Version}}"])).code, 0, "Docker must be running");
    await docker(["rm", "-f", CONTAINER]);
    const started = await docker([
      "run", "-d", "--rm", "--name", CONTAINER, "--network", "none",
      "--mount", `type=bind,source=${MIGRATIONS},target=/migrations,readonly`,
      "-e", "POSTGRES_HOST_AUTH_METHOD=trust", IMAGE, "-c", "deadlock_timeout=1s",
    ]);
    assert.equal(started.code, 0, started.stderr);
    for (let i = 0; (await docker(["exec", CONTAINER, "pg_isready", "-q", "-h", "127.0.0.1", "-U", "postgres"])).code !== 0; i++) {
      if (i > 120) throw new Error("PostgreSQL did not start");
      await delay(250);
    }
    await psql("postgres", "create database t016;", false);
    await psql("t016", SUPABASE_STAND_IN);
    for (const file of (await readdir(MIGRATIONS)).filter((f) => /^\d{3}_.+\.sql$/.test(f) && f.slice(0, 3) <= "016").sort()) {
      const run = await docker(["exec", CONTAINER, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-1", "-U", "postgres", "-d", "t016", "-f", `/migrations/${file}`]);
      if (run.code !== 0) throw new Error(`${file}: ${run.stderr}`);
    }
    await psql("postgres", "create database t017 template t016;", false);
    assert.equal((await runAsEditor("t017", "template", [FILE_017])).code, 0);
    admin = await Connection.open("postgres", "admin");
  });

  after(async () => {
    await admin?.close();
    await docker(["rm", "-f", CONTAINER]);
  });

  it("set-up: on 017 alone, the demoted admin still reads the pending note through his notification", async () => {
    const w = await world("t017");
    try {
      assert.equal(await narrowed(w.observer), false);
      assert.deepEqual(await seenBy(w, "ravi"), ["PRIVATE-NOTE"]);
      assert.deepEqual(await seenBy(w, "asha"), ["PRIVATE-NOTE"]);
    } finally {
      await closeWorld(w);
    }
  });

  it("018 waits for an open history read, then applies; afterwards the former admin can't read the note, the current admin can", async () => {
    const w = await world("t017");
    try {
      const r = await connect(w, "history");
      await r.ok(`${asStudent(w.ids.ravi)}select count(*) from public.group_events;`);
      const migration = track(runAsEditor(w.db, "migration", [FILE_018]));
      await waitUntilBlocked(w.observer, await pidOf(w.observer, "migration"), [r.pid]);
      await delay(300);
      assert.equal(migration.settled, false, "018 waits while the read is open");
      await r.ok("commit;");
      const done = await migration.promise;
      assert.equal(done.code, 0, done.stderr);
      assert.equal(await narrowed(w.observer), true);
      assert.deepEqual(await seenBy(w, "ravi"), [null], "notification kept, note not readable");
      assert.deepEqual(await seenBy(w, "asha"), ["PRIVATE-NOTE"]);
    } finally {
      await closeWorld(w);
    }
  });

  it("while 018 holds its lock: group_events reads and writes wait, group_members and notifications don't; all resume after commit", async (t) => {
    const w = await world("t017");
    try {
      const m = await connect(w, "migration");
      await m.ok(`begin;\n${BS}i ${FILE_018}`);
      const tables = await w.observer.rows<{ relname: string; mode: string }>(
        `select c.relname, l.mode from pg_locks l join pg_class c on c.oid = l.relation
         where l.pid = ${m.pid} and c.relnamespace = 'public'::regnamespace and c.relkind = 'r' order by 1, 2`,
      );
      t.diagnostic(`018's table locks before commit: ${JSON.stringify(tables)}`);
      assert.deepEqual([...new Set(tables.map((l) => l.relname))], ["group_events", "notifications"]);
      assert.ok(tables.some((l) => l.relname === "group_events" && l.mode === "AccessExclusiveLock"));
      assert.ok(tables.filter((l) => l.relname === "notifications").every((l) => l.mode === "AccessShareLock"));

      const page = await connect(w, "notifications_page");
      const settle = await connect(w, "settle");
      const ids = (await w.observer.rows<{ event_id: string }>(`select event_id from public.notifications where recipient_id = '${w.ids.ravi}'`)).map((r) => r.event_id);
      const read = track(page.send(asStudent(w.ids.ravi) + eventsQuery(ids)));
      const decline = track(settle.send(`${asStudent(w.ids.asha)}select public.review_join_request('${w.group}', '${w.ids.kiran}', false);`));
      await waitUntilBlocked(w.observer, page.pid, [m.pid]);
      await waitUntilBlocked(w.observer, settle.pid, [m.pid]);
      // Not locked by 018: a member list and the unread badge answer at once.
      const other = await connect(w, "other");
      await other.ok(`${asStudent(w.ids.asha)}select count(*) from public.group_members;\nselect count(*) from public.notifications where read_at is null;\nrollback;`);
      assert.equal(read.settled || decline.settled, false, "both still waiting");

      await m.ok("commit;");
      assert.equal((await read.promise).sqlstate, "00000");
      assert.equal((await decline.promise).sqlstate, "00000");
      await settle.ok("commit;");
      await page.ok("rollback;");
      // The request is settled (017 cleared the note): Ravi sees the event again, without it.
      assert.deepEqual(await seenBy(w, "ravi"), [null]);
      const [event] = await w.observer.rows<{ detail: string | null }>(`select detail from public.group_events where id = '${w.event}'`);
      assert.equal(event.detail, null);
    } finally {
      await closeWorld(w);
    }
  });

  it("018 rolled back: the waiting read resumes under the old policy, and a re-run applies 018", async () => {
    const w = await world("t017");
    try {
      const m = await connect(w, "migration");
      await m.ok(`begin;\n${BS}i ${FILE_018}`);
      const r = await connect(w, "history");
      const read = track(r.send(`${asStudent(w.ids.ravi)}select count(*) from public.group_events where detail = 'PRIVATE-NOTE';`));
      await waitUntilBlocked(w.observer, r.pid, [m.pid]);
      await m.ok("rollback;");
      assert.match((await read.promise).out, /^1$/m, "old policy: the former admin still reads it");
      await r.ok("rollback;");
      assert.equal(await narrowed(w.observer), false, "nothing of 018 remains");
      assert.equal((await runAsEditor(w.db, "migration-2", [FILE_018])).code, 0);
      assert.equal(await narrowed(w.observer), true);
      assert.deepEqual(await seenBy(w, "ravi"), [null]);
    } finally {
      await closeWorld(w);
    }
  });

  it("a notifications-page read arriving while 018 waits for its lock: no deadlock", async () => {
    const w = await world("t017");
    try {
      const b = await connect(w, "history");
      await b.ok(`${asStudent(w.ids.asha)}select count(*) from public.group_events;`);
      const migration = track(runAsEditor(w.db, "migration", [FILE_018]));
      const migrationPid = await pidOf(w.observer, "migration");
      await waitUntilBlocked(w.observer, migrationPid, [b.pid]);
      const page = await connect(w, "notifications_page");
      const ids = (await w.observer.rows<{ event_id: string }>(`select event_id from public.notifications where recipient_id = '${w.ids.asha}'`)).map((r) => r.event_id);
      const read = track(page.send(asStudent(w.ids.asha) + eventsQuery(ids)));
      await waitUntilBlocked(w.observer, page.pid, [migrationPid]);
      await b.ok("rollback;");
      const done = await migration.promise;
      assert.equal(done.code, 0, done.stderr);
      const result = await read.promise;
      assert.equal(result.sqlstate, "00000", result.error);
      assert.match(result.out, /PRIVATE-NOTE/, "the current admin's page still shows the note");
      await page.ok("rollback;");
    } finally {
      await closeWorld(w);
    }
  });

  for (const together of [false, true]) {
    it(`the release sequence on a 016 database: 017 then 018 ${together ? "pasted as one run" : "as two runs"}`, async () => {
      const w = await world("t016");
      try {
        if (together) {
          const both = await runAsEditor(w.db, "migration", [FILE_017, FILE_018]);
          assert.equal(both.code, 0, both.stderr);
        } else {
          for (const [app, file] of [["m017", FILE_017], ["m018", FILE_018]]) {
            const run = await runAsEditor(w.db, app, [file]);
            assert.equal(run.code, 0, run.stderr);
          }
        }
        assert.equal(await narrowed(w.observer), true);
        const [fn] = await w.observer.rows<{ exists: boolean }>("select to_regprocedure('public.group_membership_notes(uuid[])') is not null as exists");
        assert.equal(fn.exists, true, "017 applied");
        assert.deepEqual(await seenBy(w, "ravi"), [null]);
        assert.deepEqual(await seenBy(w, "asha"), ["PRIVATE-NOTE"]);
      } finally {
        await closeWorld(w);
      }
    });
  }
});
