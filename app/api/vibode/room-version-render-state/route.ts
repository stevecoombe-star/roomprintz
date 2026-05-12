import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

type AnySupabaseClient = SupabaseClient;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function safeStr(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getBearerToken(req: NextRequest): string | null {
  const authHeader = req.headers.get("authorization") || "";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function safeArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

export async function PATCH(req: NextRequest) {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return jsonError("Server misconfigured: missing Supabase URL/anon key.", 500);
    }

    const token = getBearerToken(req);
    if (!token) {
      return jsonError("Unauthorized: missing Authorization Bearer token.", 401);
    }

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return jsonError("Invalid JSON body.", 400);
    }

    const roomId = safeStr(body.roomId);
    const assetId = safeStr(body.assetId);
    const sceneRenderState = body.sceneRenderState;
    if (!roomId || !assetId || !isRecord(sceneRenderState)) {
      return jsonError("roomId, assetId, and sceneRenderState are required.", 400);
    }

    const userSupabase = getUserSupabaseClient(token);
    const { data: userData, error: userErr } = await userSupabase.auth.getUser();
    if (userErr || !userData?.user) {
      return jsonError("Unauthorized.", 401);
    }
    const userId = userData.user.id;

    const { data: roomData, error: roomErr } = await userSupabase
      .from("vibode_rooms")
      .select("id,user_id")
      .eq("id", roomId)
      .eq("user_id", userId)
      .maybeSingle();
    if (roomErr) {
      return jsonError("Failed to load room.", 500);
    }
    if (!roomData) {
      return jsonError("Room not found.", 404);
    }

    const { data: assetData, error: assetErr } = await userSupabase
      .from("vibode_room_assets")
      .select("id,metadata")
      .eq("id", assetId)
      .eq("room_id", roomId)
      .eq("user_id", userId)
      .maybeSingle();
    if (assetErr) {
      return jsonError("Failed to load room version.", 500);
    }
    if (!assetData) {
      return jsonError("Version not found.", 404);
    }

    const existingMetadata = isRecord(assetData.metadata) ? assetData.metadata : {};
    const existingSceneRenderState = isRecord(existingMetadata.sceneRenderState)
      ? existingMetadata.sceneRenderState
      : null;
    const nextSceneRenderState = {
      ...sceneRenderState,
      originalPlacementStateHash:
        safeOptionalString(existingSceneRenderState?.originalPlacementStateHash) ??
        safeOptionalString(existingSceneRenderState?.renderedPlacementStateHash) ??
        safeOptionalString(sceneRenderState.renderedPlacementStateHash),
      originalPlacementSnapshot:
        safeArray(existingSceneRenderState?.originalPlacementSnapshot) ??
        safeArray(existingSceneRenderState?.renderedPlacementSnapshot) ??
        safeArray(sceneRenderState.renderedPlacementSnapshot),
    };
    const nextMetadata = {
      ...existingMetadata,
      sceneRenderState: nextSceneRenderState,
    };

    const { error: updateErr } = await userSupabase
      .from("vibode_room_assets")
      .update({ metadata: nextMetadata })
      .eq("id", assetId)
      .eq("room_id", roomId)
      .eq("user_id", userId);
    if (updateErr) {
      return jsonError("Failed to persist scene render state metadata.", 500);
    }

    return NextResponse.json({ success: true, metadata: nextMetadata });
  } catch {
    return jsonError("Unexpected room version render state error.", 500);
  }
}
