# Phase 1 architecture assessment: foundation and database

Audited on 2026-11-23 against the repository (`main` at 85db1b1) **and** the
live Supabase database, which matched migrations 001, 002, 004 and 005
exactly (there is no 003).

## 1. Existing schema (before this phase)

| Table | Purpose | Notes |
| --- | --- | --- |
| `profiles` | One row per auth user, made by the `handle_new_user` trigger | Mixed three concerns: identity, housing (`mode` = `have_flat` / `need_flat`) and flat-hunting preferences (`preferred_societies`, `max_budget`, `move_in_timeframe`). One photo (`avatar_url`), prompts in validated JSON (`bio_prompts`). `email` hidden by column grants; `is_srm_verified` set only by triggers. |
| `listings` | A flat with space | **Unique index: one listing per owner, ever.** Insert policy required `profiles.mode = 'have_flat'`. No `updated_at`. Table-wide write grants (ids and timestamps writable). |
| `swipes` | Targeted likes and passes | Final (no update/delete). Insert columns restricted in 004. |
| `matches` | Made only by the `handle_mutual_like` trigger | Ordered pair, unique. |
| `messages` | Chat inside a match | Members only; in the Realtime publication; insert columns restricted in 004. |
| `latest_messages` (view) | Newest message per match | `security_invoker`. |
| `storage.objects` (`roomie-media`) | Photos | Owner-folder policies. |

Triggers: `on_auth_user_created`, `on_auth_user_email_updated` (auth.users),
`profiles_set_updated_at`, `on_swipe_inserted`. Supabase also installs
`rls_auto_enable` (not ours).

**Live data to preserve:** 3 accounts (1 `@srmist.edu.in`, 2 non-SRM test
accounts), 3 profiles (1 `have_flat`, 1 `need_flat`, 1 never onboarded),
1 active listing, 2 swipes, 1 match, 4 messages, no sample profiles.

## 2. Application dependencies on the old shape

| Dependency | Where |
| --- | --- |
| `profiles.mode` decides who you see (have_flat sees need_flat and back) | `src/lib/feed.ts` |
| `profiles.mode` decides "has a flat" on cards, account, chat starters | `feed-card.tsx`, `account/page.tsx`, `lib/matches.ts`, `lib/likes.ts` |
| `isOnboarded()` = name + mode | `lib/profile.ts`, every page |
| Onboarding writes `mode`, preferences and the photo to `profiles` | `app/onboarding/actions.ts` |
| Listing saved with `upsert(onConflict: "owner_id")` (needs the unique index) | `app/onboarding/actions.ts`, `scripts/seed.mts` |
| Own listing read with `.maybeSingle()` (breaks with 2+ listings) | `lib/profile.ts`, photo clean-up in `onboarding/actions.ts` |
| Any email could sign up; non-SRM emails were "unverified" | `app/login/actions.ts`, `auth-form.tsx` |

## 3. Required architectural changes

1. **Housing status** separate from the profile: `housing_status` (1:1).
2. **Discovery preferences** separate from housing: `discovery_preferences`
   (`discover_housing`: has / needs / both; `seeking`: flatmate / group /
   either).
3. **Compatibility preferences**, practical separate from lifestyle:
   `practical_preferences` (budget range, societies, move-in, room type,
   BHK, required amenities, flatmate gender) and `lifestyle_preferences`
   (sleep, cleanliness, social life, study, guests, noise, smoking, food,
   personality). Typed columns with CHECK constraints, no JSON blobs.
4. **Profile details**: `profile_photos` (up to 6), an `interests` catalogue
   and `profile_interests` (up to 10).
5. **Listings** as independent entities: new details (description, rooms,
   current flatmates, move-in date, flatmate preferences, `updated_at`),
   several per student with **one live at a time**, max 10, publishing tied
   to housing status, ids/owners/timestamps no longer writable.
6. **Groups**: `groups` and `group_members` (roles admin/member; statuses
   invited / requested / active / declined / left / removed), with every
   membership change going through checked `security definer` functions.
7. **SRM-only accounts** enforced in the database (`auth.users` triggers),
   with the app checking first for a friendly message.

## 4. Migration risks and how they are handled

| Risk | Mitigation |
| --- | --- |
| Losing or changing existing rows | All five migrations are additive (new tables, new nullable/defaulted columns). Only one object is replaced: the one-listing unique index becomes a partial "one *live* listing" index; live data has 1 listing, so it can't conflict. Tested by `tests/db/upgrade.test.mts` on data shaped like production. |
| Old code writing old columns after the upgrade | Two-way sync triggers keep `profiles.mode` ↔ `housing_status`, `avatar_url` ↔ `profile_photos[0]`, and the preference columns ↔ `practical_preferences`. Each side writes only when a value differs, so they can't loop. |
| `upsert(onConflict: "owner_id")` failing once the unique index is gone | The app and seed now update or insert by id. **Deploy this app version before (or with) migration 009.** The new code works on the old schema too. |
| Blocking existing non-SRM accounts | The SRM check runs only on sign-up and email changes; existing accounts keep signing in. |
| Sample accounts blocked by the SRM rule | Allowed only with an `app_metadata` flag (service-role only) **and** the reserved `seed.roomie.test` domain. |
| Running a migration twice | Every migration is idempotent; tested. |
| Supabase default grants exposing new tables to `anon` | Every new table revokes `anon`/`authenticated`, then grants exact columns; RLS is enabled on all; tested as anon. |

## 5. Backward compatibility

- Existing pages keep working unchanged: discovery still follows the
  (mirrored) `mode`, and every existing student received discovery
  preferences equal to today's behaviour, so Phase 2 can switch the feed
  over without changing what anyone sees.
- Matches, messages, Realtime chat, likes and storage policies are untouched
  (covered by `tests/db/compatibility.test.mts`).
- Legacy columns (`mode`, `preferred_societies`, `max_budget`,
  `move_in_timeframe`) remain, documented with `COMMENT`s as mirrors. They
  can be dropped once Phase 2 code reads only the new tables (then also drop
  the sync triggers).
- **Required outside the database:** Supabase **Confirm email** must be on,
  otherwise any address is auto-confirmed and could claim the SRM badge.
