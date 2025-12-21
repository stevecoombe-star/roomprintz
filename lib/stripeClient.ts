"use client";

import { supabase } from "@/lib/supabaseClient";

async function readJsonOrText(res: Response): Promise<{ json: any | null; text: string }> {
  const text = await res.text();

  // Try JSON first; if server returned HTML (e.g., Next error page), this will fail gracefully.
  try {
    return { json: JSON.parse(text), text };
  } catch {
    return { json: null, text };
  }
}

export async function startCheckout(
  planId: "beta" | "starter" | "pro" | "team" = "beta",
) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not logged in");

  const res = await fetch("/api/stripe/checkout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ planId }),
  });

  const { json, text } = await readJsonOrText(res);

  if (!res.ok) {
    // Prefer server-provided JSON error, otherwise surface raw response (often HTML)
    throw new Error(json?.error ?? text ?? "Checkout failed");
  }

  const url = json?.url;
  if (!url || typeof url !== "string") {
    throw new Error("Checkout failed: missing redirect URL");
  }

  window.location.href = url;
}

export async function openBillingPortal() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not logged in");

  const res = await fetch("/api/stripe/portal", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const { json, text } = await readJsonOrText(res);

  if (!res.ok) {
    throw new Error(json?.error ?? text ?? "Portal failed");
  }

  const url = json?.url;
  if (!url || typeof url !== "string") {
    throw new Error("Portal failed: missing redirect URL");
  }

  window.location.href = url;
}
