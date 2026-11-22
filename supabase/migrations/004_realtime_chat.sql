-- =============================================================================
-- Roomie 004: live chat.
--
-- 1. New messages stream to the two people in a match (Supabase Realtime).
-- 2. A view of each conversation's latest message, for the matches list.
-- 3. The app can no longer backdate messages or likes.
--
-- Idempotent: safe to run more than once. (There is no 003: Phase 4 needed
-- no policy changes.)
--
-- No policy changes are needed for chat. The policies from 001 already let
-- you:
--   * read likes sent to you ("swipes: read own and likes received"; never
--     other people's passes), which powers "Likes You";
--   * read and send messages only in a match you are part of ("messages:
--     match members can read" / "... send as themselves").
-- Realtime applies the same policies, so nobody receives another pair's
-- messages.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Realtime: publish inserts on messages
-- -----------------------------------------------------------------------------
-- Supabase creates the `supabase_realtime` publication with every project;
-- the first check only matters on a database that lacks it.

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;


-- -----------------------------------------------------------------------------
-- 2. latest_messages: the newest message in each match
-- -----------------------------------------------------------------------------
-- security_invoker: the view runs with the permissions of whoever reads it,
-- so the messages policies still decide which rows they get.

create or replace view public.latest_messages
with (security_invoker = true)
as
  select distinct on (m.match_id)
    m.id, m.match_id, m.sender_id, m.content, m.created_at
  from public.messages as m
  order by m.match_id, m.created_at desc, m.id desc;

revoke all on public.latest_messages from anon, authenticated;
grant select on public.latest_messages to authenticated;


-- -----------------------------------------------------------------------------
-- 3. Write only the columns the app needs
-- -----------------------------------------------------------------------------
-- A message's id may come from the app, so a sent message and its live echo
-- can be recognised as the same one. Its time always comes from the
-- database clock. Likes get the same rule, because "Likes You" and the chat
-- opener are ordered by when each like was sent.

revoke insert on public.messages from authenticated;
grant insert (id, match_id, sender_id, content) on public.messages to authenticated;

revoke insert on public.swipes from authenticated;
grant insert (sender_id, receiver_id, action, liked_target_type, liked_target_ref, comment)
  on public.swipes to authenticated;
