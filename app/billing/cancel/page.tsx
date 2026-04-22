// app/billing/cancel/page.tsx
"use client";

import { useRouter } from "next/navigation";

export default function BillingCancelPage() {
  const router = useRouter();

  return (
    <main className="max-w-xl mx-auto space-y-3 p-6">
      <h1 className="text-2xl font-semibold text-slate-900">Checkout canceled</h1>
      <p className="text-slate-700">No problem - your payment was canceled and you were not charged.</p>
      <p className="text-sm text-slate-600">
        You can return to billing anytime when you are ready to top up.
      </p>

      <div className="flex gap-2 pt-2">
        <button
          className="rounded bg-emerald-500 px-4 py-2 font-medium text-slate-950 transition hover:bg-emerald-400"
          onClick={() => router.push("/billing")}
        >
          Back to billing
        </button>

        <button
          className="rounded border border-slate-300 px-4 py-2 text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
          onClick={() => router.push("/editor")}
        >
          Back to editor
        </button>
      </div>
    </main>
  );
}
