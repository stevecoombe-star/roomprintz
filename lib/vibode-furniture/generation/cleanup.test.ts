/**
 * Temporary generation cleanup. Fake storage only. No provider call.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PERSONAL_FURNITURE_BUCKET } from "@/lib/vibode-furniture/asset-id";
import { defaultFurnitureGeneratorSettings } from "@/lib/vibode-furniture/generator/settings";
import { createAdminDeleteUserPostHandler } from "@/app/api/admin/delete-user/route";

import type { BucketObjectStore, TemporaryGenerationObject } from "./contracts";
import {
  createGenerationDatabase,
  type GenerationJob,
  type GenerationStatus,
} from "./engine";
import { createMemoryGenerationCommands } from "./memory-commands";
import { createMemoryBucketStore } from "./objects";
import { GENERATION_INPUT_BUCKET } from "./policy";
import { cleanupTemporaryGenerationObjects } from "./pipeline";
import { runFurnitureGenerationMaintenance } from "../../../furniture-generation-worker/src/maintenance";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const NOW = Date.parse("2026-11-11T00:00:00.000Z");

test("cleanup flag false and unset delete nothing, and true can run without a provider", async () => {
  const calls = { cleanup: 0, sweep: 0, claim: 0 };
  const idle = await runFurnitureGenerationMaintenance({
    cleanupEnabled: false,
    processingEnabled: false,
    cleanup: async () => {
      calls.cleanup += 1;
      return emptyCleanup();
    },
    sweep: async () => {
      calls.sweep += 1;
    },
    claim: async () => {
      calls.claim += 1;
      return { action: "waiting", jobId: null };
    },
  });
  assert.equal(idle.action, "disabled");
  assert.deepEqual(calls, { cleanup: 0, sweep: 0, claim: 0 });

  const processing = await runFurnitureGenerationMaintenance({
    cleanupEnabled: false,
    processingEnabled: true,
    cleanup: async () => {
      calls.cleanup += 1;
      return emptyCleanup();
    },
    sweep: async () => {
      calls.sweep += 1;
    },
    claim: async () => {
      calls.claim += 1;
      return { action: "waiting", jobId: null };
    },
  });
  assert.equal(processing.action, "waiting");
  assert.equal(calls.cleanup, 0);
  assert.equal(calls.sweep, 1);
  assert.equal(calls.claim, 1);

  const maintenance = await runFurnitureGenerationMaintenance({
    cleanupEnabled: true,
    processingEnabled: false,
    cleanup: async () => {
      calls.cleanup += 1;
      return emptyCleanup();
    },
    sweep: async () => {
      calls.sweep += 1;
    },
    claim: async () => {
      calls.claim += 1;
      return { action: "submitted", jobId: "job" };
    },
  });
  assert.equal(maintenance.action, "cleanup");
  assert.equal(calls.cleanup, 1);
  assert.equal(calls.sweep, 1);
  assert.equal(calls.claim, 1);

  const index = readFileSync("furniture-generation-worker/src/index.ts", "utf8");
  const dashboard = readFileSync("app/admin/furniture-generation/FurnitureGenerationDashboard.tsx", "utf8");
  const view = readFileSync("app/admin/furniture-generation/FurnitureGenerationDashboardView.tsx", "utf8");
  assert.match(index, /startup.cleanupEnabled/);
  assert.doesNotMatch(index, /MESHY_API_KEY/);
  assert.doesNotMatch(`${dashboard}\n${view}`, /VIBODE_FURNITURE_GENERATION_CLEANUP_ENABLED|Enable cleanup/);
});

test("expired terminal inputs are purged and active or review inputs stay", async () => {
  const db = createGenerationDatabase();
  const failed = addJob(db, { userId: USER_A, status: "failed", nth: 1 });
  const reserved = addJob(db, { userId: USER_A, status: "reserved", nth: 2, providerContactedAtMs: null });
  const review = addJob(db, { userId: USER_B, status: "needs_review", nth: 3 });
  const ready = addJob(db, { userId: USER_A, status: "ready", nth: 4 });
  const active = (["submitting", "ambiguous", "running", "ingesting"] as const).map((status, index) => (
    addJob(db, { userId: USER_A, status, nth: 10 + index, providerContactedAtMs: NOW - 1000 })
  ));
  addInput(db, failed, NOW - 1);
  addInput(db, reserved, NOW - 1);
  addInput(db, review, NOW - 1);
  addInput(db, ready, NOW + 60_000);
  for (const job of active) addInput(db, job, NOW - 1);
  const objects = createMemoryBucketStore();
  for (const input of db.inputs) {
    await objects.put({ bucket: input.storageBucket, path: input.storageObjectPath, bytes: new Uint8Array([1]), contentType: "image/jpeg" });
  }
  const commands = createMemoryGenerationCommands(db, { nowMs: NOW });
  const cleaned = await cleanupTemporaryGenerationObjects({ commands, objects, nowMs: NOW });
  assert.equal(cleaned.deleted, 1);
  assert.equal(cleaned.retainedForReview, 1);
  assert.equal(db.inputs.find((item) => item.jobId === failed.jobId)?.purgedAtMs, NOW);
  assert.equal(db.inputs.find((item) => item.jobId === reserved.jobId)?.purgedAtMs, null);
  assert.equal(db.inputs.find((item) => item.jobId === review.jobId)?.purgedAtMs, null);
  assert.equal(await objects.get({ bucket: GENERATION_INPUT_BUCKET, path: inputPath(failed) }), null);
  assert.ok(await objects.get({ bucket: GENERATION_INPUT_BUCKET, path: inputPath(reserved) }));
  assert.ok(await objects.get({ bucket: GENERATION_INPUT_BUCKET, path: inputPath(review) }));
  for (const job of active) {
    assert.equal(db.inputs.find((item) => item.jobId === job.jobId)?.purgedAtMs, null);
    assert.ok(await objects.get({ bucket: GENERATION_INPUT_BUCKET, path: inputPath(job) }));
  }
  assert.equal(cleaned.removed, 1);
  const again = await cleanupTemporaryGenerationObjects({ commands, objects, nowMs: NOW });
  assert.equal(again.removed, 0);
  assert.equal(again.retainedForReview, 1);
});

test("candidates stay until discard, expiry, or a durable save, and library models stay", async () => {
  const db = createGenerationDatabase();
  const ready = addJob(db, { userId: USER_A, status: "ready", nth: 1, candidate: true, expiresAtMs: NOW + 60_000 });
  const discarded = addJob(db, { userId: USER_A, status: "discarded", nth: 2, candidate: true });
  const saved = addJob(db, {
    userId: USER_A,
    status: "saved",
    nth: 3,
    candidate: true,
    savedAssetId: "vibode-furniture/personal/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });
  const objects = createMemoryBucketStore();
  const libraryPath = `users/${USER_A}/assets/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/model.glb`;
  for (const job of [ready, discarded, saved]) {
    await objects.put({
      bucket: PERSONAL_FURNITURE_BUCKET,
      path: job.outputObjectPath ?? "",
      bytes: new Uint8Array([7]),
      contentType: "model/gltf-binary",
    });
  }
  const commands = createMemoryGenerationCommands(db, { nowMs: NOW });
  const first = await cleanupTemporaryGenerationObjects({ commands, objects, nowMs: NOW });
  assert.equal(first.deleted, 2);
  assert.ok(await objects.get({ bucket: PERSONAL_FURNITURE_BUCKET, path: ready.outputObjectPath ?? "" }));
  assert.equal(await objects.get({ bucket: PERSONAL_FURNITURE_BUCKET, path: discarded.outputObjectPath ?? "" }), null);
  assert.equal(saved.outputObjectPath, null);
  assert.equal(saved.savedAssetId, "vibode-furniture/personal/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  const stranger = `users/${USER_B}/generations/${discarded.jobId}/candidate.glb`;
  await objects.put({
    bucket: PERSONAL_FURNITURE_BUCKET,
    path: stranger,
    bytes: new Uint8Array([9]),
    contentType: "model/gltf-binary",
  });
  const foreign: TemporaryGenerationObject = {
    kind: "candidate",
    bucket: PERSONAL_FURNITURE_BUCKET,
    path: libraryPath,
    jobId: saved.jobId,
    userId: USER_A,
    slot: null,
  };
  assert.equal(await commands.markTemporaryPurged(foreign), false);
  const leftAlone = await cleanupTemporaryGenerationObjects({ commands, objects, nowMs: NOW });
  assert.equal(leftAlone.deleted, 0);
  assert.ok(await objects.get({ bucket: PERSONAL_FURNITURE_BUCKET, path: stranger }));
});

test("a storage failure stays retryable and a missing object is already cleaned", async () => {
  const db = createGenerationDatabase();
  const failed = addJob(db, { userId: USER_A, status: "failed", nth: 1 });
  addInput(db, failed, NOW - 1);
  const objects = createMemoryBucketStore();
  const path = inputPath(failed);
  await objects.put({ bucket: GENERATION_INPUT_BUCKET, path, bytes: new Uint8Array([1]), contentType: "image/jpeg" });
  let failOnce = true;
  const flaky: BucketObjectStore = {
    put: (input) => objects.put(input),
    get: (input) => objects.get(input),
    sign: (input) => objects.sign(input),
    async remove(input) {
      if (failOnce) {
        failOnce = false;
        throw new Error("generation_object_delete_failed");
      }
      await objects.remove(input);
    },
  };
  const commands = createMemoryGenerationCommands(db, { nowMs: NOW });
  const logs: string[] = [];
  const failedPass = await cleanupTemporaryGenerationObjects({
    commands,
    objects: flaky,
    nowMs: NOW,
    log: (_event, fields) => {
      logs.push(String(fields.errorClass));
    },
  });
  assert.equal(failedPass.failed, 1);
  assert.equal(failedPass.deleted, 0);
  assert.equal(db.inputs[0]?.purgedAtMs, null);
  assert.deepEqual(logs, ["generation_object_delete_failed"]);
  assert.equal(JSON.stringify(logs).includes(path), false);
  const retried = await cleanupTemporaryGenerationObjects({ commands, objects: flaky, nowMs: NOW });
  assert.equal(retried.deleted, 1);
  assert.equal(db.inputs[0]?.purgedAtMs, NOW);

  const missingJob = addJob(db, { userId: USER_B, status: "cancelled", nth: 2 });
  addInput(db, missingJob, NOW - 1);
  const missing = await cleanupTemporaryGenerationObjects({ commands, objects, nowMs: NOW });
  assert.equal(missing.deleted, 1);
  assert.equal(db.inputs.find((item) => item.jobId === missingJob.jobId)?.purgedAtMs, NOW);
});

test("cleanup batches stay within 50 objects", async () => {
  const db = createGenerationDatabase();
  for (let nth = 1; nth <= 51; nth += 1) {
    const job = addJob(db, { userId: USER_A, status: "expired", nth });
    addInput(db, job, NOW - 1);
  }
  const commands = createMemoryGenerationCommands(db, { nowMs: NOW });
  const batch = await commands.listCleanupBatch(100);
  assert.equal(batch.objects.length, 50);
  assert.equal(batch.retainedForReview, 0);
});

test("account deletion lists only that user's generation inputs and fails closed when truncated", async () => {
  const userId = USER_A;
  const removed: string[] = [];
  let authDeleted = false;
  const handler = createAdminDeleteUserPostHandler({
    getAuthenticatedAdminUser: async () => ({ id: "55555555-5555-4555-8555-555555555555", email: "operator@example.com" }) as never,
    getServiceRoleSupabaseClient: () => storageClient({
      userId,
      mode: "one",
      removed,
      onAuthDelete: () => {
        authDeleted = true;
      },
    }) as never,
    deleteAfcV2UserStorage: async () => ({ ok: true, deleted: 0, skipped: 0 }),
  });
  const ok = await handler(deleteRequest(userId));
  assert.equal(ok.status, 200);
  assert.equal(authDeleted, true);
  assert.equal(removed.includes(`${GENERATION_INPUT_BUCKET}:users/${userId}/front.jpg`), true);
  assert.equal(removed.some((path) => path.includes(USER_B)), false);

  authDeleted = false;
  const truncated = createAdminDeleteUserPostHandler({
    getAuthenticatedAdminUser: async () => ({ id: "55555555-5555-4555-8555-555555555555", email: "operator@example.com" }) as never,
    getServiceRoleSupabaseClient: () => storageClient({
      userId,
      mode: "truncated",
      removed,
      onAuthDelete: () => {
        authDeleted = true;
      },
    }) as never,
    deleteAfcV2UserStorage: async () => ({ ok: true, deleted: 0, skipped: 0 }),
  });
  const blocked = await truncated(deleteRequest(userId));
  const body = await blocked.json() as { error?: string; authUserDeleted?: boolean };
  assert.equal(blocked.status, 500);
  assert.equal(body.error, "Generation input cleanup is incomplete. Account deletion was not finished.");
  assert.equal(body.authUserDeleted, false);
  assert.equal(authDeleted, false);
});

function emptyCleanup() {
  return { removed: 0, processed: 0, deleted: 0, skipped: 0, failed: 0, retainedForReview: 0 };
}

function addJob(
  db: ReturnType<typeof createGenerationDatabase>,
  input: {
    userId: string;
    status: GenerationStatus;
    nth: number;
    candidate?: boolean;
    expiresAtMs?: number | null;
    savedAssetId?: string | null;
    providerContactedAtMs?: number | null;
  },
): GenerationJob {
  const jobId = `aaaaaaaa-aaaa-4aaa-8aaa-${String(input.nth).padStart(12, "0")}`;
  const job: GenerationJob = {
    jobId,
    userId: input.userId,
    provider: "meshy",
    aiModel: "meshy-7.1",
    operation: "image-to-3d",
    idempotencyKey: `cleanup-${input.nth}`,
    requestSha256: "ab".repeat(32),
    settings: defaultFurnitureGeneratorSettings(),
    imageSlots: ["front"],
    providerTaskName: `vibode-${jobId}`,
    providerTaskId: null,
    providerStatus: null,
    status: input.status,
    progress: 0,
    claimNonce: null,
    claimExpiresAtMs: null,
    attemptCount: 0,
    providerContactedAtMs: input.providerContactedAtMs ?? null,
    absenceReconciledAtMs: null,
    resubmitAuthorized: false,
    quotaState: "released",
    reservedCredits: 30,
    consumedCredits: 0,
    outputBucket: input.candidate ? PERSONAL_FURNITURE_BUCKET : null,
    outputObjectPath: input.candidate ? `users/${input.userId}/generations/${jobId}/candidate.glb` : null,
    outputSha256: input.candidate ? "ab".repeat(32) : null,
    outputByteSize: input.candidate ? 1 : null,
    outputExpiresAtMs: input.expiresAtMs ?? null,
    errorClass: null,
    errorCode: null,
    savedAssetId: input.savedAssetId ?? null,
    createdAtMs: NOW - 10_000,
    updatedAtMs: NOW - 10_000,
  };
  db.jobs.push(job);
  return job;
}

function addInput(db: ReturnType<typeof createGenerationDatabase>, job: GenerationJob, expiresAtMs: number): void {
  db.inputs.push({
    jobId: job.jobId,
    userId: job.userId,
    slot: "front",
    ordinal: 0,
    storageBucket: GENERATION_INPUT_BUCKET,
    storageObjectPath: inputPath(job),
    sha256: "cd".repeat(32),
    byteSize: 1,
    mimeType: "image/jpeg",
    widthPx: 32,
    heightPx: 32,
    expiresAtMs,
    purgedAtMs: null,
  });
}

function inputPath(job: GenerationJob): string {
  return `users/${job.userId}/inputs/${job.jobId}/front.jpg`;
}

function deleteRequest(userId: string): Request {
  return new Request("http://localhost/api/admin/delete-user", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId, confirmEmail: "ada@example.com" }),
  });
}

function storageClient(input: {
  userId: string;
  mode: "one" | "truncated";
  removed: string[];
  onAuthDelete: () => void;
}) {
  const listed = { count: 0 };
  return {
    auth: {
      admin: {
        async getUserById() {
          return { data: { user: { id: input.userId, email: "ada@example.com" } }, error: null };
        },
        async deleteUser() {
          input.onAuthDelete();
          return { error: null };
        },
      },
    },
    from() {
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        limit() { return builder; },
        delete() { return builder; },
        then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
          return Promise.resolve({ data: [], error: null, count: 0 }).then(onFulfilled, onRejected);
        },
      };
      return builder;
    },
    storage: {
      from(bucket: string) {
        return {
          async list(prefix: string) {
            listed.count += 1;
            if (bucket !== GENERATION_INPUT_BUCKET || prefix !== `users/${input.userId}`) {
              return { data: [], error: null };
            }
            if (input.mode === "truncated") {
              return {
                data: Array.from({ length: 100 }, (_, index) => ({
                  name: `page-${listed.count}-${index}.jpg`,
                  metadata: { size: 1 },
                })),
                error: null,
              };
            }
            return { data: [{ name: "front.jpg", metadata: { size: 1 } }], error: null };
          },
          async remove(paths: string[]) {
            for (const path of paths) input.removed.push(`${bucket}:${path}`);
            return { error: null };
          },
        };
      },
    },
  };
}
