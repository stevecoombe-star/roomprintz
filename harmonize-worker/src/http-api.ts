import { isHarmonizeJobId } from "@/lib/vibode-stage/harmonize-jobs/job-id";
import {
  HARMONIZE_JOB_HEADER,
  HARMONIZE_NONCE_HEADER,
  HARMONIZE_WORKER_HEADER,
} from "@/lib/vibode-stage/harmonize-jobs/policy";
import type {
  HarmonizeHistoryWorkerView,
  HarmonizeWorkerApi,
  HarmonizeWorkerClaim,
  HarmonizeWorkerFailure,
} from "@/lib/vibode-stage/harmonize-jobs/worker-api";

export type HarmonizeWorkerProcessEnv = Readonly<{
  appBaseUrl: string;
  workerSecret: string;
  pollIntervalMs: number;
}>;

export function readHarmonizeWorkerProcessEnv(
  env: NodeJS.ProcessEnv = process.env,
  options: Readonly<{ requireProviderCredentials?: boolean }> = {},
): Readonly<{ ok: true; env: HarmonizeWorkerProcessEnv }> | Readonly<{ ok: false; missing: string[] }> {
  const missing: string[] = [];
  const appBaseUrl = env.VIBODE_APP_BASE_URL?.trim().replace(/\/$/, "") ?? "";
  const workerSecret = env.VIBODE_HARMONIZE_WORKER_SECRET?.trim() ?? "";
  if (!appBaseUrl) missing.push("VIBODE_APP_BASE_URL");
  if (!workerSecret) missing.push("VIBODE_HARMONIZE_WORKER_SECRET");
  if (options.requireProviderCredentials !== false && !env.GEMINI_API_KEY?.trim() && !env.GOOGLE_API_KEY?.trim()) {
    missing.push("GEMINI_API_KEY");
  }
  if (missing.length > 0) return { ok: false, missing };
  const pollIntervalMs = Number(env.VIBODE_HARMONIZE_POLL_INTERVAL_MS ?? "2000");
  return {
    ok: true,
    env: {
      appBaseUrl,
      workerSecret,
      pollIntervalMs: Number.isFinite(pollIntervalMs) && pollIntervalMs >= 250 ? pollIntervalMs : 2000,
    },
  };
}

export function createHttpHarmonizeWorkerApi(
  env: HarmonizeWorkerProcessEnv,
  options: Readonly<{ fetchImpl?: typeof fetch; jobId?: string | null }> = {},
): HarmonizeWorkerApi {
  const fetchImpl = options.fetchImpl ?? fetch;
  const requestedJobId = options.jobId && isHarmonizeJobId(options.jobId) ? options.jobId.toLowerCase() : null;
  if (options.jobId && !requestedJobId) {
    throw new Error("claim_job_invalid");
  }
  const headers = { [HARMONIZE_WORKER_HEADER]: env.workerSecret };
  const claimUrl = requestedJobId
    ? `${env.appBaseUrl}/api/internal/vibode-harmonize-jobs?action=claim-exact&jobId=${encodeURIComponent(requestedJobId)}`
    : `${env.appBaseUrl}/api/internal/vibode-harmonize-jobs?action=claim`;
  return {
    async claim() {
      const response = await fetchImpl(claimUrl, {
        method: "POST",
        headers,
      });
      const body = await response.json() as { ok?: boolean; job?: unknown };
      if (!response.ok || !body.ok) throw new Error("claim_failed");
      if (!body.job) return null;
      const claim = readClaim(body.job);
      if (!claim) throw new Error("claim_malformed");
      if (requestedJobId && claim.jobId !== requestedJobId) throw new Error("claim_mismatch");
      return claim;
    },
    async composite(claim) {
      const response = await fetchImpl(`${env.appBaseUrl}/api/internal/vibode-harmonize-jobs?action=composite`, {
        method: "GET",
        headers: claimHeaders(env.workerSecret, claim),
      });
      if (!response.ok) throw new Error("composite_missing");
      return new Uint8Array(await response.arrayBuffer());
    },
    async contact(claim) {
      return postJson(fetchImpl, env, "contact", claim);
    },
    async heartbeat(claim) {
      const response = await postJson(fetchImpl, env, "heartbeat", claim);
      return response.ok;
    },
    async complete(claim, completion) {
      const response = await fetchImpl(`${env.appBaseUrl}/api/internal/vibode-harmonize-jobs?action=complete`, {
        method: "PUT",
        headers: {
          ...claimHeaders(env.workerSecret, claim),
          "content-type": "image/jpeg",
          "x-vibode-harmonize-returned-model": completion.returnedModelId ?? "",
          "x-vibode-harmonize-provider-status": completion.providerStatus ?? "",
          "x-vibode-harmonize-http-status": String(completion.providerHttpStatus ?? ""),
          "x-vibode-harmonize-latency-ms": String(completion.latencyMs),
        },
        body: Buffer.from(completion.output),
      });
      const body = await response.json() as { ok?: boolean; code?: string; history?: unknown };
      if (!response.ok || !body.ok) return { ok: false, code: body.code || "complete_failed" };
      const history = readHistory(body.history);
      return history
        ? { ok: true, code: body.code || "completed", history }
        : { ok: true, code: body.code || "completed" };
    },
    async fail(claim, failure) {
      const response = await fetchImpl(`${env.appBaseUrl}/api/internal/vibode-harmonize-jobs?action=fail`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          jobId: claim.jobId,
          claimNonce: claim.claimNonce,
          code: failure.code,
          message: failure.message,
          retryable: failure.retryable,
          providerStatus: failure.providerStatus ?? null,
          providerHttpStatus: failure.providerHttpStatus ?? null,
          latencyMs: failure.latencyMs ?? null,
        } satisfies HarmonizeWorkerFailure & { jobId: string; claimNonce: string }),
      });
      const body = await response.json() as { ok?: boolean; code?: string };
      if (!response.ok || !body.ok) return { ok: false, code: body.code || "fail_failed" };
      return { ok: true, code: body.code || "failed" };
    },
  };
}

function claimHeaders(secret: string, claim: HarmonizeWorkerClaim): Record<string, string> {
  return {
    [HARMONIZE_WORKER_HEADER]: secret,
    [HARMONIZE_JOB_HEADER]: claim.jobId,
    [HARMONIZE_NONCE_HEADER]: claim.claimNonce,
  };
}

async function postJson(
  fetchImpl: typeof fetch,
  env: HarmonizeWorkerProcessEnv,
  action: "contact" | "heartbeat",
  claim: HarmonizeWorkerClaim,
): Promise<Readonly<{ ok: true; attemptId: string }> | Readonly<{ ok: false; code: string }>> {
  const response = await fetchImpl(`${env.appBaseUrl}/api/internal/vibode-harmonize-jobs?action=${action}`, {
    method: "POST",
    headers: {
      [HARMONIZE_WORKER_HEADER]: env.workerSecret,
      "content-type": "application/json",
    },
    body: JSON.stringify({ jobId: claim.jobId, claimNonce: claim.claimNonce }),
  });
  const body = await response.json() as { ok?: boolean; code?: string; attemptId?: string };
  if (!response.ok || !body.ok) return { ok: false, code: body.code || `${action}_failed` };
  return { ok: true, attemptId: body.attemptId || action };
}

function readClaim(value: unknown): HarmonizeWorkerClaim | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const jobId = text(row.jobId);
  const roomId = text(row.roomId);
  const claimNonce = text(row.claimNonce);
  const prompt = typeof row.prompt === "string" ? row.prompt : "";
  const promptSha256 = text(row.promptSha256);
  const compositeSha256 = text(row.compositeSha256);
  const compositeWidth = typeof row.compositeWidth === "number" ? row.compositeWidth : 0;
  const compositeHeight = typeof row.compositeHeight === "number" ? row.compositeHeight : 0;
  const requestedModelId = text(row.requestedModelId);
  if (!jobId || !roomId || !claimNonce || !prompt || !promptSha256 || !compositeSha256 || !requestedModelId) {
    return null;
  }
  return {
    jobId,
    roomId,
    claimNonce,
    prompt,
    promptSha256,
    compositeSha256,
    compositeWidth,
    compositeHeight,
    requestedModelId,
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readHistory(value: unknown): HarmonizeHistoryWorkerView | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const outcome = row.outcome;
  if (
    outcome !== "published"
    && outcome !== "already_published"
    && outcome !== "pending"
    && outcome !== "terminal"
    && outcome !== "ignored"
    && outcome !== "skipped"
  ) {
    return null;
  }
  return {
    outcome,
    code: typeof row.code === "string" ? row.code : null,
    activated: row.activated === true ? true : row.activated === false ? false : null,
  };
}
