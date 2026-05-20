import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isVersionEligibleForActiveSet } from "@/lib/vibode/active-set";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

type AnySupabaseClient = SupabaseClient;

type RoomRow = {
  id: string;
  user_id: string;
  metadata: Record<string, unknown> | null;
};

type RoomAssetRow = {
  id: string;
  room_id: string;
  user_id: string;
  asset_type: string | null;
  metadata: Record<string, unknown> | null;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

    const roomId = normalizeText(body.roomId);
    const activeSetVersionId = normalizeText(body.activeSetVersionId);
    if (!roomId || !activeSetVersionId) {
      return jsonError("roomId and activeSetVersionId are required.", 400);
    }

    const userSupabase = getUserSupabaseClient(token);
    const { data: userData, error: userErr } = await userSupabase.auth.getUser();
    if (userErr || !userData?.user) {
      return jsonError("Unauthorized.", 401);
    }
    const userId = userData.user.id;

    const { data: roomData, error: roomErr } = await userSupabase
      .from("vibode_rooms")
      .select("id,user_id,metadata")
      .eq("id", roomId)
      .eq("user_id", userId)
      .maybeSingle();
    if (roomErr) {
      console.error("[vibode/set-active-set] room lookup failed:", roomErr);
      return jsonError("Failed to load room.", 500);
    }
    if (!roomData) {
      return jsonError("Room not found.", 404);
    }
    const room = roomData as RoomRow;

    const { data: assetData, error: assetErr } = await userSupabase
      .from("vibode_room_assets")
      .select("id,room_id,user_id,asset_type,metadata")
      .eq("id", activeSetVersionId)
      .eq("room_id", room.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (assetErr) {
      console.error("[vibode/set-active-set] asset lookup failed:", assetErr);
      return jsonError("Failed to load room version.", 500);
    }
    if (!assetData) {
      return jsonError("Version not found.", 404);
    }
    const asset = assetData as RoomAssetRow;
    if (!isVersionEligibleForActiveSet(asset)) {
      return jsonError("Only SET-compatible versions can be used as Base Image.", 400);
    }

    const nextMetadata = {
      ...(isRecord(room.metadata) ? room.metadata : {}),
      activeSetVersionId: asset.id,
    };

    const { error: updateErr } = await userSupabase
      .from("vibode_rooms")
      .update({ metadata: nextMetadata })
      .eq("id", room.id)
      .eq("user_id", userId);
    if (updateErr) {
      console.error("[vibode/set-active-set] room metadata update failed:", updateErr);
      return jsonError("Failed to set Base Image.", 500);
    }

    return NextResponse.json({
      success: true,
      roomId: room.id,
      activeSetVersionId: asset.id,
      metadata: nextMetadata,
    });
  } catch (err) {
    console.error("[vibode/set-active-set] unexpected error:", err);
    return jsonError("Unexpected set active set error.", 500);
  }
}

