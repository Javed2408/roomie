"use client";

import { X } from "lucide-react";
import { useId, useLayoutEffect, useRef, type ReactNode } from "react";

/**
 * A panel that slides up from the bottom, inside the 480px app column.
 *
 * Built on the browser's own modal <dialog>, which keeps keyboard focus
 * inside the sheet and hides the page behind it from screen readers.
 * Escape, the close button and tapping outside all call `onClose`.
 * Render it only while it should be open.
 */
export function BottomSheet({
  title,
  onClose,
  footer,
  children,
}: {
  title: string;
  onClose: () => void;
  /** Stays visible at the bottom while the content scrolls, e.g. actions. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    const opener = document.activeElement;
    dialog.showModal();
    // Stop the page behind from scrolling along with the sheet.
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = previousOverflow;
      if (dialog.open) {
        dialog.close();
      }
      // Put focus back on whatever opened the sheet, if it's still there.
      if (opener instanceof HTMLElement && opener.isConnected) {
        opener.focus();
      }
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        // Escape: let React close it, so state and the screen agree.
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // A click on the dialog itself (not its content) is on the backdrop.
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      className="bg-cream text-charcoal backdrop:bg-charcoal/50 motion-safe:animate-sheet-up mx-auto mt-auto mb-0 max-h-[90dvh] w-full max-w-[480px] flex-col overflow-hidden rounded-t-[2rem] p-0 shadow-2xl backdrop:backdrop-blur-[2px] open:flex"
    >
      <div className="flex items-start justify-between gap-3 px-5 pt-3">
        <div className="min-w-0 flex-1">
          <div className="bg-charcoal/15 mx-auto mb-3 h-1.5 w-12 rounded-full" />
          <h2 id={titleId} className="font-display text-2xl font-semibold">
            {title}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="hover:bg-charcoal/5 focus-visible:outline-accent -mr-2 flex size-12 shrink-0 items-center justify-center rounded-full focus-visible:outline-2"
        >
          <X aria-hidden="true" className="size-5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-3 pb-5">
        {children}
      </div>
      {footer && (
        <div className="border-line border-t px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {footer}
        </div>
      )}
    </dialog>
  );
}
