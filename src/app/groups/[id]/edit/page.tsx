import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { GroupForm } from "@/components/groups/group-form";
import { AppShell } from "@/components/ui/app-shell";
import { formFromGroup } from "@/lib/group-validation";
import { loadGroupView } from "@/lib/groups";
import { requireStudent } from "@/lib/profile";

export const metadata: Metadata = { title: "Edit group · Roomie" };

async function EditGroup({ params }: { params: PageProps<"/groups/[id]/edit">["params"] }) {
  const student = await requireStudent();
  const { id } = await params;
  const view = await loadGroupView(student.user.id, id);
  // Admins only (the database refuses anyone else's changes too).
  if (!view || !view.isAdmin) {
    notFound();
  }
  return (
    <>
      <h1 className="font-display mb-4 text-3xl font-semibold tracking-tight">Edit {view.group.name}</h1>
      <GroupForm
        key={view.group.id}
        userId={student.user.id}
        groupId={view.group.id}
        initial={formFromGroup(view.group)}
        memberCount={view.members.length}
      />
    </>
  );
}

export default function EditGroupPage({ params }: PageProps<"/groups/[id]/edit">) {
  return (
    <AppShell
      header={
        <Link
          href="/groups/mine"
          className="hover:bg-charcoal/5 focus-visible:outline-accent -ml-2 inline-flex min-h-12 items-center gap-2 rounded-full pr-4 pl-2 font-semibold focus-visible:outline-2"
        >
          <ArrowLeft aria-hidden="true" className="size-5" />
          Your groups
        </Link>
      }
    >
      <Suspense fallback={<div aria-hidden="true" className="bg-charcoal/5 h-64 animate-pulse rounded-3xl" />}>
        <EditGroup params={params} />
      </Suspense>
    </AppShell>
  );
}
