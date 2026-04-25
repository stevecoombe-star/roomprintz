// app/billing/success/page.tsx
"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";

function BillingSuccessInner() {
  const params = useSearchParams();
  const router = useRouter();
  const sessionId = params.get("session_id");

  /**
   * Message is derived from URL state — no need for React state.
   */
  const message = sessionId
    ? "Thanks - your payment went through. Your Vibode token balance updates automatically."
    : "Thanks - your payment completed. Your Vibode token balance updates automatically.";

  useEffect(() => {
    // Webhooks apply the token grant; this page is just a friendly landing.
    window.dispatchEvent(new Event("tokens:changed"));

    const t = setTimeout(() => {
      router.push("/billing");
    }, 2500);

    return () => clearTimeout(t);
  }, [router]);

  return (
    <main className="max-w-xl mx-auto space-y-3 p-6">
      <h1 className="text-2xl font-semibold text-slate-900">Tokens added</h1>
      <p className="text-slate-700">{message}</p>
      <p className="text-sm text-slate-600">
        If your balance doesn&apos;t refresh right away, reopen Billing in a moment.
      </p>

      {sessionId && (
        <p className="break-all text-xs text-slate-500">
          Checkout session: {sessionId}
        </p>
      )}

      <div className="flex flex-wrap gap-2 pt-2">
        <button
          className="rounded bg-emerald-500 px-4 py-2 font-medium text-slate-950 transition hover:bg-emerald-400"
          onClick={() => router.push("/billing")}
        >
          Back to Billing
        </button>
        <button
          className="rounded border border-slate-300 px-4 py-2 text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
          onClick={() => router.push("/editor")}
        >
          Back to Editor
        </button>
      </div>
    </main>
  );
}

export default function BillingSuccessPage() {
  return (
    <Suspense fallback={<div className="max-w-xl mx-auto p-6 text-sm text-slate-600">Loading confirmation...</div>}>
      <BillingSuccessInner />
    </Suspense>
  );
}
