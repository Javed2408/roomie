"use client";

import { CircleAlert, MailCheck, ShieldCheck } from "lucide-react";
import {
  useActionState,
  useId,
  useState,
  type ComponentProps,
} from "react";

import { authenticate, type AuthState } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { SRM_EMAIL_DOMAIN as SRM_DOMAIN, isSrmEmail } from "@/lib/eligibility";

type Mode = "signin" | "signup";

function TextInput({
  label,
  hint,
  ...props
}: { label: string; hint?: string } & ComponentProps<"input">) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold">
        {label}
      </label>
      <input
        id={id}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="bg-surface border-line focus:border-charcoal focus:outline-charcoal/20 min-h-12 w-full rounded-2xl border px-4 text-base outline-offset-0 focus:outline-4"
        {...props}
      />
      {hint && (
        <p id={`${id}-hint`} className="text-muted mt-1.5 text-sm">
          {hint}
        </p>
      )}
    </div>
  );
}

/** Whether the email typed so far can create an account. */
function EmailHint({ email }: { email: string }) {
  if (!email.includes("@")) {
    return null;
  }
  if (isSrmEmail(email)) {
    return (
      <p className="text-forest mt-1.5 flex items-center gap-1.5 text-sm font-medium">
        <ShieldCheck aria-hidden="true" className="size-4" />
        SRM address: you&apos;ll get the badge once it&apos;s confirmed.
      </p>
    );
  }
  return (
    <p className="text-accent-strong mt-1.5 flex items-center gap-1.5 text-sm font-medium">
      <CircleAlert aria-hidden="true" className="size-4" />
      Only {SRM_DOMAIN} addresses can create an account.
    </p>
  );
}

/**
 * Sign in or create an account with email and password. The real work
 * happens in the `authenticate` server action.
 */
export function AuthForm({ linkError }: { linkError: boolean }) {
  const [mode, setMode] = useState<Mode>("signin");
  // Controlled, so what was typed survives a failed attempt.
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [state, formAction, isPending] = useActionState<AuthState, FormData>(
    authenticate,
    {},
  );
  const isSignUp = mode === "signup";

  return (
    <div className="space-y-6">
      <div className="bg-forest-soft border-forest/20 rounded-card border p-5">
        <p className="text-forest flex items-center gap-2 font-semibold">
          <ShieldCheck aria-hidden="true" className="size-5 shrink-0" />
          Only for SRM students
        </p>
        <p className="text-charcoal/80 mt-1.5 text-sm leading-relaxed">
          Sign up with your {SRM_DOMAIN} email and confirm it from your inbox.
          That gives you the green{" "}
          <strong className="text-forest">Verified SRM Student</strong> badge,
          so everyone knows you&apos;re really a student.
        </p>
      </div>

      <div
        role="group"
        aria-label="Sign in or create an account"
        className="bg-charcoal/5 grid grid-cols-2 gap-1 rounded-full p-1"
      >
        {(
          [
            ["signin", "Sign in"],
            ["signup", "Create account"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => setMode(value)}
            className={`min-h-11 rounded-full text-sm font-semibold transition-colors ${
              mode === value
                ? "bg-surface text-charcoal shadow-sm"
                : "text-muted hover:text-charcoal"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <form action={formAction} className="space-y-4">
        <input type="hidden" name="intent" value={mode} />
        {isSignUp && (
          <TextInput
            label="Your name"
            name="full_name"
            autoComplete="name"
            maxLength={80}
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            hint="Optional for now; you can add it to your profile later."
          />
        )}
        <div>
          <TextInput
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            placeholder={`yourname${SRM_DOMAIN}`}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          {isSignUp && <EmailHint email={email} />}
        </div>
        <TextInput
          label="Password"
          name="password"
          type="password"
          autoComplete={isSignUp ? "new-password" : "current-password"}
          required
          minLength={8}
          hint={isSignUp ? "At least 8 characters." : undefined}
        />

        {(state.error || linkError) && (
          <p
            role="alert"
            className="bg-accent-soft text-accent-strong flex items-start gap-2 rounded-2xl p-3 text-sm font-medium"
          >
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {state.error ??
              "That confirmation link didn't work. It may have expired: sign in, or create the account again."}
          </p>
        )}
        {state.notice && (
          <p
            role="status"
            className="bg-forest-soft text-forest flex items-start gap-2 rounded-2xl p-3 text-sm font-medium"
          >
            <MailCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {state.notice}
          </p>
        )}

        <Button type="submit" fullWidth disabled={isPending}>
          {isPending
            ? "One moment…"
            : isSignUp
              ? "Create account"
              : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
