// app/app/profile/page.tsx
"use client";

import { AuthPanel } from "@/components/AuthPanel";
import { RealtorHeader } from "@/components/RealtorHeader";
import { ProfileSettings } from "@/components/ProfileSettings";
import Link from "next/link";

export default function ProfilePage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-50">
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h1 className="text-xl font-semibold tracking-tight">
            Profile & account
          </h1>
          <Link
            href="/app"
            className="text-[11px] rounded-lg border border-slate-700 px-3 py-1 hover:border-emerald-400/70 hover:text-emerald-200 transition"
          >
            ← Back to dashboard
          </Link>
        </div>

        <AuthPanel />

        <RealtorHeader />

        <ProfileSettings />
      </div>
    </main>
  );
}
