import {
  VIBODE_3D_THUMBNAIL_BUCKET,
  vibode3dThumbnailObjectPath,
} from "@/lib/vibode-thumbnail-jobs/policy";

/**
 * A published pointer is display authority for one History version.
 * Publish already checked scene freshness. Listing does not re-check
 * AFC generation: an older version keeps its own pointer, and comparing
 * it to the room's current generation would hide that thumbnail after
 * a version switch. Job status is also irrelevant here.
 */
export type PublishedVibode3dThumbnailPointer = Readonly<{
  roomId: string;
  versionId: string;
  contentToken: string;
  storageBucket: string;
  storagePath: string;
}>;

export function acceptPublishedVibode3dThumbnailPointer(args: {
  roomId: string;
  versionId: string;
  pointer: PublishedVibode3dThumbnailPointer | null;
}): PublishedVibode3dThumbnailPointer | null {
  const pointer = args.pointer;
  if (!pointer) return null;
  if (pointer.roomId !== args.roomId || pointer.versionId !== args.versionId) return null;
  if (pointer.storageBucket !== VIBODE_3D_THUMBNAIL_BUCKET) return null;
  const expectedPath = vibode3dThumbnailObjectPath(
    args.roomId,
    args.versionId,
    pointer.contentToken,
  );
  if (!expectedPath || pointer.storagePath !== expectedPath) return null;
  return {
    roomId: args.roomId,
    versionId: args.versionId,
    contentToken: pointer.contentToken,
    storageBucket: VIBODE_3D_THUMBNAIL_BUCKET,
    storagePath: expectedPath,
  };
}
