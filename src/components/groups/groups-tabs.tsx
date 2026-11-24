import Link from "next/link";

const TABS = [
  { id: "discover", label: "Discover", href: "/groups" },
  { id: "mine", label: "Your groups", href: "/groups/mine" },
  { id: "updates", label: "Updates", href: "/notifications" },
] as const;

/** Switch between finding groups, your own group activity and updates. */
export function GroupsTabs({ current, unread = 0 }: { current: (typeof TABS)[number]["id"]; unread?: number }) {
  return (
    <nav aria-label="Groups" className="-mx-5 mb-5 overflow-x-auto px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <ul className="flex gap-2">
        {TABS.map((tab) => {
          const isCurrent = tab.id === current;
          return (
            <li key={tab.id} className="shrink-0">
              <Link
                href={tab.href}
                aria-current={isCurrent ? "page" : undefined}
                className={`focus-visible:outline-accent inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 ${
                  isCurrent ? "bg-charcoal text-cream border-charcoal" : "bg-surface border-line text-charcoal hover:border-charcoal/40"
                }`}
              >
                {tab.label}
                {tab.id === "updates" && unread > 0 && (
                  <span className="bg-accent text-cream rounded-full px-1.5 text-xs leading-5 tabular-nums">
                    {unread}
                    <span className="sr-only"> unread</span>
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
