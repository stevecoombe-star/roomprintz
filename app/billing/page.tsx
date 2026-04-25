"use client";

import { useState } from "react";
import Link from "next/link";
import { useSupabaseUser } from "@/lib/useSupabaseUser";
import { useTokenBalance } from "@/hooks/useTokenBalance";
import { DEFAULT_TOPUP_PRICE_ID, startTopup } from "@/lib/stripeClient";

function errorMessageFromUnknown(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) {
    if (err.message.toLowerCase().includes("http")) return fallback;
    return err.message;
  }
  if (typeof err === "string" && err.trim().length > 0) {
    if (err.toLowerCase().includes("http")) return fallback;
    return err;
  }
  return fallback;
}

export default function BillingPage() {
  const { user, loading } = useSupabaseUser();
  const { balance, isLoading: tokenLoading, error: tokenError, refresh } = useTokenBalance();
  const [uiLoading, setUiLoading] = useState<null | "topup">(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Top up Vibode tokens</h1>
          <p className="text-sm text-slate-600">
            Tokens power generation and edit actions in the Vibode editor.
          </p>
        </div>

        <div className="flex gap-2">
          <Link
            href="/editor"
            className="rounded-lg border border-slate-300 px-3 py-1 text-xs text-slate-700 transition hover:border-emerald-500/70 hover:text-emerald-700"
          >
            Back to Editor
          </Link>
        </div>
      </div>

      {loading ? (
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
          <div className="text-sm text-slate-400">Checking your account...</div>
        </section>
      ) : !user ? (
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
          <div className="text-sm text-slate-300">You&apos;re not signed in.</div>
          <p className="text-xs text-slate-500 mt-1">
            Sign in first, then return here to top up tokens.
          </p>
        </section>
      ) : (
        <>
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 mb-5">
            <p className="text-sm text-slate-300">
              Buy a one-time token pack whenever you need more. No subscription required.
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-slate-400">
                Current balance
              </span>
              <span className="text-slate-100 font-medium">
                {tokenLoading ? "Loading…" : (balance ?? 0).toLocaleString()} tokens
              </span>
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={tokenLoading}
                className="rounded-md border border-slate-700 px-2 py-1 text-slate-300 transition hover:border-emerald-400/70 hover:text-emerald-200 disabled:opacity-60"
              >
                Refresh
              </button>
            </div>

            {tokenError && (
              <div className="mt-3 rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-2 text-[11px] text-rose-200">
                We couldn&apos;t refresh your token balance right now. Please try again.
              </div>
            )}
          </section>

          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
            <h2 className="text-base font-semibold text-slate-100">Token top-up</h2>
            <p className="text-xs text-slate-500 mt-1">
              Secure checkout with Stripe. Tokens are added to your account right after payment.
            </p>

            <div className="mt-4">
              <button
                type="button"
                onClick={async () => {
                  setUiLoading("topup");
                  setErrorMessage(null);
                  try {
                    await startTopup(DEFAULT_TOPUP_PRICE_ID);
                  } catch (err: unknown) {
                    console.error("[BillingPage] top-up checkout error:", err);
                    setErrorMessage(
                      errorMessageFromUnknown(
                        err,
                        "We couldn't open Stripe checkout right now. Please try again."
                      )
                    );
                  } finally {
                    setUiLoading(null);
                  }
                }}
                disabled={uiLoading !== null}
                className="text-sm rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold px-4 py-2 transition disabled:opacity-60"
              >
                {uiLoading === "topup" ? "Opening Stripe checkout..." : "Buy Tokens"}
              </button>
            </div>

            {errorMessage && <div className="text-[11px] text-rose-300 mt-3">{errorMessage}</div>}

            <p className="text-[11px] text-slate-500 mt-3">
              You can return here anytime to purchase additional tokens.
            </p>
          </section>
        </>
      )}
    </main>
  );
}
