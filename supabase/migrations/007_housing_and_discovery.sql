-- =============================================================================
-- Roomie 007: housing status and discovery preferences, separate from the
-- profile.
--
-- * housing_status: what a student has right now (a place, or not).
-- * discovery_preferences: whom they want to see (students with a place,
--   students without one, or both) and whether they want one flatmate, a
--   group, or either. Editable at any time, without touching anything else.
--
-- Housing status no longer has to decide discovery. Until the app moves to
-- these tables (Phase 2), the legacy column profiles.mode stays in sync with
-- housing_status in both directions, so existing pages keep working.
-- Existing students get rows that reproduce today's behaviour exactly.
--
-- Idempotent: safe to run more than once.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Mapping between the legacy profiles.mode and the new housing status
-- -----------------------------------------------------------------------------

create or replace function public.housing_status_from_mode(mode text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case mode
    when 'have_flat' then 'has_accommodation'
    when 'need_flat' then 'needs_accommodation'
  end;
$$;

create or replace function public.mode_from_housing_status(status text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case status
    when 'has_accommodation' then 'have_flat'
    when 'needs_accommodation' then 'need_flat'
  end;
$$;

-- Today's behaviour: people with a place see people without one, and the
-- other way round.
create or replace function public.default_discovery_for(status text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case status
    when 'has_accommodation' then 'needs_accommodation'
    when 'needs_accommodation' then 'has_accommodation'
    else 'both'
  end;
$$;


-- -----------------------------------------------------------------------------
-- housing_status: one row per student who has told us
-- -----------------------------------------------------------------------------

create table if not exists public.housing_status (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  status     text not null check (status in ('has_accommodation', 'needs_accommodation')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists housing_status_set_updated_at on public.housing_status;
create trigger housing_status_set_updated_at
  before update on public.housing_status
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- discovery_preferences: whom a student wants to discover
-- -----------------------------------------------------------------------------

create table if not exists public.discovery_preferences (
  profile_id       uuid primary key references public.profiles (id) on delete cascade,
  discover_housing text not null default 'both'
                   check (discover_housing in ('has_accommodation', 'needs_accommodation', 'both')),
  seeking          text not null default 'either'
                   check (seeking in ('flatmate', 'group', 'either')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

drop trigger if exists discovery_preferences_set_updated_at on public.discovery_preferences;
create trigger discovery_preferences_set_updated_at
  before update on public.discovery_preferences
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- Backfill from the legacy profiles.mode (existing data is kept as it is)
-- -----------------------------------------------------------------------------

insert into public.housing_status (profile_id, status)
select id, public.housing_status_from_mode(mode)
from public.profiles
where mode is not null
on conflict (profile_id) do nothing;

insert into public.discovery_preferences (profile_id, discover_housing, seeking)
select profile_id, public.default_discovery_for(status), 'either'
from public.housing_status
on conflict (profile_id) do nothing;


-- -----------------------------------------------------------------------------
-- Keep profiles.mode and housing_status in step (both directions)
-- -----------------------------------------------------------------------------
-- Each side only writes when the value really differs, so the two triggers
-- never bounce back and forth.

create or replace function public.sync_mode_to_housing_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.mode is not null then
    insert into public.housing_status (profile_id, status)
    values (new.id, public.housing_status_from_mode(new.mode))
    on conflict (profile_id) do update
      set status = excluded.status
      where public.housing_status.status is distinct from excluded.status;
  end if;
  return null;
end;
$$;

drop trigger if exists profiles_sync_housing_status on public.profiles;
create trigger profiles_sync_housing_status
  after insert or update of mode on public.profiles
  for each row execute function public.sync_mode_to_housing_status();

create or replace function public.sync_housing_status_to_mode()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set mode = public.mode_from_housing_status(new.status)
  where id = new.profile_id
    and mode is distinct from public.mode_from_housing_status(new.status);

  -- A student's first housing status also gives them discovery
  -- preferences (today's defaults), unless they already chose their own.
  insert into public.discovery_preferences (profile_id, discover_housing)
  values (new.profile_id, public.default_discovery_for(new.status))
  on conflict (profile_id) do nothing;
  return null;
end;
$$;

drop trigger if exists housing_status_sync_mode on public.housing_status;
create trigger housing_status_sync_mode
  after insert or update of status on public.housing_status
  for each row execute function public.sync_housing_status_to_mode();

revoke execute on function public.sync_mode_to_housing_status() from public, anon, authenticated;
revoke execute on function public.sync_housing_status_to_mode() from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- Privileges and row-level security
-- -----------------------------------------------------------------------------
-- Every signed-in student can read both (they describe what someone is
-- looking for, and discovery needs them); only the owner can write.

revoke all on public.housing_status, public.discovery_preferences from anon, authenticated;
grant select on public.housing_status, public.discovery_preferences to authenticated;
grant insert (profile_id, status) on public.housing_status to authenticated;
grant update (status) on public.housing_status to authenticated;
grant insert (profile_id, discover_housing, seeking) on public.discovery_preferences to authenticated;
grant update (discover_housing, seeking) on public.discovery_preferences to authenticated;

alter table public.housing_status enable row level security;
alter table public.discovery_preferences enable row level security;

drop policy if exists "housing_status: signed-in users can read" on public.housing_status;
create policy "housing_status: signed-in users can read"
  on public.housing_status for select to authenticated
  using (true);

drop policy if exists "housing_status: students set their own" on public.housing_status;
create policy "housing_status: students set their own"
  on public.housing_status for insert to authenticated
  with check (profile_id = (select auth.uid()));

drop policy if exists "housing_status: students update their own" on public.housing_status;
create policy "housing_status: students update their own"
  on public.housing_status for update to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

drop policy if exists "discovery_preferences: signed-in users can read" on public.discovery_preferences;
create policy "discovery_preferences: signed-in users can read"
  on public.discovery_preferences for select to authenticated
  using (true);

drop policy if exists "discovery_preferences: students set their own" on public.discovery_preferences;
create policy "discovery_preferences: students set their own"
  on public.discovery_preferences for insert to authenticated
  with check (profile_id = (select auth.uid()));

drop policy if exists "discovery_preferences: students update their own" on public.discovery_preferences;
create policy "discovery_preferences: students update their own"
  on public.discovery_preferences for update to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

-- Retire the legacy column gradually: document what it is now.
comment on column public.profiles.mode is
  'Legacy mirror of housing_status (have_flat = has_accommodation, need_flat = needs_accommodation). Kept in sync by triggers; new code should use housing_status.';
