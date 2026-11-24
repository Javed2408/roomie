"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { keepClickOnLink, profileLinkAttributes } from "@/lib/profile-links";

/**
 * A member's photo or name that opens their profile. Without an href (the
 * profile isn't available) it shows the same content as plain text, with
 * none of the link's hover or focus styling.
 */
export function ProfileLink({
  href,
  role = "name",
  label,
  fallback = "span",
  className = "",
  linkClassName = "",
  children,
}: {
  href: string | null;
  /** "name": the focusable link. "photo": a pointer/touch duplicate of it. */
  role?: "name" | "photo";
  /** Accessible name for a "name" link, e.g. "Jaden's profile". */
  label?: string;
  /** The wrapper used when there's nothing to link to. */
  fallback?: "span" | "div";
  /** Layout, used with or without a link. */
  className?: string;
  /** Hover and tap-area styling, used only on a real link. */
  linkClassName?: string;
  children: ReactNode;
}) {
  if (!href) {
    const Plain = fallback;
    return <Plain className={className}>{children}</Plain>;
  }
  const focus = role === "name" ? "focus-visible:outline-accent focus-visible:outline-2 focus-visible:outline-offset-2" : "";
  return (
    <Link
      href={href}
      onClick={keepClickOnLink}
      aria-label={role === "name" ? label : undefined}
      className={`${focus} ${className} ${linkClassName}`}
      {...profileLinkAttributes(role)}
    >
      {children}
    </Link>
  );
}
