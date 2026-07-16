import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { callCompositorVibodeFullVibe } from "@/lib/callCompositorVibodeFullVibe";
import {
  canAffordTokens,
  chargeVibodeTokensForOperation,
  getTokenCostForOperation,
  recordTokenChargeFailure,
  getUserTokenWallet,
} from "@/lib/vibodeTokenDomain";
import {
  resolveVibodeOperationIdFromHeaders,
  resolveVibodeRequestIdFromHeaders,
} from "@/lib/vibodeCompositorContextHeaders";

export const runtime = "nodejs";
const VIBODE_DEFAULT_MODEL_VERSION = "NBP";
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";
const FULL_VIBE_OPERATION_KEY = "FULL_VIBE";
const FULL_VIBE_DEFAULT_TOKEN_COST = 5;
type AnySupabaseClient = SupabaseClient;

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

function getAdminSupabaseClient(): AnySupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function buildOperationIdempotencyKey(args: {
  userId: string;
  operationKey: string;
  routeKey: string;
  chargeAnchor: string;
}) {
  return [args.userId, args.operationKey, args.routeKey, args.chargeAnchor].join(":");
}

export async function POST(req: NextRequest) {
  try {
    const { supabase, token } = getUserSupabaseClient(req);
    if (!token || !supabase) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const adminSupabase = getAdminSupabaseClient();
    if (!adminSupabase) {
      return Response.json(
        { error: "Server misconfigured: missing service role Supabase for token charging." },
        { status: 500 }
      );
    }
    const userId = userData.user.id;
    const requestId = resolveVibodeRequestIdFromHeaders(req.headers);
    const operationId = resolveVibodeOperationIdFromHeaders(req.headers);

    const bodyRaw = (await req.json()) as unknown;
    const body =
      bodyRaw && typeof bodyRaw === "object" ? (bodyRaw as Record<string, unknown>) : {};
    const modelVersion =
      typeof body.modelVersion === "string" && body.modelVersion.trim().length > 0
        ? body.modelVersion
        : VIBODE_DEFAULT_MODEL_VERSION;
    const tokenCost = await getTokenCostForOperation(
      supabase,
      FULL_VIBE_OPERATION_KEY,
      FULL_VIBE_DEFAULT_TOKEN_COST
    );
    const wallet = await getUserTokenWallet(adminSupabase, userId);
    const affordability = canAffordTokens({
      balanceTokens: wallet.balance_tokens,
      requiredTokens: tokenCost,
    });
    if (!affordability.allowed) {
      return Response.json(
        {
          errorCode: "INSUFFICIENT_TOKENS",
          message: "Insufficient token balance for full vibe.",
          requiredTokens: affordability.requiredTokens,
          balanceTokens: affordability.balanceTokens,
          shortfallTokens: affordability.shortfallTokens,
          operationKey: FULL_VIBE_OPERATION_KEY,
        },
        { status: 402 }
      );
    }
    const { imageUrl } = await callCompositorVibodeFullVibe({
      payload: {
        ...body,
        modelVersion,
      },
    });
    if (typeof imageUrl !== "string" || imageUrl.trim().length === 0) {
      return Response.json({ error: "Invalid full vibe output image." }, { status: 502 });
    }
    let tokensCharged = 0;
    let remainingTokens: number | null = wallet.balance_tokens;
    try {
      const chargeAnchor = operationId ?? requestId ?? imageUrl;
      const chargeResult = await chargeVibodeTokensForOperation({
        supabase: adminSupabase,
        userId,
        operationKey: FULL_VIBE_OPERATION_KEY,
        idempotencyKey: buildOperationIdempotencyKey({
          userId,
          operationKey: FULL_VIBE_OPERATION_KEY,
          routeKey: "/api/vibode/full-vibe",
          chargeAnchor,
        }),
        operationId,
        requestId,
        modelVersion,
        chargePhase: "success",
        metadata: { source: "api_vibode_full_vibe" },
      });
      tokensCharged = chargeResult.skipped ? 0 : chargeResult.chargedTokens;
      remainingTokens = chargeResult.balanceTokens ?? remainingTokens;
    } catch (chargeErr) {
      console.error("[vibode/full-vibe] token charge failed after successful generation:", chargeErr);
      await recordTokenChargeFailure({
        supabase: adminSupabase,
        userId,
        operationKey: FULL_VIBE_OPERATION_KEY,
        operationId,
        requestId,
        idempotencyKey: buildOperationIdempotencyKey({
          userId,
          operationKey: FULL_VIBE_OPERATION_KEY,
          routeKey: "/api/vibode/full-vibe",
          chargeAnchor: operationId ?? requestId ?? imageUrl,
        }),
        route: "/api/vibode/full-vibe",
        chargePhase: "success",
        expectedTokens: tokenCost,
        modelVersion,
        errorMessage: chargeErr instanceof Error ? chargeErr.message : String(chargeErr),
        metadata: {
          source: "api_vibode_full_vibe",
          imageUrl,
        },
      });
    }
    return Response.json({ imageUrl, tokensCharged, remainingTokens, operationKey: FULL_VIBE_OPERATION_KEY });
  } catch (err: unknown) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
