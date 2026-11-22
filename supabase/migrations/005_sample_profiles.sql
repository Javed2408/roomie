-- =============================================================================
-- Roomie 005: mark sample (seeded) profiles.
--
-- `npm run seed` creates invented example students for testing and demos.
-- They must always be labelled "Sample" in the app, never passed off as
-- real people, so every profile carries this flag.
--
-- Only the seed script (which uses the service-role key) sets it. Signed-in
-- users can read it, so the app can show the label, but cannot change it.
--
-- Idempotent: safe to run more than once.
-- =============================================================================

alter table public.profiles
  add column if not exists is_sample boolean not null default false;

grant select (is_sample) on public.profiles to authenticated;
