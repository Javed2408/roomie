"use client";

import { LoaderCircle, LockKeyhole } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { Composer } from "@/components/chat/composer";
import { GroupChatHeader, type Connection } from "@/components/groups/group-chat-header";
import { AppShell } from "@/components/ui/app-shell";
import { Avatar } from "@/components/ui/avatar";
import { ButtonLink } from "@/components/ui/button";
import { MESSAGE_MAX } from "@/lib/constants/prompts";
import {
  CHAT_PAGE,
  chatReducer,
  displayName,
  initialChatState,
  isAlreadySaved,
  layoutMessages,
  looksLikeAccessLoss,
  newestConfirmedAt,
  optimisticMessage,
  systemMessageText,
  type GroupChatMessage,
} from "@/lib/group-chat";
import type { ChatPerson, GroupChatData } from "@/lib/group-chats";
import { createClient } from "@/lib/supabase/client";
import { subscribeAsUser } from "@/lib/supabase/realtime";
import { clockTime, dayLabel, type Days } from "@/lib/time";
import { newUuid } from "@/lib/uuid";
import type { GroupMessageRow } from "@/types/database";

/** How close to the bottom still counts as "reading the latest". */
const NEAR_BOTTOM_PX = 120;

function scrollToEnd(behavior: ScrollBehavior) {
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior });
}

/**
 * A live group chat. The server sends the newest messages; new ones arrive
 * over Supabase Realtime. The database decides who may read and write
 * (active members only): this screen also notices when that stops being you
 * (removed, left on another device), stops listening and clears the chat.
 */
export function GroupChatRoom({
  myId,
  group,
  members,
  people: initialPeople,
  messages: history,
  hasEarlier: initialHasEarlier,
  days,
}: GroupChatData & { myId: string; days: Days }) {
  const router = useRouter();
  const [chat, dispatch] = useReducer(chatReducer, history, initialChatState);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [newBelow, setNewBelow] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [hasEarlier, setHasEarlier] = useState(initialHasEarlier);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [earlierFailed, setEarlierFailed] = useState(false);
  const [extraPeople, setExtraPeople] = useState<Record<string, ChatPerson>>({});

  const people = useMemo(
    () => ({ ...initialPeople, ...Object.fromEntries(members.map((member) => [member.id, member])), ...extraPeople }),
    [initialPeople, members, extraPeople],
  );
  const nameOf = useCallback(
    (id: string | null) => (id ? (people[id]?.name ?? "A member") : "A member"),
    [people],
  );

  // Latest values for callbacks that outlive a render.
  const messagesRef = useRef(chat.messages);
  const peopleRef = useRef(people);
  useEffect(() => {
    messagesRef.current = chat.messages;
    peopleRef.current = people;
  }, [chat.messages, people]);

  /** Every message id this screen has shown, to spot genuinely new ones. */
  const seen = useRef(new Set(history.map((message) => message.id)));
  const atBottom = useRef(true);
  const pendingScroll = useRef<ScrollBehavior | null>("instant");
  /** Page height before older messages were added, to keep the reader's place. */
  const anchor = useRef<number | null>(null);
  const lastMarked = useRef<string | null>(null);
  const readTimer = useRef<number | undefined>(undefined);
  const refreshTimer = useRef<number | undefined>(undefined);

  /** Is this student still an active member? If not, the chat is closed. */
  const checkAccess = useCallback(async () => {
    const { data, error } = await createClient().rpc("is_group_member", { p_group: group.id });
    if (!error && data === false) {
      dispatch({ type: "revoke" });
    }
  }, [group.id]);

  /** Tell the database how far we've read (when actually looking at the newest). */
  const markRead = useCallback(() => {
    if (document.visibilityState !== "visible" || !atBottom.current) {
      return;
    }
    window.clearTimeout(readTimer.current);
    readTimer.current = window.setTimeout(async () => {
      const upTo = newestConfirmedAt(messagesRef.current);
      if (!upTo || upTo === lastMarked.current) {
        return;
      }
      lastMarked.current = upTo;
      const { error } = await createClient().rpc("mark_group_chat_read", { p_group: group.id, p_up_to: upTo });
      if (error) {
        lastMarked.current = null;
        if (looksLikeAccessLoss(error)) {
          void checkAccess();
        }
      }
    }, 500);
  }, [group.id, checkAccess]);

  /** Fetch names for people we haven't met on this screen (e.g. someone who just joined). */
  const ensurePeople = useCallback(async (ids: Array<string | null>) => {
    const missing = [...new Set(ids.filter((id): id is string => Boolean(id) && !peopleRef.current[id as string]))];
    if (missing.length === 0) {
      return;
    }
    const { data } = await createClient().from("profiles").select("id, full_name, avatar_url").in("id", missing);
    if (data?.length) {
      setExtraPeople((current) => ({
        ...current,
        ...Object.fromEntries(
          data.map((row) => [row.id, { id: row.id, name: displayName(row.full_name), avatarUrl: row.avatar_url, headline: null }]),
        ),
      }));
    }
  }, []);

  /** Take in messages from the live feed, a catch-up fetch or an insert's reply. */
  const receive = useCallback(
    (rows: GroupMessageRow[]) => {
      const fresh = rows.filter((row) => !seen.current.has(row.id));
      for (const row of fresh) {
        seen.current.add(row.id);
      }
      dispatch({ type: "receive", rows });
      if (fresh.length === 0) {
        return;
      }
      void ensurePeople(fresh.flatMap((row) => [row.sender_id, row.subject_id, row.actor_id]));

      const fromOthers = fresh.filter((row) => row.sender_id !== myId);
      const latest = fromOthers.at(-1);
      if (latest) {
        // Follow along if they're reading the latest; otherwise offer a button.
        if (atBottom.current) {
          pendingScroll.current = "smooth";
        } else {
          setNewBelow(true);
        }
        const lookup = (id: string | null) => (id ? (peopleRef.current[id]?.name ?? "A member") : "A member");
        setAnnouncement(
          latest.message_type === "system"
            ? systemMessageText(latest, lookup)
            : `New message from ${lookup(latest.sender_id)}: ${latest.content}`,
        );
      }
      // Someone joined, left or was removed: refresh the member count and list.
      if (fresh.some((row) => row.message_type === "system")) {
        window.clearTimeout(refreshTimer.current);
        refreshTimer.current = window.setTimeout(() => router.refresh(), 400);
      }
      markRead();
    },
    [myId, ensurePeople, markRead, router],
  );

  // After each render that changed the list: keep the reader's place when
  // older messages were added, otherwise scroll if one was asked for.
  useEffect(() => {
    if (anchor.current !== null) {
      const before = anchor.current;
      anchor.current = null;
      window.scrollTo({ top: window.scrollY + (document.documentElement.scrollHeight - before) });
      return;
    }
    const behavior = pendingScroll.current;
    if (!behavior) {
      return;
    }
    pendingScroll.current = null;
    const frame = requestAnimationFrame(() => scrollToEnd(behavior));
    return () => cancelAnimationFrame(frame);
  }, [chat.messages]);

  // Track whether the reader is at the bottom; reaching it counts as reading.
  useEffect(() => {
    function onScroll() {
      const page = document.documentElement;
      atBottom.current = window.innerHeight + window.scrollY >= page.scrollHeight - NEAR_BOTTOM_PX;
      if (atBottom.current) {
        setNewBelow(false);
        markRead();
      }
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [markRead]);

  // Opening the chat counts as reading what's there.
  useEffect(() => {
    markRead();
    return () => window.clearTimeout(readTimer.current);
  }, [markRead]);

  // Coming back to the tab or the network: check we still belong, catch up on reading.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") {
        void checkAccess();
        markRead();
      }
    }
    const goOffline = () => setConnection("offline");
    const goOnline = () => void checkAccess();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
      window.clearTimeout(refreshTimer.current);
    };
  }, [checkAccess, markRead]);

  // Live messages for this group, and a nudge when we're removed. Realtime
  // checks row-level security for every event, so only active members
  // receive messages; leaving or being removed ends delivery at once.
  const revoked = chat.revoked;
  useEffect(() => {
    if (revoked) {
      return;
    }
    const supabase = createClient();
    return subscribeAsUser(
      (client) =>
        client
          // A fresh name each time, so a quick unmount and remount never
          // reuses a closing channel.
          .channel(`group-chat:${group.id}:${newUuid()}`, {
            config: { postgres_changes_options: { wait: true } },
          })
          .on<GroupMessageRow>(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "group_messages", filter: `group_id=eq.${group.id}` },
            (payload) => receive([payload.new]),
          )
          // Any new notification for me (e.g. "you were removed") is a cue to
          // double-check that I still belong.
          .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_id=eq.${myId}` },
            () => void checkAccess(),
          ),
      (status, error) => {
        if (status === "SUBSCRIBED") {
          setConnection("live");
          // Catch up on anything sent while connecting or disconnected.
          void supabase
            .from("group_messages")
            .select("*")
            .eq("group_id", group.id)
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .limit(CHAT_PAGE)
            .then(({ data, error: fetchError }) => {
              if (data) {
                receive(data);
              } else if (looksLikeAccessLoss(fetchError)) {
                void checkAccess();
              }
            });
          void checkAccess();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setConnection("offline");
          if (error) {
            console.warn("Live group chat is unavailable:", error.message);
          }
        }
      },
    );
  }, [revoked, group.id, myId, receive, checkAccess]);

  /** Save a message; on failure it stays on screen with a retry. */
  async function deliver(message: GroupChatMessage) {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("group_messages")
      .insert({ id: message.id, group_id: group.id, sender_id: myId, content: message.content })
      .select()
      .single();
    if (data) {
      receive([data]);
      return;
    }
    if (isAlreadySaved(error)) {
      // An earlier try got through even though its reply was lost: fetch the
      // saved copy so it carries the database's time.
      const { data: saved } = await supabase.from("group_messages").select("*").eq("id", message.id).maybeSingle();
      if (saved) {
        receive([saved]);
        return;
      }
    }
    dispatch({ type: "failed", id: message.id });
    if (looksLikeAccessLoss(error)) {
      void checkAccess();
    }
  }

  function send(text: string) {
    const content = text.trim().slice(0, MESSAGE_MAX);
    if (!content) {
      return;
    }
    // The id is made here, so every copy of this message shares it.
    const message = optimisticMessage({ id: newUuid(), groupId: group.id, senderId: myId, content });
    seen.current.add(message.id);
    pendingScroll.current = "smooth";
    dispatch({ type: "send", message });
    void deliver(message);
  }

  function retry(message: GroupChatMessage) {
    dispatch({ type: "retry", id: message.id });
    void deliver(message);
  }

  /** Older messages, keeping the reader's place. */
  async function loadEarlier() {
    const oldest = chat.messages.find((message) => message.status === "sent");
    if (!oldest || loadingEarlier) {
      return;
    }
    setLoadingEarlier(true);
    setEarlierFailed(false);
    const { data, error } = await createClient()
      .from("group_messages")
      .select("*")
      .eq("group_id", group.id)
      .or(`created_at.lt.${oldest.created_at},and(created_at.eq.${oldest.created_at},id.lt.${oldest.id})`)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(CHAT_PAGE + 1);
    setLoadingEarlier(false);
    if (error || !data) {
      setEarlierFailed(true);
      if (looksLikeAccessLoss(error)) {
        void checkAccess();
      }
      return;
    }
    const rows = data.slice(0, CHAT_PAGE);
    for (const row of rows) {
      seen.current.add(row.id);
    }
    setHasEarlier(data.length > CHAT_PAGE);
    anchor.current = document.documentElement.scrollHeight;
    dispatch({ type: "receive", rows });
    void ensurePeople(rows.flatMap((row) => [row.sender_id, row.subject_id, row.actor_id]));
  }

  if (revoked) {
    return (
      <AppShell
        header={
          <Link
            href="/groups"
            className="hover:bg-charcoal/5 focus-visible:outline-accent -ml-2 inline-flex min-h-12 items-center gap-2 rounded-full pr-4 pl-2 font-semibold focus-visible:outline-2"
          >
            Groups
          </Link>
        }
      >
        <div role="alert" className="rounded-card border-line flex flex-col items-center border border-dashed px-6 py-14 text-center">
          <span className="bg-accent-soft text-accent-strong flex size-14 items-center justify-center rounded-full">
            <LockKeyhole aria-hidden="true" className="size-7" />
          </span>
          <h1 className="font-display mt-4 text-2xl font-semibold">You&apos;re no longer in this group</h1>
          <p className="text-muted mt-2 max-w-xs text-sm leading-relaxed">
            The conversation is only for current members, so it&apos;s closed for you now.
          </p>
          <ButtonLink href="/groups" className="mt-6">
            Back to Groups
          </ButtonLink>
        </div>
      </AppShell>
    );
  }

  const items = layoutMessages(chat.messages);
  const hasUserMessages = chat.messages.some((message) => message.message_type === "user");

  return (
    <AppShell
      header={
        <GroupChatHeader
          groupId={group.id}
          name={group.name}
          avatarUrl={group.avatar_url}
          members={members}
          connection={connection}
          myId={myId}
        />
      }
      footer={
        <Composer
          name={group.name}
          starters={[]}
          onSend={send}
          newBelow={newBelow}
          onJumpToNew={() => {
            setNewBelow(false);
            scrollToEnd("smooth");
          }}
          isOffline={connection === "offline"}
          offlineNote="Live updates are paused while we reconnect. New messages may be delayed."
          showCount
        />
      }
    >
      {hasEarlier && (
        <div className="mb-4 text-center">
          <button
            type="button"
            onClick={() => void loadEarlier()}
            disabled={loadingEarlier}
            className="text-charcoal border-line bg-surface hover:border-charcoal/40 focus-visible:outline-accent inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold focus-visible:outline-2 disabled:opacity-60"
          >
            {loadingEarlier && <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />}
            {loadingEarlier ? "Loading…" : "Load earlier messages"}
          </button>
          {earlierFailed && (
            <p role="alert" className="text-accent-strong mt-2 text-sm">
              Couldn&apos;t load earlier messages. Try again.
            </p>
          )}
        </div>
      )}

      <ol aria-label={`Messages in ${group.name}`}>
        {items.map(({ message, startsDay, startsRun, endsRun }) => {
          const mine = message.sender_id === myId;
          const sender = message.sender_id ? people[message.sender_id] : undefined;
          const senderName = sender?.name ?? "Former member";
          return (
            <Fragment key={message.id}>
              {startsDay && (
                <li className="text-muted py-3 text-center text-xs font-semibold">{dayLabel(message.created_at, days)}</li>
              )}
              {message.message_type === "system" ? (
                <li className="my-2 flex justify-center">
                  <p className="bg-charcoal/5 text-muted rounded-full px-3 py-1 text-center text-xs font-medium">
                    {systemMessageText(message, nameOf)}
                  </p>
                </li>
              ) : (
                <li className={`flex gap-2 ${mine ? "justify-end" : "justify-start"} ${startsRun && !startsDay ? "mt-4" : "mt-1"}`}>
                  {!mine && (
                    <div className="w-8 shrink-0 self-end">
                      {endsRun && <Avatar url={sender?.avatarUrl ?? null} name={senderName} className="size-8 rounded-full text-xs" />}
                    </div>
                  )}
                  <div className={`flex max-w-[80%] flex-col ${mine ? "items-end" : "items-start"}`}>
                    {!mine && startsRun && <p className="text-muted mb-1 px-1 text-xs font-semibold">{senderName}</p>}
                    <p
                      className={`rounded-3xl px-4 py-2.5 text-[15px] leading-snug break-words whitespace-pre-wrap ${
                        mine ? "bg-charcoal text-cream rounded-br-lg" : "bg-surface border-line rounded-bl-lg border"
                      } ${message.status === "sending" ? "opacity-70" : ""}`}
                    >
                      <span className="sr-only">{mine ? "You" : senderName}: </span>
                      {message.content}
                    </p>
                    {message.status === "failed" ? (
                      <button
                        type="button"
                        onClick={() => retry(message)}
                        className="text-accent-strong focus-visible:outline-accent min-h-12 rounded-lg px-2 text-xs font-semibold focus-visible:outline-2"
                      >
                        Not sent. Tap to retry
                      </button>
                    ) : (
                      endsRun && (
                        <p className="text-muted mt-1 px-1 text-[11px]">
                          {message.status === "sending" ? "Sending…" : <time dateTime={message.created_at}>{clockTime(message.created_at)}</time>}
                        </p>
                      )
                    )}
                  </div>
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>

      {!hasUserMessages && (
        <p className="text-muted mt-6 text-center text-sm">No messages yet. Say hello to the group!</p>
      )}

      {/* Read out new messages from other people. */}
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </AppShell>
  );
}
