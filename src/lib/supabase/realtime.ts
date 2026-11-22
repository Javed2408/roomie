import type { RealtimeChannel } from "@supabase/supabase-js";

import { createClient } from "./client";

type BrowserClient = ReturnType<typeof createClient>;
type StatusCallback = NonNullable<Parameters<RealtimeChannel["subscribe"]>[0]>;

/**
 * Listen on a Realtime channel as the signed-in person.
 *
 * Realtime checks row-level security with the token the channel joined
 * with. Joining before the session's token is attached counts as an
 * anonymous visitor, who may read nothing, and Supabase refuses the
 * subscription. So the token is attached first (`realtime.setAuth()`),
 * then the channel subscribes.
 *
 * Returns a function that leaves the channel (use it as an effect's
 * cleanup).
 */
export function subscribeAsUser(
  build: (supabase: BrowserClient) => RealtimeChannel,
  onStatus?: StatusCallback,
): () => void {
  const supabase = createClient();
  let channel: RealtimeChannel | null = null;
  let stopped = false;

  void supabase.realtime
    .setAuth()
    .catch((error: unknown) => {
      console.warn("Couldn't attach the session to Realtime:", error);
    })
    .then(() => {
      if (!stopped) {
        channel = build(supabase).subscribe(onStatus);
      }
    });

  return () => {
    stopped = true;
    if (channel) {
      void supabase.removeChannel(channel);
    }
  };
}
