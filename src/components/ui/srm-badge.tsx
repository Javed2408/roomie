import { CircleDashed, ShieldCheck } from "lucide-react";

/**
 * Whether someone is a verified SRM student: an @srmist.edu.in address they
 * have confirmed. Only the database sets this, never the app.
 */
export function SrmBadge({ verified }: { verified: boolean }) {
  if (verified) {
    return (
      <span className="bg-forest text-cream inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold">
        <ShieldCheck aria-hidden="true" className="size-4" />
        Verified SRM Student
      </span>
    );
  }
  return (
    <span className="bg-charcoal/5 text-muted inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium">
      <CircleDashed aria-hidden="true" className="size-4" />
      Not SRM-verified
    </span>
  );
}

/** The badge's small form, for tight spaces such as list rows and headers. */
export function SrmMark() {
  return (
    <span
      title="Verified SRM Student"
      className="bg-forest text-cream inline-flex size-5 shrink-0 items-center justify-center rounded-full"
    >
      <ShieldCheck aria-hidden="true" className="size-3.5" strokeWidth={2.4} />
      <span className="sr-only">Verified SRM Student</span>
    </span>
  );
}
