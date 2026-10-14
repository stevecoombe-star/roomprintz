import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { createHttpHarmonizeWorkerApi } from "@/harmonize-worker/src/http-api";
import { createHarmonizeFakeJpeg } from "@/lib/vibode-stage/harmonize-jobs/fake-jpeg";
import {
  createHarmonizeHistoryObjectStore,
  publishPreparedHarmonizeHistory,
  recoverHarmonizeHistoryPublication,
  type HarmonizeHistoryPublicationResult,
  type HarmonizeHistoryPublishResult,
  type HarmonizePublicationJob,
} from "@/lib/vibode-stage/harmonize-jobs/history-publication";
import {
  VIBODE_HARMONIZE_BUCKET,
  VIBODE_HISTORY_BUCKET,
  harmonizeHistoryObjectPath,
} from "@/lib/vibode-stage/harmonize-jobs/policy";
import type { HarmonizeWorkerClaim, HarmonizeWorkerCompletion } from "@/lib/vibode-stage/harmonize-jobs/worker-api";

const JOB = "11111111-1111-4111-8111-111111111111";
const ROOM = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const ASSET = "44444444-4444-4444-8444-444444444444";
const SCENE = [{ objectId: "chair-1" }];

test("a verified private JPEG is copied once and published with one thumbnail", async () => {
  const jpeg = await createHarmonizeFakeJpeg();
  const world = worldFor(jpeg);
  const published = await publishPreparedHarmonizeHistory({
    job: world.job,
    storage: world.storage,
    publish: world.publish,
    thumbnail: world.thumbnail,
  });
  assert.equal(published.outcome, "published");
  assert.equal(published.code, "published");
  assert.equal(published.assetId, ASSET);
  assert.equal(published.thumbnail, "created");
  assert.equal(published.disposition, "complete");
  assert.equal(world.puts, 1);
  assert.equal(world.publications.length, 1);
  assert.deepEqual(world.publications[0], {
    jobId: JOB,
    outputSha256: sha(jpeg),
    historyBucket: VIBODE_HISTORY_BUCKET,
    historyPath: harmonizeHistoryObjectPath(ROOM, JOB),
  });
  assert.deepEqual(await world.storage.download(VIBODE_HISTORY_BUCKET, harmonizeHistoryObjectPath(ROOM, JOB)), jpeg);
  assert.equal(world.thumbnails.length, 1);
  assert.equal(world.thumbnails[0]?.historyBucket, VIBODE_HISTORY_BUCKET);
  assert.equal(world.scene, SCENE);
});

test("a private JPEG whose SHA-256 does not match the job is not copied or published", async () => {
  const jpeg = await createHarmonizeFakeJpeg();
  const world = worldFor(jpeg);
  world.job = { ...world.job, outputSha256: "cd".repeat(32) };
  const failed = await publishPreparedHarmonizeHistory({
    job: world.job,
    storage: world.storage,
    publish: world.publish,
    thumbnail: world.thumbnail,
  });
  assert.equal(failed.code, "output_mismatch");
  assert.equal(failed.disposition, "terminal");
  assert.equal(world.puts, 0);
  assert.equal(world.publications.length, 0);
  assert.equal(world.thumbnails.length, 0);
});

test("an existing History object with the same bytes is reused", async () => {
  const jpeg = await createHarmonizeFakeJpeg();
  const world = worldFor(jpeg);
  world.storage.seed(VIBODE_HISTORY_BUCKET, harmonizeHistoryObjectPath(ROOM, JOB), jpeg);
  const published = await publishPreparedHarmonizeHistory({
    job: world.job,
    storage: world.storage,
    publish: world.publish,
    thumbnail: world.thumbnail,
  });
  assert.equal(published.code, "published");
  assert.equal(world.puts, 0);
  assert.equal(world.publications.length, 1);
});

test("an existing History object with different bytes is left in place", async () => {
  const jpeg = await createHarmonizeFakeJpeg();
  const world = worldFor(jpeg);
  const other = new Uint8Array(jpeg);
  other[other.length - 1] = (other[other.length - 1] ?? 0) ^ 255;
  world.storage.seed(VIBODE_HISTORY_BUCKET, harmonizeHistoryObjectPath(ROOM, JOB), other);
  const failed = await publishPreparedHarmonizeHistory({
    job: world.job,
    storage: world.storage,
    publish: world.publish,
    thumbnail: world.thumbnail,
  });
  assert.equal(failed.code, "history_conflict");
  assert.equal(failed.disposition, "terminal");
  assert.equal(world.puts, 0);
  assert.equal(world.publications.length, 0);
  assert.deepEqual(await world.storage.download(VIBODE_HISTORY_BUCKET, harmonizeHistoryObjectPath(ROOM, JOB)), other);
});

test("a missing or unreadable provider JPEG stays pending and is not published", async () => {
  const jpeg = await createHarmonizeFakeJpeg();
  const world = worldFor(jpeg);
  world.storage.seed(VIBODE_HARMONIZE_BUCKET, world.job.outputPath ?? "", new Uint8Array());
  const missing = await publishPreparedHarmonizeHistory({
    job: { ...world.job, outputPath: "rooms/missing.jpg" },
    storage: world.storage,
    publish: world.publish,
    thumbnail: world.thumbnail,
  });
  assert.equal(missing.code, "output_unreadable");
  assert.equal(missing.outcome, "pending");
  assert.equal(missing.disposition, "retryable");
  assert.equal(world.publications.length, 0);
  let downloads = 0;
  const unreadable = await publishPreparedHarmonizeHistory({
    job: world.job,
    storage: {
      async download() {
        downloads += 1;
        throw new Error("storage timeout");
      },
      async putIfAbsent() {
        throw new Error("should not write");
      },
    },
    publish: world.publish,
    thumbnail: world.thumbnail,
  });
  assert.equal(unreadable.code, "output_unreadable");
  assert.equal(downloads, 1);
  assert.equal(world.publications.length, 0);
});

test("a second publication returns already_published and does not create another thumbnail owner", async () => {
  const jpeg = await createHarmonizeFakeJpeg();
  const world = worldFor(jpeg);
  const first = await publishPreparedHarmonizeHistory({
    job: world.job,
    storage: world.storage,
    publish: world.publish,
    thumbnail: world.thumbnail,
  });
  world.job = { ...world.job, historyState: "published", outputAssetId: ASSET };
  const second = await publishPreparedHarmonizeHistory({
    job: world.job,
    storage: world.storage,
    publish: world.publish,
    thumbnail: world.thumbnail,
  });
  assert.equal(first.code, "published");
  assert.equal(second.code, "already_published");
  assert.equal(second.activated, false);
  assert.equal(second.assetId, ASSET);
  assert.equal(second.thumbnail, "present");
  assert.equal(world.assets.length, 1);
  assert.equal(world.puts, 1);
});

test("two concurrent publishers create one History object and one publication", async () => {
  const jpeg = await createHarmonizeFakeJpeg();
  const storage = createHarmonizeHistoryObjectStore();
  storage.seed(VIBODE_HARMONIZE_BUCKET, outputPath(), jpeg);
  let published = false;
  let lock: Promise<void> = Promise.resolve();
  const assets: string[] = [];
  const publish = (args: { jobId: string; outputSha256: string }) => {
    const run = lock.then((): HarmonizeHistoryPublishResult => {
      assert.equal(args.outputSha256, sha(jpeg));
      if (published) {
        return { ok: true, code: "already_published", assetId: ASSET, generationRunId: "run-1", activated: false };
      }
      published = true;
      assets.push(ASSET);
      return { ok: true, code: "published", assetId: ASSET, generationRunId: "run-1", activated: true };
    });
    lock = run.then(() => undefined, () => undefined);
    return run;
  };
  const job = readyJob(jpeg);
  const [left, right] = await Promise.all([
    publishPreparedHarmonizeHistory({ job, storage, publish, thumbnail: async () => "created" }),
    publishPreparedHarmonizeHistory({ job, storage, publish, thumbnail: async () => "created" }),
  ]);
  assert.deepEqual([left.code, right.code].sort(), ["already_published", "published"]);
  assert.deepEqual(assets, [ASSET]);
  assert.deepEqual(await storage.download(VIBODE_HISTORY_BUCKET, harmonizeHistoryObjectPath(ROOM, JOB)), jpeg);
});

test("a crash after the History copy and before SQL leaves the job pending and reusable", async () => {
  const jpeg = await createHarmonizeFakeJpeg();
  const world = worldFor(jpeg);
  let crashed = false;
  const publish = async (args: { outputSha256: string }): Promise<HarmonizeHistoryPublishResult> => {
    world.publications.push({ ...publicationArgs(args.outputSha256) });
    if (!crashed) {
      crashed = true;
      throw new Error("worker stopped after the copy");
    }
    return world.publish(publicationArgs(args.outputSha256));
  };
  const first = await publishPreparedHarmonizeHistory({
    job: world.job,
    storage: world.storage,
    publish,
    thumbnail: world.thumbnail,
  });
  assert.equal(first.code, "publication_failed");
  assert.equal(first.outcome, "pending");
  assert.equal(first.disposition, "retryable");
  assert.equal(world.assets.length, 0);
  const second = await publishPreparedHarmonizeHistory({
    job: world.job,
    storage: world.storage,
    publish,
    thumbnail: world.thumbnail,
  });
  assert.equal(second.code, "published");
  assert.equal(world.puts, 1);
  assert.equal(world.assets.length, 1);
});

test("a crash after SQL and before the thumbnail keeps the publication and retries only the thumbnail", async () => {
  const jpeg = await createHarmonizeFakeJpeg();
  const world = worldFor(jpeg);
  let thumbs = 0;
  const thumbnail = async () => {
    thumbs += 1;
    if (thumbs === 1) throw new Error("thumbnail worker stopped");
    return "created" as const;
  };
  const first = await publishPreparedHarmonizeHistory({
    job: world.job,
    storage: world.storage,
    publish: world.publish,
    thumbnail,
  });
  assert.equal(first.code, "published");
  assert.equal(first.thumbnail, "failed");
  assert.equal(first.disposition, "complete");
  world.job = { ...world.job, historyState: "published", outputAssetId: ASSET };
  const second = await publishPreparedHarmonizeHistory({
    job: world.job,
    storage: world.storage,
    publish: world.publish,
    thumbnail,
  });
  assert.equal(second.code, "already_published");
  assert.equal(second.thumbnail, "created");
  assert.equal(world.assets.length, 1);
  assert.equal(thumbs, 2);
});

test("publication sends the frozen job identity and does not accept a live scene or room scale", async () => {
  const jpeg = await createHarmonizeFakeJpeg();
  const world = worldFor(jpeg);
  const scene = world.job.sceneObjects;
  const published = await publishPreparedHarmonizeHistory({
    job: world.job,
    storage: world.storage,
    publish: (args) => {
      assert.deepEqual(Object.keys(args).sort(), ["historyBucket", "historyPath", "jobId", "outputSha256"]);
      return world.publish(args);
    },
    thumbnail: world.thumbnail,
  });
  assert.equal(published.activated, false);
  assert.equal(world.job.sceneObjects, scene);
});

test("a legacy unavailable job is ignored without storage or publication", async () => {
  const jpeg = await createHarmonizeFakeJpeg();
  const world = worldFor(jpeg);
  world.job = { ...world.job, historyState: "unavailable" };
  let downloads = 0;
  const ignored = await publishPreparedHarmonizeHistory({
    job: world.job,
    storage: {
      async download() {
        downloads += 1;
        return jpeg;
      },
      async putIfAbsent() {
        throw new Error("unavailable job was copied");
      },
    },
    publish: () => {
      throw new Error("unavailable job was published");
    },
  });
  assert.equal(ignored.outcome, "ignored");
  assert.equal(ignored.code, "not_publishable");
  assert.equal(downloads, 0);
  const recovered = await recoverHarmonizeHistoryPublication({
    job: world.job,
    publish: async () => {
      throw new Error("recovery revisited an unavailable job");
    },
    sleep: async () => {
      throw new Error("recovery slept");
    },
  });
  assert.equal(recovered.code, "not_publishable");
});

test("permanent publication codes stop recovery without another attempt", async () => {
  const jpeg = await createHarmonizeFakeJpeg();
  const codes = [
    "not_publishable",
    "source_mismatch",
    "output_mismatch",
    "asset_conflict",
    "history_conflict",
    "unexpected_output",
    "invalid_history_path",
    "not_found",
  ];
  for (const code of codes) {
    let attempts = 0;
    const recovered = await recoverHarmonizeHistoryPublication({
      job: readyJob(jpeg),
      publish: async () => {
        attempts += 1;
        return terminal(code);
      },
      sleep: async () => {
        throw new Error(`${code} was retried`);
      },
    });
    assert.equal(recovered.code, code);
    assert.equal(recovered.disposition, "terminal");
    assert.equal(attempts, 1);
  }
});

test("transient storage failures stay recoverable and then stop", async () => {
  const jpeg = await createHarmonizeFakeJpeg();
  const job = readyJob(jpeg);
  const sleeps: number[] = [];
  let attempts = 0;
  const recovered = await recoverHarmonizeHistoryPublication({
    job,
    publish: async () => {
      attempts += 1;
      if (attempts < 3) return pending("output_unreadable");
      return {
        outcome: "published",
        code: "published",
        assetId: ASSET,
        generationRunId: "run-1",
        activated: false,
        thumbnail: "created",
        disposition: "complete",
      };
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  assert.equal(recovered.code, "published");
  assert.equal(attempts, 3);
  assert.deepEqual(sleeps, [5_000, 15_000]);
  attempts = 0;
  const exhausted = await recoverHarmonizeHistoryPublication({
    job,
    publish: async () => {
      attempts += 1;
      return pending("unavailable");
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  assert.equal(exhausted.code, "unavailable");
  assert.equal(exhausted.disposition, "retryable");
  assert.equal(attempts, 3);
});

test("publication does not call a provider or claim another job", async () => {
  const publication = readFileSync(path.join(process.cwd(), "lib/vibode-stage/harmonize-jobs/history-publication.ts"), "utf8");
  const server = readFileSync(path.join(process.cwd(), "lib/vibode-stage/harmonize-jobs/history-publication.server.ts"), "utf8");
  const worker = readFileSync(path.join(process.cwd(), "harmonize-worker/src/index.ts"), "utf8");
  const loop = readFileSync(path.join(process.cwd(), "harmonize-worker/src/run.ts"), "utf8");
  const route = readFileSync(path.join(process.cwd(), "app/api/internal/vibode-harmonize-jobs/route.ts"), "utf8");
  assert.doesNotMatch(publication, /createHarmonizeNbpProvider|claim_next_vibode_harmonize_generation|enqueue_vibode_harmonize_generation/);
  assert.doesNotMatch(server, /vibode_3d_scenes|vibode_afc_generations|cover_image_url|scheduleVibodeThumbnail|refresh-room-thumbnail/);
  assert.match(server, /thumbnail_storage_bucket/);
  assert.match(server, /upsert: false/);
  assert.doesNotMatch(worker, /recoverHarmonizeGenerationHistory/);
  assert.doesNotMatch(loop, /recoverHarmonizeGenerationHistory/);
  assert.doesNotMatch(route, /recoverHarmonizeGenerationHistory/);
  assert.match(loop, /Exit 0 means the provider JPEG/);
  assert.match(loop, /historyOutcome/);
});

test("the worker complete response keeps generation success distinct from History", async () => {
  const env = {
    appBaseUrl: "http://127.0.0.1:3000",
    workerSecret: "local-test-secret",
    pollIntervalMs: 2000,
  };
  const api = createHttpHarmonizeWorkerApi(env, {
    fetchImpl: async () => Response.json({
      ok: true,
      code: "completed",
      history: { outcome: "pending", code: "output_unreadable" },
    }),
  });
  const completed = await api.complete(claim(), await completion());
  assert.equal(completed.ok, true);
  if (!completed.ok) return;
  assert.equal(completed.code, "completed");
  assert.equal(completed.history?.outcome, "pending");
  assert.equal(completed.history?.code, "output_unreadable");
  assert.doesNotMatch(JSON.stringify(completed), /prompt|signed|token|jpeg/i);
});

function worldFor(jpeg: Uint8Array) {
  const storage = createHarmonizeHistoryObjectStore();
  storage.seed(VIBODE_HARMONIZE_BUCKET, outputPath(), jpeg);
  const publications: Array<ReturnType<typeof publicationArgs>> = [];
  const assets: string[] = [];
  const thumbnails: Array<{ historyBucket: string; historyPath: string; assetId: string }> = [];
  let puts = 0;
  const counting = {
    async download(bucket: string, objectPath: string) {
      return storage.download(bucket, objectPath);
    },
    async putIfAbsent(bucket: string, objectPath: string, bytes: Uint8Array) {
      puts += 1;
      return storage.putIfAbsent(bucket, objectPath, bytes);
    },
    seed: storage.seed.bind(storage),
    has: storage.has.bind(storage),
  };
  const job = readyJob(jpeg);
  return {
    storage: counting,
    get job() {
      return job;
    },
    set job(next: HarmonizePublicationJob) {
      Object.assign(job, next);
    },
    scene: job.sceneObjects,
    publications,
    assets,
    thumbnails,
    get puts() {
      return puts;
    },
    publish(args: { jobId: string; outputSha256: string; historyBucket: string; historyPath: string }): HarmonizeHistoryPublishResult {
      publications.push({ ...args });
      if (job.historyState === "published") {
        return { ok: true, code: "already_published", assetId: job.outputAssetId, generationRunId: "run-1", activated: false };
      }
      assets.push(ASSET);
      return { ok: true, code: "published", assetId: ASSET, generationRunId: "run-1", activated: false };
    },
    thumbnail: async (thumb: { assetId: string; historyBucket: string; historyPath: string }) => {
      thumbnails.push(thumb);
      return thumbnails.length === 1 ? "created" as const : "present" as const;
    },
  };
}

function readyJob(jpeg: Uint8Array): HarmonizePublicationJob {
  return {
    id: JOB,
    userId: USER,
    roomId: ROOM,
    status: "succeeded",
    historyState: "pending",
    outputBucket: VIBODE_HARMONIZE_BUCKET,
    outputPath: outputPath(),
    outputSha256: sha(jpeg),
    outputMime: "image/jpeg",
    outputWidth: 2400,
    outputHeight: 1792,
    compositeWidth: 1200,
    compositeHeight: 896,
    backdropKind: "room_asset",
    sceneObjects: SCENE,
    outputAssetId: null,
  };
}

function publicationArgs(outputSha256: string) {
  return {
    jobId: JOB,
    outputSha256,
    historyBucket: VIBODE_HISTORY_BUCKET,
    historyPath: harmonizeHistoryObjectPath(ROOM, JOB),
  };
}

function outputPath(): string {
  return `rooms/${ROOM}/jobs/${JOB}/output-nonce.jpg`;
}

function sha(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function terminal(code: string): HarmonizeHistoryPublicationResult {
  return {
    outcome: "terminal",
    code,
    assetId: null,
    generationRunId: null,
    activated: false,
    thumbnail: "skipped",
    disposition: "terminal",
  };
}

function pending(code: string): HarmonizeHistoryPublicationResult {
  return {
    outcome: "pending",
    code,
    assetId: null,
    generationRunId: null,
    activated: false,
    thumbnail: "skipped",
    disposition: "retryable",
  };
}

function claim(): HarmonizeWorkerClaim {
  return {
    jobId: JOB,
    roomId: ROOM,
    claimNonce: "55555555-5555-4555-8555-555555555555",
    prompt: "UNIQUE_PROMPT_SENTINEL",
    promptSha256: "ab".repeat(32),
    compositeSha256: "cd".repeat(32),
    compositeWidth: 1200,
    compositeHeight: 896,
    requestedModelId: "gemini-3-pro-image",
  };
}

async function completion(): Promise<HarmonizeWorkerCompletion> {
  return {
    output: await createHarmonizeFakeJpeg(),
    returnedModelId: "fake-harmonize",
    providerStatus: "FAKE",
    providerHttpStatus: 200,
    latencyMs: 1,
  };
}
