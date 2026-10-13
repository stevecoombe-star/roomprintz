/**
 * In-memory model of the Harmonize job RPCs.
 *
 * Production locking lives in Postgres (`FOR UPDATE SKIP LOCKED`, the
 * partial unique index, and the fencing checks). This module is the local
 * certification double and must stay aligned with
 * supabase/migrations/20261012090000_vibode_harmonize_generations.sql and
 * supabase/migrations/20261013010000_vibode_harmonize_exact_claim.sql.
 *
 * A supplied job id claims that row or nothing. It never falls through to
 * another queued job. A job that has recorded provider contact is never
 * claimed again.
 */

import { randomUUID } from "node:crypto";

import { HARMONIZE_NBP_MODEL_ID } from "@/lib/vibode-stage/harmonize-nbp-proof";

import {
  HARMONIZE_DAILY_PROVIDER_LIMIT,
  HARMONIZE_JOB_CLAIM_LEASE_MS,
  HARMONIZE_JOB_MAX_PRECONTACT_ATTEMPTS,
  HARMONIZE_PRECONTACT_BACKOFF_MS,
  HARMONIZE_PROVIDER_ID,
  VIBODE_HARMONIZE_BUCKET,
  harmonizeUtcDayStartMs,
} from "./policy";
import { redactHarmonizeDiagnostic } from "./redaction";
import type { HarmonizeJobInsert, HarmonizeJobRow } from "./types";

export type HarmonizeJobDatabase = {
  jobs: HarmonizeJobRow[];
};

export type HarmonizeEnqueueResult =
  | Readonly<{ ok: true; created: boolean; job: HarmonizeJobRow }>
  | Readonly<{
      ok: false;
      code: "not_found" | "source_version_not_found" | "active_job" | "daily_limit" | "idempotency_conflict";
    }>;

export type HarmonizeClaim = Readonly<{
  jobId: string;
  userId: string;
  roomId: string;
  claimNonce: string;
  claimExpiresAtMs: number;
  attemptCount: number;
  prompt: string;
  promptSha256: string;
  compositeSha256: string;
  compositeWidth: number;
  compositeHeight: number;
  requestedModelId: string;
}>;

const DAY_MS = 86_400_000;

export function createHarmonizeJobDatabase(): HarmonizeJobDatabase {
  return { jobs: [] };
}

export function harmonizeProviderStartedCount(
  db: HarmonizeJobDatabase,
  userId: string,
  nowMs: number,
): number {
  const start = harmonizeUtcDayStartMs(nowMs);
  const end = start + DAY_MS;
  return db.jobs.filter((job) =>
    job.userId === userId
    && job.providerStartedAtMs != null
    && job.providerStartedAtMs >= start
    && job.providerStartedAtMs < end
  ).length;
}

export function enqueueHarmonizeJob(
  db: HarmonizeJobDatabase,
  insert: HarmonizeJobInsert,
  nowMs: number,
  id: string = randomUUID(),
): HarmonizeEnqueueResult {
  if (insert.roomUserId !== insert.userId) return { ok: false, code: "not_found" };
  if (insert.sourceUserId !== insert.userId || insert.sourceRoomId !== insert.roomId) {
    return { ok: false, code: "source_version_not_found" };
  }
  const existingKey = db.jobs.find((job) =>
    job.userId === insert.userId && job.idempotencyKey === insert.idempotencyKey
  );
  if (existingKey) {
    if (existingKey.requestSha256 === insert.requestSha256) {
      return { ok: true, created: false, job: existingKey };
    }
    return { ok: false, code: "idempotency_conflict" };
  }
  const active = db.jobs.find((job) => job.userId === insert.userId && isActive(job));
  if (active) return { ok: false, code: "active_job" };
  if (harmonizeProviderStartedCount(db, insert.userId, nowMs) >= HARMONIZE_DAILY_PROVIDER_LIMIT) {
    return { ok: false, code: "daily_limit" };
  }
  const job: HarmonizeJobRow = {
    id,
    userId: insert.userId,
    roomId: insert.roomId,
    sourceVersionId: insert.sourceVersionId,
    idempotencyKey: insert.idempotencyKey,
    kind: "initial",
    status: "queued",
    requestSha256: insert.requestSha256,
    sceneSnapshotSha256: insert.sceneSnapshotSha256,
    backgroundSha256: insert.backgroundSha256,
    compositeSha256: insert.compositeSha256,
    promptSha256: insert.promptSha256,
    promptVersion: insert.promptVersion,
    assemblyVersion: insert.assemblyVersion,
    afcGenerationId: insert.afcGenerationId,
    snapshot: structuredClone(insert.snapshot),
    compositeBucket: VIBODE_HARMONIZE_BUCKET,
    compositePath: insert.compositePath,
    promptPath: null,
    compositeByteLength: insert.compositeByteLength,
    compositeWidth: insert.compositeWidth,
    compositeHeight: insert.compositeHeight,
    outputBucket: null,
    outputPath: null,
    outputSha256: null,
    outputMime: null,
    outputWidth: null,
    outputHeight: null,
    provider: HARMONIZE_PROVIDER_ID,
    requestedModelId: HARMONIZE_NBP_MODEL_ID,
    returnedModelId: null,
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
    notBeforeMs: nowMs,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    completedAtMs: null,
  };
  db.jobs.push(job);
  return { ok: true, created: true, job };
}

export function claimNextHarmonizeJob(
  db: HarmonizeJobDatabase,
  nowMs: number,
  jobId: string | null = null,
): HarmonizeClaim | null {
  if (jobId !== null) {
    reapHarmonizeLeases(db, nowMs, jobId);
    const job = findJob(db, jobId);
    if (!job || job.status !== "queued" || job.notBeforeMs > nowMs) return null;
    return claimQueuedJob(db, job, nowMs);
  }
  reapHarmonizeLeases(db, nowMs, null);
  const queued = db.jobs
    .filter((job) => job.status === "queued" && job.notBeforeMs <= nowMs)
    .sort((left, right) => left.createdAtMs - right.createdAtMs);
  for (const job of queued) {
    const claimed = claimQueuedJob(db, job, nowMs);
    if (claimed) return claimed;
  }
  return null;
}

export function heartbeatHarmonizeJob(
  db: HarmonizeJobDatabase,
  input: Readonly<{ jobId: string; claimNonce: string; nowMs: number }>,
): boolean {
  const job = findJob(db, input.jobId);
  if (!job || !fenceHolds(job, input.claimNonce, input.nowMs)) return false;
  job.heartbeatAtMs = input.nowMs;
  job.claimExpiresAtMs = input.nowMs + HARMONIZE_JOB_CLAIM_LEASE_MS;
  job.updatedAtMs = input.nowMs;
  return true;
}

export function markHarmonizeProviderContact(
  db: HarmonizeJobDatabase,
  input: Readonly<{ jobId: string; claimNonce: string; nowMs: number }>,
):
  | Readonly<{ ok: true; attemptId: string }>
  | Readonly<{ ok: false; code: "stale_claim" | "already_contacted" | "daily_limit" }> {
  const job = findJob(db, input.jobId);
  if (!job || !fenceHolds(job, input.claimNonce, input.nowMs)) {
    return { ok: false, code: "stale_claim" };
  }
  if (job.providerStartedAtMs != null) return { ok: false, code: "already_contacted" };
  if (harmonizeProviderStartedCount(db, job.userId, input.nowMs) >= HARMONIZE_DAILY_PROVIDER_LIMIT) {
    failClosed(job, input.nowMs, "daily_limit", "Daily Harmonize provider limit was reached.");
    clearClaim(job);
    return { ok: false, code: "daily_limit" };
  }
  job.providerStartedAtMs = input.nowMs;
  job.providerAttemptId = randomUUID();
  job.updatedAtMs = input.nowMs;
  return { ok: true, attemptId: job.providerAttemptId };
}

export function completeHarmonizeJob(
  db: HarmonizeJobDatabase,
  input: Readonly<{
    jobId: string;
    claimNonce: string;
    nowMs: number;
    outputSha256: string;
    outputMime: "image/jpeg";
    outputWidth: number;
    outputHeight: number;
    outputPath: string;
    returnedModelId: string | null;
    providerStatus: string | null;
    providerHttpStatus: number | null;
    latencyMs: number;
  }>,
): Readonly<{ ok: true; code: "completed" | "already_complete" }> | Readonly<{ ok: false; code: "stale_claim" | "not_contacted" | "unexpected_output" }> {
  const job = findJob(db, input.jobId);
  if (!job) return { ok: false, code: "stale_claim" };
  if (job.status === "succeeded") {
    return job.claimNonce === input.claimNonce
      ? { ok: true, code: "already_complete" }
      : { ok: false, code: "stale_claim" };
  }
  if (!fenceHolds(job, input.claimNonce, input.nowMs)) return { ok: false, code: "stale_claim" };
  if (job.providerStartedAtMs == null) return { ok: false, code: "not_contacted" };
  if (input.outputMime !== "image/jpeg" || !storedOutputFrame(input.outputWidth, input.outputHeight)) {
    return { ok: false, code: "unexpected_output" };
  }
  job.status = "succeeded";
  job.outputBucket = VIBODE_HARMONIZE_BUCKET;
  job.outputPath = input.outputPath;
  job.outputSha256 = input.outputSha256;
  job.outputMime = input.outputMime;
  job.outputWidth = input.outputWidth;
  job.outputHeight = input.outputHeight;
  job.returnedModelId = input.returnedModelId;
  job.providerStatus = input.providerStatus;
  job.providerHttpStatus = input.providerHttpStatus;
  job.latencyMs = input.latencyMs;
  job.completedAtMs = input.nowMs;
  job.updatedAtMs = input.nowMs;
  job.failureCode = null;
  job.failureMessage = null;
  return { ok: true, code: "completed" };
}

export function failHarmonizeJob(
  db: HarmonizeJobDatabase,
  input: Readonly<{
    jobId: string;
    claimNonce: string;
    nowMs: number;
    code: string;
    message: string;
    retryable: boolean;
    providerStatus?: string | null;
    providerHttpStatus?: number | null;
    latencyMs?: number | null;
  }>,
): Readonly<{ ok: true; disposition: "requeued" | "failed" }> | Readonly<{ ok: false; code: "stale_claim" | "terminal" }> {
  const job = findJob(db, input.jobId);
  if (!job) return { ok: false, code: "stale_claim" };
  if (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") {
    return { ok: false, code: "terminal" };
  }
  if (!fenceHolds(job, input.claimNonce, input.nowMs)) return { ok: false, code: "stale_claim" };
  const contacted = job.providerStartedAtMs != null;
  const canRequeue = input.retryable
    && !contacted
    && job.attemptCount < HARMONIZE_JOB_MAX_PRECONTACT_ATTEMPTS;
  if (canRequeue) {
    job.status = "queued";
    job.notBeforeMs = input.nowMs + HARMONIZE_PRECONTACT_BACKOFF_MS;
    job.updatedAtMs = input.nowMs;
    clearClaim(job);
    return { ok: true, disposition: "requeued" };
  }
  failClosed(
    job,
    input.nowMs,
    contacted ? terminalCode(input.code) : input.code,
    input.message,
  );
  job.providerStatus = input.providerStatus ?? null;
  job.providerHttpStatus = input.providerHttpStatus ?? null;
  job.latencyMs = input.latencyMs ?? null;
  clearClaim(job);
  return { ok: true, disposition: "failed" };
}

export function readHarmonizeJob(
  db: HarmonizeJobDatabase,
  jobId: string,
): HarmonizeJobRow | null {
  return findJob(db, jobId) ?? null;
}

function claimQueuedJob(
  db: HarmonizeJobDatabase,
  job: HarmonizeJobRow,
  nowMs: number,
): HarmonizeClaim | null {
  if (harmonizeProviderStartedCount(db, job.userId, nowMs) >= HARMONIZE_DAILY_PROVIDER_LIMIT) {
    failClosed(job, nowMs, "daily_limit", "Daily Harmonize provider limit was reached.");
    return null;
  }
  job.status = "running";
  job.attemptCount += 1;
  job.claimedAtMs = nowMs;
  job.heartbeatAtMs = nowMs;
  job.claimExpiresAtMs = nowMs + HARMONIZE_JOB_CLAIM_LEASE_MS;
  job.claimNonce = randomUUID();
  job.updatedAtMs = nowMs;
  job.failureCode = null;
  job.failureMessage = null;
  return claimFrom(job);
}

function reapHarmonizeLeases(
  db: HarmonizeJobDatabase,
  nowMs: number,
  onlyJobId: string | null,
): void {
  for (const job of db.jobs) {
    if (onlyJobId !== null && job.id !== onlyJobId) continue;
    if (job.status !== "running" || job.claimExpiresAtMs == null || job.claimExpiresAtMs > nowMs) {
      continue;
    }
    if (job.providerStartedAtMs != null) {
      failClosed(job, nowMs, "provider_uncertain", "Provider contact lease expired before a confirmed result.");
      clearClaim(job);
      continue;
    }
    if (job.attemptCount < HARMONIZE_JOB_MAX_PRECONTACT_ATTEMPTS) {
      job.status = "queued";
      job.notBeforeMs = nowMs;
      job.updatedAtMs = nowMs;
      clearClaim(job);
      continue;
    }
    failClosed(job, nowMs, "attempts_exhausted", "Harmonize stopped before contacting the provider.");
    clearClaim(job);
  }
}

function failClosed(job: HarmonizeJobRow, nowMs: number, code: string, message: string): void {
  job.status = "failed";
  job.failureCode = code;
  job.failureMessage = redactHarmonizeDiagnostic(message);
  job.completedAtMs = nowMs;
  job.updatedAtMs = nowMs;
}

function fenceHolds(job: HarmonizeJobRow, claimNonce: string, nowMs: number): boolean {
  return job.status === "running"
    && job.claimNonce === claimNonce
    && job.claimExpiresAtMs != null
    && job.claimExpiresAtMs > nowMs;
}

function clearClaim(job: HarmonizeJobRow): void {
  job.claimNonce = null;
  job.claimExpiresAtMs = null;
  job.claimedAtMs = null;
  job.heartbeatAtMs = null;
}

function claimFrom(job: HarmonizeJobRow): HarmonizeClaim {
  const claimNonce = job.claimNonce;
  const claimExpiresAtMs = job.claimExpiresAtMs;
  if (!claimNonce || claimExpiresAtMs == null) {
    throw new Error("Harmonize claim is missing its fence.");
  }
  return {
    jobId: job.id,
    userId: job.userId,
    roomId: job.roomId,
    claimNonce,
    claimExpiresAtMs,
    attemptCount: job.attemptCount,
    prompt: job.snapshot.prompt,
    promptSha256: job.promptSha256,
    compositeSha256: job.compositeSha256,
    compositeWidth: job.compositeWidth,
    compositeHeight: job.compositeHeight,
    requestedModelId: job.requestedModelId,
  };
}

function findJob(db: HarmonizeJobDatabase, jobId: string): HarmonizeJobRow | null {
  return db.jobs.find((job) => job.id === jobId) ?? null;
}

function isActive(job: HarmonizeJobRow): boolean {
  return job.status === "queued" || job.status === "running";
}

function storedOutputFrame(width: number, height: number): boolean {
  return Number.isInteger(width) && Number.isInteger(height) && width >= 1 && height >= 1 && width <= 8192 && height <= 8192;
}

function terminalCode(code: string): string {
  if (code === "provider_rejected" || code === "unexpected_output" || code === "provider_uncertain") {
    return code;
  }
  return "provider_uncertain";
}
