-- =============================================================================
-- Roomie 008: richer student profiles and compatibility preferences.
--
-- The profile stays the student. Around it, without new columns on
-- profiles:
--   * profile_photos         up to 6 photos (position 0 is the main photo)
--   * interests              a fixed catalogue of interests to pick from
--   * profile_interests      which interests a student picked (up to 10)
--   * lifestyle_preferences  how they live and who they are: sleep,
--                            cleanliness, social life, study, guests, noise,
--                            smoking, food, personality
--   * practical_preferences  budget, societies, move-in, room and flat
--                            requirements, flatmate gender
--
-- Existing data is copied in and kept in step with the legacy columns the
-- current app still uses (profiles.avatar_url, preferred_societies,
-- max_budget, move_in_timeframe), in both directions.
--
-- Idempotent: safe to run more than once.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- profile_photos
-- -----------------------------------------------------------------------------

create table if not exists public.profile_photos (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  url        text not null check (char_length(url) between 1 and 500),
  position   smallint not null check (position between 0 and 5),
  created_at timestamptz not null default now(),
  constraint profile_photos_one_per_position unique (profile_id, position)
);

insert into public.profile_photos (profile_id, url, position)
select id, avatar_url, 0
from public.profiles
where avatar_url is not null
on conflict (profile_id, position) do nothing;


-- -----------------------------------------------------------------------------
-- interests (catalogue) and profile_interests
-- -----------------------------------------------------------------------------

create table if not exists public.interests (
  slug  text primary key check (slug ~ '^[a-z0-9_]{2,30}$'),
  label text not null check (char_length(label) between 2 and 40)
);

insert into public.interests (slug, label) values
  ('coding', 'Coding'),
  ('hackathons', 'Hackathons'),
  ('startups', 'Startups'),
  ('gaming', 'Gaming'),
  ('cricket', 'Cricket'),
  ('football', 'Football'),
  ('badminton', 'Badminton'),
  ('gym', 'Gym'),
  ('yoga', 'Yoga'),
  ('music', 'Music'),
  ('dance', 'Dance'),
  ('movies', 'Movies'),
  ('anime', 'Anime'),
  ('reading', 'Reading'),
  ('photography', 'Photography'),
  ('art', 'Art & design'),
  ('cooking', 'Cooking'),
  ('travel', 'Travel'),
  ('chess', 'Chess'),
  ('volunteering', 'Volunteering')
on conflict (slug) do update set label = excluded.label;

create table if not exists public.profile_interests (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  interest   text not null references public.interests (slug) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, interest)
);

create or replace function public.limit_profile_interests()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.profile_interests where profile_id = new.profile_id) >= 10 then
    raise exception 'Pick up to 10 interests.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists profile_interests_limit on public.profile_interests;
create trigger profile_interests_limit
  before insert on public.profile_interests
  for each row execute function public.limit_profile_interests();


-- -----------------------------------------------------------------------------
-- lifestyle_preferences: how a student lives (all optional)
-- -----------------------------------------------------------------------------

create table if not exists public.lifestyle_preferences (
  profile_id      uuid primary key references public.profiles (id) on delete cascade,
  sleep_schedule  text check (sleep_schedule in ('early_bird', 'night_owl', 'flexible')),
  cleanliness     text check (cleanliness in ('very_tidy', 'tidy', 'relaxed')),
  social_life     text check (social_life in ('homebody', 'balanced', 'outgoing')),
  study_habits    text check (study_habits in ('quiet_at_home', 'home_with_music', 'library', 'varies')),
  guests          text check (guests in ('rarely', 'sometimes', 'often')),
  noise_tolerance text check (noise_tolerance in ('low', 'medium', 'high')),
  smoking         text check (smoking in ('non_smoker', 'outside_only', 'smoker')),
  food_habits     text check (food_habits in ('vegetarian', 'eggetarian', 'non_vegetarian', 'vegan')),
  personality     text check (personality in ('introvert', 'ambivert', 'extrovert')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists lifestyle_preferences_set_updated_at on public.lifestyle_preferences;
create trigger lifestyle_preferences_set_updated_at
  before update on public.lifestyle_preferences
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- practical_preferences: budget, place and requirements (one per student)
-- -----------------------------------------------------------------------------

create table if not exists public.practical_preferences (
  profile_id          uuid primary key references public.profiles (id) on delete cascade,
  -- Whole rupees per month, per person.
  budget_min          integer check (budget_min between 1000 and 200000),
  budget_max          integer check (budget_max between 1000 and 200000),
  preferred_societies text[] not null default '{}' check (
                        preferred_societies <@ array[
                          'Abode Valley', 'Estancia', 'Akshaya', 'Green Pearl',
                          'Potheri Independent', 'Other']::text[]
                        and cardinality(preferred_societies) <= 6),
  move_in_timeframe   text check (move_in_timeframe in
                        ('immediate', 'next_month', 'next_semester', 'july', 'flexible')),
  room_type           text check (room_type in ('private', 'shared', 'either')),
  preferred_bhk_types text[] not null default '{}'
                      check (preferred_bhk_types <@ array['1BHK', '2BHK', '3BHK', '4BHK']::text[]),
  required_amenities  text[] not null default '{}' check (required_amenities <@ array[
                        'AC', 'Wi-Fi', 'Washing Machine', 'Cook', 'Maid', 'Power Backup',
                        'Geyser', 'No Owner Interference', 'Bachelor Friendly', 'Balcony']::text[]),
  flatmate_gender     text check (flatmate_gender in ('any', 'male', 'female')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint practical_preferences_budget_range
    check (budget_min is null or budget_max is null or budget_min <= budget_max)
);

create index if not exists practical_preferences_societies_idx
  on public.practical_preferences using gin (preferred_societies);

drop trigger if exists practical_preferences_set_updated_at on public.practical_preferences;
create trigger practical_preferences_set_updated_at
  before update on public.practical_preferences
  for each row execute function public.set_updated_at();

-- Every existing student gets a row, carrying over what they already chose.
insert into public.practical_preferences
  (profile_id, preferred_societies, budget_max, move_in_timeframe)
select id, preferred_societies, max_budget, move_in_timeframe
from public.profiles
on conflict (profile_id) do nothing;


-- -----------------------------------------------------------------------------
-- Keep the legacy profile columns and the new tables in step
-- -----------------------------------------------------------------------------
-- Each side writes only when a value really differs, so the triggers never
-- bounce back and forth.

-- profiles.avatar_url <-> profile_photos (position 0)
create or replace function public.sync_avatar_to_photos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.avatar_url is null then
    delete from public.profile_photos where profile_id = new.id and position = 0;
  else
    insert into public.profile_photos (profile_id, url, position)
    values (new.id, new.avatar_url, 0)
    on conflict (profile_id, position) do update
      set url = excluded.url
      where public.profile_photos.url is distinct from excluded.url;
  end if;
  return null;
end;
$$;

drop trigger if exists profiles_sync_avatar on public.profiles;
create trigger profiles_sync_avatar
  after insert or update of avatar_url on public.profiles
  for each row execute function public.sync_avatar_to_photos();

create or replace function public.sync_photos_to_avatar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid := coalesce(new.profile_id, old.profile_id);
  main_photo text;
begin
  if (tg_op <> 'DELETE' and new.position = 0) or (tg_op <> 'INSERT' and old.position = 0) then
    select url into main_photo
    from public.profile_photos
    where profile_id = owner and position = 0;

    update public.profiles
    set avatar_url = main_photo
    where id = owner and avatar_url is distinct from main_photo;
  end if;
  return null;
end;
$$;

drop trigger if exists profile_photos_sync_avatar on public.profile_photos;
create trigger profile_photos_sync_avatar
  after insert or update or delete on public.profile_photos
  for each row execute function public.sync_photos_to_avatar();

-- profiles.(preferred_societies, max_budget, move_in_timeframe)
--   <-> practical_preferences.(preferred_societies, budget_max, move_in_timeframe)
create or replace function public.sync_profile_to_practical_preferences()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.practical_preferences
    (profile_id, preferred_societies, budget_max, move_in_timeframe)
  values (new.id, new.preferred_societies, new.max_budget, new.move_in_timeframe)
  on conflict (profile_id) do update
    set preferred_societies = excluded.preferred_societies,
        budget_max = excluded.budget_max,
        move_in_timeframe = excluded.move_in_timeframe,
        -- A lower maximum must not leave a minimum above it.
        budget_min = case
          when public.practical_preferences.budget_min > excluded.budget_max then null
          else public.practical_preferences.budget_min
        end
    where (public.practical_preferences.preferred_societies,
           public.practical_preferences.budget_max,
           public.practical_preferences.move_in_timeframe)
      is distinct from
          (excluded.preferred_societies, excluded.budget_max, excluded.move_in_timeframe);
  return null;
end;
$$;

drop trigger if exists profiles_sync_practical_preferences on public.profiles;
create trigger profiles_sync_practical_preferences
  after insert or update of preferred_societies, max_budget, move_in_timeframe on public.profiles
  for each row execute function public.sync_profile_to_practical_preferences();

create or replace function public.sync_practical_preferences_to_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set preferred_societies = new.preferred_societies,
      max_budget = new.budget_max,
      move_in_timeframe = new.move_in_timeframe
  where id = new.profile_id
    and (preferred_societies, max_budget, move_in_timeframe)
      is distinct from (new.preferred_societies, new.budget_max, new.move_in_timeframe);
  return null;
end;
$$;

drop trigger if exists practical_preferences_sync_profile on public.practical_preferences;
create trigger practical_preferences_sync_profile
  after insert or update of preferred_societies, budget_max, move_in_timeframe
  on public.practical_preferences
  for each row execute function public.sync_practical_preferences_to_profile();

revoke execute on function public.limit_profile_interests() from public, anon, authenticated;
revoke execute on function public.sync_avatar_to_photos() from public, anon, authenticated;
revoke execute on function public.sync_photos_to_avatar() from public, anon, authenticated;
revoke execute on function public.sync_profile_to_practical_preferences() from public, anon, authenticated;
revoke execute on function public.sync_practical_preferences_to_profile() from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- Privileges and row-level security
-- -----------------------------------------------------------------------------
-- Signed-in students can read all of it (it is what a profile shows and
-- what compatibility is judged on); each student writes only their own.
-- The interest catalogue is read-only for everyone.

revoke all on public.profile_photos, public.interests, public.profile_interests,
  public.lifestyle_preferences, public.practical_preferences from anon, authenticated;

grant select on public.profile_photos, public.interests, public.profile_interests,
  public.lifestyle_preferences, public.practical_preferences to authenticated;

grant insert (profile_id, url, position), update (url, position), delete
  on public.profile_photos to authenticated;
grant insert (profile_id, interest), delete on public.profile_interests to authenticated;
grant insert (profile_id, sleep_schedule, cleanliness, social_life, study_habits, guests,
              noise_tolerance, smoking, food_habits, personality),
      update (sleep_schedule, cleanliness, social_life, study_habits, guests,
              noise_tolerance, smoking, food_habits, personality)
  on public.lifestyle_preferences to authenticated;
grant insert (profile_id, budget_min, budget_max, preferred_societies, move_in_timeframe,
              room_type, preferred_bhk_types, required_amenities, flatmate_gender),
      update (budget_min, budget_max, preferred_societies, move_in_timeframe,
              room_type, preferred_bhk_types, required_amenities, flatmate_gender)
  on public.practical_preferences to authenticated;

alter table public.profile_photos enable row level security;
alter table public.interests enable row level security;
alter table public.profile_interests enable row level security;
alter table public.lifestyle_preferences enable row level security;
alter table public.practical_preferences enable row level security;

drop policy if exists "interests: signed-in users can read" on public.interests;
create policy "interests: signed-in users can read"
  on public.interests for select to authenticated
  using (true);

-- The same four policies for each per-student table.
do $$
declare
  t text;
begin
  foreach t in array array['profile_photos', 'profile_interests',
                           'lifestyle_preferences', 'practical_preferences'] loop
    execute format('drop policy if exists %I on public.%I', t || ': signed-in users can read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      t || ': signed-in users can read', t);

    execute format('drop policy if exists %I on public.%I', t || ': students add their own', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (profile_id = (select auth.uid()))',
      t || ': students add their own', t);

    execute format('drop policy if exists %I on public.%I', t || ': students update their own', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()))',
      t || ': students update their own', t);

    execute format('drop policy if exists %I on public.%I', t || ': students delete their own', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (profile_id = (select auth.uid()))',
      t || ': students delete their own', t);
  end loop;
end;
$$;

comment on column public.profiles.avatar_url is
  'Main photo. Mirrors profile_photos position 0 (kept in sync by triggers).';
comment on column public.profiles.preferred_societies is
  'Legacy mirror of practical_preferences.preferred_societies (kept in sync by triggers).';
comment on column public.profiles.max_budget is
  'Legacy mirror of practical_preferences.budget_max (kept in sync by triggers).';
comment on column public.profiles.move_in_timeframe is
  'Legacy mirror of practical_preferences.move_in_timeframe (kept in sync by triggers).';
