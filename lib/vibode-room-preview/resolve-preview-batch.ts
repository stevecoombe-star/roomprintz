import { ROOM_PREVIEW_BATCH_MAX } from "@/lib/vibode-room-preview/batch-limit";
import type { PublishedVibode3dThumbnailPointer } from "@/lib/vibode-room-preview/published-thumbnail";
import { acceptPublishedVibode3dThumbnailPointer } from "@/lib/vibode-room-preview/published-thumbnail";
import {
  durableRoomPreviewUrl,
  resolveRoomPreview,
  type RoomPreviewAsset,
  type RoomPreviewResolution,
  type RoomPreviewSignInput,
  type RoomPreviewSource,
} from "@/lib/vibode-room-preview/resolve-preview";
import { previewObjectSignKey } from "@/lib/vibode-room-preview/signed-url-batch";

const ROOM_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type RoomPreviewBatchItem = {
  roomId: string;
  previewUrl: string | null;
  source: RoomPreviewSource | null;
};

export type OwnedPreviewRoomRow = {
  id: string;
  user_id: string;
  cover_image_url: string | null;
  active_asset_id: string | null;
};

export type OwnedPreviewAssetRow = {
  id: string;
  room_id: string;
  user_id: string;
  image_url: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  thumbnail_storage_bucket: string | null;
  thumbnail_storage_path: string | null;
  created_at: string | null;
};

export type PreviewQueryResult<T> = {
  data: readonly T[] | null;
  error: { message: string } | null;
};

export type RoomPreviewBatchContext = {
  roomId: string;
  coverImageUrl: string | null;
  activeAsset: RoomPreviewAsset | null;
  publishedPointer: PublishedVibode3dThumbnailPointer | null;
};

export class RoomPreviewBatchQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoomPreviewBatchQueryError";
  }
}

export function parseRoomPreviewBatchRequest(
  body: unknown,
): { ok: true; roomIds: string[] } | { ok: false; status: number; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, error: "roomIds must be an array of room ids." };
  }
  const roomIds = (body as { roomIds?: unknown }).roomIds;
  if (!Array.isArray(roomIds)) {
    return { ok: false, status: 400, error: "roomIds must be an array of room ids." };
  }
  if (roomIds.length > ROOM_PREVIEW_BATCH_MAX) {
    return {
      ok: false,
      status: 400,
      error: `At most ${ROOM_PREVIEW_BATCH_MAX} room ids are allowed.`,
    };
  }

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const value of roomIds) {
    if (typeof value !== "string") continue;
    const roomId = value.trim();
    if (!ROOM_ID.test(roomId) || seen.has(roomId)) continue;
    seen.add(roomId);
    unique.push(roomId);
  }
  return { ok: true, roomIds: unique };
}

export function selectNewestActiveAssets(
  rows: readonly OwnedPreviewAssetRow[],
): Map<string, OwnedPreviewAssetRow> {
  const sorted = [...rows].sort((left, right) => {
    const leftTime = left.created_at ?? "";
    const rightTime = right.created_at ?? "";
    if (leftTime !== rightTime) return leftTime < rightTime ? 1 : -1;
    return left.id < right.id ? 1 : -1;
  });
  const byRoom = new Map<string, OwnedPreviewAssetRow>();
  for (const row of sorted) {
    if (!byRoom.has(row.room_id)) byRoom.set(row.room_id, row);
  }
  return byRoom;
}

export function chooseActivePreviewAsset(args: {
  userId: string;
  roomId: string;
  activeAssetId: string | null;
  assetsById: ReadonlyMap<string, OwnedPreviewAssetRow>;
  fallbackByRoomId: ReadonlyMap<string, OwnedPreviewAssetRow>;
}): OwnedPreviewAssetRow | null {
  if (args.activeAssetId) {
    const active = args.assetsById.get(args.activeAssetId);
    if (
      active &&
      active.user_id === args.userId &&
      active.room_id === args.roomId
    ) {
      return active;
    }
  }
  const fallback = args.fallbackByRoomId.get(args.roomId);
  if (!fallback || fallback.user_id !== args.userId || fallback.room_id !== args.roomId) {
    return null;
  }
  return fallback;
}

function toPreviewAsset(row: OwnedPreviewAssetRow): RoomPreviewAsset {
  return {
    id: row.id,
    imageUrl: row.image_url,
    storageBucket: row.storage_bucket,
    storagePath: row.storage_path,
    thumbnailStorageBucket: row.thumbnail_storage_bucket,
    thumbnailStoragePath: row.thumbnail_storage_path,
  };
}

export function collectRoomPreviewSignTargets(
  room: RoomPreviewBatchContext,
): RoomPreviewSignInput[] {
  const asset = room.activeAsset;
  if (!asset) return [];
  const targets: RoomPreviewSignInput[] = [];
  const pointer = acceptPublishedVibode3dThumbnailPointer({
    roomId: room.roomId,
    versionId: asset.id,
    pointer: room.publishedPointer,
  });
  if (pointer) {
    targets.push({ bucket: pointer.storageBucket, storagePath: pointer.storagePath });
  }

  const thumbnailBucket = asset.thumbnailStorageBucket?.trim() ?? "";
  const thumbnailPath = asset.thumbnailStoragePath?.trim() ?? "";
  if (thumbnailBucket && thumbnailPath) {
    targets.push({ bucket: thumbnailBucket, storagePath: thumbnailPath });
  }

  if (!durableRoomPreviewUrl(asset.imageUrl)) {
    const bucket = asset.storageBucket?.trim() ?? "";
    const storagePath = asset.storagePath?.trim() ?? "";
    if (bucket && storagePath) {
      targets.push({ bucket, storagePath });
    }
  }
  return targets;
}

function dedupeSignTargets(targets: readonly RoomPreviewSignInput[]): RoomPreviewSignInput[] {
  const unique: RoomPreviewSignInput[] = [];
  const seen = new Set<string>();
  for (const target of targets) {
    const key = previewObjectSignKey(target.bucket, target.storagePath);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(target);
  }
  return unique;
}

export async function resolveRoomPreviewBatch(
  rooms: readonly RoomPreviewBatchContext[],
  signStorageUrl: (input: RoomPreviewSignInput) => Promise<string | null>,
  resolveRoom: (
    input: Parameters<typeof resolveRoomPreview>[0],
  ) => Promise<RoomPreviewResolution> = resolveRoomPreview,
): Promise<Record<string, RoomPreviewBatchItem>> {
  const previews: Record<string, RoomPreviewBatchItem> = {};
  for (const room of rooms) {
    try {
      const resolved = await resolveRoom({
        preferThumbnail: true,
        roomId: room.roomId,
        coverImageUrl: room.coverImageUrl,
        activeAsset: room.activeAsset,
        publishedPointer: room.publishedPointer,
        signStorageUrl,
      });
      previews[room.roomId] = {
        roomId: room.roomId,
        previewUrl: resolved.previewUrl,
        source: resolved.source,
      };
    } catch (err) {
      console.warn("[vibode/room-preview-urls] room preview failed:", room.roomId, err);
      previews[room.roomId] = { roomId: room.roomId, previewUrl: null, source: null };
    }
  }
  return previews;
}

export async function loadRoomPreviewBatch(args: {
  userId: string;
  roomIds: readonly string[];
  listOwnedRooms: (
    userId: string,
    roomIds: readonly string[],
  ) => Promise<PreviewQueryResult<OwnedPreviewRoomRow>>;
  listAssetsById: (
    userId: string,
    assetIds: readonly string[],
  ) => Promise<PreviewQueryResult<OwnedPreviewAssetRow>>;
  listActiveAssets: (
    userId: string,
    roomIds: readonly string[],
  ) => Promise<PreviewQueryResult<OwnedPreviewAssetRow>>;
  listPointers: (
    versions: readonly { roomId: string; versionId: string }[],
  ) => Promise<ReadonlyMap<string, PublishedVibode3dThumbnailPointer>>;
  signTargets: (
    targets: readonly RoomPreviewSignInput[],
  ) => Promise<ReadonlyMap<string, string>>;
}): Promise<Record<string, RoomPreviewBatchItem>> {
  if (args.roomIds.length === 0) return {};

  const roomsResult = await args.listOwnedRooms(args.userId, args.roomIds);
  if (roomsResult.error) {
    throw new RoomPreviewBatchQueryError(roomsResult.error.message);
  }

  const requested = new Set(args.roomIds);
  const rooms = (roomsResult.data ?? []).filter(
    (room) => room.user_id === args.userId && requested.has(room.id),
  );

  const assetsById = new Map<string, OwnedPreviewAssetRow>();
  const assetIds = [
    ...new Set(
      rooms
        .map((room) => room.active_asset_id)
        .filter((assetId): assetId is string => typeof assetId === "string" && assetId.length > 0),
    ),
  ];
  if (assetIds.length > 0) {
    try {
      const assetsResult = await args.listAssetsById(args.userId, assetIds);
      if (assetsResult.error) {
        console.warn("[vibode/room-preview-urls] active asset lookup failed:", assetsResult.error.message);
      } else {
        for (const row of assetsResult.data ?? []) {
          if (row.user_id === args.userId) assetsById.set(row.id, row);
        }
      }
    } catch (err) {
      console.warn("[vibode/room-preview-urls] active asset lookup failed:", err);
    }
  }

  const fallbackByRoomId = new Map<string, OwnedPreviewAssetRow>();
  const unresolvedRoomIds = rooms
    .filter((room) => {
      return (
        chooseActivePreviewAsset({
          userId: args.userId,
          roomId: room.id,
          activeAssetId: room.active_asset_id,
          assetsById,
          fallbackByRoomId,
        }) === null
      );
    })
    .map((room) => room.id);
  if (unresolvedRoomIds.length > 0) {
    try {
      const activeResult = await args.listActiveAssets(args.userId, unresolvedRoomIds);
      if (activeResult.error) {
        console.warn("[vibode/room-preview-urls] fallback asset lookup failed:", activeResult.error.message);
      } else {
        for (const [roomId, row] of selectNewestActiveAssets(activeResult.data ?? [])) {
          if (row.user_id === args.userId) fallbackByRoomId.set(roomId, row);
        }
      }
    } catch (err) {
      console.warn("[vibode/room-preview-urls] fallback asset lookup failed:", err);
    }
  }

  const contextsWithoutPointers: {
    room: OwnedPreviewRoomRow;
    activeAsset: RoomPreviewAsset | null;
  }[] = rooms.map((room) => {
    const row = chooseActivePreviewAsset({
      userId: args.userId,
      roomId: room.id,
      activeAssetId: room.active_asset_id,
      assetsById,
      fallbackByRoomId,
    });
    return { room, activeAsset: row ? toPreviewAsset(row) : null };
  });

  const versions = contextsWithoutPointers
    .filter((context) => context.activeAsset)
    .map((context) => ({
      roomId: context.room.id,
      versionId: context.activeAsset!.id,
    }));
  let pointers: ReadonlyMap<string, PublishedVibode3dThumbnailPointer> = new Map();
  if (versions.length > 0) {
    try {
      pointers = await args.listPointers(versions);
    } catch (err) {
      console.warn("[vibode/room-preview-urls] pointer lookup failed:", err);
    }
  }

  const contexts: RoomPreviewBatchContext[] = contextsWithoutPointers.map((context) => ({
    roomId: context.room.id,
    coverImageUrl: context.room.cover_image_url,
    activeAsset: context.activeAsset,
    publishedPointer: context.activeAsset ? pointers.get(context.activeAsset.id) ?? null : null,
  }));

  const targets = dedupeSignTargets(contexts.flatMap((context) => collectRoomPreviewSignTargets(context)));
  let signed = new Map<string, string>();
  if (targets.length > 0) {
    try {
      signed = new Map(await args.signTargets(targets));
    } catch (err) {
      console.warn("[vibode/room-preview-urls] batch signing failed:", err);
    }
  }

  return resolveRoomPreviewBatch(contexts, async (input) => {
    return signed.get(previewObjectSignKey(input.bucket, input.storagePath)) ?? null;
  });
}
