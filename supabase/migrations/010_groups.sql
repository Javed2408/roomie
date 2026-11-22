-- =============================================================================
-- Roomie 010: group foundations.
--
-- Students can team up to find (or fill) a flat together.
--   * groups         name, description, photo, creator, requirements,
--                    housing preferences, status, discoverability
--   * group_members  who is in a group, their role (admin = the group's
--                    representative, or member) and membership status:
--                    invited | requested | active | declined | left | removed
--
-- Nobody can add themselves to a group. Membership only changes through the
-- functions below, which check who is asking:
--   request_to_join_group   a student asks to join (an admin must approve)
--   review_join_request     an admin approves or declines a request
--   invite_to_group         an admin invites a student (who must accept)
--   respond_to_group_invite the invited student accepts or declines
--   leave_group             leave (or withdraw a request); admin role passes on
--   remove_group_member     an admin removes a member or cancels an invite
--   set_group_member_role   an admin promotes or demotes a member
-- Creating a group makes its creator the first admin automatically.
-- Only verified SRM students can create, join or be invited to groups.
--
-- Ready for later phases: group discovery (discoverable groups are readable
-- by every signed-in student), invitations and join requests (the statuses
-- above), and group chat (is_group_member() is the check its policies need).
-- No group UI is part of this phase.
--
-- Idempotent: safe to run more than once.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table if not exists public.groups (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (char_length(btrim(name)) between 2 and 60),
  description         text check (description is null or char_length(description) between 1 and 500),
  avatar_url          text check (avatar_url is null or char_length(avatar_url) between 1 and 500),
  -- Kept when the creator's account is deleted, so the group survives.
  created_by          uuid references public.profiles (id) on delete set null,
  -- Who the group is looking for.
  max_members         smallint not null default 4 check (max_members between 2 and 10),
  preferred_gender    text not null default 'any' check (preferred_gender in ('any', 'male', 'female')),
  requirements        text check (requirements is null or char_length(requirements) between 1 and 500),
  -- Where and how the group wants to live (per person, whole rupees).
  preferred_societies text[] not null default '{}' check (
                        preferred_societies <@ array[
                          'Abode Valley', 'Estancia', 'Akshaya', 'Green Pearl',
                          'Potheri Independent', 'Other']::text[]
                        and cardinality(preferred_societies) <= 6),
  budget_max          integer check (budget_max between 1000 and 200000),
  move_in_timeframe   text check (move_in_timeframe in
                        ('immediate', 'next_month', 'next_semester', 'july', 'flexible')),
  preferred_bhk_types text[] not null default '{}'
                      check (preferred_bhk_types <@ array['1BHK', '2BHK', '3BHK', '4BHK']::text[]),
  -- forming: looking for members; searching: complete, looking for a flat;
  -- housed: found one; archived: closed.
  status              text not null default 'forming'
                      check (status in ('forming', 'searching', 'housed', 'archived')),
  is_discoverable     boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists groups_discoverable_idx
  on public.groups (status, created_at desc) where is_discoverable;
create index if not exists groups_created_by_idx on public.groups (created_by);

drop trigger if exists groups_set_updated_at on public.groups;
create trigger groups_set_updated_at
  before update on public.groups
  for each row execute function public.set_updated_at();

create table if not exists public.group_members (
  group_id   uuid not null references public.groups (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  role       text not null default 'member' check (role in ('admin', 'member')),
  status     text not null
             check (status in ('invited', 'requested', 'active', 'declined', 'left', 'removed')),
  invited_by uuid references public.profiles (id) on delete set null,
  joined_at  timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (group_id, profile_id),
  -- Only active members can be admins, and active members have a join time.
  constraint group_members_admins_are_active check (role = 'member' or status = 'active'),
  constraint group_members_active_have_joined check (status <> 'active' or joined_at is not null)
);

create index if not exists group_members_profile_idx on public.group_members (profile_id, status);

drop trigger if exists group_members_set_updated_at on public.group_members;
create trigger group_members_set_updated_at
  before update on public.group_members
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- Helper checks (used by the policies and functions)
-- -----------------------------------------------------------------------------

-- The signed-in student has a confirmed @srmist.edu.in address.
create or replace function public.is_verified_student()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select is_srm_verified from public.profiles where id = (select auth.uid())),
    false
  );
$$;

-- The signed-in student is an active member of the group.
create or replace function public.is_group_member(p_group uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.group_members
    where group_id = p_group and profile_id = (select auth.uid()) and status = 'active'
  );
$$;

-- The signed-in student is an active admin of the group.
create or replace function public.is_group_admin(p_group uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.group_members
    where group_id = p_group and profile_id = (select auth.uid())
      and status = 'active' and role = 'admin'
  );
$$;

-- The signed-in student is in, invited to, or asking to join the group.
create or replace function public.is_group_involved(p_group uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.group_members
    where group_id = p_group and profile_id = (select auth.uid())
      and status in ('active', 'invited', 'requested')
  );
$$;

-- Internal: room for one more active member? (Callers lock the group row.)
create or replace function public.group_has_room(p_group uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select count(*) from public.group_members
          where group_id = p_group and status = 'active')
       < (select max_members from public.groups where id = p_group);
$$;


-- -----------------------------------------------------------------------------
-- Automatic rules
-- -----------------------------------------------------------------------------

-- The creator becomes the first admin.
create or replace function public.add_group_creator_as_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by is not null then
    insert into public.group_members (group_id, profile_id, role, status, joined_at)
    values (new.id, new.created_by, 'admin', 'active', now())
    on conflict (group_id, profile_id) do nothing;
  end if;
  return null;
end;
$$;

drop trigger if exists groups_add_creator on public.groups;
create trigger groups_add_creator
  after insert on public.groups
  for each row execute function public.add_group_creator_as_admin();

-- A group can't shrink below the members it already has.
create or replace function public.check_group_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.max_members < (select count(*) from public.group_members
                        where group_id = new.id and status = 'active') then
    raise exception 'The group already has more members than that.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists groups_check_capacity on public.groups;
create trigger groups_check_capacity
  before update of max_members on public.groups
  for each row execute function public.check_group_capacity();


-- -----------------------------------------------------------------------------
-- Membership functions (the only way to change membership)
-- -----------------------------------------------------------------------------

create or replace function public.request_to_join_group(p_group uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  grp public.groups%rowtype;
  current_status text;
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if not public.is_verified_student() then
    raise exception 'Only verified SRM students can join groups.' using errcode = '42501';
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

  insert into public.group_members (group_id, profile_id, role, status)
  values (p_group, me, 'member', 'requested')
  on conflict (group_id, profile_id) do update
    set status = 'requested', role = 'member', invited_by = null, joined_at = null;
  return 'requested';
end;
$$;

create or replace function public.review_join_request(p_group uuid, p_profile uuid, p_approve boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status text;
begin
  if not public.is_group_admin(p_group) then
    raise exception 'Only a group admin can answer join requests.' using errcode = '42501';
  end if;
  perform 1 from public.groups where id = p_group for update;

  select status into current_status
  from public.group_members
  where group_id = p_group and profile_id = p_profile
  for update;
  if current_status is distinct from 'requested' then
    raise exception 'There''s no join request from this student.' using errcode = 'P0002';
  end if;

  if not p_approve then
    update public.group_members set status = 'declined'
    where group_id = p_group and profile_id = p_profile;
    return 'declined';
  end if;
  if not public.group_has_room(p_group) then
    raise exception 'This group is full.' using errcode = 'check_violation';
  end if;
  update public.group_members set status = 'active', joined_at = now()
  where group_id = p_group and profile_id = p_profile;
  return 'active';
end;
$$;

create or replace function public.invite_to_group(p_group uuid, p_profile uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  grp public.groups%rowtype;
  current_status text;
begin
  if not public.is_group_admin(p_group) then
    raise exception 'Only a group admin can invite students.' using errcode = '42501';
  end if;
  if p_profile = me then
    raise exception 'You''re already in this group.' using errcode = 'check_violation';
  end if;
  if not coalesce((select is_srm_verified from public.profiles where id = p_profile), false) then
    raise exception 'Only verified SRM students can be invited.' using errcode = '42501';
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

  insert into public.group_members (group_id, profile_id, role, status, invited_by)
  values (p_group, p_profile, 'member', 'invited', me)
  on conflict (group_id, profile_id) do update
    set status = 'invited', role = 'member', invited_by = me, joined_at = null;
  return 'invited';
end;
$$;

create or replace function public.respond_to_group_invite(p_group uuid, p_accept boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  current_status text;
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  perform 1 from public.groups where id = p_group for update;

  select status into current_status
  from public.group_members
  where group_id = p_group and profile_id = me
  for update;
  if current_status is distinct from 'invited' then
    raise exception 'There''s no invitation to answer.' using errcode = 'P0002';
  end if;

  if not p_accept then
    update public.group_members set status = 'declined'
    where group_id = p_group and profile_id = me;
    return 'declined';
  end if;
  if not public.is_verified_student() then
    raise exception 'Only verified SRM students can join groups.' using errcode = '42501';
  end if;
  if not public.group_has_room(p_group) then
    raise exception 'This group is full.' using errcode = 'check_violation';
  end if;
  update public.group_members set status = 'active', joined_at = now()
  where group_id = p_group and profile_id = me;
  return 'active';
end;
$$;

create or replace function public.leave_group(p_group uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  current_status text;
  member_role text;
  successor uuid;
begin
  perform 1 from public.groups where id = p_group for update;

  select status, role into current_status, member_role
  from public.group_members
  where group_id = p_group and profile_id = me
  for update;
  if current_status is null or current_status not in ('active', 'requested') then
    raise exception 'You''re not in this group.' using errcode = 'P0002';
  end if;

  update public.group_members set status = 'left', role = 'member'
  where group_id = p_group and profile_id = me;

  if current_status = 'active' and member_role = 'admin'
     and not exists (select 1 from public.group_members
                     where group_id = p_group and status = 'active' and role = 'admin') then
    -- The group keeps a representative: the longest-standing member.
    select profile_id into successor
    from public.group_members
    where group_id = p_group and status = 'active'
    order by joined_at, profile_id
    limit 1;

    if successor is null then
      update public.groups set status = 'archived' where id = p_group;
    else
      update public.group_members set role = 'admin'
      where group_id = p_group and profile_id = successor;
    end if;
  end if;
  return 'left';
end;
$$;

create or replace function public.remove_group_member(p_group uuid, p_profile uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status text;
begin
  if not public.is_group_admin(p_group) then
    raise exception 'Only a group admin can remove members.' using errcode = '42501';
  end if;
  if p_profile = (select auth.uid()) then
    raise exception 'To leave the group yourself, use leave_group.' using errcode = 'check_violation';
  end if;
  perform 1 from public.groups where id = p_group for update;

  select status into current_status
  from public.group_members
  where group_id = p_group and profile_id = p_profile
  for update;
  if current_status is null or current_status not in ('active', 'invited', 'requested') then
    raise exception 'That student isn''t in this group.' using errcode = 'P0002';
  end if;

  update public.group_members set status = 'removed', role = 'member'
  where group_id = p_group and profile_id = p_profile;
  return 'removed';
end;
$$;

create or replace function public.set_group_member_role(p_group uuid, p_profile uuid, p_role text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status text;
  member_role text;
begin
  if not public.is_group_admin(p_group) then
    raise exception 'Only a group admin can change roles.' using errcode = '42501';
  end if;
  if p_role not in ('admin', 'member') then
    raise exception 'Unknown role.' using errcode = 'check_violation';
  end if;
  perform 1 from public.groups where id = p_group for update;

  select status, role into current_status, member_role
  from public.group_members
  where group_id = p_group and profile_id = p_profile
  for update;
  if current_status is distinct from 'active' then
    raise exception 'Only active members can have a role.' using errcode = 'P0002';
  end if;
  if member_role = 'admin' and p_role = 'member'
     and (select count(*) from public.group_members
          where group_id = p_group and status = 'active' and role = 'admin') <= 1 then
    raise exception 'A group needs at least one admin.' using errcode = 'check_violation';
  end if;

  update public.group_members set role = p_role
  where group_id = p_group and profile_id = p_profile;
  return p_role;
end;
$$;


-- -----------------------------------------------------------------------------
-- Function privileges
-- -----------------------------------------------------------------------------

revoke execute on function public.add_group_creator_as_admin() from public, anon, authenticated;
revoke execute on function public.check_group_capacity() from public, anon, authenticated;
revoke execute on function public.group_has_room(uuid) from public, anon, authenticated;

revoke execute on function public.is_verified_student() from public, anon;
revoke execute on function public.is_group_member(uuid) from public, anon;
revoke execute on function public.is_group_admin(uuid) from public, anon;
revoke execute on function public.is_group_involved(uuid) from public, anon;
revoke execute on function public.request_to_join_group(uuid) from public, anon;
revoke execute on function public.review_join_request(uuid, uuid, boolean) from public, anon;
revoke execute on function public.invite_to_group(uuid, uuid) from public, anon;
revoke execute on function public.respond_to_group_invite(uuid, boolean) from public, anon;
revoke execute on function public.leave_group(uuid) from public, anon;
revoke execute on function public.remove_group_member(uuid, uuid) from public, anon;
revoke execute on function public.set_group_member_role(uuid, uuid, text) from public, anon;

grant execute on function public.is_verified_student() to authenticated;
grant execute on function public.is_group_member(uuid) to authenticated;
grant execute on function public.is_group_admin(uuid) to authenticated;
grant execute on function public.is_group_involved(uuid) to authenticated;
grant execute on function public.request_to_join_group(uuid) to authenticated;
grant execute on function public.review_join_request(uuid, uuid, boolean) to authenticated;
grant execute on function public.invite_to_group(uuid, uuid) to authenticated;
grant execute on function public.respond_to_group_invite(uuid, boolean) to authenticated;
grant execute on function public.leave_group(uuid) to authenticated;
grant execute on function public.remove_group_member(uuid, uuid) to authenticated;
grant execute on function public.set_group_member_role(uuid, uuid, text) to authenticated;


-- -----------------------------------------------------------------------------
-- Table privileges and row-level security
-- -----------------------------------------------------------------------------

revoke all on public.groups, public.group_members from anon, authenticated;
grant select on public.groups, public.group_members to authenticated;
grant insert (name, description, avatar_url, created_by, max_members, preferred_gender,
              requirements, preferred_societies, budget_max, move_in_timeframe,
              preferred_bhk_types, is_discoverable)
  on public.groups to authenticated;
grant update (name, description, avatar_url, max_members, preferred_gender, requirements,
              preferred_societies, budget_max, move_in_timeframe, preferred_bhk_types,
              status, is_discoverable)
  on public.groups to authenticated;
-- No direct writes to group_members at all: only the functions above.

alter table public.groups enable row level security;
alter table public.group_members enable row level security;

-- Discoverable, open groups for everyone signed in; private or closed ones
-- only for people involved in them. (The creator check matters at creation
-- time: Postgres checks this rule on the new row before the trigger above
-- has added the creator as admin.)
drop policy if exists "groups: discoverable or involved" on public.groups;
create policy "groups: discoverable or involved"
  on public.groups for select to authenticated
  using (
    (is_discoverable and status <> 'archived')
    or public.is_group_involved(id)
    or created_by = (select auth.uid())
  );

drop policy if exists "groups: verified students create" on public.groups;
create policy "groups: verified students create"
  on public.groups for insert to authenticated
  with check (created_by = (select auth.uid()) and public.is_verified_student());

drop policy if exists "groups: admins update" on public.groups;
create policy "groups: admins update"
  on public.groups for update to authenticated
  using (public.is_group_admin(id))
  with check (public.is_group_admin(id));

-- Your own memberships; everything in groups you belong to; and who is in
-- a discoverable group (active members only, never pending requests).
drop policy if exists "group_members: own, own groups, or public roster" on public.group_members;
create policy "group_members: own, own groups, or public roster"
  on public.group_members for select to authenticated
  using (
    profile_id = (select auth.uid())
    or public.is_group_member(group_id)
    or (
      status = 'active'
      and exists (
        select 1 from public.groups g
        where g.id = group_id and g.is_discoverable and g.status <> 'archived'
      )
    )
  );
