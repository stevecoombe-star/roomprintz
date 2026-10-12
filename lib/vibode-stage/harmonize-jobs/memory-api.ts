import { createHash } from "node:crypto";

import {
  claimNextHarmonizeJob,
  completeHarmonizeJob,
  failHarmonizeJob,
  heartbeatHarmonizeJob,
  markHarmonizeProviderContact,
  type HarmonizeJobDatabase,
} from "./engine";
import { harmonizeOutputPath } from "./policy";
import { assessHarmonizeJobOutput } from "./output";
import type {
  HarmonizeWorkerApi,
  HarmonizeWorkerClaim,
  HarmonizeWorkerCompletion,
} from "./worker-api";

export function createMemoryHarmonizeWorkerApi(input: Readonly<{
  db: HarmonizeJobDatabase;
  composites: Map<string, Uint8Array>;
  outputs: Map<string, Uint8Array>;
  clock: { nowMs: number };
}>): HarmonizeWorkerApi {
  return {
    async claim() {
      const claimed = claimNextHarmonizeJob(input.db, input.clock.nowMs);
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
      return completeFromMemory(input, claim, completion);
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
): Promise<Readonly<{ ok: true; code: string }> | Readonly<{ ok: false; code: string }>> {
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
  if (completed.code === "completed") input.outputs.set(claim.jobId, completion.output);
  return completed;
}
