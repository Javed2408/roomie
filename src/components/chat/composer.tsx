"use client";

import { ArrowDown, SendHorizontal } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";

import { MESSAGE_MAX } from "@/lib/constants/prompts";

/** The tallest the message box grows before it scrolls, in pixels. */
const MAX_HEIGHT = 160;

/**
 * The message bar fixed to the bottom of the chat. Enter sends,
 * Shift+Enter starts a new line. An empty chat also offers one-tap
 * starter questions.
 */
export function Composer({
  name,
  starters,
  onSend,
  newBelow,
  onJumpToNew,
  isOffline,
}: {
  name: string;
  /** Shown while the chat is empty; tapping one sends it. */
  starters: readonly string[];
  onSend: (text: string) => void;
  /** A message arrived while scrolled up: offer a jump back down. */
  newBelow: boolean;
  onJumpToNew: () => void;
  isOffline: boolean;
}) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const inputId = useId();

  // Grow with the text, up to MAX_HEIGHT; only then show a scrollbar.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) {
      return;
    }
    input.style.height = "auto";
    // scrollHeight leaves out the border, which the box's height includes.
    const border = input.offsetHeight - input.clientHeight;
    const needed = input.scrollHeight + border;
    input.style.height = `${Math.min(needed, MAX_HEIGHT)}px`;
    input.style.overflowY = needed > MAX_HEIGHT ? "auto" : "hidden";
  }, [text]);

  function submit() {
    const message = text.trim();
    if (!message) {
      return;
    }
    onSend(message);
    setText("");
    inputRef.current?.focus();
  }

  return (
    <div className="relative px-3 pt-2.5 pb-2.5">
      {newBelow && (
        <button
          type="button"
          onClick={onJumpToNew}
          className="bg-charcoal text-cream focus-visible:outline-accent absolute -top-14 left-1/2 flex min-h-11 -translate-x-1/2 items-center gap-1.5 rounded-full px-4 text-sm font-semibold shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <ArrowDown aria-hidden="true" className="size-4" />
          New message
        </button>
      )}

      {isOffline && (
        <p className="text-muted mb-2 px-1 text-xs">
          Live updates are paused. Refresh the page to see new messages.
        </p>
      )}

      {starters.length > 0 && (
        <div role="group" aria-label="Quick questions" className="mb-2.5 flex flex-wrap gap-2">
          {starters.map((starter) => (
            <button
              key={starter}
              type="button"
              onClick={() => onSend(starter)}
              className="border-line bg-surface hover:border-charcoal/40 focus-visible:outline-accent min-h-11 rounded-full border px-4 text-left text-sm focus-visible:outline-2"
            >
              {starter}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="flex items-end gap-2"
      >
        <label htmlFor={inputId} className="sr-only">
          Message {name}
        </label>
        <textarea
          id={inputId}
          ref={inputRef}
          rows={1}
          value={text}
          maxLength={MESSAGE_MAX}
          enterKeyHint="send"
          placeholder={`Message ${name}…`}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            // isComposing: Enter also confirms a word in some keyboards
            // (e.g. Hindi or Tamil input); don't send in the middle of that.
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
          className="bg-surface border-line focus:border-charcoal min-h-12 flex-1 resize-none rounded-3xl border px-4 py-3 text-base leading-6 outline-none"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          aria-label="Send message"
          className="bg-charcoal text-cream focus-visible:outline-accent flex size-12 shrink-0 items-center justify-center rounded-full transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40"
        >
          <SendHorizontal aria-hidden="true" className="size-5" />
        </button>
      </form>
    </div>
  );
}
