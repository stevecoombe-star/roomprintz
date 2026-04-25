import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { isAdminEmail } from "@/lib/adminAccess";

type AnySupabaseClient = SupabaseClient;

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export function hasSupabaseAuthEnv(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

export function hasSupabaseServiceEnv(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

export async function getCookieSupabaseClient(): Promise<AnySupabaseClient | null> {
  if (!hasSupabaseAuthEnv()) return null;
  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {
        // Route handlers using this helper are read-auth only.
      },
    },
  });
}

export function getServiceRoleSupabaseClient(): AnySupabaseClient | null {
  if (!hasSupabaseServiceEnv()) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

export async function getAuthenticatedAdminUser(): Promise<User | null> {
  const supabase = await getCookieSupabaseClient();
  if (!supabase) return null;

  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) return null;
  if (!isAdminEmail(data.user.email)) return null;
  return data.user;
}
