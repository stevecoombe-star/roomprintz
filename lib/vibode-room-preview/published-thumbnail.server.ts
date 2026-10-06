import "server-only";

import {
  acceptPublishedVibode3dThumbnailPointer,
  type PublishedVibode3dThumbnailPointer,
} from "@/lib/vibode-room-preview/published-thumbnail";

const POINTER_COLUMNS = "room_id,version_id,content_token,storage_bucket,storage_path";

type PointerQuery = {
  eq: (column: string, value: string) => PointerQuery;
  maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>;
};

export type ThumbnailPointerReader = {
  from: (table: string) => {
    select: (columns: string) => PointerQuery;
  };
};

type PointerListQuery = {
  in: (
    column: string,
    values: readonly string[],
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

export type ThumbnailPointerListReader = {
  from: (table: string) => {
    select: (columns: string) => PointerListQuery;
  };
};

function readPointerRow(data: unknown): PublishedVibode3dThumbnailPointer | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>;
  if (
    typeof row.room_id !== "string" ||
    typeof row.version_id !== "string" ||
    typeof row.content_token !== "string" ||
    typeof row.storage_bucket !== "string" ||
    typeof row.storage_path !== "string"
  ) {
    return null;
  }
  return {
    roomId: row.room_id,
    versionId: row.version_id,
    contentToken: row.content_token,
    storageBucket: row.storage_bucket,
    storagePath: row.storage_path,
  };
}

/**
 * Read the published 3D thumbnail for one owned room version.
 * Service role only. No scene, GLB, or job read.
 */
export async function resolvePublishedVibode3dThumbnail(args: {
  supabase: ThumbnailPointerReader | null;
  roomId: string;
  versionId: string;
}): Promise<PublishedVibode3dThumbnailPointer | null> {
  if (!args.supabase) return null;
  try {
    const { data, error } = await args.supabase
      .from("vibode_3d_thumbnail_pointers")
      .select(POINTER_COLUMNS)
      .eq("room_id", args.roomId)
      .eq("version_id", args.versionId)
      .maybeSingle();
    if (error) {
      console.warn("[vibode/room-preview] 3D thumbnail pointer lookup failed:", error.message);
      return null;
    }
    return acceptPublishedVibode3dThumbnailPointer({
      roomId: args.roomId,
      versionId: args.versionId,
      pointer: readPointerRow(data),
    });
  } catch (err) {
    console.warn("[vibode/room-preview] 3D thumbnail pointer lookup failed:", err);
    return null;
  }
}

/**
 * Read published 3D thumbnails for many owned versions in one query.
 * Service role only. No scene, GLB, or job read. A failed query returns
 * an empty map so listing can fall back per room.
 */
export async function listPublishedVibode3dThumbnails(args: {
  supabase: ThumbnailPointerListReader | null;
  versions: readonly { roomId: string; versionId: string }[];
}): Promise<Map<string, PublishedVibode3dThumbnailPointer>> {
  const pointers = new Map<string, PublishedVibode3dThumbnailPointer>();
  if (!args.supabase || args.versions.length === 0) return pointers;

  const roomIdByVersion = new Map<string, string>();
  for (const version of args.versions) {
    roomIdByVersion.set(version.versionId, version.roomId);
  }

  try {
    const { data, error } = await args.supabase
      .from("vibode_3d_thumbnail_pointers")
      .select(POINTER_COLUMNS)
      .in("version_id", [...roomIdByVersion.keys()]);
    if (error) {
      console.warn("[vibode/room-preview] 3D thumbnail pointer batch lookup failed:", error.message);
      return pointers;
    }
    const rows = Array.isArray(data) ? data : [];
    for (const row of rows) {
      const pointer = readPointerRow(row);
      if (!pointer) continue;
      const roomId = roomIdByVersion.get(pointer.versionId);
      if (!roomId) continue;
      const accepted = acceptPublishedVibode3dThumbnailPointer({
        roomId,
        versionId: pointer.versionId,
        pointer,
      });
      if (accepted) pointers.set(accepted.versionId, accepted);
    }
    return pointers;
  } catch (err) {
    console.warn("[vibode/room-preview] 3D thumbnail pointer batch lookup failed:", err);
    return pointers;
  }
}
