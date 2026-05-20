import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSceneRebuildPayload, resolveSceneBaseImage, resolveScenePlacements } from "@/lib/vibodeSceneState";
import { resolveActiveSetVersionId } from "@/lib/vibode/active-set";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const ENABLE_DEBUG_SCENE_STATE =
  (process.env.VIBODE_ENABLE_SCENE_STATE_DEBUG ??
    (process.env.NODE_ENV === "production" ? "false" : "true"))
    .trim()
    .toLowerCase() === "true";

type AnySupabaseClient = SupabaseClient;

function jsonError(message: string, status: number, details?: Record<string, unknown>) {
  if (details) {
    return NextResponse.json({ error: message, details }, { status });
  }
  return NextResponse.json({ error: message }, { status });
}

function safeStr(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseBoolQueryParam(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function getBearerToken(headers: Headers): string | null {
  const authHeader = headers.get("authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) return null;
  const token = authHeader.slice(7).trim();
  return token.length > 0 ? token : null;
}

function getUserSupabaseClient(token: string): AnySupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function requireUser(req: Request): Promise<
  | { supabase: AnySupabaseClient; userId: string }
  | { errorResponse: NextResponse }
> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { errorResponse: jsonError("Server misconfigured: missing Supabase env.", 500) };
  }

  const token = getBearerToken(req.headers);
  if (!token) {
    return { errorResponse: jsonError("Unauthorized: missing Authorization Bearer token.", 401) };
  }

  const supabase = getUserSupabaseClient(token);
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    return { errorResponse: jsonError("Unauthorized.", 401) };
  }

  return { supabase, userId: userData.user.id };
}

export async function GET(req: Request) {
  try {
    if (!ENABLE_DEBUG_SCENE_STATE) {
      return jsonError("Not found.", 404);
    }

    const auth = await requireUser(req);
    if ("errorResponse" in auth) return auth.errorResponse;

    let requestUrl: URL;
    try {
      requestUrl = new URL(req.url);
    } catch {
      return jsonError("Invalid request URL.", 400);
    }

    const roomId = safeStr(requestUrl.searchParams.get("roomId"));
    const versionId = safeStr(requestUrl.searchParams.get("versionId"));
    const mode = safeStr(requestUrl.searchParams.get("mode"));
    const includePayload = parseBoolQueryParam(requestUrl.searchParams.get("includePayload"));
    if (!roomId || !versionId) {
      return jsonError("Invalid scene-state query params.", 400, {
        roomId: roomId ? "ok" : "missing",
        versionId: versionId ? "ok" : "missing",
        required: ["roomId", "versionId"],
      });
    }
    if (!isUuid(roomId) || !isUuid(versionId)) {
      return jsonError("Invalid scene-state query params.", 400, {
        roomId: isUuid(roomId) ? "ok" : "invalid_uuid",
        versionId: isUuid(versionId) ? "ok" : "invalid_uuid",
        expected: "UUID strings",
      });
    }

    if (mode === "rebuildPayload" || includePayload) {
      const payload = await buildSceneRebuildPayload({
        supabase: auth.supabase,
        roomId,
        userId: auth.userId,
        versionId,
      });
      return NextResponse.json(payload);
    }

    const [resolved, baseImage] = await Promise.all([
      resolveScenePlacements({
        supabase: auth.supabase,
        roomId,
        userId: auth.userId,
        versionId,
      }),
      resolveSceneBaseImage({
        supabase: auth.supabase,
        roomId,
        userId: auth.userId,
      }),
    ]);

    const [{ data: roomData, error: roomErr }, { data: versionData, error: versionErr }] = await Promise.all([
      auth.supabase
        .from("vibode_rooms")
        .select("id,metadata,base_asset_id,active_asset_id")
        .eq("id", roomId)
        .eq("user_id", auth.userId)
        .maybeSingle(),
      auth.supabase
        .from("vibode_room_assets")
        .select("id,asset_type,is_active,metadata")
        .eq("room_id", roomId)
        .eq("user_id", auth.userId),
    ]);
    if (roomErr) {
      throw new Error(`[vibode] failed to load room metadata for active set resolution: ${roomErr.message}`);
    }
    if (versionErr) {
      throw new Error(
        `[vibode] failed to load room versions for active set resolution: ${versionErr.message}`
      );
    }
    const activeSetVersionId = resolveActiveSetVersionId({
      roomMetadata: roomData?.metadata,
      versions: versionData ?? [],
      baseAssetId: safeStr(roomData?.base_asset_id) ?? null,
      activeAssetId: safeStr(roomData?.active_asset_id) ?? null,
    });

    return NextResponse.json({
      roomId: resolved.roomId,
      versionId: resolved.versionId,
      lineageVersionIds: resolved.lineageVersionIds,
      activeSetVersionId,
      resolvedPlacements: resolved.resolvedPlacements,
      baseImage,
      count: resolved.resolvedPlacements.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[vibode/scene-state][GET] unexpected error", { message });
    return jsonError("Unexpected scene-state resolver error.", 500);
  }
}
