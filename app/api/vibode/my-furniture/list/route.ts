import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

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
    const userId = userData.user.id;

    const { data, error } = await supabase
      .from("vibode_user_furniture")
      .select(
        "id,user_sku_id,display_name,item_type,source_type,source_label,preview_image_url,normalized_preview_url,status,last_used_at,created_at,updated_at"
      )
      .eq("user_id", userId)
      .eq("status", "ready")
      .eq("is_archived", false)
      .order("last_used_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (error) {
      return Response.json(
        { error: `Failed to load My Furniture items: ${error.message}` },
        { status: 500 }
      );
    }

    const items = (data ?? []).map((row) => ({
      id: row.id,
      userSkuId: row.user_sku_id,
      displayName: row.display_name,
      itemType: row.item_type,
      sourceType: row.source_type,
      sourceLabel: row.source_label,
      previewImageUrl: row.preview_image_url,
      normalizedPreviewUrl: row.normalized_preview_url,
      status: row.status,
      lastUsedAt: row.last_used_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    return Response.json({ items });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return Response.json({ error: message }, { status: 500 });
  }
}
