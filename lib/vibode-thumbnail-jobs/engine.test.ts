import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  claimNextThumbnailJob,
  clearThumbnailForEmptyScene,
  createThumbnailJobDatabase,
  enqueueThumbnailJob,
  failThumbnailJob,
  publishThumbnailJob,
  type ThumbnailJobDatabase,
  type ThumbnailSceneSnapshot,
} from "./engine";
import {
  VIBODE_3D_THUMBNAIL_BUCKET,
  VIBODE_3D_THUMBNAIL_CACHE_CONTROL,
  VIBODE_THUMBNAIL_JOB_CLAIM_LEASE_SEC,
  VIBODE_THUMBNAIL_JOB_MAX_ATTEMPTS,
  VIBODE_THUMBNAIL_JOB_QUIET_WINDOW_SEC,
  VIBODE_THUMBNAIL_JOB_RETRY_BACKOFF_SEC,
  thumbnailJobRetryBackoffSec,
  vibode3dThumbnailObjectPath,
} from "./policy";

const ROOM = "11111111-1111-4111-8111-111111111111";
const VERSION = "22222222-2222-4222-8222-222222222222";
const GENERATION = "33333333-3333-4333-8333-333333333333";
const TOKEN_A = "a".repeat(64);
const TOKEN_B = "b".repeat(64);
const TOKEN_C = "c".repeat(64);

function scene(objectsKey: string, empty = false, sceneUpdatedAtMs = 0): ThumbnailSceneSnapshot {
  return {
    empty,
    afcGenerationId: GENERATION,
    objectsKey,
    backgroundBucket: "room-images",
    backgroundPath: "rooms/bg.jpg",
    sceneUpdatedAtMs,
  };
}

function seed(objectsKey = TOKEN_A): ThumbnailJobDatabase {
  const db = createThumbnailJobDatabase();
  db.scene = scene(objectsKey);
  return db;
}

function enqueue(
  db: ThumbnailJobDatabase,
  token: string,
  nowMs: number,
  notBeforeMs = nowMs,
) {
  return enqueueThumbnailJob(db, {
    roomId: ROOM,
    versionId: VERSION,
    afcGenerationId: GENERATION,
    contentToken: token,
    notBeforeMs,
    nowMs,
  });
}

function publish(
  db: ThumbnailJobDatabase,
  job: { id: string; claimNonce: string | null; claimContentToken: string | null },
  objectsKey: string,
  nowMs: number,
) {
  return publishThumbnailJob(db, {
    jobId: job.id,
    claimNonce: job.claimNonce ?? "",
    contentToken: job.claimContentToken ?? "",
    afcGenerationId: GENERATION,
    objectsKey,
    backgroundBucket: "room-images",
    backgroundPath: "rooms/bg.jpg",
    sceneUpdatedAtMs: db.scene?.sceneUpdatedAtMs ?? 0,
    nowMs,
  });
}

test("quiet window and retry policy are explicit", () => {
  assert.equal(VIBODE_THUMBNAIL_JOB_QUIET_WINDOW_SEC, 4);
  assert.equal(VIBODE_THUMBNAIL_JOB_CLAIM_LEASE_SEC, 180);
  assert.equal(VIBODE_THUMBNAIL_JOB_MAX_ATTEMPTS, 3);
  assert.deepEqual(VIBODE_THUMBNAIL_JOB_RETRY_BACKOFF_SEC, [15, 60, 180]);
  assert.equal(thumbnailJobRetryBackoffSec(1), 15);
  assert.equal(thumbnailJobRetryBackoffSec(2), 60);
  assert.equal(thumbnailJobRetryBackoffSec(3), null);
  assert.equal(
    VIBODE_3D_THUMBNAIL_CACHE_CONTROL,
    "public, max-age=31536000, immutable",
  );
});

test("first scene creates one pending job and repeats stay one row", () => {
  const db = seed();
  const first = enqueue(db, TOKEN_A, 1_000, 5_000);
  assert.equal(first.status, "pending");
  assert.equal(first.attemptCount, 0);
  enqueue(db, TOKEN_A, 2_000, 6_000);
  enqueue(db, TOKEN_A, 3_000, 7_000);
  enqueue(db, TOKEN_B, 4_000, 8_000);
  enqueue(db, TOKEN_C, 5_000, 9_000);
  assert.equal(db.jobs.length, 1);
  assert.equal(db.jobs[0]?.contentToken, TOKEN_C);
  assert.equal(db.jobs[0]?.notBeforeMs, 9_000);
  assert.equal(db.jobs[0]?.id, first.id);
  assert.equal(db.jobs[0]?.attemptCount, 0);
});

test("an older scene stamp cannot overwrite a newer desired token", () => {
  const db = seed();
  const job = enqueueThumbnailJob(db, {
    roomId: ROOM,
    versionId: VERSION,
    afcGenerationId: GENERATION,
    contentToken: TOKEN_B,
    notBeforeMs: 5_000,
    nowMs: 2_000,
    sceneUpdatedAtMs: 2_000,
  });
  enqueueThumbnailJob(db, {
    roomId: ROOM,
    versionId: VERSION,
    afcGenerationId: GENERATION,
    contentToken: TOKEN_A,
    notBeforeMs: 9_000,
    nowMs: 3_000,
    sceneUpdatedAtMs: 1_000,
  });
  assert.equal(db.jobs.length, 1);
  assert.equal(job.contentToken, TOKEN_B);
  assert.equal(job.notBeforeMs, 5_000);
  enqueueThumbnailJob(db, {
    roomId: ROOM,
    versionId: VERSION,
    afcGenerationId: GENERATION,
    contentToken: TOKEN_C,
    notBeforeMs: 4_000,
    nowMs: 4_000,
    sceneUpdatedAtMs: 4_000,
  });
  assert.equal(job.contentToken, TOKEN_C);
  assert.equal(job.status, "pending");
});

test("publish uses the canonical scene revision, not an ignored extra field", () => {
  const db = seed(TOKEN_A);
  db.scene = scene(TOKEN_A, false, 10);
  const job = enqueue(db, TOKEN_A, 0, 0);
  claimNextThumbnailJob(db, 0);
  const sameCanonical = publish(db, job, TOKEN_A, 20);
  assert.equal(sameCanonical.ok, true);
  if (!sameCanonical.ok) return;
  assert.equal(sameCanonical.pointer.contentToken, TOKEN_A);
});

test("an intervening scene revision rejects publish of the previous token", () => {
  const db = seed(TOKEN_A);
  db.scene = scene(TOKEN_A, false, 11);
  const job = enqueue(db, TOKEN_A, 0, 0);
  claimNextThumbnailJob(db, 0);
  const staleRead = publishThumbnailJob(db, {
    jobId: job.id,
    claimNonce: job.claimNonce ?? "",
    contentToken: TOKEN_A,
    afcGenerationId: GENERATION,
    objectsKey: TOKEN_A,
    backgroundBucket: "room-images",
    backgroundPath: "rooms/bg.jpg",
    sceneUpdatedAtMs: 10,
    nowMs: 30,
  });
  assert.equal(staleRead.ok, false);
  assert.equal(db.pointers.length, 0);
});

test("the same pending token keeps its attempt count and moves the quiet window", () => {
  const db = seed();
  const job = enqueue(db, TOKEN_A, 0, 0);
  const claimed = claimNextThumbnailJob(db, 0);
  assert.ok(claimed);
  failThumbnailJob(db, {
    jobId: job.id,
    claimNonce: claimed?.claimNonce ?? "",
    code: "signed_url_failed",
    message: "temporary",
    nowMs: 1_000,
  });
  assert.equal(job.attemptCount, 1);
  assert.equal(job.notBeforeMs, 1_000 + 15_000);
  enqueue(db, TOKEN_A, 2_000, 20_000);
  assert.equal(db.jobs.length, 1);
  assert.equal(job.attemptCount, 1);
  assert.equal(job.notBeforeMs, 20_000);
  assert.equal(job.status, "pending");
});

test("only a due job can be claimed and a second worker misses the lease", () => {
  const db = seed();
  enqueue(db, TOKEN_A, 0, 10_000);
  assert.equal(claimNextThumbnailJob(db, 9_999), null);
  const first = claimNextThumbnailJob(db, 10_000);
  const second = claimNextThumbnailJob(db, 10_000);
  assert.ok(first);
  assert.equal(second, null);
  assert.equal(first?.status, "running");
  assert.equal(first?.attemptCount, 1);
  assert.equal(first?.claimExpiresAtMs, 10_000 + 180_000);
  assert.equal(db.jobs.length, 1);
});

test("an expired lease can be reclaimed with a new nonce", () => {
  const db = seed();
  enqueue(db, TOKEN_A, 0, 0);
  const first = claimNextThumbnailJob(db, 0);
  const firstNonce = first?.claimNonce;
  assert.equal(claimNextThumbnailJob(db, 179_999), null);
  const reclaimed = claimNextThumbnailJob(db, 180_000);
  assert.ok(reclaimed);
  assert.notEqual(reclaimed?.claimNonce, firstNonce);
  assert.equal(reclaimed?.attemptCount, 2);
  assert.equal(reclaimed?.claimContentToken, TOKEN_A);
});

test("a matching token publishes and a repeated publish is idempotent", () => {
  const db = seed(TOKEN_A);
  const job = enqueue(db, TOKEN_A, 0, 0);
  const claimed = claimNextThumbnailJob(db, 0);
  assert.ok(claimed);
  const published = publish(db, job, TOKEN_A, 1_000);
  assert.equal(published.ok, true);
  if (!published.ok) return;
  assert.equal(published.pointer.contentToken, TOKEN_A);
  assert.equal(published.pointer.storageBucket, VIBODE_3D_THUMBNAIL_BUCKET);
  assert.equal(
    published.pointer.storagePath,
    vibode3dThumbnailObjectPath(ROOM, VERSION, TOKEN_A),
  );
  assert.equal(job.status, "completed");
  const again = publish(db, { ...job, claimNonce: "gone", claimContentToken: TOKEN_A }, TOKEN_A, 2_000);
  assert.equal(again.ok, true);
  if (!again.ok) return;
  assert.equal(again.idempotent, true);
  assert.equal(db.pointers.length, 1);
  assert.equal(db.pointers[0]?.generatedAtMs, 1_000);
});

test("a stale running job cannot replace the current or previous pointer", () => {
  const db = seed(TOKEN_A);
  const previous = enqueue(db, TOKEN_A, 0, 0);
  const claimedA = claimNextThumbnailJob(db, 0);
  assert.ok(claimedA);
  const publishedA = publish(db, previous, TOKEN_A, 500);
  assert.equal(publishedA.ok, true);

  db.scene = scene(TOKEN_B);
  enqueue(db, TOKEN_B, 800, 800);
  const claimedB = claimNextThumbnailJob(db, 800);
  assert.equal(claimedB?.claimContentToken, TOKEN_B);
  db.scene = scene(TOKEN_C);
  const newer = enqueue(db, TOKEN_C, 1_000, 1_000);
  assert.equal(db.jobs.length, 1);
  assert.equal(newer.status, "running");
  assert.equal(newer.claimContentToken, TOKEN_B);
  assert.equal(newer.contentToken, TOKEN_C);

  const stale = publish(db, newer, TOKEN_B, 1_500);
  assert.equal(stale.ok, false);
  if (stale.ok) return;
  assert.equal(stale.code, "stale_publish");
  assert.equal(db.pointers[0]?.contentToken, TOKEN_A);
  assert.equal(newer.status, "pending");
  assert.equal(newer.contentToken, TOKEN_C);
  assert.equal(newer.attemptCount, 0);

  db.scene = scene(TOKEN_C);
  const claimedC = claimNextThumbnailJob(db, 1_000);
  assert.equal(claimedC?.claimContentToken, TOKEN_C);
  const publishedB = publish(db, newer, TOKEN_C, 2_000);
  assert.equal(publishedB.ok, true);
  if (!publishedB.ok) return;
  assert.equal(publishedB.pointer.contentToken, TOKEN_C);
  assert.equal(db.pointers.length, 1);
});

test("stale publish leaves an empty pointer empty", () => {
  const db = seed(TOKEN_A);
  const job = enqueue(db, TOKEN_A, 0, 0);
  claimNextThumbnailJob(db, 0);
  db.scene = scene(TOKEN_B);
  enqueue(db, TOKEN_B, 1_000, 1_000);
  db.pointers = [];
  const stale = publish(db, job, TOKEN_A, 1_500);
  assert.equal(stale.ok, false);
  assert.equal(db.pointers.length, 0);
});

test("empty scene clears the pointer and blocks a stale republish", () => {
  const db = seed(TOKEN_A);
  const job = enqueue(db, TOKEN_A, 0, 0);
  claimNextThumbnailJob(db, 0);
  publish(db, job, TOKEN_A, 100);
  assert.equal(db.pointers[0]?.contentToken, TOKEN_A);

  db.scene = scene(TOKEN_B);
  enqueue(db, TOKEN_B, 200, 200);
  const running = claimNextThumbnailJob(db, 200);
  assert.equal(running?.claimContentToken, TOKEN_B);
  db.scene = scene(TOKEN_B, true);
  clearThumbnailForEmptyScene(db, { roomId: ROOM, versionId: VERSION, nowMs: 300 });
  assert.equal(db.pointers.length, 0);
  assert.equal(job.desiredOutcome, "clear");
  assert.equal(job.status, "running");

  const republish = publish(db, job, TOKEN_B, 400);
  assert.equal(republish.ok, false);
  if (republish.ok) return;
  assert.equal(republish.code, "stale_publish");
  assert.equal(db.pointers.length, 0);
  assert.equal(job.status, "superseded");

  const dbPending = seed(TOKEN_A);
  enqueue(dbPending, TOKEN_A, 0, 0);
  dbPending.pointers.push({
    roomId: ROOM,
    versionId: VERSION,
    afcGenerationId: GENERATION,
    contentToken: TOKEN_A,
    storageBucket: VIBODE_3D_THUMBNAIL_BUCKET,
    storagePath: vibode3dThumbnailObjectPath(ROOM, VERSION, TOKEN_A) ?? "",
    generatedAtMs: 1,
    updatedAtMs: 1,
  });
  clearThumbnailForEmptyScene(dbPending, { roomId: ROOM, versionId: VERSION, nowMs: 2 });
  assert.equal(dbPending.pointers.length, 0);
  assert.equal(dbPending.jobs[0]?.status, "superseded");
  assert.equal(claimNextThumbnailJob(dbPending, 3), null);
});

test("retryable failure backs off and the third attempt fails without clearing a pointer", () => {
  const db = seed(TOKEN_A);
  const job = enqueue(db, TOKEN_A, 0, 0);
  claimNextThumbnailJob(db, 0);
  publish(db, job, TOKEN_A, 10);
  enqueue(db, TOKEN_B, 15, 15);
  db.scene = scene(TOKEN_B);
  const first = claimNextThumbnailJob(db, 15);
  const pointer = db.pointers[0]?.contentToken;
  failThumbnailJob(db, {
    jobId: job.id,
    claimNonce: first?.claimNonce ?? "",
    code: "glb_load_failed",
    message: "x".repeat(400),
    nowMs: 20,
  });
  assert.equal(job.status, "pending");
  assert.equal(job.attemptCount, 1);
  assert.equal(job.notBeforeMs, 20 + 15_000);
  assert.equal(job.lastErrorMessage?.length, 240);
  assert.equal(db.pointers[0]?.contentToken, pointer);

  const second = claimNextThumbnailJob(db, job.notBeforeMs);
  failThumbnailJob(db, {
    jobId: job.id,
    claimNonce: second?.claimNonce ?? "",
    code: "upload_failed",
    message: "upload",
    nowMs: job.notBeforeMs + 1,
  });
  assert.equal(job.attemptCount, 2);
  assert.equal(job.notBeforeMs, job.notBeforeMs);

  const thirdAt = job.notBeforeMs;
  const third = claimNextThumbnailJob(db, thirdAt);
  const failed = failThumbnailJob(db, {
    jobId: job.id,
    claimNonce: third?.claimNonce ?? "",
    code: "render_page_error",
    message: "page",
    nowMs: thirdAt + 1,
  });
  assert.equal(failed.ok, true);
  if (!failed.ok) return;
  assert.equal(failed.status, "failed");
  assert.equal(job.attemptCount, 3);
  assert.equal(db.pointers[0]?.contentToken, TOKEN_A);

  enqueue(db, TOKEN_B, thirdAt + 2, thirdAt + 2);
  assert.equal(job.status, "pending");
  assert.equal(job.contentToken, TOKEN_B);
  assert.equal(job.attemptCount, 0);
  assert.equal(db.pointers[0]?.contentToken, TOKEN_A);
});

test("non-retryable failure is terminal and a storage path cannot be chosen by the caller", () => {
  const db = seed(TOKEN_A);
  const job = enqueue(db, TOKEN_A, 0, 0);
  const claimed = claimNextThumbnailJob(db, 0);
  const failed = failThumbnailJob(db, {
    jobId: job.id,
    claimNonce: claimed?.claimNonce ?? "",
    code: "glb_identity_missing",
    message: "unknown asset",
    nowMs: 5,
  });
  assert.equal(failed.ok, true);
  if (!failed.ok) return;
  assert.equal(failed.status, "failed");
  assert.equal(db.pointers.length, 0);
  assert.equal(vibode3dThumbnailObjectPath(ROOM, VERSION, "latest"), null);
  assert.equal(vibode3dThumbnailObjectPath(ROOM, VERSION, "../secret"), null);
  const rejected = publishThumbnailJob(db, {
    jobId: job.id,
    claimNonce: "nope",
    contentToken: "not-a-token",
    afcGenerationId: GENERATION,
    objectsKey: TOKEN_A,
    backgroundBucket: "room-images",
    backgroundPath: "rooms/bg.jpg",
    sceneUpdatedAtMs: 0,
    nowMs: 6,
  });
  assert.equal(rejected.ok, false);
  if (rejected.ok) return;
  assert.equal(rejected.code, "invalid_storage_path");
});

test("thumbnail job migration is service-role only and locks claims in postgres", () => {
  const sql = readFileSync(
    path.join(process.cwd(), "supabase/migrations/20260924200000_vibode_3d_thumbnail_jobs.sql"),
    "utf8",
  );
  assert.match(sql, /create table public\.vibode_3d_thumbnail_jobs/);
  assert.match(sql, /create table public\.vibode_3d_thumbnail_pointers/);
  assert.match(sql, /vibode_3d_thumbnail_jobs_room_version_key unique \(room_id, version_id\)/);
  assert.match(sql, /primary key \(version_id\)/);
  assert.match(sql, /for update skip locked/);
  assert.match(sql, /security definer/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table public\.vibode_3d_thumbnail_jobs from public, anon, authenticated/);
  assert.match(sql, /revoke all on table public\.vibode_3d_thumbnail_pointers from public, anon, authenticated/);
  assert.match(sql, /grant select, insert, update, delete on table public\.vibode_3d_thumbnail_jobs to service_role/);
  assert.match(sql, /grant execute on function public\.claim_next_vibode_3d_thumbnail_job\(\)/);
  assert.match(sql, /to service_role/);
  assert.match(sql, /when 1 then 15/);
  assert.match(sql, /when 2 then 60/);
  assert.match(sql, /else 180/);
  assert.match(sql, /interval '180 seconds'/);
  assert.match(sql, /storage_bucket = 'vibode-thumbnails'/);
  assert.match(sql, /on conflict \(room_id, version_id\) do update/);
  assert.match(sql, /desired_scene_updated_at/);
  assert.match(sql, /v_scene\.updated_at is distinct from p_scene_updated_at/);
  assert.doesNotMatch(sql, /enqueue_conflict/);
  assert.doesNotMatch(sql, /objects_json is distinct from/);
  assert.doesNotMatch(sql, /thumbnail_storage_bucket/);
  assert.doesNotMatch(sql, /grant .* to authenticated/);
});
