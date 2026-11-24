import { Compass, HeartHandshake, User, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { isEligibleUser } from "@/lib/eligibility";
import { countUnreadNotifications } from "@/lib/groups";
import { getPendingLikes } from "@/lib/matches";
import { getCurrentUser } from "@/lib/profile";

type Tab = "Discover" | "Groups" | "Matches" | "Account";

const TABS: Array<{ label: Tab; icon: LucideIcon; href: string }> = [
  { label: "Discover", icon: Compass, href: "/discover" },
  { label: "Groups", icon: Users, href: "/groups" },
  { label: "Matches", icon: HeartHandshake, href: "/matches" },
  { label: "Account", icon: User, href: "/account" },
];

/** The dot on Groups while a group update is unread. */
async function GroupUpdates({ part }: { part: "dot" | "text" }) {
  const current = await getCurrentUser();
  if (!current || !isEligibleUser(current.user)) {
    return null;
  }
  const count = await countUnreadNotifications(current.user.id);
  if (count === 0) {
    return null;
  }
  return part === "dot" ? (
    <span aria-hidden="true" className="bg-accent ring-cream absolute -top-0.5 -right-1 size-2.5 rounded-full ring-2" />
  ) : (
    <span className="sr-only">
      , {count} new {count === 1 ? "update" : "updates"}
    </span>
  );
}

/**
 * The orange dot on Matches while someone's like is waiting for an answer
 * (`part="dot"`), and the same news for screen readers (`part="text"`).
 * It reads the session, so it streams in after the rest of the tab bar.
 */
async function PendingLikes({ part }: { part: "dot" | "text" }) {
  const current = await getCurrentUser();
  if (!current) {
    return null;
  }
  // Cached per request: both parts share one lookup.
  const count = (await getPendingLikes(current.user.id)).length;
  if (count === 0) {
    return null;
  }
  return part === "dot" ? (
    <span
      aria-hidden="true"
      className="bg-accent ring-cream absolute -top-0.5 -right-1 size-2.5 rounded-full ring-2"
    />
  ) : (
    <span className="sr-only">
      , {count} new {count === 1 ? "like" : "likes"}
    </span>
  );
}

/** The tab bar at the bottom of the app. */
export function BottomNav({ current }: { current?: Tab }) {
  return (
    <nav aria-label="Main">
      <ul className="grid grid-cols-4">
        {TABS.map(({ label, icon: Icon, href }) => {
          const isCurrent = label === current;
          return (
            <li key={label}>
              <Link
                href={href}
                aria-current={isCurrent ? "page" : undefined}
                className={`focus-visible:outline-accent relative flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-medium focus-visible:outline-2 focus-visible:-outline-offset-4 ${
                  isCurrent ? "text-charcoal" : "text-muted hover:text-charcoal"
                }`}
              >
                <span className="relative">
                  <Icon
                    aria-hidden="true"
                    className={`size-6 ${isCurrent ? "text-accent" : ""}`}
                    strokeWidth={isCurrent ? 2.4 : 1.8}
                  />
                  {label === "Matches" && (
                    <Suspense fallback={null}>
                      <PendingLikes part="dot" />
                    </Suspense>
                  )}
                  {label === "Groups" && (
                    <Suspense fallback={null}>
                      <GroupUpdates part="dot" />
                    </Suspense>
                  )}
                </span>
                <span>
                  {label}
                  {label === "Matches" && (
                    <Suspense fallback={null}>
                      <PendingLikes part="text" />
                    </Suspense>
                  )}
                  {label === "Groups" && (
                    <Suspense fallback={null}>
                      <GroupUpdates part="text" />
                    </Suspense>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
