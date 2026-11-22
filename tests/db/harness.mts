/**
 * Test harness: a real Postgres (PGlite, in memory) with the parts of
 * Supabase our migrations rely on, then the migrations themselves.
 *
 * The stand-ins mirror Supabase closely enough for these tests:
 * - roles anon / authenticated / service_role, and Supabase's default
 *   privileges (new tables in `public` are granted to anon and
 *   authenticated, so a migration that forgets to revoke shows up here);
 * - auth.users and auth.uid(), driven by the request.jwt.claim.sub setting;
 * - the storage schema used by the media bucket policies.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS = join(import.meta.dirname, "..", "..", "supabase", "migrations");

const SUPABASE_STAND_IN = `
  create role anon nologin noinherit;
  create role authenticated nologin noinherit;
  create role service_role nologin noinherit bypassrls;

  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  create table auth.users (
    id                 uuid primary key default gen_random_uuid(),
    email              text,
    email_change       text default '',
    email_confirmed_at timestamptz,
    raw_user_meta_data jsonb not null default '{}',
    raw_app_meta_data  jsonb not null default '{}',
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
  );
  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
  $$;
  grant execute on function auth.uid() to anon, authenticated, service_role;

  create schema storage;
  grant usage on schema storage to anon, authenticated, service_role;
  create table storage.buckets (
    id text primary key, name text not null, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets (id), name text, owner uuid
  );
  alter table storage.objects enable row level security;
  grant all on storage.buckets, storage.objects to anon, authenticated, service_role;
  create function storage.foldername(name text) returns text[] language sql immutable as $$
    select (string_to_array(name, '/'))[1:cardinality(string_to_array(name, '/')) - 1]
  $$;
`;

export type Db = PGlite;

/** Migration files in order, e.g. "001_init.sql". */
async function migrationFiles(): Promise<string[]> {
  return (await readdir(MIGRATIONS)).filter((name) => /^\d{3}_.+\.sql$/.test(name)).sort();
}

/**
 * Apply migrations whose number is after `after` and up to `through`
 * (both optional, e.g. { after: "005" }).
 */
export async function applyMigrations(
  db: Db,
  { after = "000", through = "999" }: { after?: string; through?: string } = {},
): Promise<string[]> {
  const applied: string[] = [];
  for (const file of await migrationFiles()) {
    const number = file.slice(0, 3);
    if (number > after && number <= through) {
      try {
        await db.exec(await readFile(join(MIGRATIONS, file), "utf8"));
      } catch (error) {
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
      }
      applied.push(file);
    }
  }
  return applied;
}

/** A fresh database with the Supabase stand-ins and the migrations applied. */
export async function createDatabase(options?: { through?: string }): Promise<Db> {
  const db = new PGlite();
  await db.exec(SUPABASE_STAND_IN);
  await applyMigrations(db, { through: options?.through });
  return db;
}

/**
 * Sign up a user the way Supabase Auth does: a row in auth.users, which
 * fires our triggers. Returns the new user's id.
 */
export async function createUser(
  db: Db,
  email: string,
  {
    confirmed = true,
    fullName,
    appMetadata = {},
  }: { confirmed?: boolean; fullName?: string; appMetadata?: Record<string, unknown> } = {},
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into auth.users (email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data)
     values ($1, $2, $3::jsonb, $4::jsonb)
     returning id`,
    [
      email,
      confirmed ? new Date().toISOString() : null,
      JSON.stringify(fullName ? { full_name: fullName } : {}),
      JSON.stringify(appMetadata),
    ],
  );
  return rows[0].id;
}

/**
 * Onboard a student directly (as the database owner), the way the current
 * onboarding form leaves a profile.
 */
export async function onboard(
  db: Db,
  id: string,
  mode: "have_flat" | "need_flat",
  name = "Student",
): Promise<void> {
  await db.query(
    `update public.profiles
     set full_name = $2, mode = $3, gender = 'male', year_of_study = 2, department = 'CSE'
     where id = $1`,
    [id, name, mode],
  );
}

/**
 * Run `work` as a signed-in user (or as an anonymous visitor when `userId`
 * is null), with row-level security and privileges applied exactly as for
 * a Supabase request.
 */
export async function as<T>(db: Db, userId: string | null, work: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  await db.exec(`set role ${userId ? "authenticated" : "anon"}`);
  try {
    return await work();
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}

/** Shorthand: run a query and return its rows. */
export async function rows<T = Record<string, unknown>>(
  db: Db,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

/** How many rows an UPDATE/DELETE changed (0 means RLS hid the row). */
export async function affected(db: Db, sql: string, params: unknown[] = []): Promise<number> {
  return (await db.query(sql, params)).affectedRows ?? 0;
}
