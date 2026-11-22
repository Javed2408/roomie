"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { NOT_ELIGIBLE_MESSAGE, isSrmEmail } from "@/lib/eligibility";
import { createClient } from "@/lib/supabase/server";

/** What the login form shows after a submit that did not redirect. */
export type AuthState = {
  error?: string;
  notice?: string;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** Plain-language versions of Supabase's most common auth errors. */
function friendly(message: string): string {
  if (/invalid login credentials/i.test(message)) {
    return "That email and password don't match an account.";
  }
  if (/email not confirmed/i.test(message)) {
    return "Confirm your email first: open the link we sent you, then sign in.";
  }
  if (/rate limit/i.test(message)) {
    return "Too many attempts. Please wait a few minutes and try again.";
  }
  // The database refuses non-SRM sign-ups (migration 006); Supabase Auth
  // reports that only as a generic database error.
  if (/database error saving new user|only for SRM students/i.test(message)) {
    return NOT_ELIGIBLE_MESSAGE;
  }
  return message;
}

/**
 * Sign in or create an account, depending on the form's `intent`.
 *
 * Runs on the server, so the session cookies are set by the server and the
 * password never touches client-side JavaScript beyond the form itself.
 */
export async function authenticate(
  _previous: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const intent = field(formData, "intent");
  const email = field(formData, "email").toLowerCase();
  // Passwords are not trimmed: spaces may be part of them.
  const rawPassword = formData.get("password");
  const password = typeof rawPassword === "string" ? rawPassword : "";

  if (!EMAIL.test(email)) {
    return { error: "Enter a valid email address." };
  }
  if (password.length < MIN_PASSWORD) {
    return { error: `Use a password of at least ${MIN_PASSWORD} characters.` };
  }

  const supabase = await createClient();

  if (intent === "signup") {
    // Checked here for a clear message; the database enforces it anyway.
    if (!isSrmEmail(email)) {
      return { error: NOT_ELIGIBLE_MESSAGE };
    }
    const origin = (await headers()).get("origin") ?? "http://localhost:3000";
    const fullName = field(formData, "full_name").slice(0, 80);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${origin}/auth/confirm`,
        data: fullName ? { full_name: fullName } : undefined,
      },
    });
    if (error) {
      return { error: friendly(error.message) };
    }
    if (!data.session) {
      // Email confirmation is on: nothing to sign in with until it's clicked.
      return {
        notice: `Almost there: we sent a confirmation link to ${email}. Open it on this device to finish signing up.`,
      };
    }
    // A brand-new account always starts with onboarding.
    redirect("/onboarding");
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { error: friendly(error.message) };
  }
  // /discover sends anyone who hasn't finished onboarding on to it.
  redirect("/discover");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
