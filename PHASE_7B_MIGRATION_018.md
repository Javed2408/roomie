# Phase 7B: migration 018 (former admins and pending request notes)

**Status: implemented and tested locally only.**
- Not applied anywhere, not deployed, nothing committed.
- No production access.
- Migrations 001–017 are unchanged.
- **Phase 7A artifacts are unchanged except for one test line,** with your approval: `tests/db/membership-notes.test.mts`, see section 5.

This document is an addendum to `PHASE_7A_DEPLOYMENT_RUNBOOK.md`. Section 6 says exactly where 018 fits into that runbook's maintenance window.

## 1. The problem

**015's read policy on `group_events`** grants a row to four kinds of reader:
- its subject;
- its actor;
- a current active admin of the group (`is_group_admin()`);
- **anyone holding a notification for it.**

**How that exposes the note:**
- Every active admin is notified of a join request.
- While the request is pending, its note is the event's `detail`.
- An admin who is later demoted, leaves or is removed keeps the notification, so the fourth branch kept giving them the note.

This was reproduced locally: the note stayed visible after demotion, after leaving and after removal, until the request was settled.

## 2. The change: `supabase/migrations/018_revoke_former_admin_membership_note_access.sql`

The policy is replaced under the same name. It keeps the same command (`select`), the same role (`authenticated`) and the same first three branches. Only the notification branch gains one condition:

```sql
or (
  exists (select 1 from public.notifications as n
          where n.event_id = group_events.id and n.recipient_id = (select auth.uid()))
  and not (kind in ('invited', 'requested') and detail is not null)
)
```

**Who sees what afterwards:**

| Reader | Pending request note | After settlement |
|---|---|---|
| The requesting student (subject) | yes (unchanged) | event, no note |
| A current active admin | yes (unchanged) | event, no note |
| A former admin holding the notification | **no**: the event row is hidden while the note is there | event, no note (visible again) |
| The invitee (subject) and the inviter (actor), for invitation notes | yes (unchanged) | event, no note |
| Everyone else | no (unchanged) | no (unchanged) |

**Why it's safe:**
- **No weakening.** The new policy only removes access. Every row it grants was also granted before.
- **One SELECT policy.** `group_events` has exactly one policy of that kind (checked in the migrations and in the database). Policies of the same kind are combined with OR, so a second one could have undone the narrowing; there is none.
- **No recursion.**
  - The new condition reads only the row's own `kind` and `detail`.
  - The `notifications` subquery is unchanged. Its own policy (`recipient_id = me`) doesn't refer back to `group_events`.
  - `is_group_admin()` is unchanged.
- **Security-definer code is unaffected,** because it runs as the owner and bypasses RLS:
  - 017's `group_membership_notes()` and its triggers;
  - 016's chat system messages, which read `detail` only for role changes.

  Realtime doesn't publish `group_events`.
- **Invitation notes:** listing `invited` alongside `requested` changes nothing in practice. Only the invitee (the subject) is notified of an invitation, and the subject branch is untouched. It only means the condition says "private pending note" for both kinds.
- **No data changes.** No row in any table changes, and notification rows and read state stay the same (tested). Former admins can still mark the hidden notification read.
- **Idempotent.** A second run leaves the identical policy (tested).

**Locking:**
- The first statement takes ACCESS EXCLUSIVE on `group_events` only.
- Creating the policy also takes ACCESS SHARE on `notifications`, which only an ACCESS EXCLUSIVE lock elsewhere could block.
- **Measured before commit:** 018's table locks were `group_events` (ACCESS EXCLUSIVE) and `notifications` (ACCESS SHARE), and nothing on `group_members`.
- **So 018 can't deadlock with the app.** It holds nothing while waiting for `group_events`, and the only further lock it takes conflicts with nothing the app uses. It can only wait, or make `group_events` readers and writers wait for a few milliseconds.

## 3. Tests

### PGlite regression tests (part of `npm test`): `tests/db/former-admin-notes.test.mts`, 15 tests

**The scenario:**
- Asha, Ravi, Dev and Tara are admins when Kiran asks to join with `PRIVATE-NOTE`, so all four are notified.
- Tara invites Zed with `INVITE-NOTE`. Ravi has read his notifications.
- Then Ravi is demoted, Dev leaves and Tara is removed.

| Required check | Test |
|---|---|
| 1 Current admin reads the pending note | history, notification and `group_membership_notes()` all return it |
| 2 Former admin who was notified cannot read it | each still holds the notification; the event is not readable |
| 3, 4, 5 After demotion, after leaving, after removal | one test each |
| 6 The requesting student keeps access | history and the note function |
| 7 Invitation notes unchanged | invitee, inviter (even after removal) and current admin read it; an uninvolved former admin never could |
| 8 Notification records and read state intact | 018 applied to a 017 database with data: every event and notification row identical; the hidden notification can still be marked read |
| 9 Settled request visible again without its note | for all three former admins |
| 10 Role-change notifications unaffected | Ravi still sees "admin" and "member" |
| 11 No direct query gets around it | selects by note text, through notifications, and counts: nothing. Writes to `group_events` and reads of `group_members.message` are refused |
| Unread badge | documented in section 4 |
| The release check V7 | the deployed policy is the narrowed one, and it is the only one |
| Idempotency | a second run leaves the same policy |
| **Exactly one change** | the same story on a 017-only database and on 017 + 018: for every user, the only difference is that the three former admins no longer see `requested:kiran:PRIVATE-NOTE`. The 017-only side also proves the bug existed |

### Real PostgreSQL 17.12 (Docker): `tests/concurrency/former-admin-notes.concurrency.mts`, 7 tests

1. **Set-up:** on 017 alone, the demoted admin still reads the note.
2. **018 waits for an open history read,** then applies. Afterwards the former admin can't read the note, and the current admin can.
3. **While 018 holds its lock,** the notifications page's query and a settlement both wait. A member-list read and the unread count don't, and the measured lock list is as in section 2. After commit both resume; the settlement clears the note, and the former admin sees the event without it.
4. **018 rolled back:** the waiting read resumes under the old policy, nothing of 018 remains, and a re-run applies it.
5. **A notifications-page read arriving while 018 waits** for its lock: no deadlock. The current admin's page still shows the note.
6. **The release sequence on a 016 database,** 017 then 018 as two runs: both applied, with the right access afterwards.
7. **The same with 017 and 018 pasted as one run** (one transaction).

### Commands and results (2026-11-26)

From `c:\Users\hn072\all projects\roomie`:

| Command | Result |
|---|---|
| `node --disable-warning=ExperimentalWarning --test tests/db/former-admin-notes.test.mts` | 15 of 15 pass |
| `npm test` | **412 of 412 pass** (397 + 15), 0 cancelled |
| `npm run lint` | exit 0 |
| `npx tsc --noEmit` | exit 0 |
| `node --disable-warning=ExperimentalWarning --test tests/concurrency/former-admin-notes.concurrency.mts` | **7 of 7 pass** |
| `node --disable-warning=ExperimentalWarning --test tests/concurrency/membership-notes.concurrency.mts` | 38 of 38 pass (Phase 7A suite, unchanged; it doesn't apply 018) |

**Also checked once, on a throwaway in-memory database:**
- R18 (section 6) restores the exact previous policy.
- The rejected database-side badge fix in section 4 fails with `infinite recursion detected in policy for relation "notifications"`.

**Not run:** `npm run build`. No app code changed.

## 4. The unread badge

**What happens:**
- The app's badge (`countUnreadNotifications`) counts the student's own `notifications` rows.
- The list (`loadNotifications`) drops a notification whose event isn't returned (`if (!event) return []`).
- So while a request is pending, a former admin's badge counts one notification more than the list shows (tested: badge = listed + 1).
- It corrects itself when the request is settled, or when they use "Mark all read", which still marks the hidden row (tested).

**Who it affects:** only former admins, and only until the request is settled. No private data is involved; it's a count mismatch.

**Smallest safe fix (not implemented; it's an app change):**
- Count only notifications whose event the student can read: in `countUnreadNotifications`, `select("id, group_events!inner(id)", { count: "exact", head: true })`.
- The equivalent SQL count was tested; the PostgREST embed itself was not.

**Do not fix it in the database:** making the `notifications` policy check `group_events` recurses (`group_events`'s policy already reads `notifications`). Postgres refuses it with "infinite recursion detected in policy" (tested).

## 5. Change to a Phase 7A file (approved)

**Why it was needed:** 018 is picked up by every test database, and one 7A upgrade suite asserted that applying everything after 016 applies exactly `["017_…"]`. With 018 present that suite's `before` hook failed and its 5 tests were cancelled.

**The change, in `tests/db/membership-notes.test.mts`:** `applyMigrations(db, { after: "016" })` became `applyMigrations(db, { after: "016", through: "017" })`. That suite still tests exactly what it was written for: 017 applied to a 016 database.

**Hashes:** the file goes from `9fb7eddd…` (audited) to `281b5839…`. All other 7A artifacts are byte-identical to the audit:
- 017: `18d12b56…`
- the 7A concurrency suite: `142873d2…`
- the completion report: `ac4d2f51…`
- the deployment runbook: `06e9fdd6…`

## 6. Running 017 and 018 in one maintenance window

Follow `PHASE_7A_DEPLOYMENT_RUNBOOK.md` with these additions. Nothing about the app changes: the app is compatible with 018 being present or not.

### Before the window (runbook 1.1 and 1.3)

**Hashes**, in PowerShell from the project folder:
```powershell
Get-FileHash supabase\migrations\018_revoke_former_admin_membership_note_access.sql -Algorithm SHA256
```
- 018 expected: `A5B34AB2FA65D88FFBF8031B2E5E20AD3122AD0DDCE94F50EA7090F82F72B042`
- 017 is unchanged: `18D12B56…A690`

**Expected checks:**
- `npm test` **412 of 412** (replaces 397).
- Optional Docker suites: 38 of 38 (017) and 7 of 7 (018).

**An extra preflight query** (read-only), alongside P1–P6:
```sql
-- P7. 018 not applied yet (expected: false)
select pg_get_expr(polqual, polrelid) like '%detail IS NOT NULL%' as already_narrowed
from pg_policy
where polrelid = 'public.group_events'::regclass
  and polname = 'group_events: involved people read';
```

### During the window (runbook section 2)

- **Steps 1–3 are unchanged:** freeze, D2, D1. D1 already covers `group_events`.
- **Step 4:** apply 017 as written.
- **New step 4b, straight after 017 succeeds,** with the app still drained: in the same SQL Editor tab, paste the whole reviewed 018 file and run it once, as `postgres`. It takes milliseconds. Running D1 again isn't needed while the freeze holds.
  - **If 017 failed,** don't run 018. Follow the runbook's failure steps.
  - **If 018 fails with a lock error:** keep the app stopped, run D2 and D1 again, then re-run 018 (re-running after a rollback was tested).
  - **If 018 fails with any other error:** 017 stays applied and is complete on its own, and the app can be deployed either way. Reopening without 018 means knowingly leaving the former-admin exception open, so that is the owner's decision.
- **Running them as one** (pasting 017 and 018 together, one transaction) also works (tested). It's not recommended: a failure in 018 would then undo 017 too.
- **Steps 5–8 are unchanged:** deploy the app, check, reopen. Add V7 to the step-7 checks.

### After the window (runbook 3.1)

```sql
-- V7. 018 in place: one SELECT policy on group_events, and it is the narrowed one (expected: 1, true)
select (select count(*) from pg_policy where polrelid = 'public.group_events'::regclass) as policies,
       (select pg_get_expr(polqual, polrelid) like '%detail IS NOT NULL%'
          from pg_policy
         where polrelid = 'public.group_events'::regclass
           and polname = 'group_events: involved people read') as narrowed;
```

**Smoke test:** the runbook's two-account smoke tests are enough for 017. Showing 018 live needs a third account, one that was an admin when a request arrived and was then demoted. If none is available, rely on V7 and the local tests; the smoke test is optional.

### Rollback of 018 only (R18)

R18 restores the 015 policy exactly (tested), and with it the former-admin exception. Drain first, as in runbook section 2, steps 1–3. R18 is independent of the 017 rollback R; if both are ever needed, the order doesn't matter.

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

### Extra sign-off rows

| Check | Result | By / time |
|---|---|---|
| 018 hash confirmed | | |
| P7 recorded (`false`) | | |
| 018 applied once as `postgres`, right after 017 | | |
| V7 = 1, true | | |

## 7. Limitations

- **Not verified:**
  - PostgREST end to end;
  - the Supabase SQL Editor;
  - anything in production.

  The tests use direct SQL as `authenticated`, the same as the Phase 7A tests.
- **Former admins lose the whole "X asked to join" entry while the request is pending,** not just its quote, because RLS can only hide rows, not individual fields. It comes back, without the note, once the request is settled.
- **The badge mismatch in section 4 stays** until the small app fix is approved.
- **An inviter keeps reading their own invitation note** after losing admin rights, through the actor branch, as before. These are their own words, and the requirement was to keep the actor's access.
- **The Docker test plumbing** in `former-admin-notes.concurrency.mts` is a trimmed copy of the Phase 7A suite's. That suite is frozen; merge the two after Phase 7A ships (marked with a `shortcut:` comment).
