import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { GroupForm } from "@/components/groups/group-form";
import { AppShell } from "@/components/ui/app-shell";
import { EMPTY_GROUP_FORM } from "@/lib/group-validation";
import { requireStudent } from "@/lib/profile";

export const metadata: Metadata = { title: "New group · Roomie" };

async function NewGroup() {
  const student = await requireStudent();
  return (
    <>
      <h1 className="font-display mb-4 text-3xl font-semibold tracking-tight">Start a group</h1>
      <GroupForm userId={student.user.id} initial={EMPTY_GROUP_FORM} />
    </>
  );
}

export default function NewGroupPage() {
  return (
    <AppShell
      header={
        <Link
          href="/groups"
          className="hover:bg-charcoal/5 focus-visible:outline-accent -ml-2 inline-flex min-h-12 items-center gap-2 rounded-full pr-4 pl-2 font-semibold focus-visible:outline-2"
        >
          <ArrowLeft aria-hidden="true" className="size-5" />
          Groups
        </Link>
      }
    >
      <Suspense fallback={<div aria-hidden="true" className="bg-charcoal/5 h-64 animate-pulse rounded-3xl" />}>
        <NewGroup />
      </Suspense>
    </AppShell>
  );
}
