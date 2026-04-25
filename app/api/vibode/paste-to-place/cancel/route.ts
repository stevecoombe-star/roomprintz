import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { markPasteToPlaceJobCancelled } from "@/lib/pasteToPlaceJobRegistry";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

type AnySupabaseClient = SupabaseClient;

function safeStr(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

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

export async function POST(req: NextRequest) {
  try {
    const bodyRaw = (await req.json()) as unknown;
    const body = bodyRaw && typeof bodyRaw === "object" ? (bodyRaw as Record<string, unknown>) : {};
    const jobId = safeStr(body.jobId);
    const scopeId = safeStr(body.scopeId);
    if (!jobId || !scopeId) {
      return Response.json({ error: "Missing jobId/scopeId." }, { status: 400 });
    }

    const { supabase, token } = getUserSupabaseClient(req);
    if (!token || !supabase) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    markPasteToPlaceJobCancelled(scopeId, jobId);
    const endpointBase = process.env.ROOMPRINTZ_COMPOSITOR_URL?.trim();
    if (endpointBase) {
      const endpointBaseNormalized = endpointBase
        .replace(/\/stage-room\/?$/, "")
        .replace(/\/api\/vibode\/stage-run\/?$/, "")
        .replace(/\/vibode\/stage-run\/?$/, "")
        .replace(/\/vibode\/compose\/?$/, "")
        .replace(/\/vibode\/remove\/?$/, "")
        .replace(/\/vibode\/swap\/?$/, "")
        .replace(/\/vibode\/rotate\/?$/, "")
        .replace(/\/vibode\/full_vibe\/?$/, "")
        .replace(/\/$/, "");
      const compositorCancelEndpoint = `${endpointBaseNormalized}/api/vibode/paste-to-place/cancel`;
      const apiKey = process.env.ROOMPRINTZ_COMPOSITOR_API_KEY;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      void fetch(compositorCancelEndpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ scopeId, jobId }),
      }).catch(() => {
        // Best-effort only.
      });
    }
    return Response.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
