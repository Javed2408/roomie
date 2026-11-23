import { CircleDashed, EyeOff, Radio } from "lucide-react";

import type { ListingStatus } from "@/types/database";

const STYLES: Record<ListingStatus, { label: string; className: string; icon: typeof Radio }> = {
  active: { label: "Live", className: "bg-forest-soft text-forest", icon: Radio },
  draft: { label: "Draft", className: "bg-charcoal/5 text-charcoal", icon: CircleDashed },
  inactive: { label: "Deactivated", className: "bg-accent-soft text-accent-strong", icon: EyeOff },
};

/** Live, Draft or Deactivated, as a small pill. */
export function StatusBadge({ status }: { status: ListingStatus }) {
  const { label, className, icon: Icon } = STYLES[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${className}`}>
      <Icon aria-hidden="true" className="size-3.5" />
      {label}
    </span>
  );
}
