# Roomie

A Hinge-style flat and flatmate matching app for SRM KTR (Kattankulathur)
students: browse students and flats around campus (Abode Valley, Estancia,
Akshaya, Green Pearl, Potheri), like a specific prompt, photo or flat with a
comment, match, and chat in real time. Installable on phones as an app (PWA).

Built with Next.js 16 (App Router), TypeScript, Tailwind CSS v4 and Supabase
(auth, Postgres with row-level security, Realtime, storage).

## Run it locally

1. Install: `npm install`
2. Copy `.env.example` to `.env.local` and fill in your Supabase project URL
   and publishable key (Supabase dashboard > Connect).
3. In the Supabase SQL Editor, run every file in `supabase/migrations/` in
   order (each one is safe to run again).
4. Start: `npm run dev`, then open http://localhost:3000

## Scripts

| Command          | What it does                                              |
| ---------------- | --------------------------------------------------------- |
| `npm run dev`    | Development server                                        |
| `npm run build`  | Production build (also type-checks)                       |
| `npm run lint`   | ESLint                                                    |
| `npm run seed`   | Adds 6 sample students (labelled "Sample profile")        |
| `npm run unseed` | Removes the sample students again                         |
| `npm run icons`  | Rebuilds the app icons from `public/icon.svg`             |

`seed` and `unseed` need `SUPABASE_SERVICE_ROLE_KEY` (the Supabase secret
key) in `.env.local`. It is only for these scripts: never commit it, never
add it to Vercel.

## Deploying

Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in
Vercel. In Supabase, turn on **Confirm email**, and add
`https://<your-domain>/auth/confirm` to the Auth redirect URLs. Run
`npm run unseed` before real students sign up.
