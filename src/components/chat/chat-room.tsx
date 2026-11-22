"use client";

import { Heart } from "lucide-react";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";

import { ChatHeader } from "@/components/chat/chat-header";
import { Composer } from "@/components/chat/composer";
import { AppShell } from "@/components/ui/app-shell";
import { SafetyTip } from "@/components/ui/safety-tip";
import { MESSAGE_MAX } from "@/lib/constants/prompts";
import { createClient } from "@/lib/supabase/client";
import { subscribeAsUser } from "@/lib/supabase/realtime";
import { clockTime, dayKey, dayLabel, type Days } from "@/lib/time";
import { newUuid } from "@/lib/uuid";
import type { MessageRow } from "@/types/database";
import { firstName, type Candidate } from "@/types/feed";
import type { ChatMessage, ChatOpener } from "@/types/matches";

/** Messages closer together than this, from one person, form one group. */
const GROUP_GAP_MS = 5 * 60_000;
/** How close to the bottom still counts as "reading the latest". */
const NEAR_BOTTOM_PX = 120;

/**
 * Add messages to the list, each once. A message can arrive up to three
 * ways (our own optimistic copy, the insert's reply, the live echo), but
 * it always has the same id, so the first confirmed copy wins and the
 * rest are ignored. Confirmed messages are ordered by the database's
 * time; ones still on their way stay at the end.
 */
function mergeMessages(list: ChatMessage[], rows: MessageRow[]): ChatMessage[] {
  const byId = new Map(list.map((message) => [message.id, message]));
  let changed = false;
  for (const row of rows) {
    if (byId.get(row.id)?.status === "sent") {
      continue;
    }
    byId.set(row.id, { ...row, status: "sent" });
    changed = true;
  }
  if (!changed) {
    return list;
  }
  return [...byId.values()].sort(
    (a, b) =>
      Number(a.status !== "sent") - Number(b.status !== "sent") ||
      Date.parse(a.created_at) - Date.parse(b.created_at) ||
      a.id.localeCompare(b.id),
  );
}

function scrollToEnd(behavior: ScrollBehavior) {
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior });
}

/** How the conversation started, pinned at the top like Hinge does. */
function Opener({
  opener,
  matchedLabel,
}: {
  opener: ChatOpener | null;
  matchedLabel: string;
}) {
  return (
    <div className="mb-6">
      <p className="text-muted mb-3 text-center text-xs font-semibold tracking-wide uppercase">
        You matched {matchedLabel}
      </p>
      {opener && (
        <div className="bg-surface border-line rounded-card border p-4">
          <p className="flex items-start gap-2 text-sm font-semibold">
            <Heart
              aria-hidden="true"
              className="text-accent mt-0.5 size-4 shrink-0"
              fill="currentColor"
            />
            {opener.liker} liked {opener.liked.phrase}
          </p>
          {(opener.liked.imageUrl || opener.liked.detail) && (
            <div className="mt-3 flex items-center gap-3">
              {opener.liked.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URL
                <img
                  src={opener.liked.imageUrl}
                  alt=""
                  className="size-16 shrink-0 rounded-xl object-cover"
                />
              )}
              {opener.liked.detail && (
                <p className="font-display text-lg leading-snug">{opener.liked.detail}</p>
              )}
            </div>
          )}
          {opener.comment && (
            <figure className="mt-3">
              <blockquote className="bg-accent-soft rounded-2xl rounded-tl-md px-4 py-3">
                “{opener.comment}”
              </blockquote>
              <figcaption className="text-muted mt-1 text-xs">{opener.commenter}</figcaption>
            </figure>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A live one-to-one chat. The server sends the history; new messages
 * arrive over Supabase Realtime, so nobody has to refresh.
 */
export function ChatRoom({
  myId,
  matchId,
  matchedAt,
  them,
  opener,
  messages: history,
  starters,
  days,
}: {
  myId: string;
  matchId: string;
  matchedAt: string;
  them: Candidate;
  opener: ChatOpener | null;
  /** Oldest first. */
  messages: MessageRow[];
  starters: readonly string[];
  /** "Today" and "Yesterday", as the server saw them. */
  days: Days;
}) {
  const name = firstName(them.profile);
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    history.map((message) => ({ ...message, status: "sent" })),
  );
  const [isOffline, setIsOffline] = useState(false);
  const [newBelow, setNewBelow] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  /** Every message id this screen has shown, to spot genuinely new ones. */
  const seen = useRef(new Set(history.map((message) => message.id)));
  /** Is the reader looking at the newest messages? */
  const atBottom = useRef(true);
  /** Scroll to the end after the next render (starts at the newest). */
  const pendingScroll = useRef<ScrollBehavior | null>("instant");

  /** Take in messages from the live feed or a catch-up fetch. */
  const receive = useCallback(
    (rows: MessageRow[]) => {
      const fresh = rows.filter((row) => !seen.current.has(row.id));
      for (const row of fresh) {
        seen.current.add(row.id);
      }
      setMessages((list) => mergeMessages(list, rows));

      const fromThem = fresh.filter((row) => row.sender_id !== myId);
      const latest = fromThem.at(-1);
      if (latest) {
        // Follow along if they're reading the latest; otherwise don't yank
        // them away from older messages, just offer a button.
        if (atBottom.current) {
          pendingScroll.current = "smooth";
        } else {
          setNewBelow(true);
        }
        setAnnouncement(`New message from ${name}: ${latest.content}`);
      }
    },
    [myId, name],
  );

  // After each render that added messages, scroll if one was asked for.
  useEffect(() => {
    const behavior = pendingScroll.current;
    if (!behavior) {
      return;
    }
    pendingScroll.current = null;
    // Next frame: after the browser has laid out the new message.
    const frame = requestAnimationFrame(() => scrollToEnd(behavior));
    return () => cancelAnimationFrame(frame);
  }, [messages]);

  // Track whether the reader is at the bottom.
  useEffect(() => {
    function onScroll() {
      const page = document.documentElement;
      atBottom.current =
        window.innerHeight + window.scrollY >= page.scrollHeight - NEAR_BOTTOM_PX;
      if (atBottom.current) {
        setNewBelow(false);
      }
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Live messages for this match only. Realtime still checks row-level
  // security, so only the two people in the match receive them.
  useEffect(() => {
    const supabase = createClient();
    return subscribeAsUser(
      (client) =>
        client
          // A fresh name each time, so a quick unmount and remount (React
          // does this in development) never reuses a closing channel.
          .channel(`chat:${matchId}:${newUuid()}`, {
            // Report "subscribed" only once changes are really streaming.
            config: { postgres_changes_options: { wait: true } },
          })
          .on<MessageRow>(
            "postgres_changes",
            {
              event: "INSERT",
              schema: "public",
              table: "messages",
              filter: `match_id=eq.${matchId}`,
            },
            (payload) => receive([payload.new]),
          ),
      (status, error) => {
        if (status === "SUBSCRIBED") {
          setIsOffline(false);
          // Catch up on anything sent while we were connecting (or while
          // the connection dropped): duplicates are ignored.
          void supabase
            .from("messages")
            .select("*")
            .eq("match_id", matchId)
            .order("created_at", { ascending: false })
            .limit(50)
            .then(({ data }) => {
              if (data) {
                receive(data);
              }
            });
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setIsOffline(true);
          if (error) {
            console.warn("Live chat is unavailable:", error.message);
          }
        }
      },
    );
  }, [matchId, receive]);

  /** Save a message; on failure it stays on screen with a retry. */
  async function deliver(message: ChatMessage) {
    const { data, error } = await createClient()
      .from("messages")
      .insert({
        id: message.id,
        match_id: matchId,
        sender_id: myId,
        content: message.content,
      })
      .select()
      .single();
    if (data) {
      receive([data]);
      return;
    }
    // 23505: it was already saved (an earlier try got through even though
    // its reply was lost), so it's sent.
    const status = error?.code === "23505" ? "sent" : "failed";
    setMessages((list) =>
      list.map((item) =>
        item.id === message.id && item.status !== "sent" ? { ...item, status } : item,
      ),
    );
  }

  function send(text: string) {
    const content = text.trim().slice(0, MESSAGE_MAX);
    if (!content) {
      return;
    }
    // The id is made here, so every copy of this message shares it.
    const message: ChatMessage = {
      id: newUuid(),
      match_id: matchId,
      sender_id: myId,
      content,
      created_at: new Date().toISOString(),
      status: "sending",
    };
    seen.current.add(message.id);
    pendingScroll.current = "smooth";
    setMessages((list) => [...list, message]);
    void deliver(message);
  }

  function retry(message: ChatMessage) {
    setMessages((list) =>
      list.map((item) => (item.id === message.id ? { ...item, status: "sending" } : item)),
    );
    void deliver(message);
  }

  const matchedLabel = (() => {
    const label = dayLabel(matchedAt, days);
    return label === "Today" || label === "Yesterday" ? label.toLowerCase() : `on ${label}`;
  })();

  return (
    <AppShell
      header={<ChatHeader them={them} />}
      footer={
        <Composer
          name={name}
          starters={messages.length === 0 ? starters : []}
          onSend={send}
          newBelow={newBelow}
          onJumpToNew={() => {
            setNewBelow(false);
            scrollToEnd("smooth");
          }}
          isOffline={isOffline}
        />
      }
    >
      <Opener opener={opener} matchedLabel={matchedLabel} />
      <SafetyTip className="mb-6" />

      {messages.length === 0 ? (
        <p className="text-muted text-center text-sm">
          No messages yet. Say hi to {name}!
        </p>
      ) : (
        <ol aria-label={`Messages with ${name}`}>
          {messages.map((message, index) => {
            const previous = messages[index - 1];
            const next = messages[index + 1];
            const day = dayKey(message.created_at);
            const startsDay = !previous || dayKey(previous.created_at) !== day;
            const startsGroup =
              startsDay ||
              previous.sender_id !== message.sender_id ||
              Date.parse(message.created_at) - Date.parse(previous.created_at) > GROUP_GAP_MS;
            const endsGroup =
              !next ||
              next.sender_id !== message.sender_id ||
              dayKey(next.created_at) !== day ||
              Date.parse(next.created_at) - Date.parse(message.created_at) > GROUP_GAP_MS ||
              next.status !== message.status;
            const mine = message.sender_id === myId;

            return (
              <Fragment key={message.id}>
                {startsDay && (
                  <li className="text-muted py-3 text-center text-xs font-semibold">
                    {dayLabel(message.created_at, days)}
                  </li>
                )}
                <li
                  className={`flex flex-col ${mine ? "items-end" : "items-start"} ${
                    startsGroup && !startsDay ? "mt-4" : "mt-1"
                  }`}
                >
                  <p
                    className={`max-w-[80%] rounded-3xl px-4 py-2.5 text-[15px] leading-snug break-words whitespace-pre-wrap ${
                      mine
                        ? "bg-charcoal text-cream rounded-br-lg"
                        : "bg-surface border-line rounded-bl-lg border"
                    } ${message.status === "sending" ? "opacity-70" : ""}`}
                  >
                    <span className="sr-only">{mine ? "You" : name}: </span>
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
                    endsGroup && (
                      <p className="text-muted mt-1 px-1 text-[11px]">
                        {message.status === "sending" ? (
                          "Sending…"
                        ) : (
                          <time dateTime={message.created_at}>
                            {clockTime(message.created_at)}
                          </time>
                        )}
                      </p>
                    )
                  )}
                </li>
              </Fragment>
            );
          })}
        </ol>
      )}

      {/* Read out new messages from the other person. */}
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </AppShell>
  );
}
