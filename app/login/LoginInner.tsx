"use client";

import { AuthPanel } from "@/components/AuthPanel";
import { useSupabaseUser } from "@/lib/useSupabaseUser";
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const DEFAULT_LOGIN_REDIRECT = "/editor";

function sanitizeNextPath(rawNext: string | null): string {
  if (!rawNext) return DEFAULT_LOGIN_REDIRECT;
  const candidate = rawNext.trim();
  if (!candidate.startsWith("/")) return DEFAULT_LOGIN_REDIRECT;
  if (candidate.startsWith("//")) return DEFAULT_LOGIN_REDIRECT;

  try {
    const parsed = new URL(candidate, "http://localhost");
    if (parsed.origin !== "http://localhost") return DEFAULT_LOGIN_REDIRECT;
    if (!parsed.pathname.startsWith("/")) return DEFAULT_LOGIN_REDIRECT;
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return DEFAULT_LOGIN_REDIRECT;
  }
}

export default function LoginInner() {
  const { user, loading } = useSupabaseUser();
  const router = useRouter();
  const sp = useSearchParams();

  // Optional: allow redirect back to where user came from
  const next = sanitizeNextPath(sp.get("next"));

  useEffect(() => {
    if (loading) return;
    if (user) router.replace(next);
  }, [loading, user, router, next]);

  return (
    <main className="scheme-light min-h-screen bg-canvas text-ink flex items-center justify-center px-4">
      <div className="w-full max-w-2xl">
        <h1 className="text-lg font-semibold mb-2 text-ink">Log in to Vibode</h1>
        <p className="text-[11px] text-ink-secondary mb-3">
          Use your Vibode account email and password. After login, you&apos;ll be sent to your
          workspace.
        </p>

        <AuthPanel appearance="retail" />

        <p className="text-[11px] text-ink-secondary mt-2">
          Redirect after login: <span className="text-ink">{next}</span>
        </p>
      </div>
    </main>
  );
}
