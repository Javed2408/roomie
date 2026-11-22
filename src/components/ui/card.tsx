import type { ComponentProps } from "react";

/** A white, softly rounded panel on the cream background. */
export function Card({ className = "", ...props }: ComponentProps<"div">) {
  return (
    <div
      className={`bg-surface border-line rounded-card border ${className}`}
      {...props}
    />
  );
}
