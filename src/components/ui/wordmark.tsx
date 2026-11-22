import { MapPin } from "lucide-react";
import Link from "next/link";

/** The app header: the Roomie wordmark (links home) and the campus tag. */
export function Wordmark() {
  return (
    <div className="flex items-center justify-between">
      <Link
        href="/"
        className="font-display focus-visible:outline-accent rounded-md text-2xl font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        roomie<span className="text-accent">.</span>
      </Link>
      <span className="bg-forest-soft text-forest inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold">
        <MapPin aria-hidden="true" className="size-3.5" />
        SRM KTR
      </span>
    </div>
  );
}
