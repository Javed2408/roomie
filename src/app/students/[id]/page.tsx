import { Pencil } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { StudentProfile } from "@/components/profile/student-profile";
import { AppShell } from "@/components/ui/app-shell";
import { BottomNav } from "@/components/ui/bottom-nav";
import { ButtonLink } from "@/components/ui/button";
import { Wordmark } from "@/components/ui/wordmark";
import { requireStudent } from "@/lib/profile";
import { loadPublicStudent } from "@/lib/student";

export const metadata: Metadata = { title: "Profile · Roomie" };

/** Any student's public profile; only signed-in SRM students can open it. */
async function Profile({ params }: { params: PageProps<"/students/[id]">["params"] }) {
  const viewer = await requireStudent();
  const { id } = await params;
  const student = await loadPublicStudent(id);
  if (!student) {
    notFound();
  }
  const isOwn = id === viewer.user.id;
  return (
    <>
      {isOwn && (
        <div className="bg-forest-soft mb-6 flex items-center justify-between gap-3 rounded-2xl p-4">
          <p className="text-sm">
            <strong className="text-forest">Preview:</strong> this is how other students see
            your profile.
          </p>
          <ButtonLink href="/profile/edit" variant="secondary" className="min-h-11 shrink-0 px-4 text-sm">
            <Pencil aria-hidden="true" className="size-4" />
            Edit
          </ButtonLink>
        </div>
      )}
      <StudentProfile student={student} />
    </>
  );
}

function ProfilePlaceholder() {
  return (
    <div aria-hidden="true" className="space-y-4">
      <div className="bg-charcoal/5 h-10 w-1/2 animate-pulse rounded-xl" />
      <div className="bg-charcoal/5 rounded-card aspect-[4/5] animate-pulse" />
    </div>
  );
}

export default function StudentPage({ params }: PageProps<"/students/[id]">) {
  return (
    <AppShell header={<Wordmark />} footer={<BottomNav />}>
      <Suspense fallback={<ProfilePlaceholder />}>
        <Profile params={params} />
      </Suspense>
    </AppShell>
  );
}
