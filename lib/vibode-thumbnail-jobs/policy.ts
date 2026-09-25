/**
 * THUMB-2D thumbnail job policy.
 *
 * Quiet window: 4 seconds. Each scene save writes
 * `not_before = now + 4s` and returns. The save does not sleep.
 * Later saves of the same version move `not_before` forward so a burst
 * of gestures collapses into one render.
 *
 * Claim lease: 180 seconds. THUMB-2B renders took about 10–20 seconds.
 * Three minutes covers cold asset download, encode, and upload without
 * holding a crashed worker's job for the 2–5 minute upper band.
 *
 * Retry: at most 3 attempts per content token.
 * After attempt 1, wait 15 seconds. After attempt 2, wait 60 seconds.
 * Attempt 3 is terminal. 180 seconds is the reserved third backoff and
 * is not scheduled while the cap is 3.
 */

export const VIBODE_3D_THUMBNAIL_BUCKET = "vibode-thumbnails";

export const VIBODE_3D_THUMBNAIL_CACHE_CONTROL =
  "public, max-age=31536000, immutable";

/** Value passed to Storage `cacheControl` (the client prefixes `max-age=`). */
export const VIBODE_3D_THUMBNAIL_CACHE_MAX_AGE_SEC = 31_536_000;

export const VIBODE_THUMBNAIL_JOB_QUIET_WINDOW_SEC = 4;

export const VIBODE_THUMBNAIL_JOB_CLAIM_LEASE_SEC = 180;

export const VIBODE_THUMBNAIL_JOB_MAX_ATTEMPTS = 3;

export const VIBODE_THUMBNAIL_JOB_RETRY_BACKOFF_SEC = [15, 60, 180] as const;

export const VIBODE_THUMBNAIL_JOB_ERROR_MESSAGE_MAX = 240;

const CONTENT_TOKEN = /^[0-9a-f]{64}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const RETRYABLE_CODES = new Set([
  "signed_url_failed",
  "glb_load_failed",
  "render_page_error",
  "upload_failed",
  "browser_launch_failed",
  "navigation_timeout",
  "render_timeout",
  "screenshot_failed",
  "encode_failed",
  "publish_failed",
]);

export function thumbnailJobRetryBackoffSec(attemptCount: number): number | null {
  if (attemptCount >= VIBODE_THUMBNAIL_JOB_MAX_ATTEMPTS) return null;
  const delay = VIBODE_THUMBNAIL_JOB_RETRY_BACKOFF_SEC[attemptCount - 1];
  return typeof delay === "number" ? delay : null;
}

export function thumbnailJobFailureIsRetryable(code: string): boolean {
  return RETRYABLE_CODES.has(code);
}

export function thumbnailQuietWindowDeadline(nowMs: number): string {
  return new Date(nowMs + VIBODE_THUMBNAIL_JOB_QUIET_WINDOW_SEC * 1000).toISOString();
}

export function vibode3dThumbnailObjectPath(
  roomId: string,
  versionId: string,
  contentToken: string,
): string | null {
  if (!UUID.test(roomId) || !UUID.test(versionId) || !CONTENT_TOKEN.test(contentToken)) {
    return null;
  }
  return `rooms/${roomId}/versions/${versionId}/scene/${contentToken}.webp`;
}

export function boundThumbnailJobErrorMessage(message: string): string {
  const trimmed = message.trim();
  if (trimmed.length <= VIBODE_THUMBNAIL_JOB_ERROR_MESSAGE_MAX) return trimmed;
  return trimmed.slice(0, VIBODE_THUMBNAIL_JOB_ERROR_MESSAGE_MAX);
}
