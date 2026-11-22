import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/types/database";

import { supabaseEnv } from "./env";

/**
 * Supabase for Client Components (code that runs in the browser).
 * The session is kept in cookies so the server can read it too.
 */
export function createClient() {
  const { url, key } = supabaseEnv();
  return createBrowserClient<Database>(url, key);
}
