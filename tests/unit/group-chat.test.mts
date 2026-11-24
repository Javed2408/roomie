/**
 * The logic behind the group chat screen (src/lib/group-chat.ts): merging
 * live and fetched messages, optimistic sends, retries, layout, system
 * message wording, unread labels and losing access.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  chatPreview,
  chatReducer,
  displayName,
  initialChatState,
  isAlreadySaved,
  layoutMessages,
  looksLikeAccessLoss,
  mergeGroupMessages,
  newestConfirmedAt,
  optimisticMessage,
  systemMessageText,
  unreadLabel,
  type GroupChatMessage,
} from "../../src/lib/group-chat.ts";
import type { GroupMessageRow } from "../../src/types/database.ts";

const GROUP = "g1";
let counter = 0;
function row(change: Partial<GroupMessageRow> & { id?: string } = {}): GroupMessageRow {
  counter += 1;
  return {
    id: change.id ?? `m${String(counter).padStart(3, "0")}`,
    group_id: GROUP,
    sender_id: "asha",
    message_type: "user",
    content: `message ${counter}`,
    system_kind: null,
    subject_id: null,
    actor_id: null,
    event_id: null,
    created_at: "2026-11-24T10:00:00.000Z",
    ...change,
  };
}
const at = (minutes: number, day = "2026-11-24") => `${day}T${String(10 + Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:00.000Z`;
const nameOf = (id: string | null) => ({ asha: "Asha", ravi: "Ravi" })[id ?? ""] ?? "A member";
const sent = (message: GroupMessageRow): GroupChatMessage => ({ ...message, status: "sent" });

describe("showing messages once, in order", () => {
  it("keeps the database's order, whatever order they arrive in", () => {
    const later = row({ id: "b", created_at: at(5) });
    const earlier = row({ id: "a", created_at: at(1) });
    const merged = mergeGroupMessages([], [later, earlier]);
    assert.deepEqual(merged.map((message) => message.id), ["a", "b"]);
  });

  it("breaks ties by id, so the order is the same everywhere", () => {
    const first = row({ id: "a", created_at: at(1) });
    const second = row({ id: "b", created_at: at(1) });
    assert.deepEqual(mergeGroupMessages([], [second, first]).map((message) => message.id), ["a", "b"]);
  });

  it("ignores a message it already has: the live echo, the reply and a catch-up are one message", () => {
    const original = row({ id: "x", created_at: at(2) });
    let list = mergeGroupMessages([], [original]);
    const again = mergeGroupMessages(list, [original, original]);
    assert.equal(again, list, "nothing changed, so the same list is kept");
    list = mergeGroupMessages(list, [row({ id: "y", created_at: at(3) }), original]);
    assert.equal(list.length, 2);
  });

  it("replaces the optimistic copy with the confirmed one, taking the database's time", () => {
    const pending = optimisticMessage({ id: "p1", groupId: GROUP, senderId: "ravi", content: "hello", now: new Date("2026-11-24T09:00:00Z") });
    assert.equal(pending.status, "sending");
    const confirmed = row({ id: "p1", sender_id: "ravi", content: "hello", created_at: at(7) });
    const merged = mergeGroupMessages([sent(row({ id: "old", created_at: at(1) })), pending], [confirmed]);
    assert.deepEqual(merged.map((message) => [message.id, message.status]), [["old", "sent"], ["p1", "sent"]]);
    assert.equal(merged[1].created_at, confirmed.created_at);
  });

  it("keeps messages still on their way after the confirmed ones", () => {
    const pending = optimisticMessage({ id: "p", groupId: GROUP, senderId: "ravi", content: "x", now: new Date("2020-01-01T00:00:00Z") });
    const merged = mergeGroupMessages([pending], [row({ id: "a", created_at: at(9) })]);
    assert.deepEqual(merged.map((message) => message.id), ["a", "p"]);
  });
});

describe("sending, failing and retrying", () => {
  const start = () => initialChatState([row({ id: "h1", created_at: at(1) })]);
  const pending = optimisticMessage({ id: "p1", groupId: GROUP, senderId: "ravi", content: "hi" });

  it("shows a sent message at once, and only once", () => {
    let state = chatReducer(start(), { type: "send", message: pending });
    state = chatReducer(state, { type: "send", message: pending });
    assert.deepEqual(state.messages.map((message) => message.id), ["h1", "p1"]);
    assert.equal(state.messages[1].status, "sending");
  });

  it("marks a failure, lets it be retried, and doesn't touch confirmed messages", () => {
    let state = chatReducer(start(), { type: "send", message: pending });
    state = chatReducer(state, { type: "failed", id: "p1" });
    assert.equal(state.messages[1].status, "failed");
    state = chatReducer(state, { type: "retry", id: "p1" });
    assert.equal(state.messages[1].status, "sending");
    const before = state;
    state = chatReducer(state, { type: "failed", id: "h1" });
    assert.equal(state, before, "a confirmed message can't fail");
  });

  it("settles on one copy when a retry succeeds after the first try actually got through", () => {
    let state = chatReducer(start(), { type: "send", message: pending });
    state = chatReducer(state, { type: "failed", id: "p1" });
    state = chatReducer(state, { type: "receive", rows: [row({ id: "p1", sender_id: "ravi", content: "hi", created_at: at(4) })] });
    state = chatReducer(state, { type: "receive", rows: [row({ id: "p1", sender_id: "ravi", content: "hi", created_at: at(4) })] });
    assert.deepEqual(state.messages.map((message) => [message.id, message.status]), [["h1", "sent"], ["p1", "sent"]]);
  });

  it("recognises 'already saved' and 'not allowed' errors", () => {
    assert.equal(isAlreadySaved({ code: "23505" }), true);
    assert.equal(isAlreadySaved({ code: "08006" }), false);
    assert.equal(looksLikeAccessLoss({ code: "42501" }), true);
    assert.equal(looksLikeAccessLoss({ message: 'new row violates row-level security policy for table "group_messages"' }), true);
    assert.equal(looksLikeAccessLoss({ code: "PGRST000", message: "Failed to fetch" }), false);
    assert.equal(looksLikeAccessLoss(null), false);
  });
});

describe("losing access while the chat is open", () => {
  it("clears every message and refuses anything more", () => {
    let state = initialChatState([row({ id: "a" }), row({ id: "b" })]);
    state = chatReducer(state, { type: "revoke" });
    assert.deepEqual(state, { messages: [], revoked: true });
    state = chatReducer(state, { type: "receive", rows: [row({ id: "late" })] });
    state = chatReducer(state, { type: "send", message: optimisticMessage({ id: "n", groupId: GROUP, senderId: "ravi", content: "still here?" }) });
    assert.deepEqual(state.messages, [], "nothing protected comes back, from the live feed or the composer");
    assert.equal(state.revoked, true);
  });
});

describe("reading position", () => {
  it("is the newest confirmed message, ignoring ones still sending", () => {
    const pending = optimisticMessage({ id: "p", groupId: GROUP, senderId: "ravi", content: "x", now: new Date("2030-01-01T00:00:00Z") });
    const list = [sent(row({ created_at: at(1) })), sent(row({ created_at: at(8) })), pending];
    assert.equal(newestConfirmedAt(list), at(8));
    assert.equal(newestConfirmedAt([pending]), null);
    assert.equal(newestConfirmedAt([]), null);
  });

  it("labels unread counts", () => {
    assert.equal(unreadLabel(0), null);
    assert.equal(unreadLabel(-3), null);
    assert.equal(unreadLabel(7), "7");
    assert.equal(unreadLabel(99), "99");
    assert.equal(unreadLabel(100), "99+");
    assert.equal(unreadLabel(Number.NaN), null);
  });
});

describe("laying messages out", () => {
  it("starts a day separator at each new day, and a new run at each new sender", () => {
    const list = [
      sent(row({ id: "1", sender_id: "asha", created_at: at(0, "2026-11-23") })),
      sent(row({ id: "2", sender_id: "asha", created_at: at(1, "2026-11-24") })),
      sent(row({ id: "3", sender_id: "asha", created_at: at(2, "2026-11-24") })),
      sent(row({ id: "4", sender_id: "ravi", created_at: at(3, "2026-11-24") })),
    ];
    const layout = layoutMessages(list);
    assert.deepEqual(layout.map((item) => item.startsDay), [true, true, false, false]);
    assert.deepEqual(layout.map((item) => item.startsRun), [true, true, false, true]);
    assert.deepEqual(layout.map((item) => item.endsRun), [true, false, true, true]);
  });

  it("splits a run after a long pause", () => {
    const list = [
      sent(row({ id: "1", created_at: at(0) })),
      sent(row({ id: "2", created_at: at(20) })),
    ];
    assert.deepEqual(layoutMessages(list).map((item) => item.startsRun), [true, true]);
  });

  it("keeps system messages on their own, breaking the runs around them", () => {
    const list = [
      sent(row({ id: "1", sender_id: "asha", created_at: at(0) })),
      sent(row({ id: "2", sender_id: null, message_type: "system", content: null, system_kind: "joined", subject_id: "ravi", created_at: at(1) })),
      sent(row({ id: "3", sender_id: "asha", created_at: at(2) })),
    ];
    const layout = layoutMessages(list);
    assert.deepEqual(layout.map((item) => item.startsRun), [true, true, true]);
    assert.deepEqual(layout.map((item) => item.endsRun), [true, true, true]);
  });

  it("handles an empty conversation", () => {
    assert.deepEqual(layoutMessages([]), []);
  });
});

describe("wording", () => {
  it("describes each kind of system message", () => {
    const say = (system_kind: GroupMessageRow["system_kind"], subject_id: string | null, actor_id: string | null = null) =>
      systemMessageText({ system_kind, subject_id, actor_id }, nameOf);
    assert.equal(say("joined", "ravi"), "Ravi joined the group");
    assert.equal(say("left", "ravi"), "Ravi left the group");
    assert.equal(say("removed", "ravi", "asha"), "Asha removed Ravi");
    assert.equal(say("removed", "ravi"), "Ravi was removed from the group");
    assert.equal(say("made_admin", "ravi"), "Ravi is now an admin");
    assert.equal(say("removed_admin", "ravi"), "Ravi is no longer an admin");
    assert.equal(say("joined", null), "A member joined the group");
  });

  it("previews the latest message", () => {
    const base = { last_id: "m", last_type: "user" as const, last_content: "see you at 5", last_sender_id: "ravi", last_system_kind: null, last_subject_id: null, last_actor_id: null };
    assert.equal(chatPreview(base, nameOf, "asha"), "Ravi: see you at 5");
    assert.equal(chatPreview({ ...base, last_sender_id: "asha" }, nameOf, "asha"), "You: see you at 5");
    assert.equal(chatPreview({ ...base, last_type: "system", last_content: null, last_system_kind: "joined", last_subject_id: "ravi" }, nameOf), "Ravi joined the group");
    assert.equal(chatPreview({ ...base, last_id: null }, nameOf), "No messages yet");
  });

  it("uses first names", () => {
    assert.equal(displayName("Ravi Kumar"), "Ravi");
    assert.equal(displayName("  "), "A member");
    assert.equal(displayName(null, "Former member"), "Former member");
  });
});
