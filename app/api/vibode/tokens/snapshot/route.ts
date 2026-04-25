import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getUserTokenWallet } from "@/lib/vibodeTokenDomain";

export const runtime = "nodejs";

type AnySupabaseClient = SupabaseClient;

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

function getBearerSupabaseClient(req: NextRequest): AnySupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;

  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : null;
  if (!token) return null;

  const supabase: AnySupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return supabase;
}

async function getCookieSupabaseClient(): Promise<AnySupabaseClient | null> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {
        // No-op in this GET route; cookie writes are not required for token snapshot reads.
      },
    },
  });
}

export async function GET(req: NextRequest) {
  try {
    let supabase: AnySupabaseClient | null = null;
    let userId: string | null = null;

    const cookieSupabase = await getCookieSupabaseClient();
    if (cookieSupabase) {
      const { data, error } = await cookieSupabase.auth.getUser();
      if (!error && data?.user) {
        supabase = cookieSupabase;
        userId = data.user.id;
      }
    }

    if (!supabase || !userId) {
      supabase = getBearerSupabaseClient(req);
      if (supabase) {
        const { data, error } = await supabase.auth.getUser();
        if (!error && data?.user) {
          userId = data.user.id;
        }
      }
    }

    if (!supabase || !userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Deterministic first-touch initialization:
    // first authenticated snapshot call bootstraps wallet if missing.
    const wallet = await getUserTokenWallet(supabase, userId);

    return Response.json({
      balanceTokens: wallet.balance_tokens,
      lifetimeGrantedTokens: wallet.lifetime_granted_tokens,
      lifetimeSpentTokens: wallet.lifetime_spent_tokens,
      monthlyGrantedTokens: wallet.monthly_granted_tokens,
      monthlySpentTokens: wallet.monthly_spent_tokens,
      currentPeriodStart: wallet.current_period_start,
      currentPeriodEnd: wallet.current_period_end,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return Response.json({ error: message }, { status: 500 });
  }
}
