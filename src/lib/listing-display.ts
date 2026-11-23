/**
 * How a listing is described in words, the same everywhere.
 * Plain module, so it can be tested directly.
 */

const dateFormat = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
});
const dayFormat = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

/** "Estancia · 2BHK" */
export function listingTitle(listing: { society: string; bhk_type: string }): string {
  return `${listing.society} · ${listing.bhk_type}`;
}

/** "12 Nov 2026" */
export function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}

/**
 * When the spot is free. `today` is YYYY-MM-DD (India); a date on or
 * before it means it's free now. Today is only worked out when needed.
 */
export function availabilityLabel(availableFrom: string | null, today?: string): string {
  if (!availableFrom) {
    return "Available now";
  }
  const now = today ?? new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
  if (availableFrom <= now) {
    return "Available now";
  }
  return `Available from ${dayFormat.format(new Date(`${availableFrom}T00:00:00Z`))}`;
}

/** "1 room free · 2 spots open" */
export function spaceLabel(listing: { available_rooms: number; vacant_spots: number }): string {
  const rooms = `${listing.available_rooms} ${listing.available_rooms === 1 ? "room" : "rooms"} free`;
  const spots = `${listing.vacant_spots} ${listing.vacant_spots === 1 ? "spot" : "spots"} open`;
  return `${rooms} · ${spots}`;
}
