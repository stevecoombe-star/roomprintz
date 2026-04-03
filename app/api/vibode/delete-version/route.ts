import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const VIBODE_STAGED_BUCKET = (process.env.VIBODE_STAGED_BUCKET || "vibode-generations").trim();

type AnySupabaseClient = SupabaseClient<any, "public", any>;

type RoomRow = {
  id: string;
  user_id: string;
  base_asset_id: string | null;
  active_asset_id: string | null;
};

type AssetRow = {
  id: string;
  room_id: string;
  user_id: string;
  asset_type: string | null;
  created_at: string | null;
  is_active: boolean | null;
  image_url: string | null;
  storage_bucket: string | null;
};

const DELETABLE_VERSION_ASSET_TYPES = new Set(["stage_output"]);

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseBody(body: unknown): { roomId: string | null; assetId: string | null } {
  if (!body || typeof body !== "object") {
    return { roomId: null, assetId: null };
  }
  const parsed = body as { roomId?: unknown; assetId?: unknown };
  return {
    roomId: normalizeText(parsed.roomId),
    assetId: normalizeText(parsed.assetId),
  };
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

function assetSortByNewestThenIdDesc(a: AssetRow, b: AssetRow): number {
  const aMs = Date.parse(a.created_at ?? "");
  const bMs = Date.parse(b.created_at ?? "");
  const safeA = Number.isFinite(aMs) ? aMs : 0;
  const safeB = Number.isFinite(bMs) ? bMs : 0;
  if (safeA !== safeB) return safeB - safeA;
  return b.id.localeCompare(a.id);
}

function normalizeAssetType(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function isDeletableVersionAsset(asset: AssetRow, room: RoomRow): boolean {
  const assetType = normalizeAssetType(asset.asset_type);
  if (!DELETABLE_VERSION_ASSET_TYPES.has(assetType)) return false;
  if (room.base_asset_id && room.base_asset_id === asset.id) return false;
  return true;
}

export async function DELETE(req: NextRequest) {
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

    const { roomId, assetId } = parseBody(body);
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
      .select("id,user_id,base_asset_id,active_asset_id")
      .eq("id", roomId)
      .eq("user_id", userId)
      .maybeSingle();
    if (roomErr) {
      console.error("[vibode/delete-version] room lookup failed:", roomErr);
      return jsonError("Failed to load room.", 500);
    }
    if (!roomData) {
      return jsonError("Room not found.", 404);
    }
    const room = roomData as RoomRow;

    const { data: assetData, error: assetsErr } = await userSupabase
      .from("vibode_room_assets")
      .select("id,room_id,user_id,asset_type,created_at,is_active,image_url,storage_bucket")
      .eq("room_id", room.id)
      .eq("user_id", userId);
    if (assetsErr) {
      console.error("[vibode/delete-version] room asset lookup failed:", assetsErr);
      return jsonError("Failed to load room versions.", 500);
    }

    const assets = ((assetData ?? []) as AssetRow[]).slice().sort(assetSortByNewestThenIdDesc);
    if (assets.length <= 1) {
      return jsonError("Cannot delete the last remaining version.", 400);
    }

    const target = assets.find((asset) => asset.id === assetId) ?? null;
    if (!target) {
      return jsonError("Version not found.", 404);
    }
    if (!isDeletableVersionAsset(target, room)) {
      return jsonError("This room asset type is not deletable from Versions.", 400);
    }

    const remaining = assets.filter((asset) => asset.id !== target.id);
    if (remaining.length === 0) {
      return jsonError("Cannot delete the last remaining version.", 400);
    }

    const deletedWasActive = target.is_active === true || room.active_asset_id === target.id;
    const nextActiveAsset =
      remaining.find((asset) => asset.id === room.active_asset_id) ??
      remaining.find((asset) => asset.is_active === true) ??
      remaining[0] ??
      null;

    if (deletedWasActive && !nextActiveAsset) {
      return jsonError("Cannot delete the last remaining version.", 400);
    }

    if (deletedWasActive && nextActiveAsset) {
      // Activate replacement first so we never delete before replacement is secured.
      const { error: activateErr } = await userSupabase
        .from("vibode_room_assets")
        .update({ is_active: true })
        .eq("id", nextActiveAsset.id)
        .eq("room_id", room.id)
        .eq("user_id", userId);
      if (activateErr) {
        console.error("[vibode/delete-version] failed activating replacement asset:", activateErr);
        return jsonError("Failed to update room version state.", 500);
      }

      const nowIso = new Date().toISOString();
      const durableCoverImageUrl = getDurableImageUrl({
        candidateUrl: nextActiveAsset.image_url,
        storageBucket: nextActiveAsset.storage_bucket,
      });
      const roomUpdatePayload: { active_asset_id: string; sort_key: string; cover_image_url?: string } = {
        active_asset_id: nextActiveAsset.id,
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
        console.error("[vibode/delete-version] room update failed:", updateRoomErr);
        return jsonError("Failed to update room active version.", 500);
      }

      const { error: deactivateOthersErr } = await userSupabase
        .from("vibode_room_assets")
        .update({ is_active: false })
        .eq("room_id", room.id)
        .eq("user_id", userId)
        .eq("is_active", true)
        .neq("id", nextActiveAsset.id);
      if (deactivateOthersErr) {
        console.error(
          "[vibode/delete-version] failed deactivating non-active room assets:",
          deactivateOthersErr
        );
        return jsonError("Failed to finalize room version state.", 500);
      }
    }

    const { error: deleteErr } = await userSupabase
      .from("vibode_room_assets")
      .delete()
      .eq("id", target.id)
      .eq("room_id", room.id)
      .eq("user_id", userId);
    if (deleteErr) {
      console.error("[vibode/delete-version] failed deleting room asset:", deleteErr);
      return jsonError("Failed to delete room version.", 500);
    }

    return NextResponse.json({
      success: true,
      deletedWasActive,
      nextActiveAssetId: nextActiveAsset?.id ?? null,
    });
  } catch (err) {
    console.error("[vibode/delete-version] unexpected error:", err);
    return jsonError("Unexpected delete version error.", 500);
  }
}
