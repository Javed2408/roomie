import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/types/database";

import { supabaseEnv } from "./env";

/**
 * Refresh the signed-in person's session before the page renders.
 *
 * Supabase sessions expire after a while. Server Components cannot save
 * cookies, so this runs first on every request: it checks the session,
 * renews it if needed and passes the fresh cookies both to the page being
 * rendered and back to the browser.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, key } = supabaseEnv();

  const supabase = createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        // Stops a CDN from caching a page that carries someone's session.
        for (const [header, value] of Object.entries(headers)) {
          response.headers.set(header, value);
        }
      },
    },
  });

  // Do not put code between creating the client and this call: it is what
  // validates (and if needed renews) the session.
  const { data } = await supabase.auth.getClaims();

  // Signed-in visitors skip the marketing page and go straight to the
  // feed (which sends anyone who hasn't finished onboarding there first).
  if (data?.claims && request.nextUrl.pathname === "/") {
    const redirect = NextResponse.redirect(new URL("/discover", request.url));
    for (const cookie of response.cookies.getAll()) {
      redirect.cookies.set(cookie);
    }
    return redirect;
  }

  return response;
}
