/**
 * Someone's photo, or the first letter of their name when they have none.
 * Decorative (alt=""): their name is always written next to it.
 */
export function Avatar({
  url,
  name,
  className = "size-12 rounded-full text-lg",
}: {
  url: string | null;
  name: string;
  /** Size, shape and initial's text size. */
  className?: string;
}) {
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URL
      <img src={url} alt="" className={`shrink-0 object-cover ${className}`} />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`bg-accent-soft font-display text-accent-strong flex shrink-0 items-center justify-center font-semibold ${className}`}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}
