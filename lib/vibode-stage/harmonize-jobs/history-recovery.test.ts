import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { createHarmonizeFakeJpeg } from "@/lib/vibode-stage/harmonize-jobs/fake-jpeg";
import {
  classifyHarmonizeObjectRead,
  executeHarmonizeRecoveryAttempt,
  settlementForHistoryPublication,
} from "@/lib/vibode-stage/harmonize-jobs/history-recovery";
import {
  createHarmonizeHistoryObjectStore,
  publishPreparedHarmonizeHistory,
  type HarmonizeHistoryPublicationResult,
  type HarmonizePublicationJob,
} from "@/lib/vibode-stage/harmonize-jobs/history-publication";
import {
  HARMONIZE_RECOVERY_BACKOFF_MS,
  HARMONIZE_RECOVERY_LEASE_SEC,
  HARMONIZE_RECOVERY_MAX_ATTEMPTS,
  VIBODE_HARMONIZE_BUCKET,
  VIBODE_HISTORY_BUCKET,
  harmonizeHistoryObjectPath,
} from "@/lib/vibode-stage/harmonize-jobs/policy";
import {
  HARMONIZE_NBP_OUTPUT_HEIGHT,
  HARMONIZE_NBP_OUTPUT_WIDTH,
} from "@/lib/vibode-stage/harmonize-nbp-proof";

const JOB = "11111111-1111-4111-8111-111111111111";
const ROOM = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const ASSET = "44444444-4444-4444-8444-444444444444";
const NONCE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

test("recovery backoff keeps the reserved final interval and a two minute lease", () => {
  assert.deepEqual(HARMONIZE_RECOVERY_BACKOFF_MS, [5_000, 15_000, 45_000, 180_000, 900_000]);
  assert.equal(HARMONIZE_RECOVERY_MAX_ATTEMPTS, 5);
  assert.equal(HARMONIZE_RECOVERY_LEASE_SEC, 120);
  const sql = readFileSync(
    path.join(process.cwd(), "supabase/migrations/20261015200000_vibode_harmonize_history_recovery.sql"),
    "utf8",
  );
  assert.match(sql, /when 0 then interval '5 seconds'/);
  assert.match(sql, /when 1 then interval '15 seconds'/);
  assert.match(sql, /when 2 then interval '45 seconds'/);
  assert.match(sql, /when 3 then interval '3 minutes'/);
  assert.match(sql, /else interval '15 minutes'/);
  assert.match(sql, /v_next < 5/);
  assert.equal(sql.split("pg_advisory_xact_lock(8142, 20261016)").length - 1, 3);
  assert.doesNotMatch(sql, /pg_advisory_xact_lock\(8142, 20261015\)/);
  assert.doesNotMatch(sql, /create or replace function public\.publish_vibode_harmonize_history/);
  assert.doesNotMatch(sql, /create or replace function public\.claim_next_vibode_harmonize_generation/);
  assert.doesNotMatch(sql, /create or replace function public\.contact_vibode_harmonize_generation/);
  assert.doesNotMatch(sql, /create or replace function public\.enqueue_vibode_harmonize_generation/);
  assert.match(sql, /revoke all on function public\.claim_next_vibode_harmonize_history_recovery\(\) from public, anon, authenticated/);
  assert.match(sql, /revoke all on function public\.unblock_vibode_harmonize_history_recovery\(uuid\) from public, anon, authenticated/);
  assert.match(sql, /revoke all on function public\.unblock_vibode_harmonize_thumbnail_recovery\(uuid\) from public, anon, authenticated/);
  assert.doesNotMatch(sql, /2400|1792|4:3|aspect_ratio/);
  assert.doesNotMatch(sql, /alter table public\.vibode_room_assets|alter table public\.vibode_3d_scenes|alter table public\.vibode_afc/);
});

test("a crash after the History copy reuses the same bytes and does not call a provider", async () => {
  const jpeg = await createHarmonizeFakeJpeg();
  const job = readyJob(jpeg);
  const storage = createHarmonizeHistoryObjectStore();
  storage.seed(VIBODE_HARMONIZE_BUCKET, outputPath(), jpeg);
  storage.seed(VIBODE_HISTORY_BUCKET, harmonizeHistoryObjectPath(ROOM, JOB), jpeg);
  let puts = 0;
  const completed: string[] = [];
  const attempt = await executeHarmonizeRecoveryAttempt({
    task: { jobId: JOB, kind: "history", recoveryNonce: NONCE },
    publishHistory: () => publishPreparedHarmonizeHistory({
      job,
      storage: {
        download: (bucket, objectPath) => storage.download(bucket, objectPath),
        putIfAbsent: async (bucket, objectPath, bytes) => {
          puts += 1;
          return storage.putIfAbsent(bucket, objectPath, bytes);
        },
      },
      publish: () => ({
        ok: true,
        code: "published",
        assetId: ASSET,
        generationRunId: "run-1",
        activated: false,
      }),
      thumbnail: async () => "failed",
    }),
    recoverThumbnail: async () => {
      throw new Error("history recovery retried the thumbnail path");
    },
    complete: async (nonce) => {
      completed.push(nonce);
      return { ok: true, code: "completed" };
    },
    fail: async () => {
      throw new Error("a committed publication was charged as a failure");
    },
  });
  assert.equal(puts, 0);
  assert.equal(attempt.action, "complete");
  assert.equal(attempt.activated, false);
  assert.equal(attempt.thumbnail, "failed");
  assert.deepEqual(completed, [NONCE]);
});

test("a crash after publication settles History and leaves thumbnail retry to its own claim", async () => {
  const published = publication("published", "published", "complete", "failed", false);
  assert.deepEqual(settlementForHistoryPublication(published), { action: "complete", code: "published" });
  let publications = 0;
  const attempt = await executeHarmonizeRecoveryAttempt({
    task: { jobId: JOB, kind: "history", recoveryNonce: NONCE },
    publishHistory: async () => {
      publications += 1;
      return published;
    },
    recoverThumbnail: async () => {
      throw new Error("thumbnail recovery republished History");
    },
    complete: async () => ({ ok: true, code: "completed" }),
    fail: async () => {
      throw new Error("published history was failed");
    },
  });
  assert.equal(publications, 1);
  assert.equal(attempt.action, "complete");
  assert.equal(attempt.activated, false);
});

test("thumbnail recovery does not publish or activate", async () => {
  const attempt = await executeHarmonizeRecoveryAttempt({
    task: { jobId: JOB, kind: "thumbnail", recoveryNonce: NONCE },
    publishHistory: async () => {
      throw new Error("thumbnail recovery called publication");
    },
    recoverThumbnail: async () => "created",
    complete: async () => ({ ok: true, code: "completed" }),
    fail: async () => {
      throw new Error("a created thumbnail was failed");
    },
  });
  assert.equal(attempt.kind, "thumbnail");
  assert.equal(attempt.action, "complete");
  assert.equal(attempt.activated, false);
  assert.equal(attempt.code, "created");
});

test("terminal output mismatch blocks through the failure code without a provider reread", async () => {
  let reads = 0;
  const failed = await executeHarmonizeRecoveryAttempt({
    task: { jobId: JOB, kind: "history", recoveryNonce: NONCE },
    publishHistory: async () => publication("terminal", "output_mismatch", "terminal", "skipped", false),
    recoverThumbnail: async () => "failed",
    providerObject: async () => {
      reads += 1;
      return "absent";
    },
    complete: async () => {
      throw new Error("a mismatch was completed");
    },
    fail: async (_nonce, code) => ({ ok: true, code, blocked: true }),
  });
  assert.equal(reads, 0);
  assert.equal(failed.action, "fail");
  assert.equal(failed.code, "output_mismatch");
  assert.equal(failed.rpc.blocked, true);
});

test("confirmed absence is terminal and a temporary read stays retryable", () => {
  assert.equal(classifyHarmonizeObjectRead({ message: "Object not found", statusCode: 400 }, null), "absent");
  assert.equal(classifyHarmonizeObjectRead({ message: "timeout", statusCode: 500 }, null), "unavailable");
  assert.equal(classifyHarmonizeObjectRead(null, 12), "present");
  assert.deepEqual(
    settlementForHistoryPublication(publication("pending", "output_unreadable", "retryable", "skipped", false), "absent"),
    { action: "fail", code: "output_absent" },
  );
  assert.deepEqual(
    settlementForHistoryPublication(publication("pending", "output_unreadable", "retryable", "skipped", false), "unavailable"),
    { action: "fail", code: "output_unreadable" },
  );
  for (const code of ["source_mismatch", "asset_conflict", "history_conflict", "unexpected_output", "invalid_history_path"]) {
    assert.equal(settlementForHistoryPublication(publication("terminal", code, "terminal", "skipped", false)).code, code);
  }
});

test("recovery orchestration is not mounted on the worker or a browser route", () => {
  const recovery = readFileSync(path.join(process.cwd(), "lib/vibode-stage/harmonize-jobs/history-recovery.ts"), "utf8");
  const server = readFileSync(path.join(process.cwd(), "lib/vibode-stage/harmonize-jobs/history-recovery.server.ts"), "utf8");
  const worker = readFileSync(path.join(process.cwd(), "harmonize-worker/src/index.ts"), "utf8");
  const loop = readFileSync(path.join(process.cwd(), "harmonize-worker/src/run.ts"), "utf8");
  const route = readFileSync(path.join(process.cwd(), "app/api/internal/vibode-harmonize-jobs/route.ts"), "utf8");
  const browser = readFileSync(path.join(process.cwd(), "app/api/vibode/harmonize/jobs/route.ts"), "utf8");
  assert.doesNotMatch(recovery, /createHarmonizeNbpProvider|claim_next_vibode_harmonize_generation|contact_vibode_harmonize_generation|generativelanguage/);
  assert.doesNotMatch(server, /createHarmonizeNbpProvider|claim_next_vibode_harmonize_generation|contact_vibode_harmonize_generation|generativelanguage/);
  assert.match(server, /publishHarmonizeGenerationHistory/);
  assert.match(server, /recoverPublishedHarmonizeThumbnail/);
  assert.doesNotMatch(worker, /runHarmonizeHistoryRecoveryOnce|claim_next_vibode_harmonize_history_recovery/);
  assert.doesNotMatch(loop, /runHarmonizeHistoryRecoveryOnce|claim_next_vibode_harmonize_history_recovery/);
  assert.doesNotMatch(route, /runHarmonizeHistoryRecoveryOnce|claim_next_vibode_harmonize_history_recovery/);
  assert.doesNotMatch(browser, /runHarmonizeHistoryRecoveryOnce|unblock_vibode_harmonize/);
});

function readyJob(jpeg: Uint8Array): HarmonizePublicationJob {
  return {
    id: JOB,
    userId: USER,
    roomId: ROOM,
    status: "succeeded",
    historyState: "pending",
    outputBucket: VIBODE_HARMONIZE_BUCKET,
    outputPath: outputPath(),
    outputSha256: createHash("sha256").update(jpeg).digest("hex"),
    outputMime: "image/jpeg",
    outputWidth: HARMONIZE_NBP_OUTPUT_WIDTH,
    outputHeight: HARMONIZE_NBP_OUTPUT_HEIGHT,
    compositeWidth: 1200,
    compositeHeight: 896,
    backdropKind: "room_asset",
    sceneObjects: [{ objectId: "chair-1" }],
    outputAssetId: null,
  };
}

function outputPath(): string {
  return `rooms/${ROOM}/jobs/${JOB}/output-nonce.jpg`;
}

function publication(
  outcome: HarmonizeHistoryPublicationResult["outcome"],
  code: string,
  disposition: HarmonizeHistoryPublicationResult["disposition"],
  thumbnail: HarmonizeHistoryPublicationResult["thumbnail"],
  activated: boolean,
): HarmonizeHistoryPublicationResult {
  return {
    outcome,
    code,
    assetId: outcome === "published" ? ASSET : null,
    generationRunId: outcome === "published" ? "run-1" : null,
    activated,
    thumbnail,
    disposition,
  };
}
