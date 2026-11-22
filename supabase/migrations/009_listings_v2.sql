-- =============================================================================
-- Roomie 009: accommodation listings as independent, richer entities.
--
-- * New details: description, available rooms, existing flatmates, move-in
--   date, preferred flatmate gender and notes, and updated_at.
--   (Unchanged: society, rent, maintenance, deposit, setup cost, vacant
--   spots = available occupancy, amenities, photos, is_active.)
-- * Several listings per student are now allowed (e.g. a deactivated old
--   one and a new one). At most ONE can be live at a time, which keeps
--   discovery about people, not about one person's many adverts.
--   Replaces the unique index "one listing per owner" from 002.
-- * Up to 10 listings per student, to stop spam.
-- * Only a student whose housing status is "has accommodation" can create
--   or reactivate a listing; anyone can deactivate their own at any time,
--   which never touches their profile.
-- * Students can no longer write ids, owners or timestamps directly.
--
-- Existing listings are kept as they are; new columns get safe defaults.
-- APP ORDER: the app must stop using upsert(onConflict: "owner_id") before
-- this runs (done in the same release as this migration).
--
-- Idempotent: safe to run more than once.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- New columns (existing rows get the defaults)
-- -----------------------------------------------------------------------------

alter table public.listings
  add column if not exists description text
    check (description is null or char_length(description) between 1 and 1000),
  add column if not exists available_rooms smallint not null default 1
    check (available_rooms between 1 and 10),
  add column if not exists current_flatmates smallint not null default 0
    check (current_flatmates between 0 and 10),
  -- NULL means available now.
  add column if not exists available_from date,
  add column if not exists preferred_flatmate_gender text not null default 'any'
    check (preferred_flatmate_gender in ('any', 'male', 'female')),
  add column if not exists flatmate_preferences text
    check (flatmate_preferences is null or char_length(flatmate_preferences) between 1 and 300);

-- updated_at: existing listings start at their creation time.
alter table public.listings add column if not exists updated_at timestamptz;
update public.listings set updated_at = created_at where updated_at is null;
alter table public.listings
  alter column updated_at set default now(),
  alter column updated_at set not null;

drop trigger if exists listings_set_updated_at on public.listings;
create trigger listings_set_updated_at
  before update on public.listings
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- Several listings per owner, one of them live
-- -----------------------------------------------------------------------------

create index if not exists listings_owner_id_idx on public.listings (owner_id);
create unique index if not exists listings_one_active_per_owner
  on public.listings (owner_id) where is_active;
drop index if exists public.listings_one_per_owner;

create or replace function public.limit_listings_per_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.listings where owner_id = new.owner_id) >= 10 then
    raise exception 'You can keep up to 10 listings. Delete an old one first.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists listings_limit_per_owner on public.listings;
create trigger listings_limit_per_owner
  before insert on public.listings
  for each row execute function public.limit_listings_per_owner();

revoke execute on function public.limit_listings_per_owner() from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- Who may do what
-- -----------------------------------------------------------------------------

-- True when the signed-in student currently has accommodation.
create or replace function public.has_accommodation()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.housing_status
    where profile_id = (select auth.uid()) and status = 'has_accommodation'
  );
$$;

revoke execute on function public.has_accommodation() from public, anon;
grant execute on function public.has_accommodation() to authenticated;

revoke all on public.listings from authenticated;
grant select, delete on public.listings to authenticated;
grant insert (owner_id, society, bhk_type, vacant_spots, rent_per_person,
              maintenance_per_person, deposit_per_person, setup_cost, amenities, photos,
              is_active, description, available_rooms, current_flatmates, available_from,
              preferred_flatmate_gender, flatmate_preferences)
  on public.listings to authenticated;
grant update (society, bhk_type, vacant_spots, rent_per_person,
              maintenance_per_person, deposit_per_person, setup_cost, amenities, photos,
              is_active, description, available_rooms, current_flatmates, available_from,
              preferred_flatmate_gender, flatmate_preferences)
  on public.listings to authenticated;

-- Replaces 001's "flat owners create their own" (which checked profiles.mode).
drop policy if exists "listings: flat owners create their own" on public.listings;
drop policy if exists "listings: students with accommodation create their own" on public.listings;
create policy "listings: students with accommodation create their own"
  on public.listings for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and public.has_accommodation()
  );

-- Owners can always edit or deactivate; going live needs accommodation.
drop policy if exists "listings: owners update their own" on public.listings;
create policy "listings: owners update their own"
  on public.listings for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and (not is_active or public.has_accommodation())
  );
