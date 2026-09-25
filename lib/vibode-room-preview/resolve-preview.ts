import { acceptPublishedVibode3dThumbnailPointer } from "@/lib/vibode-room-preview/published-thumbnail";

export type RoomPreviewAsset = Readonly<{
  id: string;
  imageUrl: string | null;
  storageBucket: string | null;
  storagePath: string | null;
  thumbnailStorageBucket: string | null;
  thumbnailStoragePath: string | null;
}>;

export type RoomPreviewSignInput = Readonly<{
  bucket: string;
  storagePath: string;
}>;

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

export function durableRoomPreviewUrl(candidateUrl: string | null | undefined): string | null {
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

async function signedPreviewUrl(
  signStorageUrl: (input: RoomPreviewSignInput) => Promise<string | null>,
  bucket: string | null | undefined,
  storagePath: string | null | undefined,
): Promise<string | null> {
  const normalizedBucket = normalizeText(bucket);
  const normalizedPath = normalizeText(storagePath);
  if (!normalizedBucket || !normalizedPath) return null;
  try {
    return await signStorageUrl({ bucket: normalizedBucket, storagePath: normalizedPath });
  } catch (err) {
    console.warn("[vibode/room-preview] storage signing failed:", err);
    return null;
  }
}

/**
 * Listing (`preferThumbnail`) tries the published 3D pointer, then the
 * existing 2D thumbnail, then the unchanged full-image chain.
 * Editor and room-open calls leave `preferThumbnail` false and skip both
 * thumbnail derivatives.
 */
export async function resolveRoomPreviewUrl(input: {
  preferThumbnail: boolean;
  roomId: string;
  coverImageUrl: string | null;
  activeAsset: RoomPreviewAsset | null;
  publishedPointer: {
    roomId: string;
    versionId: string;
    contentToken: string;
    storageBucket: string;
    storagePath: string;
  } | null;
  signStorageUrl: (signInput: RoomPreviewSignInput) => Promise<string | null>;
}): Promise<string | null> {
  const activeAsset = input.activeAsset;

  if (input.preferThumbnail && activeAsset) {
    const pointer = acceptPublishedVibode3dThumbnailPointer({
      roomId: input.roomId,
      versionId: activeAsset.id,
      pointer: input.publishedPointer,
    });
    if (pointer) {
      const sceneThumbnailUrl = await signedPreviewUrl(
        input.signStorageUrl,
        pointer.storageBucket,
        pointer.storagePath,
      );
      if (sceneThumbnailUrl) return sceneThumbnailUrl;
    }

    const thumbnailPreviewUrl = await signedPreviewUrl(
      input.signStorageUrl,
      activeAsset.thumbnailStorageBucket,
      activeAsset.thumbnailStoragePath,
    );
    if (thumbnailPreviewUrl) return thumbnailPreviewUrl;
  }

  if (activeAsset) {
    const assetPreviewUrl = durableRoomPreviewUrl(activeAsset.imageUrl);
    if (assetPreviewUrl) return assetPreviewUrl;

    const signedAssetPreviewUrl = await signedPreviewUrl(
      input.signStorageUrl,
      activeAsset.storageBucket,
      activeAsset.storagePath,
    );
    if (signedAssetPreviewUrl) return signedAssetPreviewUrl;
  }

  return durableRoomPreviewUrl(input.coverImageUrl);
}
