-- =============================================================================
-- Roomie 012: the profile editor.
--
-- * profiles.about: a short personal introduction (optional, up to 300).
-- * lifestyle_preferences: "study in groups", plus two house-rule wishes:
--   a shared cleaning rota, and a heads-up before guests come.
-- * Three save functions, each all-or-nothing in one transaction:
--     set_profile_photos(urls)       the whole ordered photo set (0 = main)
--     set_profile_interests(slugs)   the whole interest selection
--     update_housing_and_discovery(status, discover, seeking, hide_listings)
--   Photos and interests can only change through them now, so every photo
--   is checked to come from the student's own storage folder.
--
-- Changing housing status never hides listings by itself: only when the
-- student explicitly asks (p_hide_listings = true).
--
-- Idempotent: safe to run more than once.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- profiles.about
-- -----------------------------------------------------------------------------

alter table public.profiles
  add column if not exists about text
    check (about is null or char_length(btrim(about)) between 1 and 300);

grant select (about), update (about) on public.profiles to authenticated;


-- -----------------------------------------------------------------------------
-- lifestyle_preferences: more ways to describe how you live
-- -----------------------------------------------------------------------------

alter table public.lifestyle_preferences
  add column if not exists cleaning_rota boolean,
  add column if not exists guest_notice boolean;

alter table public.lifestyle_preferences
  drop constraint if exists lifestyle_preferences_study_habits_check;
alter table public.lifestyle_preferences
  add constraint lifestyle_preferences_study_habits_check
  check (study_habits in ('quiet_at_home', 'home_with_music', 'library', 'in_groups', 'varies'));

grant insert (cleaning_rota, guest_notice), update (cleaning_rota, guest_notice)
  on public.lifestyle_preferences to authenticated;


-- -----------------------------------------------------------------------------
-- set_profile_photos: replace the student's photo set in one go
-- -----------------------------------------------------------------------------
-- A photo is accepted if it is already one of the student's photos, or if
-- it is a file in their own folder of the roomie-media bucket (which only
-- they can upload to). Position 0 becomes the main photo, which the 008
-- triggers mirror into profiles.avatar_url.

create or replace function public.set_profile_photos(p_urls text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  urls text[] := coalesce(p_urls, '{}');
  current_urls text[];
  own_file text;
  photo text;
begin
  if me is null or not public.is_eligible_student() then
    raise exception 'Only signed-in SRM students can change photos.' using errcode = '42501';
  end if;
  if cardinality(urls) > 6 then
    raise exception 'You can have up to 6 photos.' using errcode = 'check_violation';
  end if;
  if (select count(distinct u) from unnest(urls) as u) <> cardinality(urls) then
    raise exception 'Each photo can only be added once.' using errcode = 'check_violation';
  end if;

  select coalesce(array_agg(f.url), '{}') into current_urls
  from public.profile_photos as f
  where f.profile_id = me;

  -- A file directly in their own folder (the name can't be "." or "..").
  own_file := '^https?://[^/]+/storage/v1/object/public/roomie-media/' || me::text
              || '/[A-Za-z0-9][A-Za-z0-9._-]*$';
  foreach photo in array urls loop
    if photo is null or not (photo = any (current_urls) or photo ~ own_file) then
      raise exception 'One of these photos isn''t yours. Upload it again.' using errcode = '42501';
    end if;
  end loop;

  delete from public.profile_photos where profile_id = me;
  insert into public.profile_photos (profile_id, url, position)
  select me, u, (n - 1)::smallint
  from unnest(urls) with ordinality as t(u, n);
  return cardinality(urls);
end;
$$;


-- -----------------------------------------------------------------------------
-- set_profile_interests: replace the student's interests in one go
-- -----------------------------------------------------------------------------

create or replace function public.set_profile_interests(p_interests text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  chosen text[];
begin
  if me is null or not public.is_eligible_student() then
    raise exception 'Only signed-in SRM students can change interests.' using errcode = '42501';
  end if;

  -- Duplicates count once.
  select coalesce(array_agg(distinct i), '{}') into chosen
  from unnest(coalesce(p_interests, '{}')) as i;

  if cardinality(chosen) > 10 then
    raise exception 'Pick up to 10 interests.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from unnest(chosen) as i
             where not exists (select 1 from public.interests where slug = i)) then
    raise exception 'That interest isn''t on the list.' using errcode = 'check_violation';
  end if;

  delete from public.profile_interests where profile_id = me;
  insert into public.profile_interests (profile_id, interest)
  select me, i from unnest(chosen) as i;
  return cardinality(chosen);
end;
$$;


-- -----------------------------------------------------------------------------
-- update_housing_and_discovery: housing status and discovery preferences
-- together, plus (only if asked) hiding the student's live listings
-- -----------------------------------------------------------------------------

create or replace function public.update_housing_and_discovery(
  p_status text,
  p_discover text,
  p_seeking text,
  p_hide_listings boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null or not public.is_eligible_student() then
    raise exception 'Only signed-in SRM students can change these settings.' using errcode = '42501';
  end if;

  insert into public.housing_status (profile_id, status)
  values (me, p_status)
  on conflict (profile_id) do update
    set status = excluded.status
    where public.housing_status.status is distinct from excluded.status;

  insert into public.discovery_preferences (profile_id, discover_housing, seeking)
  values (me, p_discover, p_seeking)
  on conflict (profile_id) do update
    set discover_housing = excluded.discover_housing,
        seeking = excluded.seeking;

  if coalesce(p_hide_listings, false) then
    update public.listings set is_active = false
    where owner_id = me and is_active;
  end if;
end;
$$;

revoke execute on function public.set_profile_photos(text[]) from public, anon;
revoke execute on function public.set_profile_interests(text[]) from public, anon;
revoke execute on function public.update_housing_and_discovery(text, text, text, boolean) from public, anon;
grant execute on function public.set_profile_photos(text[]) to authenticated;
grant execute on function public.set_profile_interests(text[]) to authenticated;
grant execute on function public.update_housing_and_discovery(text, text, text, boolean) to authenticated;

-- Photos and interests change only through the functions above.
revoke insert, update, delete on public.profile_photos from authenticated;
revoke insert, update, delete on public.profile_interests from authenticated;
