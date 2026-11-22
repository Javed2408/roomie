import Link from "next/link";
import type { ComponentProps } from "react";

type Variant = "primary" | "secondary" | "ghost";

const VARIANTS: Record<Variant, string> = {
  // Charcoal on cream reads clearly; the orange accent is kept for
  // highlights, where its lower contrast does not matter.
  primary: "bg-charcoal text-cream hover:bg-charcoal/90",
  secondary:
    "bg-surface text-charcoal border border-line hover:border-charcoal/40",
  ghost: "text-charcoal hover:bg-charcoal/5",
};

interface StyleOptions {
  variant?: Variant;
  fullWidth?: boolean;
  className?: string;
}

/** The classes for a rounded, thumb-sized (48px+) button or button-link. */
function buttonClasses({
  variant = "primary",
  fullWidth = false,
  className = "",
}: StyleOptions): string {
  return [
    "inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 text-base font-semibold transition-colors duration-150",
    "focus-visible:outline-accent focus-visible:outline-2 focus-visible:outline-offset-2",
    "disabled:cursor-not-allowed disabled:opacity-50",
    VARIANTS[variant],
    fullWidth ? "w-full" : "",
    className,
  ].join(" ");
}

type ButtonProps = ComponentProps<"button"> & StyleOptions;

export function Button({
  variant,
  fullWidth,
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses({ variant, fullWidth, className })}
      {...props}
    />
  );
}

type ButtonLinkProps = ComponentProps<typeof Link> & StyleOptions;

/** A link that looks like a button, for navigation. */
export function ButtonLink({
  variant,
  fullWidth,
  className,
  ...props
}: ButtonLinkProps) {
  return (
    <Link
      className={buttonClasses({ variant, fullWidth, className })}
      {...props}
    />
  );
}
