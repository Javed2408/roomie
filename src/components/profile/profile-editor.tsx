"use client";

import { useCallback, useEffect, useState } from "react";

import { AboutSection } from "@/components/profile/about-section";
import { EDITOR_SECTIONS, type EditorSection } from "@/components/profile/editor-sections";
import { HousingSection } from "@/components/profile/housing-section";
import { InterestsSection } from "@/components/profile/interests-section";
import { LifestyleSection } from "@/components/profile/lifestyle-section";
import { PhotosSection } from "@/components/profile/photos-section";
import { PracticalSection } from "@/components/profile/practical-section";
import { PromptsSection } from "@/components/profile/prompts-section";
import type { EditorData } from "@/lib/student";

/**
 * The profile editor: one tab per section, each saved on its own. All
 * sections stay mounted, so switching tabs never loses unsaved typing;
 * tabs with unsaved changes get a dot.
 */
export function ProfileEditor({
  data,
  initialSection,
}: {
  data: EditorData;
  initialSection: EditorSection;
}) {
  const [section, setSection] = useState<EditorSection>(initialSection);
  const [dirty, setDirty] = useState<Partial<Record<EditorSection, boolean>>>({});
  const anyDirty = Object.values(dirty).some(Boolean);

  const markDirty = useCallback(
    (id: EditorSection) => (isDirty: boolean) =>
      setDirty((current) => (current[id] === isDirty ? current : { ...current, [id]: isDirty })),
    [],
  );
  // One stable callback per section, so sections don't re-report needlessly.
  const [reporters] = useState(() =>
    Object.fromEntries(EDITOR_SECTIONS.map(({ id }) => [id, markDirty(id)])) as Record<
      EditorSection,
      (dirty: boolean) => void
    >,
  );

  // Warn before leaving the page with unsaved changes.
  useEffect(() => {
    if (!anyDirty) {
      return;
    }
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [anyDirty]);

  function open(id: EditorSection) {
    setSection(id);
    // Keep the address shareable (e.g. from the account checklist) without
    // a navigation, which would reset unsaved changes.
    window.history.replaceState(null, "", `?section=${id}`);
    window.scrollTo({ top: 0 });
  }

  return (
    <>
      <nav aria-label="Profile sections" className="bg-cream/95 sticky top-[4.75rem] z-10 -mx-5 mb-6 px-5 py-2 backdrop-blur">
        <ul className="-mx-5 flex gap-2 overflow-x-auto px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {EDITOR_SECTIONS.map(({ id, label, icon: Icon }) => {
            const isCurrent = id === section;
            return (
              <li key={id} className="shrink-0">
                <button
                  type="button"
                  aria-current={isCurrent ? "true" : undefined}
                  onClick={() => open(id)}
                  className={`focus-visible:outline-accent relative inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${
                    isCurrent
                      ? "bg-charcoal text-cream border-charcoal"
                      : "bg-surface border-line text-charcoal hover:border-charcoal/40"
                  }`}
                >
                  <Icon aria-hidden="true" className="size-4" />
                  {label}
                  {dirty[id] && (
                    <>
                      <span aria-hidden="true" className="bg-accent size-2 rounded-full" />
                      <span className="sr-only"> (unsaved changes)</span>
                    </>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div hidden={section !== "photos"}>
        <PhotosSection userId={data.userId} initial={data.photos} onDirtyChange={reporters.photos} />
      </div>
      <div hidden={section !== "about"}>
        <AboutSection profile={data.profile} onDirtyChange={reporters.about} />
      </div>
      <div hidden={section !== "prompts"}>
        <PromptsSection initial={data.profile.bio_prompts} onDirtyChange={reporters.prompts} />
      </div>
      <div hidden={section !== "interests"}>
        <InterestsSection
          catalogue={data.catalogue}
          initial={data.interests}
          onDirtyChange={reporters.interests}
        />
      </div>
      <div hidden={section !== "lifestyle"}>
        <LifestyleSection initial={data.lifestyle} onDirtyChange={reporters.lifestyle} />
      </div>
      <div hidden={section !== "practical"}>
        <PracticalSection initial={data.practical} onDirtyChange={reporters.practical} />
      </div>
      <div hidden={section !== "housing"}>
        <HousingSection
          housing={data.housing}
          discovery={data.discovery}
          liveListing={data.liveListing}
          onDirtyChange={reporters.housing}
        />
      </div>
    </>
  );
}
