"use client";

import { Camera, ImagePlus, LoaderCircle, UserRound, X } from "lucide-react";
import { useRef, useState } from "react";

import { ACCEPTED_IMAGES, imageProblem, uploadImage } from "@/lib/media";

/** A hidden file input opened by a visible button. */
function useFilePicker(onFile: (file: File) => void) {
  const ref = useRef<HTMLInputElement>(null);
  const input = (
    <input
      ref={ref}
      type="file"
      accept={ACCEPTED_IMAGES}
      className="sr-only"
      tabIndex={-1}
      aria-hidden="true"
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) {
          onFile(file);
        }
      }}
    />
  );
  return { input, open: () => ref.current?.click() };
}

/** Upload a file, showing it straight away while it uploads. */
function useUpload(
  userId: string,
  prefix: "avatar" | "listing",
  onUploaded: (url: string) => void,
) {
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    const problem = imageProblem(file);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    const local = URL.createObjectURL(file);
    setPreview(local);
    try {
      onUploaded(await uploadImage(userId, prefix, file));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Upload failed.");
    } finally {
      setPreview(null);
      URL.revokeObjectURL(local);
    }
  }

  return { preview, error, upload };
}

export function AvatarPicker({
  userId,
  value,
  onChange,
}: {
  userId: string;
  value: string | null;
  onChange: (url: string | null) => void;
}) {
  const { preview, error, upload } = useUpload(userId, "avatar", onChange);
  const picker = useFilePicker(upload);
  const shown = preview ?? value;

  return (
    <div>
      <p className="mb-2 text-sm font-semibold">Profile photo</p>
      <div className="flex items-center gap-4">
        <div className="bg-accent-soft text-muted relative flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-full">
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element -- local preview or Supabase Storage URL
            <img src={shown} alt="" className="size-full object-cover" />
          ) : (
            <UserRound aria-hidden="true" className="size-10" />
          )}
          {preview && (
            <span className="bg-charcoal/40 absolute inset-0 flex items-center justify-center">
              <LoaderCircle
                aria-hidden="true"
                className="text-cream size-6 animate-spin"
              />
            </span>
          )}
        </div>
        <div className="space-y-1">
          <button
            type="button"
            onClick={picker.open}
            disabled={Boolean(preview)}
            className="border-line bg-surface hover:border-charcoal/40 focus-visible:outline-accent inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
          >
            <Camera aria-hidden="true" className="size-4" />
            {preview ? "Uploading…" : value ? "Change photo" : "Add a photo"}
          </button>
          <p className="text-muted text-xs">JPG, PNG or WebP, up to 5 MB.</p>
        </div>
      </div>
      {picker.input}
      {error && (
        <p role="alert" className="text-accent-strong mt-2 text-sm font-medium">
          {error}
        </p>
      )}
    </div>
  );
}

export function ListingPhotosPicker({
  userId,
  value,
  onChange,
  max,
}: {
  userId: string;
  value: string[];
  onChange: (urls: string[]) => void;
  max: number;
}) {
  const { preview, error, upload } = useUpload(userId, "listing", (url) =>
    onChange([...value, url]),
  );
  const picker = useFilePicker(upload);
  const canAdd = value.length < max && !preview;

  return (
    <div>
      <p className="mb-2 text-sm font-semibold">
        Flat photos{" "}
        <span className="text-muted font-normal">
          ({value.length}/{max})
        </span>
      </p>
      <ul className="grid grid-cols-2 gap-3">
        {value.map((url, index) => (
          <li
            key={url}
            className="bg-accent-soft relative aspect-[4/3] overflow-hidden rounded-2xl"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URL */}
            <img
              src={url}
              alt={`Flat photo ${index + 1}`}
              className="size-full object-cover"
            />
            <button
              type="button"
              onClick={() => onChange(value.filter((item) => item !== url))}
              aria-label={`Remove flat photo ${index + 1}`}
              className="bg-charcoal/70 text-cream focus-visible:outline-accent absolute top-2 right-2 flex size-9 items-center justify-center rounded-full focus-visible:outline-2"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </li>
        ))}
        {preview && (
          <li className="bg-accent-soft relative aspect-[4/3] overflow-hidden rounded-2xl">
            {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
            <img src={preview} alt="" className="size-full object-cover opacity-60" />
            <LoaderCircle
              aria-label="Uploading"
              className="text-charcoal absolute inset-0 m-auto size-7 animate-spin"
            />
          </li>
        )}
        {canAdd && (
          <li>
            <button
              type="button"
              onClick={picker.open}
              className="border-line text-muted hover:border-charcoal/40 hover:text-charcoal focus-visible:outline-accent flex aspect-[4/3] w-full flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed text-sm font-medium focus-visible:outline-2"
            >
              <ImagePlus aria-hidden="true" className="size-6" />
              Add photo
            </button>
          </li>
        )}
      </ul>
      {picker.input}
      {error && (
        <p role="alert" className="text-accent-strong mt-2 text-sm font-medium">
          {error}
        </p>
      )}
    </div>
  );
}
