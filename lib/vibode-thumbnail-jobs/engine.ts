/**
 * In-memory model of the thumbnail job RPCs.
 *
 * Production claim and publish locking lives in Postgres
 * (`FOR UPDATE SKIP LOCKED` and the publish function). This module is the
 * local certification double and must stay aligned with that SQL.
 *
 * One row per room version. A running claim and a newer desired token
 * share that row: `claimContentToken` is the in-flight render, and
 * `contentToken` is the latest scene. Publish is refused when they differ.
 */

import { randomUUID } from "node:crypto";

import {
  VIBODE_3D_THUMBNAIL_BUCKET,
  VIBODE_THUMBNAIL_JOB_CLAIM_LEASE_SEC,
  VIBODE_THUMBNAIL_JOB_MAX_ATTEMPTS,
  boundThumbnailJobErrorMessage,
  thumbnailJobFailureIsRetryable,
  thumbnailJobRetryBackoffSec,
  vibode3dThumbnailObjectPath,
} from "./policy";

export type ThumbnailJobStatus =
  | "pending"
  | "running"
  | "failed"
  | "superseded"
  | "completed";

export type ThumbnailDesiredOutcome = "render" | "clear";

export type ThumbnailJobRow = {
  id: string;
  roomId: string;
  versionId: string;
  afcGenerationId: string;
  contentToken: string;
  status: ThumbnailJobStatus;
  desiredOutcome: ThumbnailDesiredOutcome;
  notBeforeMs: number;
  attemptCount: number;
  claimedAtMs: number | null;
  claimExpiresAtMs: number | null;
  claimContentToken: string | null;
  claimNonce: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  desiredSceneUpdatedAtMs: number;
  createdAtMs: number;
  updatedAtMs: number;
};

export type ThumbnailPointerRow = {
  roomId: string;
  versionId: string;
  afcGenerationId: string;
  contentToken: string;
  storageBucket: string;
  storagePath: string;
  generatedAtMs: number;
  updatedAtMs: number;
};

export type ThumbnailSceneSnapshot = Readonly<{
  empty: boolean;
  afcGenerationId: string;
  objectsKey: string;
  backgroundBucket: string;
  backgroundPath: string;
  sceneUpdatedAtMs: number;
}>;

export type ThumbnailJobDatabase = {
  jobs: ThumbnailJobRow[];
  pointers: ThumbnailPointerRow[];
  scene: ThumbnailSceneSnapshot | null;
};

export function createThumbnailJobDatabase(): ThumbnailJobDatabase {
  return { jobs: [], pointers: [], scene: null };
}

export function enqueueThumbnailJob(
  db: ThumbnailJobDatabase,
  input: Readonly<{
    roomId: string;
    versionId: string;
    afcGenerationId: string;
    contentToken: string;
    notBeforeMs: number;
    nowMs: number;
    sceneUpdatedAtMs?: number;
    id?: string;
  }>,
): ThumbnailJobRow {
  const sceneUpdatedAtMs = input.sceneUpdatedAtMs ?? input.nowMs;
  const existing = findJob(db, input.roomId, input.versionId);
  if (!existing) {
    const created = newJob({ ...input, sceneUpdatedAtMs });
    db.jobs.push(created);
    return created;
  }
  if (sceneUpdatedAtMs < existing.desiredSceneUpdatedAtMs) return existing;
  existing.updatedAtMs = input.nowMs;
  existing.desiredSceneUpdatedAtMs = sceneUpdatedAtMs;
  existing.afcGenerationId = input.afcGenerationId;
  existing.desiredOutcome = "render";
  if (existing.status === "running") {
    existing.contentToken = input.contentToken;
    existing.notBeforeMs = input.notBeforeMs;
    return existing;
  }
  if (existing.status === "completed" && existing.contentToken === input.contentToken) {
    return existing;
  }
  const samePending = existing.status === "pending" &&
    existing.contentToken === input.contentToken;
  existing.contentToken = input.contentToken;
  existing.notBeforeMs = input.notBeforeMs;
  existing.status = "pending";
  if (!samePending) {
    existing.attemptCount = 0;
    existing.lastErrorCode = null;
    existing.lastErrorMessage = null;
  }
  clearClaim(existing);
  return existing;
}

export function clearThumbnailForEmptyScene(
  db: ThumbnailJobDatabase,
  input: Readonly<{ roomId: string; versionId: string; nowMs: number }>,
): void {
  db.pointers = db.pointers.filter((pointer) =>
    pointer.roomId !== input.roomId || pointer.versionId !== input.versionId
  );
  const job = findJob(db, input.roomId, input.versionId);
  if (!job) return;
  job.updatedAtMs = input.nowMs;
  job.desiredOutcome = "clear";
  if (job.status === "running") return;
  job.status = "superseded";
  clearClaim(job);
  job.lastErrorCode = null;
  job.lastErrorMessage = null;
}

export function claimNextThumbnailJob(
  db: ThumbnailJobDatabase,
  nowMs: number,
): ThumbnailJobRow | null {
  for (const job of db.jobs) {
    const expired = job.status === "running" &&
      job.claimExpiresAtMs != null &&
      job.claimExpiresAtMs <= nowMs;
    if (!expired) continue;
    if (job.desiredOutcome === "clear" || job.attemptCount >= VIBODE_THUMBNAIL_JOB_MAX_ATTEMPTS) {
      job.status = job.desiredOutcome === "clear" ? "superseded" : "failed";
      if (job.status === "failed") {
        job.lastErrorCode = "claim_expired";
        job.lastErrorMessage = "Claim lease expired after the last attempt.";
      }
      clearClaim(job);
      job.updatedAtMs = nowMs;
    }
  }
  const due = db.jobs
    .filter((job) => {
      if (job.desiredOutcome !== "render") return false;
      if (job.status === "pending" && job.notBeforeMs <= nowMs) return true;
      return job.status === "running" &&
        job.claimExpiresAtMs != null &&
        job.claimExpiresAtMs <= nowMs &&
        job.attemptCount < VIBODE_THUMBNAIL_JOB_MAX_ATTEMPTS;
    })
    .sort((a, b) => a.notBeforeMs - b.notBeforeMs || a.createdAtMs - b.createdAtMs);
  const job = due[0];
  if (!job) return null;
  job.status = "running";
  job.attemptCount += 1;
  job.claimedAtMs = nowMs;
  job.claimExpiresAtMs = nowMs + VIBODE_THUMBNAIL_JOB_CLAIM_LEASE_SEC * 1000;
  job.claimContentToken = job.contentToken;
  job.claimNonce = randomUUID();
  job.lastErrorCode = null;
  job.lastErrorMessage = null;
  job.updatedAtMs = nowMs;
  return job;
}

export function failThumbnailJob(
  db: ThumbnailJobDatabase,
  input: Readonly<{
    jobId: string;
    claimNonce: string;
    code: string;
    message: string;
    nowMs: number;
  }>,
): { ok: true; status: ThumbnailJobStatus } | { ok: false; code: string } {
  const job = db.jobs.find((row) => row.id === input.jobId);
  if (!job || job.status !== "running" || job.claimNonce !== input.claimNonce) {
    return { ok: false, code: "not_claimed" };
  }
  if (job.claimExpiresAtMs == null || job.claimExpiresAtMs <= input.nowMs) {
    return { ok: false, code: "claim_expired" };
  }
  job.updatedAtMs = input.nowMs;
  if (job.desiredOutcome === "clear") {
    job.status = "superseded";
    clearClaim(job);
    return { ok: true, status: job.status };
  }
  if (job.contentToken !== job.claimContentToken) {
    job.status = "pending";
    job.attemptCount = 0;
    job.lastErrorCode = null;
    job.lastErrorMessage = null;
    clearClaim(job);
    return { ok: true, status: job.status };
  }
  const retryable = thumbnailJobFailureIsRetryable(input.code);
  const delay = retryable ? thumbnailJobRetryBackoffSec(job.attemptCount) : null;
  job.lastErrorCode = input.code;
  job.lastErrorMessage = boundThumbnailJobErrorMessage(input.message);
  clearClaim(job);
  if (delay == null) {
    job.status = "failed";
    return { ok: true, status: job.status };
  }
  job.status = "pending";
  job.notBeforeMs = input.nowMs + delay * 1000;
  return { ok: true, status: job.status };
}

export function publishThumbnailJob(
  db: ThumbnailJobDatabase,
  input: Readonly<{
    jobId: string;
    claimNonce: string;
    contentToken: string;
    afcGenerationId: string;
    objectsKey: string;
    backgroundBucket: string;
    backgroundPath: string;
    sceneUpdatedAtMs: number;
    nowMs: number;
  }>,
): { ok: true; pointer: ThumbnailPointerRow; idempotent: boolean } | { ok: false; code: "stale_publish" | "not_claimed" | "invalid_storage_path" } {
  const job = db.jobs.find((row) => row.id === input.jobId);
  if (!job) return { ok: false, code: "not_claimed" };
  const path = vibode3dThumbnailObjectPath(job.roomId, job.versionId, input.contentToken);
  if (!path) return { ok: false, code: "invalid_storage_path" };
  const existingPointer = db.pointers.find((pointer) => pointer.versionId === job.versionId);
  if (
    job.status === "completed" &&
    job.contentToken === input.contentToken &&
    existingPointer?.contentToken === input.contentToken &&
    existingPointer.storagePath === path
  ) {
    return { ok: true, pointer: existingPointer, idempotent: true };
  }
  if (job.status !== "running" || job.claimNonce !== input.claimNonce) {
    return { ok: false, code: "not_claimed" };
  }
  if (job.claimExpiresAtMs == null || job.claimExpiresAtMs <= input.nowMs) {
    return { ok: false, code: "not_claimed" };
  }
  if (job.claimContentToken !== input.contentToken) {
    return { ok: false, code: "not_claimed" };
  }
  const scene = db.scene;
  const empty = !scene || scene.empty;
  const snapshotMatches = !!scene &&
    !scene.empty &&
    scene.afcGenerationId === input.afcGenerationId &&
    scene.afcGenerationId === job.afcGenerationId &&
    scene.objectsKey === input.objectsKey &&
    scene.sceneUpdatedAtMs === input.sceneUpdatedAtMs &&
    scene.backgroundBucket === input.backgroundBucket &&
    scene.backgroundPath === input.backgroundPath;
  const fresh = job.desiredOutcome === "render" &&
    job.contentToken === input.contentToken &&
    snapshotMatches;
  if (!fresh || empty) {
    if (empty) {
      db.pointers = db.pointers.filter((pointer) => pointer.versionId !== job.versionId);
      job.desiredOutcome = "clear";
      job.status = "superseded";
    } else if (job.contentToken !== job.claimContentToken) {
      job.status = "pending";
      job.attemptCount = 0;
      job.lastErrorCode = null;
      job.lastErrorMessage = null;
    } else {
      job.status = "superseded";
    }
    clearClaim(job);
    job.updatedAtMs = input.nowMs;
    return { ok: false, code: "stale_publish" };
  }
  const pointer: ThumbnailPointerRow = existingPointer &&
      existingPointer.contentToken === input.contentToken &&
      existingPointer.storagePath === path
    ? existingPointer
    : {
      roomId: job.roomId,
      versionId: job.versionId,
      afcGenerationId: job.afcGenerationId,
      contentToken: input.contentToken,
      storageBucket: VIBODE_3D_THUMBNAIL_BUCKET,
      storagePath: path,
      generatedAtMs: input.nowMs,
      updatedAtMs: input.nowMs,
    };
  pointer.updatedAtMs = input.nowMs;
  if (!existingPointer || existingPointer !== pointer) {
    db.pointers = db.pointers.filter((row) => row.versionId !== job.versionId);
    db.pointers.push(pointer);
  }
  job.status = "completed";
  job.lastErrorCode = null;
  job.lastErrorMessage = null;
  clearClaim(job);
  job.updatedAtMs = input.nowMs;
  return { ok: true, pointer, idempotent: existingPointer === pointer };
}

function findJob(
  db: ThumbnailJobDatabase,
  roomId: string,
  versionId: string,
): ThumbnailJobRow | undefined {
  return db.jobs.find((job) => job.roomId === roomId && job.versionId === versionId);
}

function clearClaim(job: ThumbnailJobRow): void {
  job.claimedAtMs = null;
  job.claimExpiresAtMs = null;
  job.claimContentToken = null;
  job.claimNonce = null;
}

function newJob(input: Readonly<{
  roomId: string;
  versionId: string;
  afcGenerationId: string;
  contentToken: string;
  notBeforeMs: number;
  nowMs: number;
  sceneUpdatedAtMs: number;
  id?: string;
}>): ThumbnailJobRow {
  return {
    id: input.id ?? randomUUID(),
    roomId: input.roomId,
    versionId: input.versionId,
    afcGenerationId: input.afcGenerationId,
    contentToken: input.contentToken,
    status: "pending",
    desiredOutcome: "render",
    notBeforeMs: input.notBeforeMs,
    attemptCount: 0,
    claimedAtMs: null,
    claimExpiresAtMs: null,
    claimContentToken: null,
    claimNonce: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    desiredSceneUpdatedAtMs: input.sceneUpdatedAtMs,
    createdAtMs: input.nowMs,
    updatedAtMs: input.nowMs,
  };
}
