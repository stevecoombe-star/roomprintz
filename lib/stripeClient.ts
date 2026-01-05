// lib/stripeClient.ts
"use client";

import { supabase } from "@/lib/supabaseClient";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type ReadJsonResult = {
  json: JsonValue | null;
  text: string;
};

async function readJsonOrText(res: Response): Promise<ReadJsonResult> {
  const text = await res.text();

  // Try JSON first; if server returned HTML (e.g., Next error page), this will fail gracefully.
  try {
    const parsed = JSON.parse(text) as JsonValue;
    return { json: parsed, text };
  } catch {
    return { json: null, text };
  }
}

export async function startCheckout(
  planId: "beta" | "starter" | "pro" | "team" = "beta"
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
    if (json && typeof json === "object" && "error" in json) {
      throw new Error(String(json.error));
    }
    throw new Error(text || "Checkout failed");
  }

  const url =
    json && typeof json === "object" && "url" in json
      ? String(json.url)
      : null;

  if (!url) {
    throw new Error("Checkout failed: missing redirect URL");
  }

  window.location.href = url;
}

/**
 * 🔁 One-time token top-up (Stripe Checkout, mode=payment)
 * priceId is the Stripe Price ID (e.g., "price_123...")
 */
export async function startTopup(priceId: string) {
  if (!priceId) {
    throw new Error("Top-up failed: missing priceId");
  }

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not logged in");

  const res = await fetch("/api/stripe/topup", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ priceId }),
  });

  const { json, text } = await readJsonOrText(res);

  if (!res.ok) {
    if (json && typeof json === "object" && "error" in json) {
      throw new Error(String(json.error));
    }
    throw new Error(text || "Top-up failed");
  }

  const url =
    json && typeof json === "object" && "url" in json
      ? String(json.url)
      : null;

  if (!url) {
    throw new Error("Top-up failed: missing redirect URL");
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
    if (json && typeof json === "object" && "error" in json) {
      throw new Error(String(json.error));
    }
    throw new Error(text || "Portal failed");
  }

  const url =
    json && typeof json === "object" && "url" in json
      ? String(json.url)
      : null;

  if (!url) {
    throw new Error("Portal failed: missing redirect URL");
  }

  window.location.href = url;
}
