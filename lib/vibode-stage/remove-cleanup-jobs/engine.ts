/**
 * In-memory model of the Clean Up Room job RPCs.
 *
 * Production locking lives in Postgres. This module is the local
 * certification double and must stay aligned with
 * supabase/migrations/20261020193000_vibode_cleanup_generations.sql and
 * supabase/migrations/20261021141800_vibode_cleanup_generation_retry.sql.
 *
 * A job that has recorded provider contact is never claimed for another
 * paid POST. An expired lease before contact may requeue. An expired lease
 * after contact becomes provider_uncertain unless a stored candidate is settled.
 *
 * Marking contact before the provider POST can lose one generation if the
 * process dies before the POST begins. It cannot create a second POST.
 */

import { createHash, randomUUID } from "node:crypto";

import {
  REMOVE_CLEANUP_DAILY_PROVIDER_LIMIT,
  REMOVE_CLEANUP_FAILURE_MESSAGE_MAX,
  REMOVE_CLEANUP_GLOBAL_DAILY_PROVIDER_LIMIT,
  REMOVE_CLEANUP_JOB_CLAIM_LEASE_MS,
  REMOVE_CLEANUP_JOB_MAX_PRECONTACT_ATTEMPTS,
  REMOVE_CLEANUP_PRECONTACT_BACKOFF_MS,
  VIBODE_CLEANUP_BUCKET,
  cleanupCandidatePath,
  cleanupUtcDayStartMs,
} from "./policy";
import type {
  CleanupClaim,
  CleanupCompleteInput,
  CleanupCompleteResult,
  CleanupContactResult,
  CleanupDiscardResult,
  CleanupEnqueueResult,
  CleanupFailInput,
  CleanupFailResult,
  CleanupJobDatabase,
  CleanupJobInsert,
  CleanupJobRow,
  CleanupRetryResult,
} from "./types";

const DAY_MS = 86_400_000;

export function createCleanupJobDatabase(): CleanupJobDatabase {
  return { jobs: [] };
}

export function enqueueCleanupJob(
  db: CleanupJobDatabase,
  insert: CleanupJobInsert,
  nowMs: number,
): CleanupEnqueueResult {
  if (!submissionReady(insert)) return { ok: false, code: "invalid_submission" };
  if (insert.roomUserId !== insert.userId) return { ok: false, code: "not_found" };
  if (insert.currentGenerationId !== insert.afcGenerationId) return { ok: false, code: "stale_generation" };
  const existing = db.jobs.find((job) =>
    job.userId === insert.userId && job.paidRequestFingerprint === insert.paidRequestFingerprint
  );
  if (existing) {
    if (existing.inputFingerprint === insert.inputFingerprint && existing.originalSha256 === insert.originalSha256) {
      return { ok: true, created: false, job: existing };
    }
    return { ok: false, code: "idempotency_conflict" };
  }
  if (db.jobs.some((job) => job.userId === insert.userId && isActive(job))) {
    return { ok: false, code: "active_job" };
  }
  if (providerStartedCount(db, insert.userId, nowMs) >= REMOVE_CLEANUP_DAILY_PROVIDER_LIMIT) {
    return { ok: false, code: "daily_limit" };
  }
  if (globalProviderStartedCount(db, nowMs) >= REMOVE_CLEANUP_GLOBAL_DAILY_PROVIDER_LIMIT) {
    return { ok: false, code: "global_daily_limit" };
  }
  const job = rowFrom(insert, nowMs);
  db.jobs.push(job);
  return { ok: true, created: true, job };
}

export function retryCleanupJob(
  db: CleanupJobDatabase,
  userId: string,
  jobId: string,
  nowMs: number,
): CleanupRetryResult {
  const source = findJob(db, jobId);
  if (!source || source.userId !== userId) return { ok: false, code: "not_found" };
  if (source.status !== "failed") return { ok: false, code: "not_failed" };
  const activeRetry = db.jobs.find((job) =>
    job.userId === userId && job.retryOfJobId === source.id && isActive(job)
  );
  if (activeRetry) return { ok: true, created: false, job: activeRetry };
  if (db.jobs.some((job) => job.userId === userId && isActive(job))) {
    return { ok: false, code: "active_job" };
  }
  if (providerStartedCount(db, userId, nowMs) >= REMOVE_CLEANUP_DAILY_PROVIDER_LIMIT) {
    return { ok: false, code: "daily_limit" };
  }
  if (globalProviderStartedCount(db, nowMs) >= REMOVE_CLEANUP_GLOBAL_DAILY_PROVIDER_LIMIT) {
    return { ok: false, code: "global_daily_limit" };
  }
  const childOrdinal = db.jobs
    .filter((job) => job.retryOfJobId === source.id)
    .reduce((max, job) => Math.max(max, job.retryOrdinal), 0);
  const retryOrdinal = Math.max(source.retryOrdinal + 1, childOrdinal + 1);
  const job = cloneQueuedRetry(source, {
    id: randomUUID(),
    paidRequestFingerprint: retryPaidFingerprint(source, retryOrdinal),
    retryOrdinal,
    nowMs,
  });
  db.jobs.push(job);
  return { ok: true, created: true, job };
}

export function readCleanupJob(db: CleanupJobDatabase, userId: string, jobId: string): CleanupJobRow | null {
  const job = findJob(db, jobId);
  if (!job || job.userId !== userId) return null;
  return job;
}

export function readLatestCleanupJobForRoom(
  db: CleanupJobDatabase,
  userId: string,
  roomId: string,
): CleanupJobRow | null {
  const jobs = db.jobs
    .filter((job) => job.userId === userId && job.roomId === roomId)
    .sort((left, right) => right.createdAtMs - left.createdAtMs);
  return jobs.find((job) => isActive(job)) ?? jobs[0] ?? null;
}

export function claimNextCleanupJob(
  db: CleanupJobDatabase,
  nowMs: number,
  jobId: string | null = null,
): CleanupClaim | null {
  reapCleanupLeases(db, nowMs, jobId);
  if (runningCount(db) >= 1) return null;
  if (jobId !== null) {
    const job = findJob(db, jobId);
    if (!job || job.status !== "queued" || job.notBeforeMs > nowMs || job.providerStartedAtMs != null) return null;
    return claimQueued(db, job, nowMs);
  }
  const queued = db.jobs
    .filter((job) => job.status === "queued" && job.notBeforeMs <= nowMs && job.providerStartedAtMs == null)
    .sort((left, right) => left.createdAtMs - right.createdAtMs);
  for (const job of queued) {
    const claimed = claimQueued(db, job, nowMs);
    if (claimed) return claimed;
  }
  return null;
}

export function heartbeatCleanupJob(
  db: CleanupJobDatabase,
  input: Readonly<{ jobId: string; claimNonce: string; nowMs: number }>,
): boolean {
  const job = findJob(db, input.jobId);
  if (!job || !fenceHolds(job, input.claimNonce, input.nowMs)) return false;
  job.heartbeatAtMs = input.nowMs;
  job.claimExpiresAtMs = input.nowMs + REMOVE_CLEANUP_JOB_CLAIM_LEASE_MS;
  job.updatedAtMs = input.nowMs;
  return true;
}

export function markCleanupProviderContact(
  db: CleanupJobDatabase,
  input: Readonly<{ jobId: string; claimNonce: string; nowMs: number }>,
): CleanupContactResult {
  const job = findJob(db, input.jobId);
  if (!job || !fenceHolds(job, input.claimNonce, input.nowMs)) return { ok: false, code: "stale_claim" };
  if (job.providerStartedAtMs != null) return { ok: false, code: "already_contacted" };
  if (providerStartedCount(db, job.userId, input.nowMs) >= REMOVE_CLEANUP_DAILY_PROVIDER_LIMIT) {
    failClosed(job, input.nowMs, "daily_limit", "Daily Clean Up provider limit was reached.");
    clearClaim(job);
    return { ok: false, code: "daily_limit" };
  }
  if (globalProviderStartedCount(db, input.nowMs) >= REMOVE_CLEANUP_GLOBAL_DAILY_PROVIDER_LIMIT) {
    job.status = "queued";
    job.attemptCount = Math.max(0, job.attemptCount - 1);
    job.notBeforeMs = cleanupUtcDayStartMs(input.nowMs) + DAY_MS;
    job.updatedAtMs = input.nowMs;
    clearClaim(job);
    return { ok: false, code: "global_daily_limit" };
  }
  job.providerStartedAtMs = input.nowMs;
  job.providerAttemptId = randomUUID();
  job.updatedAtMs = input.nowMs;
  return { ok: true, attemptId: job.providerAttemptId };
}

export function completeCleanupJob(
  db: CleanupJobDatabase,
  input: Readonly<{ jobId: string; claimNonce: string; nowMs: number } & CleanupCompleteInput>,
): CleanupCompleteResult {
  const job = findJob(db, input.jobId);
  if (!job) return { ok: false, code: "stale_claim" };
  if (job.status === "succeeded" && job.outputSha256 === input.outputSha256) {
    return job.claimNonce === input.claimNonce || job.providerStartedAtMs != null
      ? { ok: true, code: "already_complete" }
      : { ok: false, code: "stale_claim" };
  }
  if (!fenceHolds(job, input.claimNonce, input.nowMs)) return { ok: false, code: "stale_claim" };
  if (job.providerStartedAtMs == null) return { ok: false, code: "not_contacted" };
  if (!outputFrame(input.outputWidth, input.outputHeight) || !/^[0-9a-f]{64}$/.test(input.outputSha256)) {
    return { ok: false, code: "unexpected_output" };
  }
  writeOutput(job, input, input.nowMs);
  return { ok: true, code: "completed" };
}

export function settleCleanupCandidate(
  db: CleanupJobDatabase,
  input: Readonly<{ jobId: string; nowMs: number } & CleanupCompleteInput>,
): CleanupCompleteResult {
  const job = findJob(db, input.jobId);
  if (!job || job.providerStartedAtMs == null) return { ok: false, code: "not_contacted" };
  if (job.status === "succeeded" && job.outputSha256 === input.outputSha256) {
    return { ok: true, code: "already_complete" };
  }
  const recoverable = job.status === "running"
    || (job.status === "failed" && job.failureCode === "provider_uncertain" && job.outputSha256 == null);
  if (!recoverable) return { ok: false, code: "terminal" };
  if (!outputFrame(input.outputWidth, input.outputHeight) || !/^[0-9a-f]{64}$/.test(input.outputSha256)) {
    return { ok: false, code: "unexpected_output" };
  }
  writeOutput(job, input, input.nowMs);
  clearClaim(job);
  return { ok: true, code: "completed" };
}

export function failCleanupJob(
  db: CleanupJobDatabase,
  input: Readonly<{ jobId: string; claimNonce: string; nowMs: number } & CleanupFailInput>,
): CleanupFailResult {
  const job = findJob(db, input.jobId);
  if (!job) return { ok: false, code: "stale_claim" };
  if (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") {
    return { ok: false, code: "terminal" };
  }
  if (!fenceHolds(job, input.claimNonce, input.nowMs)) return { ok: false, code: "stale_claim" };
  const contacted = job.providerStartedAtMs != null;
  if (input.retryable && !contacted && job.attemptCount < REMOVE_CLEANUP_JOB_MAX_PRECONTACT_ATTEMPTS) {
    job.status = "queued";
    job.notBeforeMs = input.nowMs + REMOVE_CLEANUP_PRECONTACT_BACKOFF_MS;
    job.updatedAtMs = input.nowMs;
    clearClaim(job);
    return { ok: true, disposition: "requeued" };
  }
  failClosed(job, input.nowMs, contacted ? terminalCode(input.code) : safeCode(input.code), input.message);
  job.providerStatus = input.providerStatus ?? null;
  job.providerHttpStatus = input.providerHttpStatus ?? null;
  job.latencyMs = input.latencyMs ?? null;
  clearClaim(job);
  return { ok: true, disposition: "failed" };
}

export function discardCleanupJob(
  db: CleanupJobDatabase,
  userId: string,
  jobId: string,
  nowMs: number,
): CleanupDiscardResult {
  const job = findJob(db, jobId);
  if (!job || job.userId !== userId) return { ok: false, code: "not_found" };
  if (job.discardedAtMs != null || job.status === "cancelled") {
    if (job.discardedAtMs == null) job.discardedAtMs = nowMs;
    return { ok: true, job, effect: "already" };
  }
  if (job.providerStartedAtMs == null && (job.status === "queued" || job.status === "running")) {
    job.status = "cancelled";
    job.discardedAtMs = nowMs;
    job.completedAtMs = nowMs;
    job.updatedAtMs = nowMs;
    job.failureCode = "cancelled";
    job.failureMessage = "Clean Up was cancelled before provider contact.";
    clearClaim(job);
    return { ok: true, job, effect: "cancelled" };
  }
  job.discardedAtMs = nowMs;
  job.updatedAtMs = nowMs;
  return { ok: true, job, effect: "marked" };
}

export function recoverableCleanupJobs(db: CleanupJobDatabase): CleanupJobRow[] {
  return db.jobs.filter((job) =>
    job.providerStartedAtMs != null
    && job.outputSha256 == null
    && job.status === "failed"
    && job.failureCode === "provider_uncertain"
  );
}

function claimQueued(db: CleanupJobDatabase, job: CleanupJobRow, nowMs: number): CleanupClaim | null {
  if (job.providerStartedAtMs != null) return null;
  if (providerStartedCount(db, job.userId, nowMs) >= REMOVE_CLEANUP_DAILY_PROVIDER_LIMIT) {
    failClosed(job, nowMs, "daily_limit", "Daily Clean Up provider limit was reached.");
    return null;
  }
  if (globalProviderStartedCount(db, nowMs) >= REMOVE_CLEANUP_GLOBAL_DAILY_PROVIDER_LIMIT) {
    const nextDay = cleanupUtcDayStartMs(nowMs) + DAY_MS;
    if (job.notBeforeMs < nextDay) job.notBeforeMs = nextDay;
    job.updatedAtMs = nowMs;
    return null;
  }
  job.status = "running";
  job.attemptCount += 1;
  job.claimedAtMs = nowMs;
  job.heartbeatAtMs = nowMs;
  job.claimExpiresAtMs = nowMs + REMOVE_CLEANUP_JOB_CLAIM_LEASE_MS;
  job.claimNonce = randomUUID();
  job.updatedAtMs = nowMs;
  job.failureCode = null;
  job.failureMessage = null;
  return claimFrom(job);
}

function reapCleanupLeases(db: CleanupJobDatabase, nowMs: number, onlyJobId: string | null): void {
  for (const job of db.jobs) {
    if (onlyJobId !== null && job.id !== onlyJobId) continue;
    if (job.status !== "running" || job.claimExpiresAtMs == null || job.claimExpiresAtMs > nowMs) continue;
    if (job.providerStartedAtMs != null) {
      if (job.outputSha256) {
        job.status = "succeeded";
        job.completedAtMs = nowMs;
        job.updatedAtMs = nowMs;
        clearClaim(job);
        continue;
      }
      failClosed(job, nowMs, "provider_uncertain", "Provider contact ended before a confirmed result.");
      clearClaim(job);
      continue;
    }
    if (job.attemptCount < REMOVE_CLEANUP_JOB_MAX_PRECONTACT_ATTEMPTS) {
      job.status = "queued";
      job.notBeforeMs = nowMs;
      job.updatedAtMs = nowMs;
      clearClaim(job);
      continue;
    }
    failClosed(job, nowMs, "attempts_exhausted", "Clean Up stopped before contacting the provider.");
    clearClaim(job);
  }
}

function writeOutput(job: CleanupJobRow, input: CleanupCompleteInput, nowMs: number): void {
  job.status = "succeeded";
  job.outputPath = cleanupCandidatePath(job.roomId, job.id);
  job.outputSha256 = input.outputSha256;
  job.outputWidth = input.outputWidth;
  job.outputHeight = input.outputHeight;
  job.returnedModelId = input.returnedModelId;
  job.interactionId = input.interactionId;
  job.usage = input.usage ? { ...input.usage } : null;
  job.providerStatus = input.providerStatus;
  job.providerHttpStatus = input.providerHttpStatus;
  job.latencyMs = input.latencyMs;
  job.failureCode = null;
  job.failureMessage = null;
  job.completedAtMs = nowMs;
  job.updatedAtMs = nowMs;
}

function rowFrom(insert: CleanupJobInsert, nowMs: number): CleanupJobRow {
  return {
    id: insert.id,
    userId: insert.userId,
    roomId: insert.roomId,
    afcGenerationId: insert.afcGenerationId,
    paidRequestFingerprint: insert.paidRequestFingerprint,
    inputFingerprint: insert.inputFingerprint,
    status: "queued",
    hiddenObjectCount: insert.selection.length,
    hiddenConcepts: [...insert.hiddenConcepts],
    selection: insert.selection.map((item) => ({ ...item })),
    originalSha256: insert.originalSha256,
    originalMime: insert.originalMime,
    originalByteCount: insert.originalByteCount,
    originalWidth: insert.originalWidth,
    originalHeight: insert.originalHeight,
    overlaySha256: insert.overlaySha256,
    promptSha256: insert.promptSha256,
    promptVersion: insert.promptVersion,
    maskManifestSha256: insert.maskManifestSha256,
    aspectRatioFamily: insert.aspectRatioFamily,
    documented1kGridWidth: insert.documented1kGridWidth,
    documented1kGridHeight: insert.documented1kGridHeight,
    resolutionClass: "2K",
    outputMime: "image/jpeg",
    provider: "google-gemini-interactions",
    requestedModelId: "gemini-3-pro-image",
    artifactBucket: VIBODE_CLEANUP_BUCKET,
    originalPath: insert.originalPath,
    overlayPath: insert.overlayPath,
    promptPath: insert.promptPath,
    masksPath: insert.masksPath,
    outputPath: null,
    outputSha256: null,
    outputWidth: null,
    outputHeight: null,
    returnedModelId: null,
    interactionId: null,
    usage: null,
    stageRegistration: "not-assessed",
    providerStartedAtMs: null,
    providerAttemptId: null,
    claimNonce: null,
    claimExpiresAtMs: null,
    claimedAtMs: null,
    heartbeatAtMs: null,
    attemptCount: 0,
    failureCode: null,
    failureMessage: null,
    providerStatus: null,
    providerHttpStatus: null,
    latencyMs: null,
    discardedAtMs: null,
    notBeforeMs: nowMs,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    completedAtMs: null,
    retryOfJobId: null,
    retryOrdinal: 0,
    historyAssetId: null,
    acceptedAtMs: null,
  };
}

function cloneQueuedRetry(
  source: CleanupJobRow,
  input: Readonly<{ id: string; paidRequestFingerprint: string; retryOrdinal: number; nowMs: number }>,
): CleanupJobRow {
  return {
    ...source,
    id: input.id,
    paidRequestFingerprint: input.paidRequestFingerprint,
    status: "queued",
    hiddenConcepts: [...source.hiddenConcepts],
    selection: source.selection.map((item) => ({ ...item })),
    outputPath: null,
    outputSha256: null,
    outputWidth: null,
    outputHeight: null,
    returnedModelId: null,
    interactionId: null,
    usage: null,
    providerStartedAtMs: null,
    providerAttemptId: null,
    claimNonce: null,
    claimExpiresAtMs: null,
    claimedAtMs: null,
    heartbeatAtMs: null,
    attemptCount: 0,
    failureCode: null,
    failureMessage: null,
    providerStatus: null,
    providerHttpStatus: null,
    latencyMs: null,
    discardedAtMs: null,
    notBeforeMs: input.nowMs,
    createdAtMs: input.nowMs,
    updatedAtMs: input.nowMs,
    completedAtMs: null,
    retryOfJobId: source.id,
    retryOrdinal: input.retryOrdinal,
    historyAssetId: null,
    acceptedAtMs: null,
  };
}

function retryPaidFingerprint(source: CleanupJobRow, retryOrdinal: number): string {
  return createHash("sha256")
    .update(source.paidRequestFingerprint)
    .update(":")
    .update(source.id)
    .update(":")
    .update(String(retryOrdinal))
    .update(":")
    .update(randomUUID())
    .digest("hex");
}

function claimFrom(job: CleanupJobRow): CleanupClaim {
  const claimNonce = job.claimNonce;
  const claimExpiresAtMs = job.claimExpiresAtMs;
  if (!claimNonce || claimExpiresAtMs == null) throw new Error("Clean Up claim is missing its fence.");
  return {
    jobId: job.id,
    userId: job.userId,
    roomId: job.roomId,
    claimNonce,
    claimExpiresAtMs,
    attemptCount: job.attemptCount,
    afcGenerationId: job.afcGenerationId,
    inputFingerprint: job.inputFingerprint,
    paidRequestFingerprint: job.paidRequestFingerprint,
    aspectRatioFamily: job.aspectRatioFamily,
    documented1kGridWidth: job.documented1kGridWidth,
    documented1kGridHeight: job.documented1kGridHeight,
    originalSha256: job.originalSha256,
    originalMime: job.originalMime,
    originalWidth: job.originalWidth,
    originalHeight: job.originalHeight,
    overlaySha256: job.overlaySha256,
    promptSha256: job.promptSha256,
    promptVersion: job.promptVersion,
    maskManifestSha256: job.maskManifestSha256,
    originalPath: job.originalPath,
    overlayPath: job.overlayPath,
    promptPath: job.promptPath,
    masksPath: job.masksPath,
    selection: job.selection.map((item) => ({ ...item })),
  };
}

function providerStartedCount(db: CleanupJobDatabase, userId: string, nowMs: number): number {
  const start = cleanupUtcDayStartMs(nowMs);
  return db.jobs.filter((job) =>
    job.userId === userId
    && job.providerStartedAtMs != null
    && job.providerStartedAtMs >= start
    && job.providerStartedAtMs < start + DAY_MS
  ).length;
}

function globalProviderStartedCount(db: CleanupJobDatabase, nowMs: number): number {
  const start = cleanupUtcDayStartMs(nowMs);
  return db.jobs.filter((job) =>
    job.providerStartedAtMs != null
    && job.providerStartedAtMs >= start
    && job.providerStartedAtMs < start + DAY_MS
  ).length;
}

function runningCount(db: CleanupJobDatabase): number {
  return db.jobs.filter((job) => job.status === "running").length;
}

function findJob(db: CleanupJobDatabase, jobId: string): CleanupJobRow | null {
  return db.jobs.find((job) => job.id === jobId) ?? null;
}

function isActive(job: CleanupJobRow): boolean {
  return job.status === "queued" || job.status === "running";
}

function fenceHolds(job: CleanupJobRow, claimNonce: string, nowMs: number): boolean {
  return job.status === "running"
    && job.claimNonce === claimNonce
    && job.claimExpiresAtMs != null
    && job.claimExpiresAtMs > nowMs;
}

function clearClaim(job: CleanupJobRow): void {
  job.claimNonce = null;
  job.claimExpiresAtMs = null;
  job.claimedAtMs = null;
  job.heartbeatAtMs = null;
}

function failClosed(job: CleanupJobRow, nowMs: number, code: string, message: string): void {
  job.status = "failed";
  job.failureCode = safeCode(code);
  job.failureMessage = redactCleanupDiagnostic(message);
  job.completedAtMs = nowMs;
  job.updatedAtMs = nowMs;
}

function outputFrame(width: number, height: number): boolean {
  return Number.isInteger(width)
    && Number.isInteger(height)
    && width >= 1
    && height >= 1
    && width <= 4096
    && height <= 4096;
}

function terminalCode(code: string): string {
  if (code === "provider_rejected" || code === "unexpected_output" || code === "provider_uncertain" || code === "content_refused") {
    return code === "content_refused" ? "provider_rejected" : code;
  }
  return "provider_uncertain";
}

function safeCode(code: string): string {
  return /^[a-z0-9_]{1,64}$/.test(code) ? code : "failed";
}

export function redactCleanupDiagnostic(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim()
    .replace(/AIza[0-9A-Za-z_-]{8,}/g, "[redacted]")
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "[redacted]");
  return collapsed.slice(0, REMOVE_CLEANUP_FAILURE_MESSAGE_MAX);
}

function submissionReady(insert: CleanupJobInsert): boolean {
  return /^[0-9a-f]{64}$/.test(insert.paidRequestFingerprint)
    && /^[0-9a-f]{64}$/.test(insert.inputFingerprint)
    && /^[0-9a-f]{64}$/.test(insert.originalSha256)
    && /^[0-9a-f]{64}$/.test(insert.overlaySha256)
    && /^[0-9a-f]{64}$/.test(insert.promptSha256)
    && /^[0-9a-f]{64}$/.test(insert.maskManifestSha256)
    && insert.selection.length > 0
    && insert.originalWidth >= 1
    && insert.originalHeight >= 1
    && insert.originalPath.startsWith(`rooms/${insert.roomId}/jobs/${insert.id}/`)
    && insert.overlayPath.startsWith(`rooms/${insert.roomId}/jobs/${insert.id}/`)
    && insert.promptPath.startsWith(`rooms/${insert.roomId}/jobs/${insert.id}/`)
    && insert.masksPath.startsWith(`rooms/${insert.roomId}/jobs/${insert.id}/`)
    && !insert.originalPath.includes("..");
}
