-- =============================================================================
-- Roomie 015: the group experience (creation, discovery, membership,
-- notifications). Builds on 010 and 011; membership still changes only
-- through the database functions.
--
-- * groups: budget_min (with budget_max: a range), housing_status (does
--   the group have a place or need one), room_preference, lifestyle_notes.
-- * group_members.message: an optional note with an invitation or a join
--   request. New status 'cancelled': an admin withdrew an invitation
--   (unlike 'removed', the student may be invited or ask again later).
-- * invite_to_group / request_to_join_group gain an optional message and
--   refuse across blocks: nobody is invited to, or let into, a group with
--   someone they blocked or who blocked them. The reason isn't revealed.
-- * cancel_group_invite(): withdraw an invitation (admins).
-- * search_students_for_group(): find eligible students to invite (admins).
-- * discover_groups(): discoverable groups for the signed-in student, with
--   member counts, respecting blocks and filters.
-- * group_events: an audit log of membership changes, written by the
--   database itself. notifications: one row per person to tell, also
--   written by the database; students read theirs and mark them read.
-- * Group photos must be the uploader's own "group-" files.
--
-- Idempotent: safe to run more than once.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- More about a group
-- -----------------------------------------------------------------------------

alter table public.groups
  add column if not exists budget_min integer check (budget_min is null or budget_min between 1000 and 200000),
  add column if not exists housing_status text
    check (housing_status is null or housing_status in ('has_accommodation', 'needs_accommodation')),
  add column if not exists room_preference text
    check (room_preference is null or room_preference in ('private', 'shared', 'either')),
  add column if not exists lifestyle_notes text
    check (lifestyle_notes is null or char_length(lifestyle_notes) between 1 and 500);

alter table public.groups drop constraint if exists groups_budget_range;
alter table public.groups
  add constraint groups_budget_range check (budget_min is null or budget_max is null or budget_min <= budget_max);

grant insert (budget_min, housing_status, room_preference, lifestyle_notes) on public.groups to authenticated;
grant update (budget_min, housing_status, room_preference, lifestyle_notes) on public.groups to authenticated;

-- Group photos: the uploader's own "group-" files (or the photo it had).
create or replace function public.check_group_avatar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or new.avatar_url is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.avatar_url is not distinct from old.avatar_url then
    return new;
  end if;
  if new.avatar_url !~ ('^https?://[^/]+/storage/v1/object/public/roomie-media/'
                         || (select auth.uid())::text || '/group-[A-Za-z0-9._-]+$') then
    raise exception 'Group photos must be your own uploads.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists groups_check_avatar on public.groups;
create trigger groups_check_avatar
  before insert or update of avatar_url on public.groups
  for each row execute function public.check_group_avatar();

revoke execute on function public.check_group_avatar() from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- Messages and cancelled invitations
-- -----------------------------------------------------------------------------

alter table public.group_members
  add column if not exists message text check (message is null or char_length(message) between 1 and 300);

alter table public.group_members drop constraint if exists group_members_status_check;
alter table public.group_members
  add constraint group_members_status_check
  check (status in ('invited', 'requested', 'active', 'declined', 'left', 'removed', 'cancelled'));


-- -----------------------------------------------------------------------------
-- Blocks between a student and anyone active in a group
-- -----------------------------------------------------------------------------
-- Internal only (13's is_blocked_pair is internal too).

create or replace function public.blocked_with_group(p_group uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members as m
    join public.blocks as b
      on (b.blocker_id = m.profile_id and b.blocked_id = p_profile)
      or (b.blocker_id = p_profile and b.blocked_id = m.profile_id)
    where m.group_id = p_group and m.status = 'active' and m.profile_id <> p_profile
  );
$$;

revoke execute on function public.blocked_with_group(uuid, uuid) from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- Membership functions with messages and block checks
-- -----------------------------------------------------------------------------
-- Same names and behaviour as 010/011, plus an optional message (so
-- existing calls keep working) and the block check.

drop function if exists public.request_to_join_group(uuid);
create or replace function public.request_to_join_group(p_group uuid, p_message text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  grp public.groups%rowtype;
  current_status text;
  note text := nullif(btrim(coalesce(p_message, '')), '');
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if not public.is_verified_student() then
    raise exception 'Only verified SRM students can join groups.' using errcode = '42501';
  end if;
  if char_length(note) > 300 then
    raise exception 'Keep your message to 300 characters.' using errcode = 'check_violation';
  end if;

  select * into grp from public.groups where id = p_group for update;
  if not found or grp.status = 'archived' then
    raise exception 'That group isn''t available.' using errcode = 'P0002';
  end if;

  select status into current_status
  from public.group_members
  where group_id = p_group and profile_id = me
  for update;

  if current_status in ('active', 'requested') then
    return current_status;
  end if;
  if current_status = 'removed' then
    raise exception 'You can''t rejoin this group.' using errcode = '42501';
  end if;
  if public.blocked_with_group(p_group, me) then
    raise exception 'That group isn''t available.' using errcode = 'P0002';
  end if;
  if current_status = 'invited' then
    -- They invited you and you want in: that's a yes.
    if not public.group_has_room(p_group) then
      raise exception 'This group is full.' using errcode = 'check_violation';
    end if;
    update public.group_members
    set status = 'active', joined_at = now()
    where group_id = p_group and profile_id = me;
    return 'active';
  end if;

  if not grp.is_discoverable then
    raise exception 'This group is invite-only.' using errcode = '42501';
  end if;
  if grp.status <> 'forming' then
    raise exception 'This group isn''t taking new members.' using errcode = 'check_violation';
  end if;
  if not public.group_has_room(p_group) then
    raise exception 'This group is full.' using errcode = 'check_violation';
  end if;

  insert into public.group_members (group_id, profile_id, role, status, message)
  values (p_group, me, 'member', 'requested', note)
  on conflict (group_id, profile_id) do update
    set status = 'requested', role = 'member', invited_by = null, joined_at = null, message = note;
  return 'requested';
end;
$$;

drop function if exists public.invite_to_group(uuid, uuid);
create or replace function public.invite_to_group(p_group uuid, p_profile uuid, p_message text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  grp public.groups%rowtype;
  current_status text;
  note text := nullif(btrim(coalesce(p_message, '')), '');
begin
  if not public.is_group_admin(p_group) or not public.is_eligible_student() then
    raise exception 'Only a group admin can invite students.' using errcode = '42501';
  end if;
  if p_profile = me then
    raise exception 'You''re already in this group.' using errcode = 'check_violation';
  end if;
  if char_length(note) > 300 then
    raise exception 'Keep your message to 300 characters.' using errcode = 'check_violation';
  end if;
  if not public.is_eligible_account(p_profile) then
    raise exception 'Only verified SRM students can be invited.' using errcode = '42501';
  end if;
  if public.is_blocked_pair(me, p_profile) or public.blocked_with_group(p_group, p_profile) then
    raise exception 'This student can''t be invited.' using errcode = '42501';
  end if;

  select * into grp from public.groups where id = p_group for update;
  if grp.status = 'archived' then
    raise exception 'That group is closed.' using errcode = 'check_violation';
  end if;

  select status into current_status
  from public.group_members
  where group_id = p_group and profile_id = p_profile
  for update;

  if current_status in ('active', 'invited') then
    return current_status;
  end if;
  if not public.group_has_room(p_group) then
    raise exception 'This group is full.' using errcode = 'check_violation';
  end if;
  if current_status = 'requested' then
    -- They asked to join and you're inviting them: that's a yes.
    update public.group_members
    set status = 'active', joined_at = now(), invited_by = me
    where group_id = p_group and profile_id = p_profile;
    return 'active';
  end if;

  insert into public.group_members (group_id, profile_id, role, status, invited_by, message)
  values (p_group, p_profile, 'member', 'invited', me, note)
  on conflict (group_id, profile_id) do update
    set status = 'invited', role = 'member', invited_by = me, joined_at = null, message = note;
  return 'invited';
end;
$$;

-- Withdraw an invitation that hasn't been answered (admins). The student
-- may be invited again later, unlike a removal.
create or replace function public.cancel_group_invite(p_group uuid, p_profile uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status text;
begin
  if not public.is_group_admin(p_group) then
    raise exception 'Only a group admin can cancel invitations.' using errcode = '42501';
  end if;
  perform 1 from public.groups where id = p_group for update;
  select status into current_status
  from public.group_members
  where group_id = p_group and profile_id = p_profile
  for update;
  if current_status is distinct from 'invited' then
    raise exception 'There''s no open invitation for this student.' using errcode = 'P0002';
  end if;
  update public.group_members set status = 'cancelled'
  where group_id = p_group and profile_id = p_profile;
  return 'cancelled';
end;
$$;

revoke execute on function public.request_to_join_group(uuid, text) from public, anon;
revoke execute on function public.invite_to_group(uuid, uuid, text) from public, anon;
revoke execute on function public.cancel_group_invite(uuid, uuid) from public, anon;
grant execute on function public.request_to_join_group(uuid, text) to authenticated;
grant execute on function public.invite_to_group(uuid, uuid, text) to authenticated;
grant execute on function public.cancel_group_invite(uuid, uuid) to authenticated;


-- -----------------------------------------------------------------------------
-- search_students_for_group(): who an admin may invite
-- -----------------------------------------------------------------------------
-- Eligible SRM students whose name matches, never yourself, and never
-- anyone across a block with you or with an active member. Public profile
-- fields only, plus their current standing with the group.

create or replace function public.search_students_for_group(p_group uuid, p_query text, p_limit integer default 20)
returns table (
  profile_id      uuid,
  full_name       text,
  avatar_url      text,
  department      text,
  year_of_study   smallint,
  about           text,
  membership      text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  me uuid := (select auth.uid());
  term text := btrim(coalesce(p_query, ''));
begin
  if not public.is_group_admin(p_group) or not public.is_eligible_student() then
    raise exception 'Only a group admin can search for students to invite.' using errcode = '42501';
  end if;
  if char_length(term) < 2 then
    return;
  end if;
  term := replace(replace(replace(term, '\', '\\'), '%', '\%'), '_', '\_');

  return query
  select p.id, p.full_name, p.avatar_url, p.department, p.year_of_study::smallint, p.about, m.status
  from public.profiles as p
  join auth.users as u on u.id = p.id
  left join public.group_members as m on m.group_id = p_group and m.profile_id = p.id
  where p.id <> me
    and p.full_name ilike '%' || term || '%'
    and public.is_srm_email(u.email) and u.email_confirmed_at is not null
    and (u.banned_until is null or u.banned_until < now())
    and u.deleted_at is null
    and not public.is_blocked_pair(me, p.id)
    and not public.blocked_with_group(p_group, p.id)
  order by (m.status = 'active') nulls first, p.full_name
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

revoke execute on function public.search_students_for_group(uuid, text, integer) from public, anon;
grant execute on function public.search_students_for_group(uuid, text, integer) to authenticated;


-- -----------------------------------------------------------------------------
-- discover_groups(): groups the signed-in student can browse
-- -----------------------------------------------------------------------------
-- Discoverable groups that are forming or searching, without anyone the
-- student has a block with. Filters (all optional) only remove a group
-- whose details clearly conflict; a group that hasn't said still shows:
--   {"societies": [...], "budget_min": 6000, "budget_max": 15000,
--    "move_in": "july", "sizes": [3, 4], "housing": "needs_accommodation",
--    "has_room": true}

create or replace function public.discover_groups(p_filters jsonb default '{}'::jsonb, p_limit integer default 100)
returns table (
  group_id      uuid,
  member_count  integer,
  my_status     text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  me uuid := (select auth.uid());
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  f_societies text[];
  f_sizes integer[];
  f_min integer;
  f_max integer;
  f_move text;
  f_housing text;
  f_room boolean;
begin
  if me is null or not public.is_eligible_student() then
    raise exception 'Only signed-in SRM students can browse groups.' using errcode = '42501';
  end if;
  if jsonb_typeof(f) <> 'object' then
    raise exception 'Filters must be an object.' using errcode = '22023';
  end if;
  f_societies := case when jsonb_typeof(f -> 'societies') = 'array'
    then array(select jsonb_array_elements_text(f -> 'societies')) else '{}' end;
  f_sizes := case when jsonb_typeof(f -> 'sizes') = 'array'
    then array(select (v)::integer from jsonb_array_elements_text(f -> 'sizes') as v where v ~ '^\d{1,2}$')
    else '{}' end;
  f_min := case when (f ->> 'budget_min') ~ '^\d{1,6}$' then (f ->> 'budget_min')::integer end;
  f_max := case when (f ->> 'budget_max') ~ '^\d{1,6}$' then (f ->> 'budget_max')::integer end;
  f_move := case when f ->> 'move_in' in ('immediate', 'next_month', 'next_semester', 'july')
    then f ->> 'move_in' end;
  f_housing := case when f ->> 'housing' in ('has_accommodation', 'needs_accommodation')
    then f ->> 'housing' end;
  f_room := coalesce(f ->> 'has_room' = 'true', false);

  return query
  with counted as (
    select g.*,
      (select count(*)::integer from public.group_members as m
       where m.group_id = g.id and m.status = 'active') as members,
      (select m.status from public.group_members as m
       where m.group_id = g.id and m.profile_id = me) as mine
    from public.groups as g
    where g.is_discoverable and g.status in ('forming', 'searching')
      and not public.blocked_with_group(g.id, me)
  )
  select c.id, c.members, c.mine
  from counted as c
  where (cardinality(f_societies) = 0 or cardinality(c.preferred_societies) = 0
         or c.preferred_societies && f_societies)
    and (f_max is null or c.budget_min is null or c.budget_min <= f_max)
    and (f_min is null or c.budget_max is null or c.budget_max >= f_min)
    and (f_move is null or c.move_in_timeframe is null or c.move_in_timeframe in (f_move, 'flexible'))
    and (cardinality(f_sizes) = 0 or c.max_members = any (f_sizes))
    and (f_housing is null or c.housing_status is null or c.housing_status = f_housing)
    and (not f_room or c.members < c.max_members)
  order by (c.mine = 'active') nulls first, c.updated_at desc, c.id
  limit least(greatest(coalesce(p_limit, 100), 1), 200);
end;
$$;

revoke execute on function public.discover_groups(jsonb, integer) from public, anon;
grant execute on function public.discover_groups(jsonb, integer) to authenticated;


-- -----------------------------------------------------------------------------
-- group_events (audit log) and notifications
-- -----------------------------------------------------------------------------

create table if not exists public.group_events (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups (id) on delete cascade,
  -- Kept for the notification text even if the group is renamed or hidden.
  group_name  text not null,
  -- Whose membership changed, and who did it.
  subject_id  uuid references public.profiles (id) on delete set null,
  actor_id    uuid references public.profiles (id) on delete set null,
  kind        text not null check (kind in (
                'created', 'invited', 'invite_accepted', 'invite_declined', 'invite_cancelled',
                'requested', 'request_approved', 'request_declined', 'request_withdrawn',
                'member_left', 'member_removed', 'role_changed')),
  -- The invitation / request message, or the new role.
  detail      text,
  created_at  timestamptz not null default now()
);

create index if not exists group_events_group_idx on public.group_events (group_id, created_at desc);

create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  event_id     uuid not null references public.group_events (id) on delete cascade,
  read_at      timestamptz,
  created_at   timestamptz not null default now(),
  constraint notifications_once unique (recipient_id, event_id)
);

create index if not exists notifications_recipient_idx on public.notifications (recipient_id, created_at desc);

-- Written only by the database (the trigger below).
revoke all on public.group_events, public.notifications from anon, authenticated;
grant select on public.group_events, public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

alter table public.group_events enable row level security;
alter table public.notifications enable row level security;

drop policy if exists "notifications: recipients read theirs" on public.notifications;
create policy "notifications: recipients read theirs"
  on public.notifications for select to authenticated
  using (recipient_id = (select auth.uid()));

drop policy if exists "notifications: recipients mark theirs read" on public.notifications;
create policy "notifications: recipients mark theirs read"
  on public.notifications for update to authenticated
  using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));

-- Admins see their group's history; anyone sees events about them, events
-- they caused, and events they were notified about.
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

-- Record each membership change and tell the right people (never the
-- person who did it).
create or replace function public.record_group_membership_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  before_status text := case when tg_op = 'INSERT' then null else old.status end;
  event_kind text;
  tell text;   -- 'subject' or 'admins'
  note text;
  event_id uuid;
  name text;
begin
  if new.status is distinct from before_status then
    if new.status = 'active' and before_status is null then
      event_kind := 'created';                       -- the creator joining their new group
    elsif new.status = 'invited' then
      event_kind := 'invited'; tell := 'subject'; note := new.message;
    elsif new.status = 'requested' then
      event_kind := 'requested'; tell := 'admins'; note := new.message;
    elsif new.status = 'active' and before_status = 'invited' then
      event_kind := 'invite_accepted'; tell := 'admins';
    elsif new.status = 'active' and before_status = 'requested' then
      event_kind := 'request_approved'; tell := 'subject';
    elsif new.status = 'declined' and before_status = 'invited' then
      event_kind := 'invite_declined'; tell := 'admins';
    elsif new.status = 'declined' and before_status = 'requested' then
      event_kind := 'request_declined'; tell := 'subject';
    elsif new.status = 'cancelled' then
      event_kind := 'invite_cancelled'; tell := 'subject';
    elsif new.status = 'left' and before_status = 'requested' then
      event_kind := 'request_withdrawn';
    elsif new.status = 'left' then
      event_kind := 'member_left'; tell := 'admins';
    elsif new.status = 'removed' then
      event_kind := 'member_removed'; tell := 'subject';
    end if;
  elsif tg_op = 'UPDATE' and new.role is distinct from old.role and new.status = 'active' then
    event_kind := 'role_changed'; tell := 'subject'; note := new.role;
  end if;

  if event_kind is null then
    return null;
  end if;

  select g.name into name from public.groups as g where g.id = new.group_id;
  insert into public.group_events (group_id, group_name, subject_id, actor_id, kind, detail)
  values (new.group_id, coalesce(name, 'A group'), new.profile_id, actor, event_kind, note)
  returning id into event_id;

  if tell = 'subject' then
    insert into public.notifications (recipient_id, event_id)
    select new.profile_id, event_id
    where new.profile_id is distinct from actor
    on conflict do nothing;
  elsif tell = 'admins' then
    insert into public.notifications (recipient_id, event_id)
    select m.profile_id, event_id
    from public.group_members as m
    where m.group_id = new.group_id and m.status = 'active' and m.role = 'admin'
      and m.profile_id <> new.profile_id
      and m.profile_id is distinct from actor
    on conflict do nothing;
  end if;
  return null;
end;
$$;

drop trigger if exists group_members_record_event on public.group_members;
create trigger group_members_record_event
  after insert or update on public.group_members
  for each row execute function public.record_group_membership_event();

revoke execute on function public.record_group_membership_event() from public, anon, authenticated;
