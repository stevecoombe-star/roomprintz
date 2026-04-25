// src/lib/supabaseBrowser.ts
"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser-side Supabase singleton.
 * This should be the ONLY place creating a Supabase client in the browser.
 */

type AnySupabaseClient = SupabaseClient;

let _browserClient: AnySupabaseClient | null = null;
let _authHydrationPromise: Promise<void> | null = null;

export function supabaseBrowser(): AnySupabaseClient {
  if (_browserClient) return _browserClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }

  _browserClient = createBrowserClient(url, anon);

  return _browserClient;
}

async function waitForInitialSessionHydration(timeoutMs = 800): Promise<void> {
  if (typeof window === "undefined") return;
  if (_authHydrationPromise) return _authHydrationPromise;

  const client = supabaseBrowser();
  _authHydrationPromise = (async () => {
    try {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        const { data } = await client.auth.getSession();
        if (data.session) return;
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 100);
        });
      }
    } finally {
      _authHydrationPromise = null;
    }
  })();

  return _authHydrationPromise;
}

export async function getSupabaseBrowserSession() {
  const client = supabaseBrowser();
  const initial = await client.auth.getSession();
  if (initial.data.session) return initial;

  await waitForInitialSessionHydration();
  return client.auth.getSession();
}

export async function getSupabaseBrowserAccessToken(): Promise<string | null> {
  const { data } = await getSupabaseBrowserSession();
  const token = data.session?.access_token;
  return typeof token === "string" && token.length > 0 ? token : null;
}

/**
 * Compatibility export for any legacy imports expecting a `browserClient`.
 * IMPORTANT: This is the SAME singleton (no second client created).
 */
export const browserClient: AnySupabaseClient = supabaseBrowser();
