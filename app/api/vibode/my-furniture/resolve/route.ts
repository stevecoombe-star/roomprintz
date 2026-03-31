import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveMyFurnitureEligibleSku } from "@/lib/vibodeMyFurniture";

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

function parseFurnitureId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const maybeId = (body as { id?: unknown }).id;
  if (typeof maybeId !== "string") return null;
  const id = maybeId.trim();
  return id.length > 0 ? id : null;
}

export async function POST(req: NextRequest) {
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
    const userId = userData.user.id;

    const body = await req.json().catch(() => null);
    const furnitureId = parseFurnitureId(body);
    if (!furnitureId) {
      return Response.json({ error: "id is required." }, { status: 400 });
    }

    const resolved = await resolveMyFurnitureEligibleSku({
      supabase,
      userId,
      furnitureId,
    });

    return Response.json({
      id: resolved.furniture.id,
      userSkuId: resolved.furniture.user_sku_id,
      eligibleSku: resolved.eligibleSku,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    const isNotFound = /not found/i.test(message);
    const isForbidden =
      /archived|not ready|does not belong|missing reusable|missing linked prepared|invalid/i.test(
        message
      );
    return Response.json(
      { error: message },
      {
        status: isNotFound ? 404 : isForbidden ? 400 : 500,
      }
    );
  }
}
