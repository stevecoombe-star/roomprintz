"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useSupabaseUser } from "@/lib/useSupabaseUser";

const DEFAULT_ADMIN_REDIRECT = "/admin";

type AdminAccessResponse = {
  isAdmin?: unknown;
};

function sanitizeNextPath(rawNext: string | null): string {
  if (!rawNext) return DEFAULT_ADMIN_REDIRECT;
  const candidate = rawNext.trim();
  if (!candidate.startsWith("/")) return DEFAULT_ADMIN_REDIRECT;
  if (candidate.startsWith("//")) return DEFAULT_ADMIN_REDIRECT;

  try {
    const parsed = new URL(candidate, "http://localhost");
    if (parsed.origin !== "http://localhost") return DEFAULT_ADMIN_REDIRECT;
    if (!parsed.pathname.startsWith("/")) return DEFAULT_ADMIN_REDIRECT;
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return DEFAULT_ADMIN_REDIRECT;
  }
}

async function verifyAdminEmail(email: string): Promise<boolean> {
  try {
    const response = await fetch("/api/auth/admin-access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!response.ok) return false;
    const payload = (await response.json().catch(() => ({}))) as AdminAccessResponse;
    return payload.isAdmin === true;
  } catch {
    return false;
  }
}

export default function AdminLoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading } = useSupabaseUser();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const nextPath = useMemo(
    () => sanitizeNextPath(searchParams.get("next")),
    [searchParams]
  );

  useEffect(() => {
    if (loading || !user?.email) return;

    let cancelled = false;
    void (async () => {
      const isAdmin = await verifyAdminEmail(user.email ?? "");
      if (!cancelled && isAdmin) {
        router.replace(DEFAULT_ADMIN_REDIRECT);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, user, router]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setErrorMessage(error.message);
        return;
      }

      const signedInEmail = data.user?.email ?? email;
      const isAdmin = await verifyAdminEmail(signedInEmail);
      if (!isAdmin) {
        await supabase.auth.signOut();
        setErrorMessage("Admin access required.");
        return;
      }

      router.replace(nextPath.startsWith("/admin") ? nextPath : DEFAULT_ADMIN_REDIRECT);
    } catch {
      setErrorMessage("Unexpected error during admin login.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
        <h1 className="text-xl font-semibold tracking-tight">Vibode Admin</h1>
        <p className="mt-2 text-sm text-slate-400">
          Administrator sign-in for the closed beta control area.
        </p>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Email</label>
            <input
              type="email"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-400"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="admin@vibode.com"
              autoComplete="email"
              required
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Password</label>
            <input
              type="password"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-400"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </div>

          {errorMessage && <p className="text-xs text-rose-300">{errorMessage}</p>}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-400 disabled:opacity-60"
          >
            {isSubmitting ? "Signing in..." : "Admin login"}
          </button>
        </form>
      </div>
    </main>
  );
}
