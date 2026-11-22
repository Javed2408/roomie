-- =============================================================================
-- Roomie: initial schema (profiles, listings, swipes, matches, messages),
-- row-level security, signup trigger, mutual-like trigger and media storage.
--
-- Idempotent: safe to run more than once (IF NOT EXISTS, CREATE OR REPLACE,
-- DROP ... IF EXISTS before every policy and trigger).
--
-- Security model in one paragraph: only signed-in users (role
-- `authenticated`) can touch these tables; anonymous visitors get nothing.
-- Everyone signed in can read profiles (but never another person's email)
-- and active listings. You can only change your own rows. Matches are
-- created by the database when two likes meet, never by the app, so nobody
-- can fake a match to message a stranger.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Helper functions
-- -----------------------------------------------------------------------------

-- True for an SRM student address, e.g. ab1234@srmist.edu.in.
-- (`a@x.srmist.edu.in` does not match: the "@" must come right before srmist.)
create or replace function public.is_srm_email(address text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(address ilike '%@srmist.edu.in', false);
$$;

-- bio_prompts must be a list of at most 3 {question, answer} text pairs.
create or replace function public.is_valid_bio_prompts(prompts jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(prompts) <> 'array' then false
    when jsonb_array_length(prompts) > 3 then false
    else not exists (
      select 1
      from jsonb_array_elements(prompts) as item
      where jsonb_typeof(item) <> 'object'
         or jsonb_typeof(item -> 'question') is distinct from 'string'
         or jsonb_typeof(item -> 'answer') is distinct from 'string'
         or char_length(item ->> 'question') not between 1 and 120
         or char_length(item ->> 'answer') not between 1 and 300
    )
  end;
$$;

-- Keeps updated_at current on every update.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;


-- -----------------------------------------------------------------------------
-- profiles: one row per signed-up user, created by the signup trigger below
-- -----------------------------------------------------------------------------

create table if not exists public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  email           text not null unique,
  full_name       text check (full_name is null or char_length(full_name) between 1 and 80),
  gender          text check (gender in ('male', 'female', 'other')),
  year_of_study   integer check (year_of_study between 1 and 5),
  department      text check (department is null or char_length(department) between 1 and 80),
  mode            text check (mode in ('have_flat', 'need_flat')),
  -- Set ONLY by the database (see the triggers below); users cannot change it.
  is_srm_verified boolean not null default false,
  avatar_url      text,
  bio_prompts     jsonb not null default '[]'::jsonb
                  check (public.is_valid_bio_prompts(bio_prompts)),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- listings: a flat with space, posted by someone in 'have_flat' mode
-- -----------------------------------------------------------------------------

create table if not exists public.listings (
  id                     uuid primary key default gen_random_uuid(),
  owner_id               uuid not null references public.profiles (id) on delete cascade,
  society                text not null check (society in (
                           'Abode Valley', 'Estancia', 'Akshaya', 'Green Pearl',
                           'Potheri Independent', 'Other')),
  bhk_type               text not null check (bhk_type in ('1BHK', '2BHK', '3BHK', '4BHK')),
  vacant_spots           integer not null default 1 check (vacant_spots between 1 and 10),
  -- Whole rupees per month.
  rent_per_person        integer not null check (rent_per_person between 1 and 200000),
  maintenance_per_person integer not null default 0 check (maintenance_per_person >= 0),
  deposit_per_person     integer not null default 0 check (deposit_per_person >= 0),
  setup_cost             integer not null default 0 check (setup_cost >= 0),
  amenities              text[] not null default '{}' check (amenities <@ array[
                           'AC', 'Wi-Fi', 'Washing Machine', 'Cook', 'Maid',
                           'Power Backup', 'No Owner Interference']::text[]),
  -- Public URLs of photos in the roomie-media bucket.
  photos                 text[] not null default '{}' check (cardinality(photos) <= 10),
  is_active              boolean not null default true,
  created_at             timestamptz not null default now()
);

create index if not exists listings_owner_id_idx on public.listings (owner_id);
create index if not exists listings_active_recent_idx
  on public.listings (created_at desc) where is_active;


-- -----------------------------------------------------------------------------
-- swipes: one decision per person per person (Hinge-style targeted likes)
-- -----------------------------------------------------------------------------

create table if not exists public.swipes (
  id                uuid primary key default gen_random_uuid(),
  sender_id         uuid not null references public.profiles (id) on delete cascade,
  receiver_id       uuid not null references public.profiles (id) on delete cascade,
  action            text not null check (action in ('like', 'pass')),
  -- What exactly was liked: a photo, a prompt answer or their listing.
  liked_target_type text check (liked_target_type in ('photo', 'prompt', 'listing')),
  liked_target_ref  text check (liked_target_ref is null or char_length(liked_target_ref) <= 200),
  comment           text check (comment is null or char_length(comment) between 1 and 300),
  created_at        timestamptz not null default now(),
  constraint swipes_sender_receiver_key unique (sender_id, receiver_id),
  constraint swipes_not_self check (sender_id <> receiver_id),
  -- A pass never carries a target or a comment.
  constraint swipes_pass_is_plain check (
    action = 'like'
    or (liked_target_type is null and liked_target_ref is null and comment is null)
  )
);

create index if not exists swipes_receiver_id_idx on public.swipes (receiver_id);


-- -----------------------------------------------------------------------------
-- matches: created automatically when two people like each other
-- -----------------------------------------------------------------------------

create table if not exists public.matches (
  id              uuid primary key default gen_random_uuid(),
  user_a          uuid not null references public.profiles (id) on delete cascade,
  user_b          uuid not null references public.profiles (id) on delete cascade,
  -- The comment left with the first like, shown at the top of the chat.
  initial_comment text,
  created_at      timestamptz not null default now(),
  -- The pair is always stored smaller id first, so each pair has one row.
  constraint matches_ordered_pair check (user_a < user_b),
  constraint matches_pair_key unique (user_a, user_b)
);

create index if not exists matches_user_b_idx on public.matches (user_b);


-- -----------------------------------------------------------------------------
-- messages: chat inside a match
-- -----------------------------------------------------------------------------

create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  match_id   uuid not null references public.matches (id) on delete cascade,
  sender_id  uuid not null references public.profiles (id) on delete cascade,
  content    text not null check (char_length(btrim(content)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists messages_match_created_idx on public.messages (match_id, created_at);
create index if not exists messages_sender_id_idx on public.messages (sender_id);


-- -----------------------------------------------------------------------------
-- Signup trigger: every new auth user gets a profile row
-- -----------------------------------------------------------------------------
-- The SRM badge requires BOTH an @srmist.edu.in address AND a confirmed
-- email. Otherwise anyone could type someone@srmist.edu.in and get the
-- badge. (If "Confirm email" is switched off in Supabase for testing, every
-- signup counts as confirmed; switch it back on before real users arrive.)

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, is_srm_verified)
  values (
    new.id,
    new.email,
    left(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), 80),
    public.is_srm_email(new.email) and new.email_confirmed_at is not null
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keeps the profile in step when an email is confirmed or changed.
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set email = new.email,
      is_srm_verified = public.is_srm_email(new.email) and new.email_confirmed_at is not null
  where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated
  after update of email, email_confirmed_at on auth.users
  for each row execute function public.handle_user_email_change();


-- -----------------------------------------------------------------------------
-- Mutual-like trigger: a like that meets a like creates exactly one match
-- -----------------------------------------------------------------------------
-- The advisory lock makes two people liking each other at the same moment
-- wait for each other, so the second one always sees the first like.

create or replace function public.handle_mutual_like()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  low  uuid := least(new.sender_id, new.receiver_id);
  high uuid := greatest(new.sender_id, new.receiver_id);
  earlier_comment text;
begin
  if new.action <> 'like' then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(low::text || ':' || high::text, 0));

  select s.comment into earlier_comment
  from public.swipes as s
  where s.sender_id = new.receiver_id
    and s.receiver_id = new.sender_id
    and s.action = 'like';

  if found then
    insert into public.matches (user_a, user_b, initial_comment)
    values (low, high, coalesce(earlier_comment, new.comment))
    on conflict (user_a, user_b) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists on_swipe_inserted on public.swipes;
create trigger on_swipe_inserted
  after insert on public.swipes
  for each row execute function public.handle_mutual_like();

-- These run only as triggers; nobody needs to call them directly.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.handle_user_email_change() from public, anon, authenticated;
revoke execute on function public.handle_mutual_like() from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- Table privileges (what each role may attempt at all; RLS then filters rows)
-- -----------------------------------------------------------------------------

revoke all on public.profiles, public.listings, public.swipes, public.matches,
  public.messages from anon;

-- profiles: readable without the email column; users may edit only these
-- fields. id, email, is_srm_verified and the timestamps stay database-owned.
revoke all on public.profiles from authenticated;
grant select (id, full_name, gender, year_of_study, department, mode,
  is_srm_verified, avatar_url, bio_prompts, created_at, updated_at)
  on public.profiles to authenticated;
grant update (full_name, gender, year_of_study, department, mode,
  avatar_url, bio_prompts)
  on public.profiles to authenticated;

grant select, insert, update, delete on public.listings to authenticated;

-- Decisions are final: no editing or deleting a swipe.
revoke all on public.swipes from authenticated;
grant select, insert on public.swipes to authenticated;

-- Matches are created only by the trigger above.
revoke all on public.matches from authenticated;
grant select on public.matches to authenticated;

-- Messages cannot be edited or deleted.
revoke all on public.messages from authenticated;
grant select, insert on public.messages to authenticated;


-- -----------------------------------------------------------------------------
-- Row-level security
-- -----------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.listings enable row level security;
alter table public.swipes   enable row level security;
alter table public.matches  enable row level security;
alter table public.messages enable row level security;

-- profiles ---------------------------------------------------------------------
drop policy if exists "profiles: signed-in users can read" on public.profiles;
create policy "profiles: signed-in users can read"
  on public.profiles for select to authenticated
  using (true);

drop policy if exists "profiles: users update their own" on public.profiles;
create policy "profiles: users update their own"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- listings ---------------------------------------------------------------------
drop policy if exists "listings: read active or own" on public.listings;
create policy "listings: read active or own"
  on public.listings for select to authenticated
  using (is_active or owner_id = (select auth.uid()));

drop policy if exists "listings: flat owners create their own" on public.listings;
create policy "listings: flat owners create their own"
  on public.listings for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.profiles as p
      where p.id = (select auth.uid()) and p.mode = 'have_flat'
    )
  );

drop policy if exists "listings: owners update their own" on public.listings;
create policy "listings: owners update their own"
  on public.listings for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists "listings: owners delete their own" on public.listings;
create policy "listings: owners delete their own"
  on public.listings for delete to authenticated
  using (owner_id = (select auth.uid()));

-- swipes -----------------------------------------------------------------------
-- You see your own decisions, and likes others sent you (never their passes).
drop policy if exists "swipes: read own and likes received" on public.swipes;
create policy "swipes: read own and likes received"
  on public.swipes for select to authenticated
  using (
    sender_id = (select auth.uid())
    or (receiver_id = (select auth.uid()) and action = 'like')
  );

drop policy if exists "swipes: send as yourself" on public.swipes;
create policy "swipes: send as yourself"
  on public.swipes for insert to authenticated
  with check (sender_id = (select auth.uid()));

-- matches ----------------------------------------------------------------------
drop policy if exists "matches: members can read" on public.matches;
create policy "matches: members can read"
  on public.matches for select to authenticated
  using ((select auth.uid()) in (user_a, user_b));

-- messages ---------------------------------------------------------------------
drop policy if exists "messages: match members can read" on public.messages;
create policy "messages: match members can read"
  on public.messages for select to authenticated
  using (exists (
    select 1 from public.matches as m
    where m.id = match_id and (select auth.uid()) in (m.user_a, m.user_b)
  ));

drop policy if exists "messages: match members send as themselves" on public.messages;
create policy "messages: match members send as themselves"
  on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and exists (
      select 1 from public.matches as m
      where m.id = match_id and (select auth.uid()) in (m.user_a, m.user_b)
    )
  );


-- -----------------------------------------------------------------------------
-- Storage: public `roomie-media` bucket, each user writes only to their folder
-- -----------------------------------------------------------------------------
-- Files are uploaded as `<user id>/<file name>`. The bucket is public, so
-- anyone with a file's URL can view it; only its owner can add, replace or
-- delete files. Images only, up to 5 MB each.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('roomie-media', 'roomie-media', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "roomie-media: upload to own folder" on storage.objects;
create policy "roomie-media: upload to own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'roomie-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "roomie-media: read own files" on storage.objects;
create policy "roomie-media: read own files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'roomie-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "roomie-media: replace own files" on storage.objects;
create policy "roomie-media: replace own files"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'roomie-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'roomie-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "roomie-media: delete own files" on storage.objects;
create policy "roomie-media: delete own files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'roomie-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
