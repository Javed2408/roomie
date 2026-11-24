import { Check, Info, Users } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import type { GroupInsights } from "@/lib/group-compatibility";
import type { PublicProfile } from "@/types/database";
import { firstName } from "@/types/feed";

/** A group's photo, or its initials on a warm tile. */
export function GroupPhoto({ url, name, className = "" }: { url: string | null; name: string; className?: string }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URL
    return <img src={url} alt="" className={`object-cover ${className}`} />;
  }
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("");
  return (
    <div
      aria-hidden="true"
      className={`from-accent-soft to-forest-soft text-forest font-display flex items-center justify-center bg-gradient-to-br font-semibold ${className}`}
    >
      {initials || <Users className="size-1/3" />}
    </div>
  );
}

/** Overlapping member photos with the count. */
export function MemberStack({ members, count }: { members: PublicProfile[]; count: number }) {
  return (
    <div className="flex items-center gap-2">
      <ul className="flex -space-x-2" aria-label="Members">
        {members.map((member) => (
          <li key={member.id} title={firstName(member)}>
            <Avatar url={member.avatar_url} name={firstName(member)} className="ring-surface size-8 rounded-full text-xs ring-2" />
          </li>
        ))}
      </ul>
      <span className="text-muted text-xs">
        {count} {count === 1 ? "member" : "members"}
      </span>
    </div>
  );
}

/**
 * What the group agrees on, where it's split, and how someone would fit.
 * Every line comes from stored answers; nothing is guessed.
 */
export function InsightsList({ insights, showGroup = true }: { insights: GroupInsights; showGroup?: boolean }) {
  const lines = [
    ...insights.fit.map((item) => ({ ...item, key: `fit:${item.text}` })),
    ...(showGroup ? insights.agreements.map((text) => ({ tone: "good" as const, text, key: `agree:${text}` })) : []),
    ...(showGroup ? insights.splits.map((text) => ({ tone: "note" as const, text, key: `split:${text}` })) : []),
  ];
  if (lines.length === 0) {
    return <p className="text-muted text-sm">Not enough shared answers yet for insights.</p>;
  }
  return (
    <ul className="space-y-1.5 text-sm">
      {lines.map((line) => (
        <li key={line.key} className={`flex gap-2 ${line.tone === "note" ? "text-muted" : ""}`}>
          {line.tone === "good" ? (
            <Check aria-hidden="true" className="text-forest mt-0.5 size-4 shrink-0" />
          ) : (
            <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          )}
          {line.text}
        </li>
      ))}
    </ul>
  );
}
