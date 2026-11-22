const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a well-formed id, so bad URLs never reach the database. */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/**
 * A new random (version 4) id.
 *
 * `crypto.randomUUID` only exists on https and localhost, so when the app
 * is opened over plain http (e.g. a phone on the same Wi-Fi) this builds
 * one from `crypto.getRandomValues`, which works everywhere.
 */
export function newUuid(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
