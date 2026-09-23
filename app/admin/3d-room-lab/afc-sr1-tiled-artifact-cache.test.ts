import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { classifyAfcR3cImagePairCompatibility } from "./research/afc-r3c-image-pair-compatibility";
import {
  AFC_SR1_TILE_GRID_SCAFFOLD_GENERATOR_ID,
  AFC_SR1_TILE_GRID_SCAFFOLD_PRESET,
  AFC_SR1_TILE_GRID_SCAFFOLD_PROFILE,
  AFC_SR1_TILE_GRID_SCAFFOLD_REQUESTED_MODEL_ID,
  type AfcSr1TileGridScaffoldArgs,
  type AfcSr1TileGridScaffoldResult,
} from "./research/afc-sr1-tile-grid-scaffold";
import {
  AFC_SR1_TILED_ARTIFACT_CACHE_MAX_ENTRIES,
  buildAfcSr1TiledArtifactCacheKey,
  getOrGenerateCachedTiledArtifact,
  isAdmissibleAfcSr1TiledArtifact,
  peekAfcSr1CompletedTiledArtifact,
  resetAfcSr1TiledArtifactCacheForTests,
} from "./afc-sr1-tiled-artifact-cache";

const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL5WQAAAABJRU5ErkJggg==",
  "base64",
);
const PIXEL_B = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIW2NgYGD4DwABBAEAf4cI9QAAAABJRU5ErkJggg==",
  "base64",
);
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const PIXEL_SHA = sha(PIXEL);
const PIXEL_B_SHA = sha(PIXEL_B);
const EMPTY_SHA = "b".repeat(64);

function identity(sha256: string, byteCount = PIXEL.byteLength) {
  return {
    sha256,
    byteCount,
    decodedWidth: 1,
    decodedHeight: 1,
    mimeType: "image/png" as const,
    orientation: 1 as const,
  };
}

function args(emptySha256 = EMPTY_SHA): AfcSr1TileGridScaffoldArgs {
  return {
    empty: {
      base64: PIXEL.toString("base64"),
      identity: identity(emptySha256),
    },
    resultAllowedHosts: [],
    maxOutputBytes: 1024 * 1024,
    fetchTimeoutMs: 1000,
    allowLocalhostHttp: true,
  };
}

function generated(
  emptySha256 = EMPTY_SHA,
  runId = "tiled-cache-run",
  tiledBytes = PIXEL,
): Extract<AfcSr1TileGridScaffoldResult, { status: "generated" }> {
  const tiledSha = sha(tiledBytes);
  const tiledIdentity = identity(tiledSha, tiledBytes.byteLength);
  const emptyIdentity = identity(emptySha256);
  return {
    status: "generated",
    input: emptyIdentity,
    tiled: {
      base64: tiledBytes.toString("base64"),
      identity: tiledIdentity,
    },
    provenance: {
      generatorId: AFC_SR1_TILE_GRID_SCAFFOLD_GENERATOR_ID,
      profileId: AFC_SR1_TILE_GRID_SCAFFOLD_PROFILE,
      researchPreset: AFC_SR1_TILE_GRID_SCAFFOLD_PRESET,
      requestedModelId: AFC_SR1_TILE_GRID_SCAFFOLD_REQUESTED_MODEL_ID,
      runId,
      generatedAt: "2026-09-04T16:00:00.000Z",
      appliedAspectRatio: null,
      imageTransport: "data_url",
      generationStatus: "generated",
    },
    compatibility: classifyAfcR3cImagePairCompatibility(
      {
        fingerprint: emptySha256,
        decodedWidth: 1,
        decodedHeight: 1,
        orientation: 1,
      },
      {
        fingerprint: tiledSha,
        decodedWidth: 1,
        decodedHeight: 1,
        orientation: 1,
      },
    ),
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("TILED cache key is EMPTY SHA plus live stage-2 generation identity", () => {
  const key = buildAfcSr1TiledArtifactCacheKey({ emptySha256: EMPTY_SHA });
  assert.equal(
    key,
    [
      EMPTY_SHA,
      AFC_SR1_TILE_GRID_SCAFFOLD_GENERATOR_ID,
      AFC_SR1_TILE_GRID_SCAFFOLD_PROFILE,
      AFC_SR1_TILE_GRID_SCAFFOLD_PRESET,
      AFC_SR1_TILE_GRID_SCAFFOLD_REQUESTED_MODEL_ID,
    ].join("\u001f"),
  );
  assert.notEqual(
    key,
    buildAfcSr1TiledArtifactCacheKey({ emptySha256: "c".repeat(64) }),
  );
  assert.notEqual(
    key,
    buildAfcSr1TiledArtifactCacheKey({
      emptySha256: EMPTY_SHA,
      generatorId: "other-generator",
    }),
  );
  assert.notEqual(
    key,
    buildAfcSr1TiledArtifactCacheKey({
      emptySha256: EMPTY_SHA,
      profileId: "other-profile",
    }),
  );
  assert.notEqual(
    key,
    buildAfcSr1TiledArtifactCacheKey({
      emptySha256: EMPTY_SHA,
      researchPreset: "other_preset",
    }),
  );
  assert.notEqual(
    key,
    buildAfcSr1TiledArtifactCacheKey({
      emptySha256: EMPTY_SHA,
      requestedModelId: "other-model",
    }),
  );
  assert.doesNotMatch(key, /attempt|runId|generatedAt|reader|gemini|timeout|https?:/i);
});

test("cold miss generates once and warm hit restores the exact artifact", async () => {
  resetAfcSr1TiledArtifactCacheForTests();
  let calls = 0;
  const generate = async () => {
    calls += 1;
    return generated(EMPTY_SHA, "first-run");
  };
  const cold = await getOrGenerateCachedTiledArtifact(args(), generate);
  const warm = await getOrGenerateCachedTiledArtifact(args(), generate);
  assert.equal(calls, 1);
  assert.equal(cold.source, "generated");
  assert.equal(warm.source, "cache");
  assert.equal(cold.result.status, "generated");
  assert.equal(warm.result.status, "generated");
  if (cold.result.status !== "generated" || warm.result.status !== "generated") return;
  assert.equal(warm.result.tiled.identity.sha256, PIXEL_SHA);
  assert.equal(warm.result.tiled.identity.sha256, cold.result.tiled.identity.sha256);
  assert.equal(warm.result.provenance.runId, "first-run");
  assert.equal(warm.result.provenance.generatedAt, cold.result.provenance.generatedAt);
  assert.equal(warm.result, cold.result);
});

test("different EMPTY SHA misses even when Original identity is unchanged", async () => {
  resetAfcSr1TiledArtifactCacheForTests();
  const otherEmpty = "d".repeat(64);
  let calls = 0;
  const generate = async (input: AfcSr1TileGridScaffoldArgs) => {
    calls += 1;
    return generated(input.empty.identity.sha256, `run-${calls}`);
  };
  const first = await getOrGenerateCachedTiledArtifact(args(EMPTY_SHA), generate);
  const second = await getOrGenerateCachedTiledArtifact(args(otherEmpty), generate);
  assert.equal(calls, 2);
  assert.equal(first.source, "generated");
  assert.equal(second.source, "generated");
  assert.equal(first.result.status, "generated");
  assert.equal(second.result.status, "generated");
  if (first.result.status !== "generated" || second.result.status !== "generated") return;
  assert.equal(first.result.input.sha256, EMPTY_SHA);
  assert.equal(second.result.input.sha256, otherEmpty);
});

test("generation identity changes miss independently of EMPTY SHA", async () => {
  resetAfcSr1TiledArtifactCacheForTests();
  let calls = 0;
  const generate = async () => {
    calls += 1;
    return generated(EMPTY_SHA, `identity-${calls}`);
  };
  await getOrGenerateCachedTiledArtifact(args(), generate);
  const miss = await getOrGenerateCachedTiledArtifact(args(), generate, {
    keyParts: { generatorId: "vibode-tile-grid-scaffold/stage2/v2" },
  });
  assert.equal(calls, 2);
  assert.equal(miss.source, "generated");
});

test("generation failure is not cached and the next resolve generates again", async () => {
  resetAfcSr1TiledArtifactCacheForTests();
  let calls = 0;
  const generate = async () => {
    calls += 1;
    if (calls === 1) {
      return {
        status: "failure" as const,
        code: "timeout" as const,
        runId: "failed-run",
      };
    }
    return generated(EMPTY_SHA, "recovered-run");
  };
  const failed = await getOrGenerateCachedTiledArtifact(args(), generate);
  const recovered = await getOrGenerateCachedTiledArtifact(args(), generate);
  assert.equal(calls, 2);
  assert.equal(failed.result.status, "failure");
  assert.equal(failed.source, "generated");
  assert.equal(recovered.source, "generated");
  assert.equal(recovered.result.status, "generated");
});

test("in-flight de-dupe shares one generation and rejection clears in-flight state", async () => {
  resetAfcSr1TiledArtifactCacheForTests();
  const gate = createDeferred<void>();
  let calls = 0;
  const generate = async () => {
    calls += 1;
    await gate.promise;
    return generated(EMPTY_SHA, "shared-run");
  };
  const firstPromise = getOrGenerateCachedTiledArtifact(args(), generate);
  const secondPromise = getOrGenerateCachedTiledArtifact(args(), generate);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  gate.resolve();
  const [first, second] = await Promise.all([firstPromise, secondPromise]);
  assert.equal(calls, 1);
  assert.equal(first.source, "generated");
  assert.equal(second.source, "cache");
  assert.equal(first.result.status, "generated");
  assert.equal(second.result.status, "generated");
  if (first.result.status !== "generated" || second.result.status !== "generated") return;
  assert.equal(first.result.provenance.runId, second.result.provenance.runId);
  assert.equal(first.result.tiled.identity.sha256, PIXEL_SHA);

  resetAfcSr1TiledArtifactCacheForTests();
  const failGate = createDeferred<void>();
  let failCalls = 0;
  const failing = async () => {
    failCalls += 1;
    await failGate.promise;
    throw new Error("nbp_tiled_timeout");
  };
  const rejected = getOrGenerateCachedTiledArtifact(args(), failing);
  const waiter = getOrGenerateCachedTiledArtifact(args(), failing);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(failCalls, 1);
  failGate.resolve();
  await assert.rejects(rejected);
  await assert.rejects(waiter);
  const retried = await getOrGenerateCachedTiledArtifact(args(), async () =>
    generated(EMPTY_SHA, "after-reject"),
  );
  assert.equal(failCalls, 1);
  assert.equal(retried.source, "generated");
});

test("non-PNG and non-exact-grid artifacts are never admitted", () => {
  const fake = {
    status: "generated" as const,
    input: identity(EMPTY_SHA),
    tiled: {
      base64: Buffer.from([1, 2, 3]).toString("base64"),
      identity: {
        sha256: "c".repeat(64),
        byteCount: 3,
        decodedWidth: 1,
        decodedHeight: 1,
        mimeType: "image/png" as const,
        orientation: 1 as const,
      },
    },
    provenance: generated().provenance,
    compatibility: { tier: "exact_grid_compatible" },
  } as AfcSr1TileGridScaffoldResult;
  assert.equal(isAdmissibleAfcSr1TiledArtifact(fake, EMPTY_SHA), false);
  const aspect = generated();
  (aspect as { compatibility: { tier: string } }).compatibility = {
    ...aspect.compatibility,
    tier: "aspect_compatible_rescaled",
  };
  assert.equal(isAdmissibleAfcSr1TiledArtifact(aspect, EMPTY_SHA), false);
});

test("TS0 generator source remains intentionally uncached", () => {
  const source = readFileSync(
    new URL("./research/afc-sr1-tile-grid-scaffold.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /intentionally no cache or reuse option/);
  assert.doesNotMatch(source, /getOrGenerateCachedTiledArtifact|completedTiled|inFlightTiled/);
});

test("completed cache is bounded to eight insertion-order entries", async () => {
  resetAfcSr1TiledArtifactCacheForTests();
  assert.equal(AFC_SR1_TILED_ARTIFACT_CACHE_MAX_ENTRIES, 8);
  let calls = 0;
  const generate = async (input: AfcSr1TileGridScaffoldArgs) => {
    calls += 1;
    return generated(input.empty.identity.sha256, `bounded-${calls}`);
  };
  const shas = Array.from({ length: 9 }, (_, index) =>
    sha(Buffer.from(`empty-${index}`)),
  );
  for (const emptySha of shas) {
    const resolved = await getOrGenerateCachedTiledArtifact(args(emptySha), generate);
    assert.equal(resolved.source, "generated");
  }
  assert.equal(calls, 9);
  const oldest = await getOrGenerateCachedTiledArtifact(args(shas[0]), generate);
  const newest = await getOrGenerateCachedTiledArtifact(args(shas[8]), generate);
  assert.equal(oldest.source, "generated");
  assert.equal(newest.source, "cache");
  assert.equal(calls, 10);
});

test("forceRefresh bypasses completed cache and replaces it on success", async () => {
  resetAfcSr1TiledArtifactCacheForTests();
  let calls = 0;
  const generate = async () => {
    calls += 1;
    return calls === 1
      ? generated(EMPTY_SHA, "sha-a", PIXEL)
      : generated(EMPTY_SHA, "sha-b", PIXEL_B);
  };
  const first = await getOrGenerateCachedTiledArtifact(args(), generate);
  const refreshed = await getOrGenerateCachedTiledArtifact(args(), generate, {
    forceRefresh: true,
  });
  const warm = await getOrGenerateCachedTiledArtifact(args(), generate);
  assert.equal(calls, 2);
  assert.equal(first.source, "generated");
  assert.equal(refreshed.source, "generated");
  assert.equal(warm.source, "cache");
  assert.equal(first.result.status, "generated");
  assert.equal(refreshed.result.status, "generated");
  assert.equal(warm.result.status, "generated");
  if (
    first.result.status !== "generated" ||
    refreshed.result.status !== "generated" ||
    warm.result.status !== "generated"
  ) return;
  assert.equal(first.result.tiled.identity.sha256, PIXEL_SHA);
  assert.equal(refreshed.result.tiled.identity.sha256, PIXEL_B_SHA);
  assert.equal(warm.result.tiled.identity.sha256, PIXEL_B_SHA);
  assert.equal(warm.result.provenance.runId, "sha-b");
});

test("failed forceRefresh does not destroy or serve the previous artifact", async () => {
  resetAfcSr1TiledArtifactCacheForTests();
  let calls = 0;
  const generate = async () => {
    calls += 1;
    if (calls === 1) return generated(EMPTY_SHA, "sha-a", PIXEL);
    return {
      status: "failure" as const,
      code: "timeout" as const,
      runId: "force-failed",
    };
  };
  await getOrGenerateCachedTiledArtifact(args(), generate);
  const failed = await getOrGenerateCachedTiledArtifact(args(), generate, {
    forceRefresh: true,
  });
  assert.equal(calls, 2);
  assert.equal(failed.source, "generated");
  assert.equal(failed.result.status, "failure");
  const key = buildAfcSr1TiledArtifactCacheKey({ emptySha256: EMPTY_SHA });
  const retained = peekAfcSr1CompletedTiledArtifact(key);
  assert.equal(retained?.tiled.identity.sha256, PIXEL_SHA);
  const warm = await getOrGenerateCachedTiledArtifact(args(), generate);
  assert.equal(calls, 2);
  assert.equal(warm.source, "cache");
  assert.equal(warm.result.status, "generated");
  if (warm.result.status !== "generated") return;
  assert.equal(warm.result.tiled.identity.sha256, PIXEL_SHA);
});

test("concurrent forceRefresh shares one generation; normal hits stay on completed", async () => {
  resetAfcSr1TiledArtifactCacheForTests();
  await getOrGenerateCachedTiledArtifact(args(), async () =>
    generated(EMPTY_SHA, "sha-a", PIXEL),
  );
  const gate = createDeferred<void>();
  let calls = 0;
  const generate = async () => {
    calls += 1;
    await gate.promise;
    return generated(EMPTY_SHA, "sha-b", PIXEL_B);
  };
  const firstRefresh = getOrGenerateCachedTiledArtifact(args(), generate, {
    forceRefresh: true,
  });
  const secondRefresh = getOrGenerateCachedTiledArtifact(args(), generate, {
    forceRefresh: true,
  });
  await new Promise((resolve) => setImmediate(resolve));
  const concurrentNormal = await getOrGenerateCachedTiledArtifact(args(), generate);
  assert.equal(calls, 1);
  assert.equal(concurrentNormal.source, "cache");
  assert.equal(concurrentNormal.result.status, "generated");
  if (concurrentNormal.result.status === "generated") {
    assert.equal(concurrentNormal.result.tiled.identity.sha256, PIXEL_SHA);
  }
  gate.resolve();
  const [first, second] = await Promise.all([firstRefresh, secondRefresh]);
  assert.equal(calls, 1);
  assert.equal(first.source, "generated");
  assert.equal(second.source, "generated");
  assert.equal(first.result.status, "generated");
  assert.equal(second.result.status, "generated");
  if (first.result.status !== "generated" || second.result.status !== "generated") {
    return;
  }
  assert.equal(first.result.tiled.identity.sha256, PIXEL_B_SHA);
  assert.equal(second.result.tiled.identity.sha256, PIXEL_B_SHA);
});
