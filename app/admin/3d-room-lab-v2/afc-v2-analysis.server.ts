import "server-only";

import { createHash } from "node:crypto";

import {
  CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
  buildCalibrationImageBasisId,
  type CalibrationImageBasis,
} from "@/app/admin/3d-room-lab/calibration-image-basis";
import {
  freezeAppliedTiledAfcCamera,
  type AppliedCalibratedCameraSnapshot,
} from "@/app/admin/3d-room-lab/afc-calibrated-camera-authority-freeze";
import {
  settleAfcFixedSeamCalibrationWithRatioExtension,
} from "@/app/admin/3d-room-lab/afc-fixed-seam-calibration";
import {
  validatePendingAfcLabCameraApply,
} from "@/app/admin/3d-room-lab/afc-lab-apply-transaction";
import {
  evaluateCalibratedCameraIdentityRestore,
} from "@/app/admin/3d-room-lab/calibrated-camera-restore-authority";
import {
  validateAfcSr1LiveResultAcceptance,
} from "@/app/admin/3d-room-lab/afc-sr1-live-acceptance";
import {
  executeAfcSr1TiledLiveProductAttempt,
  type AfcSr1TiledLiveProductDependencies,
} from "@/app/admin/3d-room-lab/afc-sr1-tiled-live-product";
import type {
  AfcSr1LiveAuthoritativeGeometry,
  AfcSr1LiveBasis,
  AfcSr1LiveProductResult,
} from "@/app/admin/3d-room-lab/afc-sr1-live-product-contract";
import {
  buildDurableSourceFloorAuthorityKey,
} from "@/app/admin/3d-room-lab/floor-source-authority";
import { evaluateQuadSolvability } from "@/app/admin/3d-room-lab/quad-solvability";
import {
  classifyAfcR3cImagePairCompatibility,
} from "@/app/admin/3d-room-lab/research/afc-r3c-image-pair-compatibility";
import {
  validateAfcSr1TiledPerspectiveExactGridLineage,
} from "@/app/admin/3d-room-lab/research/afc-sr1-tiled-perspective-exact-grid-lineage";
import { inspectImageMetadata } from "@/lib/vibodeAutoFloorImageFetch";

export const AFC_V2_REFERENCE_DEPTH_M = 4;

export type AfcV2AnalyzeInput = Readonly<{
  attemptId: string;
  sourceImageUrl: string;
  sourceImageIdentity: Readonly<{
    sha256: string;
    decodedWidth: number;
    decodedHeight: number;
    orientation: 1;
  }>;
  loadGeneration: number;
  frame: Readonly<{ width: number; height: number }>;
  referenceDepthM: number;
}>;

export type AfcV2AnalyzeResult =
  | Readonly<{
      status: "failed";
      reason: string;
      product: AfcSr1LiveProductResult;
    }>
  | Readonly<{
      status: "applied";
      product: AfcSr1LiveAuthoritativeGeometry;
      floor: Readonly<{
        authorityKey: string;
        sourceNormalizedPolygon: AfcSr1LiveAuthoritativeGeometry["geometry"]["sourceNormalizedPolygon"];
        worldWidthM: number;
        referenceDepthM: number;
        widthDepthRatio: number;
      }>;
      camera: Readonly<{
        applied: true;
        verticalFovDeg: number;
        pose: AppliedCalibratedCameraSnapshot["pose"];
        frame: Readonly<{ width: number; height: number }>;
        originalBasisRestored: true;
      }>;
      analysisMode: "live" | "controlled_replay";
      freezeReceipt: unknown;
    }>;

export type AfcV2ControlledReplayEvidence = Readonly<{
  kind: "afc-v2-controlled-replay/v1";
  original: Readonly<{ basis: AfcSr1LiveBasis; base64: string }>;
  empty: Readonly<{ basis: AfcSr1LiveBasis; base64: string }>;
  floorOnlyTiled: Readonly<{ basis: AfcSr1LiveBasis; base64: string }>;
  lineage: Readonly<{
    emptySha256: string;
    tiledSha256: string;
    emptyToOriginalCompatibilityTier:
      | "exact_grid_compatible"
      | "aspect_compatible_rescaled";
    transfer: "identity_source_normalized";
    tiledProvenance: Readonly<{
      generatorId: "vibode-tile-grid-scaffold/stage2/v1";
      profileId: "afc-sr1-tile-grid-scaffold/v1";
      researchPreset: "tile_grid_scaffold";
      requestedModelId: "NBP";
      runId: string;
      generatedAt: string;
      appliedAspectRatio: string | null;
      imageTransport: "data_url" | "http_url";
      generationStatus: "generated";
    }>;
  }>;
}>;

export type AfcV2AnalysisDependencies = Readonly<{
  product?: AfcSr1TiledLiveProductDependencies;
  analysisMode?: "live" | "controlled_replay";
}>;

export type AfcV2ControlledReplayTestDependencies = Readonly<
  Pick<AfcSr1TiledLiveProductDependencies, "readTiledPerspective" | "createResultId">
>;

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function decodeEvidence(base64: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) return null;
  const bytes = Buffer.from(base64, "base64");
  return bytes.byteLength > 0 ? Uint8Array.from(bytes) : null;
}

/**
 * Builds explicit test/dev replay dependencies. It bypasses EMPTY and TILED
 * generation only after all supplied byte identities and exact-grid bindings
 * have been checked; reader, settle, and camera realization remain unchanged.
 */
export async function createAfcV2ControlledReplayDependencies(
  input: AfcV2AnalyzeInput,
  evidence: AfcV2ControlledReplayEvidence,
): Promise<AfcSr1TiledLiveProductDependencies | null> {
  const originalBytes = decodeEvidence(evidence.original.base64);
  const emptyBytes = decodeEvidence(evidence.empty.base64);
  const tiledBytes = decodeEvidence(evidence.floorOnlyTiled.base64);
  if (!originalBytes || !emptyBytes || !tiledBytes) return null;
  if (
    sha256(originalBytes) !== evidence.original.basis.sha256 ||
    sha256(emptyBytes) !== evidence.empty.basis.sha256 ||
    sha256(tiledBytes) !== evidence.floorOnlyTiled.basis.sha256 ||
    originalBytes.byteLength !== evidence.original.basis.byteCount ||
    emptyBytes.byteLength !== evidence.empty.basis.byteCount ||
    tiledBytes.byteLength !== evidence.floorOnlyTiled.basis.byteCount ||
    evidence.original.basis.sha256 !== input.sourceImageIdentity.sha256 ||
    evidence.original.basis.decodedWidth !== input.sourceImageIdentity.decodedWidth ||
    evidence.original.basis.decodedHeight !== input.sourceImageIdentity.decodedHeight ||
    evidence.original.basis.orientation !== input.sourceImageIdentity.orientation ||
    evidence.floorOnlyTiled.basis.decodedWidth !== evidence.empty.basis.decodedWidth ||
    evidence.floorOnlyTiled.basis.decodedHeight !== evidence.empty.basis.decodedHeight ||
    evidence.floorOnlyTiled.basis.orientation !== 1 ||
    evidence.lineage.emptySha256 !== evidence.empty.basis.sha256 ||
    evidence.lineage.tiledSha256 !== evidence.floorOnlyTiled.basis.sha256 ||
    evidence.lineage.transfer !== "identity_source_normalized"
  ) {
    return null;
  }
  const originalMetadata = await inspectImageMetadata(Buffer.from(originalBytes));
  if (
    !originalMetadata.ok ||
    originalMetadata.width !== evidence.original.basis.decodedWidth ||
    originalMetadata.height !== evidence.original.basis.decodedHeight ||
    originalMetadata.orientation !== evidence.original.basis.orientation
  ) {
    return null;
  }
  const emptyToOriginal = classifyAfcR3cImagePairCompatibility(
    {
      fingerprint: evidence.original.basis.sha256,
      decodedWidth: evidence.original.basis.decodedWidth,
      decodedHeight: evidence.original.basis.decodedHeight,
      orientation: evidence.original.basis.orientation,
    },
    {
      fingerprint: evidence.empty.basis.sha256,
      decodedWidth: evidence.empty.basis.decodedWidth,
      decodedHeight: evidence.empty.basis.decodedHeight,
      orientation: evidence.empty.basis.orientation,
    },
  );
  if (
    emptyToOriginal.tier === "incompatible" ||
    emptyToOriginal.tier !== evidence.lineage.emptyToOriginalCompatibilityTier
  ) {
    return null;
  }

  return {
    qualifyOriginal: async () => ({
      basis: evidence.original.basis,
      sourceImageUrl: input.sourceImageUrl,
    }),
    resolveEmpty: async () => ({
      basis: evidence.empty.basis,
      bytes: emptyBytes,
      generated: false,
    }),
    generateTiled: async () => ({
      status: "generated",
      input: evidence.empty.basis,
      tiled: {
        base64: evidence.floorOnlyTiled.base64,
        identity: evidence.floorOnlyTiled.basis,
      },
      provenance: evidence.lineage.tiledProvenance,
      compatibility: classifyAfcR3cImagePairCompatibility(
        {
          fingerprint: evidence.empty.basis.sha256,
          decodedWidth: evidence.empty.basis.decodedWidth,
          decodedHeight: evidence.empty.basis.decodedHeight,
          orientation: evidence.empty.basis.orientation,
        },
        {
          fingerprint: evidence.floorOnlyTiled.basis.sha256,
          decodedWidth: evidence.floorOnlyTiled.basis.decodedWidth,
          decodedHeight: evidence.floorOnlyTiled.basis.decodedHeight,
          orientation: evidence.floorOnlyTiled.basis.orientation,
        },
      ),
    } as never),
    validateTiledLineage: (result, parentBytes, childBytes) =>
      validateAfcSr1TiledPerspectiveExactGridLineage(
        result,
        parentBytes,
        childBytes,
      ),
  };
}

function originalBasis(
  result: AfcSr1LiveAuthoritativeGeometry,
  sourceImageUrl: string,
): CalibrationImageBasis {
  return {
    basisId: buildCalibrationImageBasisId({
      sourceImageUrl,
      basisFingerprint: result.originalBasis.sha256,
      decodedWidth: result.originalBasis.decodedWidth,
      decodedHeight: result.originalBasis.decodedHeight,
    }),
    basisFingerprint: result.originalBasis.sha256,
    sourceImageUrl,
    decodedWidth: result.originalBasis.decodedWidth,
    decodedHeight: result.originalBasis.decodedHeight,
    encodedOrientation: 1,
    decodedOrientationNormal: true,
    orientationTransform: "identity",
    dimensionSource: "server",
    coordinateSpaceVersion: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
    basisKind: "original",
  };
}

/**
 * V2's server-side certified floor transaction. The browser receives an
 * already-applied result and never owns solver, Floor, or camera authority.
 */
export async function executeAfcV2Analysis(
  input: AfcV2AnalyzeInput,
  dependencies: AfcV2AnalysisDependencies = {},
): Promise<AfcV2AnalyzeResult> {
  const product = await executeAfcSr1TiledLiveProductAttempt({
    attemptId: input.attemptId,
    sourceImageUrl: input.sourceImageUrl,
    sourceImageIdentity: input.sourceImageIdentity,
    labLoadGeneration: input.loadGeneration,
    referenceDepthM: input.referenceDepthM,
  }, dependencies.product);
  if (product.status !== "authoritative_geometry") {
    return {
      status: "failed",
      reason:
        product.status === "failed"
          ? product.detail
          : "The certified floor product did not produce authoritative geometry.",
      product,
    };
  }

  const acceptance = validateAfcSr1LiveResultAcceptance(product, {
    currentAttemptId: input.attemptId,
    labLoadGeneration: input.loadGeneration,
    qualifiedBasis: {
      basisFingerprint: input.sourceImageIdentity.sha256,
      decodedWidth: input.sourceImageIdentity.decodedWidth,
      decodedHeight: input.sourceImageIdentity.decodedHeight,
      orientation: input.sourceImageIdentity.orientation,
    },
  });
  if (!acceptance.accepted) {
    return { status: "failed", reason: acceptance.reason, product };
  }

  const settle = settleAfcFixedSeamCalibrationWithRatioExtension({
    sourceNormalizedPolygon: product.geometry.sourceNormalizedPolygon,
    sourceImageSize: {
      width: product.originalBasis.decodedWidth,
      height: product.originalBasis.decodedHeight,
    },
    frameSize: input.frame,
    referenceDepthM: product.metric.referenceDepthM,
  });
  if (!settle.ok || !settle.applyObservability.available) {
    return {
      status: "failed",
      reason: settle.ok ? "AFC settle is not Apply-safe." : `AFC settle failed closed: ${settle.reason}.`,
      product,
    };
  }

  const floorAuthorityKey = buildDurableSourceFloorAuthorityKey(
    product.geometry.sourceNormalizedPolygon,
  );
  const pending = {
    token: 1,
    floorAuthorityKey,
    basisFingerprint: product.originalBasis.sha256,
    decodedWidth: product.originalBasis.decodedWidth,
    decodedHeight: product.originalBasis.decodedHeight,
    worldWidthM: settle.worldWidthM,
    worldDepthM: settle.worldDepthM,
    verticalFovDeg: settle.verticalFovDeg,
    frameWidth: input.frame.width,
    frameHeight: input.frame.height,
  } as const;
  const transaction = validatePendingAfcLabCameraApply(pending, {
    currentToken: pending.token,
    floorAuthorityKey,
    basis: {
      basisFingerprint: pending.basisFingerprint,
      decodedWidth: pending.decodedWidth,
      decodedHeight: pending.decodedHeight,
    },
    worldWidthM: pending.worldWidthM,
    worldDepthM: pending.worldDepthM,
    verticalFovDeg: pending.verticalFovDeg,
    frameWidth: pending.frameWidth,
    frameHeight: pending.frameHeight,
    isCalibratedCameraActive: false,
  });
  if (!transaction.valid) {
    return { status: "failed", reason: transaction.reason, product };
  }

  const solved = evaluateQuadSolvability({
    quadNorm: [...product.geometry.sourceNormalizedPolygon],
    frameSize: input.frame,
    floorDimensions: {
      worldWidth: settle.worldWidthM,
      worldDepth: settle.worldDepthM,
    },
    currentVerticalFovDeg: settle.verticalFovDeg,
    fovScanConfig: { minFovDeg: 20, maxFovDeg: 90, stepDeg: 1 },
  });
  const candidate = solved.applyCandidate;
  if (!candidate || !solved.applyEvaluation.available) {
    return {
      status: "failed",
      reason: `AFC camera Apply failed closed: ${solved.applyEvaluation.reason}.`,
      product,
    };
  }

  const snapshot: AppliedCalibratedCameraSnapshot = {
    pose: candidate.pose,
    fovDeg: settle.verticalFovDeg,
    frameSize: input.frame,
    diagnosticsSummary: `cv avg=${candidate.cvAvgPx} max=${candidate.cvMaxPx} scale=${candidate.scaleRatio}`,
    appliedAtIso: new Date().toISOString(),
    imageBasis: originalBasis(product, input.sourceImageUrl),
    sourceFloorPolygon: product.geometry.sourceNormalizedPolygon,
  };
  const freeze = await freezeAppliedTiledAfcCamera({
    appliedSnapshot: snapshot,
    liveResult: product,
    pending,
    settle,
    candidate,
    candidateEvaluation: solved.applyEvaluation,
    basisQualified: true,
    frozenAtIso: new Date().toISOString(),
    perspectiveAdjustment: null,
  });
  if (!freeze.ok) {
    return {
      status: "failed",
      reason: `AFC camera freeze failed closed: ${freeze.reason}.`,
      product,
    };
  }
  const restore = evaluateCalibratedCameraIdentityRestore({
    authority: freeze.value.payload.authority,
    currentImageBasis: snapshot.imageBasis,
    currentFrameSize: snapshot.frameSize,
    currentSourceFloorPolygon: snapshot.sourceFloorPolygon,
    currentFloorMapping: {
      worldWidth: settle.worldWidthM,
      worldDepth: settle.worldDepthM,
    },
    currentFovDeg: snapshot.fovDeg,
    freshCandidatePose: candidate.pose,
  });
  if (!restore.ok) {
    return {
      status: "failed",
      reason: `AFC camera restore identity failed closed: ${restore.reason}.`,
      product,
    };
  }

  return {
    status: "applied",
    product,
    floor: {
      authorityKey: floorAuthorityKey,
      sourceNormalizedPolygon: product.geometry.sourceNormalizedPolygon,
      worldWidthM: settle.worldWidthM,
      referenceDepthM: settle.referenceDepthM,
      widthDepthRatio: settle.widthDepthRatio,
    },
    camera: {
      applied: true,
      verticalFovDeg: snapshot.fovDeg,
      pose: snapshot.pose,
      frame: snapshot.frameSize,
      originalBasisRestored: true,
    },
    analysisMode: dependencies.analysisMode ?? "live",
    freezeReceipt: freeze.value,
  };
}

export async function executeAfcV2ControlledReplay(
  input: AfcV2AnalyzeInput,
  evidence: AfcV2ControlledReplayEvidence,
  testDependencies: AfcV2ControlledReplayTestDependencies = {},
): Promise<AfcV2AnalyzeResult> {
  const product = await createAfcV2ControlledReplayDependencies(input, evidence);
  if (!product) {
    return {
      status: "failed",
      reason: "Controlled replay evidence did not satisfy exact identity and lineage bindings.",
      product: {
        status: "failed",
        schemaVersion: "afc-sr1-complete-product-attempt/v2",
        attemptId: input.attemptId,
        resultId: "controlled-replay-rejected",
        labLoadGeneration: input.loadGeneration,
        reason: "invalid_request",
        detail: "controlled_replay_evidence_invalid",
        diagnostics: {
          finalReason: "controlled_replay_evidence_invalid",
          placementStatus: null,
          placementReason: null,
          validationP90Px: null,
          evidenceDigest: "controlled-replay-invalid",
          sameAttemptTs0Retained: false,
          attemptCounts: {
            originalQualification: 0,
            emptyGeneration: 0,
            tiledGeneration: 0,
            tiledReader: 0,
            geminiFloorProposal: 0,
            supportedRoomClassifier: 0,
            onAxisCorrection: 0,
            pathA: 0,
            rawReader: 0,
            ts0: 0,
            placement: 0,
            childReader: 0,
          },
          floorReadDiagnostic: null,
          supportedRoomClassifier: null,
        },
      },
    };
  }
  return executeAfcV2Analysis(input, {
    analysisMode: "controlled_replay",
    product: { ...product, ...testDependencies },
  });
}
