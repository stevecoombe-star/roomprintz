import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type AnySupabaseClient = SupabaseClient;
type UnknownRecord = Record<string, unknown>;

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

function asOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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
    const userId = userData.user.id;

    const { data, error } = await supabase
      .from("vibode_user_furniture")
      .select("*")
      .eq("user_id", userId)
      .eq("is_archived", false)
      .order("last_used_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (error) {
      return Response.json(
        { error: `Failed to load My Furniture items: ${error.message}` },
        { status: 500 }
      );
    }

    const items = Array.isArray(data)
      ? data
          .map((row) => {
            if (!row || typeof row !== "object") return null;
            const item = row as UnknownRecord;
            const id = asOptionalString(item.id);
            const userSkuId = asOptionalString(item.user_sku_id ?? item.userSkuId);
            const createdAt = asOptionalString(item.created_at ?? item.createdAt);
            if (!id || !userSkuId || !createdAt) return null;
            return {
              id,
              user_sku_id: userSkuId,
              display_name: asOptionalString(item.display_name ?? item.displayName),
              category: asOptionalString(item.category),
              source_label: asOptionalString(item.source_label ?? item.sourceLabel),
              source_url: asOptionalString(item.source_url ?? item.sourceUrl),
              preview_image_url: asOptionalString(item.preview_image_url ?? item.previewImageUrl),
              normalized_preview_url: asOptionalString(
                item.normalized_preview_url ?? item.normalizedPreviewUrl
              ),
              times_used: Math.max(0, asNumber(item.times_used ?? item.timesUsed)),
              last_used_at: asOptionalString(item.last_used_at ?? item.lastUsedAt),
              created_at: createdAt,
              status: asOptionalString(item.status) ?? "ready",
            };
          })
          .filter((item): item is NonNullable<typeof item> => Boolean(item))
      : [];

    return Response.json({ items });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return Response.json({ error: message }, { status: 500 });
  }
}
