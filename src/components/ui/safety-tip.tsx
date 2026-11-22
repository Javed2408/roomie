import { ShieldAlert } from "lucide-react";

/**
 * A reminder shown wherever students talk money: see the flat and the
 * paperwork before paying anything.
 */
export function SafetyTip({ className = "" }: { className?: string }) {
  return (
    <aside
      aria-label="Safety tip"
      className={`bg-forest-soft text-charcoal flex gap-3 rounded-2xl p-4 text-sm leading-relaxed ${className}`}
    >
      <ShieldAlert aria-hidden="true" className="text-forest mt-0.5 size-5 shrink-0" />
      <p>
        <strong className="text-forest font-semibold">Stay safe:</strong> visit the flat in
        person, meet the owner and read the rental agreement before you pay any deposit.
        Never send money to someone you haven&apos;t met.
      </p>
    </aside>
  );
}
