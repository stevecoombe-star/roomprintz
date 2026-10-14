/**
 * Harmonize job limits. These match the SQL migration.
 * The provider call stays on the dedicated worker, not a Next.js request.
 */

export const VIBODE_HARMONIZE_BUCKET = "vibode-harmonize";

/** History copies use the bucket the publication RPC accepts. An env override must not change it. */
export const VIBODE_HISTORY_BUCKET = "vibode-generations";

export const HARMONIZE_HISTORY_MAX_TRANSIENT_ATTEMPTS = 3;

export const HARMONIZE_HISTORY_BACKOFF_MS = [5_000, 15_000, 45_000] as const;

export const HARMONIZE_JOB_CLAIM_LEASE_SEC = 240;

export const HARMONIZE_JOB_CLAIM_LEASE_MS = HARMONIZE_JOB_CLAIM_LEASE_SEC * 1000;

export const HARMONIZE_JOB_MAX_PRECONTACT_ATTEMPTS = 3;

export const HARMONIZE_DAILY_PROVIDER_LIMIT = 10;

export const HARMONIZE_PRECONTACT_BACKOFF_MS = 15_000;

export const HARMONIZE_HEARTBEAT_INTERVAL_MS = 30_000;

export const HARMONIZE_COMPOSITE_MAX_BYTES = 9_000_000;

export const HARMONIZE_OUTPUT_MAX_BYTES = 12_000_000;

export const HARMONIZE_COMPOSITE_MAX_EDGE = 4096;

export const HARMONIZE_WORKER_HEADER = "x-vibode-harmonize-worker";

export const HARMONIZE_JOB_HEADER = "x-vibode-harmonize-job-id";

export const HARMONIZE_NONCE_HEADER = "x-vibode-harmonize-claim-nonce";

export const HARMONIZE_PROVIDER_ID = "google-gemini-interactions";

export const HARMONIZE_FAILURE_MESSAGE_MAX = 240;

export function harmonizeCompositePath(
  roomId: string,
  userId: string,
  idempotencyKey: string,
): string {
  return `rooms/${roomId}/intakes/${userId}/${idempotencyKey}/composite.png`;
}

export function harmonizePromptPath(roomId: string, jobId: string): string {
  return `rooms/${roomId}/jobs/${jobId}/prompt.txt`;
}

export function harmonizeOutputPath(roomId: string, jobId: string, claimNonce: string): string {
  return `rooms/${roomId}/jobs/${jobId}/output-${claimNonce}.jpg`;
}

export function harmonizeHistoryObjectPath(roomId: string, jobId: string): string {
  return `rooms/${roomId}/harmonize/${jobId}.jpg`;
}

export function harmonizeHistoryBackoffMs(failedAttemptIndex: number): number {
  const index = Math.max(0, Math.min(failedAttemptIndex, HARMONIZE_HISTORY_BACKOFF_MS.length - 1));
  return HARMONIZE_HISTORY_BACKOFF_MS[index] ?? HARMONIZE_HISTORY_BACKOFF_MS[HARMONIZE_HISTORY_BACKOFF_MS.length - 1];
}

export function harmonizeUtcDayStartMs(nowMs: number): number {
  const date = new Date(nowMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}
