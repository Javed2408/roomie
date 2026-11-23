/**
 * Who may use Roomie: SRM students with an @srmist.edu.in email.
 *
 * The database enforces this on every sign-up (migration 006), so this copy
 * is only for friendly, early messages in the app. Keep the two matching:
 * `public.is_srm_email()` accepts addresses ending in "@srmist.edu.in",
 * ignoring letter case. (No imports, so tests can load this file directly.)
 */

export const SRM_EMAIL_DOMAIN = "@srmist.edu.in";

/** True for an SRM student address, e.g. ab1234@srmist.edu.in. */
export function isSrmEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith(SRM_EMAIL_DOMAIN);
}

export const NOT_ELIGIBLE_MESSAGE =
  "Roomie is only for SRM students. Sign up with your @srmist.edu.in email.";

/**
 * May this signed-in account use Roomie? Only a confirmed SRM address.
 *
 * Pass the Supabase Auth user (from `auth.getUser()`, which the server
 * verifies), never profile data: the profile badge alone is not proof.
 * Mirrors `public.is_eligible_student()` (migration 011), which the
 * database checks on every protected read and write.
 */
export function isEligibleUser(
  user: { email?: string | null; email_confirmed_at?: string | null } | null | undefined,
): boolean {
  return Boolean(user?.email && isSrmEmail(user.email) && user.email_confirmed_at);
}
