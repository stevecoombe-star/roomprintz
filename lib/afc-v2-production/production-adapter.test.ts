import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type { AfcSr1TiledLiveProductDependencies } from "@/app/admin/3d-room-lab/afc-sr1-tiled-live-product";
import { buildAfcSr1TiledArtifactCacheKey } from "@/app/admin/3d-room-lab/afc-sr1-tiled-artifact-cache";
import {
  AFC_SR1_TILE_GRID_SCAFFOLD_GENERATOR_ID,
  AFC_SR1_TILE_GRID_SCAFFOLD_PRESET,
  AFC_SR1_TILE_GRID_SCAFFOLD_PROFILE,
  AFC_SR1_TILE_GRID_SCAFFOLD_REQUESTED_MODEL_ID,
} from "@/app/admin/3d-room-lab/research/afc-sr1-tile-grid-scaffold";
import {
  executeAfcV2Analysis,
  type AfcV2AnalysisDependencies,
} from "@/app/admin/3d-room-lab-v2/afc-v2-analysis.server";
import { buildEmptyRoomObservationEvidence } from "@/app/admin/3d-room-lab-v2/empty-room-observation-contract";
import {
  buildUnavailableMetricRoomPriorReceipt,
} from "@/app/admin/3d-room-lab-v2/metric-room-prior-contract";
import {
  runProductionAfcAnalysis,
  restoreProductionAfcRoom,
} from "./production-adapter.server";
import {
  AFC_V2_PRODUCTION_ROOM_AUTHORITY_VERSION,
  isAfcV2ProductionRoomAuthority,
  productionAuthorityKeys,
} from "./production-authority-contract";
import { collectProductionPayloadPrivacyViolations } from "./privacy";
import {
  createMemoryAfcProductionStore,
  type AfcProductionStore,
  type MemoryAfcProductionStore,
} from "./production-store";

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_USER_ID = "44444444-4444-4444-8444-444444444444";
const ORIGINAL_BYTES = Uint8Array.from([9, 8, 7, 6]);
const SOURCE_IMAGE_URL = "https://example.test/original.jpg";
const EMPTY_BYTES = Uint8Array.from([4, 5, 6]);
const TILED_PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
]);
const originalBasis = {
  sha256: sha(ORIGINAL_BYTES),
  byteCount: ORIGINAL_BYTES.byteLength,
  decodedWidth: 1200,
  decodedHeight: 800,
  mimeType: "image/jpeg" as const,
  orientation: 1 as const,
};
const emptyBasis = {
  sha256: sha(EMPTY_BYTES),
  byteCount: EMPTY_BYTES.byteLength,
  decodedWidth: 1200,
  decodedHeight: 800,
  mimeType: "image/png" as const,
  orientation: 1 as const,
};
const tiledBasis = {
  sha256: sha(TILED_PNG),
  byteCount: TILED_PNG.byteLength,
  decodedWidth: 1200,
  decodedHeight: 800,
  mimeType: "image/png" as const,
  orientation: 1 as const,
};
const authoritativeFloorQuad = [
  { x: 0.1, y: 0.9 },
  { x: 0.9, y: 0.9 },
  { x: 0.65, y: 0.55 },
  { x: 0.35, y: 0.55 },
] as const;

type CallCounts = {
  empty: number;
  tiled: number;
  reader: number;
  observeRoom: number;
  estimateMetricRoom: number;
};

function tiledResult(runId: string) {
  return {
    status: "generated" as const,
    input: emptyBasis,
    tiled: {
      base64: Buffer.from(TILED_PNG).toString("base64"),
      identity: tiledBasis,
    },
    provenance: {
      generatorId: AFC_SR1_TILE_GRID_SCAFFOLD_GENERATOR_ID,
      profileId: AFC_SR1_TILE_GRID_SCAFFOLD_PROFILE,
      researchPreset: AFC_SR1_TILE_GRID_SCAFFOLD_PRESET,
      requestedModelId: AFC_SR1_TILE_GRID_SCAFFOLD_REQUESTED_MODEL_ID,
      runId,
      generatedAt: "2026-09-08T20:00:00.000Z",
      appliedAspectRatio: "3:2",
      imageTransport: "data_url" as const,
      generationStatus: "generated" as const,
    },
    compatibility: { tier: "exact_grid_compatible" as const },
  };
}

function observation() {
  return buildEmptyRoomObservationEvidence({
    observedPlanes: [
      {
        id: "visible_floor",
        category: "floor",
        sourceNormalizedPolygon: [
          { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 0.8, y: 0.62 }, { x: 0.2, y: 0.62 },
        ],
        confidence: 0.94,
        visibility: "observed",
      },
      {
        id: "visible_wall",
        category: "wall",
        sourceNormalizedPolygon: [
          { x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.8, y: 0.62 }, { x: 0.2, y: 0.62 },
        ],
        confidence: 0.91,
        visibility: "observed",
      },
    ],
    observedSeams: [{
      id: "visible_floor_wall",
      category: "floor_wall",
      planeIds: ["visible_floor", "visible_wall"],
      sourceNormalizedPolyline: [
        { x: 0.2, y: 0.62 }, { x: 0.5, y: 0.62 }, { x: 0.8, y: 0.62 },
      ],
      confidence: 0.9,
      visibility: "observed",
    }],
    observedOpenings: [],
    observedJunctions: [],
    unresolved: [],
  }, {
    attemptId: "prod",
    loadGeneration: 0,
    emptyIdentity: emptyBasis,
    originalAncestorSha256: originalBasis.sha256,
    provider: "controlled_fixture",
    model: "fixture",
    observerProfile: "empty-visible-architecture-conservative/v1",
    promptVersion: "afc-v2-empty-visible-room-observer/v5",
    generatedAt: "2026-09-08T20:00:00.000Z",
  });
}

function createCounts(): CallCounts {
  return { empty: 0, tiled: 0, reader: 0, observeRoom: 0, estimateMetricRoom: 0 };
}

function analysisDependencies(
  counts: CallCounts,
  options: Readonly<{
    tiledImpl?: AfcSr1TiledLiveProductDependencies["generateTiled"];
    failReader?: boolean;
    emptyImpl?: AfcSr1TiledLiveProductDependencies["resolveEmpty"];
  }> = {},
): AfcV2AnalysisDependencies {
  const product: AfcSr1TiledLiveProductDependencies = {
    createResultId: () => "prod-result",
    resolveEmpty: options.emptyImpl ?? (async () => {
      counts.empty += 1;
      return { basis: emptyBasis, bytes: EMPTY_BYTES, generated: true };
    }),
    generateTiled: options.tiledImpl ?? (async () => {
      counts.tiled += 1;
      return tiledResult(`tiled-${counts.tiled}`) as never;
    }),
    validateTiledLineage: async () => ({
      tiledIdentity: tiledBasis,
      authority: { lineageEvidenceDigest: "d".repeat(64) },
    }) as never,
    readTiledPerspective: async () => {
      counts.reader += 1;
      if (options.failReader) {
        return {
          status: "failed",
          reason: "no_complete_tile",
          decodedIdentity: tiledBasis,
          readerVersion: "afc-sr1-tiled-perspective-reader/s1",
        };
      }
      return {
        status: "ok",
        decodedIdentity: tiledBasis,
        readerVersion: "afc-sr1-tiled-perspective-reader/s1",
        authoritativeQuadSourceNormalized: authoritativeFloorQuad,
        authoritativeQuadPixel: [
          { x: 120, y: 720 },
          { x: 1080, y: 720 },
          { x: 780, y: 440 },
          { x: 420, y: 440 },
        ],
        authoritativeCore: {
          rows: 2, columns: 2, j0: 0, i0: 0, cellIds: [1, 2, 3, 4],
        },
        selectedComponentTileCount: 4,
        rawQuadrilateralCount: 4,
        deduplicatedCellCount: 4,
        reprojectionMeanPx: 0.5,
        reprojectionMaxPx: 1,
      };
    },
  };
  return {
    product,
    observeRoom: async () => {
      counts.observeRoom += 1;
      return observation();
    },
    estimateMetricRoom: async () => {
      counts.estimateMetricRoom += 1;
      return buildUnavailableMetricRoomPriorReceipt({
        sourceImageHash: originalBasis.sha256,
        originalAncestorSha256: originalBasis.sha256,
        attemptId: "prod",
        loadGeneration: 0,
        provider: "controlled_fixture",
        model: "fixture",
      }, {
        failureClass: "configuration",
        failureStage: "configuration",
        provider: "controlled_fixture",
        model: "fixture",
        providerStatus: null,
        safeDetail: "PI-2 fixture metric prior unavailable.",
        contractValidationReason: "pi2_fixture",
      });
    },
  };
}

async function seededStore(): Promise<AfcProductionStore> {
  const store = createMemoryAfcProductionStore();
  await store.createRoom?.({
    id: ROOM_ID,
    userId: USER_ID,
    currentAfcGenerationId: null,
    baseStorageBucket: "vibode-base-images",
    baseStoragePath: `users/${USER_ID}/scene_x/base.jpg`,
    baseAsset: null,
  });
  return store;
}

async function analyze(
  store: AfcProductionStore,
  counts: CallCounts,
  intent?: "analyze" | "run_again" | "reread_perspective",
  tiledImpl?: AfcSr1TiledLiveProductDependencies["generateTiled"],
  failReader = false,
) {
  return runProductionAfcAnalysis({
    roomId: ROOM_ID,
    userId: USER_ID,
    intent,
    store,
    original: { bytes: ORIGINAL_BYTES, identity: originalBasis, sourceImageUrl: SOURCE_IMAGE_URL },
    analysisDependencies: analysisDependencies(counts, { tiledImpl, failReader }),
  });
}

test("initial analysis persists EMPTY/TILED, compact authority, and current pointer", async () => {
  const store = await seededStore();
  const counts = createCounts();
  const result = await analyze(store, counts, "analyze");
  assert.equal(result.status, "ready");
  assert.ok(result.generationId);
  assert.equal(result.currentGenerationId, result.generationId);
  assert.ok(result.authority);
  assert.equal(isAfcV2ProductionRoomAuthority(result.authority), true);
  assert.equal(result.authority.schemaVersion, AFC_V2_PRODUCTION_ROOM_AUTHORITY_VERSION);
  assert.equal(result.frame?.width, originalBasis.decodedWidth);
  assert.equal(result.frame?.height, originalBasis.decodedHeight);
  assert.equal(result.authority.frame.width, originalBasis.decodedWidth);
  assert.equal(result.authority.frame.height, originalBasis.decodedHeight);
  assert.equal(result.authority.frozenCamera.frame.width, originalBasis.decodedWidth);
  assert.equal(result.authority.empty.artifactSource, "generated");
  assert.equal(result.authority.tiled.artifactSource, "generated");
  assert.equal(counts.empty, 1);
  assert.equal(counts.tiled, 1);
  assert.equal(counts.reader, 1);
  const room = await store.getRoom(ROOM_ID);
  assert.equal(room?.currentAfcGenerationId, result.generationId);
  const generation = await store.getGeneration(result.generationId!);
  assert.equal(generation?.status, "ready");
  assert.ok(generation?.emptyStoragePath?.includes(`/afc/${result.generationId}/empty.`));
  assert.ok(generation?.tiledStoragePath?.includes(`/afc/${result.generationId}/tiled.`));
  assert.equal(collectProductionPayloadPrivacyViolations(result).length, 0);
});

test("restore loads persisted authority with zero provider or Reader calls", async () => {
  const store = await seededStore();
  const counts = createCounts();
  const first = await analyze(store, counts, "analyze");
  assert.equal(first.status, "ready");
  const before = { ...counts };
  const restored = await restoreProductionAfcRoom({
    roomId: ROOM_ID,
    userId: USER_ID,
    store,
  });
  assert.equal(restored.status, "ready");
  assert.equal(restored.currentGenerationId, first.generationId);
  assert.equal(restored.authority?.generationId, first.generationId);
  assert.deepEqual(counts, before);
  const restoreAgain = await restoreProductionAfcRoom({
    roomId: ROOM_ID,
    userId: USER_ID,
    store,
  });
  assert.equal(restoreAgain.authority?.generationId, first.generationId);
  assert.deepEqual(counts, before);
});

test("Run AFC Again reuses durable EMPTY and TILED, reruns Reader, and moves pointer only on success", async () => {
  const store = await seededStore();
  const counts = createCounts();
  const first = await analyze(store, counts, "analyze");
  assert.equal(first.status, "ready");
  const second = await analyze(store, counts, "run_again");
  assert.equal(second.status, "ready");
  assert.notEqual(second.generationId, first.generationId);
  assert.equal(second.currentGenerationId, second.generationId);
  assert.equal(second.authority?.empty.artifactSource, "durable");
  assert.equal(second.authority?.tiled.artifactSource, "durable");
  assert.equal(counts.empty, 1);
  assert.equal(counts.tiled, 1);
  assert.equal(counts.reader, 2);
  assert.equal(counts.observeRoom, 2);
  assert.equal(counts.estimateMetricRoom, 2);
  const expectedKey = buildAfcSr1TiledArtifactCacheKey({
    emptySha256: emptyBasis.sha256,
  });
  assert.equal(second.authority?.tiled.cacheKey, expectedKey);
  assert.equal(second.authority?.tiled.forceRegeneration, false);
});

test("Re-read Room Perspective forces fresh TILED, allows EMPTY reuse, and keeps N on failure", async () => {
  const store = await seededStore();
  const counts = createCounts();
  const first = await analyze(store, counts, "analyze");
  assert.equal(first.status, "ready");
  const second = await analyze(store, counts, "reread_perspective");
  assert.equal(second.status, "ready");
  assert.equal(second.authority?.empty.artifactSource, "durable");
  assert.equal(second.authority?.tiled.artifactSource, "generated");
  assert.equal(second.authority?.tiled.forceRegeneration, true);
  assert.equal(counts.empty, 1);
  assert.equal(counts.tiled, 2);
  assert.equal(counts.reader, 2);
  const failedCounts = createCounts();
  failedCounts.empty = counts.empty;
  failedCounts.tiled = counts.tiled;
  failedCounts.reader = counts.reader;
  failedCounts.observeRoom = counts.observeRoom;
  failedCounts.estimateMetricRoom = counts.estimateMetricRoom;
  const failed = await analyze(
    store,
    failedCounts,
    "reread_perspective",
    async () => ({ status: "failure", code: "generation_failed", runId: "fail" }),
  );
  assert.equal(failed.status, "failed");
  assert.equal(failed.currentGenerationId, second.generationId);
  assert.equal(failed.authority?.generationId, second.generationId);
  assert.ok(failed.generationId);
  assert.notEqual(failed.generationId, second.generationId);
  const failedGeneration = await store.getGeneration(failed.generationId!);
  assert.equal(failedGeneration?.status, "failed");
  const room = await store.getRoom(ROOM_ID);
  assert.equal(room?.currentAfcGenerationId, second.generationId);
  const reuse = await analyze(store, counts, "run_again");
  assert.equal(reuse.status, "ready");
  assert.equal(reuse.authority?.tiled.artifactSource, "durable");
  assert.equal(reuse.authority?.tiled.sha256, second.authority?.tiled.sha256);
});

test("failed new analysis retains the failed generation and does not replace the active pointer", async () => {
  const store = await seededStore();
  const counts = createCounts();
  const first = await analyze(store, counts, "analyze");
  const failed = await analyze(
    store,
    createCounts(),
    "run_again",
    undefined,
    true,
  );
  assert.equal(failed.status, "failed");
  assert.equal(failed.currentGenerationId, first.generationId);
  const room = await store.getRoom(ROOM_ID);
  assert.equal(room?.currentAfcGenerationId, first.generationId);
  const failedGeneration = await store.getGeneration(failed.generationId!);
  assert.equal(failedGeneration?.status, "failed");
  assert.equal(failedGeneration?.productionAuthority, null);
});

test("production contract is a whitelist and omits privileged Lab fields", async () => {
  const store = await seededStore();
  const result = await analyze(store, createCounts(), "analyze");
  assert.ok(result.authority);
  assert.deepEqual(
    Object.keys(result.authority).sort(),
    [...productionAuthorityKeys()].sort(),
  );
  assert.equal(result.authority.metric.autoMetricScale, 1);
  assert.equal(result.authority.metric.metricScale, 1);
  assert.equal(result.authority.metric.fallbackApplied, true);
  assert.equal(result.authority.coordinateSpace, "calibrated-world-xz/v1");
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /imageUrl|freezeReceipt|executionCounts|userWorldScale/);
  assert.doesNotMatch(serialized, /\/api\/admin\//);
  assert.doesNotMatch(serialized, /storage\/v1\/object/);
});

test("decoded-frame invariant is recorded on every production analysis", async () => {
  const store = await seededStore();
  const first = await analyze(store, createCounts(), "analyze");
  const second = await analyze(store, createCounts(), "run_again");
  for (const result of [first, second]) {
    assert.equal(result.frame?.width, 1200);
    assert.equal(result.frame?.height, 800);
    assert.equal(result.authority?.frame.width, 1200);
    assert.equal(result.authority?.frame.height, 800);
  }
});

test("owner authorization rejects another user's room", async () => {
  const store = await seededStore();
  const result = await runProductionAfcAnalysis({
    roomId: ROOM_ID,
    userId: OTHER_USER_ID,
    store,
    original: { bytes: ORIGINAL_BYTES, identity: originalBasis, sourceImageUrl: SOURCE_IMAGE_URL },
    analysisDependencies: analysisDependencies(createCounts()),
  });
  assert.equal(result.status, "failed");
  assert.equal(result.generationId, null);
  const restored = await restoreProductionAfcRoom({
    roomId: ROOM_ID,
    userId: OTHER_USER_ID,
    store,
  });
  assert.equal(restored.status, "none");
  assert.equal(restored.authority, null);
});

test("ready generation authority cannot be rewritten", async () => {
  const store = await seededStore();
  const first = await analyze(store, createCounts(), "analyze");
  await assert.rejects(
    () => store.updateGeneration(first.generationId!, {
      productionAuthority: {
        ...first.authority!,
        runId: "mutated",
      },
    }),
    /immutable/,
  );
});

test("certified executeAfcV2Analysis remains the production analysis function", () => {
  assert.equal(typeof executeAfcV2Analysis, "function");
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

test("live production analysis mints a fetchable ORIGINAL URL and never uses vibode.invalid", async () => {
  const store = await seededStore();
  const seen: string[] = [];
  const result = await runProductionAfcAnalysis({
    roomId: ROOM_ID,
    userId: USER_ID,
    intent: "analyze",
    store,
    original: {
      bytes: ORIGINAL_BYTES,
      identity: originalBasis,
      sourceImageUrl: SOURCE_IMAGE_URL,
    },
    analysisDependencies: analysisDependencies(createCounts()),
    analyze: async (input, deps) => {
      seen.push(input.sourceImageUrl);
      return executeAfcV2Analysis(input, deps);
    },
  });
  assert.equal(result.status, "ready");
  assert.deepEqual(seen, [SOURCE_IMAGE_URL]);
  assert.doesNotMatch(JSON.stringify(result), /vibode\.invalid/);
  assert.equal(collectProductionPayloadPrivacyViolations(result).length, 0);
});

test("placeholder or missing ORIGINAL URL fails closed without creating a generation", async () => {
  const store = await seededStore();
  const missing = await runProductionAfcAnalysis({
    roomId: ROOM_ID,
    userId: USER_ID,
    store,
    original: { bytes: ORIGINAL_BYTES, identity: originalBasis },
    analysisDependencies: analysisDependencies(createCounts()),
  });
  assert.equal(missing.status, "failed");
  assert.equal(missing.generationId, null);
  const placeholder = await runProductionAfcAnalysis({
    roomId: ROOM_ID,
    userId: USER_ID,
    store,
    original: {
      bytes: ORIGINAL_BYTES,
      identity: originalBasis,
      sourceImageUrl: `https://vibode.invalid/rooms/${ROOM_ID}/original`,
    },
    analysisDependencies: analysisDependencies(createCounts()),
  });
  assert.equal(placeholder.status, "failed");
  assert.equal(placeholder.generationId, null);
  const room = await store.getRoom(ROOM_ID);
  assert.equal(room?.currentAfcGenerationId, null);
  assert.doesNotMatch(JSON.stringify(placeholder), /vibode\.invalid|token=/);
});

test("signed ORIGINAL URL is excluded from the public contract", async () => {
  const store = await seededStore();
  const privilegedUrl =
    "https://proj.supabase.co/storage/v1/object/sign/vibode-base-images/users/x/base.jpg?token=secret";
  const result = await runProductionAfcAnalysis({
    roomId: ROOM_ID,
    userId: USER_ID,
    intent: "analyze",
    store,
    original: {
      bytes: ORIGINAL_BYTES,
      identity: originalBasis,
      sourceImageUrl: privilegedUrl,
    },
    analysisDependencies: analysisDependencies(createCounts()),
  });
  assert.equal(result.status, "ready");
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /token=secret|storage\/v1\/object|sourceImageUrl/);
  assert.equal(collectProductionPayloadPrivacyViolations(result).length, 0);
});

test("stale N+1 success cannot replace a newer N+2 current generation", async () => {
  const store = await seededStore();
  const gate = deferred();
  const olderStarted = deferred();
  const older = runProductionAfcAnalysis({
    roomId: ROOM_ID,
    userId: USER_ID,
    intent: "analyze",
    store,
    original: {
      bytes: ORIGINAL_BYTES,
      identity: originalBasis,
      sourceImageUrl: SOURCE_IMAGE_URL,
    },
    analysisDependencies: analysisDependencies(createCounts()),
    analyze: async (input, deps) => {
      olderStarted.resolve();
      await gate.promise;
      return executeAfcV2Analysis(input, deps);
    },
  });
  await olderStarted.promise;
  const newer = await analyze(store, createCounts(), "analyze");
  assert.equal(newer.status, "ready");
  assert.ok(newer.generationId);
  gate.resolve();
  const late = await older;
  assert.equal(late.status, "ready");
  assert.notEqual(late.generationId, newer.generationId);
  assert.equal(late.currentGenerationId, newer.generationId);
  assert.equal(late.authority?.generationId, newer.generationId);
  const room = await store.getRoom(ROOM_ID);
  assert.equal(room?.currentAfcGenerationId, newer.generationId);
  const stale = await store.getGeneration(late.generationId!);
  assert.equal(stale?.status, "ready");
  assert.ok((stale?.lineageSeq ?? 0) < (await store.getGeneration(newer.generationId!))!.lineageSeq);
});

test("failed analysis does not publish reusable EMPTY", async () => {
  const store = await seededStore();
  const failed = await analyze(store, createCounts(), "analyze", undefined, true);
  assert.equal(failed.status, "failed");
  assert.equal(await store.lookupDurableEmpty(USER_ID, originalBasis.sha256), null);
  const counts = createCounts();
  const retry = await analyze(store, counts, "analyze");
  assert.equal(retry.status, "ready");
  assert.equal(counts.empty, 1);
  assert.equal(retry.authority?.empty.artifactSource, "generated");
});

test("incompatible EMPTY is not published to the durable cache", async () => {
  const store = await seededStore();
  const incompatibleCounts = createCounts();
  const failed = await runProductionAfcAnalysis({
    roomId: ROOM_ID,
    userId: USER_ID,
    intent: "analyze",
    store,
    original: {
      bytes: ORIGINAL_BYTES,
      identity: originalBasis,
      sourceImageUrl: SOURCE_IMAGE_URL,
    },
    analysisDependencies: analysisDependencies(incompatibleCounts, {
      emptyImpl: async () => {
        incompatibleCounts.empty += 1;
        return {
          basis: {
            ...emptyBasis,
            decodedWidth: 10,
            decodedHeight: 10,
          },
          bytes: EMPTY_BYTES,
          generated: true,
        };
      },
    }),
  });
  assert.equal(failed.status, "failed");
  assert.equal(await store.lookupDurableEmpty(USER_ID, originalBasis.sha256), null);
  const retryCounts = createCounts();
  const retry = await analyze(store, retryCounts, "analyze");
  assert.equal(retry.status, "ready");
  assert.equal(retryCounts.empty, 1);
});

test("corrupt durable EMPTY is a cache miss and regenerates", async () => {
  const store = await seededStore() as MemoryAfcProductionStore;
  const first = await analyze(store, createCounts(), "analyze");
  assert.equal(first.status, "ready");
  store.replaceDurableEmptyBytes(
    USER_ID,
    originalBasis.sha256,
    Uint8Array.from([1, 2, 3, 4, 5]),
  );
  const counts = createCounts();
  const retry = await analyze(store, counts, "run_again");
  assert.equal(retry.status, "ready");
  assert.equal(retry.authority?.empty.artifactSource, "generated");
  assert.equal(counts.empty, 1);
});

test("corrupt durable TILED is a cache miss and regenerates", async () => {
  const store = await seededStore() as MemoryAfcProductionStore;
  const first = await analyze(store, createCounts(), "analyze");
  assert.equal(first.status, "ready");
  const cacheKey = first.authority?.tiled.cacheKey;
  assert.ok(cacheKey);
  store.replaceDurableTiledBytes(USER_ID, cacheKey, Uint8Array.from([9, 9, 9]));
  const counts = createCounts();
  const retry = await analyze(store, counts, "run_again");
  assert.equal(retry.status, "ready");
  assert.equal(retry.authority?.tiled.artifactSource, "generated");
  assert.equal(counts.tiled, 1);
});

