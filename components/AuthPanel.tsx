// components/AuthPanel.tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useSupabaseUser } from "@/lib/useSupabaseUser";
import { useRouter } from "next/navigation";
import { DEFAULT_TOPUP_PRICE_ID, startTopup } from "@/lib/stripeClient";
import { VibodeButton } from "@/components/ui/VibodeButton";

type AuthPanelProps = {
  redirectToAppOnAuth?: boolean;
  appearance?: "default" | "retail";
};

type TokenSnapshotResponse = {
  balanceTokens?: unknown;
  error?: unknown;
};

function errorMessageFromUnknown(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err.trim().length > 0) return err;
  return fallback;
}

export function AuthPanel({ redirectToAppOnAuth = false, appearance = "default" }: AuthPanelProps) {
  const { user, loading } = useSupabaseUser();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [betaAccessCode, setBetaAccessCode] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // ✅ Token counter state
  const [tokenBalance, setTokenBalance] = useState<number | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  const router = useRouter();

  // 👇 Auto-redirect to /editor after login/signup when used on landing
  useEffect(() => {
    if (!redirectToAppOnAuth) return;
    if (loading) return;
    if (user) {
      router.push("/editor");
    }
  }, [redirectToAppOnAuth, loading, user, router]);

  const fetchTokenBalance = useCallback(async () => {
    if (!user) return;

    setTokenLoading(true);
    setTokenError(null);
    try {
      const response = await fetch("/api/vibode/tokens/snapshot", {
        method: "GET",
        credentials: "same-origin",
      });
      const payload = (await response.json().catch(() => ({}))) as TokenSnapshotResponse;
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : `Failed to load token balance (HTTP ${response.status}).`
        );
      }

      const balance = typeof payload.balanceTokens === "number" ? payload.balanceTokens : 0;
      setTokenBalance(balance);
    } catch (err: unknown) {
      const message = errorMessageFromUnknown(err, "Could not load token balance.");
      console.error("[AuthPanel] token snapshot error:", err);
      setTokenError(message);
      setTokenBalance(null);
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
      const validateCodeResponse = await fetch("/api/auth/validate-beta-signup-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: betaAccessCode }),
      });

      if (!validateCodeResponse.ok) {
        setErrorMessage("Invalid beta access code.");
        return;
      }

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

  const retail = appearance === "retail";
  const fieldClass = retail
    ? "w-full rounded-lg bg-canvas border border-ink-secondary px-2 py-1 text-xs text-ink placeholder:text-ink-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    : "w-full rounded-lg bg-slate-950 border border-slate-800 px-2 py-1 text-xs text-slate-100 outline-none focus:border-emerald-400";

  return (
    <section
      className={
        retail
          ? "scheme-light mb-6 bg-canvas border border-line rounded-2xl px-4 py-3 flex flex-col gap-2"
          : "mb-6 bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 flex flex-col gap-2"
      }
    >
      {loading ? (
        <div className={retail ? "text-xs text-ink-secondary" : "text-xs text-slate-400"}>Checking session…</div>
      ) : user ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <div className={retail ? "text-xs text-ink-secondary" : "text-xs text-slate-300"}>
              Signed in as{" "}
              <span className={retail ? "font-medium text-ink" : "font-medium text-slate-50"}>
                {user.email ?? user.id}
              </span>
            </div>

            {/* ✅ Token counter */}
            <div className={retail ? "text-[11px] text-ink-secondary flex items-center gap-2" : "text-[11px] text-slate-400 flex items-center gap-2"}>
              <span className={retail ? "text-ink-secondary" : "text-slate-400"}>Tokens:</span>

              {tokenLoading ? (
                <span className={retail ? "text-ink" : "text-slate-300"}>Loading…</span>
              ) : tokenError ? (
                <span className={retail ? "text-danger" : "text-rose-300"} title={tokenError}>
                  Error
                </span>
              ) : (
                <span className={retail ? "text-ink font-medium" : "text-slate-100 font-medium"}>
                  {tokenBalance ?? "—"}
                </span>
              )}

              {retail ? (
                <VibodeButton
                  type="button"
                  variant="outline"
                  size="compact"
                  onClick={fetchTokenBalance}
                  disabled={tokenLoading}
                  title={tokenError ?? "Refresh token balance"}
                >
                  Refresh
                </VibodeButton>
              ) : (
                <button
                  type="button"
                  onClick={fetchTokenBalance}
                  disabled={tokenLoading}
                  className="text-[11px] rounded-md border border-slate-700 px-2 py-0.5 hover:border-emerald-400/70 hover:text-emerald-200 transition disabled:opacity-60"
                  title={tokenError ?? "Refresh token balance"}
                >
                  Refresh
                </button>
              )}

              {retail ? (
                <VibodeButton
                  type="button"
                  variant="primary"
                  size="compact"
                  onClick={() => startTopup(DEFAULT_TOPUP_PRICE_ID)}
                  title="Buy more tokens"
                >
                  Buy tokens
                </VibodeButton>
              ) : (
                <button
                  type="button"
                  onClick={() => startTopup(DEFAULT_TOPUP_PRICE_ID)}
                  className="text-[11px] rounded-md bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-medium px-2 py-0.5 transition"
                  title="Buy more tokens"
                >
                  Buy tokens
                </button>
              )}
            </div>

            {tokenError && (
              <div className={retail ? "text-[11px] text-danger" : "text-[11px] text-rose-300"}>{tokenError}</div>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            {retail ? (
              <VibodeButton
                type="button"
                variant="primary"
                size="compact"
                className="self-start mt-1"
                onClick={() => router.push("/billing")}
              >
                Billing
              </VibodeButton>
            ) : (
              <button
                type="button"
                onClick={() => router.push("/billing")}
                className="self-start mt-1 text-xs rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-medium px-3 py-1 transition"
              >
                Billing
              </button>
            )}

            {retail ? (
              <VibodeButton
                type="button"
                variant="outline"
                size="compact"
                className="self-start mt-1"
                onClick={handleSignOut}
                disabled={authLoading}
              >
                {authLoading ? "Signing out…" : "Sign out"}
              </VibodeButton>
            ) : (
              <button
                type="button"
                onClick={handleSignOut}
                disabled={authLoading}
                className="self-start mt-1 text-xs rounded-lg border border-slate-700 px-3 py-1 hover:border-emerald-400/70 hover:text-emerald-200 transition"
              >
                {authLoading ? "Signing out…" : "Sign out"}
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-3">
              <div className="flex-1">
                <label className={retail ? "block text-[11px] text-ink-secondary mb-1" : "block text-[11px] text-slate-400 mb-1"}>
                  Email
                </label>
                <input
                  type="email"
                  className={fieldClass}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@vibode.com"
                />
              </div>

              <div className="flex-1">
                <label className={retail ? "block text-[11px] text-ink-secondary mb-1" : "block text-[11px] text-slate-400 mb-1"}>
                  Password
                </label>
                <input
                  type="password"
                  className={fieldClass}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>

              <div className="flex mt-2 sm:mt-0 sm:self-end">
                {retail ? (
                  <VibodeButton type="button" variant="primary" size="compact" onClick={handleSignIn} disabled={authLoading}>
                    {authLoading ? "Working…" : "Log in"}
                  </VibodeButton>
                ) : (
                  <button
                    type="button"
                    onClick={handleSignIn}
                    disabled={authLoading}
                    className="rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-medium px-3 py-1.5 transition"
                  >
                    {authLoading ? "Working…" : "Log in"}
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-3">
              <div className="flex-1">
                <label className={retail ? "block text-[11px] text-ink-secondary mb-1" : "block text-[11px] text-slate-400 mb-1"}>
                  Beta access code
                </label>
                <input
                  type="text"
                  className={fieldClass}
                  value={betaAccessCode}
                  onChange={(e) => setBetaAccessCode(e.target.value)}
                  placeholder="Enter your beta code"
                />
              </div>

              <div className="flex mt-2 sm:mt-0 sm:self-end">
                {retail ? (
                  <VibodeButton type="button" variant="outline" size="compact" onClick={handleSignUp} disabled={authLoading}>
                    Sign up
                  </VibodeButton>
                ) : (
                  <button
                    type="button"
                    onClick={handleSignUp}
                    disabled={authLoading}
                    className="rounded-lg border border-slate-700 hover:border-emerald-400/70 text-slate-100 text-xs px-3 py-1.5 transition"
                  >
                    Sign up
                  </button>
                )}
              </div>
            </div>
          </div>

          {errorMessage && (
            <div className={retail ? "text-[11px] text-danger mt-1" : "text-[11px] text-rose-300 mt-1"}>{errorMessage}</div>
          )}

          <p className={retail ? "text-[11px] text-ink-secondary" : "text-[11px] text-slate-500"}>
            Sign up with email, password, and your beta access code. If your environment requires
            email confirmation, check your inbox before first login.
          </p>
        </>
      )}
    </section>
  );
}
