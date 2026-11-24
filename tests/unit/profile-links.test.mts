/**
 * Chat photos and names that open a member's profile
 * (src/lib/profile-links.ts, rendered by src/components/chat/profile-link.tsx
 * in the one-to-one chat header and next to group chat messages).
 *
 * The repo has no DOM test tooling, so these test the rules the components
 * apply: where each photo and name leads, which ones stay plain, how the
 * links behave for keyboard and screen-reader users, and that a click stops
 * at the link.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  groupSenderProfile,
  keepClickOnLink,
  profileHref,
  profileLinkAttributes,
} from "../../src/lib/profile-links.ts";

const ME = "00e66b2c-73aa-49e1-94c0-311da4ba608c";
const JADEN = "fdbe83e3-c934-4afc-b4a9-83537a363580";
const people = { [ME]: { name: "Javed" }, [JADEN]: { name: "Jaden" } };
const userMessage = (sender_id: string | null) => ({ message_type: "user" as const, sender_id });

describe("one-to-one chat header", () => {
  it("opens the other person's profile from their photo and name (one shared link)", () => {
    assert.equal(profileHref(JADEN), `/students/${JADEN}`);
    assert.deepEqual(profileLinkAttributes("name"), {}, "a normal, focusable link");
  });
});

describe("group chat messages", () => {
  it("opens the sender's profile from their photo", () => {
    assert.equal(groupSenderProfile(userMessage(JADEN), people), `/students/${JADEN}`);
    assert.deepEqual(profileLinkAttributes("photo"), { tabIndex: -1, "aria-hidden": true });
  });

  it("opens the same profile from their name", () => {
    const href = groupSenderProfile(userMessage(JADEN), people);
    assert.equal(href, `/students/${JADEN}`);
    assert.deepEqual(profileLinkAttributes("name"), {});
  });

  it("leads to your own profile for your own messages", () => {
    assert.equal(groupSenderProfile(userMessage(ME), people), `/students/${ME}`);
  });

  it("leaves system messages as plain text", () => {
    for (const subject of [JADEN, null]) {
      assert.equal(groupSenderProfile({ message_type: "system", sender_id: null }, { ...people, [subject ?? ""]: {} }), null);
    }
    // Even a malformed row with a sender stays plain if it's a system message.
    assert.equal(groupSenderProfile({ message_type: "system", sender_id: JADEN }, people), null);
  });

  it("shows unavailable profiles as plain text: deleted account, not loaded, or a bad id", () => {
    assert.equal(groupSenderProfile(userMessage(null), people), null, "deleted account (sender cleared)");
    const stranger = "11111111-2222-4333-8444-555555555555";
    assert.equal(groupSenderProfile(userMessage(stranger), people), null, "profile the chat couldn't load");
    assert.equal(groupSenderProfile(userMessage("not-a-uuid"), { "not-a-uuid": { name: "x" } }), null);
    // Only people actually loaded count (not inherited object keys).
    assert.equal(groupSenderProfile(userMessage("constructor"), {}), null);
    assert.equal(groupSenderProfile(userMessage(JADEN), Object.create({ [JADEN]: { name: "Jaden" } })), null);
  });
});

describe("profile links", () => {
  it("use the existing /students/[id] route, and nothing for missing or bad ids", () => {
    assert.equal(profileHref(ME), `/students/${ME}`);
    for (const bad of [null, undefined, "", "../account", `${JADEN}/edit`, "javascript:alert(1)"]) {
      assert.equal(profileHref(bad), null, String(bad));
    }
  });

  it("are reached by keyboard once: the name is tabbable, the photo beside it isn't", () => {
    assert.equal(profileLinkAttributes("name").tabIndex, undefined);
    assert.equal(profileLinkAttributes("name")["aria-hidden"], undefined);
    assert.equal(profileLinkAttributes("photo").tabIndex, -1);
  });

  it("stop the click at the link without blocking the navigation", () => {
    const calls: string[] = [];
    const event = {
      stopPropagation: () => calls.push("stopPropagation"),
      preventDefault: () => calls.push("preventDefault"),
    };
    keepClickOnLink(event);
    assert.deepEqual(calls, ["stopPropagation"]);
  });
});
