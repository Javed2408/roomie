/**
 * The Supabase project address and public (publishable) key.
 *
 * Not set up yet. When the time comes, put them in `.env.local` (which is
 * never committed):
 *
 *   NEXT_PUBLIC_SUPABASE_URL=...
 *   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
 *
 * Each variable is written out in full so Next.js can include it in the
 * browser bundle; building the name dynamically would break that. The
 * secret (service role) key must never get a NEXT_PUBLIC_ name.
 */
export function supabaseEnv(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local.",
    );
  }
  return { url, key };
}
