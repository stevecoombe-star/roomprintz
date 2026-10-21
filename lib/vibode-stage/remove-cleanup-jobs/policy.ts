/**
 * Clean Up Room job limits. Keep the numeric functions in
 * supabase/migrations/20261020193000_vibode_cleanup_generations.sql equal
 * to these constants.
 *
 * The paid provider call stays on the dedicated worker.
 */

export const VIBODE_CLEANUP_BUCKET = "vibode-cleanup";

export const REMOVE_CLEANUP_JOB_CLAIM_LEASE_SEC = 240;

export const REMOVE_CLEANUP_JOB_CLAIM_LEASE_MS = REMOVE_CLEANUP_JOB_CLAIM_LEASE_SEC * 1000;

export const REMOVE_CLEANUP_JOB_MAX_PRECONTACT_ATTEMPTS = 3;

export const REMOVE_CLEANUP_DAILY_PROVIDER_LIMIT = 5;

export const REMOVE_CLEANUP_GLOBAL_DAILY_PROVIDER_LIMIT = 5;

export const REMOVE_CLEANUP_PRECONTACT_BACKOFF_MS = 15_000;

export const REMOVE_CLEANUP_HEARTBEAT_INTERVAL_MS = 30_000;

export const REMOVE_CLEANUP_FAILURE_MESSAGE_MAX = 240;

export const REMOVE_CLEANUP_ENABLED_RESOLUTION = "2K" as const;

export function cleanupJobPrefix(roomId: string, jobId: string): string {
  return `rooms/${roomId}/jobs/${jobId}`;
}

export function cleanupOriginalPath(roomId: string, jobId: string, mime: string): string {
  const extension = mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png";
  return `${cleanupJobPrefix(roomId, jobId)}/original.${extension}`;
}

export function cleanupOverlayPath(roomId: string, jobId: string): string {
  return `${cleanupJobPrefix(roomId, jobId)}/overlay.png`;
}

export function cleanupPromptPath(roomId: string, jobId: string): string {
  return `${cleanupJobPrefix(roomId, jobId)}/prompt.txt`;
}

export function cleanupMasksPath(roomId: string, jobId: string): string {
  return `${cleanupJobPrefix(roomId, jobId)}/masks.json`;
}

export function cleanupCandidatePath(roomId: string, jobId: string): string {
  return `${cleanupJobPrefix(roomId, jobId)}/candidate.jpg`;
}

export function cleanupUtcDayStartMs(nowMs: number): number {
  const date = new Date(nowMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}
