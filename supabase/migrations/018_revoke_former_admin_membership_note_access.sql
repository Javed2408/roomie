-- =============================================================================
-- Roomie 018: a former admin's old notification no longer reveals a pending
-- join-request note.
--
-- 015's read policy on group_events lets four kinds of people read an event:
-- its subject, its actor, the group's current active admins, and anyone who
-- holds a notification for it. Admins are notified of every join request,
-- and the request's note is the event's detail while the request is pending
-- (017 clears it once settled). An admin who is later demoted, leaves or is
-- removed keeps that notification, so the fourth branch kept showing them
-- the pending note, although group_membership_notes() (017) no longer does.
--
-- After this migration the notification branch no longer grants an
-- 'invited' or 'requested' event while its detail still holds a note. The
-- other three branches are unchanged, so the student who wrote the note
-- (subject), the inviter (actor) and the group's current active admins
-- read it exactly as before. Once the request is settled (or the note is
-- otherwise cleared, by 017), the event is visible again through the
-- notification, without the note. Every other event kind, including
-- role changes, is untouched, and no row in any table changes.
--
-- Run as postgres (the table's owner), after 017, as one script (a single
-- transaction). Idempotent: a second run leaves the same policy.
-- Locking: the first statement takes ACCESS EXCLUSIVE on group_events only,
-- so every other read and write of group_events waits until this commits
-- (milliseconds). Creating the policy also takes a share lock on
-- notifications, which only an ACCESS EXCLUSIVE lock could block. Run it in
-- the same drained maintenance window as 017 (see the deployment notes).
-- =============================================================================

lock table public.group_events in access exclusive mode;

drop policy if exists "group_events: involved people read" on public.group_events;
create policy "group_events: involved people read"
  on public.group_events for select to authenticated
  using (
    subject_id = (select auth.uid())
    or actor_id = (select auth.uid())
    or public.is_group_admin(group_id)
    or (
      exists (
        select 1 from public.notifications as n
        where n.event_id = group_events.id and n.recipient_id = (select auth.uid()))
      -- A notification alone never reveals a pending invitation or request note.
      and not (kind in ('invited', 'requested') and detail is not null)
    )
  );
