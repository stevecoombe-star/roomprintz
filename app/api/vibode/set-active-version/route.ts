import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const VIBODE_STAGED_BUCKET = (process.env.VIBODE_STAGED_BUCKET || "vibode-generations").trim();

type AnySupabaseClient = SupabaseClient;

type RoomRow = {
  id: string;
  user_id: string;
};

type AssetRow = {
  id: string;
  room_id: string;
  user_id: string;
  image_url: string | null;
  storage_bucket: string | null;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getBearerToken(req: NextRequest): string | null {
  const authHeader = req.headers.get("authorization") || "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    return token.length > 0 ? token : null;
  }
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice("bearer ".length).trim();
    return token.length > 0 ? token : null;
  }
  return null;
}

function getUserSupabaseClient(token: string): AnySupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function isLikelyExpiringSignedUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.pathname.includes("/storage/v1/object/sign/")) return true;
    if (parsed.searchParams.has("token")) return true;
    if (parsed.searchParams.has("X-Amz-Signature")) return true;
    if (parsed.searchParams.has("X-Amz-Credential")) return true;
    return false;
  } catch {
    return false;
  }
}

function getDurableImageUrl(args: { candidateUrl?: string | null; storageBucket?: string | null }) {
  const url = typeof args.candidateUrl === "string" ? args.candidateUrl.trim() : "";
  if (!url) return null;
  const bucket = typeof args.storageBucket === "string" ? args.storageBucket.trim() : "";
  const isPrivateBucket =
    bucket === "vibode-generations" || bucket === VIBODE_STAGED_BUCKET || bucket === "vibode-base-images";
  if (isPrivateBucket && isLikelyExpiringSignedUrl(url)) return null;
  return url;
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

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const roomId = normalizeText((body as { roomId?: unknown })?.roomId);
    const assetId = normalizeText((body as { assetId?: unknown })?.assetId);
    if (!roomId || !assetId) {
      return jsonError("roomId and assetId are required.", 400);
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
      console.error("[vibode/set-active-version] room lookup failed:", roomErr);
      return jsonError("Failed to load room.", 500);
    }
    if (!roomData) {
      return jsonError("Room not found.", 404);
    }
    const room = roomData as RoomRow;

    const { data: assetData, error: assetErr } = await userSupabase
      .from("vibode_room_assets")
      .select("id,room_id,user_id,image_url,storage_bucket")
      .eq("id", assetId)
      .eq("room_id", room.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (assetErr) {
      console.error("[vibode/set-active-version] asset lookup failed:", assetErr);
      return jsonError("Failed to load room version.", 500);
    }
    if (!assetData) {
      return jsonError("Version not found.", 404);
    }
    const asset = assetData as AssetRow;
    const nowIso = new Date().toISOString();
    const durableCoverImageUrl = getDurableImageUrl({
      candidateUrl: asset.image_url,
      storageBucket: asset.storage_bucket,
    });

    const { error: deactivateErr } = await userSupabase
      .from("vibode_room_assets")
      .update({ is_active: false })
      .eq("room_id", room.id)
      .eq("user_id", userId)
      .eq("is_active", true)
      .neq("id", asset.id);
    if (deactivateErr) {
      console.error("[vibode/set-active-version] failed deactivating old active asset:", deactivateErr);
      return jsonError("Failed to update room version state.", 500);
    }

    const { error: activateErr } = await userSupabase
      .from("vibode_room_assets")
      .update({ is_active: true })
      .eq("id", asset.id)
      .eq("room_id", room.id)
      .eq("user_id", userId);
    if (activateErr) {
      console.error("[vibode/set-active-version] failed activating selected asset:", activateErr);
      return jsonError("Failed to set selected room version.", 500);
    }

    const roomUpdatePayload: { active_asset_id: string; sort_key: string; cover_image_url?: string } = {
      active_asset_id: asset.id,
      sort_key: nowIso,
    };
    if (durableCoverImageUrl) {
      roomUpdatePayload.cover_image_url = durableCoverImageUrl;
    }

    const { error: updateRoomErr } = await userSupabase
      .from("vibode_rooms")
      .update(roomUpdatePayload)
      .eq("id", room.id)
      .eq("user_id", userId);
    if (updateRoomErr) {
      console.error("[vibode/set-active-version] room update failed:", updateRoomErr);
      return jsonError("Failed to set active room version.", 500);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[vibode/set-active-version] unexpected error:", err);
    return jsonError("Unexpected set active version error.", 500);
  }
}
