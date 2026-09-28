import assert from "node:assert/strict";
import test from "node:test";

import type { AfcSr1TiledLiveProductDependencies } from "@/app/admin/3d-room-lab/afc-sr1-tiled-live-product";
import { settleAfcFixedSeamCalibrationWithRatioExtension } from "@/app/admin/3d-room-lab/afc-fixed-seam-calibration";
import { projectAfcV2SettleDecisionDiagnostic } from "@/lib/afc-v2-production/settle-decision-diagnostic";

import {
  executeAfcV2Analysis,
  type AfcV2AnalyzeInput,
} from "./afc-v2-analysis.server";
import { buildFailedEmptyRoomObservationEvidence } from "./empty-room-observation-contract";

const EMPTY_BYTES = Uint8Array.from([4, 5, 6]);
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
  byteCount: EMPTY_BYTES.byteLength,
  decodedWidth: 1200,
  decodedHeight: 800,
  mimeType: "image/png" as const,
  orientation: 1 as const,
};
const tiledBasis = {
  sha256: "c".repeat(64),
  byteCount: 3,
  decodedWidth: 1200,
  decodedHeight: 800,
  mimeType: "image/png" as const,
  orientation: 1 as const,
};

const NO_APPLY_SAFE_QUAD = [
  { x: 0.05, y: 0.95 },
  { x: 0.95, y: 0.9 },
  { x: 0.98, y: 0.2 },
  { x: 0.02, y: 0.25 },
] as const;

const APPLY_QUAD = [
  { x: 0.1, y: 0.9 },
  { x: 0.9, y: 0.9 },
  { x: 0.65, y: 0.55 },
  { x: 0.35, y: 0.55 },
] as const;

function input(attemptId: string): AfcV2AnalyzeInput {
  return {
    attemptId,
    sourceImageUrl: "https://example.test/original.jpg",
    sourceImageIdentity: {
      sha256: originalBasis.sha256,
      decodedWidth: originalBasis.decodedWidth,
      decodedHeight: originalBasis.decodedHeight,
      orientation: 1,
    },
    loadGeneration: 3,
    frame: { width: 1200, height: 800 },
    referenceDepthM: 4,
  };
}

function product(
  quad: readonly [
    { readonly x: number; readonly y: number },
    { readonly x: number; readonly y: number },
    { readonly x: number; readonly y: number },
    { readonly x: number; readonly y: number },
  ],
  attemptId: string,
): AfcSr1TiledLiveProductDependencies {
  const analyzeInput = input(attemptId);
  return {
    createResultId: () => `${attemptId}-result`,
    qualifyOriginal: async () => ({
      sourceImageUrl: analyzeInput.sourceImageUrl,
      basis: originalBasis,
    }),
    resolveEmpty: async () => ({
      basis: emptyBasis,
      bytes: EMPTY_BYTES,
      generated: true,
    }),
    generateTiled: async () => ({
      status: "generated",
      input: emptyBasis,
      tiled: {
        base64: Buffer.from([1, 2, 3]).toString("base64"),
        identity: tiledBasis,
      },
      provenance: {
        generatorId: "vibode-tile-grid-scaffold/stage2/v1",
        profileId: "afc-sr1-tile-grid-scaffold/v1",
        researchPreset: "tile_grid_scaffold",
        requestedModelId: "NBP",
        runId: attemptId,
        generatedAt: "2026-09-28T00:00:00.000Z",
        appliedAspectRatio: "3:2",
        imageTransport: "data_url",
        generationStatus: "generated",
      },
      compatibility: { tier: "exact_grid_compatible" },
    } as never),
    validateTiledLineage: async () => ({
      tiledIdentity: tiledBasis,
      authority: { lineageEvidenceDigest: "d".repeat(64) },
    }) as never,
    readTiledPerspective: async () => ({
      status: "ok",
      decodedIdentity: tiledBasis,
      readerVersion: "afc-sr1-tiled-perspective-reader/s1",
      authoritativeQuadSourceNormalized: quad,
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
    }),
  };
}

function failedObservation(attemptId: string) {
  const analyzeInput = input(attemptId);
  return buildFailedEmptyRoomObservationEvidence({
    attemptId,
    loadGeneration: analyzeInput.loadGeneration,
    emptyIdentity: emptyBasis,
    originalAncestorSha256: originalBasis.sha256,
    provider: "controlled_fixture",
    model: "fixture",
    observerProfile: "empty-visible-architecture-conservative/v1",
    promptVersion: "afc-v2-empty-visible-room-observer/v4",
    generatedAt: "2026-09-28T00:00:00.000Z",
  }, {
    failureClass: "transport",
    failureStage: "provider_invocation",
    provider: "controlled_fixture",
    model: "fixture",
    providerStatus: null,
    safeDetail: "Controlled observer failure.",
    contractValidationReason: null,
  });
}

test("settle failure returns the same closed reason and keeps the diagnostic", async () => {
  const attemptId = "afr-3a-no-apply-safe";
  const analyzeInput = input(attemptId);
  const result = await executeAfcV2Analysis(analyzeInput, {
    analysisMode: "controlled_replay",
    product: product(NO_APPLY_SAFE_QUAD, attemptId),
    observeRoom: async () => failedObservation(attemptId),
  });
  const direct = settleAfcFixedSeamCalibrationWithRatioExtension({
    sourceNormalizedPolygon: NO_APPLY_SAFE_QUAD,
    sourceImageSize: {
      width: originalBasis.decodedWidth,
      height: originalBasis.decodedHeight,
    },
    frameSize: analyzeInput.frame,
    referenceDepthM: analyzeInput.referenceDepthM,
  });
  const projected = projectAfcV2SettleDecisionDiagnostic({
    settle: direct,
    sourceNormalizedPolygon: NO_APPLY_SAFE_QUAD,
  });
  assert.equal(result.status, "failed");
  if (result.status !== "failed") return;
  assert.equal(result.reason, "AFC settle failed closed: no_apply_safe_candidate.");
  assert.deepEqual(result.settleDecision, projected);
  assert.equal(JSON.stringify(result.settleDecision).includes("NaN"), false);
});

test("analysis that never reaches settle records reached false and the existing reason", async () => {
  const attemptId = "afr-3a-before-settle";
  const analyzeInput = input(attemptId);
  const dependencies = product(NO_APPLY_SAFE_QUAD, attemptId);
  const result = await executeAfcV2Analysis(analyzeInput, {
    analysisMode: "controlled_replay",
    product: {
      ...dependencies,
      readTiledPerspective: async () => ({
        status: "failed",
        reason: "no_complete_tile",
        decodedIdentity: tiledBasis,
        readerVersion: "afc-sr1-tiled-perspective-reader/s1",
      }),
    },
    observeRoom: async () => failedObservation(attemptId),
  });
  assert.equal(result.status, "failed");
  if (result.status !== "failed") return;
  assert.equal(result.product.status, "failed");
  if (result.product.status !== "failed") return;
  assert.equal(result.reason, result.product.detail);
  assert.doesNotMatch(result.reason, /AFC settle failed closed/);
  assert.deepEqual(result.settleDecision, {
    schemaVersion: "afc-v2-settle-decision-diagnostic/v1",
    reached: false,
  });
});

test("successful analysis records the winning settle diagnostic without changing the camera", async () => {
  const attemptId = "afr-3a-success";
  const analyzeInput = input(attemptId);
  const direct = settleAfcFixedSeamCalibrationWithRatioExtension({
    sourceNormalizedPolygon: APPLY_QUAD,
    sourceImageSize: {
      width: originalBasis.decodedWidth,
      height: originalBasis.decodedHeight,
    },
    frameSize: analyzeInput.frame,
    referenceDepthM: analyzeInput.referenceDepthM,
  });
  assert.equal(direct.ok, true);
  if (!direct.ok) return;
  const result = await executeAfcV2Analysis(analyzeInput, {
    analysisMode: "controlled_replay",
    product: product(APPLY_QUAD, attemptId),
    observeRoom: async () => failedObservation(attemptId),
  });
  assert.equal(result.status, "applied");
  if (result.status !== "applied") return;
  assert.equal(result.camera.verticalFovDeg, direct.verticalFovDeg);
  assert.equal(result.floor.widthDepthRatio, direct.widthDepthRatio);
  assert.deepEqual(
    result.settleDecision,
    projectAfcV2SettleDecisionDiagnostic({
      settle: direct,
      sourceNormalizedPolygon: APPLY_QUAD,
    }),
  );
});
