import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";

const PREVIEW_SIGNED_URL_EXPIRES_IN_SEC = Math.max(
  60,
  Number(process.env.VIBODE_PREVIEW_SIGNED_URL_EXPIRES_IN ?? 60 * 60 * 8)
);

type AnySupabaseClient = SupabaseClient<any, "public", any>;

type RoomRow = {
  id: string;
  user_id: string;
};

type RoomAssetRow = {
  id: string;
  room_id: string;
  user_id: string;
  asset_type: string;
  stage_number: number | null;
  storage_bucket: string | null;
  storage_path: string | null;
  thumbnail_storage_bucket: string | null;
  thumbnail_storage_path: string | null;
  image_url: string | null;
  width: number | null;
  height: number | null;
  model_version: string | null;
  is_active: boolean | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function normalizeText(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
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

function getDurablePreviewUrl(candidateUrl: string | null | undefined): string | null {
  const url = normalizeText(candidateUrl);
  if (!url) return null;
  if (url.toLowerCase().startsWith("data:image/")) return null;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
  } catch {
    return null;
  }

  if (isLikelyExpiringSignedUrl(url)) return null;
  return url;
}

function parseRoomId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const maybeRoomId = (body as { roomId?: unknown }).roomId;
  if (typeof maybeRoomId !== "string") return null;
  const roomId = maybeRoomId.trim();
  return roomId.length > 0 ? roomId : null;
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

function getAdminSupabaseClient(): AnySupabaseClient | null {
  if (!SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function resolveAssetPreviewUrl(
  asset: RoomAssetRow,
  adminSupabase: AnySupabaseClient | null
): Promise<string | null> {
  const durableUrl = getDurablePreviewUrl(asset.image_url);
  if (durableUrl) return durableUrl;

  const bucket = normalizeText(asset.storage_bucket);
  const storagePath = normalizeText(asset.storage_path);
  if (!bucket || !storagePath || !adminSupabase) return null;

  const { data: signed, error: signErr } = await adminSupabase.storage
    .from(bucket)
    .createSignedUrl(storagePath, PREVIEW_SIGNED_URL_EXPIRES_IN_SEC);
  if (signErr || !signed?.signedUrl) {
    console.warn("[vibode/room-versions] failed signing room asset URL:", {
      roomAssetId: asset.id,
      bucket,
      storagePath,
      error: signErr?.message ?? null,
    });
    return null;
  }

  return signed.signedUrl;
}

async function resolveAssetThumbnailPreviewUrl(
  asset: RoomAssetRow,
  adminSupabase: AnySupabaseClient | null
): Promise<string | null> {
  const bucket = normalizeText(asset.thumbnail_storage_bucket);
  const storagePath = normalizeText(asset.thumbnail_storage_path);
  if (!bucket || !storagePath || !adminSupabase) return null;

  const { data: signed, error: signErr } = await adminSupabase.storage
    .from(bucket)
    .createSignedUrl(storagePath, PREVIEW_SIGNED_URL_EXPIRES_IN_SEC);
  if (signErr || !signed?.signedUrl) {
    console.warn("[vibode/room-versions] failed signing room asset thumbnail URL:", {
      roomAssetId: asset.id,
      bucket,
      storagePath,
      error: signErr?.message ?? null,
    });
    return null;
  }

  return signed.signedUrl;
}

export async function POST(req: NextRequest) {
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

    const roomId = parseRoomId(body);
    if (!roomId) {
      return jsonError("roomId is required.", 400);
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
      console.error("[vibode/room-versions] room lookup failed:", roomErr);
      return jsonError("Failed to load room versions.", 500);
    }
    if (!roomData) {
      return jsonError("Room not found.", 404);
    }
    const room = roomData as RoomRow;

    const { data: assetRows, error: assetsErr } = await userSupabase
      .from("vibode_room_assets")
      .select(
        "id,room_id,user_id,asset_type,stage_number,storage_bucket,storage_path,thumbnail_storage_bucket,thumbnail_storage_path,image_url,width,height,model_version,is_active,metadata,created_at"
      )
      .eq("room_id", room.id)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (assetsErr) {
      console.error("[vibode/room-versions] room asset lookup failed:", assetsErr);
      return jsonError("Failed to load room versions.", 500);
    }

    const adminSupabase = getAdminSupabaseClient();
    const versions = await Promise.all(
      ((assetRows ?? []) as RoomAssetRow[]).map(async (asset) => {
        const imageUrl = await resolveAssetPreviewUrl(asset, adminSupabase);
        const thumbnailPreviewUrl = await resolveAssetThumbnailPreviewUrl(asset, adminSupabase);
        return {
          id: asset.id,
          room_id: asset.room_id,
          user_id: asset.user_id,
          asset_type: asset.asset_type,
          stage_number: asset.stage_number,
          storage_bucket: asset.storage_bucket,
          storage_path: asset.storage_path,
          thumbnail_storage_bucket: asset.thumbnail_storage_bucket,
          thumbnail_storage_path: asset.thumbnail_storage_path,
          image_url: imageUrl,
          preview_url: thumbnailPreviewUrl ?? imageUrl,
          width: asset.width,
          height: asset.height,
          model_version: asset.model_version,
          is_active: asset.is_active === true,
          metadata: asset.metadata ?? {},
          created_at: asset.created_at ?? "",
        };
      })
    );

    return NextResponse.json({ versions });
  } catch (err) {
    console.error("[vibode/room-versions] unexpected error:", err);
    return jsonError("Unexpected room versions error.", 500);
  }
}
