import { createHash, randomUUID } from "node:crypto";

import {
  claimNextHarmonizeJob,
  completeHarmonizeJob,
  failHarmonizeJob,
  heartbeatHarmonizeJob,
  markHarmonizeProviderContact,
  type HarmonizeJobDatabase,
} from "./engine";
import {
  createHarmonizeHistoryObjectStore,
  publicationJobFromRow,
  publishPreparedHarmonizeHistory,
  type HarmonizeHistoryPublishResult,
} from "./history-publication";
import { VIBODE_HARMONIZE_BUCKET, VIBODE_HISTORY_BUCKET, harmonizeHistoryObjectPath, harmonizeOutputPath } from "./policy";
import { assessHarmonizeJobOutput } from "./output";
import type {
  HarmonizeHistoryWorkerView,
  HarmonizeWorkerApi,
  HarmonizeWorkerClaim,
  HarmonizeWorkerCompletion,
} from "./worker-api";

export function createMemoryHarmonizeWorkerApi(input: Readonly<{
  db: HarmonizeJobDatabase;
  composites: Map<string, Uint8Array>;
  outputs: Map<string, Uint8Array>;
  clock: { nowMs: number };
  jobId?: string | null;
  publishHistory?: (claim: HarmonizeWorkerClaim) => Promise<HarmonizeHistoryWorkerView>;
}>): HarmonizeWorkerApi {
  const history = createHarmonizeHistoryObjectStore();
  const thumbnails = new Set<string>();
  return {
    async claim() {
      const claimed = claimNextHarmonizeJob(input.db, input.clock.nowMs, input.jobId ?? null);
      if (!claimed) return null;
      return {
        jobId: claimed.jobId,
        roomId: claimed.roomId,
        claimNonce: claimed.claimNonce,
        prompt: claimed.prompt,
        promptSha256: claimed.promptSha256,
        compositeSha256: claimed.compositeSha256,
        compositeWidth: claimed.compositeWidth,
        compositeHeight: claimed.compositeHeight,
        requestedModelId: claimed.requestedModelId,
      };
    },
    async composite(claim) {
      const bytes = input.composites.get(claim.jobId);
      if (!bytes) throw new Error("composite_missing");
      return bytes;
    },
    async contact(claim) {
      return markHarmonizeProviderContact(input.db, {
        jobId: claim.jobId,
        claimNonce: claim.claimNonce,
        nowMs: input.clock.nowMs,
      });
    },
    async heartbeat(claim) {
      return heartbeatHarmonizeJob(input.db, {
        jobId: claim.jobId,
        claimNonce: claim.claimNonce,
        nowMs: input.clock.nowMs,
      });
    },
    async complete(claim, completion) {
      const completed = await completeFromMemory(input, claim, completion);
      if (!completed.ok) return completed;
      if (completed.code === "completed") history.seed(VIBODE_HARMONIZE_BUCKET, completed.outputPath, completion.output);
      try {
        const published = input.publishHistory
          ? await input.publishHistory(claim)
          : await publishMemoryHistory(input.db, history, thumbnails, claim.jobId);
        return { ok: true as const, code: completed.code, history: published };
      } catch {
        return {
          ok: true as const,
          code: completed.code,
          history: { outcome: "pending" as const, code: "publication_failed", activated: null },
        };
      }
    },
    async fail(claim, failure) {
      const failed = failHarmonizeJob(input.db, {
        jobId: claim.jobId,
        claimNonce: claim.claimNonce,
        nowMs: input.clock.nowMs,
        code: failure.code,
        message: failure.message,
        retryable: failure.retryable,
        providerStatus: failure.providerStatus,
        providerHttpStatus: failure.providerHttpStatus,
        latencyMs: failure.latencyMs,
      });
      if (!failed.ok) return failed;
      return { ok: true, code: failed.disposition };
    },
  };
}

async function completeFromMemory(
  input: Readonly<{
    db: HarmonizeJobDatabase;
    outputs: Map<string, Uint8Array>;
    clock: { nowMs: number };
  }>,
  claim: HarmonizeWorkerClaim,
  completion: HarmonizeWorkerCompletion,
): Promise<
  | Readonly<{ ok: true; code: string; outputPath: string }>
  | Readonly<{ ok: false; code: string }>
> {
  const assessed = await assessHarmonizeJobOutput(
    completion.output,
    claim.compositeWidth,
    claim.compositeHeight,
  );
  if (!assessed.ok) return { ok: false, code: "unexpected_output" };
  const digest = createHash("sha256").update(completion.output).digest("hex");
  if (digest !== assessed.sha256) return { ok: false, code: "unexpected_output" };
  const completed = completeHarmonizeJob(input.db, {
    jobId: claim.jobId,
    claimNonce: claim.claimNonce,
    nowMs: input.clock.nowMs,
    outputSha256: assessed.sha256,
    outputMime: "image/jpeg",
    outputWidth: assessed.width,
    outputHeight: assessed.height,
    outputPath: harmonizeOutputPath(claim.roomId, claim.jobId, claim.claimNonce),
    returnedModelId: completion.returnedModelId,
    providerStatus: completion.providerStatus,
    providerHttpStatus: completion.providerHttpStatus,
    latencyMs: completion.latencyMs,
  });
  if (!completed.ok) return completed;
  const outputPath = harmonizeOutputPath(claim.roomId, claim.jobId, claim.claimNonce);
  if (completed.code === "completed") input.outputs.set(claim.jobId, completion.output);
  return { ok: true, code: completed.code, outputPath };
}

async function publishMemoryHistory(
  db: HarmonizeJobDatabase,
  storage: ReturnType<typeof createHarmonizeHistoryObjectStore>,
  thumbnails: Set<string>,
  jobId: string,
): Promise<HarmonizeHistoryWorkerView> {
  const job = db.jobs.find((entry) => entry.id === jobId);
  if (!job) return { outcome: "ignored", code: "not_found", activated: null };
  const published = await publishPreparedHarmonizeHistory({
    job: publicationJobFromRow(job),
    storage,
    publish: (args) => memoryHistoryRpc(db, args),
    thumbnail: async ({ assetId }) => {
      if (thumbnails.has(assetId)) return "present";
      thumbnails.add(assetId);
      return "created";
    },
  });
  return { outcome: published.outcome, code: published.code, activated: published.activated === true };
}

function memoryHistoryRpc(
  db: HarmonizeJobDatabase,
  args: Readonly<{ jobId: string; outputSha256: string; historyBucket: string; historyPath: string }>,
): HarmonizeHistoryPublishResult {
  const job = db.jobs.find((entry) => entry.id === args.jobId);
  if (!job) return { ok: false, code: "not_found" };
  if (job.historyState === "published") {
    return {
      ok: true,
      code: "already_published",
      assetId: job.outputAssetId,
      generationRunId: null,
      activated: false,
    };
  }
  if (job.historyState === "unavailable") return { ok: false, code: "not_publishable" };
  if (job.status !== "succeeded") return { ok: false, code: "not_succeeded" };
  if (
    !job.outputSha256
    || !job.outputPath
    || !job.outputBucket
    || job.outputMime !== "image/jpeg"
    || job.outputWidth == null
    || job.outputHeight == null
    || !job.backdropKind
    || !Array.isArray(job.sceneObjects)
  ) {
    job.historyState = "unavailable";
    return { ok: false, code: "not_publishable" };
  }
  if (args.outputSha256 !== job.outputSha256) return { ok: false, code: "output_mismatch" };
  if (args.historyBucket !== VIBODE_HISTORY_BUCKET || args.historyPath !== harmonizeHistoryObjectPath(job.roomId, job.id)) {
    return { ok: false, code: "invalid_history_path" };
  }
  const assetId = randomUUID();
  job.historyState = "published";
  job.outputAssetId = assetId;
  return {
    ok: true,
    code: "published",
    assetId,
    generationRunId: randomUUID(),
    activated: false,
  };
}
