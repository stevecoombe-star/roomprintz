import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  listPublishedVibode3dThumbnails,
  type ThumbnailPointerListReader,
} from "@/lib/vibode-room-preview/published-thumbnail.server";
import {
  loadRoomPreviewBatch,
  parseRoomPreviewBatchRequest,
  RoomPreviewBatchQueryError,
  type OwnedPreviewAssetRow,
  type OwnedPreviewRoomRow,
  type PreviewQueryResult,
} from "@/lib/vibode-room-preview/resolve-preview-batch";
import {
  sharedSignedUrlReuseCache,
  signPreviewTargets,
} from "@/lib/vibode-room-preview/signed-url-batch";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";

const PREVIEW_SIGNED_URL_EXPIRES_IN_SEC = Math.max(
  60,
  Number(process.env.VIBODE_PREVIEW_SIGNED_URL_EXPIRES_IN ?? 60 * 60 * 8),
);

const MAX_BODY_BYTES = 32_000;
const NO_STORE = { "Cache-Control": "private, no-store" };

const ROOM_COLUMNS = "id,user_id,cover_image_url,active_asset_id";
const ASSET_COLUMNS =
  "id,room_id,user_id,image_url,storage_bucket,storage_path,thumbnail_storage_bucket,thumbnail_storage_path,created_at";

type AnySupabaseClient = SupabaseClient;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE });
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

function asQueryResult<T>(result: {
  data: unknown;
  error: { message: string } | null;
}): PreviewQueryResult<T> {
  return {
    data: Array.isArray(result.data) ? (result.data as T[]) : [],
    error: result.error ? { message: result.error.message } : null,
  };
}

async function listOwnedRooms(
  supabase: AnySupabaseClient,
  userId: string,
  roomIds: readonly string[],
): Promise<PreviewQueryResult<OwnedPreviewRoomRow>> {
  const result = await supabase
    .from("vibode_rooms")
    .select(ROOM_COLUMNS)
    .eq("user_id", userId)
    .in("id", [...roomIds])
    .limit(roomIds.length);
  return asQueryResult<OwnedPreviewRoomRow>(result);
}

async function listAssetsById(
  supabase: AnySupabaseClient,
  userId: string,
  assetIds: readonly string[],
): Promise<PreviewQueryResult<OwnedPreviewAssetRow>> {
  const result = await supabase
    .from("vibode_room_assets")
    .select(ASSET_COLUMNS)
    .eq("user_id", userId)
    .in("id", [...assetIds])
    .limit(assetIds.length);
  return asQueryResult<OwnedPreviewAssetRow>(result);
}

async function listActiveAssets(
  supabase: AnySupabaseClient,
  userId: string,
  roomIds: readonly string[],
): Promise<PreviewQueryResult<OwnedPreviewAssetRow>> {
  const result = await supabase
    .from("vibode_room_assets")
    .select(ASSET_COLUMNS)
    .eq("user_id", userId)
    .eq("is_active", true)
    .in("room_id", [...roomIds])
    .order("created_at", { ascending: false })
    .limit(1000);
  return asQueryResult<OwnedPreviewAssetRow>(result);
}

export async function POST(req: NextRequest) {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return jsonError("Server misconfigured: missing Supabase URL/anon key.", 500);
    }

    const contentLength = Number(req.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
      return jsonError("Preview batch is too large.", 413);
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

    const parsed = parseRoomPreviewBatchRequest(body);
    if (!parsed.ok) {
      return jsonError(parsed.error, parsed.status);
    }
    if (parsed.roomIds.length === 0) {
      return NextResponse.json({ previews: {} }, { headers: NO_STORE });
    }

    const userSupabase = getUserSupabaseClient(token);
    const { data: userData, error: userErr } = await userSupabase.auth.getUser();
    if (userErr || !userData?.user) {
      return jsonError("Unauthorized.", 401);
    }
    const userId = userData.user.id;
    const adminSupabase = getAdminSupabaseClient();

    const previews = await loadRoomPreviewBatch({
      userId,
      roomIds: parsed.roomIds,
      listOwnedRooms: (ownerId, roomIds) => listOwnedRooms(userSupabase, ownerId, roomIds),
      listAssetsById: (ownerId, assetIds) => listAssetsById(userSupabase, ownerId, assetIds),
      listActiveAssets: (ownerId, roomIds) => listActiveAssets(userSupabase, ownerId, roomIds),
      listPointers: (versions) =>
        listPublishedVibode3dThumbnails({
          supabase: adminSupabase as unknown as ThumbnailPointerListReader | null,
          versions,
        }),
      signTargets: (targets) =>
        signPreviewTargets({
          targets,
          expiresInSec: PREVIEW_SIGNED_URL_EXPIRES_IN_SEC,
          cache: sharedSignedUrlReuseCache(),
          createSignedUrls: async (bucket, paths, expiresInSec) => {
            if (!adminSupabase) return [];
            const { data, error } = await adminSupabase.storage
              .from(bucket)
              .createSignedUrls(paths, expiresInSec);
            if (error || !data) {
              throw new Error(error?.message ?? "Failed to sign preview URLs.");
            }
            return data.map((row) => ({
              path: row.path,
              signedUrl: row.signedUrl,
              error: row.error,
            }));
          },
        }),
    });

    return NextResponse.json({ previews }, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof RoomPreviewBatchQueryError) {
      console.error("[vibode/room-preview-urls] room lookup failed:", err.message);
      return jsonError("Failed to load room previews.", 500);
    }
    console.error("[vibode/room-preview-urls] unexpected error:", err);
    return jsonError("Unexpected room preview error.", 500);
  }
}
