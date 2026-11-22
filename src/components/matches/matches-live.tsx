"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { subscribeAsUser } from "@/lib/supabase/realtime";
import { newUuid } from "@/lib/uuid";

/**
 * Keeps the matches list current: when a message arrives in any of your
 * chats, the list re-renders with the new preview and order. Realtime only
 * sends you messages from your own matches (row-level security).
 */
export function MatchesLive() {
  const router = useRouter();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const leave = subscribeAsUser((supabase) =>
      supabase
        // A fresh name each time, so a quick unmount and remount never
        // reuses a channel that is still closing.
        .channel(`matches-list:${newUuid()}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages" },
          () => {
            // Several messages at once cause one refresh, not several.
            clearTimeout(timer);
            timer = setTimeout(() => router.refresh(), 300);
          },
        ),
    );
    return () => {
      clearTimeout(timer);
      leave();
    };
  }, [router]);

  return null;
}
