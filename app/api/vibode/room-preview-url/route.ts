import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  resolvePublishedVibode3dThumbnail,
  type ThumbnailPointerReader,
} from "@/lib/vibode-room-preview/published-thumbnail.server";
import {
  resolveRoomPreviewUrl,
  type RoomPreviewAsset,
} from "@/lib/vibode-room-preview/resolve-preview";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";

const PREVIEW_SIGNED_URL_EXPIRES_IN_SEC = Math.max(
  60,
  Number(process.env.VIBODE_PREVIEW_SIGNED_URL_EXPIRES_IN ?? 60 * 60 * 8)
);

type AnySupabaseClient = SupabaseClient;

type RoomRow = {
  id: string;
  user_id: string;
  cover_image_url: string | null;
  active_asset_id: string | null;
};

type RoomAssetRow = {
  id: string;
  image_url: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  thumbnail_storage_bucket: string | null;
  thumbnail_storage_path: string | null;
  created_at: string | null;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function parseRoomId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const maybeRoomId = (body as { roomId?: unknown }).roomId;
  if (typeof maybeRoomId !== "string") return null;
  const roomId = maybeRoomId.trim();
  return roomId.length > 0 ? roomId : null;
}

function parsePreferThumbnail(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  return (body as { preferThumbnail?: unknown }).preferThumbnail === true;
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

async function getActiveAssetForRoom(
  supabase: AnySupabaseClient,
  args: {
    roomId: string;
    userId: string;
    activeAssetId: string | null;
  }
): Promise<RoomAssetRow | null> {
  const columns =
    "id,image_url,storage_bucket,storage_path,thumbnail_storage_bucket,thumbnail_storage_path,created_at";

  if (args.activeAssetId) {
    const { data, error } = await supabase
      .from("vibode_room_assets")
      .select(columns)
      .eq("id", args.activeAssetId)
      .eq("room_id", args.roomId)
      .eq("user_id", args.userId)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to fetch active room asset: ${error.message}`);
    }
    if (data) return data as RoomAssetRow;
  }

  const { data, error } = await supabase
    .from("vibode_room_assets")
    .select(columns)
    .eq("room_id", args.roomId)
    .eq("user_id", args.userId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to fetch fallback active room asset: ${error.message}`);
  }
  return (data as RoomAssetRow | null) ?? null;
}

function toPreviewAsset(asset: RoomAssetRow): RoomPreviewAsset {
  return {
    id: asset.id,
    imageUrl: asset.image_url,
    storageBucket: asset.storage_bucket,
    storagePath: asset.storage_path,
    thumbnailStorageBucket: asset.thumbnail_storage_bucket,
    thumbnailStoragePath: asset.thumbnail_storage_path,
  };
}

async function createSignedStorageUrl(args: {
  adminSupabase: AnySupabaseClient | null;
  bucket: string;
  storagePath: string;
}): Promise<string | null> {
  if (!args.adminSupabase) return null;
  const { data: signed, error: signErr } = await args.adminSupabase.storage
    .from(args.bucket)
    .createSignedUrl(args.storagePath, PREVIEW_SIGNED_URL_EXPIRES_IN_SEC);
  if (signErr || !signed?.signedUrl) return null;
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
    const preferThumbnail = parsePreferThumbnail(body);
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
      .select("id,user_id,cover_image_url,active_asset_id")
      .eq("id", roomId)
      .eq("user_id", userId)
      .maybeSingle();
    if (roomErr) {
      console.error("[vibode/room-preview-url] room lookup failed:", roomErr);
      return jsonError("Failed to load room preview.", 500);
    }
    if (!roomData) {
      return jsonError("Room not found.", 404);
    }
    const room = roomData as RoomRow;
    const adminSupabase = getAdminSupabaseClient();

    const activeAsset = await getActiveAssetForRoom(userSupabase, {
      roomId: room.id,
      userId,
      activeAssetId: room.active_asset_id,
    });

    const publishedPointer =
      preferThumbnail && activeAsset
        ? await resolvePublishedVibode3dThumbnail({
            supabase: adminSupabase as unknown as ThumbnailPointerReader | null,
            roomId: room.id,
            versionId: activeAsset.id,
          })
        : null;

    const previewUrl = await resolveRoomPreviewUrl({
      preferThumbnail,
      roomId: room.id,
      coverImageUrl: room.cover_image_url,
      activeAsset: activeAsset ? toPreviewAsset(activeAsset) : null,
      publishedPointer,
      signStorageUrl: (input) =>
        createSignedStorageUrl({
          adminSupabase,
          bucket: input.bucket,
          storagePath: input.storagePath,
        }),
    });

    if (!previewUrl && !adminSupabase) {
      console.warn("[vibode/room-preview-url] service role key missing; cannot sign preview URL.");
    }
    return NextResponse.json({ previewUrl });
  } catch (err) {
    console.error("[vibode/room-preview-url] unexpected error:", err);
    return jsonError("Unexpected room preview error.", 500);
  }
}
