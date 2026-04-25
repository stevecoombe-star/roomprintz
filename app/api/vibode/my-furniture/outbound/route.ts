import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveSourceUrl } from "@/lib/myFurniture";
import { resolveFurnitureOutboundUrl } from "@/lib/commercial/affiliate";
import { getVibodeUserFurnitureById, trackVibodeFurnitureEvent } from "@/lib/vibodeMyFurniture";

export const runtime = "nodejs";

type AnySupabaseClient = SupabaseClient;

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

function parseFurnitureId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  return asOptionalString((body as { id?: unknown }).id);
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

    const body = await req.json().catch(() => null);
    const furnitureId = parseFurnitureId(body);
    if (!furnitureId) {
      return Response.json({ error: "id is required." }, { status: 400 });
    }

    const row = await getVibodeUserFurnitureById(supabase, userData.user.id, furnitureId);
    if (!row || row.is_archived) {
      return Response.json({ error: "Saved furniture item was not found." }, { status: 404 });
    }

    const sourceUrl = resolveSourceUrl(row);
    const outboundUrl = resolveFurnitureOutboundUrl({
      discount_url: row.discount_url,
      affiliate_url: row.affiliate_url,
      source_url: sourceUrl,
    });
    if (!outboundUrl) {
      return Response.json({ error: "Saved furniture item does not have a valid outbound URL." }, { status: 400 });
    }

    try {
      await trackVibodeFurnitureEvent(supabase, {
        userId: userData.user.id,
        userFurnitureId: row.id,
        eventType: "outbound_clicked",
        roomId: null,
      });
    } catch (trackingError: unknown) {
      const message =
        trackingError instanceof Error ? trackingError.message : "unknown tracking error";
      console.warn(`[vibode/outbound] tracking failed: ${message}`);
    }

    return Response.json({ url: outboundUrl });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    const status = /not found/i.test(message) ? 404 : 500;
    return Response.json({ error: message }, { status });
  }
}
