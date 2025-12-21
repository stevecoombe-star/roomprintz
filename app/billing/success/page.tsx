// app/billing/success/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

export default function BillingSuccessPage() {
  const params = useSearchParams();
  const router = useRouter();
  const sessionId = params.get("session_id");
  const [message, setMessage] = useState<string>("Finalizing your subscription…");

  useEffect(() => {
    // In beta: we trust webhooks for token grants.
    // This page is just a friendly landing + optional redirect.
    if (!sessionId) {
      setMessage("Subscription completed. (No session_id found in URL.)");
      return;
    }

    setMessage("Subscription completed ✅ You can close this tab or return to the app.");

    // Optional: auto-return after a short pause
    const t = setTimeout(() => {
      router.push("/billing");
    }, 1500);

    return () => clearTimeout(t);
  }, [sessionId, router]);

  return (
    <div className="max-w-xl mx-auto p-6 space-y-3">
      <h1 className="text-2xl font-semibold">Success</h1>
      <p>{message}</p>

      {sessionId && (
        <p className="text-sm opacity-70 break-all">
          Checkout session: {sessionId}
        </p>
      )}

      <div className="pt-2">
        <button
          className="px-4 py-2 rounded bg-black text-white"
          onClick={() => router.push("/billing")}
        >
          Return to Billing
        </button>
      </div>
    </div>
  );
}
