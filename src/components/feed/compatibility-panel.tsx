import { Check, Info, Sparkles } from "lucide-react";
import Link from "next/link";

import { Card } from "@/components/ui/card";
import type { CompatibilityView } from "@/types/feed";

/**
 * Why two students might live well together. Every line comes from an
 * actual comparison of their answers; a percentage only appears when
 * there is enough data behind it.
 */
export function CompatibilityPanel({ compatibility }: { compatibility: CompatibilityView }) {
  const { percent, reasons, differences, compared, breakdown } = compatibility;
  const hasInsight = reasons.length > 0 || differences.length > 0;

  return (
    <Card className="p-5">
      <div className="flex items-start gap-4">
        {percent !== null ? (
          <div
            className="bg-forest-soft text-forest flex size-16 shrink-0 flex-col items-center justify-center rounded-full"
            aria-hidden="true"
          >
            <span className="font-display text-xl leading-none font-semibold">{percent}%</span>
          </div>
        ) : (
          <span className="bg-accent-soft text-accent-strong flex size-12 shrink-0 items-center justify-center rounded-full">
            <Sparkles aria-hidden="true" className="size-5" />
          </span>
        )}
        <div className="min-w-0">
          <h3 className="font-display text-lg font-semibold">
            {percent !== null ? (
              <>
                <span className="sr-only">{percent}% </span>Compatibility
              </>
            ) : (
              "Compatibility"
            )}
          </h3>
          <p className="text-muted text-sm">
            {percent !== null
              ? `Based on ${compared} things you both answered.`
              : hasInsight
                ? "Not enough answers yet for a score."
                : "Complete more preferences to see compatibility insights."}
          </p>
        </div>
      </div>

      {hasInsight && (
        <ul className="mt-4 space-y-2 text-sm">
          {reasons.map((reason) => (
            <li key={reason} className="flex gap-2">
              <Check aria-hidden="true" className="text-forest mt-0.5 size-4 shrink-0" />
              {reason}
            </li>
          ))}
          {differences.map((difference) => (
            <li key={difference} className="text-muted flex gap-2">
              <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {difference}. Worth talking about.
            </li>
          ))}
        </ul>
      )}

      {percent !== null ? (
        <details className="group mt-4">
          <summary className="text-charcoal focus-visible:outline-accent inline-flex min-h-11 cursor-pointer items-center rounded-full text-sm font-semibold underline-offset-4 hover:underline focus-visible:outline-2">
            How this is worked out
          </summary>
          <dl className="mt-2 space-y-2">
            {breakdown.map((item) => (
              <div key={item.label} className="flex items-center gap-3 text-sm">
                <dt className="w-40 shrink-0">{item.label}</dt>
                <dd className="flex flex-1 items-center gap-2">
                  {item.score === null ? (
                    <span className="text-muted">Not enough answers</span>
                  ) : (
                    <>
                      <span className="bg-charcoal/10 h-2 flex-1 overflow-hidden rounded-full">
                        <span className="bg-forest block h-full rounded-full" style={{ width: `${item.score}%` }} />
                      </span>
                      <span className="w-9 text-right tabular-nums">{item.score}%</span>
                    </>
                  )}
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-muted mt-3 text-xs leading-relaxed">
            Lifestyle counts most, then personality and interests, living habits, housing plans and
            practical needs. Anything either of you hasn&apos;t answered is left out, not counted
            against you.
          </p>
        </details>
      ) : (
        !hasInsight && (
          <Link
            href="/profile/edit?section=lifestyle"
            className="text-charcoal focus-visible:outline-accent mt-3 inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-4 focus-visible:outline-2"
          >
            Add your lifestyle answers
          </Link>
        )
      )}
    </Card>
  );
}
