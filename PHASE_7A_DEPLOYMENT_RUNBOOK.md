> **SUPERSEDED: do not use this document for deployment.** The canonical, self-contained runbook for migrations 017 and 018 is [`ROOMIE_PHASE_7A_7B_DEPLOYMENT_RUNBOOK.md`](ROOMIE_PHASE_7A_7B_DEPLOYMENT_RUNBOOK.md). This file is kept only as a historical record. It doesn't cover migration 018, and its test count, checks and step order are out of date.

# Phase 7A deployment runbook: migration 017 and the matching app

**Approval:** use this only with explicit approval for the production change. Nothing here has been run against production. Every SQL block below was checked for syntax and for the expected results against a local test database (PGlite) built from migrations 001–017, not against production. 017 itself was also run against concurrent transactions on a disposable local PostgreSQL 17.12 (Docker); see the completion report.

**What goes live together:**
- **Database:** `supabase/migrations/017_group_membership_notes_privacy.sql`
  - SHA-256 `18d12b56850cad31b71b5ad25e583a6c40412701cab51bc065fd52be9f67a690`, 12,239 bytes, LF line endings.
  - Its first statement takes ACCESS EXCLUSIVE locks on `group_members` and `group_events`, so the app must be drained before it runs (section 2).
- **App:** the code that reads notes through `group_membership_notes()`. Changed files: `src/lib/groups.ts` and `src/types/database.ts`.

**Why they can't go separately:**
- The new app calls a function that only exists after 017.
- After 017, the old app's queries that select `group_members.message` are refused (`permission denied`). That breaks group pages and **Your groups** for admins and for students with pending invitations or requests.

There's no compatible in-between state, so plan one short window.

| Step type | Steps |
|---|---|
| **Reversible** | App deploy and revert. 017's privileges, function, triggers and constraint (rollback SQL in section 4) |
| **Destructive, not reversible** | The note text 017 clears: settled notes on membership rows and in group history. Rolling back the app or the schema does **not** bring it back. Only a full database restore does, and that also loses every other change made after the backup |

---

## 1. Before the window

### 1.1 Freeze the release

1. **Commit** the reviewed Phase 7A work on its own branch. This needs your separate go-ahead; nothing has been committed yet.
2. **Write down** the release commit SHA: `________`.
3. **Confirm the migration hash** in PowerShell, from `c:\Users\hn072\all projects\roomie`:
   ```powershell
   Get-FileHash supabase\migrations\017_group_membership_notes_privacy.sql -Algorithm SHA256
   ```
   Expected: `18D12B56850CAD31B71B5AD25E583A6C40412701CAB51BC065FD52BE9F67A690`.
4. **Confirm the checks pass on that exact commit.** Expected: 397 of 397 tests, 0 lint problems, the type check passes, the build succeeds.
   ```powershell
   npm test
   ```
   ```powershell
   npm run lint
   ```
   ```powershell
   npx tsc --noEmit
   ```
   ```powershell
   npm run build
   ```
   Optional, needs Docker Desktop running (about a minute; 38 of 38 expected). It starts its own network-less PostgreSQL container and removes it afterwards:
   ```powershell
   node --disable-warning=ExperimentalWarning --test tests/concurrency/membership-notes.concurrency.mts
   ```
5. **Prepare the matching app release** from that commit (hosting deploy, or the local server), ready to start the moment 017 commits.

### 1.2 Recovery point

- **Find the latest backup.** In the Supabase dashboard (project `roxtxipioqtggnqyhpgs`), open **Database → Backups** and note the newest backup or point-in-time recovery option your plan offers: `________`.
- **The note cleanup can't be undone.** Removing settled notes is the purpose of this change, so a separate copy of them is not kept. If the plan offers no backup, accept that.
- **What a restore would mean:** it brings back the whole database as of the backup. Anything students did after that (messages, likes, listings) would be lost too.

### 1.3 Read-only preflight (SQL Editor, as `postgres`)

Run each block on its own and record the results. None of them changes anything.

```sql
-- P1. Who runs the SQL, and who owns the tables (all three must be postgres)
select current_user as running_as,
       (select tableowner from pg_tables where schemaname = 'public' and tablename = 'group_members') as group_members_owner,
       (select tableowner from pg_tables where schemaname = 'public' and tablename = 'group_events') as group_events_owner;
```

```sql
-- P2. 017 not applied yet (expected: false)
select to_regprocedure('public.group_membership_notes(uuid[])') is not null as already_applied;
```

```sql
-- P3. Effective permissions before migration (expected: true, true, false)
select
  has_table_privilege('authenticated', 'public.group_members', 'select') as authenticated_table_select,
  has_column_privilege('authenticated', 'public.group_members', 'message', 'select') as authenticated_note_select,
  has_table_privilege('anon', 'public.group_members', 'select') as anon_table_select;
```

```sql
-- P4. Notes on membership rows by status (non-pending ones will be cleared)
select status, count(*) filter (where message is not null) as notes
from public.group_members
group by status
order by status;
```

P5 uses exactly the same matching rule as 017's history cleanup, including the privacy-first rule for exact time ties: of identical notes for one member, group and kind, only the strictly most recent copy is kept, and if the most recent copies share the exact same `created_at`, none is. Locally, its `notes_to_clear` matched the number of notes 017 actually cleared. P5b counts just the tied copies; a pending row keeps its own note either way, and its readers still get it from `group_membership_notes()`.

```sql
-- P5. Notes in the group history: kept (pending) vs to be cleared (settled)
select e.kind,
       count(*) filter (where p.keep) as notes_kept,
       count(*) filter (where not p.keep) as notes_to_clear
from public.group_events as e
cross join lateral (
  select exists (
    select 1
    from public.group_members as m
    where m.group_id = e.group_id
      and m.profile_id = e.subject_id
      and m.status = e.kind
      and m.message = e.detail
      and not exists (
        select 1 from public.group_events as other
        where other.group_id = e.group_id
          and other.subject_id = e.subject_id
          and other.kind = e.kind
          and other.detail = e.detail
          and other.id <> e.id
          and other.created_at >= e.created_at)
  ) as keep
) as p
where e.kind in ('invited', 'requested') and e.detail is not null
group by e.kind
order by e.kind;
```

```sql
-- P5b. History copies of a note that share the exact same time (017 clears all of them)
select e.kind, count(*) as tied_copies
from public.group_events as e
where e.kind in ('invited', 'requested')
  and e.detail is not null
  and exists (
    select 1 from public.group_events as other
    where other.group_id = e.group_id
      and other.subject_id = e.subject_id
      and other.kind = e.kind
      and other.detail = e.detail
      and other.id <> e.id
      and other.created_at = e.created_at)
group by e.kind
order by e.kind;
```

```sql
-- P6. Baseline row counts (must be identical after the migration)
select (select count(*) from public.group_events) as events,
       (select count(*) from public.notifications) as notifications,
       (select count(*) from public.notifications where read_at is not null) as read_notifications,
       (select count(*) from public.group_events where kind = 'role_changed') as role_events;
```

**Stop and don't proceed if:**
- P1 shows anything other than `postgres`;
- P2 is `true`;
- P3 is unexpected.

**Last known values,** read-only check on 2026-11-25:
- P1: `postgres` / `postgres`, the `group_members` owner (the `group_events` owner wasn't checked then);
- P3: `true, true, false`;
- P4: no rows (the table was empty).

### 1.4 Plan the window

- **Pick a short, quiet time,** about 15 minutes, and tell testers in advance.
- **Have four things open:**
  - the SQL Editor with 017 pasted in, verified by its hash, in its own tab;
  - a second SQL Editor tab with the drain checks D1 and D2 (section 2);
  - the app release ready to go;
  - this runbook.

## 2. During the window

**Why the app must be drained first.** 017's first statement takes the strongest lock (ACCESS EXCLUSIVE) on `group_members`, then on `group_events`, and holds both until it commits. Tested on PostgreSQL 17.12:
- **While 017 waits for or holds those locks,** every other read and write of the two tables waits behind it. Students' member lists, group history and notifications all pause for that time (milliseconds when nothing else is running).
- **A transaction that already touched `group_members`** (for example, it read it and is about to write it) is let through ahead of 017. 017 simply runs after it, with no error.
- **A transaction that touched `group_events` but not yet `group_members`, and then needs `group_members`,** deadlocks with 017, and Postgres rolls back one of the two. If 017 is the one, nothing of it remains and a re-run works (tested).
- **The notifications page does exactly this, in a single query.** Its event lookup locks `group_events` when the query is planned, and reaches `group_members` only while running, through the access rule's `is_group_admin()`. A test reproduced the deadlock with this query and the real access rules. Which side loses depends on timing: when 017 got `group_members` at once, the page's query was rolled back; when 017 got it 1.5 seconds later, 017 was rolled back.
- **Not this shape:**
  - **Account deletions** lock `group_members` before `group_events`, so they only wait for 017, or 017 waits for them (tested both ways, with no deadlock).
  - **The "Your groups" outcomes lookup** didn't touch `group_members` in the tests.

  Keep both stopped anyway: they change or read these tables during the window.
- **The precondition, therefore:** when 017 starts, no session may hold or be waiting for a lock on either table, and nothing may start new work on them until 017 has committed and the matching app is deployed.

**Drain, check, then migrate:**

1. **Stop application traffic and background work.**
   - Take the app offline (hosting maintenance mode or deployment stopped; in development, stop `npm run dev`). All membership changes and all history and notification pages run on the app server, so this stops them.
   - Background work: this repository has no scheduled jobs, Edge Functions, `pg_cron` or `pg_net`. Check nothing like that has been added in the Supabase dashboard (**Database → Cron Jobs**, **Edge Functions**). Don't run `npm run seed` or `npm run unseed`.
   - Dashboard: don't delete or edit users (**Authentication**) and don't edit group tables in the **Table Editor** during the window. Close other SQL Editor tabs.
   - Browsers that still have Roomie open can keep calling Supabase for group chat (reading and sending chat messages, marking chat read). Those calls touch `group_members` only, so at most they wait a few milliseconds behind 017. They can't cause the deadlock above.
2. **Let in-flight work finish.** Wait about a minute after the app stops, then run D2 in the second tab:
   ```sql
   -- D2. Other sessions with an open transaction (none may come from the app)
   select l.pid, a.usename, a.application_name, a.state,
          now() - a.xact_start as transaction_age, left(a.query, 80) as query
   from pg_locks as l
   left join pg_stat_activity as a on a.pid = l.pid
   where l.locktype = 'virtualxid' and l.mode = 'ExclusiveLock' and l.granted
     and l.pid <> pg_backend_pid()
     and coalesce(a.backend_type, 'client backend') = 'client backend'
   order by l.pid;
   ```
   - **Expected:** no rows from `authenticator`, the API that the app and browsers use.
   - **Why it reads `pg_locks`:** every open transaction holds a lock on its own transaction number, and anyone can read `pg_locks`. If the role you're signed in as lacks monitoring rights, `pg_stat_activity` hides other roles' `state`, `query` and start times (tested). So in this query and in D1 those columns may be blank for other roles, but the row still appears, and **any row still means "not drained"**.
   - **Supabase's own services** may show short-lived rows under their own role names. What decides is D1.
3. **Confirm nothing holds the two tables.** Run D1 immediately before 017:
   ```sql
   -- D1. Sessions holding or waiting for a lock on the two tables (must return no rows)
   select a.pid, a.usename, a.application_name, a.state, c.relname, l.mode, l.granted,
          now() - a.xact_start as transaction_age, left(a.query, 80) as query
   from pg_locks as l
   join pg_class as c on c.oid = l.relation
   join pg_stat_activity as a on a.pid = l.pid
   where c.oid in ('public.group_members'::regclass, 'public.group_events'::regclass)
     and l.pid <> pg_backend_pid()
   order by a.pid;
   ```
   - **No rows:** go on to step 4 straight away.
   - **Any row:** don't run 017. Wait and run D1 again. If a session stays `idle in transaction`, find out what it is from `usename` and `application_name` before doing anything about it. Ending another session is your call, not part of this runbook.
   - **Lock states:** D1 lists both locks a session holds (`granted` true) and locks it is waiting for (`granted` false), for every role (tested). The same note about blank columns as for D2 applies.
   - **The freeze, not D1 or D2, is what keeps the tables quiet.** Both checks show only the moment you run them, and neither stops new work from starting. Keep step 1's freeze in place until step 8.
4. **Apply 017**, in its own SQL Editor tab, as `postgres` (the owner):
   - paste the whole reviewed file and run it once;
   - accept the "destructive operations" prompt;
   - a single run is atomic, so it applies completely or not at all.
5. **If 017 fails,** nothing was applied. A rolled-back 017 was verified to leave the 016 schema and data exactly as they were.
   - **`deadlock detected` or another lock error:** something was still using the tables. Keep the app stopped, repeat steps 2 and 3, then run 017 again. Re-running after a rollback was tested.
   - **Any other error:** don't deploy the new app. Restart the old one and investigate.
6. **If 017 succeeds,** keep traffic stopped and deploy or start the matching app immediately. Don't leave production running the old app against the new schema.
7. **Run the checks in section 3.1** while traffic is still stopped.
8. **Resume:** only now make the app available again, then do the smoke tests in section 3.2.

## 3. After the window

### 3.1 Verification SQL (as `postgres`, read-only)

```sql
-- V1. Privileges (expected: false, false, true, false, false)
select
  has_table_privilege('authenticated', 'public.group_members', 'select') as authenticated_table_select,
  has_column_privilege('authenticated', 'public.group_members', 'message', 'select') as authenticated_note_select,
  has_column_privilege('authenticated', 'public.group_members', 'status', 'select') as authenticated_status_select,
  has_table_privilege('anon', 'public.group_members', 'select') as anon_table_select,
  has_table_privilege('authenticated', 'public.group_events', 'update') as authenticated_events_update;
```

```sql
-- V2. Functions: owner, security definer, search path, who may execute
select p.proname,
       pg_get_userbyid(p.proowner) as owner,
       p.prosecdef as security_definer,
       p.proconfig as config,
       has_function_privilege('anon', p.oid, 'execute') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_exec
from pg_proc as p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('group_membership_notes', 'clear_settled_group_member_note',
                    'clear_settled_membership_event_notes', 'clear_orphaned_event_note')
order by p.proname;
```

Expected V2 values: owner `postgres` for every function, and config `{search_path=""}`.

| proname | security_definer | anon_exec | authenticated_exec |
|---|---|---|---|
| `clear_orphaned_event_note` | false | false | false |
| `clear_settled_group_member_note` | false | false | false |
| `clear_settled_membership_event_notes` | true | false | false |
| `group_membership_notes` | true | false | **true** |

```sql
-- V3. Triggers on the two tables (expected: every row tgenabled = 'O')
select c.relname as table_name, t.tgname, t.tgenabled
from pg_trigger as t
join pg_class as c on c.oid = t.tgrelid
where c.relnamespace = 'public'::regnamespace
  and c.relname in ('group_members', 'group_events')
  and not t.tgisinternal
order by 1, 2;
```

V3 must include these four new triggers, alongside the existing ones:
- `group_events_clear_orphaned_note`
- `group_members_clear_deleted_event_notes`
- `group_members_clear_settled_event_notes`
- `group_members_clear_settled_note`

```sql
-- V4. The constraint (expected: one row, convalidated = true)
select conname, convalidated, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.group_members'::regclass
  and conname = 'group_members_note_only_while_pending';
```

```sql
-- V5. No settled note left on a membership row (expected: 0)
select count(*) as settled_member_notes
from public.group_members
where message is not null and status not in ('invited', 'requested');
```

**Then:**
- **Re-run P5.** Expected: `notes_to_clear` is 0 or no rows, and `notes_kept` equals P5's preflight value.
- **Re-run P6.** Expected: every count equals the preflight values, so no event or notification was lost.

```sql
-- V6. Row-level security still on (expected: all true)
select relname, relrowsecurity
from pg_class
where oid in ('public.group_members'::regclass, 'public.group_events'::regclass,
              'public.notifications'::regclass, 'public.group_messages'::regclass)
order by relname;
```

### 3.2 Two-account SRM smoke tests

Use the two SRM test accounts:
- **A** = the account in normal Chrome; it will be the admin;
- **B** = the second account (Incognito, or the VS Code browser).

Use these distinctive notes so they're easy to spot: `SMOKE-REQ-1`, `SMOKE-INV-1`.

1. **A** creates a group called **Smoke test 7A** (discoverable).
2. **B** opens it and asks to join with the note `SMOKE-REQ-1`.
3. **A, the admin, sees the pending request note:**
   - on the group page, under requests;
   - on **Your groups**, under approvals;
   - in **Updates**, where "B asked to join" shows `SMOKE-REQ-1`.
4. **The database refuses B's direct read of the column, and the function returns only B's own note.** Run these as `postgres`, each block on its own. They change nothing: `set local` lasts only for that run.
   - First find the ids:
     ```sql
     select id, full_name from public.profiles order by full_name;
     ```
     ```sql
     select id, name from public.groups where name = 'Smoke test 7A';
     ```
   - Then try B's direct read. Expected: `ERROR: permission denied for table group_members`.
     ```sql
     -- S1. As student B: read the note column directly
     select set_config('request.jwt.claims', '{"sub":"<B-UUID>","role":"authenticated"}', true);
     set local role authenticated;
     select message from public.group_members limit 1;
     ```
   - If S1 returns rows instead of the error, the editor didn't switch to the student role. Stop, and don't trust these two probes. They were verified locally (PGlite) but not yet in the Supabase SQL Editor.
   - Then the function. Expected: while B's request is pending, one row (B's own `SMOKE-REQ-1`). After step 8, no rows.
     ```sql
     -- S2. As student B: what the note function returns for that group
     select set_config('request.jwt.claims', '{"sub":"<B-UUID>","role":"authenticated"}', true);
     set local role authenticated;
     select profile_id, status, message from public.group_membership_notes(array['<GROUP-UUID>']::uuid[]);
     ```
5. **A** declines the request. **Settled notes disappear:**
   - A's **Updates** still lists "B asked to join", but without the quote;
   - P5 shows `notes_to_clear` of 0 (or no rows at all, once no notes remain).
6. **A** invites B, with the note `SMOKE-INV-1`.
7. **B, the invitee, sees their own invitation note:**
   - on **Your groups** → *Invitations for you*;
   - on the group page;
   - in **Updates**.
8. **B** accepts. Now:
   - the invitation note is gone from B's **Updates**;
   - B is an ordinary member;
   - S1 still says `permission denied`;
   - S2 returns no rows.
9. **Group chat:** both accounts open the chat, see "B joined", and exchange one message each. Unread badges and the chat list behave as before.
10. **Other group features:** member list, leave and rejoin (optional), discovery and notifications all work.

**About the ordinary-member check:** with only two accounts there's never a *third* student's pending note for B to try to read. So "an ordinary member can't read another student's note" is shown here at the database boundary: S1 is refused for the whole column, whatever the rows. The data case itself is covered by the local tests.

**Cleanup:** the smoke-test group is production data, so remove it only with a separate approval. For example, both members leave, which archives it, or delete it by name in the SQL Editor.

### 3.3 If something is wrong

- **The app fails to load group pages:**
  - check that the deployed commit is the release commit (`loadNotes` / `group_membership_notes`);
  - re-run V1–V3.
- **Prefer a fix-forward.** A schema rollback reopens F-01.

## 4. Rollback, and its limits

**Reversible:** the app, and 017's schema objects. This SQL takes the schema back to the 016 behaviour so the old app works again. **It reopens the F-01 leak**, so use it only as an emergency step, then fix forward.

R drops triggers on both tables, so it takes the same locks as 017, in the same order and up front. Drain the app first, exactly as in section 2 (steps 1–3).

```sql
-- R. Emergency structural rollback of 017 (reopens F-01; does NOT restore cleared notes)
lock table public.group_members, public.group_events in access exclusive mode;
drop trigger if exists group_members_clear_settled_event_notes on public.group_members;
drop trigger if exists group_members_clear_deleted_event_notes on public.group_members;
drop trigger if exists group_events_clear_orphaned_note on public.group_events;
drop trigger if exists group_members_clear_settled_note on public.group_members;
alter table public.group_members drop constraint if exists group_members_note_only_while_pending;
drop function if exists public.group_membership_notes(uuid[]);
drop function if exists public.clear_settled_membership_event_notes();
drop function if exists public.clear_orphaned_event_note();
drop function if exists public.clear_settled_group_member_note();
grant select on public.group_members to authenticated;
```

After running R, redeploy the previous app commit.

**Not reversible:** the note text 017 cleared.
- **What was cleared:**
  - settled notes on membership rows;
  - settled notes in `group_events.detail`, including what notifications showed.
- **What doesn't bring it back:** rolling back the app, or running R, restores neither.
- **The only recovery** is restoring a backup from before the window, which rolls back **all** data to that point.

Clearing these notes is the intended outcome, so recovering them should almost never be wanted.

## 5. Sign-off

| Check | Result | By / time |
|---|---|---|
| Release commit and 017 hash confirmed | | |
| Preflight P1–P6 recorded | | |
| App and background work stopped; D2 shows no app transactions | | |
| D1 returned no rows immediately before 017 | | |
| 017 applied once as `postgres` | | |
| Matching app deployed | | |
| V1–V6, P5 and P6 re-checked | | |
| Smoke tests 1–10 | | |
| App reopened | | |
