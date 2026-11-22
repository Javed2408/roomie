-- =============================================================================
-- Roomie 006: SRM students only.
--
-- Roomie is exclusively for SRM students, so only @srmist.edu.in addresses
-- can create an account, and an account's email can never be changed to a
-- different domain. This runs inside the database, so it holds even for
-- requests that skip the app and call Supabase Auth directly.
--
-- * Existing accounts are untouched: the checks run only when an account is
--   created or its email changes.
-- * Email confirmation stays mandatory: the "Verified SRM Student" badge
--   still needs a confirmed address (001, handle_new_user). Keep "Confirm
--   email" switched on in Supabase Auth.
-- * The only exception is sample students from `npm run seed`. They need an
--   app_metadata flag that only the service-role key can set, plus the
--   reserved seed.roomie.test domain (never a real inbox).
--
-- Idempotent: safe to run more than once.
-- =============================================================================

-- True when this address may own a Roomie account.
create or replace function public.can_register(address text, app_metadata jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select public.is_srm_email(address)
    or (
      coalesce(app_metadata ->> 'roomie_seed', '') = 'true'
      and coalesce(address ilike '%@seed.roomie.test', false)
    );
$$;

create or replace function public.enforce_srm_only_accounts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if not public.can_register(new.email, new.raw_app_meta_data) then
      raise exception 'Roomie is only for SRM students. Sign up with your @srmist.edu.in email.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- An email change is requested into email_change, then applied to email
  -- once confirmed: check both.
  if new.email is distinct from old.email
     and not public.can_register(new.email, new.raw_app_meta_data) then
    raise exception 'Roomie accounts must use an @srmist.edu.in email.'
      using errcode = 'check_violation';
  end if;
  if coalesce(new.email_change, '') <> ''
     and new.email_change is distinct from old.email_change
     and not public.can_register(new.email_change, new.raw_app_meta_data) then
    raise exception 'Roomie accounts must use an @srmist.edu.in email.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists before_auth_user_created_srm_only on auth.users;
create trigger before_auth_user_created_srm_only
  before insert on auth.users
  for each row execute function public.enforce_srm_only_accounts();

drop trigger if exists before_auth_user_email_changed_srm_only on auth.users;
create trigger before_auth_user_email_changed_srm_only
  before update of email, email_change on auth.users
  for each row execute function public.enforce_srm_only_accounts();

-- Runs only as a trigger.
revoke execute on function public.enforce_srm_only_accounts() from public, anon, authenticated;
revoke execute on function public.can_register(text, jsonb) from public, anon;
