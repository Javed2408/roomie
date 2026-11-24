import { CalendarDays, DoorOpen, MapPin, Search, Wallet } from "lucide-react";
import Link from "next/link";

import { GroupPhoto, InsightsList, MemberStack } from "@/components/groups/group-bits";
import { MOVE_IN_TIMEFRAMES } from "@/lib/constants/prompts";
import type { GroupCardData } from "@/lib/groups";
import { capacityLabel, GROUP_STATUS_LABELS, membershipLabel } from "@/lib/group-display";
import { budgetRangeLabel } from "@/lib/group-validation";

/** One group in the Groups list: compact, the essentials at a glance. */
export function GroupCard({ data }: { data: GroupCardData }) {
  const { group, memberCount, myStatus, members, insights } = data;
  const budget = budgetRangeLabel(group.budget_min, group.budget_max);
  const moveIn = MOVE_IN_TIMEFRAMES.find((item) => item.value === group.move_in_timeframe)?.label;
  const mine = membershipLabel(myStatus);
  const highlights = { ...insights, fit: insights.fit.slice(0, 2), agreements: insights.agreements.slice(0, myStatus === "active" ? 2 : 1), splits: [] };

  return (
    <article className="bg-surface border-line rounded-card overflow-hidden border">
      <Link
        href={`/groups/${group.id}`}
        className="hover:bg-charcoal/[0.02] focus-visible:outline-accent block p-4 focus-visible:outline-2 focus-visible:-outline-offset-2"
      >
        <div className="flex gap-3">
          <GroupPhoto url={group.avatar_url} name={group.name} className="size-16 shrink-0 rounded-2xl text-xl" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display truncate text-xl font-semibold">{group.name}</h2>
              {mine && (
                <span className="bg-forest-soft text-forest rounded-full px-2 py-0.5 text-xs font-semibold">{mine}</span>
              )}
            </div>
            <p className="text-muted text-xs">{GROUP_STATUS_LABELS[group.status]?.label}</p>
            {group.description && <p className="mt-1 line-clamp-2 text-sm">{group.description}</p>}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm">
          {group.preferred_societies.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <MapPin aria-hidden="true" className="text-forest size-4" />
              {group.preferred_societies.slice(0, 2).join(", ")}
              {group.preferred_societies.length > 2 ? ` +${group.preferred_societies.length - 2}` : ""}
            </span>
          )}
          {budget && (
            <span className="inline-flex items-center gap-1">
              <Wallet aria-hidden="true" className="text-forest size-4" />
              {budget}/mo
            </span>
          )}
          {moveIn && (
            <span className="inline-flex items-center gap-1">
              <CalendarDays aria-hidden="true" className="text-forest size-4" />
              {moveIn}
            </span>
          )}
          {group.housing_status && (
            <span className="inline-flex items-center gap-1">
              {group.housing_status === "has_accommodation" ? (
                <DoorOpen aria-hidden="true" className="text-forest size-4" />
              ) : (
                <Search aria-hidden="true" className="text-forest size-4" />
              )}
              {group.housing_status === "has_accommodation" ? "Has a place" : "Looking for a place"}
            </span>
          )}
        </div>
        {group.requirements && <p className="text-muted mt-2 line-clamp-1 text-sm">Looking for: {group.requirements}</p>}

        <div className="border-line mt-3 flex items-center justify-between gap-3 border-t pt-3">
          <MemberStack members={members} count={memberCount} />
          <span className="text-muted text-xs">{capacityLabel(memberCount, group.max_members).split(" · ")[1]}</span>
        </div>
        {(highlights.fit.length > 0 || highlights.agreements.length > 0) && (
          <div className="mt-3">
            <InsightsList insights={highlights} />
          </div>
        )}
      </Link>
    </article>
  );
}
