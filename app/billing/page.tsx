// app/billing/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { useSupabaseUser } from "@/lib/useSupabaseUser";
import { startCheckout, openBillingPortal } from "@/lib/stripeClient";

type PlanId = "beta" | "starter" | "pro" | "team";

type SubscriptionRow = {
  status: string | null;
  plan_id: string | null;
  current_period_end: string | null;
};

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export default function BillingPage() {
  const { user, loading } = useSupabaseUser();

  const [sub, setSub] = useState<SubscriptionRow | null>(null);
  const [subLoading, setSubLoading] = useState(false);
  const [uiLoading, setUiLoading] = useState<null | "checkout" | "portal">(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isAuthed = !!user;

  const planCards = useMemo(
    () =>
      [
        {
          id: "beta" as const,
          name: "Beta",
          price: "$19 / month",
          bullets: [
            "Early adopter pricing",
            "Monthly tokens granted on renewal",
            "Use promo codes (e.g. BETA50)",
          ],
        },
        {
          id: "starter" as const,
          name: "Starter",
          price: "$39 / month",
          bullets: ["More monthly tokens", "Best for occasional listings", "Upgrade anytime"],
        },
        {
          id: "pro" as const,
          name: "Pro",
          price: "$79 / month",
          bullets: ["Higher monthly tokens", "Best for active agents", "Priority features later"],
        },
        {
          id: "team" as const,
          name: "Team",
          price: "$149+ / month",
          bullets: ["Team-scale tokens", "Brokerage workflows", "Custom support later"],
        },
      ] satisfies Array<{
        id: PlanId;
        name: string;
        price: string;
        bullets: string[];
      }>,
    [],
  );

  useEffect(() => {
    if (!isAuthed) {
      setSub(null);
      return;
    }

    let cancelled = false;

    (async () => {
      setSubLoading(true);
      setErrorMessage(null);
      try {
        const { data, error } = await supabase
          .from("subscriptions")
          .select("status, plan_id, current_period_end")
          .eq("user_id", user!.id)
          .maybeSingle();

        if (error) throw error;
        if (!cancelled) setSub((data as SubscriptionRow) ?? null);
      } catch (e: any) {
        console.error("[BillingPage] subscription fetch error:", e);
        if (!cancelled) setErrorMessage(e?.message ?? "Failed to load subscription");
      } finally {
        if (!cancelled) setSubLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthed, user]);

  const activeStatus = sub?.status ?? "inactive";
  const activePlan = (sub?.plan_id ?? null) as PlanId | null;

  const isActive = activeStatus === "active" || activeStatus === "trialing";

  return (
    <main className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-50">Billing</h1>
          <p className="text-sm text-slate-400">
            Manage your RoomPrintz subscription, promo codes, and billing details.
          </p>
        </div>

        <div className="flex gap-2">
          <Link
            href="/app"
            className="text-xs rounded-lg border border-slate-700 px-3 py-1 hover:border-emerald-400/70 hover:text-emerald-200 transition"
          >
            Back to app
          </Link>
        </div>
      </div>

      {/* Auth gate */}
      {loading ? (
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
          <div className="text-sm text-slate-400">Checking session…</div>
        </section>
      ) : !user ? (
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
          <div className="text-sm text-slate-300">You’re not signed in.</div>
          <p className="text-xs text-slate-500 mt-1">
            Please sign in first (top of the page / landing) to manage billing.
          </p>
        </section>
      ) : (
        <>
          {/* Current status */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4 mb-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-xs text-slate-400">Signed in</div>
                <div className="text-sm text-slate-100 font-medium">
                  {user.email ?? user.id}
                </div>
              </div>

              <div className="flex flex-col sm:items-end">
                <div className="text-xs text-slate-400">Subscription status</div>
                <div className="text-sm text-slate-100 font-medium">
                  {subLoading ? "Loading…" : activeStatus}
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                <div className="text-[11px] text-slate-400">Plan</div>
                <div className="text-sm text-slate-100 font-medium">
                  {subLoading ? "—" : activePlan ?? "none"}
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                <div className="text-[11px] text-slate-400">Renewal</div>
                <div className="text-sm text-slate-100 font-medium">
                  {subLoading
                    ? "—"
                    : sub?.current_period_end
                      ? formatDate(sub.current_period_end)
                      : "—"}
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                <div className="text-[11px] text-slate-400">Actions</div>
                <div className="flex gap-2 mt-1">
                  <button
                    type="button"
                    onClick={async () => {
                      setUiLoading("portal");
                      setErrorMessage(null);
                      try {
                        await openBillingPortal();
                      } catch (e: any) {
                        console.error("[BillingPage] portal error:", e);
                        setErrorMessage(e?.message ?? "Portal failed");
                      } finally {
                        setUiLoading(null);
                      }
                    }}
                    disabled={uiLoading !== null}
                    className="text-xs rounded-lg border border-slate-700 px-3 py-1 hover:border-emerald-400/70 hover:text-emerald-200 transition"
                  >
                    {uiLoading === "portal" ? "Opening…" : "Manage billing"}
                  </button>

                  {!isActive && (
                    <button
                      type="button"
                      onClick={async () => {
                        setUiLoading("checkout");
                        setErrorMessage(null);
                        try {
                          await startCheckout("beta");
                        } catch (e: any) {
                          console.error("[BillingPage] checkout error:", e);
                          setErrorMessage(e?.message ?? "Checkout failed");
                        } finally {
                          setUiLoading(null);
                        }
                      }}
                      disabled={uiLoading !== null}
                      className="text-xs rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-medium px-3 py-1 transition"
                      title="Opens Stripe Checkout (Test mode) — enter promo code like BETA50 there"
                    >
                      {uiLoading === "checkout" ? "Opening…" : "Subscribe (Beta)"}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {errorMessage && (
              <div className="text-[11px] text-rose-300 mt-3">{errorMessage}</div>
            )}

            <p className="text-[11px] text-slate-500 mt-3">
              Tip: In Stripe Checkout you can enter your promo code (e.g.{" "}
              <span className="text-slate-300">BETA50</span>) if it’s enabled.
            </p>
          </section>

          {/* Plan options */}
          <section className="mb-2">
            <h2 className="text-base font-semibold text-slate-100 mb-2">Choose a plan</h2>
            <p className="text-xs text-slate-500 mb-4">
              For beta, you can start with Beta and upgrade later. (We’ll wire plan selection to
              real Stripe prices as we add tiers.)
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {planCards.map((p) => {
                const isCurrent = isActive && activePlan === p.id;

                return (
                  <div
                    key={p.id}
                    className={`rounded-2xl border bg-slate-900 p-4 flex flex-col gap-3 ${
                      isCurrent ? "border-emerald-500/60" : "border-slate-800"
                    }`}
                  >
                    <div>
                      <div className="text-sm font-semibold text-slate-50">{p.name}</div>
                      <div className="text-xs text-slate-400">{p.price}</div>
                    </div>

                    <ul className="text-[11px] text-slate-400 list-disc pl-4 space-y-1">
                      {p.bullets.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>

                    <div className="mt-auto">
                      {isCurrent ? (
                        <div className="text-[11px] text-emerald-300">Current plan</div>
                      ) : (
                        <button
                          type="button"
                          disabled={uiLoading !== null}
                          onClick={async () => {
                            setUiLoading("checkout");
                            setErrorMessage(null);
                            try {
                              // Note: server currently routes all plans to beta price until you map planId->priceId.
                              await startCheckout(p.id);
                            } catch (e: any) {
                              console.error("[BillingPage] checkout error:", e);
                              setErrorMessage(e?.message ?? "Checkout failed");
                            } finally {
                              setUiLoading(null);
                            }
                          }}
                          className="w-full text-xs rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-medium px-3 py-2 transition"
                        >
                          {uiLoading === "checkout" ? "Opening…" : "Select"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="mt-6 bg-slate-950 border border-slate-800 rounded-2xl p-4">
            <div className="text-xs text-slate-300 font-medium">Dev notes</div>
            <ul className="text-[11px] text-slate-500 list-disc pl-4 mt-2 space-y-1">
              <li>
                Subscription status is synced via Stripe webhooks into the{" "}
                <code className="text-slate-300">subscriptions</code> table.
              </li>
              <li>
                Monthly tokens are granted on{" "}
                <code className="text-slate-300">invoice.paid</code> into{" "}
                <code className="text-slate-300">token_ledger</code>.
              </li>
              <li>
                Plan selection will be fully enabled once we add tier price IDs to the server
                mapping.
              </li>
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
