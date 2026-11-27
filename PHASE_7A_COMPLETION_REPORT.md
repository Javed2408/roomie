# Phase 7A: group membership notes privacy (F-01), revised

**Status: implemented and verified locally only.**
- Production was not touched: no connection, no SQL, no migration applied, no settings changed.
- Docker was used only for a disposable local PostgreSQL with no network access.
- Nothing was committed, pushed, merged or deployed, and no branch was created.

| | |
|---|---|
| Working tree base | `main` at `d237429`, plus the uncommitted Phase 7A work (kept and extended, not discarded) |
| Migration | `supabase/migrations/017_group_membership_notes_privacy.sql` |
| Size | 12,239 bytes |
| SHA-256 | `18d12b56850cad31b71b5ad25e583a6c40412701cab51bc065fd52be9f67a690` |
| Line endings | LF only (0 CR bytes), ASCII text |
| Supersedes | `71c9853a…c521c` (11,647 bytes, the SHARE ROW EXCLUSIVE lock), `a51367f1…0caa` (11,366 bytes, the `(created_at, id)` version), `4e210b42…85b4` (11,093 bytes) and the first 017 (`5d82edce…b3f0`, 6,036 bytes). None was ever applied anywhere |
| Tests | `npm test` 397 of 397 pass, in 3 separate runs; lint, `tsc --noEmit` and `next build` pass |
| Concurrency | 38 of 38 two-connection tests pass on PostgreSQL 17.12 in Docker, in 3 separate runs. One deadlock shape remains (now reproduced with the real notifications query); the runbook's drain procedure prevents it |

## Fourth review: account deletion, single-statement reads, and the drain checks

**Migration 017 did not change in this round:**
- its hash is still `18d12b56…a690`;
- the privacy-first tie rule and the lock order are as approved.

**What did change:**
- the concurrency suite, from 25 to 38 tests (rows 26–38 in the table below);
- the runbook: check D2 rewritten (see 3 below) and the drain explanation updated;
- this report.

### 1. Account deletion overlapping 017

**What a deletion does,** per migrations 001–016. A row deleted from `auth.users` cascades to `profiles`, and from there:
- the account's `group_members` rows are deleted (ON DELETE CASCADE);
- `group_events.subject_id` and `actor_id` are emptied where they point at it (ON DELETE SET NULL). The event rows stay;
- notifications addressed to the account are deleted (ON DELETE CASCADE). Notifications sent to others about it stay.

**How the note text is handled:**
- **Under 016:** the note text stays on the orphaned event (tested).
- **With 017:** its triggers clear it. One fires when a pending row is deleted; the other fires when an invitation or request event loses its subject. 017's one-time cleanup also clears notes left orphaned before it ran.

**Lock order, measured** (tests 26–27):
- **What I saw:** on 016 and on 017 alike, a deletion locks `group_members` before `group_events`. Paused at `group_events`, it already held `group_members`; paused at `group_members`, it held nothing on `group_events`.
- **What that means:** that's 017's own order. A deletion can wait for 017, or make 017 wait, but it can't deadlock with it.

**Results:**
- **017 waits for a deletion in flight** (test 28). After both, the deleted student's request note is gone from the history: the cascade had left it orphaned, and 017's cleanup cleared it.
- **A deletion that rolls back** leaves the student pending (test 29). Their note stays readable by the admin and by themselves.
- **A deletion waits for 017** (test 30). Once 017 commits, the deletion runs under 017's triggers, and no note survives.
- **017 rolls back while a deletion waits** (test 31). The deletion follows 016 rules, leaving the note on the orphaned event (verified). A re-run of 017 clears it.
- **A deletion arrives while 017 waits for its first lock** (test 32). It queues behind 017 holding nothing on `group_events`: no deadlock, and the note is cleared.
- **In every case:**
  - every event row is kept, with only the deleted account's ids emptied and at most its note cleared;
  - every notification is kept, except those addressed to the deleted account;
  - the account's membership rows are gone.

### 2. Single-statement history and notification reads

**What the code says:**
- **The read policy on `group_events` (015):** the subject is me, or the actor is me, or `is_group_admin(group_id)`, or a notification of mine points at it.
- **`is_group_admin()` (010, never redefined):** `language sql stable security definer`, with the body `select exists (select 1 from public.group_members where …)`. Postgres never inlines security-definer functions, so `group_members` is read only when the function runs.
- **The policy on `notifications`:** the recipient is me. It reads no other table.
- **When Postgres locks tables:** tables named in the query, or in the policy expressions (here `notifications`), are locked while the query is parsed and planned, before it runs. A table read only inside a function body is locked when that function first runs.
- **The app queries that read `group_events`:**
  - the second request in `loadNotifications`, which fetches the notified events by id;
  - the outcomes lookup in `loadGroupDashboard`, which fetches events where the subject is me and the kind is one of four.

  Each Supabase API request is its own transaction.

**Measured** (test 33). The notifications event query ran as the admin, logged in as `authenticator`. Paused at `group_members` by another session, it was:
- holding `group_events` (granted);
- holding `notifications` (granted);
- waiting for `group_members`.

All inside one statement.

**Reproduced** (tests 35–36), with the real query, policies and functions, in this sequence:
1. A student's member list keeps `group_members`, so 017 queues for it.
2. The admin's notifications query takes `group_events`, then queues for `group_members` behind 017.
3. The member list ends. 017 takes `group_members` and waits for `group_events`: a deadlock.

**Who lost:**
- **017 got `group_members` at once:** the read was rolled back with `40P01`, raised inside `is_group_admin()`, and 017 committed.
- **017 got it 1.5 seconds later:** 017 was rolled back with nothing remaining, the read finished, and a re-run applied 017.

The exact error, with the read as the victim:
```
ERROR:  deadlock detected
DETAIL:  Process 505 waits for AccessShareLock on relation 16831 …; blocked by process 498.
         Process 498 waits for AccessExclusiveLock on relation 17018 …; blocked by process 505.
QUERY:   select exists ( select 1 from public.group_members where group_id = p_group and … )
```

**The outcomes query** (test 34):
- **What happened:** with `group_members` locked by another session, it finished at once and never locked `group_members`. Every row it returns matches the policy's first check (the subject is me), so `is_group_admin()` never ran.
- **The caveat:** this depends on the plan Postgres chose, which filtered by subject first. Treat it as observed, not guaranteed.

**What remains uncertain:**
- **PostgREST itself wasn't run.** The tests send an equivalent statement; PostgREST wraps the same select in a CTE and JSON functions. What decides the lock order is which tables appear in the query and policies and which only inside functions, and that is the same in both forms.
- **The live window is unmeasured.** In production it's the moment between the query being planned and its first `is_group_admin()` call: microseconds. The tests widen it by queueing 017 first, so how often it would happen live is unknown. With the drain, it can't happen.

### 3. Drain checks D1 and D2

- **Granted and waiting locks** (test 37). D1 listed:
  - a session holding ACCESS EXCLUSIVE on both tables, as `granted` on each;
  - a student's member-list read waiting behind it, as `granted = false`;
  - an owner's history read waiting behind it, also as `granted = false`.
- **Different roles** (test 38). D1 and D2 each found:
  - sessions logged in as `authenticator` (acting as `authenticated`, and as `service_role`);
  - a session of the owner, `postgres`.

  That held whether the checks ran as a superuser or as `ops`, a login role without monitoring rights. Once the sessions ended, both checks returned no rows.
- **Fixed: the old D2 would have missed them.**
  - **The cause:** without monitoring rights, `pg_stat_activity` shows another role's session with `backend_type`, `state` and `xact_start` all NULL, not empty strings (asserted in test 38; a superuser sees `client backend`). The new D2's `coalesce(a.backend_type, 'client backend')` handles exactly that, so `nullif(…, '')` isn't needed. The old D2 filtered on exactly those columns, so it would have returned nothing even with API transactions open.
  - **The fix:** D2 now finds open transactions through `pg_locks`. Every transaction holds a lock on its own transaction number, and anyone can read `pg_locks`. The detail columns may be blank, but the row still appears.
- **Not checked:** whether Supabase's `postgres` role has monitoring rights, because that needs production. The new D2 works either way.
- **The freeze stays explicit** in the runbook. D1 and D2 show only one moment; only stopping traffic keeps the tables quiet until 017 and the app are both in place.

## Third review: ACCESS EXCLUSIVE locks, taken first (approved change)

**The change** (017, lines 46–65):
- **First statement:** `lock table public.group_members, public.group_events in access exclusive mode;`.
- **Nothing comes before it.** Every later statement runs under these locks, so 017 never raises a lock part-way through.
- **The comments are corrected.** The header now says that while 017 waits for or holds these locks, every other read and write of the two tables waits too. It also says to run 017 only once the app is drained. "(Reads carry on as normal.)" is gone.
- **Nothing else in 017 changed:**
  - the privacy-first tie rule and its predicate, so P5 and P5b still match it exactly;
  - triggers, grants, the `CHECK` constraint and `group_membership_notes()`.

### Lock ordering across the whole migration

| Statements | Locks they need |
|---|---|
| `lock table …` | ACCESS EXCLUSIVE on `group_members`, then on `group_events`, waiting for each in turn |
| `create or replace function` (×4), `revoke` / `grant` | System catalogs only |
| `drop trigger` / `create trigger`, `alter table … disable/enable trigger`, `add constraint` | Up to ACCESS EXCLUSIVE on the same two tables: already held |
| Member cleanup (`update group_members`) | Fires only row-local triggers: 017's note trigger, and 015's event trigger, which records only status or role changes and so does nothing. The settlement triggers don't fire, because the status doesn't change. No key column changes, so no foreign-key check touches another table |
| History cleanup (`update group_events`) | Its triggers are AFTER INSERT (016's chat message) or UPDATE OF `subject_id` (017), so neither fires. `notifications.event_id` points at `group_events.id`, which doesn't change |

- **Checked on PostgreSQL** (test 23): just before commit, 017 held locks only on `group_members`, `group_events` and their four indexes, plus system catalogs. It held none on any other app table.
- **So 017 can only be caught in its first statement.** That's the one moment it holds one table while waiting for another: between taking `group_members` and taking `group_events`. After that it never waits for another app table.
- **Everyday lock order is unchanged.** After 017, its triggers update `group_events` from a `group_members` change. That's the same order as 015's own event trigger, so 017 adds no new lock order to normal operation.

### The read-then-write case, investigated (not assumed)

Each row is a real test on PostgreSQL 17.12, run 3 separate times with the same result every time.

| What the other session did before 017 started | What it does while 017 waits | Result |
|---|---|---|
| Read `group_members` (a student's member list) | Settles a request: writes `group_members`, `group_events` and `notifications` | **No deadlock.** The session already holds a lock on `group_members` that conflicts with 017's queued request, so Postgres lets it go first. It commits, then 017 runs. Anyone new who arrives meanwhile queues behind 017 (test 17) |
| Read the group history as a student. The row policy calls `is_group_admin()`, so this locks both tables | Settles a request | **No deadlock**, for the same reason (test 18) |
| Read only `group_events`, as the owner, e.g. an operator or a background job (no row policy) | Settles a request | **Deadlock.** 017 holds `group_members` and waits for `group_events`, while the session waits for `group_members`. After `deadlock_timeout` (1 s), Postgres rolled back **017**, and the session's change went through. 017 left nothing behind, and a re-run applied it (test 19) |
| The same | Only reads `group_members` | **Deadlock**, with the same outcome: reads trigger it too (test 20) |
| An open read-only transaction on `group_members` | Nothing, then commits | 017 waits past `deadlock_timeout` without error, then runs (test 16) |

The exact error, from one of the runs (process and relation numbers vary per run). Here relation 17013 is `group_events` and 16826 is `group_members`; process 650 is 017.

```
ERROR:  deadlock detected
DETAIL:  Process 650 waits for AccessExclusiveLock on relation 17013 of database 17273; blocked by process 642.
         Process 642 waits for AccessShareLock on relation 16826 of database 17273; blocked by process 650.
```

**What this means:**
- **ACCESS EXCLUSIVE removed the earlier deadlock** (read `group_members`, then write) but not every deadlock. A session that has touched `group_events` and not `group_members` still deadlocks if it then needs `group_members`.
- **Reversing the lock order wouldn't help.** It would move the same risk onto membership changes, which lock `group_members` before `group_events` through 015's trigger. So the order stays `group_members` then `group_events`.
- **Where that shape occurs** (updated in the fourth review):
  - **the notifications page's event lookup:** one query locks `group_events` when it is planned, and reaches `group_members` only when the row policy runs `is_group_admin()`. A deadlock with 017 was reproduced with this query;
  - **operator work** in the SQL Editor or Table Editor that touches `group_events`, then `group_members`, in one transaction;
  - **not account deletions:** they lock `group_members` first (tested).

### The maintenance precondition

When 017 starts:
- no session may hold, or be waiting for, any lock on `group_members` or `group_events`. The runbook's D1 query must return no rows;
- nothing new may start on those tables until 017 has committed and the matching app is deployed: no history or notification page, no membership change, no account deletion, and no operator edit.

**Browsers still open on group chat are harmless.** Their calls (reading and sending chat, marking it read, Realtime's access checks) touch `group_members` first. At most they wait a few milliseconds behind 017; they can't produce the deadlock.

**What the runbook now does:** section 2 is an explicit drain:
1. stop app traffic and background work;
2. wait, then check open transactions (D2);
3. check that nothing holds the two tables (D1);
4. only then run 017;
5. keep traffic stopped until 017 and the matching app are both in place.

Test 25 runs the runbook's own D1 and D2 queries. They catch a session left open on `group_events`, and both return no rows once it ends.

**If the precondition is missed:**
- **The worst outcome seen:** Postgres rolls 017 back as a deadlock victim, atomically, with nothing applied. Drain again and re-run; re-running after a rollback is tested.
- **The cost of a held lock:** while 017 waits, everything else on the two tables queues behind it. A lock held for a long time stalls group pages until it's released.

### Proof that 017 takes both locks before anything else

- **Test 21.** A blocker holds `group_events`, and 017 runs statement by statement.
  - `pg_stat_activity` shows 017 waiting in exactly `lock table public.group_members, public.group_events in access exclusive mode;`.
  - Its locks are `group_members` (ACCESS EXCLUSIVE, granted), `group_events` (ACCESS EXCLUSIVE, waiting) and a transaction id.
  - **About that transaction id:** Postgres assigns one as soon as a transaction requests an ACCESS EXCLUSIVE lock, to log the lock for standby servers (the container runs at `wal_level replica`). It does not mean anything was written.
- **Test 22.** Run as one query, the way the SQL Editor does it, 017 waits for `group_members` first and holds nothing else meanwhile.

## Second review: exact timestamp ties are now privacy-first

**The policy adopted by the reviewer:**
- If several candidate events for the same group, member and kind have identical note text and the same `created_at`, all of them lose the note.
- Event ids (random UUIDs) are never used to choose which copy keeps the text.
- The pending membership row keeps its note, and `group_membership_notes()` still returns it to its readers.
- Event and notification records are all kept.
- When the times differ, only the event of the pending round keeps its note.

**The rule in 017's one-time history cleanup** (lines 164–198). An event of kind `invited` or `requested` keeps its note only if all of these hold:
- the member's row in that group is still pending, with the event's kind as its status;
- the note equals the row's current note;
- **no other event** (`other.id <> e.id`) for that member, group and kind has the same note with `other.created_at >= e.created_at`.

**What that rule does:**
- If one copy is strictly the most recent, it keeps the note and every earlier copy is cleared.
- If the most recent copies share the exact same time, every one of them is cleared. Nothing can tell which round is current, so none is kept.
- If only earlier rounds tie, those tied rounds are cleared, and a strictly later current round still keeps its note.
- The id appears only in `other.id <> e.id`, so that an event doesn't count as a tie with itself. It never ranks events.

**Still idempotent:**
- A cleared copy is `null`, so on a second run it no longer counts as a tie for anything.
- A kept copy has no other non-null identical copy, so it stays.
- A second run changes nothing (tested on PGlite and on real PostgreSQL).

**Visible effect in the app, only for tied data:**
- For a pending request whose history copies were all cleared because of a tie, the admin's **Updates** entry shows no quoted note. The notifications page only quotes a non-null `detail`.
- The note is still on the group page and on **Your groups**, through `group_membership_notes()`.
- Ties need several status changes inside one transaction, which no app path does. The tests force them by editing `created_at`.

**P5 preflight:**
- P5 in the runbook now uses exactly this predicate.
- A new **P5b** counts only the tied copies.
- On local tied data, P5 predicted 14 request notes and 1 invitation note to clear, with 2 kept. 017 cleared exactly those 15.
- Afterwards P5 reports 0 to clear with the same 2 kept, and P5b reports none.

**The old rule fails the new tests:**
- I put the previous `(created_at, id) >` comparison back temporarily and ran the tie suite.
- 2 of its 12 tests failed:
  - "both tied events lose the note, whichever id sorts higher";
  - "exactly the tied and earlier copies are cleared".
- I then restored the file and checked its hash.

**Product decisions still applied** (confirmed earlier):
- Settled note text is cleared from historical records; the records themselves are kept.
- 017 and the matching app go live together in a short maintenance window. See `PHASE_7A_DEPLOYMENT_RUNBOOK.md`.

## Real two-connection concurrency tests (PostgreSQL in Docker)

### Environment

| | |
|---|---|
| Docker | Docker Desktop, engine and client 29.9.3, WSL2 (kernel 6.18.58.1). It was already running and healthy, with no containers |
| PostgreSQL | **17.12** (`PostgreSQL 17.12 on x86_64-pc-linux-musl`), image `postgres:17-alpine`, digest `sha256:d3244e8c…5065`. It was already on this machine, so nothing was downloaded |
| Container | `--network none` (no network at all), migrations folder mounted **read-only**, removed at the end of every run (checked: none left) |
| Access | Only through `docker exec`; no port is published. `POSTGRES_HOST_AUTH_METHOD=trust` is therefore reachable from nowhere, and no password or secret exists |
| Settings | Default; `deadlock_timeout=1s` set explicitly (the default value) |

### How it works

- **Database setup:**
  - The Supabase stand-ins from `tests/db/harness.mts` are applied first: roles `anon`, `authenticated` and `service_role`, Supabase's default privileges, `auth.users`, `auth.uid()` and `storage`.
  - Then migrations 001–016, each in one transaction. The result is template `t016`, the same schema as production today.
  - Template `t017` is `t016` plus 017, **run the way the SQL Editor runs it**: the whole file sent as one query (`psql -c`), which Postgres executes as one implicit transaction.
- **Each test** gets a fresh database copied from a template, with the same people:
  - Night owls: Kiran and Meera have pending requests, Dev has a pending invitation, and Ravi accepted an invitation (a settled note).
  - Early birds: Tara has a pending invitation and Sam a pending request.
- **Each connection is its own `psql` process**, so its own server backend.
- **Students act through the real functions**, as `authenticated` with `request.jwt.claim.sub`, exactly as the PGlite harness does. Nothing uses service-role access.
- **Waits are observed, not guessed.** A test continues only once `pg_stat_activity` shows the connection waiting on a `Lock` held by the expected connections (`pg_blocking_pids()`). It also checks that the waiting side is still waiting after a pause.

**Depending on the scenario, the checks are** (the first two in every scenario that changes data):
- **No settled note anywhere,** counted in storage as `postgres`:
  - no membership row outside `invited` / `requested` has a note;
  - no `invited` / `requested` event has a note that isn't the current note of a matching pending row.
- **Students are refused** `select message from group_members` (`42501`).
- **The right people read pending notes:** `group_membership_notes()` returns them to the group's admin and to the student whose row it is, and not to other students.
- **History is kept:** every event and notification that existed before is still there, value for value, apart from a cleared `detail`. That covers ids, times, people and read state.
- **Other rows are untouched:** every other membership row is unchanged, `updated_at` included, apart from a settled note being cleared.

### Command and results

```powershell
node --disable-warning=ExperimentalWarning --test tests/concurrency/membership-notes.concurrency.mts
```

- It starts and removes its own container, and needs Docker Desktop running.
- It is deliberately not part of `npm test`: its file name doesn't end in `.test.mts`, so `npm test` doesn't need Docker.
- **38 of 38 pass, in 3 separate runs** (about a minute each).

| # | Scenario | Result |
|---|---|---|
| 1 | Environment: Docker engine, PostgreSQL 17.12, 001–017 applied on the template | Pass |
| **017 waits for changes already in flight (database on 016)** | | |
| 2 | Connection A approves Kiran's request (uncommitted). Connection B runs 017: B waits on its table lock (`relation`), held by A, and is still waiting 300 ms later. A commits, B commits. Kiran's note is gone from the row and the history; a second run changes nothing | Pass |
| 3 | The same with a rejection | Pass |
| 4 | Two in-flight changes on two connections (Kiran withdraws; Omar cancels Tara's invitation in another group). 017 waits for **both**: it is still blocked by C after A commits, then commits after C | Pass |
| 5 | The in-flight approval **rolls back**. 017 commits; Kiran is still pending with his note in the row and the history; the admin and Kiran read it, and Meera sees only her own | Pass |
| 6 | A **new request with a note is created** (event and notification) while 017 waits. Afterwards that pending note is kept, and the settled one (Ravi's) is cleared | Pass |
| **Changes wait for 017 in flight** | | |
| 7 | 017 is open (uncommitted). An approval waits for it; after 017 commits, the approval completes **under 017's new triggers**, which clear its note in the same transaction (a settlement after the migration) | Pass |
| 8 | 017 **rolls back** while a new request waits. The result is exactly the 016 state: no function, no triggers, no constraint, the old table grant, and every note including settled ones (no partial cleanup). The request goes through; a re-run of 017 then applies everything | Pass |
| 9 | While 017 is open, a student's plain **read** of `group_members` also waits. After commit it succeeds, and `message` is refused | Pass |
| **After 017: overlapping membership transactions** | | |
| 10 | Two settlements in one group: the second waits on the group row (each function locks it `FOR UPDATE`). Both notes are cleared | Pass |
| 11 | Settlements in different groups run at the same time without waiting | Pass |
| 12 | A decline races Kiran's own withdrawal: the withdrawal waits, then finds nothing pending (`P0002`). No note survives, and a new request round keeps only the new note | Pass |
| 13 | Readers during an uncommitted approval still see the pending note (the committed state). Immediately after commit, the function and the history no longer show it | Pass |
| 14 | An approval rolled back after 017 leaves everything as it was, value for value; the note is still readable | Pass |
| 15 | A new request, an approval and an invitation at once in two groups (3 connections). Events are created, only settled notes go, and pending ones are readable by the right people | Pass |
| **Transactions that read before they write** | | |
| 16 | An open read-only transaction delays 017 past `deadlock_timeout`, with no deadlock. 017 commits after it ends | Pass |
| 17 | A transaction that **read** `group_members` settles a request while 017 waits. **No deadlock**: its write goes ahead of 017's queued lock, a newcomer queues behind 017, and 017 then commits and clears the note | Pass |
| 18 | A student who read the group history (which locks both tables through the row policy) settles a request while 017 waits: no deadlock | Pass |
| 19 | A session that read **only** `group_events` settles a request while 017 waits: **deadlock**. Postgres rolled back 017 every time; nothing of 017 remained, and a re-run applied it | Pass (records the victim) |
| 20 | The same, but the session only **reads** `group_members`: the same deadlock and outcome | Pass (records the victim) |
| **017's ACCESS EXCLUSIVE locks, taken first** | | |
| 21 | 017 run statement by statement against a blocker on `group_events`: it waits inside its first statement (the `lock table`), holding `group_members` and waiting for `group_events`, with no other table lock. It completes once the blocker ends | Pass |
| 22 | 017 run as one query (as the SQL Editor does) against a blocker on `group_members`: it waits for that lock first and holds nothing else | Pass |
| 23 | While 017 holds the locks, these all wait on it: a member list, a history and notifications read, an owner's read of `group_events`, an approval, and a new request in another group. A table 017 doesn't lock (a student's own notifications) answers at once. After commit all resume, and the two writes run under 017's rules (approval note cleared, new pending note kept) | Pass |
| 24 | 017 **rolls back** while a read and an approval wait. Both resume under 016 rules (the note column readable again). **No partial state:** triggers, constraints, table and column grants, policies, and every public function's body and grants are identical to before, and so is the data apart from the approval itself. A re-run applies everything and clears the now-settled note; a further run changes nothing | Pass |
| 25 | The runbook's drain checks: D1 and D2 both find a session left open on `group_events`, and both return no rows once it ends. 017 then runs straight through | Pass |
| **Account deletion and 017** | | |
| 26 | Lock order of an account deletion, database on 016: paused at `group_events`, it already holds `group_members`; paused at `group_members`, it holds nothing on `group_events` | Pass |
| 27 | The same, database on 017 | Pass |
| 28 | Kiran's account deletion in flight (uncommitted). 017 waits for it, then runs. Every event is kept with Kiran's ids emptied; notifications are kept except those addressed to him; his request note is gone from the history | Pass |
| 29 | The deletion rolls back: Kiran stays pending, and his note is readable by the admin and by him | Pass |
| 30 | 017 is open (uncommitted) and Dev's deletion waits for it. After commit the deletion runs under 017's triggers: his invitation note is gone, the event is kept with no subject, his own notification is gone (cascade), and the others are kept | Pass |
| 31 | 017 rolls back while Dev's deletion waits. The deletion follows 016 (the event keeps "N-DEV" with no subject); a re-run of 017 clears it | Pass |
| 32 | A deletion arriving while 017 waits for its first lock queues behind 017, holding nothing on `group_events`: no deadlock, and the note is cleared | Pass |
| **Single-statement history reads** | | |
| 33 | The notifications page's event query, paused at `group_members` by another session: inside one statement it holds `group_events` and `notifications` and waits for `group_members` | Pass |
| 34 | The Your groups outcomes query finishes while `group_members` is locked: here it never touched that table | Pass |
| 35 | **Deadlock in one statement, reproduced.** 017 is queued for `group_members`; the event query takes `group_events` and queues behind 017. 017 gets `group_members` at once: the read is rolled back (`40P01`) and 017 commits | Pass (records the victim) |
| 36 | The same, with 017 getting `group_members` 1.5 s later: 017 is rolled back with nothing remaining, the read finishes, and a re-run applies 017 | Pass (records the victim) |
| **Drain checks D1 and D2** | | |
| 37 | D1 lists held (`granted` true) and waiting (`granted` false) locks on both tables | Pass |
| 38 | D1 and D2 find sessions of `authenticator` (as `authenticated` and as `service_role`) and of `postgres`, whether run as a superuser or as a role without monitoring rights; both are empty once those sessions end | Pass |

**Race conditions in the privacy logic: none found.**
- In every interleaving:
  - 017's cleanup and trigger installation were atomic;
  - no settled note stayed readable;
  - pending notes stayed readable by the right people;
  - no event or notification row was lost or altered beyond its cleared `detail`.
- A rolled-back 017 left nothing behind.

### The second review's lock finding: resolved

- **Before:** 017 took SHARE ROW EXCLUSIVE, then its `drop trigger` statements raised that to ACCESS EXCLUSIVE part-way through. So:
  - its comment "(Reads carry on as normal.)" was wrong;
  - a transaction that had read `group_members` and then wrote it while 017 waited deadlocked with it. Postgres aborted the app transaction with `40P01`, and 017 committed.
- **Now** (approved change, third review):
  - the comment says reads wait;
  - that exact case no longer deadlocks (test 17, 3 runs).
- **One other shape can still deadlock.** The third review section has it, together with the precondition that prevents it.

## 1. What changed and why

**The first version of 017** closed both F-01 leaks on `group_members.message` (section 9 recaps how). But the same note text also lived on in the group history, readable for good by:
- the event's subject and actor;
- whoever was notified;
- every current admin of the group.

**The history revision** removes a note from the history as soon as its invitation or request is settled. The rows themselves stay intact.

**Changes in 017:**
- A **lock** at the top: ACCESS EXCLUSIVE on `group_members`, then `group_events`, before anything else, held until commit or rollback (third review).
- **`clear_settled_membership_event_notes()`**, run by two triggers on `group_members`:
  - `group_members_clear_settled_event_notes`: AFTER UPDATE OF status, when the row leaves `invited` or `requested`;
  - `group_members_clear_deleted_event_notes`: AFTER DELETE of a pending row.
- **`clear_orphaned_event_note()`**, run by `group_events_clear_orphaned_note`: BEFORE UPDATE OF subject_id, when the subject's account is deleted.
- **A one-time history cleanup** for records that already exist, now with the privacy-first tie rule.
- Header and cleanup comments document all of this.

**Outside the migration:**
- **Fourth review (this round):**
  - `tests/concurrency/membership-notes.concurrency.mts`: from 25 to 38 tests (26–38). Test connections can now log in as another role (`authenticator`, or `ops`, which has no monitoring rights).
  - `PHASE_7A_DEPLOYMENT_RUNBOOK.md`: D2 rewritten to read `pg_locks`, notes on blank columns and lock states, and the explicit freeze. The drain explanation now names the verified deadlock shape and the shapes that aren't one.
  - This report.
- **Third review:**
  - `tests/concurrency/membership-notes.concurrency.mts`: from 17 to 25 tests. The old read-then-write test now expects no deadlock; the new tests are 17–25 below.
  - `PHASE_7A_DEPLOYMENT_RUNBOOK.md`: an explicit drain procedure with checks D1 and D2, the new hash, the same up-front lock added to the emergency rollback script R, and new sign-off rows.
  - This report.
- **Second review:**
  - `tests/db/membership-notes.test.mts`: the tie suite, 12 tests;
  - `tests/db/harness.mts`: `SUPABASE_STAND_IN` exported (one word).
- **No app code changed in either review.** `src/lib/groups.ts` and `src/types/database.ts` are as in the earlier Phase 7A work.

## 2. Event and notification data, as actually defined

Traced from 015 and 016, and from every trigger and function that writes these tables.

**`public.group_events` (015)**
- **Columns:** `id uuid` (`gen_random_uuid()`, random version 4), `group_id uuid` (on delete cascade), `group_name text`, `subject_id uuid` (whose membership changed; on delete set null), `actor_id uuid` (who did it; on delete set null), `kind text`, `detail text`, `created_at timestamptz not null default now()`.
- **`detail` is plain text, not JSON.** It is set only by `record_group_membership_event()` (an AFTER INSERT OR UPDATE trigger on `group_members`):
  - kind `invited`: `detail = new.message`, the invitation note;
  - kind `requested`: `detail = new.message`, the request note;
  - kind `role_changed`: `detail = new.role` (`admin` / `member`);
  - every other kind: `detail = null`.
- **Notes are therefore only ever on `invited` and `requested` events.** The event kind is the same word as the pending status the note was sent with.
- **Read policy:** subject, actor, current active admins of the group, and anyone with a notification for the event.
- **Grants:** students have `SELECT` only. No student writes.
- **Realtime:** not in the publication.

**`public.notifications` (015)**
- **Columns:** `id`, `recipient_id`, `event_id` (on delete cascade), `read_at`, `created_at`.
- **No text of its own.** The app (`loadNotifications` in `src/lib/groups.ts`) joins on `event_id` and shows `group_events.detail` in quotes, only for `invited` and `requested`, and only when non-null (`src/app/notifications/page.tsx`).
- Clearing the event's `detail` removes the text from every notification that points to it.

**`public.group_messages` (016):** system messages never copy a note; `role_changed` only reads `detail` to choose admin or not.

**Other persisted copies:** none. The note text lives only in `group_members.message` and `group_events.detail`.

**What each step records** (the event comes from the 015 trigger, in the same transaction; the membership row is never deleted by a settlement):

| Step | Membership status | Event (detail) | Who is notified |
|---|---|---|---|
| Invite | → `invited` | `invited` (note) | Invitee |
| Ask to join | → `requested` | `requested` (note) | Active admins at that moment |
| Accept invite (or ask while invited) | `invited` → `active` | `invite_accepted` (null) | Admins |
| Decline invite | `invited` → `declined` | `invite_declined` (null) | Admins |
| Cancel invite | `invited` → `cancelled` | `invite_cancelled` (null) | Invitee |
| Approve (or invite while requested) | `requested` → `active` | `request_approved` (null) | Requester |
| Decline request | `requested` → `declined` | `request_declined` (null) | Requester |
| Withdraw request | `requested` → `left` | `request_withdrawn` (null) | Nobody |
| Remove a pending student | → `removed` | `member_removed` (null) | That student |
| Account deleted | Row deleted (cascade) | Events keep their row; `subject_id` → null | — |
| Group deleted | All cascade | All its events and notifications deleted | — |

## 3. How settled notes are identified and cleared

**The membership action** a note belongs to is identified by `group_id`, `subject_id` (the member), `kind` (`invited` or `requested`) and that member's row in `group_members`. No JSON parsing or broad text matching is involved.

**Going forward, inside the same transaction as the settlement:**
1. **The row leaves a pending status:**
   ```sql
   update public.group_events set detail = null
   where group_id = old.group_id and subject_id = old.profile_id
     and kind = old.status and detail is not null;
   ```
   Earlier rounds of that kind were already settled, so clearing them all is exact. The new status's own event is a different kind, so trigger order doesn't matter.
2. **A pending row is deleted** (only by the owner; students can't delete): same rule, from the deleted row.
3. **The member's account is deleted.** `ON DELETE SET NULL` empties `subject_id`, and a BEFORE UPDATE trigger clears that `invited` or `requested` event's `detail`.

**For records that already exist when 017 runs:**
- An event keeps its note only under the three conditions in the second-review section above.
- Everything else of kind `invited` / `requested` with a note is cleared:
  - answered, cancelled or withdrawn actions;
  - earlier rounds;
  - exactly tied copies;
  - deleted accounts (no subject, so no matching row).

## 4. What is preserved

- **Every event and notification row stays,** with the same `id`s.
- **Event columns:** `group_id`, `group_name`, `subject_id`, `actor_id`, `kind`, `created_at`.
- **Notification columns:** `recipient_id`, `event_id`, `read_at` (read state), `created_at`.
- **Untouched:** `role_changed` details and all other events, and group chat system messages.
- **`updated_at`** on membership rows is preserved by the one-time member cleanup.
- **Checked value for value, before and after:**
  - on PGlite, every column of every row;
  - on real PostgreSQL, every pre-existing event and notification in every concurrency scenario.

## 5. How pending notes stay available

- **The pending row's note:** readable through `group_membership_notes()`, by the group's active admins and by the student whose row it is.
- **The pending event's note:** stays in the history until the action is settled. The exception is copies cleared because of an exact time tie, as described above.
- **The app needed no change.**

## 6. Application compatibility (reviewed, unchanged)

- `src/lib/groups.ts` never selects `message`. Notes come only from `loadNotes()` → `rpc("group_membership_notes", { p_groups })`.
- Settled notes can't reappear in the UI. The notifications page only quotes a non-null `detail`.
- Group chat, discovery, member lists and the notifications list are unchanged; their tests all pass.

## 7. Tests and results

Run on 2026-11-25 in `c:\Users\hn072\all projects\roomie`:

| Command | Result |
|---|---|
| `node --test tests/db/membership-notes.test.mts` | 69 of 69 pass (34 Phase 7A + 23 history + 12 ties) |
| `npm test` | **397 of 397 pass** in each of 3 separate runs, 100 suites, 0 failed, 0 skipped |
| `npm run lint` | Pass, 0 problems |
| `npx tsc --noEmit` | Pass |
| `npm run build` | Pass |
| `node --disable-warning=ExperimentalWarning --test tests/concurrency/membership-notes.concurrency.mts` | **38 of 38 pass** in each of 3 separate runs (Docker, PostgreSQL 17.12) |
| Runbook SQL, checked locally | P5 predicts exactly what 017 clears; every runbook block, including R with its new lock, runs on PGlite; D1 and D2 run on PostgreSQL in test 25 |

**The 12 tie tests** (PGlite suite "identical notes with identical timestamps (017 cleanup, privacy first)") run on a database built from 001–016 with real data, then 017.
- **Set-up:**
  - Each pair: a request with a distinctive note, declined, then the same note again (pending), with both `requested` events forced to the same `created_at`.
  - Pairs are created until both id orders have occurred (at most 64).
  - Also present:
    - a student with two tied earlier rounds plus a strictly later current round;
    - "Twin", a different student pending with the same text at the same time;
    - Kiran, another pending student.
- **The tests:**
  1. event ids are random version-4 UUIDs;
  2. each pair really is tied, and both id orders occurred;
  3. on 001–016 both tied events carry the note;
  4. **both tied events lose the note, whichever id sorts higher;**
  5. **both event records remain**, with every other value unchanged;
  6. **both notification records remain unchanged;**
  7. **the pending membership row keeps its note;**
  8. **the authorized readers still get it from `group_membership_notes()`** (the admin, and the student themselves), and another requester gets only their own;
  9. a strictly later round keeps its note when only earlier rounds tie;
  10. **unrelated members' notes are unchanged**, even with the same text at the same time;
  11. exactly the tied and earlier copies are cleared, and nothing else changes;
  12. **a second run changes nothing.**

**Test count:**
- 362 (baseline) + 23 (history) + 12 (ties) = 397.
- The 7 earlier ordering tests were replaced by these 12. Two of the 7 had pinned the random-id behaviour that the reviewer has now ruled out; the rest are kept in the new suite in stronger form.
- No other test was removed or weakened.

## 8. Migration safety

- **Only 017 changed.** 001–016 are unchanged (empty `git diff` against `HEAD`).
- **Safe on 001–016:** tested on databases built that way, on PGlite and on PostgreSQL 17.12.
- **Idempotent:** a second run leaves everything identical (both engines).
- **Narrow updates:**
  - The member cleanup touches only non-pending rows with a note.
  - The history cleanup touches only `invited` / `requested` events with a note that don't belong to a pending action.
  - No table rewrite. Only the `CHECK` constraint scans `group_members`.
- **Concurrency (verified locally on real PostgreSQL):**
  - 017 takes both of its locks first, and never raises one later.
  - It waits for membership changes in flight, and every read and write of the two tables waits for it.
  - It is all-or-nothing on commit and on rollback, and a rolled-back 017 can simply be run again.
  - The new triggers govern every settlement after commit.
  - Run it only after the runbook's drain procedure (third review).

## 9. The first 017 (unchanged parts), in brief

- **Root cause:** nothing protected or cleared the note:
  - 010's table-wide `SELECT` on `group_members` included the 015 note column;
  - 011's row policy exposes pending rows to members, and active rows of discoverable groups to everyone;
  - nothing cleared the note when the action was settled.
- **Fix:**
  - column grants without `message`;
  - `group_membership_notes()`: security definer, `search_path=''`, eligibility check, admin-or-own rule, `EXECUTE` for `authenticated` only;
  - a BEFORE trigger plus a `CHECK` so the row keeps a note only while pending;
  - cleanup of existing rows, with `updated_at` kept.

## 10. Remaining limitations

1. **The drain is a hard precondition.** If 017 starts while a session holds `group_events` without `group_members` and then needs `group_members`, the two deadlock and Postgres rolls one back. The notifications page does this in a single query. Depending on timing, the loser was 017 (nothing applied) or the page's request. While 017 waits, every read and write of both tables queues behind it, so a long-held lock stalls group pages until it ends. The runbook's D1 and D2 checks find such sessions, but only an operator following the runbook prevents them.
2. **Still not verified:**
   - **PostgREST's exact SQL.** PostgREST wasn't run; tests 33–36 use an equivalent single statement.
   - **The real account-deletion path.** Supabase Auth's own deletion (its role, and any other auth tables) wasn't run; the tests delete from the stand-in `auth.users` as the owner.
   - **The live deadlock window.** How often the notifications deadlock would happen live is unmeasured.
   - **The outcomes query.** Not touching `group_members` is plan-dependent.
   - **The drain checks on Supabase.** D1 and D2 ran only on local PostgreSQL. Whether Supabase's `postgres` has monitoring rights is unknown; the rewritten D2 doesn't depend on it.
3. **The local PostgreSQL is not Supabase.** Roles, privileges, `auth.uid()` and row-level security are modelled by the same stand-ins as `npm test`. Not modelled:
   - Supabase's own extensions and services (PostgREST, Supavisor, Realtime);
   - its exact role memberships and object ownership;
   - the live server's PostgreSQL version, which I didn't check because that needs production access.

   Postgres lock semantics are the same across supported versions, but **this is not production-equivalent verification.**
4. **Concurrency coverage is the 38 scenarios listed**, not every possible interleaving. Waits were forced at the transaction level.
5. **The cleanup can't be undone.** Cleared note text comes back only from a database backup restore, which also rolls back everything else.
6. **A former admin can still see a pending note** through a notification they received while an admin (015's recipient rule), until the request is settled. Changing that is outside this task.
7. **No live end-to-end check yet.** The live `group_members` table was empty at the read-only check on 2026-11-25. The runbook's smoke tests create the data needed.
8. **The app and 017 must go live together**, with traffic stopped from the drain until both are in place.

## 11. Confirmation

- **Production:** not connected to, read or changed in this revision. The only production access in Phase 7A was the read-only preflight on 2026-11-25, done earlier at your request.
- **Deployment:** no `supabase db push`, `migration up` or deployment command was run. No Supabase setting or environment variable was changed.
- **Docker:** used only for a local, network-less, disposable PostgreSQL container, removed after each run. Docker Desktop had stopped between sessions, so I started it again, as you approved for these tests. No image was downloaded and nothing was installed. The test roles `authenticator` and `ops` exist only inside each throwaway container.
- **Git:** nothing was committed, pushed or merged, and no branch was created.
- **The approved lock change** was applied to the local file only.
- **Migrations 001–016** are unchanged, and no existing test was weakened. The one test whose expectation changed (the read-then-write case) now asserts the stronger outcome: no deadlock.
