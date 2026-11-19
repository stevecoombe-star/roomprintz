/**
 * Shared limits for preparing a customer photograph before New Room or the
 * 3D Generator sees it. The bytes that cross a Vercel function stay under
 * the 4.5 MB platform ceiling. Larger originals go straight to private storage.
 */

export const PHOTO_PREPARATION_BUCKET = "vibode-photo-preparations";

export const PHOTO_PREPARATION_MAX_INPUT_BYTES = 25 * 1024 * 1024;

/** Multipart originals at or below this size may use the existing function routes. */
export const PHOTO_PREPARATION_DIRECT_MAX_BYTES = 4_000_000;

export const VERCEL_FUNCTION_BODY_MAX_BYTES = 4_500_000;

export const PHOTO_PREPARATION_ACTIVE_LIMIT = 3;

export const PHOTO_PREPARATION_HOURLY_LIMIT = 30;

export const PHOTO_PREPARATION_UPLOAD_TTL_MS = 10 * 60 * 1000;

export const PHOTO_PREPARATION_CONVERT_LEASE_MS = 90 * 1000;

export const PHOTO_PREPARATION_JSON_MAX_BYTES = 8_192;

export const PHOTO_PREPARATION_BEGIN_PATH = "/api/vibode/photo-preparations";

export const PHOTO_PREPARATION_COMPLETE_PATH = "/api/vibode/photo-preparations/complete";

export const PHOTO_PREPARATION_ABANDON_PATH = "/api/vibode/photo-preparations/abandon";

const PREPARATION_PATH =
  /^users\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/preparations\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/source\.heic$/;

export function isPhotoPreparationObjectPath(path: string): boolean {
  return PREPARATION_PATH.test(path);
}

export function photoPreparationPathOwnedBy(path: string, userId: string): boolean {
  const owner = userId.trim().toLowerCase();
  return isPhotoPreparationObjectPath(path) && path.startsWith(`users/${owner}/`);
}

export function photoPreparationJsonStatus(
  contentLength: string | null,
): "ok" | "too_large" | "unreadable" {
  if (contentLength == null || contentLength === "") return "ok";
  if (!/^\d+$/.test(contentLength)) return "unreadable";
  return Number(contentLength) > PHOTO_PREPARATION_JSON_MAX_BYTES ? "too_large" : "ok";
}
