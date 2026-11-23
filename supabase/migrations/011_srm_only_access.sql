-- =============================================================================
-- Roomie 011: only SRM students can use Roomie.
--
-- 006 stopped new non-SRM sign-ups. Accounts created before that (test
-- accounts with personal emails) still exist. They keep their data (likes,
-- matches and messages are never deleted), but they can no longer use
-- Roomie: no browsing other students, no liking, messaging, editing or
-- uploading. They can still sign in and read their own rows, so the app
-- can explain why.
--
-- Eligibility comes from the login itself, never from the profile badge:
-- the account's email (auth.users) must be @srmist.edu.in AND confirmed.
--
-- Also: practical preferences (budget range, room type, flatmate gender,
-- requirements) become private to their owner. What a profile shows
-- publicly about flat hunting stays on profiles (societies, max budget,
-- move-in), as before.
--
-- Idempotent: safe to run more than once.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Eligibility
-- -----------------------------------------------------------------------------

-- The signed-in account is a confirmed @srmist.edu.in address.
create or replace function public.is_eligible_student()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.users as u
    where u.id = (select auth.uid())
      and public.is_srm_email(u.email)
      and u.email_confirmed_at is not null
  );
$$;

-- The same check for any account (e.g. someone being invited to a group).
create or replace function public.is_eligible_account(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.users as u
    where u.id = p_profile
      and public.is_srm_email(u.email)
      and u.email_confirmed_at is not null
  );
$$;

revoke execute on function public.is_eligible_student() from public, anon;
grant execute on function public.is_eligible_student() to authenticated;
revoke execute on function public.is_eligible_account(uuid) from public, anon, authenticated;

-- 010's group checks used the profile badge; they now use the login.
create or replace function public.is_verified_student()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_eligible_student();
$$;

-- Same as 010, except that the invited student's eligibility now comes
-- from their login rather than their profile badge.
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
  if not public.is_group_admin(p_group) or not public.is_eligible_student() then
    raise exception 'Only a group admin can invite students.' using errcode = '42501';
  end if;
  if p_profile = me then
    raise exception 'You''re already in this group.' using errcode = 'check_violation';
  end if;
  if not public.is_eligible_account(p_profile) then
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


-- -----------------------------------------------------------------------------
-- Policies: reading others needs eligibility; writing always does.
-- Your own rows stay readable. `(select ...)` runs the check once per query.
-- -----------------------------------------------------------------------------

-- profiles
drop policy if exists "profiles: signed-in users can read" on public.profiles;
drop policy if exists "profiles: own, or any for SRM students" on public.profiles;
create policy "profiles: own, or any for SRM students"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_eligible_student()));

drop policy if exists "profiles: users update their own" on public.profiles;
create policy "profiles: users update their own"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()) and (select public.is_eligible_student()))
  with check (id = (select auth.uid()) and (select public.is_eligible_student()));

-- listings
drop policy if exists "listings: read active or own" on public.listings;
create policy "listings: read active or own"
  on public.listings for select to authenticated
  using (owner_id = (select auth.uid()) or (is_active and (select public.is_eligible_student())));

drop policy if exists "listings: students with accommodation create their own" on public.listings;
create policy "listings: students with accommodation create their own"
  on public.listings for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and (select public.is_eligible_student())
    and public.has_accommodation()
  );

drop policy if exists "listings: owners update their own" on public.listings;
create policy "listings: owners update their own"
  on public.listings for update to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_eligible_student()))
  with check (
    owner_id = (select auth.uid())
    and (select public.is_eligible_student())
    and (not is_active or public.has_accommodation())
  );

drop policy if exists "listings: owners delete their own" on public.listings;
create policy "listings: owners delete their own"
  on public.listings for delete to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_eligible_student()));

-- swipes and messages: history stays readable to the people in it; new
-- likes and messages need an eligible account.
drop policy if exists "swipes: send as yourself" on public.swipes;
create policy "swipes: send as yourself"
  on public.swipes for insert to authenticated
  with check (sender_id = (select auth.uid()) and (select public.is_eligible_student()));

drop policy if exists "messages: match members send as themselves" on public.messages;
create policy "messages: match members send as themselves"
  on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and (select public.is_eligible_student())
    and exists (
      select 1 from public.matches as m
      where m.id = match_id and (select auth.uid()) in (m.user_a, m.user_b)
    )
  );

-- Per-student tables from 007 and 008: same rules for each.
do $$
declare
  t text;
  readable text;
begin
  foreach t in array array['housing_status', 'discovery_preferences', 'profile_photos',
                           'profile_interests', 'lifestyle_preferences', 'practical_preferences'] loop
    -- Practical preferences are private to their owner.
    readable := case
      when t = 'practical_preferences' then 'profile_id = (select auth.uid())'
      else 'profile_id = (select auth.uid()) or (select public.is_eligible_student())'
    end;

    execute format('drop policy if exists %I on public.%I', t || ': signed-in users can read', t);
    execute format('drop policy if exists %I on public.%I', t || ': own, or any for SRM students', t);
    execute format('drop policy if exists %I on public.%I', t || ': owner only', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (%s)',
      case when t = 'practical_preferences' then t || ': owner only'
           else t || ': own, or any for SRM students' end,
      t, readable);

    -- Writes: rename-proof (007 and 008 used two naming styles).
    execute format('drop policy if exists %I on public.%I', t || ': students set their own', t);
    execute format('drop policy if exists %I on public.%I', t || ': students add their own', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (profile_id = (select auth.uid()) and (select public.is_eligible_student()))',
      t || ': students add their own', t);

    execute format('drop policy if exists %I on public.%I', t || ': students update their own', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (profile_id = (select auth.uid()) and (select public.is_eligible_student())) with check (profile_id = (select auth.uid()) and (select public.is_eligible_student()))',
      t || ': students update their own', t);

    execute format('drop policy if exists %I on public.%I', t || ': students delete their own', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (profile_id = (select auth.uid()) and (select public.is_eligible_student()))',
      t || ': students delete their own', t);
  end loop;
end;
$$;

-- groups: discovering them needs eligibility too.
drop policy if exists "groups: discoverable or involved" on public.groups;
create policy "groups: discoverable or involved"
  on public.groups for select to authenticated
  using (
    (is_discoverable and status <> 'archived' and (select public.is_eligible_student()))
    or public.is_group_involved(id)
    or created_by = (select auth.uid())
  );

drop policy if exists "group_members: own, own groups, or public roster" on public.group_members;
create policy "group_members: own, own groups, or public roster"
  on public.group_members for select to authenticated
  using (
    profile_id = (select auth.uid())
    or public.is_group_member(group_id)
    or (
      status = 'active'
      and (select public.is_eligible_student())
      and exists (
        select 1 from public.groups g
        where g.id = group_id and g.is_discoverable and g.status <> 'archived'
      )
    )
  );

-- Storage: uploading or replacing photos needs eligibility. Reading and
-- deleting your own files stays possible.
drop policy if exists "roomie-media: upload to own folder" on storage.objects;
create policy "roomie-media: upload to own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'roomie-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.is_eligible_student())
  );

drop policy if exists "roomie-media: replace own files" on storage.objects;
create policy "roomie-media: replace own files"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'roomie-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.is_eligible_student())
  )
  with check (
    bucket_id = 'roomie-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.is_eligible_student())
  );
