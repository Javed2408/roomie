-- =============================================================================
-- Roomie 013: the discovery engine.
--
-- Discovery used to pair opposite housing modes (people with a flat saw
-- people without one, and back). Now each student sees whoever their own
-- saved discovery preference asks for, whatever their own housing:
--   * students who have accommodation, who need it, or both.
--
-- * blocks: a student can block another. Neither then sees the other in
--   discovery, and new likes and messages between them are refused. Only
--   the blocker can see a block.
-- * discovery_candidates(): the one place that decides who may appear in
--   someone's feed (eligibility, blocks, past decisions, hard filters).
--   It runs as the database, so it can compare against other students'
--   private practical preferences, but it only ever returns how they
--   compare (match / close / mismatch), never the values themselves.
-- * New students now start by discovering both groups; their housing no
--   longer decides it. Existing saved preferences are left as they are.
--
-- Idempotent: safe to run more than once.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- blocks
-- -----------------------------------------------------------------------------

create table if not exists public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);

create index if not exists blocks_blocked_id_idx on public.blocks (blocked_id);

-- A block is private to the student who made it.
revoke all on public.blocks from anon, authenticated;
grant select, delete on public.blocks to authenticated;
grant insert (blocker_id, blocked_id) on public.blocks to authenticated;

alter table public.blocks enable row level security;

drop policy if exists "blocks: students see their own" on public.blocks;
create policy "blocks: students see their own"
  on public.blocks for select to authenticated
  using (blocker_id = (select auth.uid()));

drop policy if exists "blocks: students block as themselves" on public.blocks;
create policy "blocks: students block as themselves"
  on public.blocks for insert to authenticated
  with check (blocker_id = (select auth.uid()) and (select public.is_eligible_student()));

drop policy if exists "blocks: students remove their own" on public.blocks;
create policy "blocks: students remove their own"
  on public.blocks for delete to authenticated
  using (blocker_id = (select auth.uid()));

-- Is there a block either way between two students? Internal only: students
-- can't call it, so nobody can find out who blocked them.
create or replace function public.is_blocked_pair(p_one uuid, p_two uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.blocks as b
    where (b.blocker_id = p_one and b.blocked_id = p_two)
       or (b.blocker_id = p_two and b.blocked_id = p_one)
  );
$$;

revoke execute on function public.is_blocked_pair(uuid, uuid) from public, anon, authenticated;

-- New likes and messages are refused across a block (history stays). Done
-- in triggers, which run as the database, so the check stays internal.
create or replace function public.refuse_blocked_swipe()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.is_blocked_pair(new.sender_id, new.receiver_id) then
    raise exception 'That profile isn''t available.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists swipes_refuse_blocked on public.swipes;
create trigger swipes_refuse_blocked
  before insert on public.swipes
  for each row execute function public.refuse_blocked_swipe();

create or replace function public.refuse_blocked_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.matches as m
    where m.id = new.match_id and public.is_blocked_pair(m.user_a, m.user_b)
  ) then
    raise exception 'This conversation is closed.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists messages_refuse_blocked on public.messages;
create trigger messages_refuse_blocked
  before insert on public.messages
  for each row execute function public.refuse_blocked_message();

revoke execute on function public.refuse_blocked_swipe() from public, anon, authenticated;
revoke execute on function public.refuse_blocked_message() from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- New students discover both groups by default
-- -----------------------------------------------------------------------------
-- Same as 007, except the first discovery preference is 'both' instead of
-- the opposite of the student's own housing.

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

  insert into public.discovery_preferences (profile_id, discover_housing)
  values (new.profile_id, 'both')
  on conflict (profile_id) do nothing;
  return null;
end;
$$;

revoke execute on function public.sync_housing_status_to_mode() from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- Move-in timeframes as dates
-- -----------------------------------------------------------------------------
-- The last day a flat can become free and still suit someone moving in
-- within this timeframe. Null means any time ('flexible').

create or replace function public.move_in_window_end(p_timeframe text)
returns date
language sql
stable
set search_path = ''
as $$
  select case p_timeframe
    when 'immediate' then current_date + 30
    when 'next_month' then (date_trunc('month', current_date) + interval '2 months' - interval '1 day')::date
    when 'next_semester' then current_date + 183
    when 'july' then make_date(
      extract(year from current_date)::int
        + case when current_date > make_date(extract(year from current_date)::int, 7, 31) then 1 else 0 end,
      7, 31)
    else null
  end;
$$;


-- -----------------------------------------------------------------------------
-- discovery_candidates(): who may appear in the signed-in student's feed
-- -----------------------------------------------------------------------------
-- p_filters (all optional): {
--   "societies": ["Estancia", ...], "budget_min": 6000, "budget_max": 15000,
--   "move_in": "next_month", "room_type": "private", "bhk": ["2BHK"],
--   "amenities": ["AC"], "gender": "female" }
-- A filter only removes someone whose details clearly conflict with it:
-- a student who hasn't said (e.g. no budget given) is never filtered out
-- for that.
--
-- Returns at most p_limit candidates (newest activity first). Ranking
-- happens in the app, from the returned lifestyle, interests and facts.

create or replace function public.discovery_candidates(
  p_filters jsonb default '{}'::jsonb,
  p_exclude uuid[] default '{}',
  p_limit integer default 300
)
returns table (
  candidate_id    uuid,
  housing         text,
  seeking         text,
  listing_id      uuid,
  last_active     timestamptz,
  lifestyle       jsonb,
  interests       text[],
  facts           jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  me uuid := (select auth.uid());
  my_discover text;
  my_gender text;
  vp public.practical_preferences%rowtype;
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  f_societies text[];
  f_bhk text[];
  f_amenities text[];
  f_budget_min integer;
  f_budget_max integer;
  f_move_in text;
  f_room text;
  f_gender text;
  f_move_end date;
  cap integer := least(greatest(coalesce(p_limit, 300), 1), 500);
begin
  if me is null or not public.is_eligible_student() then
    raise exception 'Only signed-in SRM students can use discovery.' using errcode = '42501';
  end if;
  if jsonb_typeof(f) <> 'object' then
    raise exception 'Filters must be an object.' using errcode = '22023';
  end if;
  if cardinality(coalesce(p_exclude, '{}')) > 1000 then
    raise exception 'Too many profiles to skip.' using errcode = '22023';
  end if;

  -- The viewer's own settings (never taken from the caller).
  select d.discover_housing into my_discover
  from public.discovery_preferences as d where d.profile_id = me;
  my_discover := coalesce(my_discover, 'both');
  select p.gender into my_gender from public.profiles as p where p.id = me;
  select * into vp from public.practical_preferences as pp where pp.profile_id = me;

  -- Filters: anything malformed is ignored rather than trusted.
  f_societies := case when jsonb_typeof(f -> 'societies') = 'array'
    then array(select jsonb_array_elements_text(f -> 'societies')) else '{}' end;
  f_bhk := case when jsonb_typeof(f -> 'bhk') = 'array'
    then array(select jsonb_array_elements_text(f -> 'bhk')) else '{}' end;
  f_amenities := case when jsonb_typeof(f -> 'amenities') = 'array'
    then array(select jsonb_array_elements_text(f -> 'amenities')) else '{}' end;
  f_budget_min := case when (f ->> 'budget_min') ~ '^\d{1,6}$' then (f ->> 'budget_min')::integer end;
  f_budget_max := case when (f ->> 'budget_max') ~ '^\d{1,6}$' then (f ->> 'budget_max')::integer end;
  f_move_in := case when f ->> 'move_in' in ('immediate', 'next_month', 'next_semester', 'july')
    then f ->> 'move_in' end;
  f_room := case when f ->> 'room_type' in ('private', 'shared') then f ->> 'room_type' end;
  f_gender := case when f ->> 'gender' in ('male', 'female', 'other') then f ->> 'gender' end;
  f_move_end := public.move_in_window_end(f_move_in);

  return query
  with pool as (
    select
      p.id,
      p.gender,
      p.updated_at,
      h.status,
      coalesce(d.seeking, 'either') as seeking,
      pp.budget_min, pp.budget_max, pp.preferred_societies, pp.move_in_timeframe,
      pp.room_type, pp.preferred_bhk_types,
      l.id as l_id, l.society as l_society, l.bhk_type as l_bhk,
      l.rent_per_person + l.maintenance_per_person as l_cost,
      l.amenities as l_amenities, l.available_from as l_from
    from public.profiles as p
    join auth.users as u on u.id = p.id
    join public.housing_status as h on h.profile_id = p.id
    left join public.discovery_preferences as d on d.profile_id = p.id
    left join public.practical_preferences as pp on pp.profile_id = p.id
    -- Only a live listing, and only while its owner has a place.
    left join public.listings as l
      on l.owner_id = p.id and l.is_active and h.status = 'has_accommodation'
    where p.id <> me
      and p.full_name is not null
      -- A confirmed SRM login (never the profile badge). Sample students
      -- from the seed script (flag settable by the service role only, on
      -- the reserved domain) are allowed; the app labels them "Sample".
      and (
        (public.is_srm_email(u.email) and u.email_confirmed_at is not null)
        or (p.is_sample and u.email ilike '%@seed.roomie.test')
      )
      -- An active account: not banned, not deleted.
      and (u.banned_until is null or u.banned_until < now())
      and u.deleted_at is null
      -- Whom the viewer chose to discover.
      and (my_discover = 'both' or h.status = my_discover)
      -- Not already liked or passed (decisions are final).
      and not exists (
        select 1 from public.swipes as s where s.sender_id = me and s.receiver_id = p.id)
      -- No block either way.
      and not exists (
        select 1 from public.blocks as b
        where (b.blocker_id = me and b.blocked_id = p.id)
           or (b.blocker_id = p.id and b.blocked_id = me))
      and not (p.id = any (coalesce(p_exclude, '{}')))
      -- Their own flatmate-gender wish, and their flat's, are respected.
      and (my_gender is null or coalesce(pp.flatmate_gender, 'any') in ('any', my_gender))
      and (l.id is null or my_gender is null or l.preferred_flatmate_gender in ('any', my_gender))
  )
  select
    pool.id,
    pool.status,
    pool.seeking,
    pool.l_id,
    pool.updated_at,
    (select to_jsonb(lp) - 'profile_id' - 'created_at' - 'updated_at'
       from public.lifestyle_preferences as lp where lp.profile_id = pool.id),
    array(select pi.interest from public.profile_interests as pi
          where pi.profile_id = pool.id order by pi.interest),
    jsonb_strip_nulls(jsonb_build_object(
      'budget', case
        when vp.budget_min is null and vp.budget_max is null then null
        when pool.l_id is not null then case
          when pool.l_cost between coalesce(vp.budget_min, 0) and coalesce(vp.budget_max, 1000000) then 'match'
          when pool.l_cost between coalesce(vp.budget_min, 0) - 2000 and coalesce(vp.budget_max, 1000000) + 2000 then 'close'
          else 'mismatch' end
        when pool.budget_min is null and pool.budget_max is null then null
        when coalesce(vp.budget_min, 0) <= coalesce(pool.budget_max, 1000000)
         and coalesce(pool.budget_min, 0) <= coalesce(vp.budget_max, 1000000) then 'match'
        when coalesce(vp.budget_min, 0) - 2000 <= coalesce(pool.budget_max, 1000000)
         and coalesce(pool.budget_min, 0) - 2000 <= coalesce(vp.budget_max, 1000000) then 'close'
        else 'mismatch' end,
      'societies', case
        when cardinality(coalesce(vp.preferred_societies, '{}')) = 0 then null
        when pool.l_id is not null then
          case when pool.l_society = any (vp.preferred_societies) then 'match' else 'mismatch' end
        when cardinality(coalesce(pool.preferred_societies, '{}')) = 0 then null
        when pool.preferred_societies && vp.preferred_societies then 'match'
        else 'mismatch' end,
      'move_in', case
        when vp.move_in_timeframe is null then null
        when pool.l_id is not null then case
          when vp.move_in_timeframe = 'flexible' or pool.l_from is null
            or pool.l_from <= public.move_in_window_end(vp.move_in_timeframe) then 'match'
          else 'mismatch' end
        when pool.move_in_timeframe is null then null
        when pool.move_in_timeframe = vp.move_in_timeframe
          or 'flexible' in (pool.move_in_timeframe, vp.move_in_timeframe) then 'match'
        when array[pool.move_in_timeframe, vp.move_in_timeframe] <@ array['immediate', 'next_month']
          or array[pool.move_in_timeframe, vp.move_in_timeframe] <@ array['next_semester', 'july'] then 'close'
        else 'mismatch' end,
      'room_type', case
        when pool.l_id is not null or vp.room_type is null or pool.room_type is null then null
        when pool.room_type = vp.room_type or 'either' in (pool.room_type, vp.room_type) then 'match'
        else 'mismatch' end,
      'bhk', case
        when cardinality(coalesce(vp.preferred_bhk_types, '{}')) = 0 then null
        when pool.l_id is not null then
          case when pool.l_bhk = any (vp.preferred_bhk_types) then 'match' else 'mismatch' end
        when cardinality(coalesce(pool.preferred_bhk_types, '{}')) = 0 then null
        when pool.preferred_bhk_types && vp.preferred_bhk_types then 'match'
        else 'mismatch' end,
      'amenities', case
        when pool.l_id is null or cardinality(coalesce(vp.required_amenities, '{}')) = 0 then null
        else round(
          (select count(*) from unnest(vp.required_amenities) as a where a = any (pool.l_amenities))::numeric
          / cardinality(vp.required_amenities), 2)
        end,
      'gender', case
        when coalesce(vp.flatmate_gender, 'any') = 'any' or pool.gender is null then null
        when pool.gender = vp.flatmate_gender then 'match'
        else 'mismatch' end
    ))
  from pool
  where
    -- Hard filters chosen by the viewer. Unknown details never exclude.
    (cardinality(f_societies) = 0 or case
      when pool.l_id is not null then pool.l_society = any (f_societies)
      else cardinality(coalesce(pool.preferred_societies, '{}')) = 0
        or pool.preferred_societies && f_societies end)
    and (f_budget_max is null or case
      when pool.l_id is not null then pool.l_cost <= f_budget_max
      else pool.budget_min is null or pool.budget_min <= f_budget_max end)
    and (f_budget_min is null or case
      when pool.l_id is not null then pool.l_cost >= f_budget_min
      else pool.budget_max is null or pool.budget_max >= f_budget_min end)
    and (f_move_in is null or case
      when pool.l_id is not null then pool.l_from is null or pool.l_from <= f_move_end
      else pool.move_in_timeframe is null or pool.move_in_timeframe in (f_move_in, 'flexible') end)
    and (f_room is null or pool.l_id is not null
      or pool.room_type is null or pool.room_type in (f_room, 'either'))
    and (cardinality(f_bhk) = 0 or case
      when pool.l_id is not null then pool.l_bhk = any (f_bhk)
      else cardinality(coalesce(pool.preferred_bhk_types, '{}')) = 0
        or pool.preferred_bhk_types && f_bhk end)
    -- Amenities describe a flat, so they only narrow students with one.
    and (cardinality(f_amenities) = 0 or pool.l_id is null or pool.l_amenities @> f_amenities)
    and (f_gender is null or pool.gender is null or pool.gender = f_gender)
  order by pool.updated_at desc, pool.id
  limit cap;
end;
$$;

revoke execute on function public.discovery_candidates(jsonb, uuid[], integer) from public, anon;
grant execute on function public.discovery_candidates(jsonb, uuid[], integer) to authenticated;


-- -----------------------------------------------------------------------------
-- Indexes for the discovery query
-- -----------------------------------------------------------------------------

-- (swipes, blocks and profile_interests are already covered by their keys.)
create index if not exists housing_status_status_idx on public.housing_status (status);
