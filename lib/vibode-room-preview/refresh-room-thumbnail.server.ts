import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import { scheduleVibodeThumbnailAfterSceneSave } from "@/lib/vibode-thumbnail-jobs/jobs.server";
import {
  resolvePublishedVibode3dThumbnail,
  type ThumbnailPointerReader,
} from "@/lib/vibode-room-preview/published-thumbnail.server";
import {
  executeRoomThumbnailRefresh,
  type RoomThumbnailRefreshResult,
} from "@/lib/vibode-room-preview/refresh-room-thumbnail";
import {
  resolveRoomPreviewUrl,
  type RoomPreviewAsset,
} from "@/lib/vibode-room-preview/resolve-preview";
import {
  previewObjectSignKey,
  sharedSignedUrlReuseCache,
  signPreviewTargets,
} from "@/lib/vibode-room-preview/signed-url-batch";

const PREVIEW_SIGNED_URL_EXPIRES_IN_SEC = Math.max(
  60,
  Number(process.env.VIBODE_PREVIEW_SIGNED_URL_EXPIRES_IN ?? 60 * 60 * 8),
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
};

const ASSET_COLUMNS =
  "id,image_url,storage_bucket,storage_path,thumbnail_storage_bucket,thumbnail_storage_path";

/**
 * Refresh one owned room through the existing 3D thumbnail job.
 * The worker still renders. This does not claim the shared queue.
 */
export async function refreshOwnedRoomThumbnail(args: {
  userSupabase: AnySupabaseClient;
  userId: string;
  roomId: string;
}): Promise<RoomThumbnailRefreshResult> {
  const { data: roomData, error: roomErr } = await args.userSupabase
    .from("vibode_rooms")
    .select("id,user_id,cover_image_url,active_asset_id")
    .eq("id", args.roomId)
    .eq("user_id", args.userId)
    .maybeSingle();
  if (roomErr) return { ok: false, code: "room_lookup_failed" };
  if (!roomData) return { ok: false, code: "not_found" };
  const room = roomData as RoomRow;

  let asset: RoomAssetRow | null;
  try {
    asset = await loadActiveAsset(args.userSupabase, {
      roomId: room.id,
      userId: args.userId,
      activeAssetId: room.active_asset_id,
    });
  } catch {
    return { ok: false, code: "room_lookup_failed" };
  }
  if (!asset) return { ok: false, code: "no_version" };
  const version = asset;

  const previewAsset = toPreviewAsset(version);
  return executeRoomThumbnailRefresh({
    schedule: () =>
      scheduleVibodeThumbnailAfterSceneSave(
        { roomId: room.id, versionId: version.id },
        { immediate: true },
      ),
    readPublishedToken: async () => {
      const pointer = await readPointer(room.id, version.id);
      return pointer?.contentToken ?? null;
    },
    signPublishedThumbnail: (contentToken) =>
      signThumbnail(room.id, version.id, contentToken),
    resolveClearedPreview: () =>
      resolveRoomPreviewUrl({
        preferThumbnail: true,
        roomId: room.id,
        coverImageUrl: room.cover_image_url,
        activeAsset: previewAsset,
        publishedPointer: null,
        signStorageUrl: signStoragePath,
      }),
  });
}

async function loadActiveAsset(
  supabase: AnySupabaseClient,
  args: { roomId: string; userId: string; activeAssetId: string | null },
): Promise<RoomAssetRow | null> {
  if (args.activeAssetId) {
    const { data, error } = await supabase
      .from("vibode_room_assets")
      .select(ASSET_COLUMNS)
      .eq("id", args.activeAssetId)
      .eq("room_id", args.roomId)
      .eq("user_id", args.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return data as RoomAssetRow;
  }

  const { data, error } = await supabase
    .from("vibode_room_assets")
    .select(ASSET_COLUMNS)
    .eq("room_id", args.roomId)
    .eq("user_id", args.userId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
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

async function readPointer(roomId: string, versionId: string) {
  const supabase = getServiceRoleSupabaseClient();
  return resolvePublishedVibode3dThumbnail({
    supabase: supabase as unknown as ThumbnailPointerReader | null,
    roomId,
    versionId,
  });
}

async function signThumbnail(
  roomId: string,
  versionId: string,
  contentToken: string,
): Promise<string | null> {
  const pointer = await readPointer(roomId, versionId);
  if (!pointer || pointer.contentToken !== contentToken) return null;
  const signed = await signPreviewTargets({
    targets: [{ bucket: pointer.storageBucket, storagePath: pointer.storagePath }],
    expiresInSec: PREVIEW_SIGNED_URL_EXPIRES_IN_SEC,
    cache: sharedSignedUrlReuseCache(),
    createSignedUrls: createSignedUrls,
  });
  return signed.get(previewObjectSignKey(pointer.storageBucket, pointer.storagePath)) ?? null;
}

async function signStoragePath(input: {
  bucket: string;
  storagePath: string;
}): Promise<string | null> {
  const signed = await signPreviewTargets({
    targets: [input],
    expiresInSec: PREVIEW_SIGNED_URL_EXPIRES_IN_SEC,
    cache: sharedSignedUrlReuseCache(),
    createSignedUrls: createSignedUrls,
  });
  return signed.get(previewObjectSignKey(input.bucket, input.storagePath)) ?? null;
}

async function createSignedUrls(
  bucket: string,
  paths: string[],
  expiresInSec: number,
): Promise<readonly { path: string | null; signedUrl: string | null; error: string | null }[]> {
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) return [];
  const { data, error } = await supabase.storage.from(bucket).createSignedUrls(paths, expiresInSec);
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to sign preview URL.");
  }
  return data.map((row) => ({
    path: row.path,
    signedUrl: row.signedUrl,
    error: row.error,
  }));
}
