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
  getAfcSr1LiveAttemptEvidence,
} from "@/app/admin/3d-room-lab/afc-sr1-live-product";
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
  AFC_SR1_TILE_GRID_SCAFFOLD_GENERATOR_ID,
  AFC_SR1_TILE_GRID_SCAFFOLD_PRESET,
  AFC_SR1_TILE_GRID_SCAFFOLD_PROFILE,
  AFC_SR1_TILE_GRID_SCAFFOLD_REQUESTED_MODEL_ID,
} from "@/app/admin/3d-room-lab/research/afc-sr1-tile-grid-scaffold";
import {
  validateAfcSr1TiledPerspectiveExactGridLineage,
} from "@/app/admin/3d-room-lab/research/afc-sr1-tiled-perspective-exact-grid-lineage";
import { inspectImageMetadata } from "@/lib/vibodeAutoFloorImageFetch";
import {
  buildFailedEmptyRoomObservationEvidence,
  type EmptyRoomObservationEvidence,
} from "./empty-room-observation-contract";
import {
  AFC_V2_EMPTY_ROOM_OBSERVATION_DEFAULT_MODEL,
  AFC_V2_EMPTY_ROOM_OBSERVATION_PROFILE,
  AFC_V2_EMPTY_ROOM_OBSERVATION_PROMPT_VERSION,
  observeRetainedEmptyRoom,
} from "./empty-room-observation.server";
import {
  AFC_V2_EMPTY_SIDE_CEILING_WALL_PROFILE,
  AFC_V2_EMPTY_SIDE_CEILING_WALL_PROMPT_VERSION,
  emptyFocusedSideCeilingWallSibling,
  observeFocusedSideCeilingWallSeams,
} from "./empty-side-ceiling-wall-observation.server";
import {
  buildFailedFocusedSideCeilingWallEvidence,
} from "./empty-side-ceiling-wall-observation-contract";
import { mergeFocusedSideCeilingWallSeams } from "./empty-side-ceiling-wall-observation-merge.server";
import type { FocusedSideCeilingWallEvidence } from "./empty-side-ceiling-wall-observation-contract";
import {
  AFC_V2_EMPTY_SIDE_FLOOR_WALL_PROFILE,
  AFC_V2_EMPTY_SIDE_FLOOR_WALL_PROMPT_VERSION,
  emptyFocusedSideFloorWallSibling,
  observeFocusedSideFloorWallObservation,
} from "./empty-side-floor-wall-observation.server";
import {
  buildFailedFocusedSideFloorWallEvidence,
} from "./empty-side-floor-wall-observation-contract";
import { mergeFocusedSideFloorWallObservation } from "./empty-side-floor-wall-observation-merge.server";
import type { FocusedSideFloorWallEvidence } from "./empty-side-floor-wall-observation-contract";
import { constructAfcV2RoomBoundaryAuthority } from "./room-boundary-authority.server";
import type { AfcV2RoomBoundaryAuthorityReceipt } from "./room-boundary-authority-contract";
import { constructAfcV2RoomCollisionAuthority } from "./room-collision-qualification.server";
import type { AfcV2RoomCollisionAuthorityReceipt } from "./room-collision-authority-contract";
import { constructEmptyOriginalRegistrationAuthority } from "./empty-original-registration.server";
import type { AfcV2EmptyOriginalRegistrationAuthorityReceipt } from "./empty-original-registration-authority-contract";
import { constructAfcV2RoomEnvelopeAuthority } from "./room-envelope-authority.server";
import type { AfcV2RoomEnvelopeAuthorityReceipt } from "./room-envelope-authority-contract";
import { constructAfcV2RoomEnvelopeCollisionAuthority } from "./room-envelope-collision-qualification.server";
import type { AfcV2RoomEnvelopeCollisionAuthorityReceipt } from "./room-envelope-collision-authority-contract";
import { constructOriginalStructuralLocalizationAuthority } from "./original-structural-localization.server";
import {
  shouldAttemptOriginalStructuralLocalization,
  type AfcV2OriginalStructuralLocalizationAuthorityReceipt,
} from "./original-structural-localization-authority-contract";
import { constructOriginalLocalizedBoundaryAuthority } from "./original-localized-boundary.server";
import type { AfcV2OriginalLocalizedRoomBoundaryAuthorityReceipt } from "./original-localized-boundary-authority-contract";
import { constructOriginalLocalizedCollisionAuthority } from "./original-localized-collision-qualification.server";
import type { AfcV2OriginalLocalizedCollisionAuthorityReceipt } from "./original-localized-collision-authority-contract";
import { constructAfcV2EmptyAuthoritativeCollisionAuthority } from "./empty-authoritative-collision-qualification.server";
import type { AfcV2EmptyAuthoritativeCollisionAuthorityReceipt } from "./empty-authoritative-collision-authority-contract";
import {
  buildUnavailableMetricRoomPriorReceipt,
  type MetricPriorImageIdentity,
  type MetricRoomPriorReceipt,
  type MetricRoomPriorReceiptContext,
} from "./metric-room-prior-contract";
import {
  AFC_V2_METRIC_ROOM_PRIOR_DEFAULT_MODEL,
  estimateMetricRoomPrior,
  type MetricRoomPriorInput,
} from "./metric-room-prior.server";
import {
  emptyMetricCorrespondenceSelection,
  type MetricCorrespondenceSelection,
} from "./metric-correspondence-span-contract";
import { selectMetricCorrespondenceSpan } from "./metric-correspondence-span";
import {
  buildUnavailableMetricCorrespondenceEstimateReceipt,
  type MetricCorrespondenceEstimateReceipt,
  type MetricCorrespondenceEstimateReceiptContext,
} from "./metric-correspondence-estimate-contract";
import {
  AFC_V2_METRIC_CORRESPONDENCE_ESTIMATE_DEFAULT_MODEL,
  estimateMetricCorrespondenceSpan,
  type MetricCorrespondenceEstimateInput,
} from "./metric-correspondence-estimate.server";
import {
  getAutoFloorVisionAllowedImageHosts,
  getAutoFloorVisionImageFetchTimeoutMs,
  getAutoFloorVisionImageMaxBytes,
  isAutoFloorVisionAllowLocalhostHttp,
} from "@/lib/vibodeAutoFloorVisionConfig";
import { fetchRoomImageSafely } from "@/lib/vibodeAutoFloorImageFetch";

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

type AfcV2LivePipelineEvidence = Readonly<{
  empty: Readonly<{
    imageUrl: string;
    identity: AfcSr1LiveBasis;
    provenance: Readonly<{
      generatedFrom: "ORIGINAL";
      parentOriginalSha256: string;
    }>;
  }> | null;
  tiled: Readonly<{
    imageUrl: string;
    identity: AfcSr1LiveBasis;
    provenance: Readonly<{
      generatedFrom: "EMPTY";
      parentEmptySha256: string;
      originalAncestorSha256: string;
      lineageEvidenceDigest: string | null;
      generatorId: typeof AFC_SR1_TILE_GRID_SCAFFOLD_GENERATOR_ID;
      profileId: typeof AFC_SR1_TILE_GRID_SCAFFOLD_PROFILE;
      researchPreset: typeof AFC_SR1_TILE_GRID_SCAFFOLD_PRESET;
      requestedModelId: typeof AFC_SR1_TILE_GRID_SCAFFOLD_REQUESTED_MODEL_ID;
    }>;
    floorReaderContract: Readonly<{
      authority: "tiled_perspective_reader";
      input: "full_tiled_raster";
      inputIdentitySha256: string;
      sourceNormalizedTransfer: "identity_source_normalized";
      readerVersion: string | null;
    }>;
  }> | null;
  liveGeneratedRepresentations: readonly ["EMPTY", "TILED"];
  executionCounts: Readonly<{
    emptyGeneration: number;
    floorOnlyTiledGeneration: number;
    tiledFloorReader: number;
    fullyTiledGeneration: 0;
    fullyTiledFloorReader: 0;
    roomObserver: 0 | 1;
    focusedSideCeilingObserver: 0 | 1;
    focusedSideFloorWallObserver: 0 | 1;
  }>;
  roomObservation: EmptyRoomObservationEvidence | null;
  roomObservationStatus:
    | "observed"
    | "partial"
    | "failed"
    | "not_run_empty_unavailable";
  roomObservationDiagnostic:
    | EmptyRoomObservationEvidence["failure"]
    | null;
  focusedSideCeilingObservation: FocusedSideCeilingWallEvidence | null;
  focusedSideCeilingObservationStatus:
    | FocusedSideCeilingWallEvidence["observerStatus"]
    | "empty"
    | "not_run";
  focusedSideFloorWallObservation: FocusedSideFloorWallEvidence | null;
  focusedSideFloorWallObservationStatus:
    | FocusedSideFloorWallEvidence["observerStatus"]
    | "empty"
    | "not_run";
  roomBoundaries: AfcV2RoomBoundaryAuthorityReceipt | null;
  roomCollision: AfcV2RoomCollisionAuthorityReceipt | null;
  emptyOriginalRegistration: AfcV2EmptyOriginalRegistrationAuthorityReceipt | null;
  roomEnvelope: AfcV2RoomEnvelopeAuthorityReceipt | null;
  roomEnvelopeCollision: AfcV2RoomEnvelopeCollisionAuthorityReceipt | null;
  originalStructuralLocalization: AfcV2OriginalStructuralLocalizationAuthorityReceipt | null;
  originalLocalizedBoundary: AfcV2OriginalLocalizedRoomBoundaryAuthorityReceipt | null;
  originalLocalizedCollision: AfcV2OriginalLocalizedCollisionAuthorityReceipt | null;
  emptyAuthoritativeCollision: AfcV2EmptyAuthoritativeCollisionAuthorityReceipt | null;
  metricRoomPrior: MetricRoomPriorReceipt | null;
  metricCorrespondence: MetricCorrespondenceSelection | null;
  metricCorrespondenceEstimate: MetricCorrespondenceEstimateReceipt | null;
}>;

export type AfcV2AnalyzeResult =
  | Readonly<AfcV2LivePipelineEvidence & {
      status: "failed";
      reason: string;
      product: AfcSr1LiveProductResult;
    }>
  | Readonly<AfcV2LivePipelineEvidence & {
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
  observeRoom?: typeof observeRetainedEmptyRoom;
  observeFocusedSideCeilingWall?: typeof observeFocusedSideCeilingWallSeams;
  observeFocusedSideFloorWall?: typeof observeFocusedSideFloorWallObservation;
  estimateMetricRoom?: (
    input: MetricRoomPriorInput,
  ) => Promise<MetricRoomPriorReceipt>;
  estimateMetricCorrespondence?: (
    input: MetricCorrespondenceEstimateInput,
  ) => Promise<MetricCorrespondenceEstimateReceipt>;
  analysisMode?: "live" | "controlled_replay";
  registrationRasters?: Readonly<{
    originalBytes: Uint8Array;
    emptyBytes: Uint8Array;
  }>;
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

function livePipelineEvidence(
  input: AfcV2AnalyzeInput,
  product: AfcSr1LiveProductResult,
  roomObservation: EmptyRoomObservationEvidence | null,
  focusedSideCeilingObservation: FocusedSideCeilingWallEvidence | null,
  focusedSideFloorWallObservation: FocusedSideFloorWallEvidence | null,
  metricRoomPrior: MetricRoomPriorReceipt | null,
): AfcV2LivePipelineEvidence {
  const evidence = getAfcSr1LiveAttemptEvidence(input.attemptId);
  const binding = evidence?.binding;
  const empty = evidence?.floorRead && binding
    ? Object.freeze({
      imageUrl:
        `/api/admin/3d-room-lab-v2/attempt-empty?attemptId=${encodeURIComponent(input.attemptId)}`,
      identity: evidence.floorRead.emptyBasis,
      provenance: Object.freeze({
        generatedFrom: "ORIGINAL" as const,
        parentOriginalSha256: binding.originalBasis.sha256,
      }),
    })
    : null;
  const perspective = product.status === "authoritative_geometry"
    ? product.geometry.tiledPerspective
    : null;
  const tiled = evidence?.tiledPerspective && binding
    ? Object.freeze({
      imageUrl:
        `/api/admin/3d-room-lab-v2/attempt-tiled?attemptId=${encodeURIComponent(input.attemptId)}`,
      identity: evidence.tiledPerspective.tiledBasis,
      provenance: Object.freeze({
        generatedFrom: "EMPTY" as const,
        parentEmptySha256: binding.emptyBasis.sha256,
        originalAncestorSha256: binding.originalBasis.sha256,
        lineageEvidenceDigest:
          perspective?.emptyToTiledLineageDigest ?? null,
        generatorId: AFC_SR1_TILE_GRID_SCAFFOLD_GENERATOR_ID,
        profileId: AFC_SR1_TILE_GRID_SCAFFOLD_PROFILE,
        researchPreset: AFC_SR1_TILE_GRID_SCAFFOLD_PRESET,
        requestedModelId: AFC_SR1_TILE_GRID_SCAFFOLD_REQUESTED_MODEL_ID,
      }),
      floorReaderContract: Object.freeze({
        authority: "tiled_perspective_reader" as const,
        input: "full_tiled_raster" as const,
        inputIdentitySha256: evidence.tiledPerspective.tiledBasis.sha256,
        sourceNormalizedTransfer: "identity_source_normalized" as const,
        readerVersion: perspective?.readerVersion ?? null,
      }),
    })
    : null;
  const counts = product.diagnostics.attemptCounts;
  return Object.freeze({
    empty,
    tiled,
    liveGeneratedRepresentations: Object.freeze(["EMPTY", "TILED"] as const),
    executionCounts: Object.freeze({
      emptyGeneration: counts.emptyGeneration,
      floorOnlyTiledGeneration: counts.tiledGeneration,
      tiledFloorReader: counts.tiledReader,
      fullyTiledGeneration: 0 as const,
      fullyTiledFloorReader: 0 as const,
      roomObserver: roomObservation ? 1 as const : 0 as const,
      focusedSideCeilingObserver: focusedSideCeilingObservation ? 1 as const : 0 as const,
      focusedSideFloorWallObserver: focusedSideFloorWallObservation ? 1 as const : 0 as const,
    }),
    roomObservation,
    roomObservationStatus: roomObservation?.observerStatus ??
      "not_run_empty_unavailable",
    roomObservationDiagnostic: roomObservation?.failure ?? null,
    focusedSideCeilingObservation,
    focusedSideCeilingObservationStatus:
      focusedSideCeilingObservation?.observerStatus === "failed"
        ? "failed"
        : focusedSideCeilingObservation?.observerStatus === "observed" &&
            focusedSideCeilingObservation.observedSeams.length === 0
        ? "empty"
        : focusedSideCeilingObservation?.observerStatus ?? "not_run",
    focusedSideFloorWallObservation,
    focusedSideFloorWallObservationStatus:
      focusedSideFloorWallObservation?.observerStatus === "failed"
        ? "failed"
        : focusedSideFloorWallObservation?.observerStatus === "observed" &&
            focusedSideFloorWallObservation.observedSides.length === 0
        ? "empty"
        : focusedSideFloorWallObservation?.observerStatus ?? "not_run",
    roomBoundaries: null,
    roomCollision: null,
    emptyOriginalRegistration: null,
    roomEnvelope: null,
    roomEnvelopeCollision: null,
    originalStructuralLocalization: null,
    originalLocalizedBoundary: null,
    originalLocalizedCollision: null,
    emptyAuthoritativeCollision: null,
    metricRoomPrior,
    metricCorrespondence: null,
    metricCorrespondenceEstimate: null,
  });
}

type OriginalCapture = { bytes: Uint8Array | null };

function metricPriorModelId(): string {
  return process.env.AFC_V2_ROOM_OBSERVATION_MODEL?.trim() ||
    AFC_V2_METRIC_ROOM_PRIOR_DEFAULT_MODEL;
}

function metricPriorContext(
  input: AfcV2AnalyzeInput,
  provider: MetricRoomPriorReceiptContext["provider"],
): MetricRoomPriorReceiptContext {
  return {
    sourceImageHash: input.sourceImageIdentity.sha256,
    originalAncestorSha256: input.sourceImageIdentity.sha256,
    attemptId: input.attemptId,
    loadGeneration: input.loadGeneration,
    provider,
    model: metricPriorModelId(),
  };
}

function isControlledMetricPriorFixture(
  dependencies: AfcV2AnalysisDependencies,
): boolean {
  return Boolean(
    dependencies.estimateMetricRoom ||
    dependencies.observeRoom ||
    dependencies.observeFocusedSideCeilingWall ||
    dependencies.observeFocusedSideFloorWall ||
    dependencies.analysisMode === "controlled_replay",
  );
}

function asOriginalMime(
  value: string,
): MetricPriorImageIdentity["mimeType"] | null {
  return value === "image/jpeg" || value === "image/png" || value === "image/webp"
    ? value
    : null;
}

function stubOriginalForMetricPrior(
  input: AfcV2AnalyzeInput,
  bytes: Uint8Array,
): MetricRoomPriorInput["original"] {
  return {
    bytes,
    identity: {
      sha256: input.sourceImageIdentity.sha256,
      byteCount: bytes.byteLength,
      decodedWidth: input.sourceImageIdentity.decodedWidth,
      decodedHeight: input.sourceImageIdentity.decodedHeight,
      mimeType: "image/jpeg",
      orientation: 1,
    },
  };
}

async function resolveOriginalForMetricPrior(
  input: AfcV2AnalyzeInput,
  dependencies: AfcV2AnalysisDependencies,
  capture: OriginalCapture,
): Promise<MetricRoomPriorInput["original"] | null> {
  if (dependencies.registrationRasters?.originalBytes) {
    const bytes = dependencies.registrationRasters.originalBytes;
    capture.bytes = bytes;
    return stubOriginalForMetricPrior(input, bytes);
  }
  try {
    const fetched = await fetchRoomImageSafely(input.sourceImageUrl, {
      allowedHosts: getAutoFloorVisionAllowedImageHosts(),
      maxBytes: getAutoFloorVisionImageMaxBytes(),
      timeoutMs: getAutoFloorVisionImageFetchTimeoutMs(),
      allowLocalhostHttp: isAutoFloorVisionAllowLocalhostHttp(),
    });
    if (!fetched.ok) return null;
    const bytes = Uint8Array.from(fetched.buffer);
    if (sha256(bytes) !== input.sourceImageIdentity.sha256) return null;
    const mime = asOriginalMime(fetched.mime);
    if (!mime) return null;
    capture.bytes = bytes;
    return {
      bytes,
      identity: {
        sha256: input.sourceImageIdentity.sha256,
        byteCount: bytes.byteLength,
        decodedWidth: input.sourceImageIdentity.decodedWidth,
        decodedHeight: input.sourceImageIdentity.decodedHeight,
        mimeType: mime,
        orientation: 1,
      },
    };
  } catch {
    return null;
  }
}

function unavailableMetricPrior(
  input: AfcV2AnalyzeInput,
  provider: MetricRoomPriorReceiptContext["provider"],
  args: {
    failureClass: "configuration" | "basis_validation" | "unknown";
    failureStage: "configuration" | "basis_validation" | "provider_invocation";
    safeDetail: string;
    contractValidationReason: string | null;
  },
): MetricRoomPriorReceipt {
  return buildUnavailableMetricRoomPriorReceipt(
    metricPriorContext(input, provider),
    {
      failureClass: args.failureClass,
      failureStage: args.failureStage,
      provider,
      model: metricPriorModelId(),
      providerStatus: null,
      safeDetail: args.safeDetail,
      contractValidationReason: args.contractValidationReason,
    },
  );
}

function startMetricRoomPrior(
  input: AfcV2AnalyzeInput,
  dependencies: AfcV2AnalysisDependencies,
  originalCapture: OriginalCapture,
): Promise<MetricRoomPriorReceipt> {
  return (async () => {
    try {
      if (dependencies.estimateMetricRoom) {
        if (dependencies.registrationRasters?.originalBytes) {
          originalCapture.bytes = dependencies.registrationRasters.originalBytes;
        }
        return await dependencies.estimateMetricRoom({
          attemptId: input.attemptId,
          loadGeneration: input.loadGeneration,
          original: stubOriginalForMetricPrior(
            input,
            originalCapture.bytes ?? new Uint8Array(),
          ),
        });
      }
      if (isControlledMetricPriorFixture(dependencies)) {
        return unavailableMetricPrior(input, "controlled_fixture", {
          failureClass: "configuration",
          failureStage: "configuration",
          safeDetail:
            "Metric room prior was not invoked in this controlled fixture.",
          contractValidationReason: "controlled_fixture_metric_prior_not_run",
        });
      }
      const original = await resolveOriginalForMetricPrior(
        input,
        dependencies,
        originalCapture,
      );
      if (!original) {
        return unavailableMetricPrior(input, "google_gemini", {
          failureClass: "basis_validation",
          failureStage: "basis_validation",
          safeDetail: "ORIGINAL image was unavailable for the metric room prior.",
          contractValidationReason: "original_unavailable_for_metric_prior",
        });
      }
      return await estimateMetricRoomPrior({
        attemptId: input.attemptId,
        loadGeneration: input.loadGeneration,
        original,
      });
    } catch (error) {
      const provider = dependencies.estimateMetricRoom ||
          isControlledMetricPriorFixture(dependencies)
        ? "controlled_fixture" as const
        : "google_gemini" as const;
      return unavailableMetricPrior(input, provider, {
        failureClass: "unknown",
        failureStage: "provider_invocation",
        safeDetail: error instanceof Error
          ? error.message.replace(/key=[^&\s"']+/gi, "key=[REDACTED]").slice(0, 320)
          : "Metric room prior branch rejected unexpectedly; Floor/Camera continued independently.",
        contractValidationReason: null,
      });
    }
  })();
}

function metricSpanEstimateModelId(): string {
  return process.env.AFC_V2_ROOM_OBSERVATION_MODEL?.trim() ||
    AFC_V2_METRIC_CORRESPONDENCE_ESTIMATE_DEFAULT_MODEL;
}

function metricSpanEstimateContext(
  input: AfcV2AnalyzeInput,
  spanId: string,
  provider: MetricCorrespondenceEstimateReceiptContext["provider"],
): MetricCorrespondenceEstimateReceiptContext {
  return {
    correspondenceSpanId: spanId,
    sourceImageHash: input.sourceImageIdentity.sha256,
    overlayImageHash: "",
    attemptId: input.attemptId,
    loadGeneration: input.loadGeneration,
    provider,
    model: metricSpanEstimateModelId(),
  };
}

function unavailableMetricSpanEstimate(
  input: AfcV2AnalyzeInput,
  spanId: string,
  provider: MetricCorrespondenceEstimateReceiptContext["provider"],
  args: {
    failureClass: "configuration" | "basis_validation" | "overlay_generation" | "unknown";
    failureStage: "configuration" | "basis_validation" | "overlay_generation" | "provider_invocation";
    safeDetail: string;
    contractValidationReason: string | null;
  },
): MetricCorrespondenceEstimateReceipt {
  return buildUnavailableMetricCorrespondenceEstimateReceipt(
    metricSpanEstimateContext(input, spanId, provider),
    {
      failureClass: args.failureClass,
      failureStage: args.failureStage,
      provider,
      model: metricSpanEstimateModelId(),
      providerStatus: null,
      safeDetail: args.safeDetail,
      contractValidationReason: args.contractValidationReason,
    },
  );
}

function originalForSpanEstimate(
  input: AfcV2AnalyzeInput,
  bytes: Uint8Array,
): MetricCorrespondenceEstimateInput["original"] {
  return stubOriginalForMetricPrior(input, bytes);
}

async function startMetricCorrespondenceEstimate(
  input: AfcV2AnalyzeInput,
  dependencies: AfcV2AnalysisDependencies,
  originalCapture: OriginalCapture,
  correspondence: MetricCorrespondenceSelection,
): Promise<MetricCorrespondenceEstimateReceipt | null> {
  const selected = correspondence.selected;
  if (!selected) return null;
  try {
    if (dependencies.estimateMetricCorrespondence) {
      return await dependencies.estimateMetricCorrespondence({
        attemptId: input.attemptId,
        loadGeneration: input.loadGeneration,
        original: originalForSpanEstimate(
          input,
          originalCapture.bytes ?? new Uint8Array(),
        ),
        span: selected,
      });
    }
    if (isControlledMetricPriorFixture(dependencies)) {
      return null;
    }
    const original = originalCapture.bytes
      ? originalForSpanEstimate(input, originalCapture.bytes)
      : await resolveOriginalForMetricPrior(input, dependencies, originalCapture);
    if (!original) {
      return unavailableMetricSpanEstimate(input, selected.id, "google_gemini", {
        failureClass: "basis_validation",
        failureStage: "basis_validation",
        safeDetail: "ORIGINAL image was unavailable for matched-span estimation.",
        contractValidationReason: "original_unavailable_for_span_estimate",
      });
    }
    return await estimateMetricCorrespondenceSpan({
      attemptId: input.attemptId,
      loadGeneration: input.loadGeneration,
      original,
      span: selected,
    });
  } catch (error) {
    const provider = dependencies.estimateMetricCorrespondence ||
        isControlledMetricPriorFixture(dependencies)
      ? "controlled_fixture" as const
      : "google_gemini" as const;
    return unavailableMetricSpanEstimate(input, selected.id, provider, {
      failureClass: "unknown",
      failureStage: "provider_invocation",
      safeDetail: error instanceof Error
        ? error.message.replace(/key=[^&\s"']+/gi, "key=[REDACTED]").slice(0, 320)
        : "Matched-span estimate rejected unexpectedly; Floor/Camera continued independently.",
      contractValidationReason: null,
    });
  }
}

/**
 * V2's server-side certified floor transaction. The browser receives an
 * already-applied result and never owns solver, Floor, or camera authority.
 */
export async function executeAfcV2Analysis(
  input: AfcV2AnalyzeInput,
  dependencies: AfcV2AnalysisDependencies = {},
): Promise<AfcV2AnalyzeResult> {
  const originalCapture: OriginalCapture = { bytes: null };
  const metricPriorPromise = startMetricRoomPrior(
    input,
    dependencies,
    originalCapture,
  );
  const observationBranch: {
    general: Promise<EmptyRoomObservationEvidence> | null;
    focused: Promise<FocusedSideCeilingWallEvidence> | null;
    focusedFloorWall: Promise<FocusedSideFloorWallEvidence> | null;
  } = { general: null, focused: null, focusedFloorWall: null };
  let capturedEmptyBytes: Uint8Array | null = null;
  const externalEmptyHook = dependencies.product?.onEmptyRetained;
  const product = await executeAfcSr1TiledLiveProductAttempt({
    attemptId: input.attemptId,
    sourceImageUrl: input.sourceImageUrl,
    sourceImageIdentity: input.sourceImageIdentity,
    labLoadGeneration: input.loadGeneration,
    referenceDepthM: input.referenceDepthM,
  }, {
    ...dependencies.product,
    onEmptyRetained: (retained) => {
      capturedEmptyBytes = retained.retainedEmpty.bytes;
      try {
        externalEmptyHook?.(retained);
      } catch {
        // External diagnostics cannot block either certified branch.
      }
      const observationInput = {
        attemptId: retained.attemptId,
        loadGeneration: retained.loadGeneration,
        originalAncestorIdentity: retained.originalIdentity,
        retainedEmpty: retained.retainedEmpty,
      };
      const failedObservation = () =>
        buildFailedEmptyRoomObservationEvidence({
          attemptId: retained.attemptId,
          loadGeneration: retained.loadGeneration,
          emptyIdentity: retained.retainedEmpty.identity,
          originalAncestorSha256: retained.originalIdentity.sha256,
          provider: dependencies.observeRoom
            ? "controlled_fixture"
            : "google_gemini",
          model: process.env.AFC_V2_ROOM_OBSERVATION_MODEL?.trim() ||
            AFC_V2_EMPTY_ROOM_OBSERVATION_DEFAULT_MODEL,
          observerProfile: AFC_V2_EMPTY_ROOM_OBSERVATION_PROFILE,
          promptVersion: AFC_V2_EMPTY_ROOM_OBSERVATION_PROMPT_VERSION,
          generatedAt: new Date().toISOString(),
        }, {
          failureClass: "unknown",
          failureStage: "provider_invocation",
          provider: dependencies.observeRoom
            ? "controlled_fixture"
            : "google_gemini",
          model: process.env.AFC_V2_ROOM_OBSERVATION_MODEL?.trim() ||
            AFC_V2_EMPTY_ROOM_OBSERVATION_DEFAULT_MODEL,
          providerStatus: null,
          safeDetail:
            "Room observation branch rejected unexpectedly; Floor/Camera continued independently.",
          contractValidationReason: null,
        });
      const failedFocused = () =>
        buildFailedFocusedSideCeilingWallEvidence({
          attemptId: retained.attemptId,
          loadGeneration: retained.loadGeneration,
          emptyIdentity: retained.retainedEmpty.identity,
          originalAncestorSha256: retained.originalIdentity.sha256,
          provider: dependencies.observeFocusedSideCeilingWall ||
              dependencies.observeRoom
            ? "controlled_fixture"
            : "google_gemini",
          model: process.env.AFC_V2_ROOM_OBSERVATION_MODEL?.trim() ||
            AFC_V2_EMPTY_ROOM_OBSERVATION_DEFAULT_MODEL,
          observerProfile: AFC_V2_EMPTY_SIDE_CEILING_WALL_PROFILE,
          promptVersion: AFC_V2_EMPTY_SIDE_CEILING_WALL_PROMPT_VERSION,
          generatedAt: new Date().toISOString(),
        }, {
          failureClass: "unknown",
          failureStage: "provider_invocation",
          provider: dependencies.observeFocusedSideCeilingWall ||
              dependencies.observeRoom
            ? "controlled_fixture"
            : "google_gemini",
          model: process.env.AFC_V2_ROOM_OBSERVATION_MODEL?.trim() ||
            AFC_V2_EMPTY_ROOM_OBSERVATION_DEFAULT_MODEL,
          providerStatus: null,
          safeDetail:
            "Focused side-ceiling-wall observation rejected unexpectedly; general observation and Floor/Camera continued independently.",
          contractValidationReason: null,
        });
      const focusedObserver = dependencies.observeFocusedSideCeilingWall ??
        (dependencies.observeRoom
          ? async (input: typeof observationInput) =>
            emptyFocusedSideCeilingWallSibling(input)
          : observeFocusedSideCeilingWallSeams);
      const failedFocusedFloorWall = () =>
        buildFailedFocusedSideFloorWallEvidence({
          attemptId: retained.attemptId,
          loadGeneration: retained.loadGeneration,
          emptyIdentity: retained.retainedEmpty.identity,
          originalAncestorSha256: retained.originalIdentity.sha256,
          provider: dependencies.observeFocusedSideFloorWall ||
              dependencies.observeRoom
            ? "controlled_fixture"
            : "google_gemini",
          model: process.env.AFC_V2_ROOM_OBSERVATION_MODEL?.trim() ||
            AFC_V2_EMPTY_ROOM_OBSERVATION_DEFAULT_MODEL,
          observerProfile: AFC_V2_EMPTY_SIDE_FLOOR_WALL_PROFILE,
          promptVersion: AFC_V2_EMPTY_SIDE_FLOOR_WALL_PROMPT_VERSION,
          generatedAt: new Date().toISOString(),
        }, {
          failureClass: "unknown",
          failureStage: "provider_invocation",
          provider: dependencies.observeFocusedSideFloorWall ||
              dependencies.observeRoom
            ? "controlled_fixture"
            : "google_gemini",
          model: process.env.AFC_V2_ROOM_OBSERVATION_MODEL?.trim() ||
            AFC_V2_EMPTY_ROOM_OBSERVATION_DEFAULT_MODEL,
          providerStatus: null,
          safeDetail:
            "Focused side-floor-wall observation rejected unexpectedly; general observation and Floor/Camera continued independently.",
          contractValidationReason: null,
        });
      const focusedFloorWallObserver = dependencies.observeFocusedSideFloorWall ??
        (dependencies.observeRoom
          ? async (input: typeof observationInput) =>
            emptyFocusedSideFloorWallSibling(input)
          : observeFocusedSideFloorWallObservation);
      try {
        observationBranch.general = (
          dependencies.observeRoom ?? observeRetainedEmptyRoom
        )(observationInput).catch(() => failedObservation());
      } catch {
        observationBranch.general = Promise.resolve(failedObservation());
      }
      try {
        observationBranch.focused = focusedObserver(observationInput)
          .catch(() => failedFocused());
      } catch {
        observationBranch.focused = Promise.resolve(failedFocused());
      }
      try {
        observationBranch.focusedFloorWall = focusedFloorWallObserver(
          observationInput,
        ).catch(() => failedFocusedFloorWall());
      } catch {
        observationBranch.focusedFloorWall = Promise.resolve(
          failedFocusedFloorWall(),
        );
      }
    },
  });
  const [
    generalObservation,
    focusedObservation,
    focusedFloorWallObservation,
    metricRoomPrior,
  ] = await Promise.all([
    observationBranch.general,
    observationBranch.focused,
    observationBranch.focusedFloorWall,
    metricPriorPromise,
  ]);
  const afterCeiling = mergeFocusedSideCeilingWallSeams({
    general: generalObservation,
    focused: focusedObservation,
  });
  const roomObservation = mergeFocusedSideFloorWallObservation({
    general: afterCeiling,
    focused: focusedFloorWallObservation,
  });
  const pipelineEvidence = livePipelineEvidence(
    input,
    product,
    roomObservation,
    focusedObservation,
    focusedFloorWallObservation,
    metricRoomPrior,
  );
  if (product.status !== "authoritative_geometry") {
    return {
      ...pipelineEvidence,
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
    return {
      ...pipelineEvidence,
      status: "failed",
      reason: acceptance.reason,
      product,
    };
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
      ...pipelineEvidence,
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
    return {
      ...pipelineEvidence,
      status: "failed",
      reason: transaction.reason,
      product,
    };
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
      ...pipelineEvidence,
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
      ...pipelineEvidence,
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
      ...pipelineEvidence,
      status: "failed",
      reason: `AFC camera restore identity failed closed: ${restore.reason}.`,
      product,
    };
  }

  const floor = {
    authorityKey: floorAuthorityKey,
    sourceNormalizedPolygon: product.geometry.sourceNormalizedPolygon,
    worldWidthM: settle.worldWidthM,
    referenceDepthM: settle.referenceDepthM,
    widthDepthRatio: settle.widthDepthRatio,
  };
  const camera = {
    applied: true as const,
    verticalFovDeg: snapshot.fovDeg,
    pose: snapshot.pose,
    frame: snapshot.frameSize,
    originalBasisRestored: true as const,
  };
  const roomBoundaries = constructAfcV2RoomBoundaryAuthority({
    attemptId: input.attemptId,
    loadGeneration: input.loadGeneration,
    observation: roomObservation,
    emptyIdentity: product.emptyBasis,
    originalIdentity: product.originalBasis,
    floor: {
      authorityKey: floor.authorityKey,
      worldWidthM: floor.worldWidthM,
      referenceDepthM: floor.referenceDepthM,
      widthDepthRatio: floor.widthDepthRatio,
    },
    camera: {
      verticalFovDeg: camera.verticalFovDeg,
      pose: camera.pose,
      frame: camera.frame,
    },
    freezeReceipt: freeze.value,
  });
  const roomCollision = constructAfcV2RoomCollisionAuthority({
    roomBoundary: roomBoundaries,
    observation: roomObservation,
  });
  const emptyBytes = dependencies.registrationRasters?.emptyBytes ??
    capturedEmptyBytes ??
    getAfcSr1LiveAttemptEvidence(input.attemptId)?.floorRead?.emptyBytes ??
    null;
  const originalBytes = dependencies.registrationRasters?.originalBytes ??
    originalCapture.bytes ??
    await fetchVerifiedOriginalBytes(input, product) ??
    null;
  let emptyOriginalRegistration: AfcV2EmptyOriginalRegistrationAuthorityReceipt | null =
    null;
  let roomEnvelope: AfcV2RoomEnvelopeAuthorityReceipt | null = null;
  let roomEnvelopeCollision: AfcV2RoomEnvelopeCollisionAuthorityReceipt | null =
    null;
  let originalStructuralLocalization: AfcV2OriginalStructuralLocalizationAuthorityReceipt | null =
    null;
  let originalLocalizedBoundary: AfcV2OriginalLocalizedRoomBoundaryAuthorityReceipt | null =
    null;
  let originalLocalizedCollision: AfcV2OriginalLocalizedCollisionAuthorityReceipt | null =
    null;
  let emptyAuthoritativeCollision: AfcV2EmptyAuthoritativeCollisionAuthorityReceipt | null =
    null;
  try {
    emptyOriginalRegistration = await constructEmptyOriginalRegistrationAuthority({
      emptyIdentity: {
        sha256: product.emptyBasis.sha256,
        decodedWidth: product.emptyBasis.decodedWidth,
        decodedHeight: product.emptyBasis.decodedHeight,
        orientation: product.emptyBasis.orientation,
      },
      originalIdentity: {
        sha256: product.originalBasis.sha256,
        decodedWidth: product.originalBasis.decodedWidth,
        decodedHeight: product.originalBasis.decodedHeight,
        orientation: product.originalBasis.orientation,
      },
      emptyBytes,
      originalBytes,
      observation: roomObservation,
    });
    roomEnvelope = constructAfcV2RoomEnvelopeAuthority({
      registration: emptyOriginalRegistration,
      roomBoundary: roomBoundaries,
      roomCollision,
      observation: roomObservation,
    });
    roomEnvelopeCollision = constructAfcV2RoomEnvelopeCollisionAuthority({
      roomCollision,
      registration: emptyOriginalRegistration,
      roomEnvelope,
    });
  } catch {
    emptyOriginalRegistration = emptyOriginalRegistration ?? null;
    roomEnvelope = roomEnvelope ?? null;
    roomEnvelopeCollision = null;
  }
  try {
    if (
      shouldAttemptOriginalStructuralLocalization({
        oldCompatibilityTier: emptyOriginalRegistration?.oldCompatibilityTier,
        identityRegistrationClass: emptyOriginalRegistration?.registrationClass,
      })
    ) {
      originalStructuralLocalization = await constructOriginalStructuralLocalizationAuthority({
        emptyIdentity: {
          sha256: product.emptyBasis.sha256,
          decodedWidth: product.emptyBasis.decodedWidth,
          decodedHeight: product.emptyBasis.decodedHeight,
          orientation: product.emptyBasis.orientation,
        },
        originalIdentity: {
          sha256: product.originalBasis.sha256,
          decodedWidth: product.originalBasis.decodedWidth,
          decodedHeight: product.originalBasis.decodedHeight,
          orientation: product.originalBasis.orientation,
        },
        emptyBytes,
        originalBytes,
        observation: roomObservation,
        identityRegistration: emptyOriginalRegistration,
        attemptId: input.attemptId,
        frozenCameraReceiptIdentity: freeze.value.payload.authority.appliedAtIso ??
          "frozen-calibrated-camera",
        floorAuthorityKey: floor.authorityKey,
      });
      if (
        originalStructuralLocalization.registrationClass ===
          "certified_original_localized"
      ) {
        originalLocalizedBoundary = constructOriginalLocalizedBoundaryAuthority({
          localization: originalStructuralLocalization,
          observation: roomObservation,
          originalIdentity: {
            decodedWidth: product.originalBasis.decodedWidth,
            decodedHeight: product.originalBasis.decodedHeight,
          },
          camera: {
            verticalFovDeg: camera.verticalFovDeg,
            pose: camera.pose,
            frame: camera.frame,
          },
        });
        originalLocalizedCollision = constructOriginalLocalizedCollisionAuthority({
          localization: originalStructuralLocalization,
          originalLocalizedBoundary,
          observation: roomObservation,
        });
      }
    }
  } catch {
    originalStructuralLocalization = originalStructuralLocalization ?? null;
    originalLocalizedBoundary = originalLocalizedBoundary ?? null;
    originalLocalizedCollision = null;
  }
  try {
    emptyAuthoritativeCollision = constructAfcV2EmptyAuthoritativeCollisionAuthority({
      roomCollision,
      roomEnvelope,
      identityRegistration: emptyOriginalRegistration,
      originalLocalization: originalStructuralLocalization,
    });
  } catch {
    emptyAuthoritativeCollision = null;
  }

  let metricCorrespondence: MetricCorrespondenceSelection =
    emptyMetricCorrespondenceSelection(["no_eligible_finite_span"]);
  try {
    metricCorrespondence = selectMetricCorrespondenceSpan({
      roomBoundary: roomBoundaries,
      registration: emptyOriginalRegistration,
      originalLocalizedBoundary,
      originalLocalizationClass:
        originalStructuralLocalization?.registrationClass ?? null,
    });
  } catch {
    metricCorrespondence = emptyMetricCorrespondenceSelection([
      "extraction_failed_closed",
    ]);
  }

  let metricCorrespondenceEstimate: MetricCorrespondenceEstimateReceipt | null =
    null;
  try {
    metricCorrespondenceEstimate = await startMetricCorrespondenceEstimate(
      input,
      dependencies,
      originalCapture,
      metricCorrespondence,
    );
  } catch {
    metricCorrespondenceEstimate = metricCorrespondence.selected
      ? unavailableMetricSpanEstimate(
        input,
        metricCorrespondence.selected.id,
        dependencies.estimateMetricCorrespondence ||
            isControlledMetricPriorFixture(dependencies)
          ? "controlled_fixture"
          : "google_gemini",
        {
          failureClass: "unknown",
          failureStage: "provider_invocation",
          safeDetail:
            "Matched-span estimate rejected unexpectedly; Floor/Camera continued independently.",
          contractValidationReason: null,
        },
      )
      : null;
  }

  return {
    ...pipelineEvidence,
    status: "applied",
    product,
    floor,
    camera,
    analysisMode: dependencies.analysisMode ?? "live",
    freezeReceipt: freeze.value,
    roomBoundaries,
    roomCollision,
    emptyOriginalRegistration,
    roomEnvelope,
    roomEnvelopeCollision,
    originalStructuralLocalization,
    originalLocalizedBoundary,
    originalLocalizedCollision,
    emptyAuthoritativeCollision,
    metricCorrespondence,
    metricCorrespondenceEstimate,
  };
}

export async function executeAfcV2ControlledReplay(
  input: AfcV2AnalyzeInput,
  evidence: AfcV2ControlledReplayEvidence,
  testDependencies: AfcV2ControlledReplayTestDependencies = {},
): Promise<AfcV2AnalyzeResult> {
  const product = await createAfcV2ControlledReplayDependencies(input, evidence);
  if (!product) {
    const rejectedProduct: AfcSr1LiveProductResult = {
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
    };
    return {
      ...livePipelineEvidence(
        input,
        rejectedProduct,
        null,
        null,
        null,
        unavailableMetricPrior(input, "controlled_fixture", {
          failureClass: "configuration",
          failureStage: "configuration",
          safeDetail: "Controlled replay evidence was rejected before metric prior.",
          contractValidationReason: "controlled_replay_evidence_invalid",
        }),
      ),
      status: "failed",
      reason: "Controlled replay evidence did not satisfy exact identity and lineage bindings.",
      product: rejectedProduct,
    };
  }
  return executeAfcV2Analysis(input, {
    analysisMode: "controlled_replay",
    product: { ...product, ...testDependencies },
    registrationRasters: (() => {
      const replayOriginal = decodeEvidence(evidence.original.base64);
      const replayEmpty = decodeEvidence(evidence.empty.base64);
      return replayOriginal && replayEmpty
        ? { originalBytes: replayOriginal, emptyBytes: replayEmpty }
        : undefined;
    })(),
  });
}

async function fetchVerifiedOriginalBytes(
  input: AfcV2AnalyzeInput,
  product: AfcSr1LiveAuthoritativeGeometry,
): Promise<Uint8Array | null> {
  try {
    const fetched = await fetchRoomImageSafely(input.sourceImageUrl, {
      allowedHosts: getAutoFloorVisionAllowedImageHosts(),
      maxBytes: getAutoFloorVisionImageMaxBytes(),
      timeoutMs: getAutoFloorVisionImageFetchTimeoutMs(),
      allowLocalhostHttp: isAutoFloorVisionAllowLocalhostHttp(),
    });
    if (!fetched.ok) return null;
    if (sha256(Uint8Array.from(fetched.buffer)) !== product.originalBasis.sha256) {
      return null;
    }
    return Uint8Array.from(fetched.buffer);
  } catch {
    return null;
  }
}
