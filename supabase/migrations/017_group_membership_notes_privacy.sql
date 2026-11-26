-- =============================================================================
-- Roomie 017: private invitation and join-request notes (audit finding F-01).
--
-- 015 added group_members.message, a note sent with an invitation or a join
-- request, and copies it into the group history: 015's event trigger writes
-- it to group_events.detail (plain text) on the 'invited' or 'requested'
-- event. Notifications hold no text of their own: they point at the event
-- (event_id), and the app shows the event's detail. Students could read the
-- column on every membership row their select policy allows (010's
-- table-wide SELECT grant, 011's policy), so:
--   * any active member read the notes on other people's pending requests;
--   * in a discoverable group, any eligible student read the invitation
--     note left on each active member's row (it was never cleared);
-- and the history kept every note for good, settled or not.
--
-- After this migration:
-- * Students can't read group_members.message at all. The table-wide
--   SELECT is replaced by SELECT on every other column (a column REVOKE
--   alone would not override a table-wide grant). Rows stay visible
--   exactly as before.
-- * group_membership_notes(groups) returns a pending note only to:
--     - an active admin of that group (they answer requests and manage
--       invitations), or
--     - the student whose own row it is: their own join request, or the
--       invitation addressed to them.
--   Always with an eligible SRM account. Nobody else, ever.
-- * A note lives only while its invitation or request is pending, in the
--   membership row AND in the history:
--     - the row's own copy is cleared in the same statement that moves the
--       row out of 'invited' / 'requested' (a CHECK constraint holds it);
--     - the history copy (detail of that member's 'invited' / 'requested'
--       events in that group, matching the status they left) is cleared by
--       a trigger in the same transaction; also when the membership row is
--       deleted, or when the student's account is deleted.
--   Event and notification rows themselves are never deleted: ids, kinds,
--   people, groups, times and read state stay as they are. Only the note
--   text goes. Role-change details ('admin' / 'member') are untouched.
-- * Existing data is cleaned up the same way: notes on rows that are no
--   longer pending, and every history note that isn't the note of a
--   currently pending invitation or request. Where identical copies of a
--   pending note have the exact same time, none is kept (see below).
--
-- Unchanged: who can see which rows, every membership function, who is
-- notified and how, group chat and its policies.
--
-- Run as postgres (the tables' owner). Idempotent: safe to run more than
-- once; a second run changes nothing. Run it as one script: Postgres applies
-- a multi-statement script as a single transaction, so it applies
-- completely or not at all.
--
-- Locking: the first statement takes ACCESS EXCLUSIVE on group_members,
-- then on group_events, before anything else is read or changed, and keeps
-- both until the script commits or rolls back. While 017 waits for those
-- locks or holds them, every other read and write of these two tables waits
-- too (member lists, group history and notifications included). So nothing
-- slips past the cleanup, and no lock is raised later in the script. Run it
-- only once the app is drained (see the deployment runbook): a transaction
-- that has already read or written group_events, but not group_members,
-- can deadlock with 017, and Postgres then rolls one of them back.
-- =============================================================================


-- Both tables, strongest lock, first. Nothing else reads or writes them
-- until this script ends; every later statement runs under these locks.
lock table public.group_members, public.group_events in access exclusive mode;


-- -----------------------------------------------------------------------------
-- The membership row: a note lives only while it's pending
-- -----------------------------------------------------------------------------

create or replace function public.clear_settled_group_member_note()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status not in ('invited', 'requested') then
    new.message := null;
  end if;
  return new;
end;
$$;

drop trigger if exists group_members_clear_settled_note on public.group_members;
create trigger group_members_clear_settled_note
  before insert or update on public.group_members
  for each row execute function public.clear_settled_group_member_note();

revoke execute on function public.clear_settled_group_member_note() from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- The history: a note leaves it when its invitation or request is settled
-- -----------------------------------------------------------------------------
-- 015 records a pending note on an event whose kind is the status it was
-- sent with ('invited' / 'requested'), about the member (subject_id) in
-- that group. When the row leaves that status, every such event for that
-- member, group and kind belongs to a settled invitation or request (an
-- earlier round was settled the same way), so its text goes. The event
-- for the row's NEW status is a different kind, so it is never touched,
-- whichever trigger runs first.

create or replace function public.clear_settled_membership_event_notes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.group_events
  set detail = null
  where group_id = old.group_id
    and subject_id = old.profile_id
    and kind = old.status
    and detail is not null;
  return null;
end;
$$;

drop trigger if exists group_members_clear_settled_event_notes on public.group_members;
create trigger group_members_clear_settled_event_notes
  after update of status on public.group_members
  for each row
  when (old.status in ('invited', 'requested') and new.status is distinct from old.status)
  execute function public.clear_settled_membership_event_notes();

drop trigger if exists group_members_clear_deleted_event_notes on public.group_members;
create trigger group_members_clear_deleted_event_notes
  after delete on public.group_members
  for each row
  when (old.status in ('invited', 'requested'))
  execute function public.clear_settled_membership_event_notes();

revoke execute on function public.clear_settled_membership_event_notes() from public, anon, authenticated;

-- A deleted account: its events lose their subject (015's ON DELETE SET
-- NULL), and its pending invitation or request is gone with it.
create or replace function public.clear_orphaned_event_note()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.detail := null;
  return new;
end;
$$;

drop trigger if exists group_events_clear_orphaned_note on public.group_events;
create trigger group_events_clear_orphaned_note
  before update of subject_id on public.group_events
  for each row
  when (old.subject_id is not null and new.subject_id is null and new.kind in ('invited', 'requested'))
  execute function public.clear_orphaned_event_note();

revoke execute on function public.clear_orphaned_event_note() from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- Existing data
-- -----------------------------------------------------------------------------

-- Notes on membership rows that are no longer pending. The updated_at
-- trigger is paused so these rows keep their timestamps (nothing else
-- about them changes, and 015's event trigger only reacts to status or
-- role changes).
alter table public.group_members disable trigger group_members_set_updated_at;
update public.group_members
set message = null
where message is not null and status not in ('invited', 'requested');
alter table public.group_members enable trigger group_members_set_updated_at;

-- History notes that don't belong to a pending invitation or request. An
-- event keeps its note only if its member's row in that group is still
-- pending with the same status (the event's kind), the note is that row's
-- current note, and no other event of that kind with the same note is as
-- recent or more recent (created_at >= its own). So of several identical
-- notes for one member, group and kind, only the strictly most recent
-- keeps its text: the current round's. If the most recent ones share the
-- exact same created_at, nothing can tell which round is current (event
-- ids are random UUIDs, not ordered), so none of them keeps it: privacy
-- first. The pending row keeps its own note either way, and its readers
-- still get it from group_membership_notes(). Everything else of kind
-- 'invited' / 'requested' is settled: an earlier round, an answered
-- invitation or request, a deleted account (no subject).
update public.group_events as e
set detail = null
where e.kind in ('invited', 'requested')
  and e.detail is not null
  and not exists (
    select 1
    from public.group_members as m
    where m.group_id = e.group_id
      and m.profile_id = e.subject_id
      and m.status = e.kind
      and m.message = e.detail
      and not exists (
        select 1
        from public.group_events as other
        where other.group_id = e.group_id
          and other.subject_id = e.subject_id
          and other.kind = e.kind
          and other.detail = e.detail
          and other.id <> e.id
          and other.created_at >= e.created_at
      )
  );

alter table public.group_members drop constraint if exists group_members_note_only_while_pending;
alter table public.group_members
  add constraint group_members_note_only_while_pending
  check (message is null or status in ('invited', 'requested'));


-- -----------------------------------------------------------------------------
-- Students can read every membership column except the note
-- -----------------------------------------------------------------------------

revoke all on public.group_members from anon;
revoke select on public.group_members from authenticated;
revoke select (message) on public.group_members from authenticated;
grant select (group_id, profile_id, role, status, invited_by, joined_at, created_at, updated_at)
  on public.group_members to authenticated;
-- (Still no direct writes for students: 010 granted none.)


-- -----------------------------------------------------------------------------
-- group_membership_notes(): the only way a student reads a row's note
-- -----------------------------------------------------------------------------
-- For the given groups (at most 200), the pending notes the signed-in
-- student may read: every pending note in groups they actively administer,
-- and the note on their own pending row anywhere. Rows without a note are
-- left out. Security definer because students can no longer read the
-- column themselves; every rule is checked here.

create or replace function public.group_membership_notes(p_groups uuid[])
returns table (
  group_id   uuid,
  profile_id uuid,
  status     text,
  message    text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  me uuid := (select auth.uid());
begin
  if me is null or not public.is_eligible_student() then
    raise exception 'Only signed-in SRM students can read these notes.' using errcode = '42501';
  end if;
  if p_groups is null or cardinality(p_groups) = 0 then
    return;
  end if;
  if cardinality(p_groups) > 200 then
    raise exception 'Ask for at most 200 groups at a time.' using errcode = '22023';
  end if;

  return query
  select m.group_id, m.profile_id, m.status, m.message
  from public.group_members as m
  where m.group_id = any (p_groups)
    and m.status in ('invited', 'requested')
    and m.message is not null
    and (m.profile_id = me or public.is_group_admin(m.group_id));
end;
$$;

revoke execute on function public.group_membership_notes(uuid[]) from public, anon;
grant execute on function public.group_membership_notes(uuid[]) to authenticated;
