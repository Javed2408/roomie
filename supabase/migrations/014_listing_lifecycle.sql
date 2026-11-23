-- =============================================================================
-- Roomie 014: the full listing lifecycle and listing-specific likes.
--
-- * status: 'draft' (never published), 'active' (live) or 'inactive'
--   (deactivated). is_active stays, always equal to status = 'active', so
--   everything built on it (discovery, policies, the one-live-listing
--   index) keeps working. Existing listings: live -> active, hidden ->
--   inactive.
-- * Status changes only through set_listing_status(): publishing while
--   another listing is live is refused with 'conflict' unless the student
--   names that listing to deactivate. Nothing is ever deactivated silently.
-- * More details: locality, location notes, room type, furnishing, house
--   rules and the living arrangement.
-- * listing_private_details: the exact address, readable by the owner only.
-- * Listing photos must be the owner's own "listing-" uploads (checked
--   here, not only in the app), up to 8, no repeats.
-- * swipes.liked_listing_id: which listing a like was about. Filled in for
--   past listing likes where it can be worked out; checked on new likes.
--
-- Idempotent: safe to run more than once.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- New listing details
-- -----------------------------------------------------------------------------

alter table public.listings
  add column if not exists locality text
    check (locality is null or char_length(locality) between 2 and 80),
  add column if not exists location_notes text
    check (location_notes is null or char_length(location_notes) between 1 and 200),
  add column if not exists room_type text
    check (room_type is null or room_type in ('private', 'shared')),
  add column if not exists furnishing text
    check (furnishing is null or furnishing in ('furnished', 'semi_furnished', 'unfurnished')),
  add column if not exists house_rules text
    check (house_rules is null or char_length(house_rules) between 1 and 500),
  add column if not exists living_arrangement text
    check (living_arrangement is null or char_length(living_arrangement) between 1 and 500),
  -- Existing listings were all published at some point, so when the
  -- column is first added they start as 'inactive' (live ones: below).
  add column if not exists status text not null default 'inactive'
    check (status in ('draft', 'active', 'inactive'));

-- (Without touching updated_at: the listings themselves didn't change.)
alter table public.listings disable trigger listings_set_updated_at;
update public.listings set status = 'active' where is_active and status <> 'active';
alter table public.listings enable trigger listings_set_updated_at;
-- From now on a new listing starts as a draft.
alter table public.listings alter column status set default 'draft';

-- Keep status and is_active in step. Whichever one a write changes wins;
-- a listing that has never been published stays a draft when hidden.
-- A listing a student creates always starts as a draft (publishing goes
-- through set_listing_status). Trusted writers with no signed-in user (the
-- seed script, the database owner) may create it live.
create or replace function public.sync_listing_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if (select auth.uid()) is not null then
      new.status := 'draft';
      new.is_active := false;
    elsif new.is_active then
      new.status := 'active';
    elsif new.status = 'active' then
      new.is_active := true;
    end if;
  elsif new.status is distinct from old.status then
    new.is_active := new.status = 'active';
  elsif new.is_active is distinct from old.is_active then
    new.status := case
      when new.is_active then 'active'
      when old.status = 'draft' then 'draft'
      else 'inactive'
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists listings_sync_status on public.listings;
create trigger listings_sync_status
  before insert or update on public.listings
  for each row execute function public.sync_listing_status();

alter table public.listings drop constraint if exists listings_status_matches_active;
alter table public.listings
  add constraint listings_status_matches_active check (is_active = (status = 'active'));


-- -----------------------------------------------------------------------------
-- Listing photos: the owner's own uploads only
-- -----------------------------------------------------------------------------
-- Checked for students (signed-in requests). The seed script and the
-- database owner, which have no signed-in user, are trusted.

create or replace function public.check_listing_photos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  url text;
  own_file text := '^https?://[^/]+/storage/v1/object/public/roomie-media/'
    || new.owner_id::text || '/listing-[A-Za-z0-9._-]+$';
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.photos is not distinct from old.photos then
    return new;
  end if;
  if cardinality(new.photos) > 8 then
    raise exception 'Add up to 8 photos.' using errcode = 'check_violation';
  end if;
  if (select count(distinct u) from unnest(new.photos) as u) <> cardinality(new.photos) then
    raise exception 'The same photo is in there twice.' using errcode = 'check_violation';
  end if;
  foreach url in array new.photos loop
    if url !~ own_file and not (tg_op = 'UPDATE' and url = any (old.photos)) then
      raise exception 'Flat photos must be your own uploads.' using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists listings_check_photos on public.listings;
create trigger listings_check_photos
  before insert or update on public.listings
  for each row execute function public.check_listing_photos();

revoke execute on function public.check_listing_photos() from public, anon, authenticated;
revoke execute on function public.sync_listing_status() from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- What students may write directly
-- -----------------------------------------------------------------------------
-- Everything descriptive. Never the owner, ids, timestamps, status or
-- is_active: going live or hidden goes through set_listing_status().

revoke insert (is_active), update (is_active) on public.listings from authenticated;
grant insert (locality, location_notes, room_type, furnishing, house_rules, living_arrangement)
  on public.listings to authenticated;
grant update (locality, location_notes, room_type, furnishing, house_rules, living_arrangement)
  on public.listings to authenticated;


-- -----------------------------------------------------------------------------
-- set_listing_status(): publish, deactivate or reactivate a listing
-- -----------------------------------------------------------------------------
-- Returns the new status, or 'conflict' when another listing is live and
-- p_replace doesn't name it (nothing changes then). Passing that live
-- listing's id as p_replace deactivates it and publishes this one, in one go.

create or replace function public.set_listing_status(
  p_listing uuid,
  p_status text,
  p_replace uuid default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  current_status text;
  live_id uuid;
begin
  if me is null or not public.is_eligible_student() then
    raise exception 'Only SRM students can manage listings.' using errcode = '42501';
  end if;
  if p_status not in ('active', 'inactive') then
    raise exception 'Choose to publish or deactivate.' using errcode = '22023';
  end if;

  select status into current_status
  from public.listings
  where id = p_listing and owner_id = me
  for update;
  if not found then
    raise exception 'That listing isn''t yours.' using errcode = '42501';
  end if;

  if p_status = 'inactive' then
    if current_status = 'draft' then
      raise exception 'This listing hasn''t been published yet.' using errcode = 'check_violation';
    end if;
    update public.listings set status = 'inactive' where id = p_listing;
    return 'inactive';
  end if;

  if current_status = 'active' then
    return 'active';
  end if;
  if not public.has_accommodation() then
    raise exception 'Set your housing to "I have a place" before publishing.' using errcode = 'check_violation';
  end if;

  select id into live_id
  from public.listings
  where owner_id = me and is_active and id <> p_listing
  for update;
  if live_id is not null then
    if p_replace is distinct from live_id then
      return 'conflict';
    end if;
    update public.listings set status = 'inactive' where id = live_id;
  end if;
  update public.listings set status = 'active' where id = p_listing;
  return 'active';
end;
$$;

revoke execute on function public.set_listing_status(uuid, text, uuid) from public, anon;
grant execute on function public.set_listing_status(uuid, text, uuid) to authenticated;


-- -----------------------------------------------------------------------------
-- listing_private_details: the exact address, for the owner only
-- -----------------------------------------------------------------------------

create table if not exists public.listing_private_details (
  listing_id uuid primary key references public.listings (id) on delete cascade,
  address    text check (address is null or char_length(address) between 2 and 200),
  updated_at timestamptz not null default now()
);

drop trigger if exists listing_private_details_set_updated_at on public.listing_private_details;
create trigger listing_private_details_set_updated_at
  before update on public.listing_private_details
  for each row execute function public.set_updated_at();

revoke all on public.listing_private_details from anon, authenticated;
grant select, delete on public.listing_private_details to authenticated;
grant insert (listing_id, address), update (address) on public.listing_private_details to authenticated;

alter table public.listing_private_details enable row level security;

drop policy if exists "listing_private_details: owner reads" on public.listing_private_details;
create policy "listing_private_details: owner reads"
  on public.listing_private_details for select to authenticated
  using (exists (
    select 1 from public.listings as l
    where l.id = listing_id and l.owner_id = (select auth.uid())));

drop policy if exists "listing_private_details: owner adds" on public.listing_private_details;
create policy "listing_private_details: owner adds"
  on public.listing_private_details for insert to authenticated
  with check ((select public.is_eligible_student()) and exists (
    select 1 from public.listings as l
    where l.id = listing_id and l.owner_id = (select auth.uid())));

drop policy if exists "listing_private_details: owner updates" on public.listing_private_details;
create policy "listing_private_details: owner updates"
  on public.listing_private_details for update to authenticated
  using (exists (
    select 1 from public.listings as l
    where l.id = listing_id and l.owner_id = (select auth.uid())))
  with check ((select public.is_eligible_student()));

drop policy if exists "listing_private_details: owner removes" on public.listing_private_details;
create policy "listing_private_details: owner removes"
  on public.listing_private_details for delete to authenticated
  using (exists (
    select 1 from public.listings as l
    where l.id = listing_id and l.owner_id = (select auth.uid())));


-- -----------------------------------------------------------------------------
-- Likes that name the listing they were about
-- -----------------------------------------------------------------------------
-- Deleting a listing keeps the like (and any match); it just no longer
-- points anywhere.

alter table public.swipes
  add column if not exists liked_listing_id uuid references public.listings (id) on delete set null;

alter table public.swipes drop constraint if exists swipes_listing_only_on_likes;
alter table public.swipes
  add constraint swipes_listing_only_on_likes check (liked_listing_id is null or action = 'like');

create index if not exists swipes_liked_listing_id_idx on public.swipes (liked_listing_id)
  where liked_listing_id is not null;

-- Past listing likes stored the listing id as text: link them where the
-- listing still exists and belongs to the person liked.
update public.swipes as s
set liked_listing_id = l.id
from public.listings as l
where s.liked_target_type = 'listing'
  and s.liked_listing_id is null
  and s.liked_target_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and l.id = s.liked_target_ref::uuid
  and l.owner_id = s.receiver_id;

grant insert (liked_listing_id) on public.swipes to authenticated;

-- New likes on a flat must name a live listing of the person liked. Older
-- app versions that only sent the reference still work: the listing is
-- worked out here.
create or replace function public.check_swipe_listing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.liked_listing_id is null and new.action = 'like' then
    if new.liked_target_type = 'listing'
       and new.liked_target_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      new.liked_listing_id := new.liked_target_ref::uuid;
    elsif new.liked_target_type = 'photo' and new.liked_target_ref like 'listing-photo-%' then
      select id into new.liked_listing_id
      from public.listings where owner_id = new.receiver_id and is_active;
    end if;
  end if;

  if new.liked_listing_id is not null then
    if not exists (
      select 1 from public.listings
      where id = new.liked_listing_id and owner_id = new.receiver_id and is_active
    ) then
      raise exception 'That flat isn''t available any more.' using errcode = 'check_violation';
    end if;
    if new.liked_target_type = 'listing' then
      new.liked_target_ref := new.liked_listing_id::text;
    end if;
  elsif new.liked_target_type = 'listing' then
    raise exception 'That flat isn''t available any more.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists swipes_check_listing on public.swipes;
create trigger swipes_check_listing
  before insert on public.swipes
  for each row execute function public.check_swipe_listing();

revoke execute on function public.check_swipe_listing() from public, anon, authenticated;

comment on column public.listings.is_active is
  'True exactly when status = ''active'' (kept in step by a trigger). Change status through set_listing_status().';
