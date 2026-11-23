"use client";

import { ArrowLeft, ArrowRight, ImagePlus, LoaderCircle, Star, Trash2 } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import { BottomSheet } from "@/components/ui/bottom-sheet";
import { MAX_LISTING_PHOTOS } from "@/lib/constants/prompts";
import { IMAGE_EXTENSIONS } from "@/lib/image-rules";
import { ACCEPTED_IMAGES, uploadImage } from "@/lib/media";
import { newUuid } from "@/lib/uuid";

type Upload = { key: string; preview: string; name: string };

function moved<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Photos of the flat, separate from profile photos (they're stored as
 * "listing-" files and saved on the listing only). The first is the cover.
 * Photos upload straight away; the listing changes when it's saved.
 */
export function ListingPhotos({
  userId,
  value,
  onChange,
  error,
}: {
  userId: string;
  value: string[];
  onChange: (update: (current: string[]) => string[]) => void;
  error?: string;
}) {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [uploadError, setUploadError] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const free = MAX_LISTING_PHOTOS - value.length - uploads.length;

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
          setUploadError(`${file.name}: use a JPG, PNG or WebP image.`);
          return;
        }
        const upload = { key: newUuid(), preview: URL.createObjectURL(file), name: file.name };
        setUploads((current) => [...current, upload]);
        try {
          const url = await uploadImage(userId, "listing", file);
          onChange((current) => [...current, url].slice(0, MAX_LISTING_PHOTOS));
        } catch (failure) {
          setUploadError(
            `${file.name}: ${failure instanceof Error ? failure.message : "the upload failed. Please try again."}`,
          );
        } finally {
          setUploads((current) => current.filter((item) => item.key !== upload.key));
          URL.revokeObjectURL(upload.preview);
        }
      }),
    );
  }

  function act(change: (list: string[]) => string[]) {
    onChange(change);
    setOpen(null);
  }

  return (
    <div>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Flat photos">
        {value.map((url, index) => (
          <li key={url} className="relative aspect-[4/3] overflow-hidden rounded-2xl">
            <button
              type="button"
              onClick={() => setOpen(index)}
              aria-label={index === 0 ? "Cover photo: options" : `Photo ${index + 1}: options`}
              className="focus-visible:outline-accent block size-full rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URL */}
              <img src={url} alt="" className="size-full object-cover" />
              {index === 0 && (
                <span className="bg-charcoal/75 text-cream absolute top-2 left-2 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold">
                  <Star aria-hidden="true" className="size-3.5" fill="currentColor" />
                  Cover
                </span>
              )}
            </button>
          </li>
        ))}
        {uploads.map((upload) => (
          <li key={upload.key} className="bg-accent-soft relative aspect-[4/3] overflow-hidden rounded-2xl">
            {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
            <img src={upload.preview} alt="" className="size-full object-cover opacity-50" />
            <span className="text-charcoal absolute inset-0 flex flex-col items-center justify-center gap-1 text-xs font-semibold">
              <LoaderCircle aria-hidden="true" className="size-6 animate-spin" />
              Uploading…
            </span>
          </li>
        ))}
        {free > 0 && (
          <li className="aspect-[4/3]">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="border-line text-muted hover:border-charcoal/40 hover:text-charcoal focus-visible:outline-accent flex size-full flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed text-sm font-medium focus-visible:outline-2"
            >
              <ImagePlus aria-hidden="true" className="size-6" />
              {value.length === 0 ? "Add photos" : "Add more"}
            </button>
          </li>
        )}
      </ul>

      <p className="text-muted mt-3 text-sm" aria-live="polite">
        {value.length} of {MAX_LISTING_PHOTOS} photos
        {uploads.length > 0 ? ` · uploading ${uploads.length}` : ""}. JPG, PNG or WebP up to 5 MB; big
        photos are resized for you. The first is the cover; tap a photo to move or remove it.
      </p>
      {(uploadError || error) && (
        <p role="alert" className="text-accent-strong mt-2 text-sm font-medium">
          {uploadError || error}
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

      {open !== null && value[open] && (
        <BottomSheet title={open === 0 ? "Cover photo" : `Photo ${open + 1}`} onClose={() => setOpen(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URL */}
          <img src={value[open]} alt="" className="mb-4 aspect-[4/3] w-48 rounded-2xl object-cover" />
          <ul className="divide-line border-line bg-surface divide-y overflow-hidden rounded-2xl border">
            {open > 0 && (
              <li>
                <SheetAction icon={Star} onClick={() => act((list) => moved(list, open, 0))}>
                  Make this the cover photo
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
            {open < value.length - 1 && (
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
    </div>
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
