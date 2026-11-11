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
  commitGenerationSubmission,
  prepareGenerationLease,
  resolveGenerationProviderCredits,
  reviewGenerationContactedInput,
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
    async failPreparedInput(input) {
      const failed = failGenerationBeforeProvider(db, input);
      if (!failed.ok) return { ok: false, code: failed.code };
      return { ok: true, status: failed.job.status };
    },
    async commitSubmission(input) {
      const committed = commitGenerationSubmission(db, input);
      if (!committed.ok || !committed.job.claimNonce) return { ok: false, code: committed.ok ? "not_claimable" : committed.code };
      return { ok: true, claimNonce: committed.job.claimNonce, status: committed.job.status };
    },
    async reviewContactedInput(input) {
      const reviewed = reviewGenerationContactedInput(db, input);
      if (!reviewed.ok) return { ok: false, code: reviewed.code };
      return { ok: true, status: reviewed.job.status };
    },
    async resolveProviderCredits(input) {
      const resolved = resolveGenerationProviderCredits(db, input);
      if (!resolved.ok) return resolved;
      return {
        ok: true,
        status: resolved.status,
        consumedCredits: resolved.consumedCredits,
        idempotent: resolved.idempotent,
      };
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
      const claimed = job.status === "reserved"
        ? prepareGenerationLease(db, { userId: job.userId, jobId: job.jobId, nowMs })
        : claimGeneration(db, {
          userId: job.userId,
          jobId: job.jobId,
          nowMs,
          intent: "follow",
        });
      if (!claimed.ok) {
        if (claimed.code === "submission_not_authorized") return { ok: false, code: claimed.code };
        return { ok: true, outcome: "idle" };
      }
      if (!claimed.job.claimNonce) return { ok: true, outcome: "idle" };
      const view = claimedView(claimed.job, claimed.purpose);
      if (!view) return { ok: false, code: "not_claimable" };
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
      return (await this.listCleanupBatch(limit)).objects;
    },
    async listCleanupBatch(limit) {
      return selectCleanupBatch(db, clock.nowMs, limit);
    },
    async markTemporaryPurged(object) {
      if (object.kind === "input") {
        const row = db.inputs.find((item) => item.jobId === object.jobId && item.slot === object.slot && item.userId === object.userId);
        const job = db.jobs.find((item) => item.jobId === object.jobId && item.userId === object.userId);
        if (!row || !job || row.storageObjectPath !== object.path || row.expiresAtMs > clock.nowMs) return false;
        if (!INPUT_PURGE_STATUSES.has(job.status)) return false;
        if (!generationObjectAllowed(row.storageBucket, row.storageObjectPath, row.userId)) return false;
        row.purgedAtMs = clock.nowMs;
        return true;
      }
      const job = db.jobs.find((item) => item.jobId === object.jobId && item.userId === object.userId);
      if (!job || !candidatePurgeable(job) || job.outputObjectPath !== object.path) return false;
      job.outputBucket = null;
      job.outputObjectPath = null;
      job.outputSha256 = null;
      job.outputByteSize = null;
      return true;
    },
  };
}

const INPUT_PURGE_STATUSES = new Set(["ready", "saved", "failed", "discarded", "expired", "cancelled"]);
const CANDIDATE_TERMINAL_STATUSES = new Set(["discarded", "expired", "failed", "cancelled"]);
const CLEANUP_BATCH_LIMIT = 50;

function selectCleanupBatch(db: GenerationDatabase, nowMs: number, limit: number): {
  objects: TemporaryGenerationObject[];
  retainedForReview: number;
} {
  const bounded = limit < 1 || limit > CLEANUP_BATCH_LIMIT ? CLEANUP_BATCH_LIMIT : limit;
  const objects: TemporaryGenerationObject[] = [];
  let retainedForReview = 0;
  for (const input of db.inputs) {
    if (input.purgedAtMs != null || input.expiresAtMs > nowMs) continue;
    const job = db.jobs.find((item) => item.jobId === input.jobId && item.userId === input.userId);
    if (!job || !generationObjectAllowed(input.storageBucket, input.storageObjectPath, input.userId)) continue;
    if (job.status === "needs_review") {
      retainedForReview += 1;
      continue;
    }
    if (!INPUT_PURGE_STATUSES.has(job.status)) continue;
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
    if (!candidatePurgeable(job)) continue;
    objects.push({
      kind: "candidate",
      bucket: job.outputBucket ?? "",
      path: job.outputObjectPath ?? "",
      jobId: job.jobId,
      userId: job.userId,
      slot: null,
    });
  }
  return { objects: objects.slice(0, bounded), retainedForReview };
}

function candidatePurgeable(job: GenerationJob): boolean {
  if (!job.outputBucket || !job.outputObjectPath) return false;
  if (!generationObjectAllowed(job.outputBucket, job.outputObjectPath, job.userId)) return false;
  if (job.outputObjectPath.includes("/assets/")) return false;
  if (job.status === "saved" && job.savedAssetId) return true;
  return job.savedAssetId == null && CANDIDATE_TERMINAL_STATUSES.has(job.status);
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
  purpose: "prepare" | "submit" | "poll" | "reconcile",
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
    createdAtMs: job.createdAtMs,
    errorClass: job.errorClass,
    settings: job.settings,
    imageSlots: job.imageSlots,
  };
}
