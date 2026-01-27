// src/lib/supabaseBrowser.ts
"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser-side Supabase singleton.
 * This should be the ONLY place creating a Supabase client in the browser.
 */

let _browserClient: SupabaseClient | null = null;

export function supabaseBrowser(): SupabaseClient {
  if (_browserClient) return _browserClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }

  _browserClient = createClient(url, anon, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  return _browserClient;
}

/**
 * Compatibility export for any legacy imports expecting a `browserClient`.
 * IMPORTANT: This is the SAME singleton (no second client created).
 */
export const browserClient: SupabaseClient = supabaseBrowser();
