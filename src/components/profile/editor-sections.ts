import {
  Camera,
  Compass,
  Heart,
  MessageSquareQuote,
  Sun,
  UserRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";

/**
 * The profile editor's sections, in tab order. A plain module (not a
 * client one) so the server page can read the ids too.
 */
export const EDITOR_SECTIONS = [
  { id: "photos", label: "Photos", icon: Camera },
  { id: "about", label: "About", icon: UserRound },
  { id: "prompts", label: "Prompts", icon: MessageSquareQuote },
  { id: "interests", label: "Interests", icon: Heart },
  { id: "lifestyle", label: "Lifestyle", icon: Sun },
  { id: "practical", label: "Flat needs", icon: Wallet },
  { id: "housing", label: "Housing", icon: Compass },
] as const satisfies ReadonlyArray<{ id: string; label: string; icon: LucideIcon }>;

export type EditorSection = (typeof EDITOR_SECTIONS)[number]["id"];

/** A section id from the address bar, or the first section. */
export function editorSection(value: unknown): EditorSection {
  return EDITOR_SECTIONS.find((section) => section.id === value)?.id ?? "photos";
}
