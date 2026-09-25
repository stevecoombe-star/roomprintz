import type { WorkerEnv } from "./env.js";
import type { WorkerFailure } from "./failures.js";

export type ClaimedJob = Readonly<{
  jobId: string;
  roomId: string;
  versionId: string;
  contentToken: string;
  claimNonce: string;
  claimExpiresAt: string;
  accessToken: string;
  attemptCount: number;
}>;

export type ThumbnailApi = Readonly<{
  claim: () => Promise<{ ok: true; job: ClaimedJob | null } | { ok: false; code: string }>;
  fail: (job: ClaimedJob, failure: WorkerFailure) => Promise<void>;
  publish: (job: ClaimedJob, bytes: Uint8Array) => Promise<{ ok: true } | { ok: false; code: string }>;
}>;

export function createThumbnailApi(env: WorkerEnv, fetchImpl: typeof fetch = fetch): ThumbnailApi {
  const headers = { "x-vibode-thumbnail-worker": env.workerSecret };
  return {
    async claim() {
      const response = await fetchImpl(`${env.appBaseUrl}/api/internal/vibode-thumbnail-jobs/claim`, {
        method: "POST",
        headers,
      });
      const body = await response.json().catch(() => null) as {
        ok?: boolean;
        code?: string;
        job?: Record<string, unknown> | null;
      } | null;
      if (!response.ok || !body?.ok) {
        return { ok: false, code: body?.code || `claim_http_${response.status}` };
      }
      if (!body.job) return { ok: true, job: null };
      const job = readJob(body.job);
      if (!job) return { ok: false, code: "not_claimed" };
      return { ok: true, job };
    },
    async fail(job, failure) {
      await fetchImpl(`${env.appBaseUrl}/api/internal/vibode-thumbnail-jobs/fail`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          jobId: job.jobId,
          claimNonce: job.claimNonce,
          code: failure.code,
          message: failure.message,
        }),
      });
    },
    async publish(job, bytes) {
      const response = await fetchImpl(`${env.appBaseUrl}/api/internal/vibode-thumbnail-jobs/publish`, {
        method: "POST",
        headers: {
          ...headers,
          "content-type": "image/webp",
          "x-vibode-thumbnail-job-id": job.jobId,
          "x-vibode-thumbnail-claim-nonce": job.claimNonce,
          "x-vibode-thumbnail-content-token": job.contentToken,
        },
        body: Buffer.from(bytes),
        signal: AbortSignal.timeout(env.publishTimeoutMs),
      });
      const body = await response.json().catch(() => null) as { ok?: boolean; code?: string } | null;
      if (!response.ok || !body?.ok) return { ok: false, code: body?.code || "publish_failed" };
      return { ok: true };
    },
  };
}

function readJob(value: Record<string, unknown>): ClaimedJob | null {
  const jobId = text(value.jobId);
  const roomId = text(value.roomId);
  const versionId = text(value.versionId);
  const contentToken = text(value.contentToken);
  const claimNonce = text(value.claimNonce);
  const claimExpiresAt = text(value.claimExpiresAt);
  const accessToken = text(value.accessToken);
  const attemptCount = typeof value.attemptCount === "number" ? value.attemptCount : 0;
  if (!jobId || !roomId || !versionId || !contentToken || !claimNonce || !claimExpiresAt || !accessToken) {
    return null;
  }
  return { jobId, roomId, versionId, contentToken, claimNonce, claimExpiresAt, accessToken, attemptCount };
}

function text(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}
