import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  executeAfcSr1TiledLiveProductAttempt,
  type AfcSr1TiledLiveProductDependencies,
} from "./afc-sr1-tiled-live-product";
import {
  getAfcSr1LiveAttemptEvidence,
} from "./afc-sr1-live-product";
import type { AfcSr1LiveAnalyzeRequest } from "./afc-sr1-live-product-contract";

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

function readerResponse(identity = tiledIdentity) {
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
});
