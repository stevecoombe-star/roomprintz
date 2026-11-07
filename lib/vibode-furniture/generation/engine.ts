/**
 * In-memory generation ledger. It mirrors the local migration's reservation,
 * lease, and retry rules. A create that already contacted Meshy is never
 * submitted again after an ambiguous create. Read-only reconciliation may
 * bind a task Meshy already created. An inconclusive list becomes
 * needs_review. A later POST requires an operator to accept the
 * duplicate-charge risk. An HTTP timeout is not proof that Meshy created nothing.
 */

import { randomUUID } from "node:crypto";

import { isUuidLike } from "@/lib/vibode-stage/asset-id";
import { PERSONAL_FURNITURE_BUCKET, PERSONAL_FURNITURE_GLB_MAX_BYTES } from "@/lib/vibode-furniture/asset-id";
import {
  FURNITURE_VIEW_SLOT_ORDER,
  type FurniturePhotoMime,
  type FurnitureViewSlot,
} from "@/lib/vibode-furniture/generator/images";
import {
  generatorSettingsIssues,
  type FurnitureGeneratorSettings,
} from "@/lib/vibode-furniture/generator/settings";

import { estimateMeshy71Credits, type MeshyGenerationOperation } from "./credits";
import { imageExtension } from "./images";
import { generationCandidatePath, generationInputPath, pathOwnedBy } from "./output";
import {
  GENERATION_CANDIDATE_TTL_MS,
  GENERATION_INPUT_BUCKET,
  GENERATION_INPUT_TTL_MS,
  MESHY_ABSENCE_RECONCILE_WAIT_MS,
  MESHY_CLAIM_LEASE_MS,
  MESHY_MAX_SUBMIT_ATTEMPTS,
  MESHY_MIN_OVERALL_WAIT_MS,
  MESHY_PROVIDER_ID,
  MESHY_TEST_CREDIT_CEILING,
} from "./policy";
import { meshyTaskNameForJob } from "./payload";
import type { MeshyTaskStatus } from "./meshy-task";

export const ACTIVE_GENERATION_STATUSES = [
  "reserved",
  "submitting",
  "ambiguous",
  "running",
  "ingesting",
  "ready",
  "needs_review",
] as const;

export type GenerationStatus =
  | (typeof ACTIVE_GENERATION_STATUSES)[number]
  | "failed"
  | "saved"
  | "discarded"
  | "expired"
  | "cancelled";

export type QuotaState = "reserved" | "reconciled" | "released";

export type GenerationErrorClass =
  | "provider_rejected"
  | "provider_payment"
  | "provider_auth"
  | "provider_forbidden"
  | "rate_limited"
  | "ambiguous_timeout"
  | "provider_failed"
  | "invalid_output"
  | "oversized_output"
  | "ingest_failed"
  | "input_storage_failed"
  | "credit_unreported"
  | "needs_review"
  | "discarded"
  | "expired"
  | "cancelled";

export type GenerationJob = {
  jobId: string;
  userId: string;
  provider: typeof MESHY_PROVIDER_ID;
  aiModel: "meshy-7.1";
  operation: MeshyGenerationOperation;
  idempotencyKey: string;
  requestSha256: string;
  settings: FurnitureGeneratorSettings;
  imageSlots: FurnitureViewSlot[];
  providerTaskName: string;
  providerTaskId: string | null;
  providerStatus: MeshyTaskStatus | null;
  status: GenerationStatus;
  progress: number;
  claimNonce: string | null;
  claimExpiresAtMs: number | null;
  attemptCount: number;
  providerContactedAtMs: number | null;
  absenceReconciledAtMs: number | null;
  resubmitAuthorized: boolean;
  quotaState: QuotaState;
  reservedCredits: number;
  consumedCredits: number | null;
  outputBucket: string | null;
  outputObjectPath: string | null;
  outputSha256: string | null;
  outputByteSize: number | null;
  outputExpiresAtMs: number | null;
  errorClass: GenerationErrorClass | null;
  errorCode: string | null;
  savedAssetId: string | null;
  createdAtMs: number;
  updatedAtMs: number;
};

export type GenerationInputRecord = {
  jobId: string;
  userId: string;
  slot: FurnitureViewSlot;
  ordinal: number;
  storageBucket: typeof GENERATION_INPUT_BUCKET;
  storageObjectPath: string;
  sha256: string;
  byteSize: number;
  mimeType: FurniturePhotoMime;
  widthPx: number;
  heightPx: number;
  expiresAtMs: number;
  purgedAtMs: number | null;
};

export type GenerationControls = {
  liveEnabled: boolean;
  creditCeiling: number;
  creditsReserved: number;
  creditsConsumed: number;
};

export type GenerationDatabase = {
  controls: GenerationControls;
  jobs: GenerationJob[];
  inputs: GenerationInputRecord[];
};

export type ReserveInput = {
  userId: string;
  jobId: string;
  idempotencyKey: string;
  requestSha256: string;
  operation: MeshyGenerationOperation;
  settings: FurnitureGeneratorSettings;
  imageSlots: readonly FurnitureViewSlot[];
  reservedCredits: number;
  nowMs: number;
};

export type ReserveResult =
  | { ok: true; created: boolean; job: GenerationJob }
  | { ok: false; code: "disabled" | "unsupported_settings" | "quota_exhausted" | "concurrency_limited" | "idempotency_conflict" | "invalid_input" };

export type ClaimResult =
  | { ok: true; purpose: "submit" | "poll" | "reconcile"; job: GenerationJob }
  | { ok: false; code: "not_found" | "lease_held" | "not_claimable" | "needs_reconciliation" };

export type MutationResult =
  | { ok: true; job: GenerationJob }
  | { ok: false; code: "not_found" | "lease_held" | "not_claimable" | "task_immutable" | "needs_reconciliation" };

const KEY = /^[a-z0-9-]{8,80}$/;
const SHA = /^[a-f0-9]{64}$/;

export function createGenerationDatabase(): GenerationDatabase {
  return {
    controls: {
      liveEnabled: false,
      creditCeiling: MESHY_TEST_CREDIT_CEILING,
      creditsReserved: 0,
      creditsConsumed: 0,
    },
    jobs: [],
    inputs: [],
  };
}

export function reserveGeneration(db: GenerationDatabase, input: ReserveInput): ReserveResult {
  if (!isUuidLike(input.userId) || !isUuidLike(input.jobId) || !KEY.test(input.idempotencyKey) || !SHA.test(input.requestSha256)) {
    return { ok: false, code: "invalid_input" };
  }
  const existing = db.jobs.find((job) => job.userId === input.userId && job.idempotencyKey === input.idempotencyKey);
  if (existing) {
    if (existing.requestSha256 !== input.requestSha256) return { ok: false, code: "idempotency_conflict" };
    return { ok: true, created: false, job: existing };
  }
  const mode = input.operation === "multi-image-to-3d" ? "multi" : "single";
  if (input.operation !== "image-to-3d" && input.operation !== "multi-image-to-3d") {
    return { ok: false, code: "unsupported_settings" };
  }
  if (!slotsMatchOperation(input.operation, input.imageSlots)) return { ok: false, code: "unsupported_settings" };
  if (generatorSettingsIssues(input.settings, mode).length > 0) return { ok: false, code: "unsupported_settings" };
  const estimate = estimateMeshy71Credits(input.settings, input.operation);
  if (estimate == null || estimate !== input.reservedCredits) return { ok: false, code: "unsupported_settings" };
  releaseExpiredGenerationHolds(db, input.nowMs);
  if (!db.controls.liveEnabled) return { ok: false, code: "disabled" };
  if (db.jobs.some((job) => isActive(job.status))) return { ok: false, code: "concurrency_limited" };
  if (db.controls.creditsReserved + db.controls.creditsConsumed + estimate > db.controls.creditCeiling) {
    return { ok: false, code: "quota_exhausted" };
  }
  const taskName = meshyTaskNameForJob(input.jobId);
  if (!taskName) return { ok: false, code: "invalid_input" };
  const job: GenerationJob = {
    jobId: input.jobId,
    userId: input.userId,
    provider: MESHY_PROVIDER_ID,
    aiModel: "meshy-7.1",
    operation: input.operation,
    idempotencyKey: input.idempotencyKey,
    requestSha256: input.requestSha256,
    settings: { ...input.settings },
    imageSlots: [...input.imageSlots],
    providerTaskName: taskName,
    providerTaskId: null,
    providerStatus: null,
    status: "reserved",
    progress: 0,
    claimNonce: null,
    claimExpiresAtMs: null,
    attemptCount: 0,
    providerContactedAtMs: null,
    absenceReconciledAtMs: null,
    resubmitAuthorized: false,
    quotaState: "reserved",
    reservedCredits: estimate,
    consumedCredits: null,
    outputBucket: null,
    outputObjectPath: null,
    outputSha256: null,
    outputByteSize: null,
    outputExpiresAtMs: null,
    errorClass: null,
    errorCode: null,
    savedAssetId: null,
    createdAtMs: input.nowMs,
    updatedAtMs: input.nowMs,
  };
  db.jobs.push(job);
  db.controls.creditsReserved += estimate;
  return { ok: true, created: true, job };
}

export function readGeneration(db: GenerationDatabase, userId: string, jobId: string): GenerationJob | null {
  return db.jobs.find((job) => job.jobId === jobId && job.userId === userId) ?? null;
}

export function claimGeneration(
  db: GenerationDatabase,
  input: { userId: string; jobId: string; nowMs: number; intent: "submit" | "follow" },
): ClaimResult {
  const job = readGeneration(db, input.userId, input.jobId);
  if (!job) return { ok: false, code: "not_found" };
  if (leaseFresh(job, input.nowMs)) return { ok: false, code: "lease_held" };
  if (input.intent === "follow" && job.status === "reserved") return { ok: false, code: "not_claimable" };
  if (job.status === "needs_review") {
    if (input.intent !== "follow") return { ok: false, code: "not_claimable" };
    hold(job, input.nowMs);
    return { ok: true, purpose: "reconcile", job };
  }
  if (job.providerTaskId && (job.status === "running" || job.status === "ingesting")) {
    hold(job, input.nowMs);
    return { ok: true, purpose: "poll", job };
  }
  if (job.status === "submitting" || job.status === "ambiguous") {
    job.status = "ambiguous";
    job.errorClass = job.errorClass ?? "ambiguous_timeout";
    job.providerStatus = null;
    hold(job, input.nowMs);
    touch(job, input.nowMs);
    return { ok: true, purpose: "reconcile", job };
  }
  if (job.status !== "reserved" || input.intent !== "submit") return { ok: false, code: "not_claimable" };
  if (job.attemptCount >= MESHY_MAX_SUBMIT_ATTEMPTS) return { ok: false, code: "not_claimable" };
  if (job.attemptCount > 0 && !job.resubmitAuthorized) return { ok: false, code: "not_claimable" };
  job.resubmitAuthorized = false;
  job.attemptCount += 1;
  job.providerContactedAtMs = input.nowMs;
  job.absenceReconciledAtMs = null;
  job.status = "submitting";
  job.errorClass = null;
  job.errorCode = null;
  hold(job, input.nowMs);
  touch(job, input.nowMs);
  return { ok: true, purpose: "submit", job };
}

export function markGenerationAmbiguous(
  db: GenerationDatabase,
  input: { userId: string; jobId: string; claimNonce: string; nowMs: number; errorCode: string },
): MutationResult {
  const job = ownedLease(db, input);
  if (!job.ok) return job;
  if (job.job.status !== "submitting" || job.job.providerTaskId) return { ok: false, code: "not_claimable" };
  job.job.status = "ambiguous";
  job.job.errorClass = "ambiguous_timeout";
  job.job.errorCode = input.errorCode.slice(0, 80);
  releaseClaim(job.job);
  touch(job.job, input.nowMs);
  return { ok: true, job: job.job };
}

export function bindGenerationTask(
  db: GenerationDatabase,
  input: { userId: string; jobId: string; claimNonce: string; nowMs: number; providerTaskId: string; providerStatus: MeshyTaskStatus },
): MutationResult {
  const job = ownedLease(db, input);
  if (!job.ok) return job;
  if (job.job.status !== "submitting" && job.job.status !== "ambiguous" && job.job.status !== "needs_review") {
    return { ok: false, code: "not_claimable" };
  }
  if (!/^[A-Za-z0-9-]{8,80}$/.test(input.providerTaskId)) return { ok: false, code: "not_claimable" };
  if (job.job.providerTaskId && job.job.providerTaskId !== input.providerTaskId) {
    return { ok: false, code: "task_immutable" };
  }
  const taken = db.jobs.some((other) => other.jobId !== job.job.jobId && other.providerTaskId === input.providerTaskId);
  if (taken) return { ok: false, code: "task_immutable" };
  job.job.providerTaskId = input.providerTaskId;
  job.job.providerStatus = input.providerStatus;
  job.job.status = "running";
  job.job.progress = input.providerStatus === "SUCCEEDED" ? 100 : job.job.progress;
  if (job.job.errorClass === "ambiguous_timeout" || job.job.errorClass === "needs_review") job.job.errorClass = null;
  job.job.resubmitAuthorized = false;
  releaseClaim(job.job);
  touch(job.job, input.nowMs);
  return { ok: true, job: job.job };
}

export function markGenerationNeedsReview(
  db: GenerationDatabase,
  input: {
    userId: string;
    jobId: string;
    claimNonce: string;
    nowMs: number;
    reason: "list_absent" | "list_incomplete";
  },
): MutationResult {
  const job = ownedLease(db, input);
  if (!job.ok) return job;
  const row = job.job;
  if (row.status === "needs_review" && !row.providerTaskId) {
    releaseClaim(row);
    touch(row, input.nowMs);
    return { ok: true, job: row };
  }
  if (row.status !== "ambiguous" || row.providerTaskId) return { ok: false, code: "not_claimable" };
  const wait = input.reason === "list_incomplete" ? MESHY_MIN_OVERALL_WAIT_MS : MESHY_ABSENCE_RECONCILE_WAIT_MS;
  if (row.providerContactedAtMs == null || input.nowMs - row.providerContactedAtMs < wait) {
    releaseClaim(row);
    touch(row, input.nowMs);
    return { ok: false, code: "needs_reconciliation" };
  }
  row.status = "needs_review";
  row.errorClass = "needs_review";
  row.errorCode = input.reason;
  row.resubmitAuthorized = false;
  releaseClaim(row);
  touch(row, input.nowMs);
  return { ok: true, job: row };
}

export function dropGenerationClaim(
  db: GenerationDatabase,
  input: { userId: string; jobId: string; claimNonce: string; nowMs: number },
): MutationResult {
  const held = ownedLease(db, input);
  if (!held.ok) return held;
  releaseClaim(held.job);
  touch(held.job, input.nowMs);
  return { ok: true, job: held.job };
}

export function settleGenerationRateLimit(
  db: GenerationDatabase,
  input: { userId: string; jobId: string; claimNonce: string; nowMs: number },
): MutationResult {
  const job = ownedLease(db, input);
  if (!job.ok) return job;
  if (job.job.status !== "submitting" || job.job.providerTaskId) return { ok: false, code: "not_claimable" };
  job.job.attemptCount = Math.max(0, job.job.attemptCount - 1);
  job.job.resubmitAuthorized = job.job.attemptCount > 0;
  job.job.providerContactedAtMs = null;
  job.job.status = "reserved";
  job.job.errorClass = null;
  job.job.errorCode = null;
  releaseClaim(job.job);
  touch(job.job, input.nowMs);
  return { ok: true, job: job.job };
}

export function failGenerationCreate(
  db: GenerationDatabase,
  input: {
    userId: string;
    jobId: string;
    claimNonce: string;
    nowMs: number;
    errorClass: "provider_rejected" | "provider_payment" | "provider_auth" | "provider_forbidden";
    errorCode: string;
  },
): MutationResult {
  const job = ownedLease(db, input);
  if (!job.ok) return job;
  if (job.job.status !== "submitting" || job.job.providerTaskId) return { ok: false, code: "not_claimable" };
  releaseReservation(db, job.job, 0, "failure");
  job.job.status = "failed";
  job.job.errorClass = input.errorClass;
  job.job.errorCode = input.errorCode.slice(0, 80);
  releaseClaim(job.job);
  touch(job.job, input.nowMs);
  return { ok: true, job: job.job };
}

export function applyGenerationObservation(
  db: GenerationDatabase,
  input: {
    userId: string;
    jobId: string;
    claimNonce: string;
    nowMs: number;
    providerStatus: MeshyTaskStatus;
    progress: number;
    consumedCredits: number | null;
    errorCode: string | null;
  },
): MutationResult {
  const job = ownedLease(db, input);
  if (!job.ok) return job;
  const row = job.job;
  if (!row.providerTaskId) return { ok: false, code: "not_claimable" };
  if (
    row.status === "ready"
    || row.status === "saved"
    || row.status === "failed"
    || row.status === "discarded"
    || row.status === "expired"
    || row.status === "cancelled"
    || row.status === "needs_review"
  ) {
    return { ok: true, job: row };
  }
  if (row.status === "ingesting") {
    if (input.providerStatus !== "SUCCEEDED") return { ok: false, code: "not_claimable" };
    return { ok: true, job: row };
  }
  if (row.status !== "running") return { ok: false, code: "not_claimable" };
  row.providerStatus = input.providerStatus;
  row.progress = Math.max(0, Math.min(100, Math.trunc(input.progress)));
  if (input.providerStatus === "PENDING" || input.providerStatus === "IN_PROGRESS") {
    row.status = "running";
    releaseClaim(row);
    touch(row, input.nowMs);
    return { ok: true, job: row };
  }
  if (input.providerStatus === "FAILED" || input.providerStatus === "CANCELED") {
    releaseReservation(db, row, input.consumedCredits ?? 0, "failure");
    row.status = "failed";
    row.errorClass = "provider_failed";
    row.errorCode = (input.errorCode ?? input.providerStatus).slice(0, 80);
    releaseClaim(row);
    touch(row, input.nowMs);
    return { ok: true, job: row };
  }
  if (input.consumedCredits == null) {
    row.errorClass = "credit_unreported";
    row.status = "running";
    releaseClaim(row);
    touch(row, input.nowMs);
    return { ok: true, job: row };
  }
  releaseReservation(db, row, input.consumedCredits, "success");
  row.status = "ingesting";
  row.errorClass = null;
  touch(row, input.nowMs);
  return { ok: true, job: row };
}

export function recordGenerationOutput(
  db: GenerationDatabase,
  input: {
    userId: string;
    jobId: string;
    claimNonce: string;
    nowMs: number;
    byteSize: number;
    sha256: string;
  },
): MutationResult {
  const job = ownedLease(db, input);
  if (!job.ok) return job;
  const row = job.job;
  if (row.status !== "ingesting") return { ok: false, code: "not_claimable" };
  if (!SHA.test(input.sha256) || input.byteSize <= 0 || input.byteSize > PERSONAL_FURNITURE_GLB_MAX_BYTES) {
    return { ok: false, code: "not_claimable" };
  }
  const path = generationCandidatePath(row.userId, row.jobId);
  row.outputBucket = PERSONAL_FURNITURE_BUCKET;
  row.outputObjectPath = path;
  row.outputSha256 = input.sha256;
  row.outputByteSize = input.byteSize;
  row.outputExpiresAtMs = input.nowMs + GENERATION_CANDIDATE_TTL_MS;
  row.status = "ready";
  row.savedAssetId = null;
  releaseClaim(row);
  touch(row, input.nowMs);
  return { ok: true, job: row };
}

export function failGenerationOutput(
  db: GenerationDatabase,
  input: {
    userId: string;
    jobId: string;
    claimNonce: string;
    nowMs: number;
    errorClass: "invalid_output" | "oversized_output" | "ingest_failed";
  },
): MutationResult {
  const job = ownedLease(db, input);
  if (!job.ok) return job;
  if (job.job.status !== "ingesting" && job.job.status !== "running") return { ok: false, code: "not_claimable" };
  job.job.status = "failed";
  job.job.errorClass = input.errorClass;
  job.job.errorCode = input.errorClass;
  job.job.savedAssetId = null;
  releaseClaim(job.job);
  touch(job.job, input.nowMs);
  return { ok: true, job: job.job };
}

export function attachGenerationInput(
  db: GenerationDatabase,
  input: {
    userId: string;
    jobId: string;
    slot: FurnitureViewSlot;
    mimeType: FurniturePhotoMime;
    byteSize: number;
    widthPx: number;
    heightPx: number;
    sha256: string;
    nowMs: number;
  },
): MutationResult {
  const job = readGeneration(db, input.userId, input.jobId);
  if (!job || job.status !== "reserved") return { ok: false, code: "not_found" };
  if (!SHA.test(input.sha256)) return { ok: false, code: "not_claimable" };
  const ordinal = job.imageSlots.indexOf(input.slot);
  if (ordinal < 0) return { ok: false, code: "not_claimable" };
  const storageObjectPath = generationInputPath(input.userId, input.jobId, input.slot, imageExtension(input.mimeType));
  if (!pathOwnedBy(storageObjectPath, input.userId)) return { ok: false, code: "not_claimable" };
  const record: GenerationInputRecord = {
    jobId: input.jobId,
    userId: input.userId,
    slot: input.slot,
    ordinal,
    storageBucket: GENERATION_INPUT_BUCKET,
    storageObjectPath,
    sha256: input.sha256,
    byteSize: input.byteSize,
    mimeType: input.mimeType,
    widthPx: input.widthPx,
    heightPx: input.heightPx,
    expiresAtMs: input.nowMs + GENERATION_INPUT_TTL_MS,
    purgedAtMs: null,
  };
  const index = db.inputs.findIndex((item) => item.jobId === input.jobId && item.slot === input.slot);
  if (index >= 0) db.inputs[index] = record;
  else db.inputs.push(record);
  return { ok: true, job };
}

export function failGenerationBeforeProvider(
  db: GenerationDatabase,
  input: { userId: string; jobId: string; nowMs: number },
): MutationResult {
  const job = readGeneration(db, input.userId, input.jobId);
  if (!job) return { ok: false, code: "not_found" };
  if (job.status !== "reserved" || job.providerContactedAtMs != null || job.providerTaskId) {
    return { ok: false, code: "not_claimable" };
  }
  releaseReservation(db, job, 0, "failure");
  job.status = "failed";
  job.errorClass = "input_storage_failed";
  job.errorCode = "input_storage_failed";
  touch(job, input.nowMs);
  return { ok: true, job };
}

export function generationInputsFor(
  db: GenerationDatabase,
  userId: string,
  jobId: string,
): GenerationInputRecord[] {
  const job = readGeneration(db, userId, jobId);
  if (!job) return [];
  return db.inputs
    .filter((item) => item.jobId === jobId && item.userId === userId)
    .sort((left, right) => left.ordinal - right.ordinal);
}

export function expireGenerationInputs(db: GenerationDatabase, nowMs: number): string[] {
  const paths: string[] = [];
  for (const item of db.inputs) {
    if (item.purgedAtMs != null || item.expiresAtMs > nowMs) continue;
    item.purgedAtMs = nowMs;
    paths.push(item.storageObjectPath);
  }
  return paths;
}

export function candidatePreviewOffer(
  db: GenerationDatabase,
  input: { actorUserId: string; jobId: string; sign: (path: string, ownerUserId: string) => string | null },
): { ok: true; url: string; savedAssetId: null } | { ok: false; code: "not_found" | "not_ready" } {
  const job = readGeneration(db, input.actorUserId, input.jobId);
  if (!job) return { ok: false, code: "not_found" };
  if (job.status !== "ready" || !job.outputObjectPath || job.savedAssetId) return { ok: false, code: "not_ready" };
  const url = input.sign(job.outputObjectPath, job.userId);
  if (!url) return { ok: false, code: "not_found" };
  return { ok: true, url, savedAssetId: null };
}

export type LifecycleResult =
  | { ok: true; job: GenerationJob; providerCreditsRefunded: false }
  | { ok: false; code: "not_found" | "not_claimable" };

export function authorizeGenerationResubmit(
  db: GenerationDatabase,
  input: { userId: string; jobId: string; nowMs: number; duplicateChargeRiskAccepted: boolean },
): MutationResult {
  const job = readGeneration(db, input.userId, input.jobId);
  if (!job) return { ok: false, code: "not_found" };
  if (!input.duplicateChargeRiskAccepted) return { ok: false, code: "not_claimable" };
  if (job.status !== "needs_review" || job.providerTaskId || job.savedAssetId) return { ok: false, code: "not_claimable" };
  if (job.attemptCount >= MESHY_MAX_SUBMIT_ATTEMPTS) return { ok: false, code: "not_claimable" };
  job.resubmitAuthorized = true;
  job.status = "reserved";
  job.errorClass = null;
  job.errorCode = null;
  releaseClaim(job);
  touch(job, input.nowMs);
  return { ok: true, job };
}

export function discardGenerationCandidate(
  db: GenerationDatabase,
  input: { userId: string; jobId: string; nowMs: number },
): LifecycleResult {
  const job = readGeneration(db, input.userId, input.jobId);
  if (!job) return { ok: false, code: "not_found" };
  if (job.savedAssetId || job.status === "saved") return { ok: false, code: "not_claimable" };
  if (job.status === "ready") {
    job.status = "discarded";
    job.errorClass = "discarded";
    job.errorCode = "discarded";
    releaseClaim(job);
    touch(job, input.nowMs);
    return { ok: true, job, providerCreditsRefunded: false };
  }
  if (job.status === "reserved" && job.providerContactedAtMs == null && !job.providerTaskId) {
    releaseReservation(db, job, 0, "failure");
    job.status = "cancelled";
    job.errorClass = "cancelled";
    job.errorCode = "cancelled";
    releaseClaim(job);
    touch(job, input.nowMs);
    return { ok: true, job, providerCreditsRefunded: false };
  }
  return { ok: false, code: "not_claimable" };
}

export function expireGenerationCandidate(
  db: GenerationDatabase,
  input: { userId: string; jobId: string; nowMs: number },
): LifecycleResult {
  const job = readGeneration(db, input.userId, input.jobId);
  if (!job) return { ok: false, code: "not_found" };
  if (job.savedAssetId || job.status !== "ready" || job.outputExpiresAtMs == null || job.outputExpiresAtMs > input.nowMs) {
    return { ok: false, code: "not_claimable" };
  }
  job.status = "expired";
  job.errorClass = "expired";
  job.errorCode = "expired";
  releaseClaim(job);
  touch(job, input.nowMs);
  return { ok: true, job, providerCreditsRefunded: false };
}

function ownedLease(
  db: GenerationDatabase,
  input: { userId: string; jobId: string; claimNonce: string; nowMs: number },
): { ok: true; job: GenerationJob } | { ok: false; code: "not_found" | "lease_held" } {
  const job = readGeneration(db, input.userId, input.jobId);
  if (!job) return { ok: false, code: "not_found" };
  if (!job.claimNonce || job.claimNonce !== input.claimNonce || !leaseFresh(job, input.nowMs)) {
    return { ok: false, code: "lease_held" };
  }
  return { ok: true, job };
}

function releaseReservation(
  db: GenerationDatabase,
  job: GenerationJob,
  consumed: number,
  mode: "success" | "failure",
): void {
  if (job.quotaState !== "reserved") return;
  db.controls.creditsReserved -= job.reservedCredits;
  const actual = Math.max(0, Math.trunc(consumed));
  if (actual > 0 || mode === "success") {
    db.controls.creditsConsumed += actual;
    job.quotaState = "reconciled";
  } else {
    job.quotaState = "released";
  }
  job.consumedCredits = actual;
}

function hold(job: GenerationJob, nowMs: number): void {
  job.claimNonce = randomUUID();
  job.claimExpiresAtMs = nowMs + MESHY_CLAIM_LEASE_MS;
  touch(job, nowMs);
}

function releaseClaim(job: GenerationJob): void {
  job.claimNonce = null;
  job.claimExpiresAtMs = null;
}

function leaseFresh(job: GenerationJob, nowMs: number): boolean {
  return job.claimNonce != null && job.claimExpiresAtMs != null && job.claimExpiresAtMs > nowMs;
}

function touch(job: GenerationJob, nowMs: number): void {
  job.updatedAtMs = nowMs;
}

function releaseExpiredGenerationHolds(db: GenerationDatabase, nowMs: number): void {
  for (const job of db.jobs) {
    if (job.savedAssetId) continue;
    if (job.status === "ready" && job.outputExpiresAtMs != null && job.outputExpiresAtMs <= nowMs) {
      job.status = "expired";
      job.errorClass = "expired";
      job.errorCode = "expired";
      releaseClaim(job);
      touch(job, nowMs);
      continue;
    }
    if (
      job.status === "reserved"
      && job.providerContactedAtMs == null
      && !job.providerTaskId
      && nowMs - job.createdAtMs >= GENERATION_INPUT_TTL_MS
    ) {
      releaseReservation(db, job, 0, "failure");
      job.status = "cancelled";
      job.errorClass = "cancelled";
      job.errorCode = "cancelled";
      releaseClaim(job);
      touch(job, nowMs);
    }
  }
}

function isActive(status: GenerationStatus): boolean {
  return (ACTIVE_GENERATION_STATUSES as readonly string[]).includes(status);
}

function slotsMatchOperation(operation: MeshyGenerationOperation, slots: readonly FurnitureViewSlot[]): boolean {
  if (slots.length === 0 || slots[0] !== "front") return false;
  let previous = -1;
  for (const slot of slots) {
    const index = FURNITURE_VIEW_SLOT_ORDER.indexOf(slot);
    if (index <= previous) return false;
    previous = index;
  }
  if (operation === "image-to-3d") return slots.length === 1;
  return slots.length >= 2 && slots.length <= 4;
}
