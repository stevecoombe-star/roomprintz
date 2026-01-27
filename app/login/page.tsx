"use client";

import { AuthPanel } from "@/components/AuthPanel";
import { useSupabaseUser } from "@/lib/useSupabaseUser";
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginPage() {
  const { user, loading } = useSupabaseUser();
  const router = useRouter();
  const sp = useSearchParams();

  // Optional: allow redirect back to where user came from
  const next = sp.get("next") || "/editor";

  useEffect(() => {
    if (loading) return;
    if (user) router.replace(next);
  }, [loading, user, router, next]);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-2xl">
        <h1 className="text-lg font-semibold mb-2">Log in</h1>
        <p className="text-[11px] text-slate-400 mb-3">
          Dev login (email/password). After login you’ll be sent back to the editor.
        </p>

        <AuthPanel />

        <p className="text-[11px] text-slate-500 mt-2">
          Redirect after login: <span className="text-slate-300">{next}</span>
        </p>
      </div>
    </main>
  );
}
