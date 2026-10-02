/**
 * Catalog GLB thumbnail policy.
 *
 * One stored still per stage asset. The GLB stays authoritative: a
 * thumbnail failure never changes asset status.
 */

import { VIBODE_3D_THUMBNAIL_BUCKET } from "@/lib/vibode-thumbnail-jobs/policy";

export const VIBODE_STAGE_MODEL_THUMBNAILS_TABLE = "vibode_stage_model_thumbnails";

export const VIBODE_MODEL_THUMBNAIL_BUCKET = VIBODE_3D_THUMBNAIL_BUCKET;

export const VIBODE_MODEL_THUMBNAIL_DISPLAY_URL_EXPIRES_SEC = 60 * 60;

export const VIBODE_MODEL_THUMBNAIL_MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export const VIBODE_MODEL_THUMBNAIL_ASSET_HEADER = "x-vibode-model-asset-id";

const SHA256 = /^[a-f0-9]{64}$/;

export function isModelThumbnailSha256(value: string): boolean {
  return SHA256.test(value);
}

export function isModelThumbnailAssetId(assetId: string): boolean {
  if (!assetId || assetId.length > 256) return false;
  if (assetId.startsWith("/") || assetId.includes("\\") || assetId.includes("..")) return false;
  return /^[A-Za-z0-9._/-]+$/.test(assetId);
}

export function modelThumbnailObjectPath(assetId: string, sha256: string): string | null {
  if (!isModelThumbnailSha256(sha256) || !isModelThumbnailAssetId(assetId)) return null;
  const storagePath = `models/${assetId}/${sha256}.webp`;
  if (storagePath.length > 512 || storagePath.includes("..")) return null;
  return storagePath;
}

export function isDisplayableModelThumbnailUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
