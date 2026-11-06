/**
 * Account-owned furniture asset identity.
 *
 * Distinct from certified static ids (`afc-v2-runtime/...`) and partner
 * intake ids (`vibode-stage/partner-intake/...`). Scene rows store this id
 * only. Storage paths are derived here and never accepted from the client.
 */

import { isUuidLike } from "@/lib/vibode-stage/asset-id";
import { FURNITURE_ASSET_INTAKE_MAX_BYTES } from "@/lib/afc-v2-runtime/furniture-asset-policy";

export const PERSONAL_FURNITURE_ASSET_PREFIX = "vibode-furniture/personal/";

export const PERSONAL_FURNITURE_BUCKET = "vibode-furniture-assets";

/** Same ceiling as certified furniture intake. Raise this constant to raise the cap. */
export const PERSONAL_FURNITURE_GLB_MAX_BYTES = FURNITURE_ASSET_INTAKE_MAX_BYTES;

export const PERSONAL_FURNITURE_PENDING_LIMIT = 5;

export const PERSONAL_FURNITURE_UPLOAD_TTL_MS = 2 * 60 * 60 * 1000;

export const PERSONAL_FURNITURE_NAME_MAX = 80;

export const PERSONAL_FURNITURE_CATEGORY_MAX = 40;

const PERSONAL_ASSET_ID =
  /^vibode-furniture\/personal\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function createPersonalFurnitureAssetId(uuid: string): string | null {
  const normalized = uuid.trim().toLowerCase();
  if (!isUuidLike(normalized)) return null;
  return `${PERSONAL_FURNITURE_ASSET_PREFIX}${normalized}`;
}

export function isPersonalFurnitureAssetId(assetId: string): boolean {
  return PERSONAL_ASSET_ID.test(assetId);
}

export function personalFurnitureAssetUuid(assetId: string): string | null {
  if (!isPersonalFurnitureAssetId(assetId)) return null;
  return assetId.slice(PERSONAL_FURNITURE_ASSET_PREFIX.length);
}

export function personalFurniturePermanentPath(
  userId: string,
  assetId: string,
): string | null {
  const uuid = personalFurnitureAssetUuid(assetId);
  if (!uuid || !isUuidLike(userId.trim().toLowerCase())) return null;
  return `users/${userId.trim().toLowerCase()}/assets/${uuid}/model.glb`;
}

export function personalFurniturePendingPath(
  userId: string,
  uploadId: string,
): string | null {
  const normalizedUser = userId.trim().toLowerCase();
  const normalizedUpload = uploadId.trim().toLowerCase();
  if (!isUuidLike(normalizedUser) || !isUuidLike(normalizedUpload)) return null;
  return `users/${normalizedUser}/uploads/${normalizedUpload}/model.glb`;
}
