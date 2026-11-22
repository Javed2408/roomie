"use client";

import { Download, Share, X } from "lucide-react";
import { useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";

/** Chrome's "this site can be installed" event (not in TypeScript's DOM types). */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISSED_KEY = "roomie:install-banner-dismissed";
/** After "not now", stay quiet for two weeks. */
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

// Chrome, Edge and Android announce that the app can be installed once per
// page load, sometimes before React is ready. Listening as soon as this file
// loads means the moment is never missed.
let installPrompt: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Show our banner instead of the browser's own mini pop-up.
    event.preventDefault();
    installPrompt = event as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    notify();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function isInstalled(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari's own flag for "opened from the home screen".
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  const agent = navigator.userAgent;
  // iPads report themselves as Macs, but Macs have no touch screen.
  return /iPad|iPhone|iPod/.test(agent) || (agent.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

function wasDismissed(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISSED_KEY));
    return at > 0 && Date.now() - at < SNOOZE_MS;
  } catch {
    // Storage blocked (e.g. private mode): just show the banner.
    return false;
  }
}

/** What to offer: Chrome's install button, the iOS how-to, or nothing. */
function currentOffer(): "button" | "ios" | null {
  if (isInstalled() || wasDismissed()) {
    return null;
  }
  if (installPrompt) {
    return "button";
  }
  return isIos() ? "ios" : null;
}

function dismiss() {
  try {
    localStorage.setItem(DISMISSED_KEY, String(Date.now()));
  } catch {
    // Can't remember it; it simply shows again next time.
  }
  installPrompt = null;
  notify();
}

async function install() {
  const prompt = installPrompt;
  if (!prompt) {
    return;
  }
  await prompt.prompt();
  // Each prompt works once; whatever they chose, hide the banner.
  await prompt.userChoice;
  installPrompt = null;
  notify();
}

/**
 * "Install Roomie App": a small, dismissible card. Android and desktop
 * Chrome get a real Install button; iPhone and iPad (which have no install
 * prompt) get the Share → Add to Home Screen steps. Hidden once installed.
 */
export function InstallBanner() {
  // On the server there's no browser to ask, so render nothing there.
  const offer = useSyncExternalStore(subscribe, currentOffer, () => null);
  if (!offer) {
    return null;
  }

  return (
    <aside
      aria-label="Install Roomie"
      className="bg-surface border-line mb-5 flex items-start gap-3 rounded-2xl border py-3 pr-1 pl-3"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- tiny local SVG */}
      <img src="/icon.svg" alt="" className="mt-0.5 size-11 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">Install Roomie App</p>
        {offer === "button" ? (
          <>
            <p className="text-muted mt-0.5 text-xs leading-relaxed">
              Open it from your home screen, full screen, like any app.
            </p>
            <Button className="mt-2 px-4 text-sm" onClick={() => void install()}>
              <Download aria-hidden="true" className="size-4" />
              Install
            </Button>
          </>
        ) : (
          <p className="text-muted mt-0.5 text-xs leading-relaxed">
            Tap{" "}
            <Share aria-hidden="true" className="text-charcoal inline size-3.5 align-[-2px]" />{" "}
            <strong className="text-charcoal font-semibold">Share</strong>, then{" "}
            <strong className="text-charcoal font-semibold">Add to Home Screen</strong>.
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss install banner"
        className="text-muted hover:bg-charcoal/5 focus-visible:outline-accent flex size-12 shrink-0 items-center justify-center rounded-full focus-visible:outline-2"
      >
        <X aria-hidden="true" className="size-5" />
      </button>
    </aside>
  );
}
