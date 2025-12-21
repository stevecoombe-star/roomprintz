// components/AuthPanel.tsx
"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useSupabaseUser } from "@/lib/useSupabaseUser";
import { useRouter } from "next/navigation";

type AuthPanelProps = {
  redirectToAppOnAuth?: boolean;
};

export function AuthPanel({ redirectToAppOnAuth = false }: AuthPanelProps) {
  const { user, loading } = useSupabaseUser();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const router = useRouter();

  // 👇 Auto-redirect to /app after login/signup when used on landing
  useEffect(() => {
    if (!redirectToAppOnAuth) return;
    if (loading) return;
    if (user) {
      router.push("/app");
    }
  }, [redirectToAppOnAuth, loading, user, router]);

  const handleSignUp = async () => {
    setAuthLoading(true);
    setErrorMessage(null);
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (error) {
        console.error("[AuthPanel] signUp error:", error);
        setErrorMessage(error.message);
      }
    } catch (err: any) {
      console.error("[AuthPanel] signUp thrown:", err);
      setErrorMessage(err?.message ?? "Unexpected error");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignIn = async () => {
    setAuthLoading(true);
    setErrorMessage(null);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        console.error("[AuthPanel] signIn error:", error);
        setErrorMessage(error.message);
      }
    } catch (err: any) {
      console.error("[AuthPanel] signIn thrown:", err);
      setErrorMessage(err?.message ?? "Unexpected error");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    setAuthLoading(true);
    setErrorMessage(null);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error("[AuthPanel] signOut error:", error);
        setErrorMessage(error.message);
        return;
      }

      // Redirect to landing page after sign-out
      router.push("/");
    } catch (err: any) {
      console.error("[AuthPanel] signOut thrown:", err);
      setErrorMessage(err?.message ?? "Unexpected error");
    } finally {
      setAuthLoading(false);
    }
  };

  return (
    <section className="mb-6 bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 flex flex-col gap-2">
      {loading ? (
        <div className="text-xs text-slate-400">Checking session…</div>
      ) : user ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-slate-300">
            Signed in as{" "}
            <span className="font-medium text-slate-50">
              {user.email ?? user.id}
            </span>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={() => router.push("/billing")}
              className="self-start mt-1 text-xs rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-medium px-3 py-1 transition"
            >
              Billing
            </button>

            <button
              type="button"
              onClick={handleSignOut}
              disabled={authLoading}
              className="self-start mt-1 text-xs rounded-lg border border-slate-700 px-3 py-1 hover:border-emerald-400/70 hover:text-emerald-200 transition"
            >
              {authLoading ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-3">
            <div className="flex-1">
              <label className="block text-[11px] text-slate-400 mb-1">
                Email
              </label>
              <input
                type="email"
                className="w-full rounded-lg bg-slate-950 border border-slate-800 px-2 py-1 text-xs text-slate-100 outline-none focus:border-emerald-400"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="agent@example.com"
              />
            </div>

            <div className="flex-1">
              <label className="block text-[11px] text-slate-400 mb-1">
                Password
              </label>
              <input
                type="password"
                className="w-full rounded-lg bg-slate-950 border border-slate-800 px-2 py-1 text-xs text-slate-100 outline-none focus:border-emerald-400"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            <div className="flex gap-2 mt-2 sm:mt-0">
              <button
                type="button"
                onClick={handleSignIn}
                disabled={authLoading}
                className="rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-medium px-3 py-1.5 transition"
              >
                {authLoading ? "Working…" : "Log in"}
              </button>

              <button
                type="button"
                onClick={handleSignUp}
                disabled={authLoading}
                className="rounded-lg border border-slate-700 hover:border-emerald-400/70 text-slate-100 text-xs px-3 py-1.5 transition"
              >
                Sign up
              </button>
            </div>
          </div>

          {errorMessage && (
            <div className="text-[11px] text-rose-300 mt-1">
              {errorMessage}
            </div>
          )}

          <p className="text-[11px] text-slate-500">
            Dev note: email/password only, no email verification in this
            environment.
          </p>
        </>
      )}
    </section>
  );
}
