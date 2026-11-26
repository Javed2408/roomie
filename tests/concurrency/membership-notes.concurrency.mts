/**
 * Migration 017 under real concurrency (Phase 7A, audit F-01).
 *
 * PGlite (the `npm test` harness) has a single connection, so it can't show
 * what happens when transactions overlap. This suite runs a disposable
 * PostgreSQL in Docker and drives two or more independent connections
 * against it: each connection is its own psql process, so its own server
 * backend, with real lock waits, commits and rollbacks between them. The
 * waits are observed in pg_stat_activity / pg_blocking_pids(), not guessed
 * with sleeps.
 *
 * Not part of `npm test` (it needs Docker). From the project folder:
 *
 *   node --disable-warning=ExperimentalWarning --test tests/concurrency/membership-notes.concurrency.mts
 *
 * Optional: ROOMIE_PG_IMAGE (default postgres:17-alpine, already pulled).
 *
 * Isolation: the container has no network at all (--network none), sees the
 * migrations folder read-only, is removed at the end, and is reached only
 * through `docker exec`. Nothing here talks to Supabase.
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { SUPABASE_STAND_IN } from "../db/harness.mts";

const IMAGE = process.env.ROOMIE_PG_IMAGE ?? "postgres:17-alpine";
const CONTAINER = `roomie-concurrency-${process.pid}`;
const MIGRATIONS = join(import.meta.dirname, "..", "..", "supabase", "migrations");
const FILE_017 = "/migrations/017_group_membership_notes_privacy.sql";
const RUNBOOK = join(import.meta.dirname, "..", "..", "PHASE_7A_DEPLOYMENT_RUNBOOK.md");
const BS = "\\";

// --- Docker and psql plumbing -------------------------------------------------

type Exit = { code: number; stdout: string; stderr: string };

/** Run `docker <args>` to completion (never throws on a non-zero exit). */
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

/** A script run once as postgres (in one transaction unless `single` is false); throws on any error. */
async function psqlScript(db: string, sql: string, single = true): Promise<string> {
  const run = await docker(
    ["exec", "-i", CONTAINER, "psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", ...(single ? ["-1"] : []), "-U", "postgres", "-d", db, "-f", "-"],
    sql,
  );
  if (run.code !== 0) throw new Error(`psql on ${db} failed: ${run.stderr}`);
  return run.stdout;
}

/**
 * 017 run the way the SQL Editor runs it: the whole file as ONE query
 * string (psql -c), which Postgres executes as a single implicit
 * transaction. Resolves when it ends; `code` 0 means it committed.
 */
function run017AsEditor(db: string, app: string): Promise<Exit> {
  return docker([
    "exec", "-e", `PGAPPNAME=${app}`, "-e", "PGOPTIONS=-c client_min_messages=warning", CONTAINER,
    "sh", "-c", `exec psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$1" -c "$(cat ${FILE_017})"`, "sh", db,
  ]);
}

type Outcome = { out: string; sqlstate: string; error: string };

/** One independent connection: a long-lived psql process (own backend). */
class Connection {
  pid = 0;
  readonly name: string;
  private readonly child: ChildProcessWithoutNullStreams;
  private stdout = "";
  private stderr = "";
  private readonly waiting: Array<(outcome: Outcome) => void> = [];
  private seq = 0;

  private constructor(db: string, name: string, user: string) {
    this.name = name;
    this.child = spawn("docker", [
      "exec", "-i", "-e", `PGAPPNAME=${name}`, "-e", "PGOPTIONS=-c client_min_messages=warning", CONTAINER,
      "psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=0", "-U", user, "-d", db,
    ]);
    this.child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      this.stdout += chunk;
      this.drain();
    });
    this.child.stderr.setEncoding("utf8").on("data", (chunk: string) => (this.stderr += chunk));
    this.child.on("close", () => {
      for (const resolve of this.waiting.splice(0)) resolve({ out: "", sqlstate: "EXITED", error: this.stderr });
    });
  }

  /** `user` is the login role, e.g. "authenticator" (the API) or "ops" (no monitoring rights). */
  static async open(db: string, name: string, user = "postgres"): Promise<Connection> {
    const connection = new Connection(db, name, user);
    connection.pid = Number((await connection.ok("select pg_backend_pid();")).trim());
    open.add(connection);
    return connection;
  }

  private drain() {
    const marker = /^__END_\d+__ (\w+)\n/m;
    let found: RegExpExecArray | null;
    while ((found = marker.exec(this.stdout))) {
      const out = this.stdout.slice(0, found.index);
      const sqlstate = found[1];
      this.stdout = this.stdout.slice(found.index + found[0].length);
      const resolve = this.waiting.shift()!;
      // stderr is a separate pipe: give an error message a moment to land.
      const finish = () => {
        const error = this.stderr;
        this.stderr = "";
        resolve({ out, sqlstate, error });
      };
      if (sqlstate === "00000") finish();
      else setTimeout(finish, 100);
    }
  }

  /** Send SQL; resolves when psql has finished it (so it may stay pending while blocked). */
  send(sql: string): Promise<Outcome> {
    const outcome = new Promise<Outcome>((resolve) => this.waiting.push(resolve));
    this.child.stdin.write(`${BS}set LAST_ERROR_SQLSTATE 00000\n${sql}\n${BS}echo __END_${++this.seq}__ :LAST_ERROR_SQLSTATE\n`);
    return outcome;
  }

  /** Send SQL that must succeed (within a minute); returns its output. */
  async ok(sql: string): Promise<string> {
    const outcome = await within(60_000, this.send(sql), `${this.name}: ${sql.slice(0, 80)}`);
    if (outcome.sqlstate !== "00000") throw new Error(`${this.name}: ${outcome.sqlstate} ${outcome.error}`);
    return outcome.out;
  }

  /** Rows of a query (or a DML ... returning) as JSON objects. */
  async rows<T = Record<string, unknown>>(query: string): Promise<T[]> {
    return JSON.parse(await this.ok(`with q as (${query}) select coalesce(json_agg(q), '[]'::json) from q;`)) as T[];
  }

  async close() {
    open.delete(this);
    this.child.stdin.end();
    await Promise.race([new Promise((resolve) => this.child.once("close", resolve)), delay(3000)]);
    this.child.kill();
  }
}

const open = new Set<Connection>();

/** Track whether a promise has settled, without awaiting it. */
function track<T>(promise: Promise<T>) {
  const state = { settled: false, promise };
  promise.then(() => (state.settled = true), () => (state.settled = true));
  return state;
}

type Wait = { wait_event_type: string | null; wait_event: string | null; blocking: number[]; query: string };

/** Poll until `pid` is waiting for a lock held by every one of `blockers`. */
async function waitUntilBlocked(observer: Connection, pid: number, blockers: number[]): Promise<Wait> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const [wait] = await observer.rows<Wait>(
      `select wait_event_type, wait_event, pg_blocking_pids(pid) as blocking, left(query, 200) as query from pg_stat_activity where pid = ${pid}`,
    );
    if (wait?.wait_event_type === "Lock" && blockers.every((b) => wait.blocking.includes(b))) return wait;
    if (Date.now() > deadline) throw new Error(`pid ${pid} never waited on ${blockers.join(", ")}: ${JSON.stringify(wait)}`);
    await delay(20);
  }
}

/** The backend pid of a connection named `app` (e.g. the editor-style 017 run). */
async function pidOf(observer: Connection, app: string): Promise<number> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const [found] = await observer.rows<{ pid: number }>(`select pid from pg_stat_activity where application_name = '${app}'`);
    if (found) return found.pid;
    if (Date.now() > deadline) throw new Error(`no connection named ${app}`);
    await delay(20);
  }
}

// --- Roomie helpers -----------------------------------------------------------

const lit = (text: string | null) => (text === null ? "null" : `'${text.replaceAll("'", "''")}'`);

/** Act as a signed-in student for the rest of the current transaction. */
const studentRole = (user: string) => `set local role authenticated;\nset local request.jwt.claim.sub = '${user}';\n`;

/** Open a transaction as a signed-in student (as Supabase does for a request). */
const asStudent = (user: string) => `begin;\n${studentRole(user)}`;

const rpc = {
  request: (group: string, note: string | null) => `select public.request_to_join_group('${group}', ${lit(note)});`,
  invite: (group: string, who: string, note: string | null) => `select public.invite_to_group('${group}', '${who}', ${lit(note)});`,
  review: (group: string, who: string, approve: boolean) => `select public.review_join_request('${group}', '${who}', ${approve});`,
  respond: (group: string, accept: boolean) => `select public.respond_to_group_invite('${group}', ${accept});`,
  cancel: (group: string, who: string) => `select public.cancel_group_invite('${group}', '${who}');`,
  leave: (group: string) => `select public.leave_group('${group}');`,
};

const PEOPLE = ["asha", "omar", "kiran", "meera", "dev", "tara", "ravi", "sam", "zed"] as const;
type Person = (typeof PEOPLE)[number];

type World = {
  db: string;
  observer: Connection;
  ids: Record<Person, string>;
  /** Night owls (Asha, admin) and Early birds (Omar, admin). */
  g: string;
  g2: string;
  /** A student's action in its own committed transaction (must succeed). */
  act: (who: Person, sql: string) => Promise<void>;
  /** A query as a student, in its own transaction. */
  read: <T = Record<string, unknown>>(who: Person, query: string) => Promise<T[]>;
  /** A fresh connection (as `user`, default postgres), closed after the test. */
  connect: (name: string, user?: string) => Promise<Connection>;
  connections: Connection[];
};

let admin: Connection;
let databases = 0;

/**
 * A fresh database copied from a template (016 = live today; 017 = after
 * the migration) with the same people and memberships every time:
 *   Night owls:  Kiran and Meera have pending requests, Dev a pending
 *                invitation, Ravi accepted an invitation (a settled note).
 *   Early birds: Tara has a pending invitation, Sam a pending request.
 *   Zed belongs nowhere yet.
 */
async function world(template: "t016" | "t017"): Promise<World> {
  const db = `w${++databases}`;
  await admin.ok(`create database ${db} template ${template};`);
  const observer = await Connection.open(db, "observer");
  const connections = [observer];
  const ids = {} as Record<Person, string>;
  for (const name of PEOPLE) {
    ids[name] = randomUUID();
    await observer.ok(
      `insert into auth.users (id, email, email_confirmed_at) values ('${ids[name]}', '${name}@srmist.edu.in', now());
       update public.profiles set full_name = '${name[0].toUpperCase()}${name.slice(1)}', mode = 'need_flat',
         gender = 'male', year_of_study = 2, department = 'CSE' where id = '${ids[name]}';`,
    );
  }
  const read = async <T = Record<string, unknown>,>(who: Person, query: string) => {
    await observer.ok(asStudent(ids[who]));
    try {
      return await observer.rows<T>(query);
    } finally {
      await observer.ok("rollback;");
    }
  };
  const act = async (who: Person, sql: string) => {
    await observer.ok(asStudent(ids[who]));
    const outcome = await observer.send(sql);
    await observer.ok(outcome.sqlstate === "00000" ? "commit;" : "rollback;");
    if (outcome.sqlstate !== "00000") throw new Error(`${who}: ${outcome.error}`);
  };
  const newGroup = async (owner: Person, name: string) => {
    await observer.ok(asStudent(ids[owner]));
    const [group] = await observer.rows<{ id: string }>(
      `insert into public.groups (name, created_by, is_discoverable) values ('${name}', '${ids[owner]}', true) returning id`,
    );
    await observer.ok("commit;");
    return group.id;
  };
  const g = await newGroup("asha", "Night owls");
  const g2 = await newGroup("omar", "Early birds");
  await observer.ok("update public.groups set max_members = 10;");

  await act("asha", rpc.invite(g, ids.ravi, "N-RAVI"));
  await act("ravi", rpc.respond(g, true));
  await act("kiran", rpc.request(g, "N-KIRAN"));
  await act("meera", rpc.request(g, "N-MEERA"));
  await act("asha", rpc.invite(g, ids.dev, "N-DEV"));
  await act("omar", rpc.invite(g2, ids.tara, "N-TARA"));
  await act("sam", rpc.request(g2, "N-SAM"));
  // Some notifications already read, to show read state survives.
  await observer.ok(`update public.notifications set read_at = now() - interval '1 hour' where recipient_id = '${ids.asha}';`);

  const connect = async (name: string, user?: string) => {
    const connection = await Connection.open(db, name, user);
    connections.push(connection);
    return connection;
  };
  return { db, observer, ids, g, g2, act, read, connect, connections };
}

async function closeWorld(w: World) {
  for (const connection of w.connections) await connection.close();
  await admin.ok(`drop database if exists ${w.db} with (force);`);
}

type Snapshot = {
  events: Array<Record<string, unknown> & { id: string; detail: string | null }>;
  notifications: Array<Record<string, unknown> & { id: string }>;
  members: Array<Record<string, unknown> & { profile_id: string; message: string | null; status: string }>;
};

async function snapshot(o: Connection): Promise<Snapshot> {
  return {
    events: await o.rows("select id, group_id, group_name, subject_id, actor_id, kind, detail, created_at from public.group_events order by id"),
    notifications: await o.rows("select id, recipient_id, event_id, read_at, created_at from public.notifications order by id"),
    members: await o.rows("select * from public.group_members order by group_id, profile_id"),
  };
}

/** Every event and notification of `before` is still there, with only event details possibly cleared. */
function assertHistoryKept(before: Snapshot, after: Snapshot) {
  const events = new Map(after.events.map((e) => [e.id, e]));
  for (const event of before.events) {
    const now = events.get(event.id);
    assert.ok(now, `event ${event.id} (${String(event.kind)}) still exists`);
    assert.deepEqual({ ...now, detail: null }, { ...event, detail: null }, `event ${event.id}: only the detail may change`);
    assert.ok(now.detail === event.detail || now.detail === null, "a detail is only ever cleared");
  }
  const notifications = new Map(after.notifications.map((n) => [n.id, n]));
  for (const notification of before.notifications) {
    assert.deepEqual(notifications.get(notification.id), notification, "notification row unchanged (ids, times, read state)");
  }
}

/** Membership rows of everyone except `changed` are unchanged (all columns but a settled note). */
function assertOtherMembersKept(before: Snapshot, after: Snapshot, changed: string[]) {
  const key = (m: Snapshot["members"][number]) => `${String(m.group_id)}/${m.profile_id}`;
  const rowsAfter = new Map(after.members.map((m) => [key(m), m]));
  for (const member of before.members) {
    if (changed.includes(member.profile_id)) continue;
    const now = rowsAfter.get(key(member));
    assert.ok(now, `${key(member)} still there`);
    const pending = member.status === "invited" || member.status === "requested";
    assert.deepEqual(pending ? now : { ...now, message: null }, pending ? member : { ...member, message: null });
  }
}

/**
 * After deleting account `who`, the existing deletion rules: every event stays,
 * with that account's subject_id / actor_id emptied (ON DELETE SET NULL); only
 * notifications addressed to it and its own membership rows go (ON DELETE CASCADE).
 */
function assertDeletionKept(before: Snapshot, after: Snapshot, who: string) {
  assert.equal(after.events.length, before.events.length, "no event row is lost");
  const events = new Map(after.events.map((e) => [e.id, e]));
  for (const event of before.events) {
    const now = events.get(event.id);
    assert.ok(now, `event ${event.id} kept`);
    const ids = { subject_id: event.subject_id === who ? null : event.subject_id, actor_id: event.actor_id === who ? null : event.actor_id };
    assert.deepEqual({ ...now, detail: null }, { ...event, ...ids, detail: null }, `event ${event.id}`);
    assert.ok(now.detail === event.detail || now.detail === null, "a detail is only ever cleared");
  }
  assert.deepEqual(after.notifications, before.notifications.filter((n) => n.recipient_id !== who), "only notifications addressed to the account go");
  assert.ok(!after.members.some((m) => m.profile_id === who), "its membership rows go");
}

/** None of `who`'s invitation or request notes survives in the history. */
function assertNoNoteOf(before: Snapshot, after: Snapshot, who: string) {
  const theirs = before.events.filter((e) => e.subject_id === who && (e.kind === "invited" || e.kind === "requested")).map((e) => e.id);
  assert.ok(theirs.length > 0, "set-up: the account had a note in the history");
  for (const id of theirs) assert.equal(after.events.find((e) => e.id === id)?.detail, null, `event ${id}`);
}

/** The privacy invariant: no settled note anywhere, and students can't read the column. */
async function assertNoSettledNotes(w: World) {
  const [counts] = await w.observer.rows<{ settled_member_notes: number; settled_history_notes: number }>(
    `select
       (select count(*) from public.group_members
         where message is not null and status not in ('invited', 'requested'))::int as settled_member_notes,
       (select count(*) from public.group_events as e
         where e.kind in ('invited', 'requested') and e.detail is not null
           and not exists (select 1 from public.group_members as m
             where m.group_id = e.group_id and m.profile_id = e.subject_id
               and m.status = e.kind and m.message = e.detail))::int as settled_history_notes`,
  );
  assert.deepEqual(counts, { settled_member_notes: 0, settled_history_notes: 0 });
  await w.observer.ok(asStudent(w.ids.meera));
  const direct = await w.observer.send("select message from public.group_members;");
  await w.observer.ok("rollback;");
  assert.equal(direct.sqlstate, "42501", "students can't select group_members.message");
}

/** Invitation and request notes left in the history, as "kind:text". */
async function historyNotes(o: Connection): Promise<string[]> {
  return (
    await o.rows<{ note: string }>(
      "select kind || ':' || detail as note from public.group_events where kind in ('invited', 'requested') and detail is not null",
    )
  ).map((r) => r.note).sort();
}

/** What group_membership_notes() returns to `who` for both groups, as "name:text". */
async function notesSeenBy(w: World, who: Person): Promise<string[]> {
  const names = new Map(Object.entries(w.ids).map(([name, id]) => [id, name]));
  const found = await w.read<{ profile_id: string; message: string }>(
    who,
    `select profile_id, message from public.group_membership_notes(array['${w.g}', '${w.g2}']::uuid[])`,
  );
  return found.map((n) => `${names.get(n.profile_id)}:${n.message}`).sort();
}

async function member(w: World, group: string, who: Person) {
  return (
    await w.observer.rows<{ status: string; message: string | null }>(
      `select status, message from public.group_members where group_id = '${group}' and profile_id = '${w.ids[who]}'`,
    )
  )[0];
}

/** Is 017 in this database? */
async function has017(o: Connection) {
  const [state] = await o.rows<{ fn: boolean; triggers: number; note_check: boolean; table_select: boolean }>(
    `select to_regprocedure('public.group_membership_notes(uuid[])') is not null as fn,
       (select count(*) from pg_trigger where tgname in ('group_members_clear_settled_note',
          'group_members_clear_settled_event_notes', 'group_members_clear_deleted_event_notes',
          'group_events_clear_orphaned_note'))::int as triggers,
       exists (select 1 from pg_constraint where conname = 'group_members_note_only_while_pending') as note_check,
       has_table_privilege('authenticated', 'public.group_members', 'select') as table_select`,
  );
  return state;
}
const APPLIED = { fn: true, triggers: 4, note_check: true, table_select: false };
const NOT_APPLIED = { fn: false, triggers: 0, note_check: false, table_select: true };

type Lock = { locktype: string; relation: string | null; mode: string; granted: boolean };

/** Table and transaction-id locks of one backend, sorted. */
async function locksOf(o: Connection, pid: number): Promise<Lock[]> {
  const locks = await o.rows<Lock>(
    `select l.locktype, c.relname as relation, l.mode, l.granted
     from pg_locks as l left join pg_class as c on c.oid = l.relation
     where l.pid = ${pid} and l.locktype in ('relation', 'transactionid')`,
  );
  return locks.sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
}

/** The app's tables (schema public) one backend holds or waits for any lock on. */
async function tablesLockedBy(o: Connection, pid: number): Promise<string[]> {
  const found = await o.rows<{ relname: string }>(
    `select distinct c.relname from pg_locks as l join pg_class as c on c.oid = l.relation
     where l.pid = ${pid} and c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')`,
  );
  return found.map((r) => r.relname).sort();
}

/** Everything 017 defines or changes in the catalog, to prove a rollback left nothing. */
async function catalogState(o: Connection) {
  const tables = "('public.group_members'::regclass, 'public.group_events'::regclass)";
  const sorted = (items: unknown[]) => items.map((item) => JSON.stringify(item)).sort();
  return {
    triggers: sorted(await o.rows(`select tgrelid::regclass::text as tbl, tgname, tgenabled from pg_trigger where tgrelid in ${tables} and not tgisinternal`)),
    constraints: sorted(await o.rows(`select conrelid::regclass::text as tbl, conname, pg_get_constraintdef(oid) as def from pg_constraint where conrelid in ${tables}`)),
    tableGrants: sorted(await o.rows(`select relname, relacl::text as acl from pg_class where oid in ${tables}`)),
    columnGrants: sorted(await o.rows(`select attrelid::regclass::text as tbl, attname, attacl::text as acl from pg_attribute where attrelid in ${tables} and attnum > 0 and not attisdropped`)),
    policies: sorted(await o.rows(`select tablename, policyname, cmd, qual, with_check from pg_policies where schemaname = 'public' and tablename in ('group_members', 'group_events')`)),
    functions: sorted(await o.rows(`select p.oid::regprocedure::text as fn, md5(pg_get_functiondef(p.oid)) as body, p.proacl::text as acl from pg_proc as p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'`)),
  };
}

/** A query from the deployment runbook (e.g. "-- D1."), without its comments and final semicolon. */
async function runbookSql(tag: string): Promise<string> {
  const text = await readFile(RUNBOOK, "utf8");
  const block = [...text.matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => m[1]).find((b) => b.includes(tag));
  assert.ok(block, `the runbook has a ${tag} query`);
  return block
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .trim()
    .replace(/;$/, "");
}

/** `promise`, or a clear failure if it takes longer than `ms` (e.g. it is unexpectedly blocked). */
async function within<T>(ms: number, promise: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} did not finish within ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const XID: Lock = { locktype: "transactionid", relation: null, mode: "ExclusiveLock", granted: true };

// --- The suite ----------------------------------------------------------------

describe("migration 017 under real concurrency (disposable PostgreSQL in Docker)", { timeout: 600_000 }, () => {
  const versions = { docker: "", postgres: "" };

  before(async () => {
    const engine = await docker(["version", "--format", "{{.Server.Version}}"]);
    assert.equal(engine.code, 0, `Docker must be running: ${engine.stderr}`);
    versions.docker = engine.stdout.trim();
    await docker(["rm", "-f", CONTAINER]);
    const started = await docker([
      "run", "-d", "--rm", "--name", CONTAINER, "--network", "none",
      "--mount", `type=bind,source=${MIGRATIONS},target=/migrations,readonly`,
      "-e", "POSTGRES_HOST_AUTH_METHOD=trust", IMAGE, "-c", "deadlock_timeout=1s",
    ]);
    assert.equal(started.code, 0, `docker run failed: ${started.stderr}`);
    // Loopback TCP only answers once the image's init has finished and restarted.
    for (let i = 0; ; i++) {
      if ((await docker(["exec", CONTAINER, "pg_isready", "-q", "-h", "127.0.0.1", "-U", "postgres"])).code === 0) break;
      if (i > 120) throw new Error("PostgreSQL did not start");
      await delay(250);
    }
    versions.postgres = (await psqlScript("postgres", "select version();")).trim();

    // Templates: 001-016 (production today), and the same plus 017.
    await psqlScript("postgres", "create database t016;", false);
    await psqlScript("t016", SUPABASE_STAND_IN);
    // Login roles like Supabase's: the API logs in as authenticator and switches
    // to authenticated or service_role; ops can log in but has no monitoring rights.
    await psqlScript("postgres", "create role authenticator login noinherit; grant anon, authenticated, service_role to authenticator; create role ops login;");
    const files = (await readdir(MIGRATIONS)).filter((f) => /^\d{3}_.+\.sql$/.test(f) && f.slice(0, 3) <= "016").sort();
    for (const file of files) {
      const run = await docker(["exec", CONTAINER, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-1", "-U", "postgres", "-d", "t016", "-f", `/migrations/${file}`]);
      if (run.code !== 0) throw new Error(`${file} failed: ${run.stderr}`);
    }
    await psqlScript("postgres", "create database t017 template t016;", false);
    const applied = await run017AsEditor("t017", "template-017");
    assert.equal(applied.code, 0, `017 on the template failed: ${applied.stderr}`);
    admin = await Connection.open("postgres", "admin");
  });

  after(async () => {
    for (const connection of [...open]) await connection.close();
    await docker(["rm", "-f", CONTAINER]);
  });

  it("environment: Docker engine, PostgreSQL server, 001-017 applied", async (t) => {
    t.diagnostic(`Docker engine ${versions.docker}; ${versions.postgres}; image ${IMAGE}`);
    assert.match(versions.postgres, /^PostgreSQL 17\./);
    const check = await Connection.open("t017", "check");
    assert.deepEqual(await has017(check), APPLIED);
    await check.close();
  });

  describe("017 waits for membership changes already in flight (database on 016)", () => {
    it("an approval in flight: 017 waits for it, then clears its note from the row and the history", async () => {
      const w = await world("t016");
      try {
        const before = await snapshot(w.observer);
        const a = await w.connect("conn_a");
        await a.ok(asStudent(w.ids.asha) + rpc.review(w.g, w.ids.kiran, true));

        const migration = track(run017AsEditor(w.db, "migration"));
        const wait = await waitUntilBlocked(w.observer, await pidOf(w.observer, "migration"), [a.pid]);
        assert.equal(wait.wait_event, "relation", "017 waits for its table lock");
        await delay(300);
        assert.equal(migration.settled, false, "017 is still waiting while A's transaction is open");

        await a.ok("commit;");
        const done = await migration.promise;
        assert.equal(done.code, 0, done.stderr);

        const after = await snapshot(w.observer);
        assert.deepEqual(await member(w, w.g, "kiran"), { status: "active", message: null });
        assert.deepEqual(await historyNotes(w.observer), ["invited:N-DEV", "invited:N-TARA", "requested:N-MEERA", "requested:N-SAM"]);
        assertHistoryKept(before, after);
        assert.ok(after.events.length > before.events.length, "A's own event was recorded");
        assertOtherMembersKept(before, after, [w.ids.kiran]);
        await assertNoSettledNotes(w);
        assert.deepEqual(await notesSeenBy(w, "asha"), ["dev:N-DEV", "meera:N-MEERA"]);
        assert.deepEqual(await notesSeenBy(w, "kiran"), []);

        // A second run changes nothing.
        const again = await run017AsEditor(w.db, "migration-2");
        assert.equal(again.code, 0, again.stderr);
        assert.deepEqual(await snapshot(w.observer), after);
      } finally {
        await closeWorld(w);
      }
    });

    it("a rejection in flight: 017 waits, then clears that note", async () => {
      const w = await world("t016");
      try {
        const before = await snapshot(w.observer);
        const a = await w.connect("conn_a");
        await a.ok(asStudent(w.ids.asha) + rpc.review(w.g, w.ids.meera, false));
        const migration = track(run017AsEditor(w.db, "migration"));
        await waitUntilBlocked(w.observer, await pidOf(w.observer, "migration"), [a.pid]);
        await a.ok("commit;");
        assert.equal((await migration.promise).code, 0);

        const after = await snapshot(w.observer);
        assert.deepEqual(await member(w, w.g, "meera"), { status: "declined", message: null });
        assert.deepEqual(await historyNotes(w.observer), ["invited:N-DEV", "invited:N-TARA", "requested:N-KIRAN", "requested:N-SAM"]);
        assertHistoryKept(before, after);
        assertOtherMembersKept(before, after, [w.ids.meera]);
        await assertNoSettledNotes(w);
        assert.deepEqual(await notesSeenBy(w, "asha"), ["dev:N-DEV", "kiran:N-KIRAN"]);
        assert.deepEqual(await notesSeenBy(w, "meera"), []);
      } finally {
        await closeWorld(w);
      }
    });

    it("a withdrawal and a cancellation in flight on two connections: 017 waits for both", async () => {
      const w = await world("t016");
      try {
        const before = await snapshot(w.observer);
        const a = await w.connect("conn_a");
        const c = await w.connect("conn_c");
        await a.ok(asStudent(w.ids.kiran) + rpc.leave(w.g)); // Kiran withdraws his request.
        await c.ok(asStudent(w.ids.omar) + rpc.cancel(w.g2, w.ids.tara)); // Omar cancels Tara's invitation.

        const migration = track(run017AsEditor(w.db, "migration"));
        const migrationPid = await pidOf(w.observer, "migration");
        const first = await waitUntilBlocked(w.observer, migrationPid, [a.pid]);
        assert.ok(first.blocking.includes(c.pid), `both writers block 017: ${JSON.stringify(first.blocking)}`);

        await a.ok("commit;");
        await waitUntilBlocked(w.observer, migrationPid, [c.pid]);
        await delay(300);
        assert.equal(migration.settled, false, "still waiting for C");
        await c.ok("commit;");
        assert.equal((await migration.promise).code, 0);

        const after = await snapshot(w.observer);
        assert.deepEqual(await member(w, w.g, "kiran"), { status: "left", message: null });
        assert.deepEqual(await member(w, w.g2, "tara"), { status: "cancelled", message: null });
        assert.deepEqual(await historyNotes(w.observer), ["invited:N-DEV", "requested:N-MEERA", "requested:N-SAM"]);
        assertHistoryKept(before, after);
        assertOtherMembersKept(before, after, [w.ids.kiran, w.ids.tara]);
        await assertNoSettledNotes(w);
        assert.deepEqual(await notesSeenBy(w, "omar"), ["sam:N-SAM"]);
        assert.deepEqual(await notesSeenBy(w, "tara"), []);
      } finally {
        await closeWorld(w);
      }
    });

    it("a change in flight that rolls back: the request stays pending and its note stays readable", async () => {
      const w = await world("t016");
      try {
        const before = await snapshot(w.observer);
        const a = await w.connect("conn_a");
        await a.ok(asStudent(w.ids.asha) + rpc.review(w.g, w.ids.kiran, true));
        const migration = track(run017AsEditor(w.db, "migration"));
        await waitUntilBlocked(w.observer, await pidOf(w.observer, "migration"), [a.pid]);
        await a.ok("rollback;");
        assert.equal((await migration.promise).code, 0);

        const after = await snapshot(w.observer);
        assert.deepEqual(await member(w, w.g, "kiran"), { status: "requested", message: "N-KIRAN" });
        assert.ok((await historyNotes(w.observer)).includes("requested:N-KIRAN"), "the pending round's history note stays");
        assert.equal(after.events.length, before.events.length, "the rolled-back change left no event");
        assertHistoryKept(before, after);
        assertOtherMembersKept(before, after, []);
        await assertNoSettledNotes(w);
        assert.deepEqual(await notesSeenBy(w, "asha"), ["dev:N-DEV", "kiran:N-KIRAN", "meera:N-MEERA"]);
        assert.deepEqual(await notesSeenBy(w, "kiran"), ["kiran:N-KIRAN"]);
        assert.deepEqual(await notesSeenBy(w, "meera"), ["meera:N-MEERA"], "another requester sees only her own");
      } finally {
        await closeWorld(w);
      }
    });

    it("a new request created in flight: 017 waits, then keeps that pending note and clears the settled one", async () => {
      const w = await world("t016");
      try {
        const before = await snapshot(w.observer);
        const a = await w.connect("conn_a");
        await a.ok(asStudent(w.ids.zed) + rpc.request(w.g, "N-ZED"));
        const migration = track(run017AsEditor(w.db, "migration"));
        await waitUntilBlocked(w.observer, await pidOf(w.observer, "migration"), [a.pid]);
        await a.ok("commit;");
        assert.equal((await migration.promise).code, 0);

        const after = await snapshot(w.observer);
        assert.deepEqual(await member(w, w.g, "zed"), { status: "requested", message: "N-ZED" });
        assert.deepEqual(await historyNotes(w.observer), [
          "invited:N-DEV", "invited:N-TARA", "requested:N-KIRAN", "requested:N-MEERA", "requested:N-SAM", "requested:N-ZED",
        ]);
        const zedEvents = after.events.filter((e) => e.subject_id === w.ids.zed);
        assert.equal(zedEvents.length, 1);
        assert.ok(after.notifications.some((n) => n.event_id === zedEvents[0].id), "the admin was notified");
        assertHistoryKept(before, after);
        await assertNoSettledNotes(w);
        assert.deepEqual(await notesSeenBy(w, "asha"), ["dev:N-DEV", "kiran:N-KIRAN", "meera:N-MEERA", "zed:N-ZED"]);
        assert.deepEqual(await notesSeenBy(w, "zed"), ["zed:N-ZED"]);
      } finally {
        await closeWorld(w);
      }
    });
  });

  describe("membership changes wait for 017 in flight", () => {
    it("an approval waits for 017; once 017 commits, its new triggers clear the note", async () => {
      const w = await world("t016");
      try {
        const before = await snapshot(w.observer);
        const m = await w.connect("migration");
        await m.ok(`begin;\n${BS}i ${FILE_017}`);
        const a = await w.connect("conn_a");
        const approval = track(a.send(asStudent(w.ids.asha) + rpc.review(w.g, w.ids.kiran, true)));
        await waitUntilBlocked(w.observer, a.pid, [m.pid]);
        await delay(300);
        assert.equal(approval.settled, false, "the approval waits while 017 is uncommitted");

        await m.ok("commit;");
        assert.equal((await approval.promise).sqlstate, "00000");
        await a.ok("commit;");

        const after = await snapshot(w.observer);
        assert.equal((await member(w, w.g, "kiran")).message, null);
        assert.deepEqual(await historyNotes(w.observer), ["invited:N-DEV", "invited:N-TARA", "requested:N-MEERA", "requested:N-SAM"]);
        assertHistoryKept(before, after);
        await assertNoSettledNotes(w);
        assert.deepEqual(await notesSeenBy(w, "asha"), ["dev:N-DEV", "meera:N-MEERA"]);
      } finally {
        await closeWorld(w);
      }
    });

    it("017 rolled back while a change waits: nothing of 017 remains, and a re-run applies it", async () => {
      const w = await world("t016");
      try {
        const before = await snapshot(w.observer);
        const m = await w.connect("migration");
        await m.ok(`begin;\n${BS}i ${FILE_017}`);
        const a = await w.connect("conn_a");
        const request = track(a.send(asStudent(w.ids.zed) + rpc.request(w.g, "N-ZED")));
        await waitUntilBlocked(w.observer, a.pid, [m.pid]);
        await m.ok("rollback;");
        assert.equal((await request.promise).sqlstate, "00000");
        await a.ok("commit;");

        // Exactly the 016 state: no function, triggers or constraint, the old
        // grant, and every note (settled ones too) as it was.
        assert.deepEqual(await has017(w.observer), NOT_APPLIED);
        const rolledBack = await snapshot(w.observer);
        assert.deepEqual(rolledBack.events.filter((e) => e.subject_id !== w.ids.zed), before.events);
        assert.ok((await historyNotes(w.observer)).includes("invited:N-RAVI"), "no partial cleanup survived the rollback");
        assert.equal((await member(w, w.g, "ravi")).message, "N-RAVI");

        const rerun = await run017AsEditor(w.db, "migration-2");
        assert.equal(rerun.code, 0, rerun.stderr);
        assert.deepEqual(await has017(w.observer), APPLIED);
        assert.deepEqual(await historyNotes(w.observer), [
          "invited:N-DEV", "invited:N-TARA", "requested:N-KIRAN", "requested:N-MEERA", "requested:N-SAM", "requested:N-ZED",
        ]);
        assertHistoryKept(rolledBack, await snapshot(w.observer));
        await assertNoSettledNotes(w);
      } finally {
        await closeWorld(w);
      }
    });

    it("reads of group_members also wait while 017's transaction is open, then the note column is refused", async () => {
      const w = await world("t016");
      try {
        const m = await w.connect("migration");
        await m.ok(`begin;\n${BS}i ${FILE_017}`);
        const r = await w.connect("reader");
        const read = track(r.send(`${asStudent(w.ids.meera)}select count(*) from public.group_members;`));
        const wait = await waitUntilBlocked(w.observer, r.pid, [m.pid]);
        assert.equal(wait.wait_event, "relation");
        await m.ok("commit;");
        assert.equal((await read.promise).sqlstate, "00000");
        assert.equal((await r.send("select message from public.group_members;")).sqlstate, "42501");
        await r.ok("rollback;");
      } finally {
        await closeWorld(w);
      }
    });
  });

  describe("after 017: overlapping membership transactions", () => {
    it("two settlements in one group queue on the group row; both notes are cleared", async () => {
      const w = await world("t017");
      try {
        const before = await snapshot(w.observer);
        const a = await w.connect("conn_a");
        const c = await w.connect("conn_c");
        await a.ok(asStudent(w.ids.asha) + rpc.review(w.g, w.ids.kiran, true));
        const decline = track(c.send(asStudent(w.ids.asha) + rpc.review(w.g, w.ids.meera, false)));
        await waitUntilBlocked(w.observer, c.pid, [a.pid]);
        await a.ok("commit;");
        assert.equal((await decline.promise).sqlstate, "00000");
        await c.ok("commit;");

        const after = await snapshot(w.observer);
        assert.deepEqual(await member(w, w.g, "kiran"), { status: "active", message: null });
        assert.deepEqual(await member(w, w.g, "meera"), { status: "declined", message: null });
        assert.deepEqual(await historyNotes(w.observer), ["invited:N-DEV", "invited:N-TARA", "requested:N-SAM"]);
        assertHistoryKept(before, after);
        assertOtherMembersKept(before, after, [w.ids.kiran, w.ids.meera]);
        await assertNoSettledNotes(w);
        assert.deepEqual(await notesSeenBy(w, "asha"), ["dev:N-DEV"]);
      } finally {
        await closeWorld(w);
      }
    });

    it("settlements in different groups don't wait for each other", async () => {
      const w = await world("t017");
      try {
        const a = await w.connect("conn_a");
        const c = await w.connect("conn_c");
        await a.ok(asStudent(w.ids.asha) + rpc.review(w.g, w.ids.kiran, true));
        // Both uncommitted at once: C finishes while A is still open.
        await c.ok(asStudent(w.ids.omar) + rpc.cancel(w.g2, w.ids.tara));
        await c.ok("commit;");
        await a.ok("commit;");
        assert.deepEqual(await historyNotes(w.observer), ["invited:N-DEV", "requested:N-MEERA", "requested:N-SAM"]);
        await assertNoSettledNotes(w);
      } finally {
        await closeWorld(w);
      }
    });

    it("a decline racing the student's own withdrawal: one wins, no note survives, and a new round works", async () => {
      const w = await world("t017");
      try {
        const a = await w.connect("conn_a");
        const k = await w.connect("kiran");
        await a.ok(asStudent(w.ids.asha) + rpc.review(w.g, w.ids.kiran, false));
        const withdraw = track(k.send(asStudent(w.ids.kiran) + rpc.leave(w.g)));
        await waitUntilBlocked(w.observer, k.pid, [a.pid]);
        await a.ok("commit;");
        const lost = await withdraw.promise;
        assert.equal(lost.sqlstate, "P0002", `the withdrawal finds nothing to withdraw: ${lost.error}`);
        await k.ok("rollback;");
        assert.deepEqual(await member(w, w.g, "kiran"), { status: "declined", message: null });
        await assertNoSettledNotes(w);

        await w.act("kiran", rpc.request(w.g, "N-KIRAN-2"));
        assert.deepEqual(await member(w, w.g, "kiran"), { status: "requested", message: "N-KIRAN-2" });
        assert.ok((await historyNotes(w.observer)).includes("requested:N-KIRAN-2"));
        assert.ok(!(await historyNotes(w.observer)).includes("requested:N-KIRAN"));
        assert.deepEqual(await notesSeenBy(w, "kiran"), ["kiran:N-KIRAN-2"]);
      } finally {
        await closeWorld(w);
      }
    });

    it("readers during an in-flight approval see the committed state; after commit the note is gone at once", async () => {
      const w = await world("t017");
      try {
        const a = await w.connect("conn_a");
        await a.ok(asStudent(w.ids.asha) + rpc.review(w.g, w.ids.kiran, true));
        // Not yet committed: the request is still pending for everyone else.
        assert.deepEqual(await notesSeenBy(w, "asha"), ["dev:N-DEV", "kiran:N-KIRAN", "meera:N-MEERA"]);
        assert.deepEqual(await notesSeenBy(w, "kiran"), ["kiran:N-KIRAN"]);
        await a.ok("commit;");
        assert.deepEqual(await notesSeenBy(w, "asha"), ["dev:N-DEV", "meera:N-MEERA"]);
        assert.deepEqual(await notesSeenBy(w, "kiran"), []);
        const throughHistory = await w.read<{ detail: string | null }>(
          "asha",
          `select e.detail from public.notifications n join public.group_events e on e.id = n.event_id where e.subject_id = '${w.ids.kiran}' and e.kind = 'requested'`,
        );
        assert.deepEqual(throughHistory, [{ detail: null }]);
        await assertNoSettledNotes(w);
      } finally {
        await closeWorld(w);
      }
    });

    it("an approval rolled back after 017 keeps the pending note in the row, the history and the function", async () => {
      const w = await world("t017");
      try {
        const before = await snapshot(w.observer);
        const a = await w.connect("conn_a");
        await a.ok(asStudent(w.ids.asha) + rpc.review(w.g, w.ids.kiran, true));
        await a.ok("rollback;");
        assert.deepEqual(await snapshot(w.observer), before);
        assert.deepEqual(await notesSeenBy(w, "asha"), ["dev:N-DEV", "kiran:N-KIRAN", "meera:N-MEERA"]);
      } finally {
        await closeWorld(w);
      }
    });

    it("new requests, invitations and settlements at once, in two groups: events are created and only settled notes go", async () => {
      const w = await world("t017");
      try {
        const before = await snapshot(w.observer);
        const a = await w.connect("conn_a");
        const c = await w.connect("conn_c");
        const d = await w.connect("conn_d");
        await a.ok(asStudent(w.ids.zed) + rpc.request(w.g, "N-ZED")); // new pending event, Night owls
        const approve = track(c.send(asStudent(w.ids.asha) + rpc.review(w.g, w.ids.meera, true))); // queues behind A
        await d.ok(asStudent(w.ids.omar) + rpc.invite(w.g2, w.ids.zed, "N-ZED-2")); // other group: no wait
        await waitUntilBlocked(w.observer, c.pid, [a.pid]);
        await d.ok("commit;");
        await a.ok("commit;");
        assert.equal((await approve.promise).sqlstate, "00000");
        await c.ok("commit;");

        const after = await snapshot(w.observer);
        assert.deepEqual(await historyNotes(w.observer), [
          "invited:N-DEV", "invited:N-TARA", "invited:N-ZED-2", "requested:N-KIRAN", "requested:N-SAM", "requested:N-ZED",
        ]);
        assertHistoryKept(before, after);
        assertOtherMembersKept(before, after, [w.ids.meera]);
        await assertNoSettledNotes(w);
        assert.deepEqual(await notesSeenBy(w, "zed"), ["zed:N-ZED", "zed:N-ZED-2"]);
        assert.deepEqual(await notesSeenBy(w, "omar"), ["sam:N-SAM", "tara:N-TARA", "zed:N-ZED-2"]);
      } finally {
        await closeWorld(w);
      }
    });
  });

  describe("017 against transactions that read before they write", () => {
    it("an open read-only transaction delays 017 until it ends, without a deadlock", async () => {
      const w = await world("t016");
      try {
        const a = await w.connect("conn_a");
        await a.ok(`${asStudent(w.ids.asha)}select count(*) from public.group_members;`);
        const migration = track(run017AsEditor(w.db, "migration"));
        await waitUntilBlocked(w.observer, await pidOf(w.observer, "migration"), [a.pid]);
        await delay(1500); // longer than deadlock_timeout
        assert.equal(migration.settled, false);
        await a.ok("commit;");
        assert.equal((await migration.promise).code, 0);
        assert.deepEqual(await has017(w.observer), APPLIED);
        await assertNoSettledNotes(w);
      } finally {
        await closeWorld(w);
      }
    });


    it("read group_members, then write it while 017 waits: no deadlock; the write goes ahead and 017 follows", async () => {
      const w = await world("t016");
      try {
        const a = await w.connect("conn_a");
        await a.ok(`${asStudent(w.ids.asha)}select count(*) from public.group_members;`);
        const touched = await tablesLockedBy(w.observer, a.pid);
        assert.ok(touched.includes("group_members") && !touched.includes("group_events"), `A read group_members, not group_events: ${touched.join(", ")}`);

        const migration = track(run017AsEditor(w.db, "migration"));
        const migrationPid = await pidOf(w.observer, "migration");
        await waitUntilBlocked(w.observer, migrationPid, [a.pid]);
        assert.deepEqual(await locksOf(w.observer, migrationPid), [
          { locktype: "relation", relation: "group_members", mode: "AccessExclusiveLock", granted: false },
          XID,
        ], "017 is queued for its first lock and holds nothing on either table");

        // A writes while 017 waits. A already holds a lock on group_members
        // that conflicts with 017's queued request, so Postgres lets A go
        // first instead of queueing it behind 017.
        const settle = await within(5000, a.send(rpc.review(w.g, w.ids.kiran, true)), "A's write");
        assert.equal(settle.sqlstate, "00000", settle.error);
        assert.equal(migration.settled, false, "017 is still waiting");

        // Anyone new queues behind 017.
        const r = await w.connect("reader");
        const read = track(r.send(`${asStudent(w.ids.meera)}select count(*) from public.group_members;`));
        await waitUntilBlocked(w.observer, r.pid, [migrationPid]);

        await a.ok("commit;");
        const done = await migration.promise;
        assert.equal(done.code, 0, done.stderr);
        assert.ok(!done.stderr.includes("deadlock"));
        assert.equal((await read.promise).sqlstate, "00000");
        await r.ok("rollback;");

        assert.deepEqual(await has017(w.observer), APPLIED);
        assert.deepEqual(await member(w, w.g, "kiran"), { status: "active", message: null });
        assert.ok(!(await historyNotes(w.observer)).includes("requested:N-KIRAN"));
        await assertNoSettledNotes(w);
      } finally {
        await closeWorld(w);
      }
    });

    it("a student who read the group history (which also reads group_members), then settles while 017 waits: no deadlock", async () => {
      const w = await world("t016");
      try {
        const a = await w.connect("conn_a");
        await a.ok(`${asStudent(w.ids.asha)}select count(*) from public.group_events;`);
        // The history's row policy calls is_group_admin(), which reads group_members.
        const touched = await tablesLockedBy(w.observer, a.pid);
        assert.ok(touched.includes("group_events") && touched.includes("group_members"), touched.join(", "));

        const migration = track(run017AsEditor(w.db, "migration"));
        await waitUntilBlocked(w.observer, await pidOf(w.observer, "migration"), [a.pid]);
        const settle = await within(5000, a.send(rpc.review(w.g, w.ids.kiran, true)), "A's write");
        assert.equal(settle.sqlstate, "00000", settle.error);
        await a.ok("commit;");
        const done = await migration.promise;
        assert.equal(done.code, 0, done.stderr);
        assert.deepEqual(await member(w, w.g, "kiran"), { status: "active", message: null });
        await assertNoSettledNotes(w);
      } finally {
        await closeWorld(w);
      }
    });

    for (const next of [
      { what: "writes group_members (settles a request)", sql: (w: World) => `${studentRole(w.ids.asha)}${rpc.review(w.g, w.ids.kiran, true)}` },
      { what: "reads group_members", sql: () => "select count(*) from public.group_members;" },
    ]) {
      it(`a session that read only group_events, then ${next.what} while 017 waits: DEADLOCK, one side rolled back`, async (t) => {
        const w = await world("t016");
        try {
          const a = await w.connect("conn_a");
          // As the owner (an operator or a background job; no row policy runs),
          // so only group_events is locked.
          await a.ok("begin;\nselect count(*) from public.group_events;");
          assert.deepEqual(await tablesLockedBy(w.observer, a.pid), ["group_events"]);

          const migration = track(run017AsEditor(w.db, "migration"));
          const migrationPid = await pidOf(w.observer, "migration");
          await waitUntilBlocked(w.observer, migrationPid, [a.pid]);
          assert.deepEqual(await locksOf(w.observer, migrationPid), [
            { locktype: "relation", relation: "group_events", mode: "AccessExclusiveLock", granted: false },
            { locktype: "relation", relation: "group_members", mode: "AccessExclusiveLock", granted: true },
            XID,
          ], "017 holds group_members and waits for group_events");

          const second = await within(10_000, a.send(next.sql(w)), "A's second statement");
          const aWent = second.sqlstate === "00000";
          await a.ok(aWent ? "commit;" : "rollback;");
          const result = await migration.promise;
          const oneLine = (text: string) => text.trim().replaceAll("\n", " / ");
          t.diagnostic(`A: ${second.sqlstate} ${oneLine(second.error)} | 017: exit ${result.code} ${oneLine(result.stderr)}`);

          const victims = [second.error, result.stderr].filter((text) => text.includes("deadlock detected")).length;
          assert.equal(victims, 1, "exactly one side is rolled back as a deadlock");
          if (result.code === 0) {
            assert.equal(second.sqlstate, "40P01");
            assert.deepEqual(await has017(w.observer), APPLIED);
          } else {
            assert.ok(aWent, "017 was rolled back, so A went through");
            assert.deepEqual(await has017(w.observer), NOT_APPLIED, "017 left nothing behind");
            assert.ok((await historyNotes(w.observer)).includes("invited:N-RAVI"), "and cleared nothing");
            const rerun = await run017AsEditor(w.db, "migration-2");
            assert.equal(rerun.code, 0, rerun.stderr);
            assert.deepEqual(await has017(w.observer), APPLIED);
          }
          await assertNoSettledNotes(w);
        } finally {
          await closeWorld(w);
        }
      });
    }
  });

  describe("017's ACCESS EXCLUSIVE locks, taken first", () => {
    it("017 takes both locks in its first statement, before anything else runs", async (t) => {
      const w = await world("t016");
      try {
        const catalogBefore = await catalogState(w.observer);
        // Hold group_events (as the owner, so only that table) to stop 017 between its two locks.
        const b = await w.connect("blocker");
        await b.ok("begin;\nselect count(*) from public.group_events;");
        // Statement by statement, so pg_stat_activity shows which one is running.
        const m = await w.connect("migration");
        await m.ok("begin;");
        const script = track(m.send(`${BS}i ${FILE_017}`));
        const wait = await waitUntilBlocked(w.observer, m.pid, [b.pid]);
        assert.match(wait.query, /^lock table public\.group_members, public\.group_events in access exclusive mode;$/);
        // Its only table locks: group_members held, group_events awaited. (The
        // transaction id comes with requesting an ACCESS EXCLUSIVE lock, which
        // Postgres logs for standbys at wal_level replica; nothing is written.)
        assert.deepEqual(await locksOf(w.observer, m.pid), [
          { locktype: "relation", relation: "group_events", mode: "AccessExclusiveLock", granted: false },
          { locktype: "relation", relation: "group_members", mode: "AccessExclusiveLock", granted: true },
          XID,
        ]);
        const [level] = await w.observer.rows<{ wal_level: string }>("select current_setting('wal_level') as wal_level");
        t.diagnostic(`wal_level ${level.wal_level}; 017 waiting in: ${wait.query.replaceAll("\n", " ")}`);
        assert.equal(script.settled, false);

        await b.ok("commit;");
        assert.equal((await script.promise).sqlstate, "00000");
        await m.ok("commit;");
        assert.notDeepEqual(await catalogState(w.observer), catalogBefore, "017's changes appear only once it commits");
        assert.deepEqual(await has017(w.observer), APPLIED);
        await assertNoSettledNotes(w);
      } finally {
        await closeWorld(w);
      }
    });

    it("017 run as one query (as the SQL Editor does) waits for group_members first and holds nothing else meanwhile", async () => {
      const w = await world("t016");
      try {
        const b = await w.connect("blocker");
        await b.ok(`${asStudent(w.ids.meera)}select count(*) from public.group_members;`);
        const migration = track(run017AsEditor(w.db, "migration"));
        const migrationPid = await pidOf(w.observer, "migration");
        await waitUntilBlocked(w.observer, migrationPid, [b.pid]);
        assert.deepEqual(await locksOf(w.observer, migrationPid), [
          { locktype: "relation", relation: "group_members", mode: "AccessExclusiveLock", granted: false },
          XID,
        ]);
        await b.ok("commit;");
        assert.equal((await migration.promise).code, 0);
        assert.deepEqual(await has017(w.observer), APPLIED);
      } finally {
        await closeWorld(w);
      }
    });

    it("while 017 holds them, reads and writes of both tables wait (other tables don't); after commit they all resume", async (t) => {
      const w = await world("t016");
      try {
        const m = await w.connect("migration");
        await m.ok(`begin;\n${BS}i ${FILE_017}`);
        const held = await locksOf(w.observer, m.pid);
        t.diagnostic(`017's locks on public tables before commit: ${JSON.stringify(held.filter((l) => l.relation && !l.relation.startsWith("pg_")))}`);
        assert.deepEqual(await tablesLockedBy(w.observer, m.pid), ["group_events", "group_members"], "017 locks no other table of the app");
        for (const table of ["group_events", "group_members"]) {
          assert.ok(held.some((l) => l.relation === table && l.mode === "AccessExclusiveLock" && l.granted), `${table}: ACCESS EXCLUSIVE held`);
        }

        const waiting = {
          memberList: await w.connect("member_list"),
          history: await w.connect("history"),
          operator: await w.connect("operator"),
          approve: await w.connect("approve"),
          request: await w.connect("request"),
        };
        const calls = {
          memberList: track(waiting.memberList.send(`${asStudent(w.ids.meera)}select count(*) from public.group_members;`)),
          history: track(waiting.history.send(`${asStudent(w.ids.asha)}select count(*) from public.notifications n join public.group_events e on e.id = n.event_id;`)),
          operator: track(waiting.operator.send("begin;\nselect count(*) from public.group_events;")),
          approve: track(waiting.approve.send(asStudent(w.ids.asha) + rpc.review(w.g, w.ids.kiran, true))),
          request: track(waiting.request.send(asStudent(w.ids.zed) + rpc.request(w.g2, "N-ZED"))),
        };
        for (const connection of Object.values(waiting)) await waitUntilBlocked(w.observer, connection.pid, [m.pid]);
        // A table 017 doesn't lock is untouched: a student's own notifications.
        const other = await w.connect("other");
        assert.equal((await within(5000, other.send(`${asStudent(w.ids.kiran)}select count(*) from public.notifications;`), "unrelated read")).sqlstate, "00000");
        await other.ok("rollback;");
        await delay(300);
        assert.ok(Object.values(calls).every((call) => !call.settled), "all still waiting");

        await m.ok("commit;");
        for (const [name, call] of Object.entries(calls)) assert.equal((await call.promise).sqlstate, "00000", name);
        await waiting.approve.ok("commit;");
        await waiting.request.ok("commit;");
        for (const connection of [waiting.memberList, waiting.history, waiting.operator]) await connection.ok("rollback;");

        // The writes ran after 017 committed, under its rules.
        assert.deepEqual(await member(w, w.g, "kiran"), { status: "active", message: null });
        assert.deepEqual(await member(w, w.g2, "zed"), { status: "requested", message: "N-ZED" });
        assert.ok((await historyNotes(w.observer)).includes("requested:N-ZED"));
        assert.ok(!(await historyNotes(w.observer)).includes("requested:N-KIRAN"));
        await assertNoSettledNotes(w);
        assert.deepEqual(await notesSeenBy(w, "omar"), ["sam:N-SAM", "tara:N-TARA", "zed:N-ZED"]);
      } finally {
        await closeWorld(w);
      }
    });

    it("if 017 rolls back: waiting work resumes under 016, no partial state is left, and 017 then re-runs safely", async () => {
      const w = await world("t016");
      try {
        const catalogBefore = await catalogState(w.observer);
        const dataBefore = await snapshot(w.observer);
        const m = await w.connect("migration");
        await m.ok(`begin;\n${BS}i ${FILE_017}`);
        const reader = await w.connect("reader");
        const writer = await w.connect("writer");
        const read = track(reader.send(`${asStudent(w.ids.asha)}select count(*) from public.group_members;`));
        const write = track(writer.send(asStudent(w.ids.asha) + rpc.review(w.g, w.ids.kiran, true)));
        await waitUntilBlocked(w.observer, reader.pid, [m.pid]);
        await waitUntilBlocked(w.observer, writer.pid, [m.pid]);

        await m.ok("rollback;");
        assert.equal((await read.promise).sqlstate, "00000");
        assert.equal((await write.promise).sqlstate, "00000");
        await writer.ok("commit;");
        // Under 016 rules again: the column is readable and the approval kept the note.
        assert.equal((await reader.send("select message from public.group_members;")).sqlstate, "00000");
        await reader.ok("rollback;");

        // No partial state: the catalog is exactly as before, and so is the data apart from the approval itself.
        assert.deepEqual(await has017(w.observer), NOT_APPLIED);
        assert.deepEqual(await catalogState(w.observer), catalogBefore);
        const dataAfter = await snapshot(w.observer);
        assertHistoryKept(dataBefore, dataAfter);
        assert.deepEqual(
          dataAfter.events.filter((e) => dataBefore.events.some((b) => b.id === e.id)),
          dataBefore.events,
          "no event detail was cleared",
        );
        assertOtherMembersKept(dataBefore, dataAfter, [w.ids.kiran]);
        assert.deepEqual(dataAfter.members.filter((r) => r.profile_id === w.ids.ravi).map((r) => r.message), ["N-RAVI"], "no member note was cleared");
        assert.deepEqual(await member(w, w.g, "kiran"), { status: "active", message: "N-KIRAN" });

        // Re-run: applies in full, clears what is settled (Kiran's too), and a further run changes nothing.
        const rerun = await run017AsEditor(w.db, "migration-2");
        assert.equal(rerun.code, 0, rerun.stderr);
        assert.deepEqual(await has017(w.observer), APPLIED);
        assert.deepEqual(await member(w, w.g, "kiran"), { status: "active", message: null });
        assert.deepEqual(await historyNotes(w.observer), ["invited:N-DEV", "invited:N-TARA", "requested:N-MEERA", "requested:N-SAM"]);
        assertHistoryKept(dataAfter, await snapshot(w.observer));
        await assertNoSettledNotes(w);
        const settledState = await snapshot(w.observer);
        assert.equal((await run017AsEditor(w.db, "migration-3")).code, 0);
        assert.deepEqual(await snapshot(w.observer), settledState);
      } finally {
        await closeWorld(w);
      }
    });

    it("the runbook's drain checks D1 and D2 catch a session still using the tables, and are empty once it ends", async () => {
      const w = await world("t016");
      try {
        const d1 = await runbookSql("-- D1.");
        const d2 = await runbookSql("-- D2.");
        // A straggler: a history read left open in a transaction.
        const s = await w.connect("straggler");
        await s.ok(`${asStudent(w.ids.asha)}select count(*) from public.group_events;`);

        const held = await w.observer.rows<{ pid: number; relname: string; granted: boolean }>(d1);
        assert.ok(held.some((r) => r.pid === s.pid && r.relname === "group_events" && r.granted), JSON.stringify(held));
        assert.ok(held.every((r) => r.pid !== w.observer.pid), "D1 leaves out its own session");
        const open = await w.observer.rows<{ pid: number; state: string }>(d2);
        assert.ok(open.some((r) => r.pid === s.pid && r.state === "idle in transaction"), JSON.stringify(open));

        await s.ok("commit;");
        assert.deepEqual(await w.observer.rows(d1), [], "D1: no rows once drained");
        assert.deepEqual(await w.observer.rows(d2), [], "D2: no open transactions once drained");
        // Drained: 017 runs straight through.
        const run = await within(15_000, run017AsEditor(w.db, "migration"), "017 after the drain");
        assert.equal(run.code, 0, run.stderr);
        assert.deepEqual(await has017(w.observer), APPLIED);
      } finally {
        await closeWorld(w);
      }
    });
  });

  describe("account deletion and 017", () => {
    const deleteAccount = (who: string) => `begin;\ndelete from auth.users where id = '${who}';`;

    for (const template of ["t016", "t017"] as const) {
      it(`an account deletion locks group_members before group_events (database on ${template.slice(1)})`, async () => {
        const w = await world(template);
        try {
          // Pause the deletion at group_events: by then it already holds group_members.
          const b = await w.connect("blocker");
          const d = await w.connect("deletion");
          await b.ok("begin;\nlock table public.group_events in share mode;");
          let deletion = track(d.send(deleteAccount(w.ids.dev)));
          await waitUntilBlocked(w.observer, d.pid, [b.pid]);
          let locks = await locksOf(w.observer, d.pid);
          assert.ok(locks.some((l) => l.relation === "group_members" && l.granted), "holds group_members");
          assert.ok(locks.some((l) => l.relation === "group_events" && !l.granted), "waits for group_events");
          await b.ok("commit;");
          assert.equal((await deletion.promise).sqlstate, "00000");
          await d.ok("rollback;");

          // Pause it at group_members instead: it holds nothing on group_events yet.
          await b.ok("begin;\nlock table public.group_members in share mode;");
          deletion = track(d.send(deleteAccount(w.ids.dev)));
          await waitUntilBlocked(w.observer, d.pid, [b.pid]);
          locks = await locksOf(w.observer, d.pid);
          assert.ok(locks.some((l) => l.relation === "group_members" && !l.granted), "waits for group_members");
          assert.ok(!locks.some((l) => l.relation === "group_events"), "nothing on group_events yet");
          await b.ok("commit;");
          assert.equal((await deletion.promise).sqlstate, "00000");
          await d.ok("rollback;");
        } finally {
          await closeWorld(w);
        }
      });
    }

    it("017 waits for a deletion in flight, then clears the deleted student's note left in the history", async () => {
      const w = await world("t016");
      try {
        const before = await snapshot(w.observer);
        const d = await w.connect("deletion");
        await d.ok(deleteAccount(w.ids.kiran));
        const migration = track(run017AsEditor(w.db, "migration"));
        await waitUntilBlocked(w.observer, await pidOf(w.observer, "migration"), [d.pid]);
        await d.ok("commit;");
        const done = await migration.promise;
        assert.equal(done.code, 0, done.stderr);

        const after = await snapshot(w.observer);
        assertDeletionKept(before, after, w.ids.kiran);
        assertNoNoteOf(before, after, w.ids.kiran);
        assert.deepEqual(await historyNotes(w.observer), ["invited:N-DEV", "invited:N-TARA", "requested:N-MEERA", "requested:N-SAM"]);
        await assertNoSettledNotes(w);
        assert.deepEqual(await notesSeenBy(w, "asha"), ["dev:N-DEV", "meera:N-MEERA"]);
      } finally {
        await closeWorld(w);
      }
    });

    it("a deletion in flight that rolls back: the student stays pending and the note stays readable", async () => {
      const w = await world("t016");
      try {
        const d = await w.connect("deletion");
        await d.ok(deleteAccount(w.ids.kiran));
        const migration = track(run017AsEditor(w.db, "migration"));
        await waitUntilBlocked(w.observer, await pidOf(w.observer, "migration"), [d.pid]);
        await d.ok("rollback;");
        assert.equal((await migration.promise).code, 0);
        assert.deepEqual(await member(w, w.g, "kiran"), { status: "requested", message: "N-KIRAN" });
        assert.ok((await historyNotes(w.observer)).includes("requested:N-KIRAN"));
        assert.deepEqual(await notesSeenBy(w, "asha"), ["dev:N-DEV", "kiran:N-KIRAN", "meera:N-MEERA"]);
        assert.deepEqual(await notesSeenBy(w, "kiran"), ["kiran:N-KIRAN"]);
        await assertNoSettledNotes(w);
      } finally {
        await closeWorld(w);
      }
    });

    it("a deletion waits for 017 in flight; after 017 commits, its triggers clear the note (cascade and SET NULL)", async () => {
      const w = await world("t016");
      try {
        const before = await snapshot(w.observer);
        const m = await w.connect("migration");
        await m.ok(`begin;\n${BS}i ${FILE_017}`);
        const d = await w.connect("deletion");
        const deletion = track(d.send(deleteAccount(w.ids.dev)));
        await waitUntilBlocked(w.observer, d.pid, [m.pid]);
        await m.ok("commit;");
        assert.equal((await deletion.promise).sqlstate, "00000");
        await d.ok("commit;");

        const after = await snapshot(w.observer);
        assertDeletionKept(before, after, w.ids.dev);
        assertNoNoteOf(before, after, w.ids.dev);
        assert.ok(before.notifications.some((n) => n.recipient_id === w.ids.dev), "set-up: Dev had been notified of his invitation");
        assert.deepEqual(await historyNotes(w.observer), ["invited:N-TARA", "requested:N-KIRAN", "requested:N-MEERA", "requested:N-SAM"]);
        await assertNoSettledNotes(w);
      } finally {
        await closeWorld(w);
      }
    });

    it("017 rolled back while a deletion waits: the deletion follows 016 (the note is left orphaned), and a re-run clears it", async () => {
      const w = await world("t016");
      try {
        const before = await snapshot(w.observer);
        const m = await w.connect("migration");
        await m.ok(`begin;\n${BS}i ${FILE_017}`);
        const d = await w.connect("deletion");
        const deletion = track(d.send(deleteAccount(w.ids.dev)));
        await waitUntilBlocked(w.observer, d.pid, [m.pid]);
        await m.ok("rollback;");
        assert.equal((await deletion.promise).sqlstate, "00000");
        await d.ok("commit;");
        // 016 behaviour: the invitation event loses its subject but keeps the note.
        const [orphan] = await w.observer.rows<{ subject_id: string | null; detail: string | null }>(
          "select subject_id, detail from public.group_events where kind = 'invited' and detail = 'N-DEV'",
        );
        assert.deepEqual(orphan, { subject_id: null, detail: "N-DEV" });

        const rerun = await run017AsEditor(w.db, "migration-2");
        assert.equal(rerun.code, 0, rerun.stderr);
        const after = await snapshot(w.observer);
        assertDeletionKept(before, after, w.ids.dev);
        assertNoNoteOf(before, after, w.ids.dev);
        await assertNoSettledNotes(w);
      } finally {
        await closeWorld(w);
      }
    });

    it("a deletion that arrives while 017 waits for its first lock queues behind it: no deadlock, note cleared", async () => {
      const w = await world("t016");
      try {
        const before = await snapshot(w.observer);
        const b = await w.connect("reader", "authenticator");
        await b.ok(`${asStudent(w.ids.meera)}select count(*) from public.group_members;`);
        const migration = track(run017AsEditor(w.db, "migration"));
        const migrationPid = await pidOf(w.observer, "migration");
        await waitUntilBlocked(w.observer, migrationPid, [b.pid]);
        const d = await w.connect("deletion");
        const deletion = track(d.send(deleteAccount(w.ids.kiran)));
        await waitUntilBlocked(w.observer, d.pid, [migrationPid]);
        const locks = await locksOf(w.observer, d.pid);
        assert.ok(locks.some((l) => l.relation === "group_members" && !l.granted), "queued for group_members behind 017");
        assert.ok(!locks.some((l) => l.relation === "group_events"), "holds nothing on group_events");

        await b.ok("rollback;");
        const done = await migration.promise;
        assert.equal(done.code, 0, done.stderr);
        assert.equal((await deletion.promise).sqlstate, "00000");
        await d.ok("commit;");
        const after = await snapshot(w.observer);
        assertDeletionKept(before, after, w.ids.kiran);
        assertNoNoteOf(before, after, w.ids.kiran);
        await assertNoSettledNotes(w);
      } finally {
        await closeWorld(w);
      }
    });
  });

  describe("single-statement history reads", () => {
    /** The notifications page's event lookup (loadNotifications in src/lib/groups.ts), as one statement. */
    const eventsQuery = (ids: string[]) =>
      `select coalesce(json_agg(t), '[]'::json) from (select * from public.group_events where id = any('{${ids.join(",")}}'::uuid[])) as t;`;
    /** The Your groups outcomes lookup (loadGroupDashboard), as one statement. */
    const outcomesQuery = (user: string) =>
      `select coalesce(json_agg(t), '[]'::json) from (select group_id, group_name, kind, created_at from public.group_events
       where subject_id = '${user}' and kind in ('request_approved', 'request_declined', 'invite_cancelled', 'member_removed')
       order by created_at desc limit 10) as t;`;
    const notifiedEvents = async (w: World, who: Person) =>
      (await w.observer.rows<{ event_id: string }>(`select event_id from public.notifications where recipient_id = '${w.ids[who]}'`)).map((r) => r.event_id);

    it("the notifications page's event query locks group_events when planned and group_members only while running", async (t) => {
      const w = await world("t016");
      try {
        const b = await w.connect("blocker");
        await b.ok("begin;\nlock table public.group_members in access exclusive mode;");
        const r = await w.connect("api", "authenticator");
        const read = track(r.send(asStudent(w.ids.asha) + eventsQuery(await notifiedEvents(w, "asha"))));
        const wait = await waitUntilBlocked(w.observer, r.pid, [b.pid]);
        assert.match(wait.query, /^select coalesce\(json_agg\(t\)/, "paused inside the one statement");
        const tables = (await locksOf(w.observer, r.pid)).filter((l) => ["group_events", "group_members", "notifications"].includes(l.relation ?? ""));
        t.diagnostic(JSON.stringify(tables));
        assert.deepEqual(tables, [
          { locktype: "relation", relation: "group_events", mode: "AccessShareLock", granted: true },
          { locktype: "relation", relation: "group_members", mode: "AccessShareLock", granted: false },
          { locktype: "relation", relation: "notifications", mode: "AccessShareLock", granted: true },
        ]);
        await b.ok("commit;");
        assert.equal((await read.promise).sqlstate, "00000");
        await r.ok("rollback;");
      } finally {
        await closeWorld(w);
      }
    });

    it("the Your groups outcomes query (own events) never touched group_members here", async () => {
      const w = await world("t016");
      try {
        await w.act("asha", rpc.review(w.g, w.ids.meera, false)); // an outcome for Meera
        const b = await w.connect("blocker");
        await b.ok("begin;\nlock table public.group_members in access exclusive mode;");
        const r = await w.connect("api", "authenticator");
        const read = await within(5000, r.send(asStudent(w.ids.meera) + outcomesQuery(w.ids.meera)), "outcomes query");
        assert.equal(read.sqlstate, "00000");
        assert.match(read.out, /request_declined/);
        assert.ok(!(await locksOf(w.observer, r.pid)).some((l) => l.relation === "group_members"));
        await r.ok("rollback;");
        await b.ok("rollback;");
      } finally {
        await closeWorld(w);
      }
    });

    for (const pause of [0, 1500]) {
      it(`DEADLOCK in one statement: the event query arriving while 017 waits for group_members (${pause} ms before 017 gets it)`, async (t) => {
        const w = await world("t016");
        try {
          // 1. A student's member list keeps group_members, so 017 queues for it.
          const b = await w.connect("member_list", "authenticator");
          await b.ok(`${asStudent(w.ids.meera)}select count(*) from public.group_members;`);
          const migration = track(run017AsEditor(w.db, "migration"));
          const migrationPid = await pidOf(w.observer, "migration");
          await waitUntilBlocked(w.observer, migrationPid, [b.pid]);
          // 2. The admin opens notifications: one statement takes group_events, then queues for group_members behind 017.
          const r = await w.connect("api", "authenticator");
          const read = track(r.send(asStudent(w.ids.asha) + eventsQuery(await notifiedEvents(w, "asha"))));
          await waitUntilBlocked(w.observer, r.pid, [migrationPid]);
          assert.ok((await locksOf(w.observer, r.pid)).some((l) => l.relation === "group_events" && l.granted));
          // 3. The member list ends: 017 takes group_members and waits for group_events, held by the event query.
          await delay(pause);
          await b.ok("rollback;");
          const [query, result] = [await read.promise, await migration.promise];
          await r.ok("rollback;");
          const oneLine = (text: string) => text.trim().replaceAll("\n", " / ");
          t.diagnostic(`event query: ${query.sqlstate} ${oneLine(query.error)} | 017: exit ${result.code} ${oneLine(result.stderr)}`);

          const victims = [query.error, result.stderr].filter((text) => text.includes("deadlock detected")).length;
          assert.equal(victims, 1, "exactly one side is rolled back as a deadlock");
          if (result.code === 0) {
            assert.equal(query.sqlstate, "40P01", "the read was the victim");
            assert.deepEqual(await has017(w.observer), APPLIED);
          } else {
            assert.equal(query.sqlstate, "00000", "017 was the victim, so the read finished");
            assert.deepEqual(await has017(w.observer), NOT_APPLIED, "017 left nothing behind");
            assert.equal((await run017AsEditor(w.db, "migration-2")).code, 0);
            assert.deepEqual(await has017(w.observer), APPLIED);
          }
          await assertNoSettledNotes(w);
        } finally {
          await closeWorld(w);
        }
      });
    }
  });

  describe("drain checks D1 and D2", () => {
    it("D1 lists both granted and waiting locks, on either table", async () => {
      const w = await world("t016");
      try {
        const d1 = await runbookSql("-- D1.");
        const b = await w.connect("holder");
        await b.ok("begin;\nlock table public.group_members, public.group_events in access exclusive mode;");
        const w1 = await w.connect("member_list", "authenticator");
        const w2 = await w.connect("history_job");
        const reads = [
          track(w1.send(`${asStudent(w.ids.meera)}select count(*) from public.group_members;`)),
          track(w2.send("begin;\nselect count(*) from public.group_events;")),
        ];
        await waitUntilBlocked(w.observer, w1.pid, [b.pid]);
        await waitUntilBlocked(w.observer, w2.pid, [b.pid]);
        const rows = (await w.observer.rows<{ pid: number; relname: string; granted: boolean }>(d1)).map((r) => `${r.pid}:${r.relname}:${r.granted}`);
        for (const expected of [
          `${b.pid}:group_members:true`,
          `${b.pid}:group_events:true`,
          `${w1.pid}:group_members:false`,
          `${w2.pid}:group_events:false`,
        ]) assert.ok(rows.includes(expected), `${expected} in ${rows.join(", ")}`);
        await b.ok("rollback;");
        for (const read of reads) assert.equal((await read.promise).sqlstate, "00000");
        await w1.ok("rollback;");
        await w2.ok("rollback;");
        assert.deepEqual(await w.observer.rows(d1), []);
      } finally {
        await closeWorld(w);
      }
    });

    it("D1 and D2 see every role's sessions, even when run by a role without monitoring rights", async () => {
      const w = await world("t016");
      try {
        const [d1, d2] = [await runbookSql("-- D1."), await runbookSql("-- D2.")];
        const api = await w.connect("api", "authenticator");
        await api.ok(`${asStudent(w.ids.asha)}select count(*) from public.group_events;`);
        const service = await w.connect("service", "authenticator");
        await service.ok("begin;\nset local role service_role;\nselect count(*) from public.group_members;");
        const owner = await w.connect("owner");
        await owner.ok("begin;\nselect count(*) from public.group_members;");
        const ops = await w.connect("ops", "ops");
        const sessions = [api.pid, service.pid, owner.pid];

        // Why D2 reads pg_locks: without monitoring rights, other roles' transaction
        // details are hidden. backend_type comes back NULL (not empty), which D2's
        // coalesce(backend_type, 'client backend') keeps.
        const activity = `select usename, backend_type, xact_start, state from pg_stat_activity where pid = ${api.pid}`;
        const [hidden] = await ops.rows<Record<string, unknown>>(activity);
        assert.deepEqual(hidden, { usename: "authenticator", backend_type: null, xact_start: null, state: null });
        const [visible] = await w.observer.rows<{ backend_type: string; state: string }>(activity);
        assert.deepEqual([visible.backend_type, visible.state], ["client backend", "idle in transaction"], "a superuser sees them");
        // Regression: D2 run by the limited role still names the open API transaction.
        const apiRow = (await ops.rows<{ pid: number; usename: string }>(d2)).find((r) => r.pid === api.pid);
        assert.deepEqual(apiRow && { pid: apiRow.pid, usename: apiRow.usename }, { pid: api.pid, usename: "authenticator" });

        for (const observer of [w.observer, ops]) {
          const held = new Set((await observer.rows<{ pid: number }>(d1)).map((r) => r.pid));
          const open = new Set((await observer.rows<{ pid: number }>(d2)).map((r) => r.pid));
          for (const pid of sessions) {
            assert.ok(held.has(pid), `D1 as ${observer.name} sees ${pid}`);
            assert.ok(open.has(pid), `D2 as ${observer.name} sees ${pid}`);
          }
        }
        for (const session of [api, service, owner]) await session.ok("rollback;");
        for (const observer of [w.observer, ops]) {
          assert.deepEqual(await observer.rows(d1), [], `D1 as ${observer.name}, drained`);
          assert.deepEqual(await observer.rows(d2), [], `D2 as ${observer.name}, drained`);
        }
      } finally {
        await closeWorld(w);
      }
    });
  });
});
