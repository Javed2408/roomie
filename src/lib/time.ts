/**
 * Dates and times as Roomie shows them. Everyone using the app is at SRM
 * KTR, so times are always India time. Using one fixed time zone also means
 * the server and the browser always print the same text.
 */

const TIME_ZONE = "Asia/Kolkata";
const DAY_MS = 86_400_000;

const dayKeyFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const clockFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
});
const weekdayFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: TIME_ZONE,
  weekday: "short",
});
const shortDateFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: TIME_ZONE,
  day: "numeric",
  month: "short",
});
const longDateFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
});

/** Today and yesterday as day keys, worked out once on the server. */
export type Days = { today: string; yesterday: string };

/** The calendar day in India, e.g. "2026-11-22". */
export function dayKey(date: string | number): string {
  return dayKeyFormat.format(new Date(date));
}

export function currentDays(now: number = Date.now()): Days {
  return { today: dayKey(now), yesterday: dayKey(now - DAY_MS) };
}

/** "2:05 pm" */
export function clockTime(iso: string): string {
  return clockFormat.format(new Date(iso));
}

/** For dividers in a chat: "Today", "Yesterday" or "Sat, 22 Nov". */
export function dayLabel(iso: string, days: Days): string {
  const key = dayKey(iso);
  if (key === days.today) {
    return "Today";
  }
  if (key === days.yesterday) {
    return "Yesterday";
  }
  return longDateFormat.format(new Date(iso));
}

/** Short, for lists: "Now", "12m", "3h", "Yesterday", "Mon" or "12 Nov". */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  const minutes = Math.max(0, Math.floor((now - then) / 60_000));
  if (minutes < 1) {
    return "Now";
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const days = currentDays(now);
  const key = dayKey(then);
  if (key === days.today) {
    return `${Math.floor(minutes / 60)}h`;
  }
  if (key === days.yesterday) {
    return "Yesterday";
  }
  if (now - then < 6 * DAY_MS) {
    return weekdayFormat.format(then);
  }
  return shortDateFormat.format(then);
}
