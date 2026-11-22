-- =============================================================================
-- Roomie 002: flat-hunting preferences, more amenities, one listing per owner.
-- Idempotent: safe to run more than once.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- profiles: what a 'need_flat' student is looking for (filterable in Phase 4)
-- -----------------------------------------------------------------------------

alter table public.profiles
  add column if not exists preferred_societies text[] not null default '{}'
    check (
      preferred_societies <@ array[
        'Abode Valley', 'Estancia', 'Akshaya', 'Green Pearl',
        'Potheri Independent', 'Other']::text[]
      and cardinality(preferred_societies) <= 6
    );

-- Whole rupees per month, per person.
alter table public.profiles
  add column if not exists max_budget integer
    check (max_budget between 1000 and 200000);

alter table public.profiles
  add column if not exists move_in_timeframe text
    check (move_in_timeframe in ('immediate', 'next_month', 'next_semester', 'july', 'flexible'));

create index if not exists profiles_preferred_societies_idx
  on public.profiles using gin (preferred_societies);

-- Readable by signed-in users and editable by the owner, like the other
-- profile fields (email stays private).
grant select (preferred_societies, max_budget, move_in_timeframe)
  on public.profiles to authenticated;
grant update (preferred_societies, max_budget, move_in_timeframe)
  on public.profiles to authenticated;


-- -----------------------------------------------------------------------------
-- listings: the longer amenities list
-- -----------------------------------------------------------------------------

alter table public.listings drop constraint if exists listings_amenities_check;
alter table public.listings
  add constraint listings_amenities_check check (amenities <@ array[
    'AC', 'Wi-Fi', 'Washing Machine', 'Cook', 'Maid', 'Power Backup',
    'Geyser', 'No Owner Interference', 'Bachelor Friendly', 'Balcony']::text[]);


-- -----------------------------------------------------------------------------
-- listings: one per owner (a student offers the flat they live in)
-- -----------------------------------------------------------------------------
-- Lets onboarding "save" the listing with an upsert, and keeps the feed
-- free of duplicates. (No listings exist yet, so nothing can conflict.)

create unique index if not exists listings_one_per_owner on public.listings (owner_id);
drop index if exists public.listings_owner_id_idx;
