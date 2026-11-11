/**
 * In-memory twin of the generation SQL functions. Tests use this ledger.
 * It does not open a network connection.
 */

import type {
  ClaimedGeneration,
  GenerationCommands,
  PublicGenerationJob,
  TemporaryGenerationObject,
} from "./contracts";
import {
  applyGenerationObservation,
  attachGenerationInput,
  authorizeGenerationResubmit,
  bindGenerationTask,
  claimGeneration,
  discardGenerationCandidate,
  dropGenerationClaim,
  failGenerationBeforeProvider,
  failGenerationCreate,
  failGenerationOutput,
  linkGenerationSavedAsset,
  markGenerationAmbiguous,
  markGenerationNeedsReview,
  readGeneration,
  recordGenerationOutput,
  releaseExpiredGenerationHolds,
  reserveGeneration,
  settleGenerationRateLimit,
  type GenerationDatabase,
  type GenerationJob,
} from "./engine";
import { generationObjectAllowed } from "./objects";
import { pathOwnedBy } from "./output";
import { generationCandidateStillPreviewable } from "./preview-access";

const CLAIMABLE = new Set(["reserved", "submitting", "ambiguous", "running", "ingesting", "needs_review"]);

export function createMemoryGenerationCommands(
  db: GenerationDatabase,
  clock: { nowMs: number },
): GenerationCommands {
  return {
    async controls() {
      return { liveEnabled: db.controls.liveEnabled === true };
    },
    async reserve(input) {
      const reserved = reserveGeneration(db, input);
      if (!reserved.ok) return { ok: false, code: reserved.code };
      return { ok: true, created: reserved.created, job: publicJob(reserved.job) };
    },
    async attachInput(input) {
      const attached = attachGenerationInput(db, input);
      if (!attached.ok) return { ok: false, code: attached.code };
      return { ok: true };
    },
    async failBeforeProvider(input) {
      failGenerationBeforeProvider(db, input);
    },
    async readOwner(userId, jobId) {
      const job = readGeneration(db, userId, jobId);
      if (!job) return { ok: false, code: "not_found" };
      return { ok: true, job: publicJob(job) };
    },
    async previewSource(userId, jobId) {
      const job = readGeneration(db, userId, jobId);
      if (!job || job.status !== "ready" || !job.outputBucket || !job.outputObjectPath) {
        return { ok: false, code: "not_found" };
      }
      if (!generationObjectAllowed(job.outputBucket, job.outputObjectPath, userId)) {
        return { ok: false, code: "not_found" };
      }
      if (!generationCandidateStillPreviewable(job.outputExpiresAtMs, clock.nowMs)) {
        return { ok: false, code: "not_found" };
      }
      return { ok: true, bucket: job.outputBucket, path: job.outputObjectPath };
    },
    async readSaveSource(userId, jobId) {
      const job = readGeneration(db, userId, jobId);
      if (!job) return { ok: false, code: "not_found" };
      return {
        ok: true,
        status: job.status,
        savedAssetId: job.savedAssetId,
        bucket: job.outputBucket,
        path: job.outputObjectPath,
        sha256: job.outputSha256,
        byteSize: job.outputByteSize,
        expiresAtMs: job.outputExpiresAtMs,
      };
    },
    async linkSavedAsset(input) {
      const linked = linkGenerationSavedAsset(db, input);
      if (!linked.ok) return { ok: false, code: linked.code };
      return { ok: true, status: "saved", idempotent: linked.idempotent };
    },
    async discard(input) {
      const discarded = discardGenerationCandidate(db, input);
      if (!discarded.ok) return { ok: false, code: discarded.code };
      return {
        ok: true,
        status: discarded.job.status,
        providerCreditsRefunded: false,
      };
    },
    async adminAuthorize(jobId, duplicateChargeRiskAccepted) {
      const job = db.jobs.find((item) => item.jobId === jobId);
      if (!job) return { ok: false, code: "not_found" };
      const authorized = authorizeGenerationResubmit(db, {
        userId: job.userId,
        jobId,
        nowMs: clock.nowMs,
        duplicateChargeRiskAccepted,
      });
      if (!authorized.ok) return { ok: false, code: authorized.code };
      return { ok: true, status: authorized.job.status, duplicateChargeRisk: true };
    },
    async grantPaidSubmission(acknowledge) {
      if (acknowledge !== true) return { ok: false, code: "not_claimable" };
      if (db.controls.paidSubmissionsAuthorized >= 1) {
        return { ok: false, code: "allowance_closed" };
      }
      db.controls.paidSubmissionsAuthorized = 1;
      return {
        ok: true,
        authorized: db.controls.paidSubmissionsAuthorized,
        used: db.controls.paidSubmissionsUsed,
      };
    },
    async readOperator(jobId) {
      const job = db.jobs.find((item) => item.jobId === jobId);
      if (!job) return { ok: false, code: "not_found" };
      return {
        ok: true,
        job: {
          jobId: job.jobId,
          status: job.status,
          progress: job.progress,
          errorClass: job.errorClass,
          providerStatus: job.providerStatus,
          consumedCredits: job.consumedCredits,
          quotaState: job.quotaState,
          attemptCount: job.attemptCount,
          paidSubmissionsAuthorized: db.controls.paidSubmissionsAuthorized,
          paidSubmissionsUsed: db.controls.paidSubmissionsUsed,
        },
      };
    },
    async claimNext(submitAllowed, nowMs) {
      const job = db.jobs
        .filter((item) => CLAIMABLE.has(item.status))
        .filter((item) => item.claimExpiresAtMs == null || item.claimExpiresAtMs <= nowMs)
        .sort((left, right) => left.createdAtMs - right.createdAtMs)[0];
      if (!job) return { ok: true, outcome: "idle" };
      if (job.status === "reserved" && (submitAllowed !== true || db.controls.liveEnabled !== true)) {
        return { ok: true, outcome: "disabled" };
      }
      if (
        job.status === "reserved"
        && db.controls.paidSubmissionsUsed >= db.controls.paidSubmissionsAuthorized
      ) {
        return { ok: false, code: "submission_not_authorized" };
      }
      const claimed = claimGeneration(db, {
        userId: job.userId,
        jobId: job.jobId,
        nowMs,
        intent: job.status === "reserved" ? "submit" : "follow",
      });
      if (!claimed.ok || !claimed.job.claimNonce) return { ok: true, outcome: "idle" };
      const view = claimedView(claimed.job, claimed.purpose);
      if (!view) return { ok: false, code: "not_claimable" };
      if (claimed.purpose === "submit") db.controls.paidSubmissionsUsed += 1;
      return { ok: true, outcome: "claimed", claim: view };
    },
    async listInputs(userId, jobId) {
      return db.inputs
        .filter((item) => item.userId === userId && item.jobId === jobId && item.purgedAtMs == null)
        .sort((left, right) => left.ordinal - right.ordinal)
        .map((item) => ({
          slot: item.slot,
          bucket: item.storageBucket,
          path: item.storageObjectPath,
          sha256: item.sha256,
          mimeType: item.mimeType,
          byteSize: item.byteSize,
          widthPx: item.widthPx,
          heightPx: item.heightPx,
        }));
    },
    async bindTask(input) {
      const bound = bindGenerationTask(db, input);
      if (!bound.ok) return { ok: false, code: bound.code };
      return { ok: true, status: bound.job.status };
    },
    async markAmbiguous(input) {
      const marked = markGenerationAmbiguous(db, input);
      if (!marked.ok) return { ok: false, code: marked.code };
      return { ok: true, status: marked.job.status };
    },
    async failCreate(input) {
      const failed = failGenerationCreate(db, input);
      if (!failed.ok) return { ok: false, code: failed.code };
      return { ok: true, status: failed.job.status };
    },
    async settleRateLimit(input) {
      const settled = settleGenerationRateLimit(db, input);
      if (!settled.ok) return { ok: false, code: settled.code };
      return { ok: true, status: settled.job.status };
    },
    async dropClaim(input) {
      dropGenerationClaim(db, input);
    },
    async markNeedsReview(input) {
      const marked = markGenerationNeedsReview(db, input);
      if (!marked.ok) return { ok: false, code: marked.code };
      return { ok: true, status: marked.job.status };
    },
    async applyObservation(input) {
      const applied = applyGenerationObservation(db, input);
      if (!applied.ok) return { ok: false, code: applied.code };
      return { ok: true, status: applied.job.status, errorClass: applied.job.errorClass };
    },
    async recordOutput(input) {
      const recorded = recordGenerationOutput(db, input);
      if (!recorded.ok) return { ok: false, code: recorded.code };
      return { ok: true, status: recorded.job.status };
    },
    async failOutput(input) {
      const failed = failGenerationOutput(db, input);
      if (!failed.ok) return { ok: false, code: failed.code };
      return { ok: true, status: failed.job.status };
    },
    async sweep(nowMs) {
      releaseExpiredGenerationHolds(db, nowMs);
    },
    async listTemporaryObjects(limit) {
      const objects: TemporaryGenerationObject[] = [];
      for (const input of db.inputs) {
        if (input.purgedAtMs != null || input.expiresAtMs > clock.nowMs) continue;
        if (!generationObjectAllowed(input.storageBucket, input.storageObjectPath, input.userId)) continue;
        objects.push({
          kind: "input",
          bucket: input.storageBucket,
          path: input.storageObjectPath,
          jobId: input.jobId,
          userId: input.userId,
          slot: input.slot,
        });
      }
      for (const job of db.jobs) {
        if (job.savedAssetId || !job.outputBucket || !job.outputObjectPath) continue;
        if (job.status !== "discarded" && job.status !== "expired" && job.status !== "failed" && job.status !== "cancelled") {
          continue;
        }
        if (!generationObjectAllowed(job.outputBucket, job.outputObjectPath, job.userId)) continue;
        objects.push({
          kind: "candidate",
          bucket: job.outputBucket,
          path: job.outputObjectPath,
          jobId: job.jobId,
          userId: job.userId,
          slot: null,
        });
      }
      return objects.slice(0, Math.max(1, Math.min(100, limit)));
    },
    async markTemporaryPurged(object) {
      if (object.kind === "input") {
        const row = db.inputs.find((item) => item.jobId === object.jobId && item.slot === object.slot);
        if (!row || row.storageObjectPath !== object.path) return false;
        row.purgedAtMs = clock.nowMs;
        return true;
      }
      const job = db.jobs.find((item) => item.jobId === object.jobId);
      if (!job || job.savedAssetId || job.outputObjectPath !== object.path) return false;
      if (job.status !== "discarded" && job.status !== "expired" && job.status !== "failed" && job.status !== "cancelled") {
        return false;
      }
      if (!pathOwnedBy(object.path, job.userId) || object.path.includes("/assets/")) return false;
      job.outputBucket = null;
      job.outputObjectPath = null;
      job.outputSha256 = null;
      job.outputByteSize = null;
      return true;
    },
  };
}

function publicJob(job: GenerationJob): PublicGenerationJob {
  return {
    jobId: job.jobId,
    status: job.status,
    progress: job.progress,
    errorClass: job.errorClass,
    outputExpiresAt: job.outputExpiresAtMs == null ? null : new Date(job.outputExpiresAtMs).toISOString(),
  };
}

function claimedView(
  job: GenerationJob,
  purpose: "submit" | "poll" | "reconcile",
): ClaimedGeneration | null {
  if (!job.claimNonce) return null;
  return {
    userId: job.userId,
    jobId: job.jobId,
    purpose,
    claimNonce: job.claimNonce,
    operation: job.operation,
    providerTaskId: job.providerTaskId,
    providerTaskName: job.providerTaskName,
    providerContactedAtMs: job.providerContactedAtMs,
    settings: job.settings,
    imageSlots: job.imageSlots,
  };
}
