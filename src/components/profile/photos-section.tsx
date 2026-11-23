"use client";

import { ArrowLeft, ArrowRight, ImagePlus, LoaderCircle, Star, Trash2 } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import { savePhotos } from "@/app/profile/edit/actions";
import { SaveBar, SectionIntro, useSectionSave } from "@/components/profile/use-section-save";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { MAX_PROFILE_PHOTOS } from "@/lib/constants/preferences";
import { IMAGE_EXTENSIONS } from "@/lib/image-rules";
import { ACCEPTED_IMAGES, uploadImage } from "@/lib/media";
import { newUuid } from "@/lib/uuid";

type Upload = { key: string; preview: string };

/** Move the item at `from` to `to`, shifting the others along. */
function moved<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Up to six profile photos. The first is the main photo, shown large here
 * and first everywhere else. Photos upload straight away, but the profile
 * only changes when the student saves (all at once, in order).
 */
export function PhotosSection({
  userId,
  initial,
  onDirtyChange,
}: {
  userId: string;
  initial: string[];
  onDirtyChange: (dirty: boolean) => void;
}) {
  const section = useSectionSave(initial, savePhotos, onDirtyChange);
  const photos = section.value;
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [uploadError, setUploadError] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const free = MAX_PROFILE_PHOTOS - photos.length - uploads.length;

  async function addFiles(list: FileList) {
    setUploadError("");
    const files = Array.from(list);
    const chosen = files.slice(0, Math.max(0, free));
    if (files.length > chosen.length) {
      setUploadError(`Only ${free} more ${free === 1 ? "photo fits" : "photos fit"}, so the rest were skipped.`);
    }
    await Promise.all(
      chosen.map(async (file) => {
        if (!IMAGE_EXTENSIONS[file.type]) {
          setUploadError("Use a JPG, PNG or WebP image.");
          return;
        }
        const upload = { key: newUuid(), preview: URL.createObjectURL(file) };
        setUploads((current) => [...current, upload]);
        try {
          const url = await uploadImage(userId, "photo", file);
          section.update((current) => [...current, url].slice(0, MAX_PROFILE_PHOTOS));
        } catch (failure) {
          setUploadError(
            failure instanceof Error ? failure.message : "That upload failed. Please try again.",
          );
        } finally {
          setUploads((current) => current.filter((item) => item.key !== upload.key));
          URL.revokeObjectURL(upload.preview);
        }
      }),
    );
  }

  function act(change: (list: string[]) => string[]) {
    section.update(change);
    setOpen(null);
  }

  const slots = Array.from({ length: MAX_PROFILE_PHOTOS }, (_, slot) => slot);
  const firstEmpty = photos.length + uploads.length;

  return (
    <section aria-labelledby="photos-heading">
      <SectionIntro id="photos-heading" title="Photos">
        Add up to six. Your first photo is your main one: it&apos;s what people see first. Tap
        a photo to move it, make it your main photo or remove it.
      </SectionIntro>
      <ul className="grid grid-cols-3 gap-2" aria-label="Your photos">
        {slots.map((slot) => {
          const isMain = slot === 0;
          const tileClass = `relative overflow-hidden rounded-2xl ${
            isMain ? "col-span-2 row-span-2" : "aspect-[4/5]"
          }`;
          const url = photos[slot];
          if (url) {
            return (
              <li key={url} className={tileClass}>
                <button
                  type="button"
                  onClick={() => setOpen(slot)}
                  aria-label={
                    isMain
                      ? "Main photo: options"
                      : `Photo ${slot + 1}: options`
                  }
                  className="focus-visible:outline-accent block size-full rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URL */}
                  <img src={url} alt="" className="size-full object-cover" />
                  {isMain && (
                    <span className="bg-charcoal/75 text-cream absolute top-2 left-2 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold">
                      <Star aria-hidden="true" className="size-3.5" fill="currentColor" />
                      Main
                    </span>
                  )}
                </button>
              </li>
            );
          }
          const upload = uploads[slot - photos.length];
          if (upload) {
            return (
              <li key={upload.key} className={`${tileClass} bg-accent-soft`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
                <img src={upload.preview} alt="" className="size-full object-cover opacity-50" />
                <LoaderCircle
                  aria-label="Uploading"
                  className="text-charcoal absolute inset-0 m-auto size-7 animate-spin"
                />
              </li>
            );
          }
          return (
            <li key={`empty-${slot}`} className={tileClass}>
              {slot === firstEmpty ? (
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="border-line text-muted hover:border-charcoal/40 hover:text-charcoal focus-visible:outline-accent flex size-full min-h-24 flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed text-sm font-medium focus-visible:outline-2"
                >
                  <ImagePlus aria-hidden="true" className="size-6" />
                  {isMain ? "Add your main photo" : "Add photo"}
                </button>
              ) : (
                <div aria-hidden="true" className="border-line/70 size-full min-h-24 rounded-2xl border-2 border-dashed" />
              )}
            </li>
          );
        })}
      </ul>

      <p className="text-muted mt-3 text-sm">
        {photos.length} of {MAX_PROFILE_PHOTOS} photos
        {free > 0 ? ` · ${free} ${free === 1 ? "slot" : "slots"} left` : " · all slots used"}.
        JPG, PNG or WebP. Large photos are resized for you.
      </p>
      {uploadError && (
        <p role="alert" className="text-accent-strong mt-2 text-sm font-medium">
          {uploadError}
        </p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_IMAGES}
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const files = event.target.files;
          if (files?.length) {
            void addFiles(files);
          }
          event.target.value = "";
        }}
      />

      {open !== null && photos[open] && (
        <BottomSheet
          title={open === 0 ? "Main photo" : `Photo ${open + 1}`}
          onClose={() => setOpen(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URL */}
          <img src={photos[open]} alt="" className="mb-4 h-40 w-32 rounded-2xl object-cover" />
          <ul className="divide-line border-line bg-surface divide-y overflow-hidden rounded-2xl border">
            {open > 0 && (
              <li>
                <SheetAction icon={Star} onClick={() => act((list) => moved(list, open, 0))}>
                  Make this my main photo
                </SheetAction>
              </li>
            )}
            {open > 0 && (
              <li>
                <SheetAction icon={ArrowLeft} onClick={() => act((list) => moved(list, open, open - 1))}>
                  Move earlier
                </SheetAction>
              </li>
            )}
            {open < photos.length - 1 && (
              <li>
                <SheetAction icon={ArrowRight} onClick={() => act((list) => moved(list, open, open + 1))}>
                  Move later
                </SheetAction>
              </li>
            )}
            <li>
              <SheetAction
                icon={Trash2}
                tone="danger"
                onClick={() => act((list) => list.filter((_, index) => index !== open))}
              >
                Remove photo
              </SheetAction>
            </li>
          </ul>
        </BottomSheet>
      )}

      <SaveBar
        dirty={section.dirty}
        isSaving={section.isSaving}
        status={section.status}
        error={section.problems.photos ?? section.error}
        onSave={() => section.submit()}
        label="Save photos"
      />
    </section>
  );
}

function SheetAction({
  icon: Icon,
  tone,
  onClick,
  children,
}: {
  icon: typeof Star;
  tone?: "danger";
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`hover:bg-charcoal/[0.03] focus-visible:outline-accent flex min-h-12 w-full items-center gap-3 px-4 text-left font-medium focus-visible:outline-2 focus-visible:-outline-offset-2 ${
        tone === "danger" ? "text-accent-strong" : ""
      }`}
    >
      <Icon aria-hidden="true" className="size-5" />
      {children}
    </button>
  );
}
