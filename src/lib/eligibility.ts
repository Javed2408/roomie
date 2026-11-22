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
