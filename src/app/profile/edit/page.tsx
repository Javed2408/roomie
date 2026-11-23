import { ArrowLeft, Eye } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { editorSection } from "@/components/profile/editor-sections";
import { ProfileEditor } from "@/components/profile/profile-editor";
import { AppShell } from "@/components/ui/app-shell";
import { requireStudent } from "@/lib/profile";
import { loadEditorData } from "@/lib/student";

export const metadata: Metadata = { title: "Edit profile · Roomie" };

async function Editor({ searchParams }: { searchParams: PageProps<"/profile/edit">["searchParams"] }) {
  const student = await requireStudent();
  const [data, { section }] = await Promise.all([loadEditorData(student), searchParams]);
  const initialSection = editorSection(section);
  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Edit profile</h1>
        <Link
          href={`/students/${student.user.id}`}
          className="text-charcoal hover:bg-charcoal/5 focus-visible:outline-accent inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-semibold focus-visible:outline-2"
        >
          <Eye aria-hidden="true" className="size-4" />
          Preview
        </Link>
      </div>
      <ProfileEditor data={data} initialSection={initialSection} />
    </>
  );
}

function EditorPlaceholder() {
  return (
    <div aria-hidden="true" className="space-y-4">
      <div className="bg-charcoal/5 h-9 w-1/2 animate-pulse rounded-xl" />
      <div className="bg-charcoal/5 h-11 animate-pulse rounded-full" />
      <div className="bg-charcoal/5 rounded-card aspect-square animate-pulse" />
    </div>
  );
}

export default function EditProfilePage({ searchParams }: PageProps<"/profile/edit">) {
  return (
    <AppShell
      header={
        <Link
          href="/account"
          className="hover:bg-charcoal/5 focus-visible:outline-accent -ml-2 inline-flex min-h-12 items-center gap-2 rounded-full pr-4 pl-2 font-semibold focus-visible:outline-2"
        >
          <ArrowLeft aria-hidden="true" className="size-5" />
          Account
        </Link>
      }
    >
      <Suspense fallback={<EditorPlaceholder />}>
        <Editor searchParams={searchParams} />
      </Suspense>
    </AppShell>
  );
}
