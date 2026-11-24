-- =============================================================================
-- Roomie 016: group chat.
--
-- Every group has one conversation, readable and writable by its ACTIVE
-- members only. Individual chat (public.messages, keyed by match_id) is not
-- touched.
--
-- * group_messages: user messages and database-written system messages.
--   Immutable (no updates or deletes). Students may insert only id,
--   group_id, sender_id and content: the time, the type and everything
--   about system messages are the database's.
-- * Access = an active member (is_group_member) of a group, with an
--   eligible SRM account. Leave or get removed and every message, old and
--   new, is unreadable at once; rejoin and it all comes back. Invited and
--   requested students have no access. (Realtime applies the same policy to
--   each event, so an open chat stops receiving too.)
-- * Blocks work both ways (as in 013): if either of two students blocked
--   the other, neither sees the other's messages. System messages are
--   never hidden.
-- * System messages ("X joined", "X left", "X was removed", role changes)
--   are written by a trigger on group_events, one per event. They never
--   carry invitation or join-request notes.
-- * group_chat_reads: where each member has read up to (written only by
--   mark_group_chat_read, which can't move backwards). Unread counts and
--   last-message previews come from group_chat_summaries().
-- * Realtime: group_messages streams to members; notifications streams to
--   its recipient (so an open chat learns the moment its member is removed).
--
-- Idempotent: safe to run more than once.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- group_messages
-- -----------------------------------------------------------------------------

create table if not exists public.group_messages (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.groups (id) on delete cascade,
  -- Null for system messages (and for a student whose account was deleted).
  sender_id    uuid references public.profiles (id) on delete set null,
  message_type text not null default 'user' check (message_type in ('user', 'system')),
  content      text,
  -- System messages: what happened, to whom, by whom, and the membership
  -- event it came from (one system message per event).
  system_kind  text check (system_kind in ('joined', 'left', 'removed', 'made_admin', 'removed_admin')),
  subject_id   uuid references public.profiles (id) on delete set null,
  actor_id     uuid references public.profiles (id) on delete set null,
  event_id     uuid references public.group_events (id) on delete cascade,
  -- The real clock (not the transaction's start), so system messages written
  -- together (e.g. "left" then "is now an admin") keep their order.
  created_at   timestamptz not null default clock_timestamp(),
  constraint group_messages_event_once unique (event_id),
  constraint group_messages_shape check (
    (message_type = 'user'
      and content is not null and char_length(btrim(content)) between 1 and 2000
      and system_kind is null and event_id is null and subject_id is null and actor_id is null)
    or
    (message_type = 'system'
      and sender_id is null and content is null
      and system_kind is not null and event_id is not null)
  )
);

-- Chronological history of one group; the sender's own messages; unread counts.
create index if not exists group_messages_group_created_idx
  on public.group_messages (group_id, created_at, id);
create index if not exists group_messages_sender_idx
  on public.group_messages (sender_id, created_at) where sender_id is not null;
create index if not exists group_messages_user_idx
  on public.group_messages (group_id, created_at) where message_type = 'user';

-- Students: read, and send ordinary messages. Nothing else, ever.
revoke all on public.group_messages from anon, authenticated;
grant select on public.group_messages to authenticated;
grant insert (id, group_id, sender_id, content) on public.group_messages to authenticated;

alter table public.group_messages enable row level security;

-- Is this message hidden from you by a block, in either direction?
-- Students can only see the blocks they made (013), so the read policy
-- can't check "they blocked me" itself, and 013's is_blocked_pair is
-- internal so that nobody can look up who blocked them. This asks about
-- one MESSAGE, not a person, and answers true only to an eligible student
-- who is an active member of that message's group (the same conditions as
-- the read policy). A true answer does reveal that a block exists between
-- you and that message's sender, though not which of you made it: a narrow,
-- intended disclosure that matches what reading the chat shows. It can't be
-- used to probe for blocks outside your own groups. (A row this statement
-- is inserting isn't visible here; that only ever happens for your own
-- message or a system message, neither of which a block hides.)
create or replace function public.group_message_blocked(p_message uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select public.is_eligible_student())
    and exists (
      select 1
      from public.group_messages as gm
      where gm.id = p_message
        and gm.sender_id is not null
        and gm.sender_id <> (select auth.uid())
        and public.is_blocked_pair((select auth.uid()), gm.sender_id)
        and public.is_group_member(gm.group_id)
    );
$$;

revoke execute on function public.group_message_blocked(uuid) from public, anon;
grant execute on function public.group_message_blocked(uuid) to authenticated;

drop policy if exists "group_messages: active members read" on public.group_messages;
create policy "group_messages: active members read"
  on public.group_messages for select to authenticated
  using (
    (select public.is_eligible_student())
    and public.is_group_member(group_id)
    -- No messages across a block, whichever of you made it. System
    -- messages (no sender) are never hidden.
    and (sender_id is null or not public.group_message_blocked(id))
  );

drop policy if exists "group_messages: active members send as themselves" on public.group_messages;
create policy "group_messages: active members send as themselves"
  on public.group_messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and message_type = 'user'
    and (select public.is_eligible_student())
    and public.is_group_member(group_id)
    and exists (
      select 1 from public.groups as g where g.id = group_id and g.status <> 'archived')
  );


-- -----------------------------------------------------------------------------
-- System messages, written from membership events
-- -----------------------------------------------------------------------------
-- 015's trigger records an event only when status or role really changes,
-- and group_messages_event_once allows one system message per event, so a
-- retried function call or a repeated update never adds a second one.
-- Invitations, requests, declines and cancellations stay private: they get
-- no system message.

create or replace function public.post_group_system_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  kind text := case new.kind
    when 'invite_accepted' then 'joined'
    when 'request_approved' then 'joined'
    when 'member_left' then 'left'
    when 'member_removed' then 'removed'
    when 'role_changed' then case when new.detail = 'admin' then 'made_admin' else 'removed_admin' end
  end;
begin
  if kind is null then
    return null;
  end if;
  insert into public.group_messages (group_id, message_type, system_kind, subject_id, actor_id, event_id)
  values (new.group_id, 'system', kind, new.subject_id, new.actor_id, new.id)
  on conflict (event_id) do nothing;
  return null;
end;
$$;

drop trigger if exists group_events_post_system_message on public.group_events;
create trigger group_events_post_system_message
  after insert on public.group_events
  for each row execute function public.post_group_system_message();

revoke execute on function public.post_group_system_message() from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- Read state
-- -----------------------------------------------------------------------------

create table if not exists public.group_chat_reads (
  group_id     uuid not null references public.groups (id) on delete cascade,
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz not null,
  updated_at   timestamptz not null default now(),
  primary key (group_id, profile_id)
);

-- Read state is yours alone, and changes only through mark_group_chat_read.
revoke all on public.group_chat_reads from anon, authenticated;
grant select on public.group_chat_reads to authenticated;

alter table public.group_chat_reads enable row level security;

drop policy if exists "group_chat_reads: your own" on public.group_chat_reads;
create policy "group_chat_reads: your own"
  on public.group_chat_reads for select to authenticated
  using (profile_id = (select auth.uid()));

-- "I've read up to here" (the time of the newest message you've seen).
-- Never moves backwards, never into the future.
create or replace function public.mark_group_chat_read(p_group uuid, p_up_to timestamptz default null)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  result timestamptz;
begin
  if me is null or not public.is_eligible_student() or not public.is_group_member(p_group) then
    raise exception 'You''re not in this group.' using errcode = '42501';
  end if;
  insert into public.group_chat_reads (group_id, profile_id, last_read_at)
  values (p_group, me, least(coalesce(p_up_to, now()), now()))
  on conflict (group_id, profile_id) do update
    set last_read_at = greatest(public.group_chat_reads.last_read_at, excluded.last_read_at),
        updated_at = now()
  returning last_read_at into result;
  return result;
end;
$$;

revoke execute on function public.mark_group_chat_read(uuid, timestamptz) from public, anon;
grant execute on function public.mark_group_chat_read(uuid, timestamptz) to authenticated;


-- -----------------------------------------------------------------------------
-- group_chat_summaries(): one row per group you're in
-- -----------------------------------------------------------------------------
-- Unread = other people's ordinary messages since you last read, or since
-- you joined if you never have (so a new member isn't told about the whole
-- history). Counts stop at 100. Runs with YOUR permissions (security
-- invoker), so the message policy above decides what is counted.

create or replace function public.group_chat_summaries()
returns table (
  group_id         uuid,
  unread_count     integer,
  last_id          uuid,
  last_at          timestamptz,
  last_type        text,
  last_content     text,
  last_sender_id   uuid,
  last_system_kind text,
  last_subject_id  uuid,
  last_actor_id    uuid
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    m.group_id,
    (select count(*)::integer from (
       select 1 from public.group_messages as gm
       where gm.group_id = m.group_id
         and gm.message_type = 'user'
         and gm.sender_id is distinct from m.profile_id
         and gm.created_at > greatest(coalesce(r.last_read_at, m.joined_at), m.joined_at)
       limit 100) as counted),
    l.id, l.created_at, l.message_type, l.content, l.sender_id, l.system_kind, l.subject_id, l.actor_id
  from public.group_members as m
  left join public.group_chat_reads as r
    on r.group_id = m.group_id and r.profile_id = m.profile_id
  left join lateral (
    select gm.id, gm.created_at, gm.message_type, gm.content, gm.sender_id,
           gm.system_kind, gm.subject_id, gm.actor_id
    from public.group_messages as gm
    where gm.group_id = m.group_id
    order by gm.created_at desc, gm.id desc
    limit 1) as l on true
  where m.profile_id = (select auth.uid()) and m.status = 'active';
$$;

revoke execute on function public.group_chat_summaries() from public, anon;
grant execute on function public.group_chat_summaries() to authenticated;


-- -----------------------------------------------------------------------------
-- Realtime
-- -----------------------------------------------------------------------------
-- group_messages: new messages reach active members (Realtime checks the
-- select policy per event). notifications: reach their recipient only, which
-- is how an open chat finds out its member was removed.

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'group_messages'
  ) then
    alter publication supabase_realtime add table public.group_messages;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;
