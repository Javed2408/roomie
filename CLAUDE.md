@AGENTS.md

# Roomie

A Hinge-style flat and flatmate matching mobile web app for SRM KTR
(Kattankulathur) students. Students browse profiles and flats around
campus (societies such as Abode Valley, Estancia, Akshaya and Green Pearl,
and the Potheri area), like what they see, and match with flatmates.

## Tech stack

- Next.js 16 (App Router, Cache Components on) with TypeScript (strict)
- Tailwind CSS v4: design tokens live in `src/app/globals.css` (`@theme`)
- Supabase (`@supabase/supabase-js`, `@supabase/ssr`) for auth, data and storage
- `lucide-react` for icons; ESLint (`eslint-config-next`)

## Folder conventions

- `src/app/` pages, routes, server actions; import via `@/` (e.g. `@/lib/...`)
- `src/components/ui/` building blocks: AppShell, Button, Card, BottomSheet
- `src/components/feed/`, `matches/`, `chat/`, `onboarding/`, `auth/` by screen
- `src/lib/` data loaders and rules; `src/lib/supabase/` has `client.ts`
  (browser), `server.ts` (one per request), `realtime.ts` (`subscribeAsUser`)
- `src/types/` shared types; `database.ts` mirrors the SQL exactly
- `supabase/migrations/` numbered, idempotent SQL; `tests/db/` (`npm test`)
- Data model: `docs/architecture/phase-1-assessment.md`. `profiles.mode` and
  its preference columns are legacy mirrors synced by triggers; group
  membership changes only through the group RPCs.

## Design rules

- Always design mobile-first. Every screen sits inside `AppShell`: full
  width on phones, a 480px-wide centred column on desktop.
- Warm, modern, Hinge-inspired look: cream background `#FAF9F6`
  (`bg-cream`), charcoal text `#1A1A1A` (`text-charcoal`), warm orange
  accent `#E85D04` (`text-accent`) and deep green `#2D6A4F` (`text-forest`).
- Use the tokens, never raw hex values in components. Orange is for
  highlights and icons; use `text-accent-strong` for small orange text and
  charcoal for primary buttons (contrast).
- Serif (`font-display`, Fraunces) for headings and prompts; sans (Geist)
  for everything else.
- Touch targets at least 48px; visible focus rings; icons next to text are
  `aria-hidden`.

## Product rules

- Never show an exact flat number or address publicly; society/area only.
- Label invented example data as "Sample"; never present it as real.
  `npm run seed` / `unseed` add or remove sample students (`is_sample`).
- Secrets never go in code or Git. Supabase keys go in `.env.local`; the
  service-role key is never `NEXT_PUBLIC_` and is used only by `scripts/`.
- Security lives in RLS and column grants. Select profiles with
  `PUBLIC_PROFILE_COLUMNS`, never `*` (email is private). Matches are made
  only by the database trigger.

## Before finishing any phase

Run `npm run lint`, `npm test` and `npm run build`; fix every error. Do not
report a phase as done until all three pass.
