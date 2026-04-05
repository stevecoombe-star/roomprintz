import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { trackVibodeFurnitureEvent, type VibodeFurnitureEventType } from "@/lib/vibodeMyFurniture";

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

function parseEventType(value: unknown): VibodeFurnitureEventType | null {
  if (value === "added" || value === "swapped") return value;
  return null;
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
    const userFurnitureId = asOptionalString(
      (body as { userFurnitureId?: unknown } | null)?.userFurnitureId
    );
    const eventType = parseEventType((body as { eventType?: unknown } | null)?.eventType);
    const roomId = asOptionalString((body as { roomId?: unknown } | null)?.roomId);

    if (!userFurnitureId) {
      return Response.json({ error: "userFurnitureId is required." }, { status: 400 });
    }
    if (!eventType) {
      return Response.json({ error: "eventType must be 'added' or 'swapped'." }, { status: 400 });
    }

    const counters = await trackVibodeFurnitureEvent(supabase, {
      userId: userData.user.id,
      userFurnitureId,
      eventType,
      roomId,
    });

    return Response.json({ ok: true, counters });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    const status = /not found/i.test(message) ? 404 : 500;
    return Response.json({ error: message }, { status });
  }
}
