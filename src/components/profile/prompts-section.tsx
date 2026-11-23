"use client";

import { ArrowDown, ArrowUp, Check, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useId, useState } from "react";

import { savePrompts } from "@/app/profile/edit/actions";
import { SaveBar, SectionIntro, useSectionSave } from "@/components/profile/use-section-save";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { PROMPT_ANSWER_MAX, PROMPT_BANK, PROMPT_COUNT } from "@/lib/constants/prompts";
import type { PromptInput } from "@/lib/profile-validation";
import type { BioPrompt } from "@/types/database";

/** Which prompt the picker is choosing: a new one, or a replacement. */
type Picking = { mode: "add" } | { mode: "replace"; index: number };

const iconButton =
  "text-muted hover:bg-charcoal/5 hover:text-charcoal focus-visible:outline-accent flex size-11 items-center justify-center rounded-full focus-visible:outline-2 disabled:opacity-30 disabled:hover:bg-transparent";

/**
 * Up to three prompts from the bank, answered in the student's own words.
 * Answers can be edited, reordered and removed. None are required.
 */
export function PromptsSection({
  initial,
  onDirtyChange,
}: {
  initial: BioPrompt[];
  onDirtyChange: (dirty: boolean) => void;
}) {
  const section = useSectionSave<PromptInput[]>(initial, savePrompts, onDirtyChange);
  const prompts = section.value;
  const [picking, setPicking] = useState<Picking | null>(null);
  const baseId = useId();
  const used = new Set(prompts.map((prompt) => prompt.question));

  function choose(question: string) {
    if (picking?.mode === "replace") {
      const index = picking.index;
      section.update((list) => list.map((item, i) => (i === index ? { ...item, question } : item)));
    } else {
      section.update((list) => [...list, { question, answer: "" }]);
    }
    setPicking(null);
  }

  function move(index: number, by: number) {
    section.update((list) => {
      const next = [...list];
      [next[index], next[index + by]] = [next[index + by], next[index]];
      return next;
    });
  }

  return (
    <section aria-labelledby="prompts-heading">
      <SectionIntro id="prompts-heading" title="Prompts">
        Pick up to {PROMPT_COUNT} and answer in your own words. A little personality goes a
        long way, and they don&apos;t all have to be about flats.
      </SectionIntro>

      {prompts.length === 0 && (
        <div className="border-line rounded-card border border-dashed p-6 text-center">
          <p className="font-display text-lg">No prompts yet</p>
          <p className="text-muted mt-1 text-sm">
            Prompts give people something to reply to. Add one to get started.
          </p>
        </div>
      )}

      <ol className="space-y-4">
        {prompts.map((prompt, index) => {
          const answerId = `${baseId}-answer-${index}`;
          const answerError = section.problems[`answer_${index}`];
          const promptError = section.problems[`prompt_${index}`];
          return (
            <li key={prompt.question} className="bg-surface border-line rounded-card border p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-muted text-xs font-semibold tracking-wide uppercase">
                    Prompt {index + 1}
                  </p>
                  <p className="font-display mt-1 text-lg leading-snug">{prompt.question}</p>
                  {promptError && (
                    <p className="text-accent-strong mt-1 text-sm font-medium">{promptError}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setPicking({ mode: "replace", index })}
                  className={iconButton}
                  aria-label={`Change prompt ${index + 1}`}
                >
                  <RefreshCw aria-hidden="true" className="size-4" />
                </button>
              </div>
              <label htmlFor={answerId} className="sr-only">
                Your answer to {prompt.question}
              </label>
              <textarea
                id={answerId}
                value={prompt.answer}
                maxLength={PROMPT_ANSWER_MAX}
                rows={3}
                placeholder="Your answer…"
                aria-invalid={answerError ? true : undefined}
                aria-describedby={`${answerId}-count`}
                onChange={(event) =>
                  section.update((list) =>
                    list.map((item, i) => (i === index ? { ...item, answer: event.target.value } : item)),
                  )
                }
                className="bg-cream border-line focus:border-charcoal mt-3 w-full resize-none rounded-2xl border px-4 py-3 text-base outline-none aria-[invalid=true]:border-accent-strong"
              />
              <div className="mt-1 flex items-center justify-between gap-2">
                <p id={`${answerId}-count`} className={`text-xs ${answerError ? "text-accent-strong font-medium" : "text-muted"}`}>
                  {answerError ?? `${prompt.answer.length}/${PROMPT_ANSWER_MAX}`}
                </p>
                <div className="flex">
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    className={iconButton}
                    aria-label={`Move prompt ${index + 1} up`}
                  >
                    <ArrowUp aria-hidden="true" className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === prompts.length - 1}
                    className={iconButton}
                    aria-label={`Move prompt ${index + 1} down`}
                  >
                    <ArrowDown aria-hidden="true" className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => section.update((list) => list.filter((_, i) => i !== index))}
                    className={iconButton}
                    aria-label={`Remove prompt ${index + 1}`}
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {prompts.length < PROMPT_COUNT && (
        <Button variant="secondary" fullWidth className="mt-4" onClick={() => setPicking({ mode: "add" })}>
          <Plus aria-hidden="true" className="size-4" />
          Add a prompt ({prompts.length}/{PROMPT_COUNT})
        </Button>
      )}

      {picking && (
        <BottomSheet title="Choose a prompt" onClose={() => setPicking(null)}>
          <div className="space-y-5">
            {PROMPT_BANK.map((group) => (
              <div key={group.category}>
                <h3 className="text-muted mb-2 text-xs font-semibold tracking-wide uppercase">
                  {group.category}
                </h3>
                <ul className="divide-line border-line bg-surface divide-y overflow-hidden rounded-2xl border">
                  {group.prompts.map((question) => {
                    const taken = used.has(question);
                    return (
                      <li key={question}>
                        <button
                          type="button"
                          disabled={taken}
                          onClick={() => choose(question)}
                          className="hover:bg-charcoal/[0.03] focus-visible:outline-accent flex min-h-12 w-full items-center justify-between gap-3 px-4 py-2 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 disabled:cursor-default disabled:opacity-50"
                        >
                          <span>{question}</span>
                          {taken && (
                            <span className="text-forest inline-flex shrink-0 items-center gap-1 text-xs font-semibold">
                              <Check aria-hidden="true" className="size-3.5" />
                              Added
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </BottomSheet>
      )}

      <SaveBar
        dirty={section.dirty}
        isSaving={section.isSaving}
        status={section.status}
        error={section.problems.prompts ?? section.error}
        onSave={() => section.submit()}
      />
    </section>
  );
}
