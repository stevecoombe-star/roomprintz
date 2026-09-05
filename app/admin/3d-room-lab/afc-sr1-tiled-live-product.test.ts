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
} from "./research/afc-sr1-tile-grid-scaffold";
import {
  resetAfcSr1TiledArtifactCacheForTests,
} from "./afc-sr1-tiled-artifact-cache";
import {
  executeAfcSr1TiledLiveProductAttempt,
  type AfcSr1TiledLiveProductDependencies,
} from "./afc-sr1-tiled-live-product";
import {
  getAfcSr1LiveAttemptEvidence,
} from "./afc-sr1-live-product";
import type { AfcSr1LiveAnalyzeRequest } from "./afc-sr1-live-product-contract";
import type { AfcSr1TiledPerspectiveReaderIdentity } from "@/lib/callCompositorAfcSr1TiledPerspectiveReader";

const originalIdentity = {
  sha256: "a".repeat(64),
  byteCount: 100,
  decodedWidth: 1200,
  decodedHeight: 800,
  mimeType: "image/png" as const,
  orientation: 1 as const,
};
const emptyIdentity = {
  ...originalIdentity,
  sha256: "b".repeat(64),
};
const tiledIdentity = {
  ...originalIdentity,
  sha256: "c".repeat(64),
  mimeType: "image/png" as const,
};
const quad = [
  { x: 0.1, y: 0.9 },
  { x: 0.9, y: 0.8 },
  { x: 0.7, y: 0.5 },
  { x: 0.3, y: 0.5 },
] as const;

function request(): AfcSr1LiveAnalyzeRequest {
  return {
    attemptId: "s2a-attempt",
    sourceImageUrl: "https://example.test/room.png",
    sourceImageIdentity: {
      sha256: originalIdentity.sha256,
      decodedWidth: originalIdentity.decodedWidth,
      decodedHeight: originalIdentity.decodedHeight,
      orientation: 1,
    },
    labLoadGeneration: 7,
    referenceDepthM: 5.25,
  };
}

function readerResponse(identity: AfcSr1TiledPerspectiveReaderIdentity = tiledIdentity) {
  return {
    status: "ok" as const,
    decodedIdentity: identity,
    readerVersion: "afc-sr1-tiled-perspective-reader/s1" as const,
    authoritativeQuadSourceNormalized: quad,
    authoritativeQuadPixel: quad,
    authoritativeCore: { rows: 2, columns: 2, j0: 0, i0: 0, cellIds: [1, 2, 3, 4] },
    selectedComponentTileCount: 4,
    rawQuadrilateralCount: 6,
    deduplicatedCellCount: 4,
    reprojectionMeanPx: 0.5,
    reprojectionMaxPx: 1.5,
  };
}

function harness(): {
  dependencies: AfcSr1TiledLiveProductDependencies;
  calls: Record<string, number>;
} {
  const calls = { qualify: 0, empty: 0, tiled: 0, lineage: 0, reader: 0 };
  return {
    calls,
    dependencies: {
      createResultId: () => "result-s2a",
      qualifyOriginal: async () => {
        calls.qualify++;
        return { basis: originalIdentity, sourceImageUrl: request().sourceImageUrl };
      },
      resolveEmpty: async () => {
        calls.empty++;
        return { basis: emptyIdentity, bytes: Uint8Array.of(1, 2, 3), generated: true };
      },
      generateTiled: async () => {
        calls.tiled++;
        return {
          status: "generated",
          input: emptyIdentity,
          tiled: { base64: "AQID", identity: tiledIdentity },
          provenance: {},
          compatibility: {},
        } as never;
      },
      validateTiledLineage: async () => {
        calls.lineage++;
        return {
          tiledIdentity,
          authority: { lineageEvidenceDigest: "d".repeat(64) },
        } as never;
      },
      readTiledPerspective: async () => {
        calls.reader++;
        assert.deepEqual(
          getAfcSr1LiveAttemptEvidence(request().attemptId)?.tiledPerspective
            ?.tiledBytes,
          Uint8Array.of(1, 2, 3),
          "the generated TILED evidence is retained before the reader runs"
        );
        return readerResponse();
      },
    },
  };
}

test("S2A performs one exact authority path and transfers the reader quad to Original", async () => {
  const { dependencies, calls } = harness();
  const result = await executeAfcSr1TiledLiveProductAttempt(request(), dependencies);
  assert.equal(result.status, "authoritative_geometry");
  assert.deepEqual(calls, { qualify: 1, empty: 1, tiled: 1, lineage: 1, reader: 1 });
  assert.equal(result.geometry.mode, "tiled-perspective-core");
  assert.equal(result.geometry.geometryAuthority, "tiled_perspective_reader");
  assert.deepEqual(result.geometry.sourceNormalizedPolygon, quad);
  assert.deepEqual(result.geometry.rawSourceNormalizedPolygon, quad);
  assert.equal(result.geometry.acceptanceBasis.basisFingerprint, originalIdentity.sha256);
  assert.equal(result.geometry.tiledPerspective?.tiledBasis.sha256, tiledIdentity.sha256);
  assert.equal(result.geometry.tiledPerspective?.emptyToTiledTransfer, "identity_source_normalized");
  assert.equal(result.metric.perspectiveAuthority, "tiled_perspective_core");
  assert.ok(result.diagnosticImages);
  assert.match(
    result.diagnosticImages.emptyUrl,
    /live-attempt-empty\?attemptId=s2a-attempt/
  );
  assert.match(
    result.diagnosticImages.tiledUrl,
    /live-attempt-tiled\?attemptId=s2a-attempt/
  );
  assert.doesNotMatch(JSON.stringify(result), /"base64"|tiledBytes/);
  assert.deepEqual(result.perspectiveAdjust, {
    supported: true,
    mode: "tiled_symmetric_near_edge_v1",
    reason: "tiled_automatic_baseline_v1",
  });
  assert.deepEqual(result.diagnostics.attemptCounts, {
    originalQualification: 1,
    emptyGeneration: 1,
    tiledGeneration: 1,
    tiledReader: 1,
    geminiFloorProposal: 0,
    supportedRoomClassifier: 0,
    onAxisCorrection: 0,
    pathA: 0,
    rawReader: 0,
    ts0: 0,
    placement: 0,
    childReader: 0,
  });
});

test("S2A accepts an injected certified EMPTY without stage-1 generation", async () => {
  const { dependencies, calls } = harness();
  const result = await executeAfcSr1TiledLiveProductAttempt(request(), {
    ...dependencies,
    resolveEmpty: async () => {
      calls.empty++;
      return { basis: emptyIdentity, bytes: Uint8Array.of(1, 2, 3), generated: false };
    },
  });
  assert.equal(result.status, "authoritative_geometry");
  assert.equal(result.geometry.geometryAuthority, "tiled_perspective_reader");
  assert.deepEqual(calls, { qualify: 1, empty: 1, tiled: 1, lineage: 1, reader: 1 });
  assert.equal(result.diagnostics.attemptCounts.emptyGeneration, 0);
  assert.equal(result.diagnostics.attemptCounts.tiledGeneration, 1);
  assert.equal(result.diagnostics.attemptCounts.tiledReader, 1);
});

test("S2A stops on a reader failure without a second generation or fallback", async () => {
  const { dependencies, calls } = harness();
  const failingReader = async () => {
    calls.reader++;
    return {
      status: "failed" as const,
      reason: "no_coherent_lattice" as const,
      decodedIdentity: tiledIdentity,
      readerVersion: "afc-sr1-tiled-perspective-reader/s1" as const,
    };
  };
  const result = await executeAfcSr1TiledLiveProductAttempt(request(), {
    ...dependencies,
    readTiledPerspective: failingReader,
  });
  assert.equal(result.status, "failed");
  assert.equal(result.reason, "no_coherent_lattice");
  assert.deepEqual(calls, { qualify: 1, empty: 1, tiled: 1, lineage: 1, reader: 1 });
  assert.deepEqual(
    getAfcSr1LiveAttemptEvidence(request().attemptId)?.tiledPerspective?.tiledBytes,
    Uint8Array.of(1, 2, 3),
    "a reader failure does not discard or regenerate retained TILED evidence"
  );
});

test("S2A rejects a non-exact TILED lineage before reader invocation", async () => {
  const { dependencies, calls } = harness();
  const rejectLineage = async () => {
    calls.lineage++;
    throw new Error("aspect_rescaled");
  };
  const result = await executeAfcSr1TiledLiveProductAttempt(request(), {
    ...dependencies,
    validateTiledLineage: rejectLineage,
  });
  assert.equal(result.status, "failed");
  assert.equal(result.reason, "tiled_lineage_not_exact_grid");
  assert.deepEqual(calls, { qualify: 1, empty: 1, tiled: 1, lineage: 1, reader: 0 });
});

test("S2A rejects a reader response not bound to generated TILED bytes", async () => {
  const { dependencies, calls } = harness();
  const mismatchedReader = async () => {
    calls.reader++;
    return readerResponse({ ...tiledIdentity, sha256: "e".repeat(64) });
  };
  const result = await executeAfcSr1TiledLiveProductAttempt(request(), {
    ...dependencies,
    readTiledPerspective: mismatchedReader,
  });
  assert.equal(result.status, "failed");
  assert.equal(result.reason, "tiled_identity_mismatch");
  assert.equal(calls.reader, 1);
});

test("S2A source contains no legacy perspective authority calls", () => {
  const source = readFileSync(
    new URL("./afc-sr1-tiled-live-product.ts", import.meta.url),
    "utf8"
  );
  for (const forbidden of [
    "resolveCanonicalAfcFloorFromEmpty",
    "classifyAfcSr1SupportedRoomView",
    "deriveAfcSr1OnAxisParallelWidthFloor",
    "executeAfcSr1RawFirstPlacementAwareOrchestration",
    "correctedOffAxisPolygon",
    "raw_receipt_invalid",
  ]) {
    assert.doesNotMatch(source, new RegExp(forbidden));
  }
  assert.match(source, /getOrGenerateCachedTiledArtifact/);
  assert.match(source, /useTiledArtifactCache/);
});

const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL5WQAAAABJRU5ErkJggg==",
  "base64",
);
const PIXEL_B = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIW2NgYGD4DwABBAEAf4cI9QAAAABJRU5ErkJggg==",
  "base64",
);
const PIXEL_SHA = createHash("sha256").update(PIXEL).digest("hex");
const PIXEL_B_SHA = createHash("sha256").update(PIXEL_B).digest("hex");
const cacheEmptyIdentity = {
  sha256: PIXEL_SHA,
  byteCount: PIXEL.byteLength,
  decodedWidth: 1200,
  decodedHeight: 800,
  mimeType: "image/png" as const,
  orientation: 1 as const,
};
const cacheTiledIdentity = {
  sha256: PIXEL_SHA,
  byteCount: PIXEL.byteLength,
  decodedWidth: 1200,
  decodedHeight: 800,
  mimeType: "image/png" as const,
  orientation: 1 as const,
};

function cacheRequest(
  attemptId: string,
  forceTiledRegeneration = false,
): AfcSr1LiveAnalyzeRequest {
  return {
    attemptId,
    sourceImageUrl: "https://example.test/room.png",
    sourceImageIdentity: {
      sha256: originalIdentity.sha256,
      decodedWidth: originalIdentity.decodedWidth,
      decodedHeight: originalIdentity.decodedHeight,
      orientation: 1,
    },
    labLoadGeneration: 7,
    referenceDepthM: 5.25,
    forceTiledRegeneration,
  };
}

function cacheGenerated(
  runId: string,
  emptySha = PIXEL_SHA,
  tiledBytes: Buffer = PIXEL,
) {
  const tiledSha = createHash("sha256").update(tiledBytes).digest("hex");
  const tiledIdentity = {
    ...cacheTiledIdentity,
    sha256: tiledSha,
    byteCount: tiledBytes.byteLength,
  };
  return {
    status: "generated" as const,
    input: { ...cacheEmptyIdentity, sha256: emptySha },
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
      appliedAspectRatio: "3:2",
      imageTransport: "data_url" as const,
      generationStatus: "generated" as const,
    },
    compatibility: classifyAfcR3cImagePairCompatibility(
      {
        fingerprint: emptySha,
        decodedWidth: 1200,
        decodedHeight: 800,
        orientation: 1,
      },
      {
        fingerprint: tiledSha,
        decodedWidth: 1200,
        decodedHeight: 800,
        orientation: 1,
      },
    ),
  };
}

function cacheHarness(options: {
  attemptId: string;
  emptySha?: string;
  emptyGenerated?: boolean;
  tiledBytes?: Buffer;
  readerQuad?: readonly [
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
  ];
  failReader?: boolean;
  failGenerate?: boolean;
  failLineage?: boolean;
}) {
  const calls = { qualify: 0, empty: 0, tiled: 0, lineage: 0, reader: 0 };
  const emptySha = options.emptySha ?? PIXEL_SHA;
  const tiledBytes = options.tiledBytes ?? PIXEL;
  const tiledSha = createHash("sha256").update(tiledBytes).digest("hex");
  const readerIdentity = {
    ...cacheTiledIdentity,
    sha256: tiledSha,
    byteCount: tiledBytes.byteLength,
  };
  const dependencies: AfcSr1TiledLiveProductDependencies = {
    createResultId: () => `result-${options.attemptId}`,
    useTiledArtifactCache: true,
    qualifyOriginal: async () => {
      calls.qualify++;
      return {
        basis: originalIdentity,
        sourceImageUrl: cacheRequest(options.attemptId).sourceImageUrl,
      };
    },
    resolveEmpty: async () => {
      calls.empty++;
      return {
        basis: { ...cacheEmptyIdentity, sha256: emptySha },
        bytes: Uint8Array.from(PIXEL),
        generated: options.emptyGenerated ?? true,
      };
    },
    generateTiled: async () => {
      calls.tiled++;
      if (options.failGenerate) {
        return {
          status: "failure",
          code: "timeout",
          runId: "failed-tiled",
        };
      }
      return cacheGenerated(`live-${options.attemptId}`, emptySha, tiledBytes);
    },
    validateTiledLineage: async (result) => {
      calls.lineage++;
      if (options.failLineage) {
        throw new Error("aspect_rescaled");
      }
      const identity = result.status === "generated"
        ? result.tiled.identity
        : readerIdentity;
      return {
        tiledIdentity: identity,
        authority: { lineageEvidenceDigest: "d".repeat(64) },
      } as never;
    },
    readTiledPerspective: async (args) => {
      calls.reader++;
      if (options.failReader) {
        return {
          status: "failed" as const,
          reason: "no_coherent_lattice" as const,
          decodedIdentity: args.claimedIdentity,
          readerVersion: "afc-sr1-tiled-perspective-reader/s1" as const,
        };
      }
      const response = readerResponse(args.claimedIdentity);
      return options.readerQuad
        ? {
            ...response,
            authoritativeQuadSourceNormalized: options.readerQuad,
          }
        : response;
    },
  };
  return { calls, dependencies };
}

test("injected generateTiled bypasses the process cache unless opted in", async () => {
  resetAfcSr1TiledArtifactCacheForTests();
  const { dependencies, calls } = harness();
  await executeAfcSr1TiledLiveProductAttempt(request(), dependencies);
  await executeAfcSr1TiledLiveProductAttempt(request(), dependencies);
  assert.equal(calls.tiled, 2);
  assert.equal(calls.reader, 2);
});

test("cold live Analyze generates TILED once and admits the artifact", async () => {
  resetAfcSr1TiledArtifactCacheForTests();
  const { dependencies, calls } = cacheHarness({ attemptId: "cold-tiled" });
  const result = await executeAfcSr1TiledLiveProductAttempt(
    cacheRequest("cold-tiled"),
    dependencies,
  );
  assert.equal(result.status, "authoritative_geometry");
  assert.deepEqual(calls, { qualify: 1, empty: 1, tiled: 1, lineage: 1, reader: 1 });
  assert.equal(result.diagnostics.attemptCounts.emptyGeneration, 1);
  assert.equal(result.diagnostics.attemptCounts.tiledGeneration, 1);
  assert.equal(result.diagnostics.attemptCounts.tiledReader, 1);
  assert.equal(result.diagnostics.emptyArtifactSource, "generated");
  assert.equal(result.diagnostics.tiledArtifactSource, "generated");
  assert.equal(result.diagnostics.tiledArtifactRefreshRequested, false);
  assert.equal(result.geometry.tiledPerspective?.tiledBasis.sha256, PIXEL_SHA);
});

test("warm same-room Analyze restores TILED and still runs a fresh Reader", async () => {
  resetAfcSr1TiledArtifactCacheForTests();
  const first = cacheHarness({ attemptId: "warm-1", emptyGenerated: true });
  const second = cacheHarness({
    attemptId: "warm-2",
    emptyGenerated: false,
    readerQuad: [
      { x: 0.2, y: 0.85 },
      { x: 0.8, y: 0.82 },
      { x: 0.66, y: 0.48 },
      { x: 0.28, y: 0.5 },
    ],
  });
  const cold = await executeAfcSr1TiledLiveProductAttempt(
    cacheRequest("warm-1"),
    first.dependencies,
  );
  const warm = await executeAfcSr1TiledLiveProductAttempt(
    cacheRequest("warm-2"),
    { ...second.dependencies, generateTiled: first.dependencies.generateTiled },
  );
  assert.equal(cold.status, "authoritative_geometry");
  assert.equal(warm.status, "authoritative_geometry");
  assert.equal(first.calls.tiled + second.calls.tiled, 1);
  assert.equal(first.calls.reader, 1);
  assert.equal(second.calls.reader, 1);
  assert.equal(warm.diagnostics.attemptCounts.emptyGeneration, 0);
  assert.equal(warm.diagnostics.attemptCounts.tiledGeneration, 0);
  assert.equal(warm.diagnostics.attemptCounts.tiledReader, 1);
  assert.equal(warm.diagnostics.emptyArtifactSource, "cache");
  assert.equal(warm.diagnostics.tiledArtifactSource, "cache");
  assert.equal(warm.diagnostics.tiledArtifactRefreshRequested, false);
  assert.equal(
    warm.geometry.tiledPerspective?.tiledBasis.sha256,
    cold.geometry.tiledPerspective?.tiledBasis.sha256,
  );
  assert.notDeepEqual(
    warm.geometry.sourceNormalizedPolygon,
    cold.geometry.sourceNormalizedPolygon,
  );
});

test("different EMPTY SHA misses the TILED cache", async () => {
  resetAfcSr1TiledArtifactCacheForTests();
  const first = cacheHarness({ attemptId: "empty-a" });
  const otherEmpty = "e".repeat(64);
  const second = cacheHarness({ attemptId: "empty-b", emptySha: otherEmpty });
  await executeAfcSr1TiledLiveProductAttempt(
    cacheRequest("empty-a"),
    first.dependencies,
  );
  const miss = await executeAfcSr1TiledLiveProductAttempt(
    cacheRequest("empty-b"),
    second.dependencies,
  );
  assert.equal(first.calls.tiled, 1);
  assert.equal(second.calls.tiled, 1);
  assert.equal(miss.diagnostics.attemptCounts.tiledGeneration, 1);
  assert.equal(miss.diagnostics.tiledArtifactSource, "generated");
});

test("TILED generation failure is not cached", async () => {
  resetAfcSr1TiledArtifactCacheForTests();
  const failing = cacheHarness({ attemptId: "fail-1", failGenerate: true });
  const failed = await executeAfcSr1TiledLiveProductAttempt(
    cacheRequest("fail-1"),
    failing.dependencies,
  );
  assert.equal(failed.status, "failed");
  const retry = cacheHarness({ attemptId: "fail-2" });
  const recovered = await executeAfcSr1TiledLiveProductAttempt(
    cacheRequest("fail-2"),
    retry.dependencies,
  );
  assert.equal(failing.calls.tiled, 1);
  assert.equal(retry.calls.tiled, 1);
  assert.equal(recovered.status, "authoritative_geometry");
  assert.equal(recovered.diagnostics.attemptCounts.tiledGeneration, 1);
});

test("Reader failure does not evict cached TILED", async () => {
  resetAfcSr1TiledArtifactCacheForTests();
  const first = cacheHarness({ attemptId: "reader-fail", failReader: true });
  const failed = await executeAfcSr1TiledLiveProductAttempt(
    cacheRequest("reader-fail"),
    first.dependencies,
  );
  assert.equal(failed.status, "failed");
  assert.equal(failed.reason, "no_coherent_lattice");
  assert.equal(first.calls.tiled, 1);
  const second = cacheHarness({ attemptId: "reader-retry" });
  const retry = await executeAfcSr1TiledLiveProductAttempt(
    cacheRequest("reader-retry"),
    {
      ...second.dependencies,
      generateTiled: first.dependencies.generateTiled,
    },
  );
  assert.equal(first.calls.tiled, 1);
  assert.equal(second.calls.tiled, 0);
  assert.equal(retry.status, "authoritative_geometry");
  assert.equal(retry.diagnostics.attemptCounts.tiledGeneration, 0);
  assert.equal(retry.diagnostics.tiledArtifactSource, "cache");
  assert.equal(second.calls.reader, 1);
});

test("concurrent live-product resolves share one TILED generation", async () => {
  resetAfcSr1TiledArtifactCacheForTests();
  let tiledCalls = 0;
  const gate = {
    promise: Promise.resolve(),
    resolve: () => undefined as void,
  };
  let release!: () => void;
  gate.promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  const generateTiled = async () => {
    tiledCalls += 1;
    await gate.promise;
    return cacheGenerated("concurrent-run");
  };
  const first = cacheHarness({ attemptId: "concurrent-a" });
  const second = cacheHarness({ attemptId: "concurrent-b", emptyGenerated: false });
  const firstPromise = executeAfcSr1TiledLiveProductAttempt(
    cacheRequest("concurrent-a"),
    { ...first.dependencies, generateTiled },
  );
  const secondPromise = executeAfcSr1TiledLiveProductAttempt(
    cacheRequest("concurrent-b"),
    { ...second.dependencies, generateTiled },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(tiledCalls, 1);
  release();
  const [a, b] = await Promise.all([firstPromise, secondPromise]);
  assert.equal(tiledCalls, 1);
  assert.equal(a.status, "authoritative_geometry");
  assert.equal(b.status, "authoritative_geometry");
  if (a.status !== "authoritative_geometry" || b.status !== "authoritative_geometry") return;
  assert.equal(
    a.geometry.tiledPerspective?.tiledBasis.sha256,
    b.geometry.tiledPerspective?.tiledBasis.sha256,
  );
});

test("warm Re-read Room Perspective regenerates TILED from cached EMPTY", async () => {
  resetAfcSr1TiledArtifactCacheForTests();
  const first = cacheHarness({ attemptId: "reread-prime" });
  const refresh = cacheHarness({
    attemptId: "reread-warm",
    emptyGenerated: false,
    tiledBytes: PIXEL_B,
  });
  await executeAfcSr1TiledLiveProductAttempt(
    cacheRequest("reread-prime"),
    first.dependencies,
  );
  const reread = await executeAfcSr1TiledLiveProductAttempt(
    cacheRequest("reread-warm", true),
    refresh.dependencies,
  );
  assert.equal(reread.status, "authoritative_geometry");
  assert.equal(first.calls.tiled, 1);
  assert.equal(refresh.calls.tiled, 1);
  assert.equal(refresh.calls.reader, 1);
  assert.equal(reread.diagnostics.attemptCounts.emptyGeneration, 0);
  assert.equal(reread.diagnostics.attemptCounts.tiledGeneration, 1);
  assert.equal(reread.diagnostics.attemptCounts.tiledReader, 1);
  assert.equal(reread.diagnostics.emptyArtifactSource, "cache");
  assert.equal(reread.diagnostics.tiledArtifactSource, "generated");
  assert.equal(reread.diagnostics.tiledArtifactRefreshRequested, true);
  assert.equal(reread.geometry.tiledPerspective?.tiledBasis.sha256, PIXEL_B_SHA);
});

test("successful force refresh replaces cache for the next normal Analyze", async () => {
  resetAfcSr1TiledArtifactCacheForTests();
  const first = cacheHarness({ attemptId: "replace-a" });
  const refresh = cacheHarness({
    attemptId: "replace-b",
    emptyGenerated: false,
    tiledBytes: PIXEL_B,
  });
  const warm = cacheHarness({ attemptId: "replace-warm", emptyGenerated: false });
  const primed = await executeAfcSr1TiledLiveProductAttempt(
    cacheRequest("replace-a"),
    first.dependencies,
  );
  const refreshed = await executeAfcSr1TiledLiveProductAttempt(
    cacheRequest("replace-b", true),
    refresh.dependencies,
  );
  const next = await executeAfcSr1TiledLiveProductAttempt(
    cacheRequest("replace-warm"),
    warm.dependencies,
  );
  assert.equal(primed.status, "authoritative_geometry");
  assert.equal(refreshed.status, "authoritative_geometry");
  assert.equal(next.status, "authoritative_geometry");
  assert.equal(first.calls.tiled, 1);
  assert.equal(refresh.calls.tiled, 1);
  assert.equal(warm.calls.tiled, 0);
  assert.equal(warm.calls.reader, 1);
  assert.equal(primed.geometry.tiledPerspective?.tiledBasis.sha256, PIXEL_SHA);
  assert.equal(refreshed.geometry.tiledPerspective?.tiledBasis.sha256, PIXEL_B_SHA);
  assert.equal(next.geometry.tiledPerspective?.tiledBasis.sha256, PIXEL_B_SHA);
  assert.equal(next.diagnostics.tiledArtifactSource, "cache");
  assert.equal(next.diagnostics.attemptCounts.tiledGeneration, 0);
  assert.equal(next.diagnostics.tiledArtifactRefreshRequested, false);
});

test("force refresh generation failure fails closed and preserves SHA-A", async () => {
  resetAfcSr1TiledArtifactCacheForTests();
  const first = cacheHarness({ attemptId: "fail-preserve-a" });
  const failing = cacheHarness({
    attemptId: "fail-preserve-b",
    emptyGenerated: false,
    failGenerate: true,
  });
  const retry = cacheHarness({ attemptId: "fail-preserve-retry", emptyGenerated: false });
  await executeAfcSr1TiledLiveProductAttempt(
    cacheRequest("fail-preserve-a"),
    first.dependencies,
  );
  const failed = await executeAfcSr1TiledLiveProductAttempt(
    cacheRequest("fail-preserve-b", true),
    failing.dependencies,
  );
  assert.equal(failed.status, "failed");
  assert.equal(failed.reason, "tiled_generation_failed");
  assert.equal(failed.diagnostics.tiledArtifactSource, "generated");
  assert.equal(failed.diagnostics.tiledArtifactRefreshRequested, true);
  assert.equal("geometry" in failed, false);
  assert.equal(failing.calls.tiled, 1);
  assert.equal(failing.calls.reader, 0);
  const next = await executeAfcSr1TiledLiveProductAttempt(
    cacheRequest("fail-preserve-retry"),
    retry.dependencies,
  );
  assert.equal(next.status, "authoritative_geometry");
  assert.equal(retry.calls.tiled, 0);
  assert.equal(retry.calls.reader, 1);
  assert.equal(next.diagnostics.tiledArtifactSource, "cache");
  assert.equal(next.geometry.tiledPerspective?.tiledBasis.sha256, PIXEL_SHA);
});

test("Reader failure after force refresh keeps the new TILED cache entry", async () => {
  resetAfcSr1TiledArtifactCacheForTests();
  const first = cacheHarness({ attemptId: "reader-after-a" });
  const refresh = cacheHarness({
    attemptId: "reader-after-b",
    emptyGenerated: false,
    tiledBytes: PIXEL_B,
    failReader: true,
  });
  const retry = cacheHarness({ attemptId: "reader-after-retry", emptyGenerated: false });
  await executeAfcSr1TiledLiveProductAttempt(
    cacheRequest("reader-after-a"),
    first.dependencies,
  );
  const failed = await executeAfcSr1TiledLiveProductAttempt(
    cacheRequest("reader-after-b", true),
    refresh.dependencies,
  );
  assert.equal(failed.status, "failed");
  assert.equal(failed.reason, "no_coherent_lattice");
  assert.equal(refresh.calls.tiled, 1);
  const next = await executeAfcSr1TiledLiveProductAttempt(
    cacheRequest("reader-after-retry"),
    retry.dependencies,
  );
  assert.equal(next.status, "authoritative_geometry");
  assert.equal(retry.calls.tiled, 0);
  assert.equal(retry.calls.reader, 1);
  assert.equal(next.diagnostics.tiledArtifactSource, "cache");
  assert.equal(next.geometry.tiledPerspective?.tiledBasis.sha256, PIXEL_B_SHA);
});

test("lineage failure after force refresh restores the previous TILED artifact", async () => {
  resetAfcSr1TiledArtifactCacheForTests();
  const first = cacheHarness({ attemptId: "lineage-a" });
  const refresh = cacheHarness({
    attemptId: "lineage-b",
    emptyGenerated: false,
    tiledBytes: PIXEL_B,
    failLineage: true,
  });
  const retry = cacheHarness({ attemptId: "lineage-retry", emptyGenerated: false });
  await executeAfcSr1TiledLiveProductAttempt(
    cacheRequest("lineage-a"),
    first.dependencies,
  );
  const failed = await executeAfcSr1TiledLiveProductAttempt(
    cacheRequest("lineage-b", true),
    refresh.dependencies,
  );
  assert.equal(failed.status, "failed");
  assert.equal(failed.reason, "tiled_lineage_not_exact_grid");
  assert.equal(refresh.calls.reader, 0);
  const next = await executeAfcSr1TiledLiveProductAttempt(
    cacheRequest("lineage-retry"),
    retry.dependencies,
  );
  assert.equal(next.status, "authoritative_geometry");
  assert.equal(retry.calls.tiled, 0);
  assert.equal(next.geometry.tiledPerspective?.tiledBasis.sha256, PIXEL_SHA);
});

test("force refresh and normal Analyze share the same Reader request path", () => {
  const source = readFileSync(
    new URL("./afc-sr1-tiled-live-product.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /from "@\/lib\/callCompositorAfcSr1TiledPerspectiveReader"/,
  );
  assert.match(
    source,
    /dependencies\.readTiledPerspective \?\? callCompositorAfcSr1TiledPerspectiveReader/,
  );
  assert.equal(
    source.split("?? callCompositorAfcSr1TiledPerspectiveReader").length - 1,
    1,
  );
  assert.doesNotMatch(
    source,
    /forceTiledRegeneration[\s\S]{0,180}readTiledPerspective|readTiledPerspective[\s\S]{0,180}forceTiledRegeneration/,
  );
  assert.match(source, /forceRefresh: forceTiledRegeneration/);
  assert.match(source, /getOrGenerateCachedTiledArtifact/);
});
