// lib/supabaseClient.ts
"use client";

/**
 * DEPRECATED — use `src/lib/supabaseBrowser` instead.
 *
 * This file is kept as a compatibility shim so older imports
 * (`import { supabase } from "@/lib/supabaseClient"`) keep working.
 *
 * IMPORTANT: Do NOT create a new Supabase client here — that can lead to
 * multiple GoTrueClient instances and undefined auth behavior.
 */

export { browserClient as supabase } from "@/src/lib/supabaseBrowser";

// Optional: gentle console warning in dev to help you migrate imports
if (process.env.NODE_ENV !== "production") {
  console.warn(
    "[DEPRECATED] Import `supabase` from `@/src/lib/supabaseBrowser` instead of `@/lib/supabaseClient`."
  );
}
