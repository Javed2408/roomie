import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";

import type { Database } from "@/types/database";

import { supabaseEnv } from "./env";

/**
 * Supabase for Server Components, Server Actions and Route Handlers.
 *
 * Create a new one for every request: never share a client between
 * requests, or one person's session could leak into another's.
 */
export async function createClient() {
  // Cookies first: they only exist when someone visits, so Next.js stops
  // here while prerendering instead of needing Supabase at build time.
  const cookieStore = await cookies();
  // Session checks compare against the current time (Date.now), so make
  // it explicit that everything after this runs only for a real request.
  await connection();
  const { url, key } = supabaseEnv();

  return createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. That is fine: `src/proxy.ts`
          // refreshes the session on every request and saves the cookies.
        }
      },
    },
  });
}
