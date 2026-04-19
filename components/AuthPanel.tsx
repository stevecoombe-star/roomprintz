// components/AuthPanel.tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useSupabaseUser } from "@/lib/useSupabaseUser";
import { useRouter } from "next/navigation";
import { startTopup } from "@/lib/stripeClient";

type AuthPanelProps = {
  redirectToAppOnAuth?: boolean;
};

function errorMessageFromUnknown(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err.trim().length > 0) return err;
  return fallback;
}

export function AuthPanel({ redirectToAppOnAuth = false }: AuthPanelProps) {
  const { user, loading } = useSupabaseUser();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // ✅ Token counter state
  const [tokenBalance, setTokenBalance] = useState<number | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  const router = useRouter();

  // 👇 Auto-redirect to /app after login/signup when used on landing
  useEffect(() => {
    if (!redirectToAppOnAuth) return;
    if (loading) return;
    if (user) {
      router.push("/app");
    }
  }, [redirectToAppOnAuth, loading, user, router]);

  const fetchTokenBalance = useCallback(async () => {
    if (!user) return;

    setTokenLoading(true);
    setTokenError(null);

    const { data, error } = await supabase
      .from("user_token_wallets")
      .select("balance_tokens")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      console.error("[AuthPanel] user_token_wallets read error:", error);
      setTokenError(error.message);
      setTokenBalance(null);
    } else {
      const balance = typeof data?.balance_tokens === "number" ? data.balance_tokens : 0;
      setTokenBalance(balance);
    }

    setTokenLoading(false);
  }, [user]);

  // Fetch tokens when user becomes available
  useEffect(() => {
    if (!user) {
      setTokenBalance(null);
      setTokenError(null);
      setTokenLoading(false);
      return;
    }
    fetchTokenBalance();
  }, [user, fetchTokenBalance]);

  // ✅ Listen for global token refresh events (e.g. after generation spends tokens)
  useEffect(() => {
    if (!user) return;

    const handler = () => {
      fetchTokenBalance();
    };

    window.addEventListener("tokens:changed", handler);
    return () => window.removeEventListener("tokens:changed", handler);
  }, [user, fetchTokenBalance]);

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
    } catch (err: unknown) {
      console.error("[AuthPanel] signUp thrown:", err);
      setErrorMessage(errorMessageFromUnknown(err, "Unexpected error"));
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
    } catch (err: unknown) {
      console.error("[AuthPanel] signIn thrown:", err);
      setErrorMessage(errorMessageFromUnknown(err, "Unexpected error"));
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
    } catch (err: unknown) {
      console.error("[AuthPanel] signOut thrown:", err);
      setErrorMessage(errorMessageFromUnknown(err, "Unexpected error"));
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
          <div className="flex flex-col gap-1">
            <div className="text-xs text-slate-300">
              Signed in as{" "}
              <span className="font-medium text-slate-50">
                {user.email ?? user.id}
              </span>
            </div>

            {/* ✅ Token counter */}
            <div className="text-[11px] text-slate-400 flex items-center gap-2">
              <span className="text-slate-400">Tokens:</span>

              {tokenLoading ? (
                <span className="text-slate-300">Loading…</span>
              ) : tokenError ? (
                <span className="text-rose-300" title={tokenError}>
                  Error
                </span>
              ) : (
                <span className="text-slate-100 font-medium">
                  {tokenBalance ?? "—"}
                </span>
              )}

              <button
                type="button"
                onClick={fetchTokenBalance}
                disabled={tokenLoading}
                className="text-[11px] rounded-md border border-slate-700 px-2 py-0.5 hover:border-emerald-400/70 hover:text-emerald-200 transition disabled:opacity-60"
                title={tokenError ?? "Refresh token balance"}
              >
                Refresh
              </button>

              <button
                type="button"
                onClick={() => startTopup("price_1ShhxG1nnn0IHwIjzOnYYCTo")}
                className="text-[11px] rounded-md bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-medium px-2 py-0.5 transition"
                title="Buy more tokens"
              >
                Buy tokens
              </button>
            </div>

            {tokenError && (
              <div className="text-[11px] text-rose-300">{tokenError}</div>
            )}
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
            <div className="text-[11px] text-rose-300 mt-1">{errorMessage}</div>
          )}

          <p className="text-[11px] text-slate-500">
            Dev note: email/password only, no email verification in this environment.
          </p>
        </>
      )}
    </section>
  );
}
