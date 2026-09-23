import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import sharp from "sharp";

import type {
  AfcSr1TiledPerspectiveReaderIdentity,
} from "@/lib/callCompositorAfcSr1TiledPerspectiveReader";
import type { AfcV2AnalyzeInput } from "./afc-v2-analysis.server";
import {
  executeAfcV2FullyTiledFloorAnalysis,
  prepareAfcV2OriginalAndEmpty,
  type PreparedAfcV2FloorInputs,
} from "./fully-tiled-floor-authority.server";
import type { FullyTiledGeneration } from "./fully-tiled-generation.server";

const input: AfcV2AnalyzeInput = {
  attemptId: "fully-tiled-floor-controlled",
  sourceImageUrl: "https://example.test/original.jpg",
  sourceImageIdentity: {
    sha256: "a".repeat(64),
    decodedWidth: 1200,
    decodedHeight: 800,
    orientation: 1,
  },
  loadGeneration: 1,
  frame: { width: 900, height: 600 },
  referenceDepthM: 4,
};

const originalBasis = {
  sha256: "a".repeat(64),
  byteCount: 100,
  decodedWidth: 1200,
  decodedHeight: 800,
  mimeType: "image/jpeg" as const,
  orientation: 1 as const,
};
const emptyBasis = {
  sha256: "b".repeat(64),
  byteCount: 150,
  decodedWidth: 1200,
  decodedHeight: 800,
  mimeType: "image/png" as const,
  orientation: 1 as const,
};
const fullyTiledIdentity = {
  sha256: "c".repeat(64),
  byteCount: 3,
  decodedWidth: 1200,
  decodedHeight: 800,
  mimeType: "image/png" as const,
  orientation: 1 as const,
};
const readerInputIdentity = {
  ...fullyTiledIdentity,
  sha256: "f".repeat(64),
  decodedWidth: 720,
  decodedHeight: 400,
};
const prepared: PreparedAfcV2FloorInputs = {
  attemptId: input.attemptId,
  resultId: "fully-tiled-floor-result",
  labLoadGeneration: input.loadGeneration,
  original: {
    sourceImageUrl: input.sourceImageUrl,
    basis: originalBasis,
  },
  empty: {
    basis: emptyBasis,
    bytes: Uint8Array.from([4, 5, 6]),
    generated: true,
  },
};
const generation: FullyTiledGeneration = {
  bytes: Uint8Array.from([1, 2, 3]),
  identity: fullyTiledIdentity,
  originalIdentity: originalBasis,
  provenance: {
    generationId: "fully-tiled-generation",
    generatorId: "afc-v2-fully-tiled-compositor/stage4/v1",
    promptVersion: "afc-v2-fully-tiled-generation/v1",
    promptSha256: "d".repeat(64),
    requestedModelId: "NBP",
    generatedFrom: "ORIGINAL",
    parentOriginalSha256: originalBasis.sha256,
    generatedAt: "2026-08-25T12:00:00.000Z",
    appliedAspectRatio: "3:2",
    imageTransport: "data_url",
  },
};

test("certified reader consumes exact-bound FULLY_TILED floor-region bytes and feeds unchanged camera gates", async () => {
  let suppliedBase64 = "";
  const result = await executeAfcV2FullyTiledFloorAnalysis(
    input,
    prepared,
    generation,
    {
      analysisMode: "controlled_replay",
      now: () => new Date("2026-08-25T12:00:01.000Z"),
      prepareFloorReaderInput: async () => ({
        bytes: generation.bytes,
        identity: readerInputIdentity,
        crop: {
          kind: "lower_center_floor_region_crop",
          leftSourceNormalized: 0.2,
          rightSourceNormalized: 0.8,
          topSourceNormalized: 0.5,
          sourceIdentitySha256: fullyTiledIdentity.sha256,
          sourceNormalizedTransform:
            "x_source=left+x_crop*(right-left);y_source=top+y_crop*(1-top)",
        },
      }),
      readTiledPerspective: async (args) => {
        suppliedBase64 = args.imageBase64;
        assert.deepEqual(args.claimedIdentity, readerInputIdentity);
        return {
          status: "ok",
          decodedIdentity: readerInputIdentity,
          readerVersion: "afc-sr1-tiled-perspective-reader/s1",
          authoritativeQuadSourceNormalized: [
            { x: 1 / 6, y: 0.8 },
            { x: 5 / 6, y: 0.8 },
            { x: 0.75, y: 0.1 },
            { x: 0.25, y: 0.1 },
          ],
          authoritativeQuadPixel: [
            { x: 120, y: 720 },
            { x: 1080, y: 720 },
            { x: 780, y: 440 },
            { x: 420, y: 440 },
          ],
          authoritativeCore: {
            rows: 2,
            columns: 2,
            j0: 0,
            i0: 0,
            cellIds: [1, 2, 3, 4],
          },
          selectedComponentTileCount: 4,
          rawQuadrilateralCount: 4,
          deduplicatedCellCount: 4,
          reprojectionMeanPx: 0.5,
          reprojectionMaxPx: 1,
        };
      },
    },
  );

  assert.equal(suppliedBase64, "AQID");
  assert.equal(result.status, "applied");
  if (result.status !== "applied") return;
  assert.equal(result.product.floorObservationSource.kind, "FULLY_TILED");
  assert.equal(
    result.product.floorObservationSource.imageIdentity.sha256,
    fullyTiledIdentity.sha256,
  );
  assert.equal(
    result.product.floorObservationSource.parentOriginalSha256,
    originalBasis.sha256,
  );
  assert.equal(
    result.product.floorObservationSource.readerInput.crop
      .sourceIdentitySha256,
    fullyTiledIdentity.sha256,
  );
  assert.equal(
    result.freezeReceipt.receiptVersion,
    "afc-v2-fully-tiled-camera-freeze/v1",
  );
  assert.equal(
    result.freezeReceipt.payload.floorObservation.generationId,
    generation.provenance.generationId,
  );
  assert.equal(result.camera.originalBasisRestored, true);
  assert.equal(result.freezeReceipt.payload.cameraApply.validation, "passed");
});

test("reader identity mismatch fails closed before camera authority", async () => {
  const result = await executeAfcV2FullyTiledFloorAnalysis(
    input,
    prepared,
    generation,
    {
      prepareFloorReaderInput: async () => ({
        bytes: generation.bytes,
        identity: readerInputIdentity,
        crop: {
          kind: "lower_center_floor_region_crop",
          leftSourceNormalized: 0.2,
          rightSourceNormalized: 0.8,
          topSourceNormalized: 0.5,
          sourceIdentitySha256: fullyTiledIdentity.sha256,
          sourceNormalizedTransform:
            "x_source=left+x_crop*(right-left);y_source=top+y_crop*(1-top)",
        },
      }),
      readTiledPerspective: async () => ({
        status: "failed",
        reason: "invalid_input_image",
        decodedIdentity: {
          ...readerInputIdentity,
          sha256: "e".repeat(64),
        },
        readerVersion: "afc-sr1-tiled-perspective-reader/s1",
      }),
    },
  );
  assert.equal(result.status, "failed");
  if (result.status !== "failed") return;
  assert.equal(result.reason, "FULLY_TILED floor reader identity mismatch.");
  assert.equal(result.product, null);
});

test("wall-like lattice returned inside the crop cannot become Floor authority", async () => {
  const result = await executeAfcV2FullyTiledFloorAnalysis(
    input,
    prepared,
    generation,
    {
      prepareFloorReaderInput: async () => ({
        bytes: generation.bytes,
        identity: readerInputIdentity,
        crop: {
          kind: "lower_center_floor_region_crop",
          leftSourceNormalized: 0.2,
          rightSourceNormalized: 0.8,
          topSourceNormalized: 0.5,
          sourceIdentitySha256: fullyTiledIdentity.sha256,
          sourceNormalizedTransform:
            "x_source=left+x_crop*(right-left);y_source=top+y_crop*(1-top)",
        },
      }),
      readTiledPerspective: async () => ({
        status: "ok",
        decodedIdentity: readerInputIdentity,
        readerVersion: "afc-sr1-tiled-perspective-reader/s1",
        authoritativeQuadSourceNormalized: [
          { x: 0.1, y: 0.3 },
          { x: 0.4, y: 0.3 },
          { x: 0.4, y: 0.1 },
          { x: 0.1, y: 0.1 },
        ],
        authoritativeQuadPixel: [
          { x: 72, y: 120 },
          { x: 288, y: 120 },
          { x: 288, y: 40 },
          { x: 72, y: 40 },
        ],
        authoritativeCore: {
          rows: 2,
          columns: 2,
          j0: 0,
          i0: 0,
          cellIds: [1, 2, 3, 4],
        },
        selectedComponentTileCount: 4,
        rawQuadrilateralCount: 4,
        deduplicatedCellCount: 4,
        reprojectionMeanPx: 0.5,
        reprojectionMaxPx: 1,
      }),
    },
  );
  assert.equal(result.status, "failed");
  if (result.status !== "failed") return;
  assert.equal(
    result.reason,
    "FULLY_TILED floor reader returned no admissible lower-center floor quad.",
  );
  assert.equal(result.product, null);
});

test("stale prepared Original binding fails before the reader", async () => {
  let readerCalled = false;
  const result = await executeAfcV2FullyTiledFloorAnalysis(
    input,
    {
      ...prepared,
      original: {
        ...prepared.original,
        sourceImageUrl: "https://example.test/stale.jpg",
      },
    },
    generation,
    {
      readTiledPerspective: async () => {
        readerCalled = true;
        throw new Error("must not run");
      },
    },
  );
  assert.equal(result.status, "failed");
  if (result.status !== "failed") return;
  assert.equal(result.reason, "FULLY_TILED floor acceptance binding failed.");
  assert.equal(readerCalled, false);
});

test("Original and EMPTY preparation rejects an incompatible display basis", async () => {
  const result = await prepareAfcV2OriginalAndEmpty(
    input,
    "prepared-result",
    {
      qualifyOriginal: async () => prepared.original,
      resolveEmpty: async () => ({
        basis: {
          ...emptyBasis,
          decodedWidth: 400,
          decodedHeight: 400,
        },
        bytes: Uint8Array.from([4, 5, 6]),
        generated: true,
      }),
    },
  );
  assert.deepEqual(result, {
    status: "failed",
    reason: "original_empty_incompatible",
  });
});

test("default adapter crops the lower-center FULLY_TILED region and exact-binds reader identity", async () => {
  const bytes = await sharp({
    create: {
      width: 1200,
      height: 800,
      channels: 3,
      background: { r: 120, g: 120, b: 120 },
    },
  }).png().toBuffer();
  const identity = {
    ...fullyTiledIdentity,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    byteCount: bytes.byteLength,
  };
  const croppedGeneration: FullyTiledGeneration = {
    ...generation,
    bytes: Uint8Array.from(bytes),
    identity,
  };
  const claims: AfcSr1TiledPerspectiveReaderIdentity[] = [];
  const result = await executeAfcV2FullyTiledFloorAnalysis(
    input,
    prepared,
    croppedGeneration,
    {
      readTiledPerspective: async (args) => {
        claims.push(args.claimedIdentity);
        return {
          status: "failed",
          reason: "no_complete_tile",
          decodedIdentity: args.claimedIdentity,
          readerVersion: "afc-sr1-tiled-perspective-reader/s1",
        };
      },
    },
  );
  assert.equal(result.status, "failed");
  assert.equal(claims[0]?.decodedWidth, 720);
  assert.equal(claims[0]?.decodedHeight, 400);
  assert.notEqual(claims[0]?.sha256, identity.sha256);
});
