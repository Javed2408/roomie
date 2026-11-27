# Roomie Phase 7A + 7B deployment runbook: migrations 017 and 018 and the matching app

**This is the single document to follow.** It replaces `PHASE_7A_DEPLOYMENT_RUNBOOK.md` and section 6 of `PHASE_7B_MIGRATION_018.md` for running the window.

**Approval:** use this only with explicit approval for the production change.
- Nothing here has been run against production.
- Every SQL block was checked against local test databases built from migrations 001–018: PGlite, plus PostgreSQL 17.12 in Docker for the locking behaviour.
- None of it was run in the Supabase SQL Editor.

## 0. What goes live, and the rules that never change

| Release item | File | SHA-256 (of the committed file's exact bytes) | Size |
|---|---|---|---|
| Migration 017: private membership notes (F-01) | `supabase/migrations/017_group_membership_notes_privacy.sql` | `18d12b56850cad31b71b5ad25e583a6c40412701cab51bc065fd52be9f67a690` | 12,239 bytes, LF |
| Migration 018: former admins lose pending notes | `supabase/migrations/018_revoke_former_admin_membership_note_access.sql` | `a5b34ab2fa65d88ffbf8031b2e5e20ad3122ad0ddce94f50ea7090f82f72b042` | 2,572 bytes, LF |
| App | the release commit; it reads notes only through `group_membership_notes()` (`src/lib/groups.ts`, `src/types/database.ts`) | — | — |

**Rules:**
- **017 and the matching app go live together.**
  - The new app calls a function that only exists after 017.
  - After 017, the old app's reads of `group_members.message` are refused (`permission denied`). That breaks group pages and **Your groups** for admins and for students with pending invitations or requests.
  - There's no compatible in-between state.
- **018 doesn't affect the app.** The app works with or without it. It runs in the same window, right after 017, so the window closes the former-admin gap too.
- **The maintenance freeze is mandatory.** 017's first statement takes ACCESS EXCLUSIVE locks on `group_members` and `group_events`. The notifications page can deadlock with 017 in a single query (reproduced in tests). Only the freeze prevents that; the D1 and D2 checks don't.
- **Clearing settled note text can't be undone** (section 7).

| Step type | Steps |
|---|---|
| **Reversible** | App deploy and revert; 018 (rollback R18); 017's privileges, function, triggers and constraint (rollback R017). Each rollback reopens a privacy gap; see section 6 |
| **Destructive, not reversible** | The note text 017 clears: settled notes on membership rows and in the group history. Rolling back the app or the schema does **not** bring it back. Only a full database restore does, and that also loses every other change made after the backup |

---

## 1. Before the window

### 1.1 Freeze the release

1. **Commit** the reviewed Phase 7A + 7B work on its own branch. This needs your separate go-ahead.
   - Stage files by name.
   - Never add `graphify-out/`, `.env.local` or `.claude/settings.local.json`.
2. **Write down** the release commit SHA: `________`.
3. **Verify both migration hashes from the commit itself,** in PowerShell from `c:\Users\hn072\all projects\roomie`, on the release commit.
   - **Why from the commit:** this machine has `core.autocrlf=true`, so a fresh checkout can turn the files into CRLF and change `Get-FileHash` results on the working copy, even though the committed content is identical.
   - **What this checks:** the hash of the exact committed bytes. It needs no change to Git settings and no `.gitattributes`.
   ```powershell
   $commit = git rev-parse HEAD
   ```
   ```powershell
   python -c "import hashlib,subprocess,sys; c=sys.argv[1]; r=[(p,e,hashlib.sha256(subprocess.run(['git','show',c+':'+p],capture_output=True,check=True).stdout).hexdigest()) for p,e in (a.split('=') for a in sys.argv[2:])]; [print('OK      ' if h==e else 'MISMATCH', h, p) for p,e,h in r]; sys.exit(any(h!=e for p,e,h in r))" $commit supabase/migrations/017_group_membership_notes_privacy.sql=18d12b56850cad31b71b5ad25e583a6c40412701cab51bc065fd52be9f67a690 supabase/migrations/018_revoke_former_admin_membership_note_access.sql=a5b34ab2fa65d88ffbf8031b2e5e20ad3122ad0ddce94f50ea7090f82f72b042
   ```
   - **Expected:** two `OK` lines, and `$LASTEXITCODE` is 0. Any `MISMATCH` means stop.
   - **How it works:** `git show <commit>:<path>` returns the committed bytes with no line-ending conversion, and Python hashes those raw bytes. PowerShell pipes can't be used here, because they re-encode text.
4. **Make byte-exact copies to paste from,** so you never paste a converted file. These go to your temp folder:
   ```powershell
   python -c "import subprocess,sys; open(sys.argv[3],'wb').write(subprocess.run(['git','show',sys.argv[1]+':'+sys.argv[2]],capture_output=True,check=True).stdout)" $commit supabase/migrations/017_group_membership_notes_privacy.sql $env:TEMP\roomie-017.sql
   ```
   ```powershell
   python -c "import subprocess,sys; open(sys.argv[3],'wb').write(subprocess.run(['git','show',sys.argv[1]+':'+sys.argv[2]],capture_output=True,check=True).stdout)" $commit supabase/migrations/018_revoke_former_admin_membership_note_access.sql $env:TEMP\roomie-018.sql
   ```
   ```powershell
   Get-FileHash $env:TEMP\roomie-017.sql, $env:TEMP\roomie-018.sql -Algorithm SHA256
   ```
   Expected: `18D12B56850CAD31B71B5AD25E583A6C40412701CAB51BC065FD52BE9F67A690` and `A5B34AB2FA65D88FFBF8031B2E5E20AD3122AD0DDCE94F50EA7090F82F72B042`.
5. **Confirm the checks pass on that exact commit.** Expected: **427 of 427 tests**, 0 lint problems, the type check passes, the build succeeds.
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
   Optional, with Docker Desktop running. Each suite starts its own network-less PostgreSQL container and removes it. Expected 38 of 38, then 7 of 7.
   ```powershell
   node --disable-warning=ExperimentalWarning --test tests/concurrency/membership-notes.concurrency.mts
   ```
   ```powershell
   node --disable-warning=ExperimentalWarning --test tests/concurrency/former-admin-notes.concurrency.mts
   ```
6. **Prepare the matching app release** from that commit (hosting deploy, or the local server), ready to start the moment 017 and 018 are in.

### 1.2 Backup and recovery requirements

- **Find the latest backup.** In the Supabase dashboard (project `roxtxipioqtggnqyhpgs`), open **Database → Backups** and note the newest backup or point-in-time recovery option your plan offers: `________`.
- **Know what you're giving up.** 017 deliberately clears settled note text, and no separate copy is kept. If the plan offers no backup, accept that before continuing.
- **What a restore would mean:** it brings back the whole database as of the backup. Anything students did after it (messages, likes, listings) would be lost too.

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

**About P5:**
- It uses exactly the same matching rule as 017's history cleanup, including the privacy-first rule for exact time ties. Of identical notes for one member, group and kind, only the strictly most recent copy is kept; if the most recent copies share the exact same `created_at`, none is.
- Locally, its `notes_to_clear` matched what 017 actually cleared.
- P5b counts just the tied copies. A pending row keeps its own note either way, and its readers still get it from `group_membership_notes()`.

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

**P7 and V7.** They measure the same thing, and each always returns exactly one row with these columns:
- `policy_count`: how many SELECT-applicable policies on `group_events` (`FOR SELECT` or `FOR ALL`) have the expected name, `group_events: involved people read`;
- `narrowed`: whether exactly one such policy exists and it carries 018's condition;
- `other_select_policies`: any *other* permissive SELECT or ALL policy on `group_events`. Permissive policies are combined with OR, so such a policy could undo 018;
- `check_state`: `ok` only when the database is in the stage that check expects. **P7 expects the state before 018; V7 expects it after.**

Otherwise `check_state` names the first problem it finds, in this order:

| `check_state` | Meaning | What to do |
|---|---|---|
| `FAIL: policy missing` | No policy with that name: students can't read any group history | Stop. Investigate before anything else |
| `FAIL: duplicate policies` | More than one policy with that name. Postgres normally prevents this | Stop and investigate |
| `FAIL: another permissive SELECT policy on group_events` | Another permissive SELECT or ALL policy exists. It's OR-ed in and could undo 018 | Stop. Find out who added it and why |
| `FAIL: 018 is already applied (P7 expects the pre-018 policy)` | P7 only: 018 is already in place, so this isn't the expected starting point | Stop. Find out how and when 018 got there (check P2 too) before running anything |
| `FAIL: 018 is not applied (V7 expects the narrowed policy)` | V7 only: 018 isn't in place | During the window: run 018 (section 2.2, step 6) or see section 2.3. After the window: 018 was never applied or was rolled back |

A RESTRICTIVE policy can only narrow access, so it is deliberately not reported as a failure.

```sql
-- P7. Before 018 (expected one row: policy_count 1, narrowed false, other_select_policies 0, check_state ok)
select policy_count, narrowed, other_select_policies,
       case
         when policy_count = 0 then 'FAIL: policy missing'
         when policy_count > 1 then 'FAIL: duplicate policies'
         when other_select_policies > 0 then 'FAIL: another permissive SELECT policy on group_events'
         when narrowed then 'FAIL: 018 is already applied (P7 expects the pre-018 policy)'
         else 'ok'
       end as check_state
from (
  select count(*) filter (where p.polname = 'group_events: involved people read')::int as policy_count,
         count(*) filter (where p.polname = 'group_events: involved people read') = 1
           and coalesce(bool_and(pg_get_expr(p.polqual, p.polrelid) like '%detail IS NOT NULL%')
                          filter (where p.polname = 'group_events: involved people read'), false) as narrowed,
         count(*) filter (where p.polname <> 'group_events: involved people read' and p.polpermissive)::int as other_select_policies
  from pg_policy as p
  where p.polrelid = 'public.group_events'::regclass
    and p.polcmd in ('r', '*')
) as s;
```

**Stop and don't proceed if:**
- P1 shows anything other than `postgres`;
- P2 is `true`;
- P3 is not `true, true, false`;
- P7 is not exactly one row of `1, false, 0, ok` (`check_state` must be `ok`).

**Last known values,** from a read-only check on 2026-11-25. P5, P5b, P6 and P7 have never been run on production.
- **P1:** `postgres` / `postgres`, the `group_members` owner. The `group_events` owner wasn't checked.
- **P3:** `true, true, false`.
- **P4:** no rows; the table was empty.

### 1.4 Plan the window

- **Pick a short, quiet time,** about 15 minutes, and tell testers in advance.
- **Have these open:**
  1. a SQL Editor tab for 017 (from `$env:TEMP\roomie-017.sql`);
  2. a SQL Editor tab for 018 (from `$env:TEMP\roomie-018.sql`);
  3. a third tab with D1, D2 and V1–V7;
  4. the app release, ready to go;
  5. this runbook.

## 2. During the window

### 2.1 Why the app must be drained first

**017 takes the strongest lock (ACCESS EXCLUSIVE) on `group_members`, then on `group_events`, and holds both until it commits.** Tested on PostgreSQL 17.12:
- **While 017 waits for or holds those locks,** every other read and write of the two tables waits behind it. Students' member lists, group history and notifications all pause for that time (milliseconds when nothing else runs).
- **A transaction that already touched `group_members`** (for example, it read it and is about to write it) is let through ahead of 017, which then runs after it with no error.
- **A transaction that touched `group_events` but not `group_members`, and then needs `group_members`,** deadlocks with 017, and Postgres rolls back one of them. If 017 is the one, nothing of it remains and a re-run works.
- **The notifications page does exactly this, in a single query.** Its event lookup locks `group_events` when planned, and reaches `group_members` only while running, through the access rule's `is_group_admin()`. Which side loses depends on timing. In tests, when 017 got `group_members` at once, the page's query was rolled back; when 017 got it 1.5 seconds later, 017 was.
- **Not this shape:**
  - **Account deletions** lock `group_members` before `group_events`, so they only wait for 017, or 017 waits for them (tested both ways).
  - **The "Your groups" outcomes lookup** didn't touch `group_members` in the tests.

  Keep both stopped anyway: they read or change these tables.

**018 takes ACCESS EXCLUSIVE on `group_events` only, plus a share lock on `notifications`.** It can make `group_events` readers and writers wait for milliseconds. In tests it never deadlocked: it holds nothing while waiting, and its only other lock conflicts with nothing the app uses.

**The precondition:** when 017 starts, no session may hold or be waiting for a lock on either table, and nothing may start new work on them until 017, 018 and the matching app are all in place.

### 2.2 Drain, check, migrate, deploy

1. **Stop application traffic and background work.**
   - **The app:** take it offline (hosting maintenance mode or deployment stopped; in development, stop `npm run dev`). All membership changes, history pages and notification pages run on the app server, so this stops them.
   - **Background work:** this repository has no scheduled jobs, Edge Functions, `pg_cron` or `pg_net`. Check that nothing like that has been added in the Supabase dashboard (**Database → Cron Jobs**, **Edge Functions**). Don't run `npm run seed` or `npm run unseed`.
   - **Dashboard:** don't delete or edit users (**Authentication**), and don't edit group tables in the **Table Editor** during the window. Close SQL Editor tabs other than the three above.
   - **Open browsers:** browsers that still have Roomie open can keep calling Supabase for group chat (reading and sending messages, marking chat read). Those calls touch `group_members` only, so at most they wait a few milliseconds behind 017. They can't cause the deadlock above.
2. **Let in-flight work finish.** Wait about a minute after the app stops, then run D2:
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
   - **Why it reads `pg_locks`:** every open transaction holds a lock on its own transaction number, and anyone can read `pg_locks`. If your role lacks monitoring rights, `pg_stat_activity` shows other roles' `state`, `query`, start times and `backend_type` as NULL (tested). So those columns may be blank, but **any row still means "not drained"**.
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
   - **No rows:** go to step 4 straight away.
   - **Any row:** don't run 017. Wait and run D1 again. If a session stays `idle in transaction`, find out what it is from `usename` and `application_name` before doing anything about it. Ending another session is your call, not part of this runbook.
   - **What D1 shows:** locks a session holds (`granted` true) and locks it's waiting for (`granted` false), for every role (tested). Blank columns are possible, as for D2.
   - **D1 and D2 are snapshots.** They show only the moment you run them and don't stop new work from starting. **Only the freeze keeps the tables quiet;** keep step 1 in place until step 11.
4. **Apply 017**, in its own SQL Editor tab, as `postgres`:
   - paste the whole of `$env:TEMP\roomie-017.sql`, whose hash you checked, and run it once;
   - accept the "destructive operations" prompt;
   - a single run is one transaction, so it applies completely or not at all. This was tested on PostgreSQL as one query, not in the SQL Editor.
5. **Verify 017** (read-only, traffic still stopped):
   - V1 must be `false, false, true, false, false`;
   - V2 must show the four functions, as in the table in section 3;
   - V3 must include the four new triggers;
   - V4 must return one validated row;
   - V5 must be 0;
   - P5 must show 0 to clear, with `notes_kept` as in preflight;
   - P6 must equal the preflight counts;
   - V6 must be all true.

   If any is wrong, don't run 018, and see section 2.3.

   **Then tell the API to reload its schema.** 017 adds a function, `group_membership_notes()`, that the new app calls through Supabase's API (PostgREST). The API keeps its own copy of the schema. Supabase normally reloads that copy after a migration; this makes sure. Run this on its own in the SQL Editor. It changes no data, and it's safe to repeat:
   ```sql
   notify pgrst, 'reload schema';
   ```
   Sending it doesn't prove the reload happened, or that it's finished. Step 9 checks that.
6. **Apply 018**, in its own SQL Editor tab, as `postgres`, straight after 017 is verified:
   - paste the whole of `$env:TEMP\roomie-018.sql` and run it once. It takes milliseconds;
   - running D1 again isn't needed while the freeze holds;
   - don't paste 017 and 018 together. That also works (tested), but a failure in 018 would then undo 017 too.
7. **Verify 018** with V7 (section 3). It must be exactly one row of `1, true, 0, ok`. A `FAIL: …` in `check_state` means stop and see section 2.3.
8. **Deploy or start the matching app immediately.** Don't leave production running the old app against the new schema.
9. **Run V1–V7 once more** (section 3), still with traffic stopped, to confirm the final state with the app in place. **Then confirm the API can see the new function** before anyone is let back in:
   - **Preferred: through the new app,** if you can reach it privately (a preview URL or a maintenance bypass; see step 10). As test account A, open **Your groups** and any group page. Both must load. An error mentioning `PGRST202` or "schema cache" means the API hasn't reloaded yet.
   - **Without private access: ask the API directly.** Use the project's publishable key, the value of `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, which is public by design:
     ```powershell
     curl.exe -s "https://roxtxipioqtggnqyhpgs.supabase.co/rest/v1/rpc/group_membership_notes?p_groups=%7B%7D" -H "apikey: PASTE-THE-PUBLISHABLE-KEY"
     ```
     - **Expected:** a permission error (code `42501`, "permission denied for function group_membership_notes"). Signed-out callers aren't allowed to run this function, so that error shows the API found it.
     - **`PGRST202`** ("Could not find the function … in the schema cache") means the API hasn't reloaded. Wait a minute, send the `notify` from step 5 again, and repeat.
     - **This check wasn't tested against the real API;** only the database side was tested locally. So treat anything other than that clear permission error as "don't reopen yet", and investigate.
   - **If the API still can't see the function,** keep traffic frozen and see section 2.3.
10. **Smoke tests** (section 4).
    - If your hosting lets you reach the new deployment privately (a preview URL or a maintenance bypass), do them now, before reopening.
    - If not, reopen in step 11 and do them immediately after, ready to use section 5.
11. **Reopen traffic.**

### 2.3 Failure handling between and around the migrations

| What happened | What to do |
|---|---|
| 017 fails with `deadlock detected` or another lock error | Nothing of 017 was applied (a rolled-back 017 was verified to leave 016 exactly). Keep the app stopped, repeat steps 2–3, then run 017 again (re-running after a rollback is tested) |
| 017 fails with any other error | Nothing was applied. **Don't run 018. Don't deploy the new app.** Restart the old app, reopen, and investigate |
| 017 succeeded but step 5 shows a wrong value | Don't run 018 and don't reopen. Investigate while still frozen. Rolling back means R017 (section 6), which reopens F-01; prefer a fix-forward |
| 018 fails with a lock error | 017 stays applied and complete. Keep the app stopped, run D2 and D1 again, then re-run 018 |
| 018 fails with any other error | 017 stays applied and complete, and the app works with or without 018. Continue with steps 8–11 only if the owner accepts the open former-admin gap (section 6); otherwise stay frozen and investigate |
| V7 isn't `1, true, 0, ok` after 018 | `FAIL: 018 is not applied`: 018 didn't take effect. While still frozen, run D1 and then 018 again (it's idempotent); if V7 still fails, stay frozen and investigate. `FAIL: policy missing` or `FAIL: another permissive SELECT policy…`: stay frozen and investigate before reopening (section 1.3 explains each state) |
| The API can't see `group_membership_notes()` (`PGRST202`, "schema cache") | Keep traffic frozen. Send `notify pgrst, 'reload schema';` again, wait a minute, and repeat the check in step 9. If it persists, check in the Supabase dashboard that the API service is healthy, and investigate. Don't reopen: group pages would fail |
| The app deployment itself fails (017 and 018 both succeeded) | Keep traffic frozen and follow section 2.4 |
| The app fails to load group pages after deploy | Check that the deployed commit is the release commit (`loadNotes` / `group_membership_notes`). Re-run V1–V7 and the API check in step 9. Prefer a fix-forward; R017 reopens F-01 |

### 2.4 If the app deployment fails after 017 and 018 succeeded

**Where things stand:**
- The database is in its final, intended state.
- **The old app can't work against it.** Its group pages and **Your groups** read `group_members.message`, which 017 refuses (`permission denied`).
- The new app isn't running.

1. **Keep traffic frozen.** Don't reopen with the old app: group pages would fail for admins and for students with pending invitations or requests.
2. **Retry or repair the new deployment first.** It's the only path that keeps both fixes.
   - Redeploy the same release commit.
   - Check the hosting build log, the environment variables (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) and any runtime errors.
   - The database needs nothing. Don't run 017 or 018 again for this.
   - Once it's up, continue from step 9.
3. **If it can't be fixed within the window you announced, choose:**
   - **Stay frozen until the new app works.** Both fixes stay in place; students can't use Roomie meanwhile.
   - **Go back to the old app.** That needs **R017** first (section 6.2), with D2 and D1 run first as in section 2.2; with the freeze still on, they should show nothing.
     - R017 restores the table-wide read the old app needs.
     - **R017 reopens F-01:** active members can again read the pending notes in their groups, and any eligible student can read stale invitation notes on active rows of discoverable groups. Notes already cleared stay cleared.
     - Then restore the previous app version, the deployment before the release commit. Confirm group pages load, record that F-01 is open again, reopen, and plan a new window.
4. **R18 is not part of this recovery.**
   - **The old app works with 018 in place.** 018 only changes which history rows former admins can see; it changes no column or function the old app uses.
   - **Use R18 only if 018 itself is the problem,** such as a V7 failure that can't be cleared, and only if the owner accepts what it reopens: former admins can again read pending join-request notes through notifications they received while they were admins.
   - **If R017 has already reopened F-01,** that former-admin gap is the smaller exposure, so there's no reason to add it.

## 3. Verification SQL (read-only, as `postgres`)

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

Expected V2: owner `postgres` and config `{search_path=""}` for every row, and:

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

**Re-run P5 and P6 here:**
- **P5:** `notes_to_clear` must be 0 or no rows, and `notes_kept` must equal the preflight value.
- **P6:** every count must equal the preflight values, so no event or notification was lost.

```sql
-- V6. Row-level security still on (expected: all true)
select relname, relrowsecurity
from pg_class
where oid in ('public.group_members'::regclass, 'public.group_events'::regclass,
              'public.notifications'::regclass, 'public.group_messages'::regclass)
order by relname;
```

V7 takes the same measurement as P7, with the same columns and failure states (section 1.3). Its stage check expects 018 to be applied: if `narrowed` is false, `check_state` is `FAIL: 018 is not applied (V7 expects the narrowed policy)`.

```sql
-- V7. After 018 (expected one row: policy_count 1, narrowed true, other_select_policies 0, check_state ok)
select policy_count, narrowed, other_select_policies,
       case
         when policy_count = 0 then 'FAIL: policy missing'
         when policy_count > 1 then 'FAIL: duplicate policies'
         when other_select_policies > 0 then 'FAIL: another permissive SELECT policy on group_events'
         when not narrowed then 'FAIL: 018 is not applied (V7 expects the narrowed policy)'
         else 'ok'
       end as check_state
from (
  select count(*) filter (where p.polname = 'group_events: involved people read')::int as policy_count,
         count(*) filter (where p.polname = 'group_events: involved people read') = 1
           and coalesce(bool_and(pg_get_expr(p.polqual, p.polrelid) like '%detail IS NOT NULL%')
                          filter (where p.polname = 'group_events: involved people read'), false) as narrowed,
         count(*) filter (where p.polname <> 'group_events: involved people read' and p.polpermissive)::int as other_select_policies
  from pg_policy as p
  where p.polrelid = 'public.group_events'::regclass
    and p.polcmd in ('r', '*')
) as s;
```

## 4. Smoke tests (two SRM test accounts)

**The accounts:**
- **A** is the account in normal Chrome; it will be the admin.
- **B** is the second account (Incognito, or the VS Code browser).

Use these distinctive notes so they're easy to spot: `SMOKE-REQ-1`, `SMOKE-INV-1`.

1. **A** creates a group called **Smoke test 7A** (discoverable).
2. **B** opens it and asks to join with the note `SMOKE-REQ-1`.
3. **A, the admin, sees the pending request note** in all three places:
   - on the group page, under requests;
   - on **Your groups**, under approvals;
   - in **Updates**, where "B asked to join" shows `SMOKE-REQ-1`.
4. **The database refuses B's direct read of the column, and the function returns only B's own note.**
   - Run these as `postgres`, each block on its own. They change nothing, because `set local` lasts only for that run.
   - **First find the ids:**
     ```sql
     select id, full_name from public.profiles order by full_name;
     ```
     ```sql
     select id, name from public.groups where name = 'Smoke test 7A';
     ```
   - **Then try B's direct read.** Expected: `ERROR: permission denied for table group_members`.
     ```sql
     -- S1. As student B: read the note column directly
     select set_config('request.jwt.claims', '{"sub":"<B-UUID>","role":"authenticated"}', true);
     set local role authenticated;
     select message from public.group_members limit 1;
     ```
   - **If S1 returns rows instead of the error,** the editor didn't switch to the student role. Stop, and don't trust these two probes. They were verified locally (PGlite), not in the Supabase SQL Editor.
   - **Then the function.** Expected: while B's request is pending, one row (B's own `SMOKE-REQ-1`). After step 8, no rows.
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
7. **B, the invitee, sees their own invitation note** in all three places:
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

**About the ordinary-member check:** with only two accounts there's never a third student's pending note for B to try to read. So "an ordinary member can't read another student's note" is shown at the database boundary: S1 is refused for the whole column, whatever the rows. The local tests cover the data case.

**About 018:**
- **Showing it live needs a third account** that was an admin when a request arrived and was then demoted. Without one, rely on V7 and the local tests.
- **What a former admin sees while such a request is pending:**
  - their "X asked to join" entry is hidden entirely, not just the quote;
  - their unread badge counts one more than the list shows.

  Both correct themselves when the request is settled. This is expected, not a fault.

**Cleanup:** the smoke-test group is production data, so remove it only with a separate approval. For example, both members leave, which archives it, or it's deleted by name in the SQL Editor.

## 5. If something is wrong after the window

- **Prefer a fix-forward.** R017 reopens F-01 for every student, and R18 reopens the former-admin gap.
- **Group pages fail to load:**
  - check that the deployed commit is the release commit;
  - re-run V1–V7.
- **Use the table in section 2.3** for failures during the window.

## 6. Rollback

Both rollbacks change policies and triggers, so drain first, exactly as in section 2.2, steps 1–3.
- **If both are needed,** roll back in reverse order: R18 first, then R017.
- **Neither one restores cleared note text** (section 7).

### 6.1 Roll back 018 (R18)

- **What it removes:** only 018's change. It replaces the `group_events: involved people read` policy with 015's exact version (tested). Nothing from 017 is touched.
- **What it reopens:** the former-admin gap. An admin who has since been demoted, has left or was removed can again read pending join-request notes through notifications they received while an admin.
- **The app:** no change is needed.
- **Afterwards:** P7 must read `1, false, 0, ok`, and V7 then reads `FAIL: 018 is not applied …`, as expected.

```sql
-- R18. Emergency rollback of 018 (reopens the former-admin exception)
lock table public.group_events in access exclusive mode;
drop policy if exists "group_events: involved people read" on public.group_events;
create policy "group_events: involved people read"
  on public.group_events for select to authenticated
  using (
    subject_id = (select auth.uid())
    or actor_id = (select auth.uid())
    or public.is_group_admin(group_id)
    or exists (
      select 1 from public.notifications as n
      where n.event_id = group_events.id and n.recipient_id = (select auth.uid()))
  );
```

### 6.2 Roll back 017 (R017)

- **What it removes, all from 017 (tested):**
  - the four triggers: `group_members_clear_settled_note`, `group_members_clear_settled_event_notes`, `group_members_clear_deleted_event_notes` and `group_events_clear_orphaned_note`;
  - the constraint `group_members_note_only_while_pending`;
  - the four functions, including `group_membership_notes()`, which the new app needs;
  - and it gives students back table-wide read access on `group_members`, which is what the old app needs.
- **What it does not touch:**
  - **018's policy on `group_events`.** If R18 hasn't run, V7 still reads `1, true, 0, ok`. To remove 018 as well, run R18 first.
  - 017's per-column read grants for `authenticated`. They're now redundant, because the table-wide grant covers every column.
  - the `anon` role, which had no rights on `group_members` before 017 either.
  - notes 017 already cleared (section 7).
- **What it reopens:** **F-01.** Active members can again read the pending notes in their groups, and eligible students can read stale invitation notes on active rows of discoverable groups. Use it only as an emergency step, then fix forward.
- **The app:** the new app stops working, because its note function is gone. Redeploy the previous app commit straight after.
- **Afterwards, verify** (read-only; these are the same values as before the window):
  - P2 is `false`;
  - P3 is `true, true, false`;
  - V2 returns no rows: none of the four functions is left;
  - V3 lists none of the four triggers above;
  - V4 returns no rows;
  - the policy state is P7 `1, false, 0, ok` if R18 ran first, or V7 `1, true, 0, ok` if 018 was kept.

```sql
-- R017. Emergency structural rollback of 017 (reopens F-01; does NOT restore cleared notes)
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

## 7. Historical note recovery limitations

**What 017 clears, permanently:**
- settled notes on membership rows;
- settled, earlier-round and exactly-tied copies in `group_events.detail`, including what notifications showed.

**What doesn't bring them back:** rolling back the app, R18 or R017. **The only recovery is restoring a backup from before the window,** which rolls back **all** data to that point (section 1.2).

Clearing these notes is the intended outcome, so recovering them should almost never be wanted.

## 8. Sign-off

| Check | Result | By / time |
|---|---|---|
| Release commit recorded; 017 and 018 hashes `OK` from the commit (1.1 step 3) | | |
| Byte-exact copies made and hashed (1.1 step 4) | | |
| Checks on the commit: 427 tests, lint, types, build | | |
| Backup or recovery point recorded | | |
| Preflight P1–P7 recorded (P7 = `1, false, 0, ok`) | | |
| App and background work stopped; D2 shows no app transactions | | |
| D1 returned no rows immediately before 017 | | |
| 017 applied once as `postgres`; step 5 verification correct | | |
| Schema reload sent after 017 (step 5) | | |
| 018 applied once as `postgres`; V7 = `1, true, 0, ok` | | |
| Matching app deployed | | |
| API sees `group_membership_notes()` (step 9) | | |
| V1–V7, P5 and P6 re-checked | | |
| Smoke tests 1–10 | | |
| Traffic reopened | | |
