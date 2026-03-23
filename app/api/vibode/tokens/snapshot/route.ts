import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getUserTokenWalletIfExists } from "@/lib/vibodeTokenDomain";

export const runtime = "nodejs";

type AnySupabaseClient = SupabaseClient<any, "public", any>;

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

function getUserSupabaseClient(
  req: NextRequest
): { supabase: AnySupabaseClient | null; token: string | null } {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return { supabase: null, token: null };

  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : null;
  if (!token) return { supabase: null, token: null };

  const supabase: AnySupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { supabase, token };
}

export async function GET(req: NextRequest) {
  try {
    const { supabase, token } = getUserSupabaseClient(req);
    if (!token || !supabase) {
      return Response.json(
        {
          error:
            "Unauthorized: missing Authorization Bearer token. (Send Supabase access_token in the request.)",
        },
        { status: 401 }
      );
    }

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const wallet = await getUserTokenWalletIfExists(supabase, userData.user.id);
    if (!wallet) {
      return Response.json({
        balanceTokens: 0,
        lifetimeGrantedTokens: 0,
        lifetimeSpentTokens: 0,
        monthlyGrantedTokens: 0,
        monthlySpentTokens: 0,
        currentPeriodStart: null,
        currentPeriodEnd: null,
      });
    }

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
