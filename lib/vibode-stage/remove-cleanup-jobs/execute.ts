import { sha256Hex } from "@/lib/afc-v2-production/production-artifact-integrity";
import { REMOVE_CLEANUP_PROMPT_VERSION } from "@/lib/vibode-stage/remove-cleanup-contract";
import {
  REMOVE_CLEANUP_NBP_OUTPUT_MIME,
  assessRemoveCleanupCandidateBytes,
  removeCleanupNbpOutputConfig,
  type RemoveCleanupNbpResult,
} from "@/lib/vibode-stage/remove-cleanup-nbp.server";
import type { RemoveCleanupGenerationInputSnapshot } from "@/lib/vibode-stage/remove-cleanup-snapshot.server";

import { cleanupCandidatePath } from "./policy";
import type { CleanupControl } from "./runtime";
import { rehydrateCleanupSnapshot } from "./snapshot";
import type { CleanupClaim, CleanupCompleteInput } from "./types";

export type CleanupExecuteResult = Readonly<{
  outcome: "idle" | "recovered" | "succeeded" | "failed" | "stale";
  code: string | null;
  jobId: string | null;
  posts: number;
}>;

export type CleanupGenerate = (input: Readonly<{
  snapshot: RemoveCleanupGenerationInputSnapshot;
  signal: AbortSignal;
}>) => Promise<RemoveCleanupNbpResult>;

/**
 * One claimed job.
 *
 * Artifact hashes are checked before provider contact. Contact is marked
 * before the D2 adapter runs. If that marker commits and the POST never
 * starts, the job becomes terminal provider_uncertain. That can lose one
 * paid opportunity. It cannot send a second POST for the same contact.
 */
export async function executeCleanupClaim(input: Readonly<{
  control: CleanupControl;
  generate: CleanupGenerate;
  heartbeatIntervalMs?: number;
}>): Promise<CleanupExecuteResult> {
  const recovered = await recoverStoredCandidate(input.control);
  if (recovered) return recovered;
  const claim = await input.control.claim();
  if (!claim) return { outcome: "idle", code: null, jobId: null, posts: 0 };
  const generate = input.generate;
  let posts = 0;
  const controller = new AbortController();
  let lost = false;
  const timer = setInterval(() => {
    void input.control.heartbeat(claim.jobId, claim.claimNonce).then((ok) => {
      if (!ok) {
        lost = true;
        controller.abort();
      }
    }, () => undefined);
  }, input.heartbeatIntervalMs ?? 30_000);
  try {
    if (!(await input.control.heartbeat(claim.jobId, claim.claimNonce))) {
      return { outcome: "stale", code: "stale_claim", jobId: claim.jobId, posts };
    }
    const ready = await readFrozenInputs(input.control, claim);
    if (!ready.ok) {
      await input.control.fail(claim.jobId, claim.claimNonce, {
        code: ready.code,
        message: ready.message,
        retryable: ready.retryable,
      });
      return { outcome: "failed", code: ready.code, jobId: claim.jobId, posts };
    }
    const contact = await input.control.contact(claim.jobId, claim.claimNonce);
    if (!contact.ok) {
      if (contact.code === "already_contacted") {
        await input.control.fail(claim.jobId, claim.claimNonce, {
          code: "provider_uncertain",
          message: "Provider contact was already recorded.",
          retryable: false,
        });
      }
      return { outcome: "failed", code: contact.code, jobId: claim.jobId, posts };
    }
    let generated: RemoveCleanupNbpResult;
    try {
      generated = await generate({ snapshot: ready.snapshot, signal: controller.signal });
      posts = generated.postCount;
    } catch {
      await input.control.fail(claim.jobId, claim.claimNonce, {
        code: "provider_uncertain",
        message: "Provider contact ended without a confirmed result.",
        retryable: false,
      });
      return { outcome: "failed", code: "provider_uncertain", jobId: claim.jobId, posts: 1 };
    }
    if (!generated.ok) {
      await input.control.fail(claim.jobId, claim.claimNonce, {
        code: uncertainOrRejected(generated.code, generated.phase),
        message: generated.message,
        retryable: false,
        providerStatus: generated.providerStatus,
        providerHttpStatus: generated.httpStatus,
      });
      return { outcome: "failed", code: generated.code, jobId: claim.jobId, posts: generated.postCount };
    }
    if (generated.stageRegistration !== "not-assessed") {
      await input.control.fail(claim.jobId, claim.claimNonce, {
        code: "unexpected_output",
        message: "Candidate registration was not left unassessed.",
        retryable: false,
      });
      return { outcome: "failed", code: "unexpected_output", jobId: claim.jobId, posts };
    }
    const bytes = generated.outputBytes();
    const output = completionFrom(claim, generated, sha256Hex(bytes));
    if (output.outputSha256 !== generated.outputSha256) {
      await input.control.fail(claim.jobId, claim.claimNonce, {
        code: "unexpected_output",
        message: "Candidate bytes did not match the returned hash.",
        retryable: false,
      });
      return { outcome: "failed", code: "unexpected_output", jobId: claim.jobId, posts };
    }
    const path = cleanupCandidatePath(claim.roomId, claim.jobId);
    if (await input.control.artifacts.put(path, bytes, "image/jpeg") !== "ok") {
      await input.control.fail(claim.jobId, claim.claimNonce, {
        code: "provider_uncertain",
        message: "The candidate could not be stored.",
        retryable: false,
      });
      return { outcome: "failed", code: "provider_uncertain", jobId: claim.jobId, posts };
    }
    if (lost || !(await input.control.heartbeat(claim.jobId, claim.claimNonce))) {
      const settled = await input.control.settle(claim.jobId, output);
      return settled.ok
        ? { outcome: "succeeded", code: settled.code, jobId: claim.jobId, posts }
        : { outcome: "stale", code: "stale_claim", jobId: claim.jobId, posts };
    }
    const completed = await input.control.complete(claim.jobId, claim.claimNonce, output);
    if (completed.ok) return { outcome: "succeeded", code: completed.code, jobId: claim.jobId, posts };
    const settled = await input.control.settle(claim.jobId, output);
    return settled.ok
      ? { outcome: "succeeded", code: settled.code, jobId: claim.jobId, posts }
      : { outcome: "stale", code: completed.code, jobId: claim.jobId, posts };
  } finally {
    clearInterval(timer);
  }
}

export async function recoverStoredCandidate(control: CleanupControl): Promise<CleanupExecuteResult | null> {
  const rows = await control.recoverable();
  for (const job of rows) {
    const path = cleanupCandidatePath(job.roomId, job.id);
    const bytes = await control.artifacts.get(path);
    if (!bytes) continue;
    const assessed = await assessRemoveCleanupCandidateBytes(bytes, {
      type: "image",
      mime_type: REMOVE_CLEANUP_NBP_OUTPUT_MIME,
      aspect_ratio: job.aspectRatioFamily,
      image_size: "2K",
    });
    if (!assessed.ok) continue;
    const settled = await control.settle(job.id, {
      outputSha256: assessed.sha256,
      outputWidth: assessed.width,
      outputHeight: assessed.height,
      returnedModelId: job.returnedModelId,
      interactionId: job.interactionId,
      usage: job.usage,
      providerStatus: job.providerStatus,
      providerHttpStatus: job.providerHttpStatus,
      latencyMs: job.latencyMs ?? 0,
    });
    if (settled.ok) return { outcome: "recovered", code: settled.code, jobId: job.id, posts: 0 };
  }
  return null;
}

async function readFrozenInputs(
  control: CleanupControl,
  claim: CleanupClaim,
): Promise<
  | Readonly<{ ok: true; snapshot: RemoveCleanupGenerationInputSnapshot }>
  | Readonly<{ ok: false; code: string; message: string; retryable: boolean }>
> {
  if (claim.promptVersion !== REMOVE_CLEANUP_PROMPT_VERSION) {
    return { ok: false, code: "invalid_artifact", message: "Frozen prompt version is not supported.", retryable: false };
  }
  const [original, overlay, promptBytes, masks] = await Promise.all([
    control.artifacts.get(claim.originalPath),
    control.artifacts.get(claim.overlayPath),
    control.artifacts.get(claim.promptPath),
    control.artifacts.get(claim.masksPath),
  ]);
  if (!original || !overlay || !promptBytes || !masks) {
    return { ok: false, code: "worker_interrupted", message: "Frozen inputs were not readable.", retryable: true };
  }
  const prompt = new TextDecoder().decode(promptBytes);
  if (
    sha256Hex(original) !== claim.originalSha256
    || sha256Hex(overlay) !== claim.overlaySha256
    || sha256Hex(promptBytes) !== claim.promptSha256
    || sha256Hex(masks) !== claim.maskManifestSha256
  ) {
    return { ok: false, code: "invalid_artifact", message: "Frozen input hash did not match.", retryable: false };
  }
  const snapshot = rehydrateCleanupSnapshot(claim, { original, overlay, prompt, masks });
  const output = removeCleanupNbpOutputConfig(snapshot, "2K");
  if (!output || output.aspectRatioFamily !== claim.aspectRatioFamily) {
    return { ok: false, code: "invalid_artifact", message: "Frozen aspect family is not admissible.", retryable: false };
  }
  return { ok: true, snapshot };
}

function completionFrom(
  claim: CleanupClaim,
  generated: Extract<RemoveCleanupNbpResult, { ok: true }>,
  outputSha256: string,
): CleanupCompleteInput {
  return {
    outputSha256,
    outputWidth: generated.outputWidth,
    outputHeight: generated.outputHeight,
    returnedModelId: generated.returnedModel,
    interactionId: generated.interactionId,
    usage: generated.usage,
    providerStatus: generated.providerStatus,
    providerHttpStatus: generated.httpStatus,
    latencyMs: generated.latencyMs,
  };
}

function uncertainOrRejected(_code: string, phase: "before_contact" | "provider_rejected" | "provider_uncertain"): string {
  return phase === "provider_rejected" ? "provider_rejected" : "provider_uncertain";
}
