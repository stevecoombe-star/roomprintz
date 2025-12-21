// app/billing/cancel/page.tsx
"use client";

import { useRouter } from "next/navigation";

export default function BillingCancelPage() {
  const router = useRouter();

  return (
    <div className="max-w-xl mx-auto p-6 space-y-3">
      <h1 className="text-2xl font-semibold">Checkout canceled</h1>
      <p>No worries — you weren’t charged.</p>

      <div className="pt-2 flex gap-2">
        <button
          className="px-4 py-2 rounded bg-black text-white"
          onClick={() => router.push("/billing")}
        >
          Back to Billing
        </button>

        <button
          className="px-4 py-2 rounded border"
          onClick={() => router.push("/")}
        >
          Back to App
        </button>
      </div>
    </div>
  );
}
