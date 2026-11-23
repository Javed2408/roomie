"use client";

import { Check, ChevronDown } from "lucide-react";
import { useId, type ComponentProps, type ReactNode } from "react";

const CONTROL =
  "bg-surface border-line focus:border-charcoal focus:outline-charcoal/20 min-h-12 w-full rounded-2xl border px-4 text-base outline-offset-0 focus:outline-4 aria-[invalid=true]:border-accent-strong";

function Message({
  id,
  hint,
  error,
}: {
  id: string;
  hint?: ReactNode;
  error?: string;
}) {
  if (error) {
    return (
      <p id={id} className="text-accent-strong mt-1.5 text-sm font-medium">
        {error}
      </p>
    );
  }
  return hint ? (
    <p id={id} className="text-muted mt-1.5 text-sm">
      {hint}
    </p>
  ) : null;
}

type FieldProps = { label: string; hint?: ReactNode; error?: string };

export function TextField({
  label,
  hint,
  error,
  ...props
}: FieldProps & ComponentProps<"input">) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint || error ? `${id}-msg` : undefined}
        className={CONTROL}
        {...props}
      />
      <Message id={`${id}-msg`} hint={hint} error={error} />
    </div>
  );
}

export function SelectField({
  label,
  hint,
  error,
  options,
  placeholder,
  ...props
}: FieldProps &
  ComponentProps<"select"> & {
    options: ReadonlyArray<{ value: string; label: string }>;
    placeholder?: string;
  }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold">
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={hint || error ? `${id}-msg` : undefined}
          className={`${CONTROL} appearance-none pr-10`}
          {...props}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="text-muted pointer-events-none absolute top-1/2 right-4 size-4 -translate-y-1/2"
        />
      </div>
      <Message id={`${id}-msg`} hint={hint} error={error} />
    </div>
  );
}

export function TextAreaField({
  label,
  hint,
  error,
  ...props
}: FieldProps & ComponentProps<"textarea">) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold">
        {label}
      </label>
      <textarea
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint || error ? `${id}-msg` : undefined}
        className={`${CONTROL} min-h-24 resize-none py-3`}
        {...props}
      />
      <Message id={`${id}-msg`} hint={hint} error={error} />
    </div>
  );
}

/**
 * Tappable chips: pick one (`multiple={false}`) or several. With
 * `clearable`, tapping the chosen chip again un-picks it (for optional
 * questions). `disabled` options can't be newly picked.
 */
export function ChipGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  multiple = true,
  clearable = false,
  isDisabled,
  error,
  hint,
}: {
  label: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T[];
  onChange: (value: T[]) => void;
  multiple?: boolean;
  clearable?: boolean;
  isDisabled?: (option: T) => boolean;
  error?: string;
  hint?: ReactNode;
}) {
  const id = useId();
  return (
    <fieldset aria-describedby={hint || error ? `${id}-msg` : undefined}>
      <legend className="mb-2 text-sm font-semibold">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const isOn = value.includes(option.value);
          const disabled = !isOn && Boolean(isDisabled?.(option.value));
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={isOn}
              disabled={disabled}
              onClick={() =>
                onChange(
                  multiple
                    ? isOn
                      ? value.filter((item) => item !== option.value)
                      : [...value, option.value]
                    : isOn && clearable
                      ? []
                      : [option.value],
                )
              }
              className={`focus-visible:outline-accent inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40 ${
                isOn
                  ? "bg-charcoal text-cream border-charcoal"
                  : "bg-surface border-line text-charcoal hover:border-charcoal/40"
              }`}
            >
              {isOn && <Check aria-hidden="true" className="size-4" />}
              {option.label}
            </button>
          );
        })}
      </div>
      <Message id={`${id}-msg`} hint={hint} error={error} />
    </fieldset>
  );
}

/** Turn a list of strings into chip/select options. */
export function asOptions<T extends string>(
  values: readonly T[],
): Array<{ value: T; label: string }> {
  return values.map((value) => ({ value, label: value }));
}
