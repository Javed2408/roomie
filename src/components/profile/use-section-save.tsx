"use client";

import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";

import type { SaveResult } from "@/app/profile/edit/actions";
import { Button } from "@/components/ui/button";
import type { Problems } from "@/lib/profile-validation";

type Status = "idle" | "saved" | "error";

/**
 * Save state for one editor section: what was last saved (so the section
 * knows whether it has unsaved changes), and the outcome of the last save.
 * `onDirtyChange` lets the editor mark tabs that have unsaved changes.
 */
export function useSectionSave<T>(
  initial: T,
  save: (value: T) => Promise<SaveResult>,
  onDirtyChange?: (dirty: boolean) => void,
) {
  const [value, setValue] = useState<T>(initial);
  const [saved, setSaved] = useState<T>(initial);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [problems, setProblems] = useState<Problems>({});
  const [isSaving, startTransition] = useTransition();
  const dirty = JSON.stringify(value) !== JSON.stringify(saved);

  // Tell the editor whenever "has unsaved changes" flips.
  const reported = useRef(false);
  useEffect(() => {
    if (reported.current !== dirty) {
      reported.current = dirty;
      onDirtyChange?.(dirty);
    }
  }, [dirty, onDirtyChange]);

  function update(next: T | ((current: T) => T)) {
    setValue(next);
    setStatus("idle");
  }

  function submit(toSave: T = value) {
    setError("");
    startTransition(async () => {
      const result = await save(toSave);
      if (result.ok) {
        setSaved(toSave);
        setValue(toSave);
        setProblems({});
        setStatus("saved");
      } else {
        setError(result.error);
        setProblems(result.problems ?? {});
        setStatus("error");
      }
    });
  }

  return { value, update, submit, dirty, isSaving, status, error, problems };
}

/**
 * The save button and its status line, kept in view at the bottom of the
 * section. The status is announced to screen readers.
 */
export function SaveBar({
  dirty,
  isSaving,
  status,
  error,
  onSave,
  label = "Save",
}: {
  dirty: boolean;
  isSaving: boolean;
  status: Status;
  error: string;
  onSave: () => void;
  label?: string;
}) {
  return (
    <div className="bg-cream/95 border-line sticky bottom-0 z-10 -mx-5 mt-8 border-t px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
      <div className="flex items-center gap-3">
        <p role="status" aria-live="polite" className="min-w-0 flex-1 text-sm">
          {isSaving ? (
            <span className="text-muted inline-flex items-center gap-1.5">
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              Saving…
            </span>
          ) : status === "error" ? (
            <span className="text-accent-strong inline-flex items-start gap-1.5 font-medium">
              <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {error}
            </span>
          ) : dirty ? (
            <span className="text-muted">Unsaved changes</span>
          ) : status === "saved" ? (
            <span className="text-forest inline-flex items-center gap-1.5 font-medium">
              <Check aria-hidden="true" className="size-4" />
              Saved
            </span>
          ) : null}
        </p>
        <Button onClick={onSave} disabled={!dirty || isSaving} className="shrink-0 px-6">
          {isSaving ? "Saving…" : label}
        </Button>
      </div>
    </div>
  );
}

/** Section heading with a one-line explanation. */
export function SectionIntro({
  id,
  title,
  children,
}: {
  /** Used by the section's aria-labelledby. */
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-5">
      <h2 id={id} className="font-display text-2xl font-semibold">
        {title}
      </h2>
      <p className="text-muted mt-1 text-sm leading-relaxed">{children}</p>
    </div>
  );
}
