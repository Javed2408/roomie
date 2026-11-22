import type { ReactNode } from "react";

interface AppShellProps {
  /** Stays at the top while the page scrolls. */
  header?: ReactNode;
  /** Stays at the bottom, e.g. the tab bar. */
  footer?: ReactNode;
  children: ReactNode;
}

/**
 * The phone-sized frame every screen lives in.
 *
 * On a phone it fills the screen. On a wider screen it stays 480px wide and
 * centred, on a slightly darker canvas, so the app always looks like the
 * mobile app it is.
 */
export function AppShell({ header, footer, children }: AppShellProps) {
  return (
    <div className="bg-canvas min-h-dvh">
      <div className="bg-cream border-line relative mx-auto flex min-h-dvh w-full max-w-[480px] flex-col sm:border-x sm:shadow-[0_0_40px_rgba(26,26,26,0.06)]">
        {header && (
          <header className="bg-cream/90 border-line sticky top-0 z-20 border-b px-5 py-3 backdrop-blur">
            {header}
          </header>
        )}
        <main className="flex-1 px-5 pt-6 pb-8">{children}</main>
        {footer && (
          <div className="bg-cream/95 border-line sticky bottom-0 z-20 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
