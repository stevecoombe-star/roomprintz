"use client";

import { FormEvent, PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import SceneJsonPanel from "./SceneJsonPanel";
import CollapsibleSection from "./CollapsibleSection";
import {
  DEFAULT_FLOOR_MAPPING,
  DEFAULT_PERSPECTIVE_DEPTH_SCALING,
  FLOOR_MAPPING_LIMITS,
  PERSPECTIVE_DEPTH_SCALING_LIMITS,
  clampValue,
  deriveDepthScalingFromPolygon,
  deriveFloorMappingFromPolygon,
  getDepthNearFarOrderingInfo,
  getDepthScaleMultiplier,
  getEffectiveObjectScale,
  isPointInsidePolygon,
  isWithinViewportBounds,
  mapFloorPointToObjectTransform,
  mapPointerTravelToWorldYDelta,
  selectViewportSafeHandleOffset,
} from "./floor-math";
import {
  CALIBRATED_SCENE_STATE_CALIBRATION_VERSION_V1,
  CALIBRATED_SCENE_STATE_MAX_VERTICAL_FOV_DEG,
  CALIBRATED_SCENE_STATE_MIN_VERTICAL_FOV_DEG,
  CALIBRATED_SCENE_STATE_SOLVER_V1,
  SCENE_IMAGE_COORDINATE_SPACE_V0,
  buildSceneStatePayload,
  evaluateCalibrationRestoreCompatibility,
  validateImportedSceneJson,
  type CalibratedSceneStateCalibrationV1,
  type FloorMappingState,
  type FloorPoint,
  type ImportedSceneValidated,
  type ModelNormalizationState,
  type PerspectiveDepthScalingState,
  type TransformState,
} from "./scene-state";
import {
  containerNormToSourceNorm,
  corridorHalfWidthToOverlayStrokeWidth,
  isValidImageSize,
  normToPixels,
  sourceNormToContainerNorm,
  type ImageFrameSize,
  type ImageIntrinsicSize,
} from "./image-space";
import {
  applyHomography,
  computeReprojectionError,
  floorVec3ToPlane2D,
  getFloorRectCorners,
  type HomographyMatrix,
  invertHomography,
  orderFloorCorners,
  projectFloorPointThroughCameraPoseCv,
  solvePlaneHomography,
} from "./perspective-solve";
import {
  computeAutoBoundsNormalization,
  computePlacementLocalFloorContactY,
  type AutoBoundsNormalization,
} from "./model-bounds";
import {
  getSelectedAutoFloorCandidate,
  type AutoFloorDetectionResult,
} from "./auto-floor-detection";
import {
  scoreAutoFloorCandidateGeometry,
  type AutoFloorCandidateGeometryScore,
} from "./auto-floor-scoring";
import {
  ACTIVE_AUTO_FLOOR_DETECTION_PROVIDER_ID,
  getSelectableAutoFloorDetectionProviders,
  runAutoFloorDetection,
  type AutoFloorDetectionInput,
  type AutoFloorDetectionProviderId,
} from "./auto-floor-provider";
import { DEFAULT_AUTO_FLOOR_VISION_MODEL } from "./auto-floor-vision-provider-scaffold";
import {
  AUTO_FLOOR_FIXTURES,
  getAutoFloorFixtureById,
  type AutoFloorAssistObservationFields,
  type AutoFloorFixtureHumanAssessment,
  type AutoFloorFixtureManualCorrection,
  type AutoFloorFixtureObservation,
} from "./auto-floor-fixtures";
import {
  CALIBRATED_CAMERA_APPLY_MAX_AVG_DELTA_PX,
  CALIBRATED_CAMERA_APPLY_MAX_CV_AVG_PX,
  CALIBRATED_CAMERA_APPLY_MAX_CV_MAX_PX,
  CALIBRATED_CAMERA_APPLY_MAX_DISPLAY_AVG_PX,
  CALIBRATED_CAMERA_APPLY_MAX_DISPLAY_MAX_PX,
  CALIBRATED_CAMERA_APPLY_MAX_MAX_DELTA_PX,
  CALIBRATED_CAMERA_APPLY_MAX_SCALE_RATIO,
  CALIBRATED_CAMERA_APPLY_MIN_SCALE_RATIO,
  evaluateCalibratedCameraApply,
} from "./calibrated-camera-apply";
import { evaluateQuadSolvability } from "./quad-solvability";
import { classifyAutoFloorSupport } from "./auto-floor-support-classification";
import {
  createEmptyManualFloorSupportAnnotation,
  DEFAULT_COUPLED_MAX_RELATIVE_DELTA_SOURCE_PX,
  DEFAULT_SEAM_CORRIDOR_HALF_WIDTH_SOURCE_PX,
  FLOOR_CORNER_LABELS,
  type FloorCornerLabel,
  type ManualCornerSupportState,
  type ManualFloorSupportAnnotation,
  type ManualPhysicalSeam,
  type ManualSearchMode,
  type SourceNormPoint,
} from "./manual-floor-support-types";
import { validateManualFloorSupportAnnotation } from "./manual-floor-support-validation";
// Phase 2O-O: read-only Type A Support Qualification panel. Wires the committed
// Phase 2O-N PURE classifier into a diagnostic-only readout. Never mutates
// annotation/candidate/polygon/FOV/dimensions/calibration/scene, never switches
// modes, never runs search/solver/local refinement, and never implements Type B.
import { qualifyTypeASupport } from "./manual-floor-support-qualification";
import type {
  SupportQualificationAdvisoryFact,
  SupportQualificationBroadSearchViability,
  SupportQualificationClassification,
  TypeASupportQualification,
} from "./manual-floor-support-qualification-types";
// --- Phase B2: read-only Type B Operator Evidence Panel (lab-only) ----------
// Uses the committed pure Phase B1 modules as the single source of truth for
// facts + qualification, and a small pure Phase B2 state helper for lifecycle,
// invalidation, the read-only Type A -> Type B context mapping, coordinate
// sanitization, and declared-only overlay geometry. NOTHING here runs a solver /
// FOV / search / preview / load / Apply, mutates candidate / floor polygon /
// dimensions / FOV / calibration / readiness, routes / switches modes, or
// persists. It only records declared visible evidence and displays the pure
// B1 qualification.
import { deriveTypeBGeometryFacts } from "./type-b-evidence-facts";
import { qualifyTypeBEvidence } from "./type-b-qualification";
import type {
  TypeBQualificationReason,
  TypeBQualificationStatus,
} from "./type-b-qualification";
import type {
  TypeBDeclaredLineEvidence,
  TypeBEndpointStatus,
  TypeBFrameContactStatus,
  TypeBLatentNearCornerCondition,
  TypeBOcclusionStatus,
  TypeBStructuralLineRole,
} from "./type-b-evidence-types";
import {
  applyDeclaredLinePatch,
  beginTypeBReview,
  buildTypeBDeclaredSegments,
  computeTypeBReviewGeometryContext,
  createEmptyTypeBReviewState,
  findTypeBSharedJunctionEndpoints,
  mapTypeATypeBContext,
  reconcileTypeBReviewGeometry,
  sanitizeNormComponent,
  typeBReviewHasDeclaredGeometry,
  type TypeBEvidenceReviewState,
} from "./type-b-evidence-review";
import {
  patchTypeBReviewEndpoint,
  type TypeBEndpointTarget,
  type TypeBPlacementTarget,
} from "./type-b-direct-edit";
// --- Phase B3E: Read-Only Type B Diagnostic UI Integration ------------------
// LAB-ONLY, DIAGNOSTIC-FIRST, READ-ONLY. The UI may call ONLY the committed
// public Type B capture / tuple-generation / diagnostic-run-assembly functions
// (plus the B3E read-only presentation projection). It imports NO B3D-1/2/3
// function and adds NO math, ranking, selection, preview, load, Apply, or
// calibration authority. All result/input shapes are type-only.
import { captureTypeBSnapshotAndCoverage } from "./type-b-capture";
import type { TypeBSnapshotAndCoverageCaptureInput } from "./type-b-capture";
import { generateTypeBBoundedDiagnosticTuples } from "./type-b-tuple-generation";
import { assembleTypeBDiagnosticRun } from "./type-b-diagnostic-run-assembly";
import type { TypeBDiagnosticRunAssemblyResult } from "./type-b-diagnostic-run-assembly";
import { TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA } from "./type-b-evaluator-contract";
import type { TypeBCaptureResult } from "./type-b-capture-contract";
import { presentTypeBDiagnosticRun } from "./type-b-diagnostic-run-presentation";
import {
  generateManualFloorSupportTrials,
  type TrialGenerationCandidate,
} from "./manual-floor-support-trial-generation";
import { evaluateManualFloorSupportTrialSet } from "./manual-floor-support-trial-evaluation";
import type { ManualFloorSupportTrialSet } from "./manual-floor-support-trial-types";
// Phase 2O-H: Type A coupled diagnostic search readout. Wires the committed
// Phase 2O-G pure helper (generate + solver-boundary evaluate) into a read-only
// lab diagnostic table. No preview, apply, promote, select, ranking, or
// persistence; never mutates candidate/polygon/FOV/dimensions/calibration.
import type { CoupledSearchCandidate } from "./manual-floor-support-coupled-search-generation";
import {
  DEFAULT_COUPLED_SEARCH_FOV_SCAN_CONFIG,
  runTypeACoupledSearch,
} from "./manual-floor-support-coupled-search-evaluation";
import {
  createDefaultCoupledSearchConfig,
  type CoupledSearchPrimaryState,
  type CoupledSearchResultSet,
} from "./manual-floor-support-coupled-search-types";
// Phase 2O-K-B: Type A local refinement readout. Wires the committed Phase
// 2O-K-A pure helper (seeded generate + solver-boundary evaluate) into a
// read-only lab diagnostic table. Seeded ONLY by an explicit operator action on
// a stored coarse coupled-search row. No preview (deferred to 2O-K-C), apply,
// promote, select, ranking, recommendation, or persistence; never mutates
// candidate/polygon/FOV/dimensions/calibration/scene state.
import {
  DEFAULT_LOCAL_REFINEMENT_FOV_SCAN_CONFIG,
  runTypeALocalRefinement,
} from "./manual-floor-support-local-refinement-evaluation";
import type {
  LocalRefinementResultSet,
  LocalRefinementSeed,
} from "./manual-floor-support-local-refinement-types";

// Phase 2H-B: client-side shape of the lab-only empty-room-assist route reply.
// Mirrors app/api/admin/3d-room-lab/empty-room-assist/run AssistResponse. Only
// safe derived fields are present (no prompts/keys/bytes/raw responses).
type EmptyRoomAssistApiResponse = {
  assist: {
    enabled: boolean;
    requestId: string;
    durationMs: number;
    generateOnly: boolean;
    emptyRoomAssistStatus: "completed" | "generated" | "unavailable" | "blocked" | "failed";
    emptyRoomCacheStatus: "hit" | "miss" | "unavailable" | "not_used";
    coordinateCompatibility: {
      ok: boolean;
      tier: "exact_grid_compatible" | "aspect_compatible_rescaled" | "incompatible";
      transferMode: "exact_grid" | "aspect_rescaled" | "none";
      reason: string | null;
      originalSize: { width: number; height: number } | null;
      emptySize: { width: number; height: number } | null;
      originalOrientation: number | null;
      emptyOrientation: number | null;
      originalAspect: number | null;
      emptyAspect: number | null;
      relativeAspectError: number | null;
    };
    originalDetectionStatus: "ok" | "needs_review" | "failed" | "skipped";
    emptyDetectionStatus: "ok" | "needs_review" | "failed" | "skipped";
    emptyDetectionFailureReason: string | null;
    agreement: {
      band: "strong_agreement" | "review_agreement" | "weak_agreement" | "incompatible" | "unavailable";
      meanCornerDistance: number | null;
      maxCornerDistance: number | null;
      iou: number | null;
      areaA: number | null;
      areaB: number | null;
      areaRatio: number | null;
      areaAgreement: number | null;
      reason: string | null;
    } | null;
    emptyQuadSelfValidity: {
      band: string | null;
      cameraPoseOk: boolean;
      cameraPoseConfidence: "high" | "low" | null;
      cameraPoseBestFovDeg: number | null;
      cameraPoseValidFovCount: number;
      cameraPoseValidFovRange: [number, number] | null;
      cameraPoseReason: string | null;
    } | null;
    structuralPreservation: {
      ok: boolean;
      score: number | null;
      band: "strong" | "ok" | "uncertain" | "weak" | "unavailable";
      regionsUsed: string[];
      excludedRegions: string[];
      heuristic: true;
      reason: string | null;
      note: string;
    } | null;
    poseCompatSummary: {
      originalSelectedConfidence: string | null;
      originalSelectedScore: number | null;
      emptySelectedConfidence: string | null;
      emptySelectedScore: number | null;
      bothGeometryConfident: boolean;
    } | null;
    recommendationProvenance:
      | "empty_primary_verified"
      | "empty_primary_review"
      | "empty_primary_blocked"
      | "original_fallback"
      | "manual_required";
    extentDiagnostics: {
      emptyCandidateCount: number;
      originalCandidateCount: number;
      selectedCandidateRank: number | null;
      selectedCandidateIntent: string | null;
      selectedCandidateArea: number | null;
      largestValidCandidateArea: number | null;
      selectedVsLargestAreaRatio: number | null;
      openingAmbiguityFlag: boolean;
      retryOccurred: boolean;
      retryReason: string | null;
    };
    multiCandidateConsensus: {
      eligibleCandidateCount: number;
      poseValidCandidateCount: number;
      samePlaneConsensusStatus:
        | "not_applicable"
        | "insufficient_candidates"
        | "no_joint_pose_validity"
        | "fov_ranges_overlap"
        | "fov_ranges_disjoint"
        | "inconclusive";
      consensusCandidateIndexes: number[];
      bestFovSpreadDeg: number | null;
      sharedFovRange: [number, number] | null;
      hasClampedCandidateInConsensus: boolean;
      advisoryPreferredAnchorIndex: number | null;
      advisoryPreferredAnchorReason: string | null;
      candidates: {
        rank: number;
        intent: string | null;
        geometryBand: "high" | "medium" | "low";
        hasClampedCorner: boolean;
        clampedCornerCount: number | null;
        poseScanOk: boolean;
        bestFovDeg: number | null;
        bestConfidence: "high" | "low" | null;
        validFovRange: [number, number] | null;
        validFovCount: number;
        bestAvgReprojPx: number | null;
        bestMaxReprojPx: number | null;
        failureReason: string | null;
      }[];
      note: string | null;
    };
    surfacedSource: "empty" | "original" | null;
    confidenceCeiling: "high" | "medium" | "low" | null;
    calibratedCameraEligible: boolean;
    policyReasons: string[];
    failureReason: string | null;
  };
  surfacedResult: AutoFloorDetectionResult | null;
  originalResult: AutoFloorDetectionResult | null;
  emptyResult: AutoFloorDetectionResult | null;
};

type EmptyRoomAssistUiStatus =
  | "idle"
  | "generating"
  | "validating"
  | "detecting_original"
  | "detecting_empty"
  | "comparing"
  | "completed"
  | "unavailable"
  | "blocked"
  | "failed";

const DEFAULT_MODEL_GLB_PATH = "/3d-lab/furniture-test-chair.glb";
const LOCAL_DRAFT_STORAGE_KEY = "vibode:3d-room-lab:scene-state:v0";
const DEFAULT_ROOM_IMAGE_URL =
  "https://images.unsplash.com/photo-1505693314120-0d443867891c?auto=format&fit=crop&w=1600&q=80";

type ImageLoadState = "idle" | "loading" | "loaded" | "error";
type ModelLoadState = "idle" | "loading" | "loaded" | "fallback" | "error";
type ActiveObjectKind = "gltf" | "fallback" | null;
type AutoFloorDetectionRunState = "idle" | "detecting" | "completed" | "failed";
type ObjectHandleMode = "move" | "rotate" | "scale" | "height" | null;
type SceneJsonStatus = { kind: "idle" | "success" | "error"; message: string };
type TransformStateUpdater = TransformState | ((prev: TransformState) => TransformState);
type FloorClickMappingMode = "legacy" | "homography-experimental";
type CalibratedCameraSnapshot = {
  pose: {
    position: { x: number; y: number; z: number };
    lookAt: { x: number; y: number; z: number };
    up: { x: number; y: number; z: number };
  };
  fovDeg: number;
  frameSize: ImageFrameSize;
  diagnosticsSummary: string;
  appliedAtIso: string;
};

const OBJECT_HANDLE_ROTATE_DEADZONE_PX = 14;
const OBJECT_HANDLE_SCALE_MIN_START_DISTANCE_PX = 10;
// Phase 2I-B1: tight tolerance for "object floor-contact sits at the placement
// origin". Normalization math is float-accumulated, so this is a small epsilon
// rather than an exact === 0 check. Calibrated Scale is only offered when the
// computed placement-frame local floor-contact Y is within this band, so no
// vertical compensation is needed in this slice.
const CALIBRATED_SCALE_GROUNDED_LOCAL_Y_EPSILON = 1e-4;
// Phase 2I-C1: positionY band treated as "resting on the floor" for calibrated
// Lift. Drag-down and Drop-to-floor snap positionY to exactly 0 within this band,
// and calibrated Scale is only offered while resting. Slightly looser than the
// grounded local-Y epsilon since it absorbs camera-aware drag accumulation.
const CALIBRATED_LIFT_RESTING_SNAP_EPSILON = 1e-3;
// Phase 2I-C1B: the overlay SVG viewBox is 0..100 on both axes. The Lift handle
// is grabbable only when its center stays this far inside the actual frame (room
// for the ~1.85r handle plus a touch of slop). This is a HANDLE-placement inset
// only — it is NOT applied to the resting floor anchor baseline test.
const CALIBRATED_LIFT_OVERLAY_VIEWBOX_SIZE = 100;
const CALIBRATED_LIFT_HANDLE_VIEWPORT_INSET = 3.0;
// Tiny normalized tolerance for the baseline floor-anchor viewport test (FP slop
// at the exact edge). The baseline uses the ACTUAL viewport [0,1], not an inset.
const CALIBRATED_LIFT_BASELINE_VIEWPORT_TOLERANCE = 1e-4;
// Upward scan resolution (world units) and the minimum useful headroom required
// before calibrated Lift is offered at all (else it fails closed).
const CALIBRATED_LIFT_SCAN_STEP_Y = 0.05;
const CALIBRATED_LIFT_MIN_USEFUL_RANGE_Y = 0.1;
// Adaptive Lift-handle placement (SVG viewBox units, 0..100). Preferred-first
// candidate offsets. The first (lower-left) is the established default; the rest
// provide inward fallbacks for EVERY edge so a near-edge anchor can still place a
// visible, reachable handle. Min center-to-center separation keeps the ~1.85r
// handles from materially overlapping the MOVE/Rotate/Scale targets.
const CALIBRATED_LIFT_HANDLE_CANDIDATE_OFFSETS: { x: number; y: number }[] = [
  { x: -4.3, y: 3.75 }, // lower-left (preferred default)
  { x: -6.0, y: 1.4 }, // left, slightly down
  { x: -6.0, y: -1.4 }, // left, slightly up
  { x: 6.0, y: -1.4 }, // right, slightly up
  { x: 6.0, y: 1.4 }, // right, slightly down
  { x: -4.3, y: -3.75 }, // upper-left
  { x: 4.3, y: -3.75 }, // upper-right
  { x: 0, y: -5.8 }, // straight up (inward near bottom)
  { x: 0, y: 5.8 }, // straight down (inward near top)
];
const CALIBRATED_LIFT_HANDLE_MIN_SEPARATION = 4.6;
const OBJECT_HANDLE_HEIGHT_PIXELS_PER_UNIT = 120;
const LEGACY_CAMERA_FOV_DEG = 50;
const LEGACY_CAMERA_POSITION: [number, number, number] = [0, 1.1, 3.2];
const CALIBRATION_CORNER_LABELS = ["NL", "NR", "FR", "FL"] as const;
const CALIBRATED_CAMERA_STALE_WARN_SIZE_DELTA_PERCENT = 2;
const CALIBRATED_CAMERA_STALE_WARN_ASPECT_DELTA_PERCENT = 1;
const CALIBRATED_CAMERA_AUTO_REVERT_SIZE_DELTA_PERCENT = 5;
const CALIBRATED_CAMERA_AUTO_REVERT_ASPECT_DELTA_PERCENT = 3;
const PROJECTED_ANCHOR_WARNING_MAX_PIXEL_DISTANCE = 24;
const PROJECTED_ANCHOR_WARNING_MAX_NORMALIZED_DISTANCE = 0.03;
const RAY_FLOOR_HOMOGRAPHY_WARNING_WORLD_DISTANCE = 0.05;

const DEFAULT_MODEL_NORMALIZATION: ModelNormalizationState = {
  modelYOffset: 0,
  modelYawOffsetDeg: 0,
  modelScaleMultiplier: 1,
};

const MODEL_NORMALIZATION_LIMITS = {
  modelYOffset: { min: -2, max: 2, step: 0.01 },
  modelYawOffsetDeg: { min: -180, max: 180, step: 1 },
  modelScaleMultiplier: { min: 0.1, max: 5, step: 0.01 },
} as const;

const MATERIAL_TEXTURE_KEYS = [
  "map",
  "alphaMap",
  "aoMap",
  "bumpMap",
  "displacementMap",
  "emissiveMap",
  "envMap",
  "lightMap",
  "metalnessMap",
  "normalMap",
  "roughnessMap",
  "specularMap",
] as const;

// Neutral placement baseline. Model-local vertical correction now belongs to
// model normalization (Phase 0O-A), so default placement Y sits near 0 to keep
// freshly placed objects centered in the fixed camera framing instead of the
// legacy negative offsets that rendered objects off the bottom of the frame.
const GLB_DEFAULT_PLACEMENT_Y = 0;
const FALLBACK_DEFAULT_PLACEMENT_Y = 0;

const GLB_DEFAULT_TRANSFORM: TransformState = {
  positionX: 0,
  positionY: GLB_DEFAULT_PLACEMENT_Y,
  positionZ: 0,
  rotationYDeg: 0,
  // Auto-bounds normalization (Phase 0P-B) scales models to a known target
  // size, so uniformScale of 1 means "exactly the normalized target size".
  uniformScale: 1,
};

const FALLBACK_DEFAULT_TRANSFORM: TransformState = {
  positionX: 0,
  positionY: FALLBACK_DEFAULT_PLACEMENT_Y,
  positionZ: 0,
  rotationYDeg: 0,
  uniformScale: 1,
};

const DEFAULT_FLOOR_POLYGON: FloorPoint[] = [
  { x: 0.18, y: 0.76 },
  { x: 0.82, y: 0.76 },
  { x: 0.62, y: 0.95 },
  { x: 0.38, y: 0.95 },
];

const TRANSFORM_LIMITS = {
  positionX: { min: -5, max: 5, step: 0.01 },
  positionY: { min: -5, max: 5, step: 0.01 },
  positionZ: { min: -10, max: 10, step: 0.01 },
  rotationYDeg: { min: -180, max: 180, step: 1 },
  uniformScale: { min: 0.1, max: 4, step: 0.01 },
} as const;

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

function roundPoint(point: FloorPoint): FloorPoint {
  return {
    x: Number(point.x.toFixed(3)),
    y: Number(point.y.toFixed(3)),
  };
}

type FrameMatchDiagnostics = {
  widthDeltaPercent: number;
  heightDeltaPercent: number;
  aspectDeltaPercent: number;
  isWarningStale: boolean;
  isAutoRevertStale: boolean;
};

function computeFrameMatchDiagnostics(
  snapshotFrameSize: ImageFrameSize,
  liveFrameSize: ImageFrameSize
): FrameMatchDiagnostics | null {
  if (
    snapshotFrameSize.width <= 0 ||
    snapshotFrameSize.height <= 0 ||
    liveFrameSize.width <= 0 ||
    liveFrameSize.height <= 0
  ) {
    return null;
  }
  const widthDeltaPercent = (Math.abs(liveFrameSize.width - snapshotFrameSize.width) / snapshotFrameSize.width) * 100;
  const heightDeltaPercent = (Math.abs(liveFrameSize.height - snapshotFrameSize.height) / snapshotFrameSize.height) * 100;
  const snapshotAspect = snapshotFrameSize.width / snapshotFrameSize.height;
  const liveAspect = liveFrameSize.width / liveFrameSize.height;
  const aspectDeltaPercent = (Math.abs(liveAspect - snapshotAspect) / snapshotAspect) * 100;
  const isWarningStale =
    widthDeltaPercent > CALIBRATED_CAMERA_STALE_WARN_SIZE_DELTA_PERCENT ||
    heightDeltaPercent > CALIBRATED_CAMERA_STALE_WARN_SIZE_DELTA_PERCENT ||
    aspectDeltaPercent > CALIBRATED_CAMERA_STALE_WARN_ASPECT_DELTA_PERCENT;
  const isAutoRevertStale =
    widthDeltaPercent > CALIBRATED_CAMERA_AUTO_REVERT_SIZE_DELTA_PERCENT ||
    heightDeltaPercent > CALIBRATED_CAMERA_AUTO_REVERT_SIZE_DELTA_PERCENT ||
    aspectDeltaPercent > CALIBRATED_CAMERA_AUTO_REVERT_ASPECT_DELTA_PERCENT;
  return {
    widthDeltaPercent,
    heightDeltaPercent,
    aspectDeltaPercent,
    isWarningStale,
    isAutoRevertStale,
  };
}

type WorldProjectionResult = {
  normalized: FloorPoint;
  pixels: { x: number; y: number };
  ndc: { x: number; y: number; z: number };
  inFront: boolean;
  isVisibleInView: boolean;
};

type RayFloorIntersectionResult =
  | {
      ok: true;
      worldPoint: { x: number; y: number; z: number };
      floorPlane2D: { x: number; y: number };
    }
  | { ok: false; reason: string };

function intersectOverlayRayWithFloorPlane(
  normalizedPoint: FloorPoint,
  camera: THREE.PerspectiveCamera | null,
  floorPlaneY = 0
): RayFloorIntersectionResult {
  if (!camera) return { ok: false, reason: "camera unavailable" };
  if (
    !Number.isFinite(normalizedPoint.x) ||
    !Number.isFinite(normalizedPoint.y) ||
    !Number.isFinite(floorPlaneY)
  ) {
    return { ok: false, reason: "non-finite input" };
  }
  camera.updateMatrixWorld(true);
  const rayOrigin = camera.getWorldPosition(new THREE.Vector3());
  const ndcPoint = new THREE.Vector3(normalizedPoint.x * 2 - 1, 1 - normalizedPoint.y * 2, 0.5);
  const rayPoint = ndcPoint.unproject(camera);
  const rayDirection = rayPoint.sub(rayOrigin);
  const rayDirectionLength = rayDirection.length();
  if (!Number.isFinite(rayDirectionLength) || rayDirectionLength <= 1e-9) {
    return { ok: false, reason: "invalid ray direction" };
  }
  rayDirection.multiplyScalar(1 / rayDirectionLength);
  if (!Number.isFinite(rayDirection.y) || Math.abs(rayDirection.y) <= 1e-9) {
    return { ok: false, reason: "ray parallel to floor" };
  }
  const intersectionDistance = (floorPlaneY - rayOrigin.y) / rayDirection.y;
  if (!Number.isFinite(intersectionDistance)) {
    return { ok: false, reason: "invalid intersection distance" };
  }
  if (intersectionDistance <= 1e-9) {
    return { ok: false, reason: "intersection behind camera" };
  }
  const intersectionPoint = rayOrigin.clone().addScaledVector(rayDirection, intersectionDistance);
  if (
    !Number.isFinite(intersectionPoint.x) ||
    !Number.isFinite(intersectionPoint.y) ||
    !Number.isFinite(intersectionPoint.z)
  ) {
    return { ok: false, reason: "non-finite intersection point" };
  }
  return {
    ok: true,
    worldPoint: { x: intersectionPoint.x, y: intersectionPoint.y, z: intersectionPoint.z },
    floorPlane2D: { x: intersectionPoint.x, y: intersectionPoint.z },
  };
}

function projectWorldPointToOverlayNormalized(
  camera: THREE.PerspectiveCamera,
  frameSize: ImageFrameSize,
  worldPoint: { x: number; y: number; z: number }
): WorldProjectionResult | null {
  if (
    !Number.isFinite(worldPoint.x) ||
    !Number.isFinite(worldPoint.y) ||
    !Number.isFinite(worldPoint.z) ||
    frameSize.width <= 0 ||
    frameSize.height <= 0
  ) {
    return null;
  }
  camera.updateMatrixWorld(true);
  const pointWorld = new THREE.Vector3(worldPoint.x, worldPoint.y, worldPoint.z);
  const pointCamera = pointWorld.clone().applyMatrix4(camera.matrixWorldInverse);
  const pointNdc = pointWorld.clone().project(camera);
  if (!Number.isFinite(pointNdc.x) || !Number.isFinite(pointNdc.y) || !Number.isFinite(pointNdc.z)) {
    return null;
  }
  const normalizedX = (pointNdc.x + 1) / 2;
  const normalizedY = (1 - pointNdc.y) / 2;
  const inFront = pointCamera.z < 0;
  const isVisibleInView =
    inFront &&
    pointNdc.x >= -1 &&
    pointNdc.x <= 1 &&
    pointNdc.y >= -1 &&
    pointNdc.y <= 1 &&
    pointNdc.z >= -1 &&
    pointNdc.z <= 1;
  return {
    normalized: { x: normalizedX, y: normalizedY },
    pixels: {
      x: normalizedX * frameSize.width,
      y: normalizedY * frameSize.height,
    },
    ndc: { x: pointNdc.x, y: pointNdc.y, z: pointNdc.z },
    inFront,
    isVisibleInView,
  };
}

function disposeMaterial(material: THREE.Material) {
  const materialRecord = material as unknown as Record<string, unknown>;
  for (const key of MATERIAL_TEXTURE_KEYS) {
    const value = materialRecord[key];
    if (value && typeof value === "object" && "isTexture" in value) {
      (value as THREE.Texture).dispose();
    }
  }
  material.dispose();
}

function disposeObject3D(object: THREE.Object3D) {
  object.traverse((child) => {
    const maybeMesh = child as THREE.Mesh;
    if (!maybeMesh.isMesh) return;
    maybeMesh.geometry?.dispose();
    if (Array.isArray(maybeMesh.material)) {
      for (const material of maybeMesh.material) disposeMaterial(material);
      return;
    }
    if (maybeMesh.material) disposeMaterial(maybeMesh.material);
  });
}

function formatModelStatus(state: ModelLoadState, errorMessage: string | null): string {
  if (state === "fallback") return `fallback cube (${errorMessage ?? "GLB load failed"})`;
  if (state === "error") return `error (${errorMessage ?? "unknown"})`;
  return state;
}

function defaultTransformForKind(kind: ActiveObjectKind): TransformState {
  if (kind === "fallback") return FALLBACK_DEFAULT_TRANSFORM;
  return GLB_DEFAULT_TRANSFORM;
}

function toSceneActiveObjectType(kind: ActiveObjectKind): "glb" | "fallbackCube" | "none" {
  if (kind === "gltf") return "glb";
  if (kind === "fallback") return "fallbackCube";
  return "none";
}

function TransformControlRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  disabled = false,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs text-slate-300">{label}</label>
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(event) => {
            const next = Number.parseFloat(event.target.value);
            if (!Number.isFinite(next)) return;
            onChange(clampValue(next, min, max));
          }}
          className="w-24 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 outline-none focus:border-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(clampValue(Number.parseFloat(event.target.value), min, max))}
        className="mt-2 w-full accent-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
      />
    </div>
  );
}

type ThreeRoomLabProps = {
  // Server-derived (AUTO_FLOOR_VISION_ENABLED). Controls whether the experimental
  // Gemini vision provider is offered in the provider selector. The route remains
  // the hard security gate regardless of this value.
  visionEnabled?: boolean;
  // Server-derived (EMPTY_ROOM_ASSIST_ENABLED). Controls whether the lab-only
  // Empty-Room assist panel is offered. The route remains the hard gate.
  emptyRoomAssistEnabled?: boolean;
};

// --- Phase 2O-O: neutral, descriptive support-qualification presentation -----
// Status/readout labels + tones ONLY. These are never recommendation styling
// and never imply an action or mode switch. There is intentionally no label
// containing "switch", "use", "recommended", "best", "auto-route", or "requires
// Type B".
const SUPPORT_QUALIFICATION_LABELS: Record<SupportQualificationClassification, string> = {
  qualification_not_run: "Qualification not run",
  insufficient_support_or_unknown: "Insufficient support or unknown",
  type_a_strong_support: "Type A strong support",
  type_a_weak_support: "Type A weak support",
  type_a_exhausted_type_b_candidate: "Type A exhausted — Type B handoff candidate",
};

const SUPPORT_QUALIFICATION_TONES: Record<SupportQualificationClassification, string> = {
  qualification_not_run: "border-slate-700 bg-slate-900/40 text-slate-300",
  insufficient_support_or_unknown: "border-slate-600/60 bg-slate-900/50 text-slate-200",
  type_a_strong_support: "border-emerald-500/40 bg-emerald-500/5 text-emerald-200",
  type_a_weak_support: "border-amber-500/40 bg-amber-500/5 text-amber-200",
  type_a_exhausted_type_b_candidate: "border-violet-500/40 bg-violet-500/5 text-violet-200",
};

// SUBSTANTIVE weak-support indicator labels ONLY. `determining_endpoint_near_frame`
// is intentionally absent — it is advisory evidence (see the advisory map) and
// never appears in this list.
const SUPPORT_QUALIFICATION_WEAK_LABELS: Record<string, string> = {
  short_determining_span_absolute: "Determining-side span is short",
  short_determining_span_image_diagonal: "Determining-side span is small relative to image scale",
  severe_determining_to_movable_span_imbalance:
    "Determining side is small relative to movable-side support",
  determining_seam_frame_edge_collapsed: "Determining side is short and frame-edge-collapsed",
};

// Phase 2O-O-B: second axis — current bounded broad-search viability. Descriptive
// status labels/tones, visually distinct from the support-sufficiency verdict.
// No label implies an action, mode switch, best/recommended tuple, or Type B.
const SUPPORT_QUALIFICATION_VIABILITY_LABELS: Record<SupportQualificationBroadSearchViability, string> = {
  broad_search_not_run_or_unknown: "Broad search not run or unknown",
  broad_search_usable_basin_found: "Usable basin found under current coverage",
  broad_search_no_usable_basin_current_coverage: "No usable basin under current coverage",
};

const SUPPORT_QUALIFICATION_VIABILITY_TONES: Record<SupportQualificationBroadSearchViability, string> = {
  broad_search_not_run_or_unknown: "border-slate-600/70 bg-slate-900/40 text-slate-300",
  broad_search_usable_basin_found: "border-sky-500/50 bg-sky-500/5 text-sky-200",
  broad_search_no_usable_basin_current_coverage: "border-orange-500/50 bg-orange-500/5 text-orange-200",
};

const SUPPORT_QUALIFICATION_VIABILITY_NOTES: Record<SupportQualificationBroadSearchViability, string> = {
  broad_search_not_run_or_unknown:
    "No current complete broad-search conclusion is available. Absence, stale evidence, truncation, incomplete results, or an unknown local-seed observation are not treated as a Type A failure.",
  broad_search_usable_basin_found:
    "At least one current broad-search result has a usable high-confidence path under the current coverage.",
  broad_search_no_usable_basin_current_coverage:
    "This means the current bounded Type A broad-search coverage did not identify a usable basin. It does not by itself imply Type B.",
};

// Phase 2O-O-B: non-routing advisory evidence facts (rendered separately from
// substantive weak-support indicators).
const SUPPORT_QUALIFICATION_ADVISORY_LABELS: Record<SupportQualificationAdvisoryFact, string> = {
  determining_endpoint_near_frame: "Determining endpoint near source-image frame edge",
};

// --- Phase B2: Type B Operator Evidence Panel display maps ------------------
// Neutral, diagnostic language ONLY. No label implies a search, preview, load,
// Apply, calibration, mode switch, or "recommended/best/use Type B" action.
const TYPE_B_STATUS_LABELS: Record<TypeBQualificationStatus, string> = {
  not_assessed: "Type B evidence not assessed",
  type_a_investigation_preferred: "Type A investigation remains preferred",
  type_b_evidence_insufficient: "Type B evidence insufficient",
  type_b_evidence_incompatible: "Type B evidence incompatible with this family",
  type_b_evidence_candidate: "Type B evidence candidate",
  type_b_diagnostic_eligible: "Type B diagnostic eligibility established",
};

// Collapsed one-line status summary (neutral; never calibration-readiness).
const TYPE_B_COLLAPSED_STATUS_LABELS: Record<TypeBQualificationStatus, string> = {
  not_assessed: "Type B evidence not reviewed",
  type_a_investigation_preferred: "Type A investigation remains preferred",
  type_b_evidence_insufficient: "Type B evidence insufficient",
  type_b_evidence_incompatible: "Type B evidence incompatible",
  type_b_evidence_candidate: "Type B evidence candidate",
  type_b_diagnostic_eligible: "Type B diagnostic eligibility established",
};

// Deliberately understated tones. Eligibility uses a calm sky/slate treatment,
// NOT an emerald "ready/apply" success style, so it can never be mistaken for
// calibration readiness.
const TYPE_B_STATUS_TONES: Record<TypeBQualificationStatus, string> = {
  not_assessed: "border-slate-700 bg-slate-900/40 text-slate-300",
  type_a_investigation_preferred: "border-slate-600/70 bg-slate-900/50 text-slate-200",
  type_b_evidence_insufficient: "border-amber-500/40 bg-amber-500/5 text-amber-200",
  type_b_evidence_incompatible: "border-rose-500/40 bg-rose-500/5 text-rose-200",
  type_b_evidence_candidate: "border-sky-500/40 bg-sky-500/5 text-sky-200",
  type_b_diagnostic_eligible: "border-sky-400/50 bg-slate-900/50 text-sky-100",
};

const TYPE_B_REASON_LABELS: Record<TypeBQualificationReason, string> = {
  missing_source_frame: "No valid source frame is available.",
  invalid_source_frame: "The source frame is invalid.",
  missing_rear_seam: "No rear seam has been declared.",
  missing_strong_side_seam: "No strong side support seam has been declared.",
  rear_seam_role_unresolved: "Rear seam identity is unresolved.",
  side_seam_role_unresolved: "Strong side support identity is unresolved.",
  rear_seam_geometry_invalid: "Rear seam geometry is invalid or non-finite.",
  side_seam_geometry_invalid: "Strong side support geometry is invalid or non-finite.",
  rear_seam_support_insufficient: "Rear seam visible support is insufficient.",
  side_seam_support_insufficient: "Strong side support visible support is insufficient.",
  rear_side_geometry_degenerate:
    "Rear and side support geometry is too degenerate for this family.",
  rear_side_junction_unresolved: "A shared visible junction is not established.",
  rear_side_junction_incompatible:
    "Declared rear and side endpoints do not share a visible junction.",
  latent_near_corner_not_bounded: "Latent near-corner condition is not bounded.",
  latent_near_corner_unresolved: "Latent near-corner condition is unresolved.",
  crop_or_frame_contact_ambiguous: "Required frame-contact evidence is ambiguous.",
  material_occlusion_on_required_support:
    "A required support seam is materially obstructed.",
  type_a_support_still_investigable: "Type A remains the current investigation path.",
  type_a_investigation_preferred: "Type A investigation remains preferred.",
  type_a_exhaustion_not_established: "Type A exhaustion is not established.",
  type_b_evidence_present_but_incomplete:
    "Type B evidence is incomplete under the current declarations.",
  type_b_evidence_family_eligible:
    "Declared evidence meets this Type B family's bounded eligibility conditions.",
};

const TYPE_B_ENDPOINT_STATUS_OPTIONS: { value: TypeBEndpointStatus; label: string }[] = [
  { value: "visible", label: "Visible" },
  { value: "near_frame", label: "Near frame (advisory)" },
  { value: "frame_truncated", label: "Frame-truncated" },
  { value: "occluded", label: "Occluded" },
  { value: "unresolved", label: "Unresolved" },
];

const TYPE_B_FRAME_CONTACT_OPTIONS: { value: TypeBFrameContactStatus; label: string }[] = [
  { value: "no_frame_contact", label: "No frame contact" },
  { value: "contacts_frame", label: "Contacts frame (visibility only)" },
  { value: "frame_contact_ambiguous", label: "Frame contact ambiguous" },
  { value: "unknown", label: "Unknown" },
];

const TYPE_B_OCCLUSION_OPTIONS: { value: TypeBOcclusionStatus; label: string }[] = [
  { value: "none_observed", label: "None observed" },
  { value: "partial_obstruction", label: "Partial obstruction" },
  { value: "material_obstruction", label: "Material obstruction" },
  { value: "unknown", label: "Unknown" },
];

const TYPE_B_SIDE_ROLE_OPTIONS: { value: TypeBStructuralLineRole; label: string }[] = [
  { value: "side_floor_boundary", label: "Side floor boundary" },
  { value: "side_wall_floor_seam", label: "Side wall-floor seam" },
  { value: "unresolved", label: "Unresolved" },
];

const TYPE_B_LATENT_OPTIONS: { value: TypeBLatentNearCornerCondition; label: string }[] = [
  { value: "frame_truncated", label: "Frame-truncated" },
  { value: "occluded", label: "Occluded" },
  { value: "not_needed_visible", label: "Visible / not needed" },
  { value: "unresolved", label: "Unresolved" },
];

// Compact endpoint-status glyph for the diagnostic overlay markers.
const TYPE_B_ENDPOINT_STATUS_GLYPH: Record<TypeBEndpointStatus, string> = {
  visible: "V",
  near_frame: "N",
  frame_truncated: "T",
  occluded: "O",
  unresolved: "?",
};

// Phase B2A: labels for the four direct-placement / drag endpoint targets.
const TYPE_B_PLACEMENT_TARGET_LABELS: Record<TypeBEndpointTarget, string> = {
  rear_start: "rear seam start",
  rear_end: "rear seam end",
  side_start: "side seam start",
  side_end: "side seam end",
};

function formatTypeBBool(value: boolean | null | undefined): string {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "Unknown";
}

function formatTypeBPx(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : `${value.toFixed(1)} source px`;
}

function formatTypeBRatio(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : value.toFixed(3);
}

function formatTypeBAngle(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : `${value.toFixed(1)}°`;
}

// --- Phase B3E: raw operator-input parsing (pure; NEVER repairs) ------------
// A single authored numeric field. A blank or malformed value becomes NaN and
// is passed VERBATIM to the pure capture / evaluation contract so it can refuse
// honestly; nothing is defaulted, clamped, or dropped.
function parseTypeBNumberField(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return Number.NaN;
  return Number(trimmed);
}

// A comma-separated authored numeric list. A blank WHOLE field yields an empty
// list. Token order is preserved exactly; a blank/invalid internal token
// becomes a non-finite NaN value (never silently dropped, sorted, deduplicated,
// interpolated, or generated).
function parseTypeBNumberListField(text: string): number[] {
  if (text.trim().length === 0) return [];
  return text.split(",").map((token) => {
    const trimmed = token.trim();
    if (trimmed.length === 0) return Number.NaN;
    return Number(trimmed);
  });
}

// True only when a raw authored field carries at least one non-whitespace char.
function typeBFieldPresent(text: string): boolean {
  return text.trim().length > 0;
}

// Neutral display of a raw numeric fact (preserves NaN as a visible literal).
function formatTypeBNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (Number.isNaN(value)) return "NaN";
  if (!Number.isFinite(value)) return String(value);
  return String(value);
}

function formatQualPx(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)} px` : "unavailable";
}

function formatQualRatio(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(3) : "unavailable";
}

function formatQualBool(value: boolean | null | undefined): string {
  if (value === true) return "yes";
  if (value === false) return "no";
  return "unavailable";
}

export default function ThreeRoomLab({
  visionEnabled = false,
  emptyRoomAssistEnabled = false,
}: ThreeRoomLabProps) {
  const envEnabled = process.env.NEXT_PUBLIC_VIBODE_ENABLE_3D_ROOM_LAB === "1";
  const availableAutoFloorProviders = useMemo(
    () => getSelectableAutoFloorDetectionProviders(visionEnabled),
    [visionEnabled]
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const floorOverlayRef = useRef<SVGSVGElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const placementGroupRef = useRef<THREE.Group | null>(null);
  const modelNormalizationGroupRef = useRef<THREE.Group | null>(null);
  const autoBoundsGroupRef = useRef<THREE.Group | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const autoNormalizeBoundsEnabledRef = useRef(true);
  const lastAutoBoundsRef = useRef<AutoBoundsNormalization | null>(null);
  const activeObjectRef = useRef<THREE.Object3D | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const loadModelFromPathRef = useRef<((path: string) => void) | null>(null);
  const useFallbackCubeRef = useRef<(() => void) | null>(null);
  const transformRef = useRef<TransformState>(GLB_DEFAULT_TRANSFORM);
  const modelNormalizationRef = useRef<ModelNormalizationState>(DEFAULT_MODEL_NORMALIZATION);
  const transformOwnedRef = useRef(false);
  const autoRotateEnabledRef = useRef(false);
  const autoRotateOffsetDegRef = useRef(0);
  const dragPointerIdRef = useRef<number | null>(null);
  const objectHandleDragPointerIdRef = useRef<number | null>(null);
  const objectHandleRotateStartAngleRadRef = useRef(0);
  const objectHandleRotateStartRotationDegRef = useRef(0);
  const objectHandleScaleStartDistancePxRef = useRef(OBJECT_HANDLE_SCALE_MIN_START_DISTANCE_PX);
  const objectHandleScaleStartUniformScaleRef = useRef(1);
  const objectHandleHeightStartClientYRef = useRef(0);
  const objectHandleHeightStartPositionYRef = useRef(0);
  const calibratedMoveDragPointerIdRef = useRef<number | null>(null);
  const calibratedMoveGrabOffsetRef = useRef<{ offsetX: number; offsetZ: number } | null>(null);
  // Phase 2I-A: dedicated calibrated Rotate drag identity/start-state refs. These
  // are intentionally separate from the legacy object-handle rotate refs so the
  // calibrated path never routes through the disabled legacy handle system.
  const calibratedRotateDragPointerIdRef = useRef<number | null>(null);
  const calibratedRotateStartAngleRadRef = useRef(0);
  const calibratedRotateStartRotationDegRef = useRef(0);
  const calibratedRotateStartTransformRef = useRef<TransformState | null>(null);
  // Phase 2I-B1: dedicated calibrated Scale drag identity/start-state refs. These
  // are intentionally separate from the legacy object-handle scale refs and from
  // the calibrated MOVE/Rotate refs so the Scale path has its own pointer identity.
  const calibratedScaleDragPointerIdRef = useRef<number | null>(null);
  const calibratedScaleStartDistancePxRef = useRef(OBJECT_HANDLE_SCALE_MIN_START_DISTANCE_PX);
  const calibratedScaleStartUniformScaleRef = useRef(1);
  const calibratedScaleStartTransformRef = useRef<TransformState | null>(null);
  // Phase 2I-C1: dedicated calibrated Lift drag identity/start-state refs. Isolated
  // from legacy object-handle height refs and from calibrated MOVE/Rotate/Scale.
  const calibratedLiftDragPointerIdRef = useRef<number | null>(null);
  const calibratedLiftStartPositionYRef = useRef(0);
  const calibratedLiftStartClientPointRef = useRef<{ x: number; y: number } | null>(null);
  const calibratedLiftStartTransformRef = useRef<TransformState | null>(null);
  const floorAnchorDragPointerIdRef = useRef<number | null>(null);
  const lastAcceptedFloorClickRef = useRef<FloorPoint | null>(null);
  const perspectiveDepthScalingRef = useRef<PerspectiveDepthScalingState>(
    DEFAULT_PERSPECTIVE_DEPTH_SCALING
  );
  const calibratedCameraActiveRef = useRef(false);
  const calibratedCameraSnapshotRef = useRef<CalibratedCameraSnapshot | null>(null);
  const preCalibratedDepthScalingRef = useRef<PerspectiveDepthScalingState | null>(null);

  const [roomImageInput, setRoomImageInput] = useState(DEFAULT_ROOM_IMAGE_URL);
  const [roomImageUrl, setRoomImageUrl] = useState(DEFAULT_ROOM_IMAGE_URL);
  const [imageLoadState, setImageLoadState] = useState<ImageLoadState>(
    DEFAULT_ROOM_IMAGE_URL ? "loading" : "idle"
  );
  const [imageIntrinsicSize, setImageIntrinsicSize] = useState<ImageIntrinsicSize | null>(null);
  // Phase 2J-B3R: identity of the room image URL that actually finished loading
  // with valid intrinsic dimensions. Readiness checks use this to distinguish
  // "same URL already loaded" from "same URL still loading/error".
  const [loadedImageUrl, setLoadedImageUrl] = useState<string | null>(null);
  const [modelLoadState, setModelLoadState] = useState<ModelLoadState>("idle");
  const [modelLoadError, setModelLoadError] = useState<string | null>(null);
  const [modelPathInput, setModelPathInput] = useState(DEFAULT_MODEL_GLB_PATH);
  const [modelPath, setModelPath] = useState(DEFAULT_MODEL_GLB_PATH);
  const [rendererSize, setRendererSize] = useState({ width: 0, height: 0 });
  const [activeObjectKind, setActiveObjectKind] = useState<ActiveObjectKind>(null);
  const [autoRotateEnabled, setAutoRotateEnabled] = useState(false);
  const [transform, setTransform] = useState<TransformState>(GLB_DEFAULT_TRANSFORM);
  const [modelNormalization, setModelNormalization] =
    useState<ModelNormalizationState>(DEFAULT_MODEL_NORMALIZATION);
  const [autoNormalizeBoundsEnabled, setAutoNormalizeBoundsEnabled] = useState(true);
  const [autoBoundsInfo, setAutoBoundsInfo] = useState<AutoBoundsNormalization | null>(null);
  // Phase 0P-C: local-only UI collapse state (not persisted, not in scene JSON).
  const [isCalibratedCameraOpen, setIsCalibratedCameraOpen] = useState(true);
  const [isAdvancedControlsOpen, setIsAdvancedControlsOpen] = useState(false);
  const [isSceneStateOpen, setIsSceneStateOpen] = useState(false);
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [showHomographyDebugOverlay, setShowHomographyDebugOverlay] = useState(false);
  const [cameraPoseFovYDeg, setCameraPoseFovYDeg] = useState(50);
  const [isCalibratedCameraActive, setIsCalibratedCameraActive] = useState(false);
  // Phase 2K-C: one-click "Scan & apply" pending action. This arms a single
  // deferred apply attempt: the click sets the recommended FOV and records the
  // pending FOV; a controlled effect then applies ONLY through the unchanged
  // calibratedCameraApplyStatus gate + applyCalibratedCameraSnapshotFromCandidate
  // path once diagnostics have recomputed. It never introduces a second
  // eligibility path or a scan-confidence-based apply.
  const [pendingScanAndApplyFov, setPendingScanAndApplyFov] = useState<number | null>(null);
  const [scanAndApplyResult, setScanAndApplyResult] = useState<
    { kind: "applied"; fov: number } | { kind: "blocked"; fov: number } | null
  >(null);
  const [calibratedCameraSnapshot, setCalibratedCameraSnapshot] = useState<CalibratedCameraSnapshot | null>(null);
  const [lastCalibratedCameraAutoRevertReason, setLastCalibratedCameraAutoRevertReason] = useState<string | null>(null);
  // Phase 2J-B3: deferred calibrated-camera restore. A scene import always
  // restores generic state, but a persisted calibration block is only an
  // optional re-solve REQUEST. We stash the validated block as a pending request
  // and wait for the imported image + frame to become usable before attempting a
  // fresh, compatible solve. `calibrationRestoreRequestIdRef` is the monotonic
  // generation used to cancel stale requests when a newer import/image change
  // arrives, so an old pending request can never apply out of order.
  const [pendingCalibrationRestore, setPendingCalibrationRestore] = useState<{
    requestId: number;
    calibration: CalibratedSceneStateCalibrationV1;
  } | null>(null);
  const calibrationRestoreRequestIdRef = useRef(0);
  const [calibratedRestoreStatus, setCalibratedRestoreStatus] = useState<string>("none");
  const [floorClickMappingMode, setFloorClickMappingMode] = useState<FloorClickMappingMode>("legacy");
  const [lastFloorClickMappingResult, setLastFloorClickMappingResult] = useState<string>("legacy");
  const [showFloorOverlay, setShowFloorOverlay] = useState(true);
  const [floorPolygon, setFloorPolygon] = useState<FloorPoint[]>(DEFAULT_FLOOR_POLYGON);
  const [activeFloorHandleIndex, setActiveFloorHandleIndex] = useState<number | null>(null);
  // Phase 2B: auto floor detection mock harness. These do not mutate the manual
  // floor polygon, scene-state, or any calibrated camera behavior.
  const [autoFloorDetectionResult, setAutoFloorDetectionResult] =
    useState<AutoFloorDetectionResult | null>(null);
  const [selectedAutoFloorCandidateId, setSelectedAutoFloorCandidateId] = useState<string | null>(
    null
  );
  // Phase 2D: explicit "Apply suggested quad" readout state. The apply action
  // copies the candidate quad into the editable floor polygon; these are debug/
  // status only and never feed back into scoring or the candidate objects.
  const [appliedAutoFloorCandidateId, setAppliedAutoFloorCandidateId] = useState<string | null>(null);
  const [lastAutoFloorApplyMessage, setLastAutoFloorApplyMessage] = useState<string>("none");
  // Phase 2E: async detection run state through the provider boundary.
  // Phase 2F-C: selectable provider (mock-local default; mock-api adds the
  // lab-only route boundary). ACTIVE_AUTO_FLOOR_DETECTION_PROVIDER_ID stays the
  // default; switching providers does not auto-run detection.
  const [autoFloorDetectionRunState, setAutoFloorDetectionRunState] =
    useState<AutoFloorDetectionRunState>("idle");
  const [autoFloorDetectionFailureReasons, setAutoFloorDetectionFailureReasons] = useState<string[]>([]);
  const [selectedAutoFloorProviderId, setSelectedAutoFloorProviderId] =
    useState<AutoFloorDetectionProviderId>(ACTIVE_AUTO_FLOOR_DETECTION_PROVIDER_ID);
  const autoFloorDetectionInFlightRef = useRef(false);
  // Phase 2O-B1: manual seam / support annotation harness. LAB-ONLY,
  // DIAGNOSTIC-ONLY, NON-PERSISTENT. This local React state never mutates
  // floorPolygon, candidate geometry/selection, solver math, FOV scanning,
  // Apply / Scan & Apply, snapshot, or scene-state/JSON persistence. It is
  // deliberately ephemeral and reset whenever the loaded source image or the
  // selected Auto Floor candidate changes (see the invalidation effects below).
  const [isManualAnnotationOpen, setIsManualAnnotationOpen] = useState(false);
  const [manualAnnotation, setManualAnnotation] = useState<ManualFloorSupportAnnotation | null>(null);
  const [selectedManualSeamId, setSelectedManualSeamId] = useState<string | null>(null);
  const [manualSeamDraftPoints, setManualSeamDraftPoints] = useState<SourceNormPoint[]>([]);
  const [isPlacingManualSeam, setIsPlacingManualSeam] = useState(false);
  const [isDraggingManualVertex, setIsDraggingManualVertex] = useState(false);
  const [manualAnnotationResetReason, setManualAnnotationResetReason] = useState<string | null>(null);
  const manualOverlayRef = useRef<SVGSVGElement | null>(null);
  const manualSeamIdCounterRef = useRef(0);
  const manualDraggingVertexRef = useRef<{ seamId: string; index: number; pointerId: number } | null>(null);
  const manualAnnotationPrevImageRef = useRef<string | null>(loadedImageUrl);
  const manualAnnotationPrevCandidateRef = useRef<string | null>(selectedAutoFloorCandidateId);
  // --- Phase 2O-D: constrained diagnostic trial state -----------------------
  // Ephemeral local diagnostic records only. Never applied, promoted, selected,
  // or written to floorPolygon / candidate / FOV / snapshot / scene state.
  const [isManualTrialsOpen, setIsManualTrialsOpen] = useState(false);
  const [manualTrialSet, setManualTrialSet] = useState<ManualFloorSupportTrialSet | null>(null);
  const [manualTrialNotice, setManualTrialNotice] = useState<string | null>(null);
  const manualTrialSetRef = useRef<ManualFloorSupportTrialSet | null>(null);
  // Phase 2O-E: id of the single trial currently previewed on the room overlay.
  // Pure temporary view-state; never written to floor polygon / candidate / FOV.
  const [previewTrialId, setPreviewTrialId] = useState<string | null>(null);
  // --- Phase 2O-H: Type A coupled diagnostic search readout -----------------
  // Ephemeral, lab-only, NON-PERSISTENT diagnostic result set from the committed
  // Phase 2O-G pure helper. Distinct state path from manualTrialSet. Never
  // previewed/selected/applied; never mutates candidate/polygon/FOV/dimensions/
  // calibration/scene state. Cleared whenever source evidence changes.
  // Phase 2O-O: read-only support qualification panel open state (display only).
  const [isSupportQualificationOpen, setIsSupportQualificationOpen] = useState(false);
  // --- Phase B2: read-only Type B Operator Evidence Panel state -------------
  // LAB-ONLY, DIAGNOSTIC-ONLY, NON-PERSISTENT. Ephemeral local state only. It
  // NEVER mutates floorPolygon, candidate geometry/selection, FOV, dimensions,
  // Apply / readiness / calibration, or scene-state, and never runs a Type B
  // solver / FOV / search / preview / load. Declarations are cleared whenever
  // the underlying room-geometry basis changes (see the invalidation effect).
  const [isTypeBReviewOpen, setIsTypeBReviewOpen] = useState(false);
  const [typeBReview, setTypeBReview] = useState<TypeBEvidenceReviewState>(
    createEmptyTypeBReviewState
  );
  const [typeBOverlayVisible, setTypeBOverlayVisible] = useState(false);
  const [typeBReviewNote, setTypeBReviewNote] = useState<string | null>(null);
  const typeBReviewRef = useRef<TypeBEvidenceReviewState>(typeBReview);
  const typeBPrevTypeAContextRef = useRef<string | null>(null);
  // --- Phase B2A: transient direct-overlay edit UI state -------------------
  // Placement-target arming (which single declared endpoint the NEXT valid
  // image click declares) and drag state. Both are ephemeral UI state only:
  // never persisted, cleared on completion, clear, invalidation, or teardown.
  const [typeBPlacementTarget, setTypeBPlacementTarget] =
    useState<TypeBPlacementTarget>(null);
  const typeBPlacementTargetRef = useRef<TypeBPlacementTarget>(null);
  const [typeBDraggingTarget, setTypeBDraggingTarget] =
    useState<TypeBEndpointTarget | null>(null);
  const typeBDraggingRef = useRef<{ target: TypeBEndpointTarget; pointerId: number } | null>(
    null
  );
  const typeBOverlayRef = useRef<SVGSVGElement | null>(null);
  // --- Phase B3E: read-only Type B capture + diagnostic UI state ------------
  // LAB-ONLY, DIAGNOSTIC-FIRST, READ-ONLY. Isolated local state ONLY. Nothing
  // here is seeded from Type A or any live room state; every field is
  // operator-authored and starts blank / empty. Capture and diagnostic run
  // happen ONLY on an explicit button click, never from an effect. No value
  // here mutates calibration / candidate / polygon / FOV / dimensions /
  // readiness / camera mode, and nothing is persisted.
  //
  // Raw operator-authored capture inputs (verbatim strings; never normalized,
  // sorted, deduplicated, generated, interpolated, or repaired).
  const [typeBWorldWidthText, setTypeBWorldWidthText] = useState("");
  const [typeBAspectRatiosText, setTypeBAspectRatiosText] = useState("");
  const [typeBProductClassRows, setTypeBProductClassRows] = useState<
    { identity: string; value: string }[]
  >([]);
  const [typeBFovProbesText, setTypeBFovProbesText] = useState("");
  // Exact capture / diagnostic results (stored verbatim; null until captured).
  const [typeBCaptureResult, setTypeBCaptureResult] =
    useState<TypeBCaptureResult | null>(null);
  const [typeBDiagnosticEnvelope, setTypeBDiagnosticEnvelope] =
    useState<TypeBDiagnosticRunAssemblyResult | null>(null);
  // Optional branch-association request. Default OFF -> branchAssociation:null.
  const [typeBRequestBranchAssociation, setTypeBRequestBranchAssociation] =
    useState(false);
  // Raw operator-authored topology + policy fields (blank until authored).
  const [typeBTopologyOrderedProbesText, setTypeBTopologyOrderedProbesText] =
    useState("");
  const [typeBTopologyStepText, setTypeBTopologyStepText] = useState("");
  const [typeBPolicyMaxPosText, setTypeBPolicyMaxPosText] = useState("");
  const [typeBPolicyMaxRotText, setTypeBPolicyMaxRotText] = useState("");
  const [typeBPolicyTiePosText, setTypeBPolicyTiePosText] = useState("");
  const [typeBPolicyTieRotText, setTypeBPolicyTieRotText] = useState("");
  const [typeBPolicyNearPosText, setTypeBPolicyNearPosText] = useState("");
  const [typeBPolicyNearRotText, setTypeBPolicyNearRotText] = useState("");
  // Read-only results collapse state (results persist through panel collapse;
  // they clear ONLY via the B3E invalidation rules, never on toggle).
  const [isTypeBTupleClassesOpen, setIsTypeBTupleClassesOpen] = useState(false);
  const [isTypeBProbeOutcomesOpen, setIsTypeBProbeOutcomesOpen] =
    useState(false);
  const [isTypeBBranchCorridorsOpen, setIsTypeBBranchCorridorsOpen] =
    useState(false);
  const [isTypeBFrameTruncationOpen, setIsTypeBFrameTruncationOpen] =
    useState(false);
  const [isCoupledSearchOpen, setIsCoupledSearchOpen] = useState(false);
  const [coupledSearchResultSet, setCoupledSearchResultSet] =
    useState<CoupledSearchResultSet | null>(null);
  const [coupledSearchNotice, setCoupledSearchNotice] = useState<string | null>(null);
  const [coupledSearchSnapshot, setCoupledSearchSnapshot] = useState<{
    movableCorner: "NL" | "NR";
    approvedSeamId: string;
    determiningEdgeSeamId: string;
    determiningEdgeRole: string;
    fixedWorldWidth: number;
    probeFovDeg: number;
    liveAspectRatio: number;
  } | null>(null);
  const coupledSearchResultSetRef = useRef<CoupledSearchResultSet | null>(null);
  // Phase 2O-O: generation-time evidence signature for the current broad result
  // set. Stamped when a set is produced and cleared when it is absent/cleared/
  // invalidated. Read-only provenance used ONLY to let the pure qualification
  // classifier detect a stale broad search (a changed live signature reads as
  // NON-current until the set is regenerated). Never drives any search/mutation.
  const [coupledSearchResultSignature, setCoupledSearchResultSignature] = useState<string | null>(null);
  const coupledSearchEvidenceSignatureRef = useRef<string | null>(null);
  // Phase 2O-I: single active coupled-search preview (separate from the Phase
  // 2O-E manual-trial preview). View-state only; never written to candidate /
  // floor polygon / FOV / dimensions / calibration. The signature binds the
  // preview to the source evidence so a stale tuple can never render.
  const [coupledSearchPreviewTrialId, setCoupledSearchPreviewTrialId] = useState<string | null>(null);
  const [coupledSearchPreviewSignature, setCoupledSearchPreviewSignature] = useState<string | null>(null);
  // --- Phase 2O-K-B: Type A local refinement readout ------------------------
  // Ephemeral, lab-only, NON-PERSISTENT diagnostic result set from the committed
  // Phase 2O-K-A pure helper. Seeded ONLY by an explicit operator action on a
  // stored coarse coupled-search row (no auto-seed, no "best tuple"). Distinct
  // state path from manualTrialSet / coupledSearchResultSet / both preview
  // systems. Never previewed/selected/applied; never mutates candidate / polygon
  // / FOV / dimensions / calibration / scene. Cleared whenever source evidence
  // or the broad coupled result-set identity changes. The signature + seed-row
  // id bind it to current evidence so a stale local result can never render.
  const [isLocalRefinementOpen, setIsLocalRefinementOpen] = useState(false);
  const [localRefinementResultSet, setLocalRefinementResultSet] =
    useState<LocalRefinementResultSet | null>(null);
  const [localRefinementNotice, setLocalRefinementNotice] = useState<string | null>(null);
  const [localRefinementSignature, setLocalRefinementSignature] = useState<string | null>(null);
  const [localRefinementSeedTrialId, setLocalRefinementSeedTrialId] = useState<string | null>(null);
  const localRefinementResultSetRef = useRef<LocalRefinementResultSet | null>(null);
  // --- Phase 2O-K-C: Type A local refinement exact preview ------------------
  // One temporary, inspection-only preview of ONE stored local-refinement direct
  // FOV probe and its parent stored geometry tuple. Identified by stored ids
  // only (geometry tuple + probe); the exact geometry is always looked up from
  // the stored result set, never copied as mutable authority. Bound to the
  // coupled-search evidence signature so a stale tuple can never draw. Shares the
  // single-active-preview policy with manual (previewTrialId) and coupled
  // (coupledSearchPreview*) previews: activating any one clears the other two.
  // NEVER mutates candidate / polygon / FOV / dimensions / calibration / scene.
  const [localRefinementPreviewGeometryId, setLocalRefinementPreviewGeometryId] = useState<string | null>(null);
  const [localRefinementPreviewProbeId, setLocalRefinementPreviewProbeId] = useState<string | null>(null);
  const [localRefinementPreviewSignature, setLocalRefinementPreviewSignature] = useState<string | null>(null);
  // --- Phase 2O-L-A: local tuple → live controls load receipt ---------------
  // Ephemeral, NON-PERSISTENT informational receipt for the controlled
  // convenience action that copies ONE exact, currently-previewed, Apply-safe
  // local-refinement direct probe into the live floor/FOV controls. This is NOT
  // calibration authority: calibration stays unapplied; the operator must still
  // inspect Calibration readiness and click the existing Apply control. The
  // `signature` pins the receipt to the exact live values written at load time
  // so it clears on the next unrelated live-control/evidence change. Nothing
  // here re-runs the solver, search, or refinement, or persists.
  const [localTupleLoadReceipt, setLocalTupleLoadReceipt] = useState<{
    width: number;
    depth: number;
    fovDeg: number;
    tNear: number;
    aspectRatio: number;
    probeState: CoupledSearchPrimaryState;
    signature: string;
  } | null>(null);
  // Phase 2F-G1: lab-only fixture harness + observation recorder. Everything
  // here is local React state; nothing is persisted to DB/scene-state and no
  // automatic Gemini batch calls are made. Loading a fixture only sets the room
  // image URL; the user must explicitly run detection and record observations.
  const [selectedFixtureId, setSelectedFixtureId] = useState<string>(
    AUTO_FLOOR_FIXTURES[0]?.id ?? ""
  );
  const [fixtureObservations, setFixtureObservations] = useState<AutoFloorFixtureObservation[]>([]);
  const [fixtureHumanAssessment, setFixtureHumanAssessment] =
    useState<AutoFloorFixtureHumanAssessment>("good");
  const [fixtureManualCorrection, setFixtureManualCorrection] =
    useState<AutoFloorFixtureManualCorrection>("none");
  const [fixtureObservationNotes, setFixtureObservationNotes] = useState<string>("");
  const [fixtureHarnessMessage, setFixtureHarnessMessage] = useState<string>("none");
  // Phase 2H-B: lab-only empty-room assist. All local state; the route does the
  // hidden generation + dual detection. Generation/detection never auto-run, never
  // auto-apply, and never mutate floorPolygon or calibrated camera state.
  const [emptyRoomAssistUiStatus, setEmptyRoomAssistUiStatus] =
    useState<EmptyRoomAssistUiStatus>("idle");
  const [emptyRoomAssistResult, setEmptyRoomAssistResult] =
    useState<EmptyRoomAssistApiResponse | null>(null);
  const [emptyRoomAssistMessage, setEmptyRoomAssistMessage] = useState<string>("none");
  const [showEmptyRoomAssistDebug, setShowEmptyRoomAssistDebug] = useState(false);
  const emptyRoomAssistInFlightRef = useRef(false);
  const [isFloorClickPlacementEnabled, setIsFloorClickPlacementEnabled] = useState(false);
  const [isFloorAnchorDragEnabled, setIsFloorAnchorDragEnabled] = useState(false);
  const [isFloorAnchorDragActive, setIsFloorAnchorDragActive] = useState(false);
  const [isObject2DHandlesEnabled, setIsObject2DHandlesEnabled] = useState(false);
  const [activeObjectHandleMode, setActiveObjectHandleMode] = useState<ObjectHandleMode>(null);
  const [wasLastObjectHandleMoveRejected, setWasLastObjectHandleMoveRejected] = useState(false);
  const [lastObjectHandleRotateDeltaDeg, setLastObjectHandleRotateDeltaDeg] = useState<number | null>(null);
  const [lastObjectHandleScaleMultiplier, setLastObjectHandleScaleMultiplier] = useState<number | null>(null);
  const [lastObjectHandleHeightDeltaYUnits, setLastObjectHandleHeightDeltaYUnits] = useState<number | null>(null);
  const [lastCalibratedMoveStatus, setLastCalibratedMoveStatus] = useState<string>("none");
  // Phase 2I-A: calibrated Rotate status/diagnostics (independent of MOVE state).
  const [lastCalibratedRotateStatus, setLastCalibratedRotateStatus] = useState<string>("none");
  const [lastCalibratedRotateDeltaDeg, setLastCalibratedRotateDeltaDeg] = useState<number | null>(null);
  // Phase 2I-B1: calibrated Scale status/diagnostics (independent of MOVE/Rotate).
  const [lastCalibratedScaleStatus, setLastCalibratedScaleStatus] = useState<string>("none");
  const [lastCalibratedScaleMultiplier, setLastCalibratedScaleMultiplier] = useState<number | null>(null);
  // Phase 2I-C1: calibrated Lift status/diagnostics (independent of MOVE/Rotate/Scale).
  const [lastCalibratedLiftStatus, setLastCalibratedLiftStatus] = useState<string>("none");
  const [lastCalibratedLiftDeltaY, setLastCalibratedLiftDeltaY] = useState<number | null>(null);
  const [wasLastAnchorDragMoveRejected, setWasLastAnchorDragMoveRejected] = useState(false);
  // Compatibility marker only (Phase 1AE): legacy paths treat this as the accepted
  // screen click, while calibrated click/move update it to the derived projected
  // floor-contact marker. Future canonical anchor should be floor-plane world X/Z.
  const [lastAcceptedFloorClick, setLastAcceptedFloorClick] = useState<FloorPoint | null>(null);
  const [lastRejectedFloorClick, setLastRejectedFloorClick] = useState<FloorPoint | null>(null);
  const [floorMapping, setFloorMapping] = useState<FloorMappingState>(DEFAULT_FLOOR_MAPPING);
  const [perspectiveDepthScaling, setPerspectiveDepthScaling] = useState<PerspectiveDepthScalingState>(
    DEFAULT_PERSPECTIVE_DEPTH_SCALING
  );
  const [sceneStateExportedAt, setSceneStateExportedAt] = useState<string>("not-exported-yet");
  const [sceneJsonStatus, setSceneJsonStatus] = useState<SceneJsonStatus>({
    kind: "idle",
    message: "Ready to copy or download scene JSON.",
  });
  const [importSceneJsonInput, setImportSceneJsonInput] = useState("");
  const [importSceneStatus, setImportSceneStatus] = useState<SceneJsonStatus>({
    kind: "idle",
    message: "Paste exported scene JSON to restore state.",
  });
  const [localDraftStatus, setLocalDraftStatus] = useState<SceneJsonStatus>({
    kind: "idle",
    message: "Save or restore a browser-local draft.",
  });
  const [localDraftLastSavedAt, setLocalDraftLastSavedAt] = useState<string | null>(null);
  const [autoFitStatus, setAutoFitStatus] = useState<SceneJsonStatus>({
    kind: "idle",
    message: "Auto-fit reads your floor outline to set mapping and depth scaling.",
  });
  const LEGACY_FLOOR_MAPPING_DISABLED_MESSAGE =
    "Legacy floor mapping controls are disabled while calibrated camera is active. Revert to legacy camera to edit these mapping values.";

  useEffect(() => {
    transformRef.current = transform;
  }, [transform]);

  useEffect(() => {
    modelNormalizationRef.current = modelNormalization;
  }, [modelNormalization]);

  useEffect(() => {
    autoRotateEnabledRef.current = autoRotateEnabled;
    if (!autoRotateEnabled) {
      autoRotateOffsetDegRef.current = 0;
    }
  }, [autoRotateEnabled]);

  useEffect(() => {
    lastAcceptedFloorClickRef.current = lastAcceptedFloorClick;
  }, [lastAcceptedFloorClick]);

  useEffect(() => {
    perspectiveDepthScalingRef.current = perspectiveDepthScaling;
  }, [perspectiveDepthScaling]);

  useEffect(() => {
    calibratedCameraActiveRef.current = isCalibratedCameraActive;
  }, [isCalibratedCameraActive]);

  useEffect(() => {
    calibratedCameraSnapshotRef.current = calibratedCameraSnapshot;
  }, [calibratedCameraSnapshot]);

  const hasValidIntrinsicDimensions = useCallback(
    (size: ImageIntrinsicSize | null): size is ImageIntrinsicSize =>
      !!size &&
      Number.isFinite(size.width) &&
      Number.isFinite(size.height) &&
      size.width > 0 &&
      size.height > 0,
    []
  );

  const isRoomImageReadyForUrl = useCallback(
    (candidateUrl: string) => {
      const trimmedCandidateUrl = candidateUrl.trim();
      if (!trimmedCandidateUrl) return false;
      if (imageLoadState !== "loaded") return false;
      if (loadedImageUrl !== trimmedCandidateUrl) return false;
      return hasValidIntrinsicDimensions(imageIntrinsicSize);
    },
    [hasValidIntrinsicDimensions, imageIntrinsicSize, imageLoadState, loadedImageUrl]
  );

  const applyRoomImageRequest = useCallback(
    (requestedUrl: string) => {
      const trimmedRequestedUrl = requestedUrl.trim();
      const trimmedCurrentRoomImageUrl = roomImageUrl.trim();
      if (!trimmedRequestedUrl) {
        setImageLoadState("idle");
        setImageIntrinsicSize(null);
        setLoadedImageUrl(null);
        return;
      }
      if (isRoomImageReadyForUrl(trimmedRequestedUrl)) {
        setImageLoadState("loaded");
        return;
      }
      if (trimmedRequestedUrl === trimmedCurrentRoomImageUrl && imageLoadState === "error") {
        // Same URL remains errored until the URL actually changes or a real load
        // event occurs; do not force a synthetic "loading" state that can hang.
        setImageLoadState("error");
        setImageIntrinsicSize(null);
        setLoadedImageUrl(null);
        return;
      }
      setImageLoadState("loading");
      setImageIntrinsicSize(null);
      setLoadedImageUrl(null);
    },
    [imageLoadState, isRoomImageReadyForUrl, roomImageUrl]
  );

  const cancelPendingCalibrationRestoreAfterManualGeometryChange = useCallback(() => {
    if (!pendingCalibrationRestore) return;
    calibrationRestoreRequestIdRef.current += 1;
    setPendingCalibrationRestore(null);
    setCalibratedRestoreStatus(
      "Pending calibrated restore cancelled after manual scene geometry change."
    );
  }, [pendingCalibrationRestore]);

  const captureAndNeutralizeDepthScalingForCalibratedMode = useCallback(() => {
    if (!preCalibratedDepthScalingRef.current) {
      preCalibratedDepthScalingRef.current = { ...perspectiveDepthScalingRef.current };
    }
    setPerspectiveDepthScaling((prev) => ({ ...prev, enabled: false }));
  }, []);

  const restoreDepthScalingAfterCalibratedMode = useCallback(() => {
    const preCalibratedDepthScaling = preCalibratedDepthScalingRef.current;
    if (preCalibratedDepthScaling) {
      setPerspectiveDepthScaling({ ...preCalibratedDepthScaling });
    }
    preCalibratedDepthScalingRef.current = null;
  }, []);

  const deactivateCalibratedCameraMode = useCallback((options?: { clearAutoRevertReason?: boolean }) => {
    setIsCalibratedCameraActive(false);
    setCalibratedCameraSnapshot(null);
    calibratedMoveDragPointerIdRef.current = null;
    calibratedMoveGrabOffsetRef.current = null;
    setLastCalibratedMoveStatus("none");
    calibratedRotateDragPointerIdRef.current = null;
    calibratedRotateStartTransformRef.current = null;
    setLastCalibratedRotateStatus("none");
    setLastCalibratedRotateDeltaDeg(null);
    calibratedScaleDragPointerIdRef.current = null;
    calibratedScaleStartTransformRef.current = null;
    setLastCalibratedScaleStatus("none");
    setLastCalibratedScaleMultiplier(null);
    calibratedLiftDragPointerIdRef.current = null;
    calibratedLiftStartClientPointRef.current = null;
    calibratedLiftStartTransformRef.current = null;
    setLastCalibratedLiftStatus("none");
    setLastCalibratedLiftDeltaY(null);
    restoreDepthScalingAfterCalibratedMode();
    if (options?.clearAutoRevertReason) {
      setLastCalibratedCameraAutoRevertReason(null);
    }
  }, [restoreDepthScalingAfterCalibratedMode]);

  // Phase 2J-B3: single established calibrated-camera apply path. Both the manual
  // "Apply calibrated camera" button and the deferred restore effect funnel
  // through here so there is no parallel application mechanism. The camera pose
  // is always taken from a freshly derived candidate; it is never reconstructed
  // from a persisted snapshot.
  const applyCalibratedCameraSnapshotFromCandidate = useCallback(
    (
      candidate: {
        pose: CalibratedCameraSnapshot["pose"];
        frameSize: ImageFrameSize;
        diagnosticsSummary: string;
      },
      fovDeg: number
    ) => {
      captureAndNeutralizeDepthScalingForCalibratedMode();
      setLastCalibratedCameraAutoRevertReason(null);
      setCalibratedCameraSnapshot({
        pose: candidate.pose,
        fovDeg,
        frameSize: candidate.frameSize,
        diagnosticsSummary: candidate.diagnosticsSummary,
        appliedAtIso: new Date().toISOString(),
      });
      setIsCalibratedCameraActive(true);
    },
    [captureAndNeutralizeDepthScalingForCalibratedMode]
  );

  useEffect(() => {
    if (!isCalibratedCameraActive || !calibratedCameraSnapshot) return;
    const diagnostics = computeFrameMatchDiagnostics(calibratedCameraSnapshot.frameSize, rendererSize);
    if (!diagnostics?.isAutoRevertStale) return;
    deactivateCalibratedCameraMode();
    setLastCalibratedCameraAutoRevertReason(
      `reverted — frame changed too much (dw=${formatNumber(diagnostics.widthDeltaPercent)}%, dh=${formatNumber(
        diagnostics.heightDeltaPercent
      )}%, da=${formatNumber(diagnostics.aspectDeltaPercent)}%)`
    );
  }, [calibratedCameraSnapshot, deactivateCalibratedCameraMode, isCalibratedCameraActive, rendererSize.height, rendererSize.width]);

  useEffect(() => {
    if (!isCalibratedCameraActive) return;
    objectHandleDragPointerIdRef.current = null;
    calibratedMoveDragPointerIdRef.current = null;
    calibratedMoveGrabOffsetRef.current = null;
    calibratedRotateDragPointerIdRef.current = null;
    calibratedRotateStartTransformRef.current = null;
    calibratedScaleDragPointerIdRef.current = null;
    calibratedScaleStartTransformRef.current = null;
    calibratedLiftDragPointerIdRef.current = null;
    calibratedLiftStartClientPointRef.current = null;
    calibratedLiftStartTransformRef.current = null;
    floorAnchorDragPointerIdRef.current = null;
    setActiveObjectHandleMode(null);
    setIsFloorAnchorDragActive(false);
    setLastCalibratedMoveStatus("none");
    setLastCalibratedRotateStatus("none");
    setLastCalibratedRotateDeltaDeg(null);
    setLastCalibratedScaleStatus("none");
    setLastCalibratedScaleMultiplier(null);
    setLastCalibratedLiftStatus("none");
    setLastCalibratedLiftDeltaY(null);
  }, [isCalibratedCameraActive]);

  // Phase 2I-A: component-teardown safety net for calibrated Rotate drag state.
  // MOVE relies on refs being garbage-collected on unmount; this mirrors that for
  // Rotate (and Phase 2I-B1 Scale) without touching any MOVE teardown path.
  useEffect(() => {
    return () => {
      calibratedRotateDragPointerIdRef.current = null;
      calibratedRotateStartTransformRef.current = null;
      calibratedScaleDragPointerIdRef.current = null;
      calibratedScaleStartTransformRef.current = null;
      calibratedLiftDragPointerIdRef.current = null;
      calibratedLiftStartClientPointRef.current = null;
      calibratedLiftStartTransformRef.current = null;
    };
  }, []);

  // Phase 2I-B1 / 2I-C1: disabling auto-normalization mid-gesture invalidates the
  // grounded eligibility, so any in-flight calibrated Scale or Lift drag must stop
  // immediately.
  useEffect(() => {
    if (autoNormalizeBoundsEnabled) return;
    if (calibratedScaleDragPointerIdRef.current !== null) {
      const pointerId = calibratedScaleDragPointerIdRef.current;
      try {
        floorOverlayRef.current?.releasePointerCapture(pointerId);
      } catch {
        // Ignore release failures when capture is already cleared.
      }
      calibratedScaleDragPointerIdRef.current = null;
      calibratedScaleStartTransformRef.current = null;
      setLastCalibratedScaleStatus("none");
    }
    if (calibratedLiftDragPointerIdRef.current !== null) {
      const pointerId = calibratedLiftDragPointerIdRef.current;
      try {
        floorOverlayRef.current?.releasePointerCapture(pointerId);
      } catch {
        // Ignore release failures when capture is already cleared.
      }
      calibratedLiftDragPointerIdRef.current = null;
      calibratedLiftStartClientPointRef.current = null;
      calibratedLiftStartTransformRef.current = null;
      setLastCalibratedLiftStatus("none");
    }
  }, [autoNormalizeBoundsEnabled]);

  useEffect(() => {
    if (isObject2DHandlesEnabled) return;
    const pointerId = objectHandleDragPointerIdRef.current;
    if (pointerId !== null) {
      try {
        floorOverlayRef.current?.releasePointerCapture(pointerId);
      } catch {
        // Ignore release failures when capture is already cleared.
      }
    }
    objectHandleDragPointerIdRef.current = null;
    setActiveObjectHandleMode(null);
    setWasLastObjectHandleMoveRejected(false);
    setLastObjectHandleRotateDeltaDeg(null);
    setLastObjectHandleScaleMultiplier(null);
    setLastObjectHandleHeightDeltaYUnits(null);
  }, [isObject2DHandlesEnabled]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(LOCAL_DRAFT_STORAGE_KEY);
      if (!stored) {
        setLocalDraftLastSavedAt(null);
        return;
      }
      const parsed = JSON.parse(stored);
      const exportedAtRaw =
        typeof parsed === "object" && parsed !== null
          ? (parsed as Record<string, unknown>).exportedAt
          : null;
      if (
        typeof exportedAtRaw === "string" &&
        exportedAtRaw.trim().length > 0
      ) {
        setLocalDraftLastSavedAt(exportedAtRaw);
        return;
      }
      setLocalDraftLastSavedAt(null);
    } catch {
      setLocalDraftLastSavedAt(null);
    }
  }, []);

  const applyPlacementTransform = () => {
    const placementGroup = placementGroupRef.current;
    if (!placementGroup) return;
    const currentTransform = transformRef.current;
    placementGroup.position.set(currentTransform.positionX, currentTransform.positionY, currentTransform.positionZ);
    const finalRotationDeg = currentTransform.rotationYDeg + autoRotateOffsetDegRef.current;
    placementGroup.rotation.y = THREE.MathUtils.degToRad(finalRotationDeg);
    placementGroup.scale.setScalar(
      getEffectiveObjectScale(
        currentTransform.uniformScale,
        lastAcceptedFloorClickRef.current,
        perspectiveDepthScalingRef.current
      )
    );
  };

  const applyModelNormalization = () => {
    const modelNormalizationGroup = modelNormalizationGroupRef.current;
    if (!modelNormalizationGroup) return;
    const currentNormalization = modelNormalizationRef.current;
    modelNormalizationGroup.position.set(0, currentNormalization.modelYOffset, 0);
    modelNormalizationGroup.rotation.y = THREE.MathUtils.degToRad(currentNormalization.modelYawOffsetDeg);
    modelNormalizationGroup.scale.setScalar(currentNormalization.modelScaleMultiplier);
  };

  const applyAutoBoundsNormalization = () => {
    const autoBoundsGroup = autoBoundsGroupRef.current;
    if (!autoBoundsGroup) return;
    const info = lastAutoBoundsRef.current;
    autoBoundsGroup.rotation.set(0, 0, 0);
    if (autoNormalizeBoundsEnabledRef.current && info && info.ok) {
      autoBoundsGroup.scale.setScalar(info.scale);
      autoBoundsGroup.position.set(info.offset.x, info.offset.y, info.offset.z);
    } else {
      autoBoundsGroup.scale.setScalar(1);
      autoBoundsGroup.position.set(0, 0, 0);
    }
  };

  const updateTransformState = (
    updater: TransformStateUpdater,
    options?: { markOwned?: boolean }
  ) => {
    if (options?.markOwned) {
      transformOwnedRef.current = true;
    }
    setTransform((prev) => {
      const next = typeof updater === "function" ? (updater as (prev: TransformState) => TransformState)(prev) : updater;
      transformRef.current = next;
      return next;
    });
  };

  useEffect(() => {
    applyPlacementTransform();
  }, [transform, autoRotateEnabled, lastAcceptedFloorClick, perspectiveDepthScaling]);

  useEffect(() => {
    applyModelNormalization();
  }, [modelNormalization]);

  useEffect(() => {
    autoNormalizeBoundsEnabledRef.current = autoNormalizeBoundsEnabled;
    applyAutoBoundsNormalization();
  }, [autoNormalizeBoundsEnabled]);

  const currentDepthScaleMultiplier = useMemo(
    () => getDepthScaleMultiplier(lastAcceptedFloorClick?.y ?? null, perspectiveDepthScaling),
    [lastAcceptedFloorClick?.y, perspectiveDepthScaling]
  );

  const currentEffectiveObjectScale = useMemo(
    () => getEffectiveObjectScale(transform.uniformScale, lastAcceptedFloorClick, perspectiveDepthScaling),
    [lastAcceptedFloorClick, perspectiveDepthScaling, transform.uniformScale]
  );
  const calibratedDepthScalingStatus = useMemo(() => {
    if (!isCalibratedCameraActive) return "not active";
    if (!preCalibratedDepthScalingRef.current) return "neutralized (no restore snapshot)";
    if (perspectiveDepthScaling.enabled) {
      return "manual override while calibrated — will restore pre-calibrated state on revert";
    }
    return "neutralized — will restore on revert";
  }, [isCalibratedCameraActive, perspectiveDepthScaling.enabled]);

  const isModelNormalizationAdjusted = useMemo(
    () =>
      Math.abs(modelNormalization.modelYOffset - DEFAULT_MODEL_NORMALIZATION.modelYOffset) > 0.0001 ||
      Math.abs(modelNormalization.modelYawOffsetDeg - DEFAULT_MODEL_NORMALIZATION.modelYawOffsetDeg) > 0.0001 ||
      Math.abs(modelNormalization.modelScaleMultiplier - DEFAULT_MODEL_NORMALIZATION.modelScaleMultiplier) > 0.0001,
    [modelNormalization.modelScaleMultiplier, modelNormalization.modelYOffset, modelNormalization.modelYawOffsetDeg]
  );

  const { isValid: isDepthNearFarOrderValid, warning: depthNearFarOrderingWarning } =
    getDepthNearFarOrderingInfo(perspectiveDepthScaling);
  const currentActiveObjectType = toSceneActiveObjectType(activeObjectKind);
  const isFloorAnchorDragEffectivelyEnabled = isFloorAnchorDragEnabled && !isCalibratedCameraActive;
  const isObject2DHandlesEffectivelyEnabled = isObject2DHandlesEnabled && !isCalibratedCameraActive;
  const floorInteractionModeSummary = isFloorClickPlacementEnabled
    ? isFloorAnchorDragEffectivelyEnabled
      ? isObject2DHandlesEffectivelyEnabled
        ? "place + drag-anchor + object-handle"
        : "place + drag-anchor"
      : isObject2DHandlesEffectivelyEnabled
        ? "place + object-handle"
      : "place"
    : isFloorAnchorDragEffectivelyEnabled
      ? isObject2DHandlesEffectivelyEnabled
        ? "drag-anchor + object-handle"
        : "drag-anchor"
      : isObject2DHandlesEffectivelyEnabled
        ? "object-handle"
        : "none";

  const homographyDebug = useMemo(() => {
    const rows: { label: string; value: string }[] = [];
    let gridPolylinesNorm: FloorPoint[][] = [];
    const frameSize: ImageFrameSize | null =
      rendererSize.width > 0 && rendererSize.height > 0
        ? { width: rendererSize.width, height: rendererSize.height }
        : null;
    let orderedCornersNorm: [FloorPoint, FloorPoint, FloorPoint, FloorPoint] | null = null;
    let cornerOrderStatus: "ok" | "fail" = "fail";
    let cornerOrderConfidence: "high" | "low" | null = null;
    let homographySolveStatus: "ok" | "fail" = "fail";
    let placementFallbackReason = "homography solve not attempted";
    let homographyMatrixForPlacement: HomographyMatrix | null = null;

    rows.push({
      label: "homography diagnostic",
      value: "diagnostic only (not applied)",
    });
    rows.push({
      label: "homography frame px",
      value: frameSize ? `${frameSize.width} x ${frameSize.height}` : "unavailable",
    });
    rows.push({
      label: "homography floor rect",
      value: `width=${formatNumber(floorMapping.worldWidth)}, depth=${formatNumber(floorMapping.worldDepth)}`,
    });

    if (floorPolygon.length !== 4) {
      rows.push({
        label: "homography corner order",
        value: `fail (expected 4 points, got ${floorPolygon.length})`,
      });
      placementFallbackReason = `floor polygon requires 4 points (got ${floorPolygon.length})`;
      return {
        rows,
        orderedCornersNorm,
        gridPolylinesNorm,
        frameSize,
        cornerOrderStatus,
        cornerOrderConfidence,
        homographySolveStatus,
        placementFallbackReason,
        homographyMatrixForPlacement,
      };
    }

    const orderedCornersResult = orderFloorCorners(floorPolygon);
    if (!orderedCornersResult.ok) {
      rows.push({
        label: "homography corner order",
        value: `fail (${orderedCornersResult.reason})`,
      });
      placementFallbackReason = `corner ordering failed: ${orderedCornersResult.reason}`;
      return {
        rows,
        orderedCornersNorm,
        gridPolylinesNorm,
        frameSize,
        cornerOrderStatus,
        cornerOrderConfidence,
        homographySolveStatus,
        placementFallbackReason,
        homographyMatrixForPlacement,
      };
    }
    cornerOrderStatus = "ok";
    cornerOrderConfidence = orderedCornersResult.confidence;
    orderedCornersNorm = orderedCornersResult.value.asArray;

    rows.push({
      label: "homography corner order",
      value: `ok (${orderedCornersResult.confidence})${
        orderedCornersResult.note ? ` — ${orderedCornersResult.note}` : ""
      }`,
    });
    rows.push({
      label: "homography corners NL/NR/FR/FL",
      value: orderedCornersResult.value.asArray
        .map((point, index) => {
          const label = index === 0 ? "NL" : index === 1 ? "NR" : index === 2 ? "FR" : "FL";
          return `${label}(${formatNumber(point.x)},${formatNumber(point.y)})`;
        })
        .join(" "),
    });

    if (!frameSize) {
      rows.push({
        label: "homography solve",
        value: "fail (frame pixel size unavailable)",
      });
      placementFallbackReason = "frame size unavailable";
      return {
        rows,
        orderedCornersNorm,
        gridPolylinesNorm,
        frameSize,
        cornerOrderStatus,
        cornerOrderConfidence,
        homographySolveStatus,
        placementFallbackReason,
        homographyMatrixForPlacement,
      };
    }

    const sourceImagePointsPx: { x: number; y: number }[] = [];
    for (const point of orderedCornersResult.value.asArray) {
      const pixels = normToPixels(point, frameSize);
      if (!pixels) {
        rows.push({
          label: "homography solve",
          value: "fail (could not convert corners from normalized -> pixels)",
        });
        placementFallbackReason = "could not convert ordered corners to frame pixels";
        return {
          rows,
          orderedCornersNorm,
          gridPolylinesNorm,
          frameSize,
          cornerOrderStatus,
          cornerOrderConfidence,
          homographySolveStatus,
          placementFallbackReason,
          homographyMatrixForPlacement,
        };
      }
      sourceImagePointsPx.push(pixels);
    }

    const floorRectResult = getFloorRectCorners({
      widthMeters: floorMapping.worldWidth,
      depthMeters: floorMapping.worldDepth,
    });
    if (!floorRectResult.ok) {
      rows.push({
        label: "homography solve",
        value: `fail (${floorRectResult.reason})`,
      });
      placementFallbackReason = `floor rect assumption invalid: ${floorRectResult.reason}`;
      return {
        rows,
        orderedCornersNorm,
        gridPolylinesNorm,
        frameSize,
        cornerOrderStatus,
        cornerOrderConfidence,
        homographySolveStatus,
        placementFallbackReason,
        homographyMatrixForPlacement,
      };
    }

    const targetFloorPoints2D = floorRectResult.value.asArray.map((point) => floorVec3ToPlane2D(point));
    const solveResult = solvePlaneHomography(sourceImagePointsPx, targetFloorPoints2D);
    if (!solveResult.ok) {
      rows.push({
        label: "homography solve",
        value: `fail (${solveResult.reason})`,
      });
      placementFallbackReason = `homography solve failed: ${solveResult.reason}`;
      return {
        rows,
        orderedCornersNorm,
        gridPolylinesNorm,
        frameSize,
        cornerOrderStatus,
        cornerOrderConfidence,
        homographySolveStatus,
        placementFallbackReason,
        homographyMatrixForPlacement,
      };
    }
    homographySolveStatus = "ok";
    homographyMatrixForPlacement = solveResult.value;
    placementFallbackReason = "none";

    rows.push({
      label: "homography solve",
      value: `ok (${solveResult.confidence})${solveResult.note ? ` — ${solveResult.note}` : ""}`,
    });

    const reprojection = computeReprojectionError(
      solveResult.value,
      sourceImagePointsPx,
      targetFloorPoints2D
    );
    if (reprojection.ok) {
      rows.push({
        label: "homography reprojection (target units)",
        value: `avg=${formatNumber(reprojection.value.averageTargetUnits)} max=${formatNumber(
          reprojection.value.maxTargetUnits
        )}`,
      });
      rows.push({
        label: "homography reprojection (source px)",
        value:
          reprojection.value.averageSourcePixels === null || reprojection.value.maxSourcePixels === null
            ? "unavailable"
            : `avg=${formatNumber(reprojection.value.averageSourcePixels)} max=${formatNumber(
                reprojection.value.maxSourcePixels
              )}`,
      });
    } else {
      rows.push({
        label: "homography reprojection",
        value: `fail (${reprojection.reason})`,
      });
    }

    const buildGridPolylinesNorm = (
      inverseHomography: HomographyMatrix,
      renderSize: ImageFrameSize
    ): FloorPoint[][] => {
      const halfWidth = floorMapping.worldWidth / 2;
      const halfDepth = floorMapping.worldDepth / 2;
      const gridLineCount = 7;
      const samplesPerLine = 20;
      const lines: FloorPoint[][] = [];

      const projectFloorToOverlayNorm = (x: number, z: number): FloorPoint | null => {
        const projectedPx = applyHomography(inverseHomography, { x, y: z });
        if (!projectedPx) return null;
        if (!Number.isFinite(projectedPx.x) || !Number.isFinite(projectedPx.y)) return null;
        const normalizedX = projectedPx.x / renderSize.width;
        const normalizedY = projectedPx.y / renderSize.height;
        if (
          !Number.isFinite(normalizedX) ||
          !Number.isFinite(normalizedY) ||
          normalizedX < 0 ||
          normalizedX > 1 ||
          normalizedY < 0 ||
          normalizedY > 1
        ) {
          return null;
        }
        return { x: normalizedX, y: normalizedY };
      };

      const pushLineSegments = (points: FloorPoint[]) => {
        if (points.length >= 2) lines.push(points);
      };

      const sampleGridLine = (
        axis: "x" | "z",
        fixedValue: number,
        variableMin: number,
        variableMax: number
      ) => {
        let currentSegment: FloorPoint[] = [];
        for (let sampleIndex = 0; sampleIndex <= samplesPerLine; sampleIndex += 1) {
          const t = sampleIndex / samplesPerLine;
          const variable = variableMin + (variableMax - variableMin) * t;
          const point =
            axis === "x"
              ? projectFloorToOverlayNorm(fixedValue, variable)
              : projectFloorToOverlayNorm(variable, fixedValue);
          if (!point) {
            pushLineSegments(currentSegment);
            currentSegment = [];
            continue;
          }
          currentSegment.push(point);
        }
        pushLineSegments(currentSegment);
      };

      for (let i = 0; i < gridLineCount; i += 1) {
        const t = i / (gridLineCount - 1);
        const x = -halfWidth + (halfWidth * 2) * t;
        sampleGridLine("x", x, -halfDepth, halfDepth);
      }
      for (let i = 0; i < gridLineCount; i += 1) {
        const t = i / (gridLineCount - 1);
        const z = -halfDepth + (halfDepth * 2) * t;
        sampleGridLine("z", z, -halfWidth, halfWidth);
      }

      return lines;
    };

    if (showHomographyDebugOverlay && frameSize) {
      const inverseHomography = invertHomography(solveResult.value);
      if (inverseHomography) {
        gridPolylinesNorm = buildGridPolylinesNorm(inverseHomography, frameSize);
      }
    }

    if (!lastAcceptedFloorClick) {
      rows.push({
        label: "homography anchor compare",
        value: "no accepted floor anchor",
      });
      return {
        rows,
        orderedCornersNorm,
        gridPolylinesNorm,
        frameSize,
        cornerOrderStatus,
        cornerOrderConfidence,
        homographySolveStatus,
        placementFallbackReason,
        homographyMatrixForPlacement,
      };
    }

    const legacyMapped = mapFloorPointToObjectTransform(lastAcceptedFloorClick, {
      worldWidth: floorMapping.worldWidth,
      worldDepth: floorMapping.worldDepth,
      depthCenterY: floorMapping.depthCenterY,
    });
    rows.push({
      label: "homography anchor legacy X/Z",
      value: `${formatNumber(legacyMapped.positionX)} / ${formatNumber(legacyMapped.positionZ)}`,
    });

    const anchorPixels = normToPixels(lastAcceptedFloorClick, frameSize);
    if (!anchorPixels) {
      rows.push({
        label: "homography anchor mapped X/Z",
        value: "unavailable (anchor pixel conversion failed)",
      });
      return {
        rows,
        orderedCornersNorm,
        gridPolylinesNorm,
        frameSize,
        cornerOrderStatus,
        cornerOrderConfidence,
        homographySolveStatus,
        placementFallbackReason,
        homographyMatrixForPlacement,
      };
    }

    const homographyMapped = applyHomography(solveResult.value, anchorPixels);
    rows.push({
      label: "homography anchor mapped X/Z",
      value: homographyMapped
        ? `${formatNumber(homographyMapped.x)} / ${formatNumber(homographyMapped.y)} (diagnostic only — not applied)`
        : "unavailable (homography apply failed)",
    });

    return {
      rows,
      orderedCornersNorm,
      gridPolylinesNorm,
      frameSize,
      cornerOrderStatus,
      cornerOrderConfidence,
      homographySolveStatus,
      placementFallbackReason,
      homographyMatrixForPlacement,
    };
  }, [
    floorMapping.depthCenterY,
    floorMapping.worldDepth,
    floorMapping.worldWidth,
    floorPolygon,
    lastAcceptedFloorClick,
    rendererSize.height,
    rendererSize.width,
    showHomographyDebugOverlay,
  ]);

  const activeQuadSolvability = useMemo(() => {
    return evaluateQuadSolvability({
      quadNorm: floorPolygon,
      frameSize: homographyDebug.frameSize,
      floorDimensions: {
        worldWidth: floorMapping.worldWidth,
        worldDepth: floorMapping.worldDepth,
      },
      currentVerticalFovDeg: cameraPoseFovYDeg,
      fovScanConfig: { minFovDeg: 20, maxFovDeg: 90, stepDeg: 1 },
      precomputedHomography: {
        orderedCornersNorm: homographyDebug.orderedCornersNorm,
        homographyMatrixForPlacement: homographyDebug.homographyMatrixForPlacement,
        homographySolveStatus: homographyDebug.homographySolveStatus,
        placementFallbackReason: homographyDebug.placementFallbackReason,
      },
    });
  }, [
    cameraPoseFovYDeg,
    floorMapping.worldDepth,
    floorMapping.worldWidth,
    floorPolygon,
    homographyDebug.frameSize,
    homographyDebug.homographyMatrixForPlacement,
    homographyDebug.homographySolveStatus,
    homographyDebug.orderedCornersNorm,
    homographyDebug.placementFallbackReason,
  ]);

  const cameraPoseDebug = useMemo(() => {
    const rows: { label: string; value: string }[] = [];
    let unavailableReason: string | null = null;
    let cornerResidualDiagnostics:
      | {
          perCornerCvResidualPx: (number | null)[] | null;
          perCornerRenderedResidualPx: (number | null)[] | null;
        }
      | null = null;
    let applyCandidate:
      | {
          confidence: "high" | "low";
          cvAvgPx: number;
          cvMaxPx: number;
          displayAvgPx: number | null;
          displayMaxPx: number | null;
          scaleRatio: number;
          diagnosticsSummary: string;
          pose: {
            position: { x: number; y: number; z: number };
            lookAt: { x: number; y: number; z: number };
            up: { x: number; y: number; z: number };
          };
          frameSize: ImageFrameSize;
        }
      | null = null;
    let decomposition:
      | {
          confidence: "high" | "low";
          frameSize: ImageFrameSize;
          cvProjection: {
            rotationPlaneToCv: [number, number, number, number, number, number, number, number, number];
            translationCv: { x: number; y: number; z: number };
          };
          pose: {
            position: { x: number; y: number; z: number };
            lookAt: { x: number; y: number; z: number };
            up: { x: number; y: number; z: number };
          };
        }
      | null = null;
    const makeResult = () => ({ rows, decomposition, applyCandidate, unavailableReason, cornerResidualDiagnostics });
    rows.push({
      label: "camera pose note",
      value: "Debug only — derived pose is not applied to the live Three.js camera.",
    });
    rows.push({
      label: "camera pose FOV",
      value: `${formatNumber(cameraPoseFovYDeg)}deg`,
    });
    if (!activeQuadSolvability.poseAvailable || !activeQuadSolvability.decomposition || !activeQuadSolvability.applyCandidate) {
      unavailableReason = activeQuadSolvability.unavailableReason ?? "camera pose diagnostics unavailable";
      rows.push({
        label: "camera pose diagnostic",
        value: `fail (${unavailableReason})`,
      });
      return makeResult();
    }
    const decompositionData = activeQuadSolvability.decomposition;
    const decompositionDiagnostics = decompositionData.diagnostics;

    rows.push({
      label: "camera pose diagnostic",
      value: `ok (${decompositionData.confidence})${decompositionData.note ? ` — ${decompositionData.note}` : ""}`,
    });
    rows.push({
      label: "camera pose lookAt (derived)",
      value: `${formatNumber(decompositionData.pose.lookAt.x)} / ${formatNumber(decompositionData.pose.lookAt.y)} / ${formatNumber(
        decompositionData.pose.lookAt.z
      )}`,
    });
    rows.push({
      label: "camera pose up (derived)",
      value: `${formatNumber(decompositionData.pose.up.x)} / ${formatNumber(decompositionData.pose.up.y)} / ${formatNumber(
        decompositionData.pose.up.z
      )}`,
    });
    rows.push({
      label: "camera pose position",
      value: `${formatNumber(decompositionData.pose.position.x)} / ${formatNumber(
        decompositionData.pose.position.y
      )} / ${formatNumber(decompositionData.pose.position.z)}`,
    });
    rows.push({
      label: "camera pose height",
      value: formatNumber(decompositionDiagnostics.cameraHeight),
    });
    rows.push({
      label: "camera pose z",
      value: formatNumber(decompositionDiagnostics.cameraZ),
    });
    rows.push({
      label: "camera pose focal px",
      value: formatNumber(decompositionDiagnostics.focalLengthPx),
    });
    rows.push({
      label: "camera pose lambda",
      value: formatNumber(decompositionDiagnostics.lambda),
    });
    rows.push({
      label: "camera pose scale ratio",
      value: formatNumber(decompositionDiagnostics.columnScaleRatio),
    });
    rows.push({
      label: "camera pose scale ratio note",
      value: "Closer to 1 is better; high values suggest floor rect aspect/polygon mismatch.",
    });
    rows.push({
      label: "camera pose determinant",
      value: formatNumber(decompositionDiagnostics.determinant),
    });
    rows.push({
      label: "camera pose orthonormality error",
      value: formatNumber(decompositionDiagnostics.orthonormalityError),
    });
    rows.push({
      label: "camera pose CV reprojection avg px",
      value: formatNumber(decompositionDiagnostics.averageCameraPoseReprojectionPx),
    });
    rows.push({
      label: "camera pose CV reprojection max px",
      value: formatNumber(decompositionDiagnostics.maxCameraPoseReprojectionPx),
    });
    const perCornerRenderedResidualPx = activeQuadSolvability.rendered.perCornerResidualPx;
    const perCornerCvResidualPx = activeQuadSolvability.cv.perCornerResidualPx;
    cornerResidualDiagnostics = {
      perCornerCvResidualPx,
      perCornerRenderedResidualPx,
    };
    rows.push({
      label: "camera pose display reprojection avg px",
      value: activeQuadSolvability.rendered.count > 0 ? formatNumber(activeQuadSolvability.rendered.averagePx ?? 0) : "unavailable",
    });
    rows.push({
      label: "camera pose display reprojection max px",
      value: activeQuadSolvability.rendered.count > 0 ? formatNumber(activeQuadSolvability.rendered.maximumPx ?? 0) : "unavailable",
    });
    rows.push({
      label: "camera pose selected scale sign",
      value: String(decompositionDiagnostics.selectedScaleSign),
    });
    rows.push({
      label: "camera pose normal lift",
      value: "deterministic (-worldY normal)",
    });
    rows.push({
      label: "grid legend",
      value: "homography grid = inverse-H (green), camera pose grid = derived pose projection (cyan, dashed, diagnostic only)",
    });
    rows.push({
      label: "camera pose grid status",
      value:
        decompositionData.confidence === "high"
          ? "eligible to render when homography debug overlay is on"
          : "skipped (low confidence)",
    });

    applyCandidate = {
      confidence: activeQuadSolvability.applyCandidate.confidence,
      cvAvgPx: activeQuadSolvability.applyCandidate.cvAvgPx,
      cvMaxPx: activeQuadSolvability.applyCandidate.cvMaxPx,
      displayAvgPx: activeQuadSolvability.applyCandidate.displayAvgPx,
      displayMaxPx: activeQuadSolvability.applyCandidate.displayMaxPx,
      scaleRatio: activeQuadSolvability.applyCandidate.scaleRatio,
      diagnosticsSummary: `cv avg=${formatNumber(
        activeQuadSolvability.applyCandidate.cvAvgPx
      )} max=${formatNumber(activeQuadSolvability.applyCandidate.cvMaxPx)} scale=${formatNumber(
        activeQuadSolvability.applyCandidate.scaleRatio
      )}`,
      pose: activeQuadSolvability.applyCandidate.pose,
      frameSize: activeQuadSolvability.applyCandidate.frameSize,
    };

    decomposition = {
      confidence: decompositionData.confidence,
      frameSize: decompositionData.frameSize,
      cvProjection: decompositionData.cvProjection,
      pose: decompositionData.pose,
    };

    return makeResult();
  }, [activeQuadSolvability, cameraPoseFovYDeg]);

  const cameraPoseFovScanDebug = useMemo(() => {
    const rows: { label: string; value: string }[] = [];
    const scanMinFov = 20;
    const scanMaxFov = 90;
    const scanStepDeg = activeQuadSolvability.fovScan.sampleStepDeg;
    let bestFov: number | null = null;
    // Phase 2K-A: surface the already-computed scan outputs (no math change) so
    // the user-facing Calibration readiness panel can recommend a lens. This is
    // a presentation-only addition; ranking/selection in scanCameraPoseOverFov is
    // untouched.
    let recommendation: {
      bestFov: number | null;
      bestConfidence: "high" | "low" | null;
      validFovRange: [number, number] | null;
      highConfidenceFovRange: [number, number] | null;
      bestAvgPx: number | null;
      bestMaxPx: number | null;
      validSampleIntervals: [number, number][] | null;
      highConfidenceSampleIntervals: [number, number][] | null;
      validSampleCount: number;
      highConfidenceSampleCount: number;
      sampleCount: number;
      sampleStepDeg: number;
    } = {
      bestFov: null,
      bestConfidence: null,
      validFovRange: null,
      highConfidenceFovRange: null,
      bestAvgPx: null,
      bestMaxPx: null,
      validSampleIntervals: null,
      highConfidenceSampleIntervals: null,
      validSampleCount: 0,
      highConfidenceSampleCount: 0,
      sampleCount: 0,
      sampleStepDeg: scanStepDeg,
    };

    const scanUnavailableReason = activeQuadSolvability.fovScan.unavailableReason;
    if (scanUnavailableReason) {
      rows.push({ label: "camera pose FOV scan", value: `unavailable (${scanUnavailableReason})` });
      return { rows, bestFov, recommendation };
    }
    const scan = activeQuadSolvability.fovScan.scan;
    if (!scan) {
      rows.push({ label: "camera pose FOV scan", value: "unavailable (camera pose scan unavailable)" });
      return { rows, bestFov, recommendation };
    }

    rows.push({
      label: "camera pose FOV scan",
      value: `ok (range ${scanMinFov}-${scanMaxFov} step ${scanStepDeg})`,
    });
    rows.push({
      label: "camera pose scan samples",
      value: `${scan.samples.length} tested, ${scan.validCount} valid, ${scan.highConfidenceCount} high`,
    });
    recommendation = {
      bestFov: scan.bestFovDeg,
      bestConfidence: scan.bestConfidence,
      validFovRange: scan.validFovRange,
      highConfidenceFovRange: scan.highConfidenceFovRange,
      bestAvgPx: scan.bestAvgPx,
      bestMaxPx: scan.bestMaxPx,
      validSampleIntervals: activeQuadSolvability.fovScan.validSampleIntervals,
      highConfidenceSampleIntervals: activeQuadSolvability.fovScan.highConfidenceSampleIntervals,
      validSampleCount: activeQuadSolvability.fovScan.validSampleCount,
      highConfidenceSampleCount: activeQuadSolvability.fovScan.highConfidenceSampleCount,
      sampleCount: activeQuadSolvability.fovScan.sampleCount,
      sampleStepDeg: scanStepDeg,
    };

    if (!scan.ok) {
      const firstFailure = scan.firstFailureReason ?? "all samples failed";
      rows.push({
        label: "camera pose best FOV",
        value: `none (no valid decomposition results — ${firstFailure})`,
      });
      return { rows, bestFov, recommendation };
    }

    bestFov = scan.bestFovDeg;

    const formatRange = (range: [number, number] | null) =>
      range === null ? "none" : `${range[0]}deg-${range[1]}deg`;

    rows.push({
      label: "camera pose best FOV",
      value: `${scan.bestFovDeg}deg (${scan.bestConfidence})`,
    });
    rows.push({
      label: "camera pose best reprojection",
      value: `avg=${formatNumber(scan.bestAvgPx ?? 0)} max=${formatNumber(scan.bestMaxPx ?? 0)}`,
    });
    rows.push({
      label: "camera pose best scale ratio",
      value: formatNumber(scan.bestScaleRatio ?? 0),
    });
    rows.push({
      label: "camera pose valid FOV range",
      value: formatRange(scan.validFovRange),
    });
    rows.push({
      label: "camera pose high-confidence FOV range",
      value: formatRange(scan.highConfidenceFovRange),
    });

    return { rows, bestFov, recommendation };
  }, [activeQuadSolvability]);

  const calibratedCameraApplyStatus = useMemo(() => {
    return evaluateCalibratedCameraApply(cameraPoseDebug.applyCandidate, cameraPoseDebug.unavailableReason);
  }, [cameraPoseDebug.applyCandidate, cameraPoseDebug.unavailableReason]);

  // Phase 2J-B3: deferred calibrated-camera restore. This runs reactively, not
  // in a render loop: while a request is pending it simply waits (no side
  // effects) until the imported image + frame become usable, then makes a single
  // terminal decision and clears the request. A newer import/image change bumps
  // calibrationRestoreRequestIdRef so a superseded request is dropped, never
  // applied. Calibrated mode is only ever activated here through the same fresh
  // candidate + apply path used by the manual button.
  useEffect(() => {
    const pending = pendingCalibrationRestore;
    if (!pending) return;

    // Cancellation guard: a newer import/image change invalidated this request.
    if (pending.requestId !== calibrationRestoreRequestIdRef.current) {
      setPendingCalibrationRestore(null);
      return;
    }

    const finish = (status: string) => {
      setPendingCalibrationRestore(null);
      setCalibratedRestoreStatus(status);
    };

    if (roomImageUrl.trim().length === 0) {
      finish("Calibration not restored: imported scene has no room image.");
      return;
    }
    if (imageLoadState === "error") {
      finish("Calibration not restored: room image failed to load.");
      return;
    }

    // Not ready yet — wait for the image to finish loading, ensure that the
    // loaded-image identity matches the current URL, and require valid
    // intrinsic dimensions.
    const roomImageUrlTrimmed = roomImageUrl.trim();
    if (imageLoadState !== "loaded") return;
    if (!roomImageUrlTrimmed || loadedImageUrl !== roomImageUrlTrimmed) return;
    if (!hasValidIntrinsicDimensions(imageIntrinsicSize)) {
      finish("Calibration not restored: current intrinsic image dimensions unavailable.");
      return;
    }
    const hasUsableFrame =
      Number.isFinite(rendererSize.width) &&
      Number.isFinite(rendererSize.height) &&
      rendererSize.width > 0 &&
      rendererSize.height > 0;
    if (!hasUsableFrame) return;

    // The persisted FOV assumption must already be synced into the solver input
    // before the derived candidate can be trusted as a fresh re-solve.
    const persistedFovDeg = clampValue(
      pending.calibration.intrinsics.verticalFovDeg,
      CALIBRATED_SCENE_STATE_MIN_VERTICAL_FOV_DEG,
      CALIBRATED_SCENE_STATE_MAX_VERTICAL_FOV_DEG
    );
    if (cameraPoseFovYDeg !== persistedFovDeg) {
      setCameraPoseFovYDeg(persistedFovDeg);
      return;
    }

    // ----- Terminal decision: clear the pending request exactly once. -----

    // PositionY below the resting floor blocks calibrated mode (generic
    // transform is still restored).
    if (transform.positionY < -CALIBRATED_LIFT_RESTING_SNAP_EPSILON) {
      finish("Calibration blocked: imported object sits below the calibrated floor.");
      return;
    }

    // Provenance + aspect compatibility (trimmed URL / intrinsic dims / persisted
    // vs. current frame aspect, using the existing aspect thresholds).
    const compat = evaluateCalibrationRestoreCompatibility({
      calibration: pending.calibration,
      currentRoomImageUrl: roomImageUrlTrimmed,
      currentIntrinsicWidth: imageIntrinsicSize.width,
      currentIntrinsicHeight: imageIntrinsicSize.height,
      currentFrameAspect: rendererSize.width / rendererSize.height,
      aspectWarnDeltaPercent: CALIBRATED_CAMERA_STALE_WARN_ASPECT_DELTA_PERCENT,
      aspectAutoRevertDeltaPercent: CALIBRATED_CAMERA_AUTO_REVERT_ASPECT_DELTA_PERCENT,
    });
    if (!compat.ok) {
      finish(`Calibration not restored: ${compat.reason}`);
      return;
    }

    // Fresh solve must clear the existing calibrated-camera apply safety gates.
    const candidate = cameraPoseDebug.applyCandidate;
    if (!candidate || !calibratedCameraApplyStatus.available) {
      const reason = candidate
        ? calibratedCameraApplyStatus.reason
        : cameraPoseDebug.unavailableReason ?? "no pose candidate";
      finish(`Calibration not restored: re-solve/apply gate failed (${reason}).`);
      return;
    }

    applyCalibratedCameraSnapshotFromCandidate(candidate, persistedFovDeg);
    finish(
      compat.warning
        ? `Calibrated camera restored (warning: ${compat.warning}).`
        : "Calibrated camera restored from imported scene."
    );
  }, [
    pendingCalibrationRestore,
    roomImageUrl,
    loadedImageUrl,
    imageLoadState,
    imageIntrinsicSize,
    rendererSize.width,
    rendererSize.height,
    cameraPoseFovYDeg,
    transform.positionY,
    cameraPoseDebug.applyCandidate,
    cameraPoseDebug.unavailableReason,
    calibratedCameraApplyStatus.available,
    calibratedCameraApplyStatus.reason,
    hasValidIntrinsicDimensions,
    applyCalibratedCameraSnapshotFromCandidate,
  ]);

  const cameraPoseGridPolylinesNorm = useMemo(() => {
    if (!showHomographyDebugOverlay) return [] as FloorPoint[][];
    if (!cameraPoseDebug.decomposition) return [] as FloorPoint[][];
    if (cameraPoseDebug.decomposition.confidence !== "high") return [] as FloorPoint[][];

    const decomposition = cameraPoseDebug.decomposition;
    const renderSize = decomposition.frameSize;
    const halfWidth = floorMapping.worldWidth / 2;
    const halfDepth = floorMapping.worldDepth / 2;
    const gridLineCount = 7;
    const samplesPerLine = 20;
    const lines: FloorPoint[][] = [];

    const projectFloorToOverlayNorm = (x: number, z: number): FloorPoint | null => {
      const projected = projectFloorPointThroughCameraPoseCv(
        decomposition.cvProjection,
        renderSize,
        { verticalFovDeg: cameraPoseFovYDeg },
        { x, y: z }
      );
      if (!projected.ok) return null;
      if (!Number.isFinite(projected.value.x) || !Number.isFinite(projected.value.y)) return null;
      const normalizedX = projected.value.x / renderSize.width;
      const normalizedY = projected.value.y / renderSize.height;
      if (
        !Number.isFinite(normalizedX) ||
        !Number.isFinite(normalizedY) ||
        normalizedX < 0 ||
        normalizedX > 1 ||
        normalizedY < 0 ||
        normalizedY > 1
      ) {
        return null;
      }
      return { x: normalizedX, y: normalizedY };
    };

    const pushLineSegments = (points: FloorPoint[]) => {
      if (points.length >= 2) lines.push(points);
    };

    const sampleGridLine = (
      axis: "x" | "z",
      fixedValue: number,
      variableMin: number,
      variableMax: number
    ) => {
      let currentSegment: FloorPoint[] = [];
      for (let sampleIndex = 0; sampleIndex <= samplesPerLine; sampleIndex += 1) {
        const t = sampleIndex / samplesPerLine;
        const variable = variableMin + (variableMax - variableMin) * t;
        const point =
          axis === "x"
            ? projectFloorToOverlayNorm(fixedValue, variable)
            : projectFloorToOverlayNorm(variable, fixedValue);
        if (!point) {
          pushLineSegments(currentSegment);
          currentSegment = [];
          continue;
        }
        currentSegment.push(point);
      }
      pushLineSegments(currentSegment);
    };

    for (let i = 0; i < gridLineCount; i += 1) {
      const t = i / (gridLineCount - 1);
      const x = -halfWidth + (halfWidth * 2) * t;
      sampleGridLine("x", x, -halfDepth, halfDepth);
    }
    for (let i = 0; i < gridLineCount; i += 1) {
      const t = i / (gridLineCount - 1);
      const z = -halfDepth + (halfDepth * 2) * t;
      sampleGridLine("z", z, -halfWidth, halfWidth);
    }

    return lines;
  }, [
    cameraPoseDebug.decomposition,
    cameraPoseFovYDeg,
    floorMapping.worldDepth,
    floorMapping.worldWidth,
    showHomographyDebugOverlay,
  ]);

  const calibratedCameraFrameMatchStatus = useMemo(() => {
    if (lastCalibratedCameraAutoRevertReason && !isCalibratedCameraActive && !calibratedCameraSnapshot) {
      return {
        value: lastCalibratedCameraAutoRevertReason,
        diagnostics: null as FrameMatchDiagnostics | null,
      };
    }
    if (!isCalibratedCameraActive || !calibratedCameraSnapshot) {
      return {
        value: "none",
        diagnostics: null as FrameMatchDiagnostics | null,
      };
    }
    const diagnostics = computeFrameMatchDiagnostics(calibratedCameraSnapshot.frameSize, rendererSize);
    if (!diagnostics) {
      return {
        value: "unavailable (invalid frame size)",
        diagnostics: null as FrameMatchDiagnostics | null,
      };
    }
    if (diagnostics.isWarningStale) {
      return {
        value: `stale — re-apply recommended (dw=${formatNumber(diagnostics.widthDeltaPercent)}%, dh=${formatNumber(
          diagnostics.heightDeltaPercent
        )}%, da=${formatNumber(diagnostics.aspectDeltaPercent)}%)`,
        diagnostics,
      };
    }
    return {
      value: `ok (dw=${formatNumber(diagnostics.widthDeltaPercent)}%, dh=${formatNumber(
        diagnostics.heightDeltaPercent
      )}%, da=${formatNumber(diagnostics.aspectDeltaPercent)}%)`,
      diagnostics,
    };
  }, [
    calibratedCameraSnapshot,
    isCalibratedCameraActive,
    lastCalibratedCameraAutoRevertReason,
    rendererSize,
  ]);

  // Phase 2K-A: user-facing calibration readiness. This is a PRESENTATION layer
  // only — it reads existing diagnostics (cameraPoseDebug.applyCandidate, the FOV
  // scan recommendation, homography status, and frame-match status) and the same
  // apply-gate constants to explain state. It never recomputes or relaxes any
  // gate; the single source of truth for apply-ability remains
  // calibratedCameraApplyStatus.available.
  const calibrationReadiness = useMemo(() => {
    const candidate = cameraPoseDebug.applyCandidate;
    const scan = cameraPoseFovScanDebug.recommendation;
    const recommendedFov = scan.bestFov;
    const apply = calibratedCameraApplyStatus;

    type ReadinessState = "pass" | "attention" | "fail" | "idle";
    const checklist: { key: string; label: string; state: ReadinessState; detail: string }[] = [];
    const formatMetricPx = (value: number | null) =>
      value !== null && Number.isFinite(value) ? `${formatNumber(value)} px` : "Unavailable";
    const readinessMetrics =
      candidate
        ? {
            cvAvgPx: candidate.cvAvgPx,
            cvMaxPx: candidate.cvMaxPx,
            displayAvgPx: candidate.displayAvgPx,
            displayMaxPx: candidate.displayMaxPx,
            avgDeltaPx: activeQuadSolvability.delta.averagePx,
            maxDeltaPx: activeQuadSolvability.delta.maximumPx,
          }
        : null;
    const worstCvCorner = activeQuadSolvability.worstCorner.cv;
    const worstRenderedCorner = activeQuadSolvability.worstCorner.rendered;
    const largestPerCornerDifference = activeQuadSolvability.worstCorner.difference;
    const firstFailingGate = apply.firstFailingGate;

    // Floor shape (homography validity / corner ordering confidence).
    if (homographyDebug.homographySolveStatus === "ok") {
      checklist.push(
        homographyDebug.cornerOrderConfidence === "low"
          ? {
              key: "floor-shape",
              label: "Floor shape",
              state: "attention",
              detail: "floor outline looks weak or non-convex — check the four corners do not cross",
            }
          : {
              key: "floor-shape",
              label: "Floor shape",
              state: "pass",
              detail: "four corners form a valid floor outline",
            }
      );
    } else {
      checklist.push({
        key: "floor-shape",
        label: "Floor shape",
        state: "fail",
        detail: "adjust the four floor corners so they outline one flat floor area and do not cross",
      });
    }

    // Floor dimensions (world width/depth used together with corners).
    checklist.push({
      key: "floor-dimensions",
      label: "Floor dimensions",
      state: "pass",
      detail: `${formatNumber(floorMapping.worldWidth)} x ${formatNumber(
        floorMapping.worldDepth
      )} m (width x depth) — used with the corners for the recommendation`,
    });

    // Camera fit (confidence + scale ratio + CV reprojection apply gates).
    if (!candidate) {
      checklist.push({
        key: "camera-fit",
        label: "Camera fit (CV reprojection)",
        state: recommendedFov === null ? "fail" : "attention",
        detail:
          recommendedFov === null
            ? "no valid camera fit yet — fix the floor shape, then it will recompute"
            : "use the recommended FOV to evaluate camera fit",
      });
    } else if (candidate.confidence !== "high") {
      checklist.push({
        key: "camera-fit",
        label: "Camera fit (CV reprojection)",
        state: "attention",
        detail: `Average: ${formatMetricPx(candidate.cvAvgPx)} · Maximum: ${formatMetricPx(candidate.cvMaxPx)} · confidence is low at this FOV — use the recommended FOV`,
      });
    } else if (
      candidate.scaleRatio < CALIBRATED_CAMERA_APPLY_MIN_SCALE_RATIO ||
      candidate.scaleRatio > CALIBRATED_CAMERA_APPLY_MAX_SCALE_RATIO
    ) {
      checklist.push({
        key: "camera-fit",
        label: "Camera fit (CV reprojection)",
        state: "fail",
        detail: `Average: ${formatMetricPx(candidate.cvAvgPx)} · Maximum: ${formatMetricPx(candidate.cvMaxPx)} · scale ratio ${formatNumber(candidate.scaleRatio)} — needs ${CALIBRATED_CAMERA_APPLY_MIN_SCALE_RATIO}-${CALIBRATED_CAMERA_APPLY_MAX_SCALE_RATIO}. Check that floor width and depth describe the same floor area with a realistic proportion`,
      });
    } else if (candidate.cvAvgPx >= CALIBRATED_CAMERA_APPLY_MAX_CV_AVG_PX) {
      checklist.push({
        key: "camera-fit",
        label: "Camera fit (CV reprojection)",
        state: "fail",
        detail: `Average: ${formatMetricPx(candidate.cvAvgPx)} · Maximum: ${formatMetricPx(candidate.cvMaxPx)} · needs under ${formatNumber(CALIBRATED_CAMERA_APPLY_MAX_CV_AVG_PX)} px average. Refine the floor corners and re-check calibration`,
      });
    } else if (candidate.cvMaxPx >= CALIBRATED_CAMERA_APPLY_MAX_CV_MAX_PX) {
      checklist.push({
        key: "camera-fit",
        label: "Camera fit (CV reprojection)",
        state: "fail",
        detail: `Average: ${formatMetricPx(candidate.cvAvgPx)} · Maximum: ${formatMetricPx(candidate.cvMaxPx)} · needs under ${formatNumber(CALIBRATED_CAMERA_APPLY_MAX_CV_MAX_PX)} px maximum. Refine the floor corners and re-check calibration`,
      });
    } else {
      checklist.push({
        key: "camera-fit",
        label: "Camera fit (CV reprojection)",
        state: "pass",
        detail: `Average: ${formatMetricPx(candidate.cvAvgPx)} · Maximum: ${formatMetricPx(candidate.cvMaxPx)}`,
      });
    }

    // Rendered-camera reprojection (display reprojection apply gates).
    if (!candidate) {
      checklist.push({
        key: "rendered-camera-reprojection",
        label: "Rendered-camera reprojection",
        state: recommendedFov === null ? "fail" : "attention",
        detail:
          recommendedFov === null
            ? "Average: Unavailable · Maximum: Unavailable — no projection to compare yet; fix the floor shape, then it will recompute"
            : "Average: Unavailable · Maximum: Unavailable — use the recommended FOV to evaluate rendered-camera reprojection",
      });
    } else if (!readinessMetrics || readinessMetrics.displayAvgPx === null || readinessMetrics.displayMaxPx === null) {
      checklist.push({
        key: "rendered-camera-reprojection",
        label: "Rendered-camera reprojection",
        state: "attention",
        detail: "Average: Unavailable · Maximum: Unavailable — rendered-camera diagnostics unavailable at this FOV; use the recommended FOV",
      });
    } else if (
      readinessMetrics.displayAvgPx >= CALIBRATED_CAMERA_APPLY_MAX_DISPLAY_AVG_PX ||
      readinessMetrics.displayMaxPx >= CALIBRATED_CAMERA_APPLY_MAX_DISPLAY_MAX_PX
    ) {
      checklist.push({
        key: "rendered-camera-reprojection",
        label: "Rendered-camera reprojection",
        state: "fail",
        detail: `Average: ${formatMetricPx(readinessMetrics.displayAvgPx)} · Maximum: ${formatMetricPx(readinessMetrics.displayMaxPx)} · needs under ${formatNumber(
          readinessMetrics.displayAvgPx >= CALIBRATED_CAMERA_APPLY_MAX_DISPLAY_AVG_PX
            ? CALIBRATED_CAMERA_APPLY_MAX_DISPLAY_AVG_PX
            : CALIBRATED_CAMERA_APPLY_MAX_DISPLAY_MAX_PX
        )} px on the failing aggregate. Refine floor corners and use the recommended FOV`,
      });
    } else {
      checklist.push({
        key: "rendered-camera-reprojection",
        label: "Rendered-camera reprojection",
        state: "pass",
        detail: `Average: ${formatMetricPx(readinessMetrics.displayAvgPx)} · Maximum: ${formatMetricPx(readinessMetrics.displayMaxPx)}`,
      });
    }

    // CV ↔ rendered-camera difference (display/CV delta apply gates).
    if (!candidate) {
      checklist.push({
        key: "cv-rendered-difference",
        label: "CV ↔ rendered-camera difference",
        state: recommendedFov === null ? "fail" : "attention",
        detail:
          recommendedFov === null
            ? "Average: Unavailable · Maximum: Unavailable — no projection to compare yet; fix the floor shape, then it will recompute"
            : "Average: Unavailable · Maximum: Unavailable — use the recommended FOV to evaluate CV ↔ rendered-camera difference",
      });
    } else if (!readinessMetrics || readinessMetrics.avgDeltaPx === null || readinessMetrics.maxDeltaPx === null) {
      checklist.push({
        key: "cv-rendered-difference",
        label: "CV ↔ rendered-camera difference",
        state: "attention",
        detail: "Average: Unavailable · Maximum: Unavailable — CV ↔ rendered-camera diagnostics unavailable at this FOV; use the recommended FOV",
      });
    } else if (readinessMetrics.avgDeltaPx > CALIBRATED_CAMERA_APPLY_MAX_AVG_DELTA_PX) {
      checklist.push({
        key: "cv-rendered-difference",
        label: "CV ↔ rendered-camera difference",
        state: "fail",
        detail: `Average: ${formatMetricPx(readinessMetrics.avgDeltaPx)} · Maximum: ${formatMetricPx(
          readinessMetrics.maxDeltaPx
        )} · needs under ${formatNumber(CALIBRATED_CAMERA_APPLY_MAX_AVG_DELTA_PX)} px average difference. Refine floor corners and use the recommended FOV`,
      });
    } else if (readinessMetrics.maxDeltaPx > CALIBRATED_CAMERA_APPLY_MAX_MAX_DELTA_PX) {
      checklist.push({
        key: "cv-rendered-difference",
        label: "CV ↔ rendered-camera difference",
        state: "fail",
        detail: `Average: ${formatMetricPx(readinessMetrics.avgDeltaPx)} · Maximum: ${formatMetricPx(
          readinessMetrics.maxDeltaPx
        )} · needs under ${formatNumber(CALIBRATED_CAMERA_APPLY_MAX_MAX_DELTA_PX)} px maximum difference. Refine floor corners and use the recommended FOV`,
      });
    } else {
      checklist.push({
        key: "cv-rendered-difference",
        label: "CV ↔ rendered-camera difference",
        state: "pass",
        detail: `Average: ${formatMetricPx(readinessMetrics.avgDeltaPx)} · Maximum: ${formatMetricPx(
          readinessMetrics.maxDeltaPx
        )}`,
      });
    }

    // Frame readiness (frame size validity + post-apply staleness warning).
    if (!homographyDebug.frameSize) {
      checklist.push({
        key: "frame-readiness",
        label: "Frame readiness",
        state: "fail",
        detail: "room view size unavailable — keep the room visible",
      });
    } else if (candidate && (candidate.frameSize.width <= 0 || candidate.frameSize.height <= 0)) {
      checklist.push({
        key: "frame-readiness",
        label: "Frame readiness",
        state: "fail",
        detail: "frame size is invalid for calibration",
      });
    } else if (isCalibratedCameraActive && calibratedCameraFrameMatchStatus.diagnostics?.isWarningStale) {
      checklist.push({
        key: "frame-readiness",
        label: "Frame readiness",
        state: "attention",
        detail:
          "the room view changed since apply — keep it stable; resizing or changing the image requires calibrating again",
      });
    } else {
      checklist.push({
        key: "frame-readiness",
        label: "Frame readiness",
        state: "pass",
        detail: "room view is stable",
      });
    }

    let overall: "ready" | "adjust" | "none";
    let overallLabel: string;
    if (apply.available) {
      overall = "ready";
      overallLabel = "Ready to apply";
    } else if (recommendedFov === null && !candidate) {
      overall = "none";
      overallLabel = "No valid calibration found";
    } else {
      overall = "adjust";
      overallLabel = "Needs adjustment";
    }

    let recommendationText: string;
    if (recommendedFov !== null) {
      const range = scan.highConfidenceFovRange ?? scan.validFovRange;
      recommendationText =
        range && range[0] !== range[1]
          ? `Recommended lens: ${recommendedFov}° (valid range ${range[0]}°-${range[1]}°)`
          : `Recommended lens: ${recommendedFov}°`;
    } else {
      recommendationText =
        "No usable lens recommendation yet — refine the floor corners or floor dimensions, then it will recompute.";
    }

    // Phase 2K-B: truthful preview-availability flags. These describe whether a
    // preview CAN be shown, independent of the overlay toggle, and are distinct
    // from apply-readiness:
    // - floor-fit (green) viability is the existing homography solve status;
    // - camera-pose (cyan) preview viability is the exact condition that makes
    //   cameraPoseGridPolylinesNorm render (decomposition exists + high confidence);
    // - apply-readiness remains solely calibratedCameraApplyStatus.available.
    const floorFitPreviewAvailable = homographyDebug.homographySolveStatus === "ok";
    const cameraPosePreviewAvailable =
      !!cameraPoseDebug.decomposition && cameraPoseDebug.decomposition.confidence === "high";
    let applyReasonPresentation = apply.reason;
    if (!apply.available && candidate) {
      switch (firstFailingGate) {
        case "cv-avg":
          applyReasonPresentation = `Calibration is not Apply-safe: CV average reprojection is ${formatNumber(candidate.cvAvgPx)} px (limit: ${formatNumber(
            CALIBRATED_CAMERA_APPLY_MAX_CV_AVG_PX
          )} px).`;
          break;
        case "cv-max":
          applyReasonPresentation = `Calibration is not Apply-safe: CV maximum reprojection is ${formatNumber(candidate.cvMaxPx)} px (limit: ${formatNumber(
            CALIBRATED_CAMERA_APPLY_MAX_CV_MAX_PX
          )} px).`;
          break;
        case "display-avg":
          applyReasonPresentation = `Calibration is not Apply-safe: rendered-camera average reprojection is ${formatNumber(
            readinessMetrics!.displayAvgPx!
          )} px (limit: ${formatNumber(CALIBRATED_CAMERA_APPLY_MAX_DISPLAY_AVG_PX)} px).`;
          break;
        case "display-max":
          applyReasonPresentation = `Calibration is not Apply-safe: rendered-camera maximum reprojection is ${formatNumber(
            readinessMetrics!.displayMaxPx!
          )} px (limit: ${formatNumber(CALIBRATED_CAMERA_APPLY_MAX_DISPLAY_MAX_PX)} px).`;
          break;
        case "delta-avg":
          applyReasonPresentation = `Calibration is not Apply-safe: CV↔rendered-camera average difference is ${formatNumber(
            readinessMetrics!.avgDeltaPx!
          )} px (limit: ${formatNumber(CALIBRATED_CAMERA_APPLY_MAX_AVG_DELTA_PX)} px).`;
          break;
        case "delta-max":
          applyReasonPresentation = `Calibration is not Apply-safe: CV↔rendered-camera maximum difference is ${formatNumber(
            readinessMetrics!.maxDeltaPx!
          )} px (limit: ${formatNumber(CALIBRATED_CAMERA_APPLY_MAX_MAX_DELTA_PX)} px).`;
          break;
        default:
          applyReasonPresentation = apply.reason;
          break;
      }
    }
    const formatFovIntervals = (intervals: [number, number][] | null) => {
      if (!intervals) return "Unavailable";
      if (intervals.length === 0) return "None found";
      return intervals
        .map(([start, end]) => (start === end ? `${start}°` : `${start}°–${end}°`))
        .join(", ");
    };
    const fovFallsInIntervals = (fov: number, intervals: [number, number][] | null) =>
      !!intervals && intervals.some(([start, end]) => fov >= start && fov <= end);
    const hasScanSamples = scan.sampleCount > 0;
    const hasValidScanSamples = hasScanSamples && scan.validSampleCount > 0;
    const hasHighConfidenceSamples = hasValidScanSamples && scan.highConfidenceSampleCount > 0;
    const validFovSampleText = hasScanSamples
      ? scan.validSampleCount > 0
        ? `${formatFovIntervals(scan.validSampleIntervals)} (${scan.validSampleCount} of ${scan.sampleCount} sampled FOVs)`
        : "None found"
      : "Unavailable";
    const highConfidenceFovSampleText = hasScanSamples
      ? hasValidScanSamples
        ? scan.highConfidenceSampleCount > 0
          ? `${formatFovIntervals(scan.highConfidenceSampleIntervals)} (${scan.highConfidenceSampleCount} of ${scan.sampleCount} sampled FOVs)`
          : "None found"
        : "Unavailable"
      : "Unavailable";
    const applySafeAtCurrentFovText = hasValidScanSamples
      ? apply.available
        ? `Yes`
        : `No — ${applyReasonPresentation}`
      : "Unavailable";
    const currentFovMembershipText = hasScanSamples
      ? hasValidScanSamples
        ? (() => {
            const currentFovLabel = formatNumber(cameraPoseFovYDeg);
            const withinValid = fovFallsInIntervals(cameraPoseFovYDeg, scan.validSampleIntervals);
            const withinHighConfidence = fovFallsInIntervals(cameraPoseFovYDeg, scan.highConfidenceSampleIntervals);
            if (!withinValid) return `Current FOV: ${currentFovLabel}° — outside valid pose samples.`;
            if (hasHighConfidenceSamples && withinHighConfidence) {
              return `Current FOV: ${currentFovLabel}° — within valid pose and high-confidence samples.`;
            }
            return `Current FOV: ${currentFovLabel}° — within valid pose samples, outside high-confidence samples.`;
          })()
        : "Current FOV: Unavailable"
      : "Current FOV: Unavailable";
    const formatCornerDiagnostic = (entry: { index: number; value: number } | null) =>
      entry ? `${CALIBRATION_CORNER_LABELS[entry.index] ?? "Unavailable"} — ${formatNumber(entry.value)} px` : "Unavailable";
    const largestCvResidualText = `Largest CV residual: ${formatCornerDiagnostic(worstCvCorner)}`;
    const largestRenderedResidualText = `Largest rendered-camera residual: ${formatCornerDiagnostic(worstRenderedCorner)}`;
    const largestDifferenceText = `Largest CV ↔ rendered-camera difference: ${formatCornerDiagnostic(
      largestPerCornerDifference
    )}`;
    let mainBlockingContributorTitle: string;
    let mainBlockingContributorDetail: string | null = null;
    if (apply.available) {
      mainBlockingContributorTitle = "No corner-specific Apply blocker.";
    } else if (firstFailingGate === "cv-max" && worstCvCorner) {
      const label = CALIBRATION_CORNER_LABELS[worstCvCorner.index] ?? "Unavailable";
      mainBlockingContributorTitle = `Worst CV corner: ${label}`;
      mainBlockingContributorDetail = `Residual: ${formatNumber(
        worstCvCorner.value
      )} px. This is the largest CV residual and exceeds the maximum limit of ${formatNumber(
        CALIBRATED_CAMERA_APPLY_MAX_CV_MAX_PX
      )} px.`;
    } else if (firstFailingGate === "display-max" && worstRenderedCorner) {
      const label = CALIBRATION_CORNER_LABELS[worstRenderedCorner.index] ?? "Unavailable";
      mainBlockingContributorTitle = `Worst rendered-camera corner: ${label}`;
      mainBlockingContributorDetail = `Residual: ${formatNumber(
        worstRenderedCorner.value
      )} px. This is the largest rendered-camera residual and exceeds the maximum limit of ${formatNumber(
        CALIBRATED_CAMERA_APPLY_MAX_DISPLAY_MAX_PX
      )} px.`;
    } else {
      mainBlockingContributorTitle = "No single corner is identified for this blocker.";
    }

    return {
      overall,
      overallLabel,
      checklist,
      recommendedFov,
      recommendationText,
      floorFitPreviewAvailable,
      cameraPosePreviewAvailable,
      applyReady: apply.available,
      applyReason: applyReasonPresentation,
      largestCvResidualText,
      largestRenderedResidualText,
      largestDifferenceText,
      differenceDiagnosticNote: "Diagnostic only: Apply limits compare aggregate values, not this per-corner difference.",
      mainBlockingContributorTitle,
      mainBlockingContributorDetail,
      fovScanRangesTitle: `FOV scan ranges (sampled at ${scan.sampleStepDeg}° steps)`,
      validFovSampleText,
      highConfidenceFovSampleText,
      applySafeAtCurrentFovText,
      currentFovMembershipText,
      fovScanApplySafetyNote:
        "Apply-safety is evaluated for the current FOV; scan intervals describe pose availability and confidence only.",
    };
  }, [
    cameraPoseFovYDeg,
    activeQuadSolvability,
    cameraPoseDebug.applyCandidate,
    cameraPoseDebug.decomposition,
    cameraPoseFovScanDebug.recommendation,
    calibratedCameraApplyStatus,
    homographyDebug.homographySolveStatus,
    homographyDebug.cornerOrderConfidence,
    homographyDebug.frameSize,
    calibratedCameraFrameMatchStatus.diagnostics,
    isCalibratedCameraActive,
    floorMapping.worldWidth,
    floorMapping.worldDepth,
  ]);

  // Phase 2K-C: controlled resolver for the one-click Scan & apply action. Runs
  // after render (so cameraPoseDebug / calibratedCameraApplyStatus have already
  // recomputed for the just-applied recommended FOV), then makes a single
  // terminal decision. It applies ONLY via the unchanged apply path + gate, and
  // cancels conservatively. It never retries automatically.
  useEffect(() => {
    if (pendingScanAndApplyFov === null) return;

    // Cancel: recommendation became unavailable or changed (e.g. floor corners /
    // dimensions changed and the scan recomputed a different/no recommendation).
    if (calibrationReadiness.recommendedFov !== pendingScanAndApplyFov) {
      setPendingScanAndApplyFov(null);
      return;
    }
    // Cancel: the manual FOV no longer matches the pending recommendation
    // (manual override, reset, or any state that moved the FOV).
    if (cameraPoseFovYDeg !== pendingScanAndApplyFov) {
      setPendingScanAndApplyFov(null);
      return;
    }
    // Cancel: calibrated mode became active through another path — never
    // double-apply on top of an active calibration.
    if (isCalibratedCameraActive) {
      setPendingScanAndApplyFov(null);
      return;
    }

    const candidate = cameraPoseDebug.applyCandidate;
    if (candidate && calibratedCameraApplyStatus.available) {
      // Clear pending atomically with the single apply attempt so a re-render
      // cannot trigger a second application.
      setPendingScanAndApplyFov(null);
      setScanAndApplyResult({ kind: "applied", fov: pendingScanAndApplyFov });
      applyCalibratedCameraSnapshotFromCandidate(candidate, pendingScanAndApplyFov);
      return;
    }

    // Gate is blocked after the FOV update: do not apply, surface the existing
    // readiness reason, leave calibrated mode inactive.
    setScanAndApplyResult({ kind: "blocked", fov: pendingScanAndApplyFov });
    setPendingScanAndApplyFov(null);
  }, [
    pendingScanAndApplyFov,
    cameraPoseFovYDeg,
    isCalibratedCameraActive,
    calibratedCameraApplyStatus,
    cameraPoseDebug.applyCandidate,
    calibrationReadiness.recommendedFov,
    applyCalibratedCameraSnapshotFromCandidate,
  ]);

  const objectProjectionDiagnostic = useMemo(() => {
    const expectedCameraMode = isCalibratedCameraActive && calibratedCameraSnapshot ? "calibrated" : "legacy";
    const camera = cameraRef.current;
    if (!camera) {
      return {
        status: `camera unavailable (${expectedCameraMode})`,
        projectedNorm: null as FloorPoint | null,
        projectedPx: null as { x: number; y: number } | null,
        anchorNorm: lastAcceptedFloorClick,
        deltaNorm: null as { dx: number; dy: number; distance: number } | null,
        deltaPx: null as { dx: number; dy: number; distance: number } | null,
        largeDelta: false,
      };
    }
    const frameSize: ImageFrameSize = { width: rendererSize.width, height: rendererSize.height };
    const projected = projectWorldPointToOverlayNormalized(camera, frameSize, {
      x: transform.positionX,
      y: transform.positionY,
      z: transform.positionZ,
    });
    if (!projected) {
      return {
        status: "projection unavailable",
        projectedNorm: null as FloorPoint | null,
        projectedPx: null as { x: number; y: number } | null,
        anchorNorm: lastAcceptedFloorClick,
        deltaNorm: null as { dx: number; dy: number; distance: number } | null,
        deltaPx: null as { dx: number; dy: number; distance: number } | null,
        largeDelta: false,
      };
    }
    if (!projected.inFront) {
      return {
        status: "object behind camera",
        projectedNorm: projected.normalized,
        projectedPx: projected.pixels,
        anchorNorm: lastAcceptedFloorClick,
        deltaNorm: null as { dx: number; dy: number; distance: number } | null,
        deltaPx: null as { dx: number; dy: number; distance: number } | null,
        largeDelta: false,
      };
    }
    if (!lastAcceptedFloorClick) {
      return {
        status: projected.isVisibleInView ? "ok (no floor anchor)" : "off-screen (no floor anchor)",
        projectedNorm: projected.normalized,
        projectedPx: projected.pixels,
        anchorNorm: null as FloorPoint | null,
        deltaNorm: null as { dx: number; dy: number; distance: number } | null,
        deltaPx: null as { dx: number; dy: number; distance: number } | null,
        largeDelta: false,
      };
    }
    const deltaNorm = {
      dx: projected.normalized.x - lastAcceptedFloorClick.x,
      dy: projected.normalized.y - lastAcceptedFloorClick.y,
      distance: Math.hypot(projected.normalized.x - lastAcceptedFloorClick.x, projected.normalized.y - lastAcceptedFloorClick.y),
    };
    const deltaPx = {
      dx: deltaNorm.dx * frameSize.width,
      dy: deltaNorm.dy * frameSize.height,
      distance: Math.hypot(deltaNorm.dx * frameSize.width, deltaNorm.dy * frameSize.height),
    };
    const largeDelta =
      deltaPx.distance > PROJECTED_ANCHOR_WARNING_MAX_PIXEL_DISTANCE ||
      deltaNorm.distance > PROJECTED_ANCHOR_WARNING_MAX_NORMALIZED_DISTANCE;
    return {
      status: projected.isVisibleInView ? "ok" : "off-screen",
      projectedNorm: projected.normalized,
      projectedPx: projected.pixels,
      anchorNorm: lastAcceptedFloorClick,
      deltaNorm,
      deltaPx,
      largeDelta,
    };
  }, [
    calibratedCameraSnapshot,
    isCalibratedCameraActive,
    lastAcceptedFloorClick,
    rendererSize.height,
    rendererSize.width,
    transform.positionX,
    transform.positionY,
    transform.positionZ,
  ]);

  const rayFloorHomographyComparisonDebug = useMemo(() => {
    const rows: { label: string; value: string }[] = [];
    const camera = cameraRef.current;
    const frameSize = homographyDebug.frameSize;
    const homographyMatrix = homographyDebug.homographyMatrixForPlacement;
    const expectedCameraMode = isCalibratedCameraActive && calibratedCameraSnapshot ? "calibrated" : "legacy";
    let hasLargeDifference = false;

    rows.push({
      label: "ray-floor diagnostic",
      value: "Ray-floor comparison is most meaningful in calibrated camera mode.",
    });
    rows.push({
      label: "ray-floor camera mode",
      value: `${expectedCameraMode} (FOV ${formatNumber(cameraPoseFovYDeg)}deg)`,
    });

    const compareTarget = (targetPointNorm: FloorPoint | null) => {
      if (!targetPointNorm) {
        return {
          summary: "unavailable (target point unavailable)",
          available: false,
          worldDistance: null as number | null,
          reason: "target point unavailable",
        };
      }
      const rayResult = intersectOverlayRayWithFloorPlane(targetPointNorm, camera, 0);

      let homographyFailureReason: string | null = null;
      let homographyPoint: { x: number; y: number } | null = null;
      if (!frameSize) {
        homographyFailureReason = "frame unavailable";
      } else if (homographyDebug.homographySolveStatus !== "ok" || !homographyMatrix) {
        homographyFailureReason = homographyDebug.placementFallbackReason;
      } else {
        const sourcePx = normToPixels(targetPointNorm, frameSize);
        if (!sourcePx) {
          homographyFailureReason = "normalized->pixel conversion failed";
        } else {
          const mapped = applyHomography(homographyMatrix, sourcePx);
          if (!mapped || !Number.isFinite(mapped.x) || !Number.isFinite(mapped.y)) {
            homographyFailureReason = "homography projection failed";
          } else {
            homographyPoint = mapped;
          }
        }
      }

      if (!rayResult.ok || !homographyPoint) {
        const rayReason = rayResult.ok ? "ok" : rayResult.reason;
        const homographyReason = homographyPoint ? "ok" : homographyFailureReason ?? "unknown";
        return {
          summary: `fail (ray=${rayReason}; homography=${homographyReason})`,
          available: false,
          worldDistance: null as number | null,
          reason: `ray=${rayReason}; homography=${homographyReason}`,
        };
      }

      const deltaX = rayResult.floorPlane2D.x - homographyPoint.x;
      const deltaZ = rayResult.floorPlane2D.y - homographyPoint.y;
      const worldDistance = Math.hypot(deltaX, deltaZ);
      if (worldDistance > RAY_FLOOR_HOMOGRAPHY_WARNING_WORLD_DISTANCE) {
        hasLargeDifference = true;
      }
      return {
        summary: `ray ${formatNumber(rayResult.floorPlane2D.x)}/${formatNumber(rayResult.floorPlane2D.y)} vs H ${formatNumber(
          homographyPoint.x
        )}/${formatNumber(homographyPoint.y)} Δx=${formatNumber(deltaX)} Δz=${formatNumber(deltaZ)} dist=${formatNumber(
          worldDistance
        )}`,
        available: true,
        worldDistance,
        reason: null as string | null,
      };
    };

    // Phase 2I-C1A: ray-floor↔homography consistency measured at the authoritative
    // FLOOR footprint anchor { x, y:0, z } (projected through the active camera),
    // independent of transform.positionY. This is what MOVE/Rotate/Lift placement
    // eligibility should depend on so a lifted object body never strands the floor
    // controls. At rest (positionY=0) it equals objectProjectionComparison.
    const overlayFrameSizeForAnchor: ImageFrameSize | null =
      rendererSize.width > 0 && rendererSize.height > 0
        ? { width: rendererSize.width, height: rendererSize.height }
        : null;
    const floorFootprintNorm =
      camera && overlayFrameSizeForAnchor
        ? projectWorldPointToOverlayNormalized(camera, overlayFrameSizeForAnchor, {
            x: transform.positionX,
            y: 0,
            z: transform.positionZ,
          })?.normalized ?? null
        : null;

    const clickComparison = compareTarget(lastAcceptedFloorClick);
    const objectProjectionComparison = compareTarget(objectProjectionDiagnostic.projectedNorm);
    const floorAnchorComparison = compareTarget(floorFootprintNorm);

    rows.push({
      label: "ray-floor click vs homography",
      value: clickComparison.summary,
    });
    rows.push({
      label: "ray-floor object-projection vs homography",
      value: objectProjectionComparison.summary,
    });
    rows.push({
      label: "ray-floor warning",
      value: hasLargeDifference
        ? "ray-floor differs from homography; keep calibrated placement on homography until unified."
        : "none",
    });

    return { rows, clickComparison, objectProjectionComparison, floorAnchorComparison };
  }, [
    calibratedCameraSnapshot,
    cameraPoseFovYDeg,
    homographyDebug.frameSize,
    homographyDebug.homographyMatrixForPlacement,
    homographyDebug.homographySolveStatus,
    homographyDebug.placementFallbackReason,
    isCalibratedCameraActive,
    lastAcceptedFloorClick,
    objectProjectionDiagnostic.projectedNorm,
    rendererSize.width,
    rendererSize.height,
    transform.positionX,
    transform.positionZ,
  ]);

  const calibratedMoveHandleAnchorProjection = useMemo(() => {
    const camera = cameraRef.current;
    const frameSize: ImageFrameSize | null =
      rendererSize.width > 0 && rendererSize.height > 0
        ? { width: rendererSize.width, height: rendererSize.height }
        : null;
    if (!camera || !frameSize) {
      return {
        ok: false,
        reason: "camera or frame unavailable",
        normalized: null as FloorPoint | null,
      };
    }
    const projected = projectWorldPointToOverlayNormalized(camera, frameSize, {
      x: transform.positionX,
      y: 0,
      z: transform.positionZ,
    });
    if (!projected || !projected.inFront) {
      return {
        ok: false,
        reason: "floor-contact projection unavailable",
        normalized: null as FloorPoint | null,
      };
    }
    const normalized = projected.normalized;
    if (
      !Number.isFinite(normalized.x) ||
      !Number.isFinite(normalized.y) ||
      normalized.x < 0 ||
      normalized.x > 1 ||
      normalized.y < 0 ||
      normalized.y > 1
    ) {
      return {
        ok: false,
        reason: "floor-contact projection is off-screen",
        normalized: null as FloorPoint | null,
      };
    }
    return {
      ok: true,
      reason: "ok",
      normalized,
    };
  }, [
    rendererSize.height,
    rendererSize.width,
    transform.positionX,
    transform.positionZ,
  ]);

  const calibratedMoveHandleStatus = useMemo(() => {
    if (!isCalibratedCameraActive) {
      return { available: false, reason: "calibrated camera is not active" };
    }
    if (!calibratedCameraSnapshot) {
      return { available: false, reason: "calibrated camera snapshot is missing" };
    }
    if (!cameraRef.current) {
      return { available: false, reason: "camera unavailable" };
    }
    if (
      !calibratedCameraFrameMatchStatus.diagnostics ||
      calibratedCameraFrameMatchStatus.diagnostics.isWarningStale
    ) {
      return { available: false, reason: "calibrated frame match is stale" };
    }
    if (perspectiveDepthScaling.enabled) {
      return { available: false, reason: "depth scaling is not neutralized" };
    }
    // Phase 2I-C1A: eligibility is anchored to the authoritative FLOOR footprint
    // { x, y:0, z } — the point MOVE/Rotate actually operate on — NOT the object
    // body at y=positionY. At rest these coincide, so resting behavior is
    // unchanged; while lifted, a high object body no longer strands the floor
    // controls. Camera/frame/depth/ray-floor safety requirements are unchanged;
    // only the projection target switched from object body to floor anchor.
    if (!calibratedMoveHandleAnchorProjection.ok || !calibratedMoveHandleAnchorProjection.normalized) {
      return { available: false, reason: calibratedMoveHandleAnchorProjection.reason };
    }
    if (!rayFloorHomographyComparisonDebug.floorAnchorComparison.available) {
      return { available: false, reason: "ray-floor floor-anchor comparison unavailable" };
    }
    const floorAnchorDistance = rayFloorHomographyComparisonDebug.floorAnchorComparison.worldDistance;
    if (floorAnchorDistance === null || floorAnchorDistance > RAY_FLOOR_HOMOGRAPHY_WARNING_WORLD_DISTANCE) {
      return { available: false, reason: "ray-floor vs homography distance exceeds threshold" };
    }
    return { available: true, reason: "available" };
  }, [
    calibratedCameraFrameMatchStatus.diagnostics,
    calibratedCameraSnapshot,
    calibratedMoveHandleAnchorProjection.normalized,
    calibratedMoveHandleAnchorProjection.ok,
    calibratedMoveHandleAnchorProjection.reason,
    isCalibratedCameraActive,
    perspectiveDepthScaling.enabled,
    rayFloorHomographyComparisonDebug.floorAnchorComparison.available,
    rayFloorHomographyComparisonDebug.floorAnchorComparison.worldDistance,
  ]);

  // Phase 2I-A: dedicated calibrated Rotate availability. It inherits the entire
  // calibrated MOVE gate chain (gates 1-9: calibrated camera active + snapshot +
  // Three.js camera ref + non-stale frame match + projected/ok object projection +
  // ray-floor↔homography comparison available + within distance threshold + depth
  // scaling neutralized + valid in-front/on-screen floor-contact anchor) so the
  // two paths share identical gate semantics. Reusing calibratedMoveHandleStatus
  // here guarantees we never loosen or diverge from the MOVE gate. The only added
  // gate is rotate-only: auto-rotate must be off (gate 10).
  const calibratedRotateHandleStatus = useMemo(() => {
    if (!calibratedMoveHandleStatus.available) {
      return { available: false, reason: calibratedMoveHandleStatus.reason };
    }
    if (autoRotateEnabled) {
      return { available: false, reason: "auto-rotate must be off for calibrated rotate" };
    }
    return { available: true, reason: "available" };
  }, [autoRotateEnabled, calibratedMoveHandleStatus.available, calibratedMoveHandleStatus.reason]);

  // Phase 2I-B1: placement-frame local floor-contact Y (read-only metadata math).
  // Used solely to gate "grounded at placement origin" Scale eligibility.
  const calibratedScaleLocalFloorContact = useMemo(
    () =>
      computePlacementLocalFloorContactY({
        autoBoundsInfo,
        autoNormalizeBoundsEnabled,
        modelNormalization,
      }),
    [autoBoundsInfo, autoNormalizeBoundsEnabled, modelNormalization]
  );

  // Phase 2I-B1: dedicated calibrated Scale availability. It inherits the full
  // calibrated MOVE gate chain by direct reference (identical to Rotate), then adds
  // only Scale-specific gates: auto-rotate off, auto-bounds normalization enabled,
  // valid local floor-contact metadata, and grounded-at-origin (|yLocal| <= eps).
  // This slice never compensates positionY, so the grounded gate is mandatory.
  const calibratedScaleHandleStatus = useMemo(() => {
    if (!calibratedMoveHandleStatus.available) {
      return { available: false, reason: calibratedMoveHandleStatus.reason };
    }
    if (autoRotateEnabled) {
      return { available: false, reason: "auto-rotate must be off for calibrated scale" };
    }
    if (!autoNormalizeBoundsEnabled) {
      return {
        available: false,
        reason: "auto-bounds normalization must be enabled for calibrated scale",
      };
    }
    if (!calibratedScaleLocalFloorContact.ok) {
      return { available: false, reason: calibratedScaleLocalFloorContact.reason };
    }
    if (Math.abs(calibratedScaleLocalFloorContact.yLocal) > CALIBRATED_SCALE_GROUNDED_LOCAL_Y_EPSILON) {
      return {
        available: false,
        reason: "object must be grounded at the placement origin for calibrated scale",
      };
    }
    // Phase 2I-C1 containment: a lifted object's Scale semantics are undefined in
    // this slice (no compensation), and the Scale handle anchors at the floor, so
    // Scale is only offered while the object is resting on the floor.
    if (Math.abs(transform.positionY) > CALIBRATED_LIFT_RESTING_SNAP_EPSILON) {
      return {
        available: false,
        reason: "object must be resting on the floor for calibrated scale",
      };
    }
    return { available: true, reason: "available" };
  }, [
    autoNormalizeBoundsEnabled,
    autoRotateEnabled,
    calibratedMoveHandleStatus.available,
    calibratedMoveHandleStatus.reason,
    calibratedScaleLocalFloorContact,
    transform.positionY,
  ]);

  // Phase 2I-C1B: camera-aware safe Lift bound, split into two independent
  // concerns so a near-edge resting placement no longer disables Lift:
  //
  //  • Baseline eligibility — the resting floor anchor { x, y:0, z } only needs
  //    to be finite, in front of the camera, and inside the ACTUAL viewport
  //    [0,1] (tiny FP tolerance). No conservative inset is applied to y=0.
  //  • Upper bound — safeMaxLiftY is the highest sampled world Y whose projected
  //    lifted anchor is still on-screen AND admits at least one usable Lift-handle
  //    placement (the SAME viewport-safe selector the renderer uses), so the
  //    range can never disagree with what is actually drawable.
  //
  // Independent of the current positionY (depends only on the vertical line +
  // camera/frame), so a lifted object can always be brought back down.
  const calibratedLiftSafeRange = useMemo(() => {
    const camera = cameraRef.current;
    const frameSize: ImageFrameSize | null =
      rendererSize.width > 0 && rendererSize.height > 0
        ? { width: rendererSize.width, height: rendererSize.height }
        : null;
    if (!camera || !frameSize) {
      return {
        ok: false as const,
        safeMaxLiftY: 0,
        floorAnchorVisible: false,
        reason: "camera or frame unavailable",
      };
    }
    const projectNorm = (y: number) =>
      projectWorldPointToOverlayNormalized(camera, frameSize, {
        x: transform.positionX,
        y,
        z: transform.positionZ,
      });

    // Baseline: resting floor anchor must be visible in the real viewport.
    const baseline = projectNorm(0);
    const floorAnchorVisible =
      !!baseline &&
      baseline.inFront &&
      isWithinViewportBounds(baseline.normalized, CALIBRATED_LIFT_BASELINE_VIEWPORT_TOLERANCE);
    if (!baseline || !baseline.inFront) {
      return {
        ok: false as const,
        safeMaxLiftY: 0,
        floorAnchorVisible: false,
        reason: "floor anchor is behind the camera",
      };
    }
    if (!floorAnchorVisible) {
      return {
        ok: false as const,
        safeMaxLiftY: 0,
        floorAnchorVisible: false,
        reason: "floor anchor is outside the viewport",
      };
    }

    // Obstacles for a LIFTED handle (Scale is hidden while lifted, so it is not
    // an obstacle here). MOVE/Rotate use the floor footprint anchor.
    const footprint = {
      x: baseline.normalized.x * CALIBRATED_LIFT_OVERLAY_VIEWBOX_SIZE,
      y: baseline.normalized.y * CALIBRATED_LIFT_OVERLAY_VIEWBOX_SIZE,
    };
    const obstacles: { x: number; y: number }[] = [footprint];
    if (calibratedMoveHandleStatus.available) obstacles.push({ x: footprint.x + 4.2, y: footprint.y - 4.2 });
    if (calibratedRotateHandleStatus.available) obstacles.push({ x: footprint.x - 4.2, y: footprint.y - 4.2 });

    const hasUsableHandle = (y: number) => {
      const projected = projectNorm(y);
      if (
        !projected ||
        !projected.inFront ||
        !isWithinViewportBounds(projected.normalized, CALIBRATED_LIFT_BASELINE_VIEWPORT_TOLERANCE)
      ) {
        return false;
      }
      const placement = selectViewportSafeHandleOffset({
        anchor: {
          x: projected.normalized.x * CALIBRATED_LIFT_OVERLAY_VIEWBOX_SIZE,
          y: projected.normalized.y * CALIBRATED_LIFT_OVERLAY_VIEWBOX_SIZE,
        },
        candidateOffsets: CALIBRATED_LIFT_HANDLE_CANDIDATE_OFFSETS,
        obstacles,
        minSeparation: CALIBRATED_LIFT_HANDLE_MIN_SEPARATION,
        viewportSize: CALIBRATED_LIFT_OVERLAY_VIEWBOX_SIZE,
        viewportInset: CALIBRATED_LIFT_HANDLE_VIEWPORT_INSET,
      });
      return placement.available;
    };

    const hardMax = TRANSFORM_LIMITS.positionY.max;
    let safeMaxLiftY = 0;
    for (let y = CALIBRATED_LIFT_SCAN_STEP_Y; y <= hardMax + 1e-9; y += CALIBRATED_LIFT_SCAN_STEP_Y) {
      if (!hasUsableHandle(y)) break;
      safeMaxLiftY = y;
    }
    if (safeMaxLiftY < CALIBRATED_LIFT_MIN_USEFUL_RANGE_Y) {
      return {
        ok: false as const,
        safeMaxLiftY,
        floorAnchorVisible: true,
        reason: "insufficient safe lift headroom",
      };
    }
    return { ok: true as const, safeMaxLiftY, floorAnchorVisible: true, reason: "ok" };
  }, [
    rendererSize.width,
    rendererSize.height,
    transform.positionX,
    transform.positionZ,
    calibratedMoveHandleStatus.available,
    calibratedRotateHandleStatus.available,
  ]);

  // Phase 2I-C1: resting vs lifted derived state (grounded-only slice; positionY
  // is the authoritative lift height because |yLocal| <= grounded epsilon).
  const isCalibratedObjectLifted = useMemo(
    () =>
      calibratedScaleLocalFloorContact.ok &&
      Math.abs(calibratedScaleLocalFloorContact.yLocal) <= CALIBRATED_SCALE_GROUNDED_LOCAL_Y_EPSILON &&
      transform.positionY > CALIBRATED_LIFT_RESTING_SNAP_EPSILON,
    [calibratedScaleLocalFloorContact, transform.positionY]
  );

  // Phase 2I-C1A: Drop-to-floor recovery is intentionally decoupled from the
  // safe-range gate (it only ever sets positionY = 0, an always-safe operation),
  // so a lifted object can always be returned to the floor even if the camera
  // geometry later collapses the safe lift headroom.
  const calibratedDropToFloorAvailable = useMemo(() => {
    if (!calibratedMoveHandleStatus.available) return false;
    if (autoRotateEnabled) return false;
    if (!autoNormalizeBoundsEnabled) return false;
    if (!calibratedScaleLocalFloorContact.ok) return false;
    if (Math.abs(calibratedScaleLocalFloorContact.yLocal) > CALIBRATED_SCALE_GROUNDED_LOCAL_Y_EPSILON) return false;
    return isCalibratedObjectLifted;
  }, [
    autoNormalizeBoundsEnabled,
    autoRotateEnabled,
    calibratedMoveHandleStatus.available,
    calibratedScaleLocalFloorContact,
    isCalibratedObjectLifted,
  ]);

  // Phase 2I-C1: projection of the lifted placement anchor { x, positionY, z }.
  // The Lift handle renders from this, distinct from the floor footprint anchor
  // (calibratedMoveHandleAnchorProjection at y = 0) used by MOVE/Rotate/Scale.
  const calibratedLiftHandleAnchorProjection = useMemo(() => {
    const camera = cameraRef.current;
    const frameSize: ImageFrameSize | null =
      rendererSize.width > 0 && rendererSize.height > 0
        ? { width: rendererSize.width, height: rendererSize.height }
        : null;
    if (!camera || !frameSize) {
      return { ok: false, reason: "camera or frame unavailable", normalized: null as FloorPoint | null };
    }
    const projected = projectWorldPointToOverlayNormalized(camera, frameSize, {
      x: transform.positionX,
      y: transform.positionY,
      z: transform.positionZ,
    });
    if (!projected || !projected.inFront) {
      return { ok: false, reason: "lifted-anchor projection unavailable", normalized: null as FloorPoint | null };
    }
    const normalized = projected.normalized;
    if (
      !Number.isFinite(normalized.x) ||
      !Number.isFinite(normalized.y) ||
      normalized.x < 0 ||
      normalized.x > 1 ||
      normalized.y < 0 ||
      normalized.y > 1
    ) {
      return { ok: false, reason: "lifted-anchor projection is off-screen", normalized: null as FloorPoint | null };
    }
    return { ok: true, reason: "ok", normalized };
  }, [rendererSize.height, rendererSize.width, transform.positionX, transform.positionY, transform.positionZ]);

  // Phase 2I-C1B: viewport-aware adaptive Lift-handle offset. The handle stays
  // semantically at the lifted anchor (the tether endpoint is unchanged), but its
  // grabbable offset is chosen deterministically (preferred-first) so the handle
  // center stays on-screen AND, where possible, clear of the visible
  // MOVE/Rotate/Scale hit targets. If no candidate keeps the handle center
  // visible/reachable, `available` is false (the handle is then hidden and the
  // reason is surfaced). Pure selection => the preferred offset is retained
  // whenever it stays usable, so there is no visual jitter.
  const calibratedLiftHandlePlacement = useMemo(() => {
    const lifted = calibratedLiftHandleAnchorProjection.normalized;
    const footprint = calibratedMoveHandleAnchorProjection.normalized;
    const fallback = CALIBRATED_LIFT_HANDLE_CANDIDATE_OFFSETS[0];
    if (!lifted) {
      return {
        offset: fallback,
        ideal: false,
        separation: 0,
        available: false,
        reason: "lifted anchor unavailable",
      };
    }
    const anchor = {
      x: lifted.x * CALIBRATED_LIFT_OVERLAY_VIEWBOX_SIZE,
      y: lifted.y * CALIBRATED_LIFT_OVERLAY_VIEWBOX_SIZE,
    };
    const obstacles: { x: number; y: number }[] = [];
    if (footprint) {
      const fx = footprint.x * CALIBRATED_LIFT_OVERLAY_VIEWBOX_SIZE;
      const fy = footprint.y * CALIBRATED_LIFT_OVERLAY_VIEWBOX_SIZE;
      // Footprint anchor dot.
      obstacles.push({ x: fx, y: fy });
      if (calibratedMoveHandleStatus.available) obstacles.push({ x: fx + 4.2, y: fy - 4.2 });
      if (calibratedRotateHandleStatus.available) obstacles.push({ x: fx - 4.2, y: fy - 4.2 });
      if (calibratedScaleHandleStatus.available) obstacles.push({ x: fx + 4.3, y: fy + 3.75 });
    }
    const selection = selectViewportSafeHandleOffset({
      anchor,
      candidateOffsets: CALIBRATED_LIFT_HANDLE_CANDIDATE_OFFSETS,
      obstacles,
      minSeparation: CALIBRATED_LIFT_HANDLE_MIN_SEPARATION,
      viewportSize: CALIBRATED_LIFT_OVERLAY_VIEWBOX_SIZE,
      viewportInset: CALIBRATED_LIFT_HANDLE_VIEWPORT_INSET,
    });
    return {
      offset: selection.offset,
      ideal: selection.ideal,
      separation: selection.separation,
      available: selection.available,
      reason: selection.reason,
    };
  }, [
    calibratedLiftHandleAnchorProjection.normalized,
    calibratedMoveHandleAnchorProjection.normalized,
    calibratedMoveHandleStatus.available,
    calibratedRotateHandleStatus.available,
    calibratedScaleHandleStatus.available,
  ]);

  // Phase 2I-C1: dedicated calibrated Lift availability. Inherits the full MOVE
  // gate chain by direct reference (like Rotate/Scale), then adds Lift-specific
  // gates: auto-rotate off, auto-bounds enabled, valid + grounded local contact
  // (so positionY is an exact contact-height proxy), finite positionY within
  // transform limits, and (Phase 2I-C1A) a derivable camera-aware safe range.
  // Lift does NOT require resting; it is the control that lifts. It also does NOT
  // block when positionY currently exceeds the safe max, so an object can always
  // be lowered (the gesture clamps and Drop-to-floor remains available).
  //
  // Phase 2I-C1C: final display-availability alignment gate. Lift is never
  // reported available unless the current handle placement is actually on-screen
  // and grabbable.
  const calibratedLiftHandleStatus = useMemo(() => {
    if (!calibratedMoveHandleStatus.available) {
      return { available: false, reason: calibratedMoveHandleStatus.reason };
    }
    if (autoRotateEnabled) {
      return { available: false, reason: "auto-rotate must be off for calibrated lift" };
    }
    if (!autoNormalizeBoundsEnabled) {
      return {
        available: false,
        reason: "auto-bounds normalization must be enabled for calibrated lift",
      };
    }
    if (!calibratedScaleLocalFloorContact.ok) {
      return { available: false, reason: calibratedScaleLocalFloorContact.reason };
    }
    if (Math.abs(calibratedScaleLocalFloorContact.yLocal) > CALIBRATED_SCALE_GROUNDED_LOCAL_Y_EPSILON) {
      return {
        available: false,
        reason: "object must be grounded at the placement origin for calibrated lift",
      };
    }
    if (
      !Number.isFinite(transform.positionY) ||
      transform.positionY < TRANSFORM_LIMITS.positionY.min ||
      transform.positionY > TRANSFORM_LIMITS.positionY.max
    ) {
      return { available: false, reason: "positionY is out of range for calibrated lift" };
    }
    if (!calibratedLiftSafeRange.ok) {
      return { available: false, reason: calibratedLiftSafeRange.reason };
    }
    if (!calibratedLiftHandlePlacement.available) {
      return { available: false, reason: calibratedLiftHandlePlacement.reason };
    }
    return { available: true, reason: "available" };
  }, [
    autoNormalizeBoundsEnabled,
    autoRotateEnabled,
    calibratedLiftHandlePlacement.available,
    calibratedLiftHandlePlacement.reason,
    calibratedLiftSafeRange.ok,
    calibratedLiftSafeRange.reason,
    calibratedMoveHandleStatus.available,
    calibratedMoveHandleStatus.reason,
    calibratedScaleLocalFloorContact,
    transform.positionY,
  ]);

  // Phase 2B: preview-only selected suggestion. Read-only derived value; never
  // mutates the manual floor polygon.
  const selectedAutoFloorCandidate = useMemo(
    () => getSelectedAutoFloorCandidate(autoFloorDetectionResult, selectedAutoFloorCandidateId),
    [autoFloorDetectionResult, selectedAutoFloorCandidateId]
  );

  // Phase 2C: preview-only geometry scoring for the selected suggestion. Uses
  // the same frame/floor-rect assumptions as the existing homography diagnostic.
  // Read-only; never mutates floorPolygon or any calibrated camera state.
  const selectedAutoFloorCandidateScore = useMemo<AutoFloorCandidateGeometryScore | null>(() => {
    if (!selectedAutoFloorCandidate) return null;
    const frameSize: ImageFrameSize | null =
      rendererSize.width > 0 && rendererSize.height > 0
        ? { width: rendererSize.width, height: rendererSize.height }
        : null;
    return scoreAutoFloorCandidateGeometry(selectedAutoFloorCandidate, {
      frameSize,
      floorRect: {
        widthMeters: floorMapping.worldWidth,
        depthMeters: floorMapping.worldDepth,
      },
    });
  }, [
    selectedAutoFloorCandidate,
    rendererSize.width,
    rendererSize.height,
    floorMapping.worldWidth,
    floorMapping.worldDepth,
  ]);

  const assistedCandidateIdentity = useMemo(() => {
    const normalizedQuadMatchEpsilon = 1e-4;
    const selectedCandidateQuad = selectedAutoFloorCandidate?.quadNorm ?? null;
    const activeFloorMatchesSelectedCandidate =
      !!selectedCandidateQuad &&
      floorPolygon.length === 4 &&
      selectedCandidateQuad.length === 4 &&
      floorPolygon.every((point, index) => {
        const candidatePoint = selectedCandidateQuad[index];
        if (!candidatePoint) return false;
        return (
          Math.abs(point.x - candidatePoint.x) <= normalizedQuadMatchEpsilon &&
          Math.abs(point.y - candidatePoint.y) <= normalizedQuadMatchEpsilon
        );
      });
    const isAppliedAndIdentical =
      !!selectedAutoFloorCandidate &&
      appliedAutoFloorCandidateId === selectedAutoFloorCandidate.id &&
      activeFloorMatchesSelectedCandidate;
    const wasAppliedButNowDifferent =
      !!selectedAutoFloorCandidate &&
      appliedAutoFloorCandidateId === selectedAutoFloorCandidate.id &&
      !activeFloorMatchesSelectedCandidate;
    return {
      activeFloorMatchesSelectedCandidate,
      isAppliedAndIdentical,
      wasAppliedButNowDifferent,
    };
  }, [appliedAutoFloorCandidateId, floorPolygon, selectedAutoFloorCandidate]);

  const selectedAssistedCandidateSolvability = useMemo(() => {
    if (!selectedAutoFloorCandidate) return null;
    if (assistedCandidateIdentity.isAppliedAndIdentical) return null;
    return evaluateQuadSolvability({
      quadNorm: selectedAutoFloorCandidate.quadNorm,
      frameSize: homographyDebug.frameSize,
      floorDimensions: {
        worldWidth: floorMapping.worldWidth,
        worldDepth: floorMapping.worldDepth,
      },
      currentVerticalFovDeg: cameraPoseFovYDeg,
      fovScanConfig: { minFovDeg: 20, maxFovDeg: 90, stepDeg: 1 },
    });
  }, [
    assistedCandidateIdentity.isAppliedAndIdentical,
    cameraPoseFovYDeg,
    floorMapping.worldDepth,
    floorMapping.worldWidth,
    homographyDebug.frameSize,
    selectedAutoFloorCandidate,
  ]);

  // Phase 2O-A: read-only, diagnostic-only support classification. Consumes only
  // existing evidence (candidate quad, existing geometry score, the Phase 2N
  // solvability result incl. its shared Apply evaluation, and pure frame-edge
  // proximity). It NEVER moves a corner, defines a search corridor, changes
  // candidate scoring/selection, or touches Apply/FOV/snapshot/scene state.
  const selectedAssistedCandidateSupport = useMemo(() => {
    if (!selectedAutoFloorCandidate || !selectedAutoFloorCandidateScore) return null;
    return classifyAutoFloorSupport({
      quadNorm: selectedAutoFloorCandidate.quadNorm,
      geometryScore: selectedAutoFloorCandidateScore,
      solvability: selectedAssistedCandidateSolvability,
    });
  }, [selectedAutoFloorCandidate, selectedAutoFloorCandidateScore, selectedAssistedCandidateSolvability]);

  const assistedCandidateSupportReadout = useMemo(() => {
    const classification = selectedAssistedCandidateSupport;
    if (!classification) return null;
    const classLabel =
      classification.supportClass === "directly_supported"
        ? "Directly supported (diagnostic)"
        : classification.supportClass === "under_support_suspected"
          ? "Under-support suspected (diagnostic)"
          : "Insufficient visual evidence";
    const target = classification.underSupportTarget;
    const targetText =
      target === null
        ? "None"
        : target.kind === "corner"
          ? `Corner ${target.corner}`
          : `Paired-corner pattern: ${target.corners.join("–")}`;
    const frameEdgeText =
      classification.frameEdgeContacts.length > 0 ? classification.frameEdgeContacts.join(", ") : "None";
    return {
      classLabel,
      targetText,
      frameEdgeText,
      reasons: classification.reasons,
    };
  }, [selectedAssistedCandidateSupport]);

  // --- Phase 2O-B1: manual seam / support annotation harness ----------------
  // All helpers below operate ONLY on the ephemeral local annotation state.
  // They never touch floorPolygon, candidate state, solver/FOV/Apply paths, or
  // any persistence. The dense integrity checking lives in the pure module
  // validateManualFloorSupportAnnotation(...); this component only wires state,
  // events, rendering, and diagnostics.

  const manualFrameSize = useMemo<ImageFrameSize | null>(
    () =>
      rendererSize.width > 0 && rendererSize.height > 0
        ? { width: rendererSize.width, height: rendererSize.height }
        : null,
    [rendererSize.width, rendererSize.height]
  );

  const manualAnnotationCoordsReady = !!imageIntrinsicSize && !!manualFrameSize;

  const clearManualAnnotationInteractionState = useCallback(() => {
    setSelectedManualSeamId(null);
    setManualSeamDraftPoints([]);
    setIsPlacingManualSeam(false);
    setIsDraggingManualVertex(false);
    manualDraggingVertexRef.current = null;
  }, []);

  const updateManualAnnotation = useCallback(
    (mutator: (current: ManualFloorSupportAnnotation) => ManualFloorSupportAnnotation) => {
      setManualAnnotation((current) => (current ? mutator(current) : current));
    },
    []
  );

  const handleBeginManualAnnotation = useCallback(() => {
    manualSeamIdCounterRef.current = 0;
    clearManualAnnotationInteractionState();
    setManualAnnotationResetReason(null);
    setManualAnnotation(createEmptyManualFloorSupportAnnotation());
  }, [clearManualAnnotationInteractionState]);

  const handleClearManualAnnotation = useCallback(() => {
    clearManualAnnotationInteractionState();
    setManualAnnotationResetReason(null);
    setManualAnnotation(null);
  }, [clearManualAnnotationInteractionState]);

  const handleStartAddSeam = useCallback(() => {
    setManualSeamDraftPoints([]);
    setIsPlacingManualSeam(true);
  }, []);

  const handleCancelSeamDraft = useCallback(() => {
    setManualSeamDraftPoints([]);
    setIsPlacingManualSeam(false);
  }, []);

  const handleFinishSeam = useCallback(() => {
    setManualSeamDraftPoints((draft) => {
      if (draft.length < 2) return draft;
      manualSeamIdCounterRef.current += 1;
      const id = `manual-seam-${manualSeamIdCounterRef.current}`;
      const newSeam: ManualPhysicalSeam = {
        id,
        kind: "physical_floor_wall_seam",
        points: draft.map((point) => ({ x: point.x, y: point.y })),
        usableSpan: { startVertexIndex: 0, endVertexIndex: draft.length - 1 },
        corridor: { halfWidthSourcePx: DEFAULT_SEAM_CORRIDOR_HALF_WIDTH_SOURCE_PX },
      };
      updateManualAnnotation((current) => ({ ...current, seams: [...current.seams, newSeam] }));
      setSelectedManualSeamId(id);
      return [];
    });
    setIsPlacingManualSeam(false);
  }, [updateManualAnnotation]);

  const handleDeleteSeam = useCallback(
    (seamId: string) => {
      updateManualAnnotation((current) => {
        const seams = current.seams.filter((seam) => seam.id !== seamId);
        // Cascade: drop dangling references so the annotation stays valid.
        const cornerSupport: ManualFloorSupportAnnotation["cornerSupport"] = {};
        for (const label of FLOOR_CORNER_LABELS) {
          const support = current.cornerSupport[label];
          if (!support) continue;
          cornerSupport[label] =
            support.linkedSeamId === seamId ? { ...support, linkedSeamId: undefined } : support;
        }
        const authorityReferencesSeam =
          current.adjustmentAuthority.kind !== "none" && current.adjustmentAuthority.seamId === seamId;
        const adjustmentAuthority = authorityReferencesSeam
          ? ({ kind: "none" } as const)
          : current.adjustmentAuthority;
        const mode: ManualSearchMode = authorityReferencesSeam ? "direct" : current.mode;
        const determiningEdge =
          current.determiningEdge && current.determiningEdge.seamId === seamId
            ? null
            : current.determiningEdge;
        return { ...current, seams, cornerSupport, adjustmentAuthority, mode, determiningEdge };
      });
      setSelectedManualSeamId((current) => (current === seamId ? null : current));
    },
    [updateManualAnnotation]
  );

  const handleSetSeamCorridor = useCallback(
    (seamId: string, halfWidthSourcePx: number) => {
      updateManualAnnotation((current) => ({
        ...current,
        seams: current.seams.map((seam) =>
          seam.id === seamId ? { ...seam, corridor: { halfWidthSourcePx } } : seam
        ),
      }));
    },
    [updateManualAnnotation]
  );

  const handleSetSeamNote = useCallback(
    (seamId: string, note: string) => {
      updateManualAnnotation((current) => ({
        ...current,
        seams: current.seams.map((seam) =>
          seam.id === seamId ? { ...seam, notes: note.length > 0 ? note : undefined } : seam
        ),
      }));
    },
    [updateManualAnnotation]
  );

  const handleSetCornerSupportState = useCallback(
    (corner: FloorCornerLabel, state: ManualCornerSupportState | "unset") => {
      updateManualAnnotation((current) => {
        const next = { ...current.cornerSupport };
        if (state === "unset") {
          delete next[corner];
        } else {
          next[corner] = { ...(next[corner] ?? {}), state };
        }
        return { ...current, cornerSupport: next };
      });
    },
    [updateManualAnnotation]
  );

  const handleSetCornerSupportLinkedSeam = useCallback(
    (corner: FloorCornerLabel, seamId: string) => {
      updateManualAnnotation((current) => {
        const existing = current.cornerSupport[corner];
        if (!existing) return current;
        return {
          ...current,
          cornerSupport: {
            ...current.cornerSupport,
            [corner]: { ...existing, linkedSeamId: seamId.length > 0 ? seamId : undefined },
          },
        };
      });
    },
    [updateManualAnnotation]
  );

  // Rebuilds the explicit authority block from the chosen mode. Default ranges
  // span the full usable seam (0 -> 1). Authority metadata is captured/validated
  // only; it is NOT consumed for any trial generation or mutation in this phase.
  const handleSetManualMode = useCallback(
    (mode: ManualSearchMode) => {
      updateManualAnnotation((current) => {
        const firstSeamId = current.seams[0]?.id ?? "";
        if (mode === "direct" || mode === "abstain") {
          return { ...current, mode, adjustmentAuthority: { kind: "none" } };
        }
        if (mode === "single_corner_constrained") {
          const seamId =
            current.adjustmentAuthority.kind !== "none" ? current.adjustmentAuthority.seamId : firstSeamId;
          const corner =
            current.adjustmentAuthority.kind === "single_corner"
              ? current.adjustmentAuthority.corner
              : "FL";
          return {
            ...current,
            mode,
            adjustmentAuthority: {
              kind: "single_corner",
              corner,
              seamId,
              allowedSpan: { startT: 0, endT: 1 },
            },
          };
        }
        // coupled_far_edge_constrained
        const seamId =
          current.adjustmentAuthority.kind !== "none" ? current.adjustmentAuthority.seamId : firstSeamId;
        return {
          ...current,
          mode,
          adjustmentAuthority: {
            kind: "coupled_far_edge",
            corners: ["FL", "FR"],
            seamId,
            flAllowedSpan: { startT: 0, endT: 1 },
            frAllowedSpan: { startT: 0, endT: 1 },
            coupling: {
              preserveOrder: true,
              preserveEdgeDirection: true,
              maxRelativeAlongSeamDeltaSourcePx: DEFAULT_COUPLED_MAX_RELATIVE_DELTA_SOURCE_PX,
            },
          },
        };
      });
    },
    [updateManualAnnotation]
  );

  const handleSetAuthorityCorner = useCallback(
    (corner: FloorCornerLabel) => {
      updateManualAnnotation((current) => {
        if (current.adjustmentAuthority.kind !== "single_corner") return current;
        return {
          ...current,
          adjustmentAuthority: { ...current.adjustmentAuthority, corner },
        };
      });
    },
    [updateManualAnnotation]
  );

  const handleSetAuthoritySeam = useCallback(
    (seamId: string) => {
      updateManualAnnotation((current) => {
        if (current.adjustmentAuthority.kind === "none") return current;
        return {
          ...current,
          adjustmentAuthority: { ...current.adjustmentAuthority, seamId },
        };
      });
    },
    [updateManualAnnotation]
  );

  const handleSetDeterminingEdgeSeam = useCallback(
    (seamId: string) => {
      updateManualAnnotation((current) => {
        if (seamId.length === 0) {
          return { ...current, determiningEdge: null };
        }
        const existing = current.determiningEdge;
        return {
          ...current,
          determiningEdge: {
            seamId,
            role: existing?.role ?? "rear_floor_wall_edge",
            intendedCanonicalSupport: existing?.intendedCanonicalSupport ?? ["FL", "FR"],
          },
        };
      });
    },
    [updateManualAnnotation]
  );

  const handleSetDeterminingEdgeRole = useCallback(
    (role: "rear_floor_wall_edge" | "other_visible_floor_boundary") => {
      updateManualAnnotation((current) => {
        if (!current.determiningEdge) return current;
        const intendedCanonicalSupport: FloorCornerLabel[] =
          role === "rear_floor_wall_edge" ? ["FL", "FR"] : current.determiningEdge.intendedCanonicalSupport;
        return {
          ...current,
          determiningEdge: { ...current.determiningEdge, role, intendedCanonicalSupport },
        };
      });
    },
    [updateManualAnnotation]
  );

  const handleToggleDeterminingEdgeCorner = useCallback(
    (corner: FloorCornerLabel) => {
      updateManualAnnotation((current) => {
        if (!current.determiningEdge) return current;
        const present = current.determiningEdge.intendedCanonicalSupport.includes(corner);
        const intendedCanonicalSupport = present
          ? current.determiningEdge.intendedCanonicalSupport.filter((label) => label !== corner)
          : FLOOR_CORNER_LABELS.filter(
              (label) =>
                label === corner || current.determiningEdge!.intendedCanonicalSupport.includes(label)
            );
        return {
          ...current,
          determiningEdge: { ...current.determiningEdge, intendedCanonicalSupport },
        };
      });
    },
    [updateManualAnnotation]
  );

  // Converts a pointer client position to source-normalized image coordinates
  // using the SAME object-cover crop helpers as the rest of the lab so manual
  // seams stay aligned across resize and cover-crop.
  const clientToManualSourceNorm = useCallback(
    (clientX: number, clientY: number): SourceNormPoint | null => {
      const overlay = manualOverlayRef.current;
      if (!overlay || !imageIntrinsicSize || !manualFrameSize) return null;
      const rect = overlay.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      const containerNorm = {
        x: clampValue((clientX - rect.left) / rect.width, 0, 1),
        y: clampValue((clientY - rect.top) / rect.height, 0, 1),
      };
      return containerNormToSourceNorm(containerNorm, imageIntrinsicSize, manualFrameSize);
    },
    [imageIntrinsicSize, manualFrameSize]
  );

  const handleManualOverlayPointerDown = useCallback(
    (event: PointerEvent<SVGSVGElement>) => {
      if (!isPlacingManualSeam) return;
      const sourcePoint = clientToManualSourceNorm(event.clientX, event.clientY);
      if (!sourcePoint) return;
      setManualSeamDraftPoints((draft) => [...draft, sourcePoint]);
    },
    [clientToManualSourceNorm, isPlacingManualSeam]
  );

  const handleManualVertexPointerDown = useCallback(
    (event: PointerEvent<SVGCircleElement>, seamId: string, index: number) => {
      event.stopPropagation();
      event.preventDefault();
      manualDraggingVertexRef.current = { seamId, index, pointerId: event.pointerId };
      setIsDraggingManualVertex(true);
      try {
        manualOverlayRef.current?.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is optional; dragging continues while pointer stays in bounds.
      }
    },
    []
  );

  const handleManualOverlayPointerMove = useCallback(
    (event: PointerEvent<SVGSVGElement>) => {
      const dragging = manualDraggingVertexRef.current;
      if (!dragging) return;
      const sourcePoint = clientToManualSourceNorm(event.clientX, event.clientY);
      if (!sourcePoint) return;
      updateManualAnnotation((current) => ({
        ...current,
        seams: current.seams.map((seam) =>
          seam.id === dragging.seamId
            ? {
                ...seam,
                points: seam.points.map((point, i) => (i === dragging.index ? sourcePoint : point)),
              }
            : seam
        ),
      }));
    },
    [clientToManualSourceNorm, updateManualAnnotation]
  );

  const handleManualOverlayPointerUp = useCallback(
    (event: PointerEvent<SVGSVGElement>) => {
      const dragging = manualDraggingVertexRef.current;
      if (dragging && dragging.pointerId === event.pointerId) {
        try {
          manualOverlayRef.current?.releasePointerCapture(event.pointerId);
        } catch {
          // Ignore release failures when capture is already cleared.
        }
        manualDraggingVertexRef.current = null;
        setIsDraggingManualVertex(false);
      }
    },
    []
  );

  // Diagnostic-only annotation validation. Pure; never blocks or alters any
  // calibration/solver behavior.
  const manualAnnotationValidation = useMemo(
    () => (manualAnnotation ? validateManualFloorSupportAnnotation(manualAnnotation) : null),
    [manualAnnotation]
  );

  // Per-seam measured source-pixel length (diagnostic display only). NEVER used
  // to auto-select the determining edge — that remains an operator assertion.
  const manualSeamLengths = useMemo<Record<string, number>>(() => {
    const lengths: Record<string, number> = {};
    if (!manualAnnotation || !imageIntrinsicSize) return lengths;
    const { width, height } = imageIntrinsicSize;
    for (const seam of manualAnnotation.seams) {
      let total = 0;
      for (let i = 1; i < seam.points.length; i += 1) {
        const a = seam.points[i - 1];
        const b = seam.points[i];
        total += Math.hypot((b.x - a.x) * width, (b.y - a.y) * height);
      }
      lengths[seam.id] = total;
    }
    return lengths;
  }, [manualAnnotation, imageIntrinsicSize]);

  const longestManualSeamId = useMemo<string | null>(() => {
    let bestId: string | null = null;
    let bestLength = -1;
    for (const [seamId, length] of Object.entries(manualSeamLengths)) {
      if (length > bestLength) {
        bestLength = length;
        bestId = seamId;
      }
    }
    return bestId;
  }, [manualSeamLengths]);

  // Renders source-normalized seam points into container-normalized polyline
  // attribute strings (viewBox 0..100) using the shared cover-crop helper.
  const manualSeamRenderData = useMemo(() => {
    if (!manualAnnotation || !imageIntrinsicSize || !manualFrameSize) return null;
    const toContainerPct = (point: SourceNormPoint): { x: number; y: number } | null => {
      const containerNorm = sourceNormToContainerNorm(point, imageIntrinsicSize, manualFrameSize);
      if (!containerNorm) return null;
      return { x: containerNorm.x * 100, y: containerNorm.y * 100 };
    };
    const seams = manualAnnotation.seams.map((seam) => {
      const projected = seam.points
        .map((point) => toContainerPct(point))
        .filter((point): point is { x: number; y: number } => point !== null);
      // Corridor band stroke width derived from the source-pixel half-width so
      // the translucent band visibly reflects halfWidthSourcePx. Centerline is
      // rendered separately with its own fixed width and is not affected.
      const corridorStrokeWidth =
        corridorHalfWidthToOverlayStrokeWidth(
          seam.corridor.halfWidthSourcePx,
          imageIntrinsicSize,
          manualFrameSize
        ) ?? 0;
      return { id: seam.id, projected, corridorStrokeWidth };
    });
    const draft = manualSeamDraftPoints
      .map((point) => toContainerPct(point))
      .filter((point): point is { x: number; y: number } => point !== null);
    return { seams, draft };
  }, [manualAnnotation, imageIntrinsicSize, manualFrameSize, manualSeamDraftPoints]);

  // Invalidation: clear the ephemeral annotation when the loaded source image
  // changes. A small reason is surfaced so stale evidence is never retained
  // silently.
  useEffect(() => {
    if (manualAnnotationPrevImageRef.current === loadedImageUrl) return;
    manualAnnotationPrevImageRef.current = loadedImageUrl;
    if (manualAnnotation !== null) {
      clearManualAnnotationInteractionState();
      setManualAnnotation(null);
      setManualAnnotationResetReason("Annotation cleared: source image changed.");
    }
  }, [loadedImageUrl, manualAnnotation, clearManualAnnotationInteractionState]);

  // Invalidation: clear the ephemeral annotation when the selected Auto Floor
  // candidate changes.
  useEffect(() => {
    if (manualAnnotationPrevCandidateRef.current === selectedAutoFloorCandidateId) return;
    manualAnnotationPrevCandidateRef.current = selectedAutoFloorCandidateId;
    if (manualAnnotation !== null) {
      clearManualAnnotationInteractionState();
      setManualAnnotation(null);
      setManualAnnotationResetReason("Annotation cleared: selected candidate changed.");
    }
  }, [selectedAutoFloorCandidateId, manualAnnotation, clearManualAnnotationInteractionState]);

  // --- Phase 2O-D: constrained diagnostic trial generation ------------------
  // Pure generation + a thin solver wrapper live in dedicated modules. This
  // component only wires eligibility, generation, invalidation, and the
  // diagnostic readout. Nothing here mutates floorPolygon, candidate geometry,
  // selection/ranking, FOV, floor dimensions, Apply, snapshot, or scene state.

  const manualTrialEligibility = useMemo<{ canGenerate: boolean; reason: string | null }>(() => {
    if (!selectedAutoFloorCandidate) {
      return { canGenerate: false, reason: "Select an Auto Floor candidate first." };
    }
    if (!manualAnnotation) {
      return { canGenerate: false, reason: "Begin a manual annotation first." };
    }
    if (!manualAnnotationCoordsReady) {
      return { canGenerate: false, reason: "Image / frame display size is not ready yet." };
    }
    if (!manualAnnotationValidation || !manualAnnotationValidation.ok) {
      return { canGenerate: false, reason: "Annotation must pass integrity validation first." };
    }
    const mode = manualAnnotation.mode;
    if (mode === "abstain") {
      return { canGenerate: false, reason: "Operator selected abstention — no trials are generated." };
    }
    const authority = manualAnnotation.adjustmentAuthority;
    if (mode === "single_corner_constrained") {
      if (authority.kind !== "single_corner") {
        return { canGenerate: false, reason: "Single-corner mode requires single-corner adjustment authority." };
      }
      if (!manualAnnotation.seams.some((seam) => seam.id === authority.seamId)) {
        return { canGenerate: false, reason: "Authority references a seam that does not exist." };
      }
    }
    if (mode === "coupled_far_edge_constrained") {
      if (authority.kind !== "coupled_far_edge") {
        return { canGenerate: false, reason: "Coupled mode requires coupled far-edge adjustment authority." };
      }
      if (!manualAnnotation.seams.some((seam) => seam.id === authority.seamId)) {
        return { canGenerate: false, reason: "Authority references a seam that does not exist." };
      }
    }
    return { canGenerate: true, reason: null };
  }, [selectedAutoFloorCandidate, manualAnnotation, manualAnnotationCoordsReady, manualAnnotationValidation]);

  const handleGenerateManualTrials = useCallback(() => {
    if (!selectedAutoFloorCandidate || !manualAnnotation || !imageIntrinsicSize || !manualFrameSize) {
      return;
    }
    const candidateInput: TrialGenerationCandidate = {
      id: selectedAutoFloorCandidate.id,
      quadNorm: [
        { x: selectedAutoFloorCandidate.quadNorm[0].x, y: selectedAutoFloorCandidate.quadNorm[0].y },
        { x: selectedAutoFloorCandidate.quadNorm[1].x, y: selectedAutoFloorCandidate.quadNorm[1].y },
        { x: selectedAutoFloorCandidate.quadNorm[2].x, y: selectedAutoFloorCandidate.quadNorm[2].y },
        { x: selectedAutoFloorCandidate.quadNorm[3].x, y: selectedAutoFloorCandidate.quadNorm[3].y },
      ],
    };
    const generated = generateManualFloorSupportTrials({
      candidate: candidateInput,
      annotation: manualAnnotation,
      intrinsic: imageIntrinsicSize,
      frame: manualFrameSize,
    });
    if (!generated) {
      manualTrialSetRef.current = null;
      setManualTrialSet(null);
      setManualTrialNotice(
        manualAnnotation.mode === "abstain"
          ? "Operator selected abstention — no diagnostic trials were generated."
          : "No diagnostic trial run was produced for the current annotation."
      );
      return;
    }
    const evaluated = evaluateManualFloorSupportTrialSet(generated, {
      frame: manualFrameSize,
      floorDimensions: {
        worldWidth: floorMapping.worldWidth,
        worldDepth: floorMapping.worldDepth,
      },
      currentVerticalFovDeg: cameraPoseFovYDeg,
      fovScanConfig: { minFovDeg: 20, maxFovDeg: 90, stepDeg: 1 },
    });
    manualTrialSetRef.current = evaluated;
    setManualTrialSet(evaluated);
    setManualTrialNotice(null);
  }, [
    selectedAutoFloorCandidate,
    manualAnnotation,
    imageIntrinsicSize,
    manualFrameSize,
    floorMapping.worldWidth,
    floorMapping.worldDepth,
    cameraPoseFovYDeg,
  ]);

  const handleClearManualTrials = useCallback(() => {
    manualTrialSetRef.current = null;
    setManualTrialSet(null);
    setManualTrialNotice(null);
  }, []);

  // Invalidation: ephemeral trials clear whenever the source image, selected
  // candidate, frame/display size, or manual annotation changes. A short notice
  // is surfaced so stale comparisons are never silently retained.
  useEffect(() => {
    if (manualTrialSetRef.current !== null) {
      manualTrialSetRef.current = null;
      setManualTrialSet(null);
      setManualTrialNotice(
        "Trials cleared: context changed (source image, selected candidate, frame size, or annotation)."
      );
    }
  }, [
    loadedImageUrl,
    selectedAutoFloorCandidateId,
    rendererSize.width,
    rendererSize.height,
    manualAnnotation,
  ]);

  const formatTrialPx = useCallback(
    (value: number | null | undefined) =>
      value === null || value === undefined || !Number.isFinite(value)
        ? "—"
        : `${formatNumber(value)}px`,
    []
  );

  // High-precision read-only formatter for exact sampled trial coordinates.
  const formatTrialExact = useCallback(
    (value: number | null | undefined, digits = 4) =>
      value === null || value === undefined || !Number.isFinite(value)
        ? "—"
        : value.toFixed(digits),
    []
  );

  const manualTrialView = useMemo(() => {
    if (!manualTrialSet) return null;
    const baseline = manualTrialSet.trials.find((trial) => trial.kind === "baseline") ?? null;
    const movement = manualTrialSet.trials.filter((trial) => trial.kind !== "baseline");
    const evaluable = movement.filter((trial) => trial.constraint.canEvaluate);
    const rejected = movement.filter((trial) => !trial.constraint.canEvaluate);
    const baselineCvAvgPx = baseline?.solver?.cv.averagePx ?? null;
    return { baseline, evaluable, rejected, baselineCvAvgPx };
  }, [manualTrialSet]);

  const handlePreviewTrial = useCallback((trialId: string) => {
    // Single active diagnostic preview across all three systems: activating the
    // manual-trial preview clears any active coupled-search preview AND any
    // active local-refinement preview. (Manual preview's own behavior is
    // otherwise unchanged.)
    setCoupledSearchPreviewTrialId(null);
    setCoupledSearchPreviewSignature(null);
    setLocalRefinementPreviewGeometryId(null);
    setLocalRefinementPreviewProbeId(null);
    setLocalRefinementPreviewSignature(null);
    setPreviewTrialId(trialId);
  }, []);

  const handleClearTrialPreview = useCallback(() => {
    setPreviewTrialId(null);
  }, []);

  // Invalidation: any change to the trial set identity (regenerate / clear /
  // image / candidate / frame / annotation invalidation) drops the active
  // preview so a stale trial quad can never remain attached to changed evidence.
  // Previewing does not touch manualTrialSet, so the preview persists while the
  // operator studies the current set.
  useEffect(() => {
    setPreviewTrialId(null);
  }, [manualTrialSet]);

  // Pure temporary view geometry for the previewed trial. Uses the EXACT
  // generated trial quad (container-normalized) — never a reconstruction.
  const manualTrialPreview = useMemo(() => {
    if (!manualTrialSet || !previewTrialId) return null;
    const trial = manualTrialSet.trials.find((candidate) => candidate.trialId === previewTrialId);
    if (!trial) return null;
    const cornerLabels: FloorCornerLabel[] = ["NL", "NR", "FR", "FL"];
    const movedCornerSet = new Set(trial.changedCorners);
    const pointsAttribute = trial.quadNorm
      .map((point) => `${point.x * 100},${point.y * 100}`)
      .join(" ");
    const cornerMarkers = trial.quadNorm.map((point, index) => ({
      label: cornerLabels[index],
      x: point.x * 100,
      y: point.y * 100,
      moved: movedCornerSet.has(cornerLabels[index]),
    }));
    return { trial, pointsAttribute, cornerMarkers };
  }, [manualTrialSet, previewTrialId]);

  // --- Phase 2O-H: Type A coupled diagnostic search wiring ------------------
  // Pure generation + solver-boundary evaluation live entirely in the committed
  // Phase 2O-G modules. This component only wires eligibility, a snapshot, the
  // run/clear actions, stale-state invalidation, and a read-only grouped table.
  // Nothing here mutates candidate geometry/selection, floorPolygon, FOV, floor
  // dimensions, Apply, snapshot, or scene state, and no result is ever previewed,
  // selected, promoted, applied, ranked, or persisted.

  // Geometry-change signature so coupled results clear if the selected candidate
  // quad changes even when its id does not.
  const selectedCoupledCandidateQuadSignature = useMemo(
    () =>
      selectedAutoFloorCandidate
        ? JSON.stringify(selectedAutoFloorCandidate.quadNorm)
        : null,
    [selectedAutoFloorCandidate]
  );

  const coupledSearchEligibility = useMemo<{ canRun: boolean; reason: string | null }>(() => {
    if (!selectedAutoFloorCandidate) {
      return { canRun: false, reason: "Select an Auto Floor candidate first." };
    }
    if (
      Array.isArray(selectedAutoFloorCandidate.quadNorm) === false ||
      selectedAutoFloorCandidate.quadNorm.length !== 4
    ) {
      return { canRun: false, reason: "Selected candidate has no usable floor quad." };
    }
    if (!manualAnnotationCoordsReady || !imageIntrinsicSize || !manualFrameSize) {
      return { canRun: false, reason: "Image / frame display size is not ready yet." };
    }
    if (!manualAnnotation) {
      return { canRun: false, reason: "Begin a manual annotation first." };
    }
    if (!manualAnnotationValidation || !manualAnnotationValidation.ok) {
      return { canRun: false, reason: "Annotation must pass integrity validation first." };
    }
    if (manualAnnotation.mode !== "single_corner_constrained") {
      return { canRun: false, reason: "Type A coupled search requires single-corner constrained mode." };
    }
    const authority = manualAnnotation.adjustmentAuthority;
    if (authority.kind !== "single_corner") {
      return { canRun: false, reason: "Type A coupled search requires single-corner adjustment authority." };
    }
    if (authority.corner !== "NL" && authority.corner !== "NR") {
      return { canRun: false, reason: "Type A scope adjusts only a near corner (NL or NR)." };
    }
    if (!manualAnnotation.seams.some((seam) => seam.id === authority.seamId)) {
      return { canRun: false, reason: "Authority references a seam that does not exist." };
    }
    const support = manualAnnotation.cornerSupport[authority.corner];
    if (!support || support.state !== "frame_truncated") {
      return { canRun: false, reason: `Movable corner ${authority.corner} must be marked frame_truncated.` };
    }
    if (!manualAnnotation.determiningEdge) {
      return { canRun: false, reason: "An operator-declared determining edge is required (never auto-inferred)." };
    }
    if (!Number.isFinite(floorMapping.worldWidth) || floorMapping.worldWidth <= 0) {
      return { canRun: false, reason: "Lab floor width must be positive to use as the fixed diagnostic dimension." };
    }
    if (!Number.isFinite(cameraPoseFovYDeg)) {
      return { canRun: false, reason: "Current FOV is unavailable for the diagnostic probe." };
    }
    return { canRun: true, reason: null };
  }, [
    selectedAutoFloorCandidate,
    manualAnnotationCoordsReady,
    imageIntrinsicSize,
    manualFrameSize,
    manualAnnotation,
    manualAnnotationValidation,
    floorMapping.worldWidth,
    cameraPoseFovYDeg,
  ]);

  const handleRunCoupledSearch = useCallback(() => {
    if (!coupledSearchEligibility.canRun) return;
    if (!selectedAutoFloorCandidate || !manualAnnotation || !imageIntrinsicSize || !manualFrameSize) {
      return;
    }
    const authority = manualAnnotation.adjustmentAuthority;
    if (authority.kind !== "single_corner") return;

    const candidateInput: CoupledSearchCandidate = {
      id: selectedAutoFloorCandidate.id,
      quadNorm: [
        { x: selectedAutoFloorCandidate.quadNorm[0].x, y: selectedAutoFloorCandidate.quadNorm[0].y },
        { x: selectedAutoFloorCandidate.quadNorm[1].x, y: selectedAutoFloorCandidate.quadNorm[1].y },
        { x: selectedAutoFloorCandidate.quadNorm[2].x, y: selectedAutoFloorCandidate.quadNorm[2].y },
        { x: selectedAutoFloorCandidate.quadNorm[3].x, y: selectedAutoFloorCandidate.quadNorm[3].y },
      ],
    };

    // Live lab width is the canonical fixed worldWidth for this run; depth is
    // derived per tuple from the default aspect-ratio grid (diagnostic inputs,
    // not asserted measurements). Live aspect ratio is captured only as source
    // identity, never as a search restriction.
    const config = {
      ...createDefaultCoupledSearchConfig(),
      fixedWorldWidth: floorMapping.worldWidth,
    };

    const result = runTypeACoupledSearch(
      {
        candidate: candidateInput,
        annotation: manualAnnotation,
        intrinsic: imageIntrinsicSize,
        frame: manualFrameSize,
        config,
      },
      {
        frame: manualFrameSize,
        currentVerticalFovDeg: cameraPoseFovYDeg,
        fovScanConfig: DEFAULT_COUPLED_SEARCH_FOV_SCAN_CONFIG,
      }
    );

    if (!result) {
      coupledSearchResultSetRef.current = null;
      setCoupledSearchResultSet(null);
      setCoupledSearchResultSignature(null);
      setCoupledSearchSnapshot(null);
      setCoupledSearchNotice(
        "No coupled diagnostic search was produced for the current Type A annotation."
      );
      return;
    }

    const determining = manualAnnotation.determiningEdge;
    coupledSearchResultSetRef.current = result;
    setCoupledSearchResultSet(result);
    // Stamp the CURRENT evidence signature (via ref, so it is not re-stamped on
    // later evidence changes) as this set's generation provenance.
    setCoupledSearchResultSignature(coupledSearchEvidenceSignatureRef.current);
    setCoupledSearchSnapshot({
      movableCorner: result.movableCorner,
      approvedSeamId: result.seamId,
      determiningEdgeSeamId: determining?.seamId ?? "—",
      determiningEdgeRole: determining?.role ?? "—",
      fixedWorldWidth: config.fixedWorldWidth,
      probeFovDeg: cameraPoseFovYDeg,
      liveAspectRatio:
        floorMapping.worldWidth > 0 ? floorMapping.worldDepth / floorMapping.worldWidth : Number.NaN,
    });
    setCoupledSearchNotice(null);
  }, [
    coupledSearchEligibility.canRun,
    selectedAutoFloorCandidate,
    manualAnnotation,
    imageIntrinsicSize,
    manualFrameSize,
    floorMapping.worldWidth,
    floorMapping.worldDepth,
    cameraPoseFovYDeg,
  ]);

  const handleClearCoupledSearch = useCallback(() => {
    coupledSearchResultSetRef.current = null;
    setCoupledSearchResultSet(null);
    setCoupledSearchResultSignature(null);
    setCoupledSearchSnapshot(null);
    setCoupledSearchNotice(null);
    setCoupledSearchPreviewTrialId(null);
    setCoupledSearchPreviewSignature(null);
  }, []);

  // Invalidation: coupled-search results clear whenever any source evidence
  // changes — source image, intrinsic size, render frame/crop, selected
  // candidate (id or geometry), manual annotation (seam/support/authority/
  // determining-edge are all captured by the annotation object identity), live
  // floor width/depth, or live FOV. A stale result set must never survive a
  // changed-evidence transition. Mirrors the established manualTrialSet model
  // (the Phase 2O-G result set carries no embedded evidence signature).
  useEffect(() => {
    if (coupledSearchResultSetRef.current !== null) {
      coupledSearchResultSetRef.current = null;
      setCoupledSearchResultSet(null);
      setCoupledSearchResultSignature(null);
      setCoupledSearchSnapshot(null);
      setCoupledSearchNotice(
        "Coupled diagnostics cleared: source evidence changed (image, candidate, frame, annotation, dimensions, or FOV)."
      );
    }
  }, [
    loadedImageUrl,
    imageIntrinsicSize,
    rendererSize.width,
    rendererSize.height,
    selectedAutoFloorCandidateId,
    selectedCoupledCandidateQuadSignature,
    manualAnnotation,
    floorMapping.worldWidth,
    floorMapping.worldDepth,
    cameraPoseFovYDeg,
  ]);

  const formatFovCorridor = useCallback(
    (intervals: [number, number][] | null | undefined) => {
      if (!intervals) return "—";
      if (intervals.length === 0) return "none found";
      return intervals.map(([start, end]) => (start === end ? `${start}°` : `${start}°–${end}°`)).join(", ");
    },
    []
  );

  // Neutral, categorical (NOT ranked) labels/tones per truthful primary state.
  const describeCoupledState = useCallback(
    (state: CoupledSearchPrimaryState | null): { label: string; tone: string; heading: string } => {
      switch (state) {
        case "apply_safe_diagnostic":
          return { label: "Apply-safe diagnostic", tone: "text-emerald-300", heading: "border-emerald-500/40 bg-emerald-500/5" };
        case "high_confidence_not_apply_safe":
          return { label: "high-confidence diagnostic", tone: "text-cyan-300", heading: "border-cyan-500/40 bg-cyan-500/5" };
        case "pose_poor":
          return { label: "pose available", tone: "text-amber-300", heading: "border-amber-500/40 bg-amber-500/5" };
        case "no_pose":
          return { label: "no pose", tone: "text-slate-300", heading: "border-slate-600/60 bg-slate-900/40" };
        case "invalid_geometry":
          return { label: "rejected geometry", tone: "text-rose-300", heading: "border-rose-500/40 bg-rose-500/5" };
        default:
          return { label: "unevaluated", tone: "text-slate-400", heading: "border-slate-700 bg-slate-900/40" };
      }
    },
    []
  );

  // Fixed display state grouping. Within each group, generation order is
  // preserved by the filter (no metric sort, no ranking).
  const coupledSearchView = useMemo(() => {
    if (!coupledSearchResultSet) return null;
    const order: CoupledSearchPrimaryState[] = [
      "apply_safe_diagnostic",
      "high_confidence_not_apply_safe",
      "pose_poor",
      "no_pose",
      "invalid_geometry",
    ];
    const groups = order.map((state) => ({
      state,
      trials: coupledSearchResultSet.trials.filter((trial) => trial.state === state),
    }));
    return { groups, total: coupledSearchResultSet.trials.length };
  }, [coupledSearchResultSet]);

  // --- Phase 2O-I: coupled-search exact preview -----------------------------
  // Live source-evidence signature. The active preview stores the signature in
  // effect at activation; the preview memo refuses to render when it no longer
  // matches, so a stale tuple cannot draw even before invalidation effects run.
  const coupledSearchEvidenceSignature = useMemo(
    () =>
      JSON.stringify({
        image: loadedImageUrl,
        intrinsic: imageIntrinsicSize,
        frameW: rendererSize.width,
        frameH: rendererSize.height,
        candidateId: selectedAutoFloorCandidateId,
        candidateQuad: selectedCoupledCandidateQuadSignature,
        annotation: manualAnnotation,
        worldWidth: floorMapping.worldWidth,
        worldDepth: floorMapping.worldDepth,
        fovDeg: cameraPoseFovYDeg,
      }),
    [
      loadedImageUrl,
      imageIntrinsicSize,
      rendererSize.width,
      rendererSize.height,
      selectedAutoFloorCandidateId,
      selectedCoupledCandidateQuadSignature,
      manualAnnotation,
      floorMapping.worldWidth,
      floorMapping.worldDepth,
      cameraPoseFovYDeg,
    ]
  );

  // Phase 2O-O: keep a ref mirror of the current evidence signature so the
  // generation-time stamp in handleRunCoupledSearch reads the value at run time
  // without re-stamping on later evidence changes (which must read as stale).
  useEffect(() => {
    coupledSearchEvidenceSignatureRef.current = coupledSearchEvidenceSignature;
  }, [coupledSearchEvidenceSignature]);

  // A coupled tuple is previewable only when it passed the pre-solver geometry
  // gate (so invalid-geometry / off-frame tuples are excluded) AND its exact
  // stored quad is fully in-frame [0,1]. Pose availability is irrelevant —
  // preview is geometry inspection only, never a solver endorsement.
  const isCoupledTrialPreviewable = useCallback(
    (trial: CoupledSearchResultSet["trials"][number]) => {
      if (!trial.constraint.canEvaluate) return false;
      return trial.quadNorm.every(
        (point) =>
          Number.isFinite(point.x) &&
          Number.isFinite(point.y) &&
          point.x >= 0 &&
          point.x <= 1 &&
          point.y >= 0 &&
          point.y <= 1
      );
    },
    []
  );

  const handlePreviewCoupledTrial = useCallback(
    (trialId: string) => {
      // Single active diagnostic preview across all three systems: activating a
      // coupled preview clears the manual-trial preview AND the local-refinement
      // preview.
      setPreviewTrialId(null);
      setLocalRefinementPreviewGeometryId(null);
      setLocalRefinementPreviewProbeId(null);
      setLocalRefinementPreviewSignature(null);
      setCoupledSearchPreviewTrialId(trialId);
      setCoupledSearchPreviewSignature(coupledSearchEvidenceSignature);
    },
    [coupledSearchEvidenceSignature]
  );

  const handleClearCoupledPreview = useCallback(() => {
    setCoupledSearchPreviewTrialId(null);
    setCoupledSearchPreviewSignature(null);
  }, []);

  // Invalidation: any change to the coupled result-set identity (clear, rerun,
  // or any source-evidence change that clears the set via the 2O-H effect) drops
  // the active coupled preview so a stale tuple can never remain attached to
  // changed evidence. Previewing does not touch coupledSearchResultSet, so the
  // preview persists while the operator studies the current set.
  useEffect(() => {
    setCoupledSearchPreviewTrialId(null);
    setCoupledSearchPreviewSignature(null);
  }, [coupledSearchResultSet]);

  // Pure temporary view geometry for the previewed coupled tuple. Draws ONLY
  // from the stored result record (exact quadNorm + sampledCornerMoves); never
  // recomputes tNear/aspect, never reruns the solver, never reads live FOV/dims.
  // Returns null defensively when the set/id/source-signature no longer match or
  // the tuple is not previewable.
  const coupledSearchPreview = useMemo(() => {
    if (!coupledSearchResultSet || !coupledSearchPreviewTrialId) return null;
    if (coupledSearchPreviewSignature !== coupledSearchEvidenceSignature) return null;
    const trial = coupledSearchResultSet.trials.find(
      (candidate) => candidate.trialId === coupledSearchPreviewTrialId
    );
    if (!trial) return null;
    if (!isCoupledTrialPreviewable(trial)) return null;
    const cornerLabels: FloorCornerLabel[] = ["NL", "NR", "FR", "FL"];
    const movedCornerSet = new Set(trial.changedCorners);
    const pointsAttribute = trial.quadNorm
      .map((point) => `${point.x * 100},${point.y * 100}`)
      .join(" ");
    const cornerMarkers = trial.quadNorm.map((point, index) => ({
      label: cornerLabels[index],
      x: point.x * 100,
      y: point.y * 100,
      moved: movedCornerSet.has(cornerLabels[index]),
    }));
    return { trial, pointsAttribute, cornerMarkers };
  }, [
    coupledSearchResultSet,
    coupledSearchPreviewTrialId,
    coupledSearchPreviewSignature,
    coupledSearchEvidenceSignature,
    isCoupledTrialPreviewable,
  ]);

  // --- Phase 2O-K-B: explicit-seed local refinement -------------------------
  // Per coarse row, whether it may offer the explicit "Refine around this tuple"
  // action. Requires current Type A authority/prereqs ready, valid in-frame
  // geometry with an exact stored quad + sampled corner move, an exact stored
  // probe FOV, and a NON-EMPTY high-confidence FOV corridor. Never marks any row
  // as preferred; rows without a high-confidence corridor never offer the action.
  const coupledRowSeedEligibility = useCallback(
    (trial: CoupledSearchResultSet["trials"][number]): { canSeed: boolean; reason: string | null } => {
      if (!coupledSearchEligibility.canRun) {
        return { canSeed: false, reason: "Type A authority/prerequisites not ready" };
      }
      if (!isCoupledTrialPreviewable(trial)) {
        return { canSeed: false, reason: "row geometry is not valid/in-frame" };
      }
      if (trial.sampledCornerMoves.length === 0) {
        return { canSeed: false, reason: "row has no exact sampled corner move" };
      }
      if (trial.tuple.fovDeg === null || !Number.isFinite(trial.tuple.fovDeg)) {
        return { canSeed: false, reason: "row has no stored probe FOV" };
      }
      const highConf = trial.fovCorridors?.highConfidence ?? null;
      if (!highConf || highConf.length === 0) {
        return { canSeed: false, reason: "no high-confidence FOV corridor" };
      }
      return { canSeed: true, reason: null };
    },
    [coupledSearchEligibility.canRun, isCoupledTrialPreviewable]
  );

  // --- Phase 2O-O: read-only Type A support qualification -------------------
  // Pure, memoized invocation of the committed Phase 2O-N classifier from the
  // CURRENT live evidence. This computes NOTHING itself beyond marshaling
  // read-only inputs: it never runs broad search / local refinement / solver,
  // never mutates any state, and never derives a Type B candidate independently
  // of the pure classifier.
  //
  // localSeedEligible is passed as an OBSERVED fact only when a current broad
  // result set exists (any stored coarse row that currently qualifies to seed
  // local refinement). When no current set exists it is left null (unknown) —
  // never fabricated. broadSearchEvidenceSignature is the generation-time stamp
  // (null unless a set is present), so a stale/absent set can never imply
  // exhaustion.
  const supportQualification = useMemo<TypeASupportQualification>(() => {
    const localSeedEligible = coupledSearchResultSet
      ? coupledSearchResultSet.trials.some((trial) => coupledRowSeedEligibility(trial).canSeed)
      : null;
    const candidateQuadNorm = selectedAutoFloorCandidate
      ? ([
          { x: selectedAutoFloorCandidate.quadNorm[0].x, y: selectedAutoFloorCandidate.quadNorm[0].y },
          { x: selectedAutoFloorCandidate.quadNorm[1].x, y: selectedAutoFloorCandidate.quadNorm[1].y },
          { x: selectedAutoFloorCandidate.quadNorm[2].x, y: selectedAutoFloorCandidate.quadNorm[2].y },
          { x: selectedAutoFloorCandidate.quadNorm[3].x, y: selectedAutoFloorCandidate.quadNorm[3].y },
        ] as [
          { x: number; y: number },
          { x: number; y: number },
          { x: number; y: number },
          { x: number; y: number }
        ])
      : null;
    return qualifyTypeASupport({
      annotation: manualAnnotation,
      candidateQuadNorm,
      intrinsicSize: imageIntrinsicSize,
      frameSize: manualFrameSize,
      broadSearch: coupledSearchResultSet,
      broadSearchEvidenceSignature: coupledSearchResultSignature,
      currentEvidenceSignature: coupledSearchEvidenceSignature,
      localSeedEligible,
    });
  }, [
    manualAnnotation,
    selectedAutoFloorCandidate,
    imageIntrinsicSize,
    manualFrameSize,
    coupledSearchResultSet,
    coupledSearchResultSignature,
    coupledSearchEvidenceSignature,
    coupledRowSeedEligibility,
  ]);

  // --- Phase B2: read-only Type B Operator Evidence Panel wiring ------------
  // Everything below only shapes ephemeral Type B review state and DERIVES the
  // pure B1 facts/qualification. It never runs a solver / FOV / search /
  // preview / load / Apply, never mutates candidate / floorPolygon / dimensions
  // / FOV / calibration / readiness / scene state, and never routes / switches
  // modes / persists.

  // Read-only Type A -> Type B context (descriptive only; no Type A change).
  const typeBTypeAContext = useMemo(
    () =>
      mapTypeATypeBContext(
        supportQualification.classification,
        supportQualification.broadSearchViability
      ),
    [supportQualification.classification, supportQualification.broadSearchViability]
  );

  // Type B source frame is the INTRINSIC source image (frame-stable; unaffected
  // by display-only container resize). Null until a valid image is loaded.
  const typeBSourceFrame = useMemo(
    () =>
      imageIntrinsicSize && isValidImageSize(imageIntrinsicSize)
        ? { width: imageIntrinsicSize.width, height: imageIntrinsicSize.height }
        : null,
    [imageIntrinsicSize]
  );

  // Derived image-space facts (pure B1 helper). Never stored as editable state.
  const typeBGeometryFacts = useMemo(
    () =>
      deriveTypeBGeometryFacts({
        sourceFrame: typeBSourceFrame,
        rearSeam: typeBReview.rearSeam,
        strongSideSeam: typeBReview.strongSideSeam,
      }),
    [typeBSourceFrame, typeBReview.rearSeam, typeBReview.strongSideSeam]
  );

  // Pure B1 qualification. Recomputes when declarations OR the read-only Type A
  // context change; declarations are never mutated by re-qualification.
  const typeBQualification = useMemo(
    () =>
      qualifyTypeBEvidence({
        family: "rear_seam_plus_strong_side_seam",
        sourceFrame: typeBSourceFrame,
        rearSeam: typeBReview.rearSeam,
        strongSideSeam: typeBReview.strongSideSeam,
        latentNearCornerCondition: typeBReview.latentNearCornerCondition,
        typeAContext: typeBTypeAContext,
        geometryFacts: typeBGeometryFacts,
      }),
    [
      typeBSourceFrame,
      typeBReview.rearSeam,
      typeBReview.strongSideSeam,
      typeBReview.latentNearCornerCondition,
      typeBTypeAContext,
      typeBGeometryFacts,
    ]
  );

  // Live room-geometry basis identity for invalidation (image / source frame /
  // candidate / floor polygon). Type A context and display size are excluded.
  const typeBGeometryContext = useMemo(
    () =>
      computeTypeBReviewGeometryContext({
        loadedImageUrl,
        intrinsicSize: imageIntrinsicSize,
        candidateId: selectedAutoFloorCandidateId,
        floorPolygon,
      }),
    [loadedImageUrl, imageIntrinsicSize, selectedAutoFloorCandidateId, floorPolygon]
  );

  useEffect(() => {
    typeBReviewRef.current = typeBReview;
  }, [typeBReview]);

  // --- Phase B2A: cancel ALL transient Type B interaction (armed placement +
  // active drag). Called on completion, clear, invalidation, and when review
  // goes inactive. Declared here (before the invalidation effect) so the effect
  // can depend on it without a temporal-dead-zone reference.
  const resetTypeBInteraction = useCallback(() => {
    typeBPlacementTargetRef.current = null;
    setTypeBPlacementTarget(null);
    typeBDraggingRef.current = null;
    setTypeBDraggingTarget(null);
  }, []);

  // --- Phase B3E: read-only invalidation helpers (UI state ONLY) ------------
  // These clear ONLY local Type B capture / diagnostic state. They never touch
  // calibration / candidate / polygon / FOV / dimensions / readiness / camera
  // mode, never persist, and never auto-recapture or auto-rerun.
  //
  // clearTypeBDiagnosticEnvelope clears ONLY the assembled diagnostic envelope
  // (capture-input, branch-association, topology, and policy edits, plus each
  // new capture attempt).
  const clearTypeBDiagnosticEnvelope = useCallback(() => {
    setTypeBDiagnosticEnvelope(null);
  }, []);

  // clearTypeBCaptureAndDiagnostic clears BOTH the capture result and the
  // envelope (every evidence / basis change).
  const clearTypeBCaptureAndDiagnostic = useCallback(() => {
    setTypeBCaptureResult(null);
    setTypeBDiagnosticEnvelope(null);
  }, []);

  // Capture-input mutators. Each writes the raw operator-authored value verbatim
  // and clears BOTH the capture result and the envelope, because world width,
  // authorized aspect ratios, primary product classes, and FOV probes are all
  // part of the B3D-5B captured snapshot / B3C coverage: a stale capture must
  // never survive an edit to any of them. The authored raw fields themselves
  // are NEVER cleared, and no value is normalized, sorted, deduplicated,
  // generated, interpolated, or repaired here.
  const updateTypeBWorldWidthText = useCallback(
    (text: string) => {
      setTypeBWorldWidthText(text);
      clearTypeBCaptureAndDiagnostic();
    },
    [clearTypeBCaptureAndDiagnostic]
  );
  const updateTypeBAspectRatiosText = useCallback(
    (text: string) => {
      setTypeBAspectRatiosText(text);
      clearTypeBCaptureAndDiagnostic();
    },
    [clearTypeBCaptureAndDiagnostic]
  );
  const updateTypeBFovProbesText = useCallback(
    (text: string) => {
      setTypeBFovProbesText(text);
      clearTypeBCaptureAndDiagnostic();
    },
    [clearTypeBCaptureAndDiagnostic]
  );
  const addTypeBProductClassRow = useCallback(() => {
    setTypeBProductClassRows((rows) => [...rows, { identity: "", value: "" }]);
    clearTypeBCaptureAndDiagnostic();
  }, [clearTypeBCaptureAndDiagnostic]);
  const removeTypeBProductClassRow = useCallback(
    (index: number) => {
      setTypeBProductClassRows((rows) => rows.filter((_, i) => i !== index));
      clearTypeBCaptureAndDiagnostic();
    },
    [clearTypeBCaptureAndDiagnostic]
  );
  const updateTypeBProductClassRow = useCallback(
    (index: number, patch: Partial<{ identity: string; value: string }>) => {
      setTypeBProductClassRows((rows) =>
        rows.map((row, i) => (i === index ? { ...row, ...patch } : row))
      );
      clearTypeBCaptureAndDiagnostic();
    },
    [clearTypeBCaptureAndDiagnostic]
  );
  // Branch-association-request mutators (also envelope-only).
  const toggleTypeBRequestBranchAssociation = useCallback(() => {
    setTypeBRequestBranchAssociation((on) => !on);
    clearTypeBDiagnosticEnvelope();
  }, [clearTypeBDiagnosticEnvelope]);
  const updateTypeBAssociationField = useCallback(
    (setter: (text: string) => void, text: string) => {
      setter(text);
      clearTypeBDiagnosticEnvelope();
    },
    [clearTypeBDiagnosticEnvelope]
  );

  // Invalidation: clear an active review when the underlying room-geometry basis
  // changes. When the basis is unchanged the pure reconcile returns the same
  // state reference, so this effect is a stable no-op (no update loop).
  useEffect(() => {
    const result = reconcileTypeBReviewGeometry(typeBReviewRef.current, typeBGeometryContext);
    if (result.cleared) {
      typeBReviewRef.current = result.next;
      setTypeBReview(result.next);
      setTypeBOverlayVisible(false);
      resetTypeBInteraction();
      // B3E: a review-basis reconciliation is an evidence/basis change.
      clearTypeBCaptureAndDiagnostic();
      setTypeBReviewNote(
        "Type B evidence review cleared because the underlying room geometry context changed."
      );
    }
  }, [typeBGeometryContext, resetTypeBInteraction, clearTypeBCaptureAndDiagnostic]);

  // Type A context change: retain declarations, re-qualify (handled by the memo
  // above), and surface a small note only when declarations exist.
  useEffect(() => {
    const prev = typeBPrevTypeAContextRef.current;
    typeBPrevTypeAContextRef.current = typeBTypeAContext;
    if (prev === null || prev === typeBTypeAContext) return;
    const current = typeBReviewRef.current;
    if (current.rearSeam !== null || current.strongSideSeam !== null) {
      setTypeBReviewNote(
        "Type A context changed. Type B qualification was re-evaluated from the same declared evidence."
      );
    }
  }, [typeBTypeAContext]);

  const handleBeginTypeBReview = useCallback(() => {
    const started = beginTypeBReview(
      computeTypeBReviewGeometryContext({
        loadedImageUrl,
        intrinsicSize: imageIntrinsicSize,
        candidateId: selectedAutoFloorCandidateId,
        floorPolygon,
      })
    );
    typeBReviewRef.current = started;
    setTypeBReview(started);
    // B3E: beginning a review is an evidence change.
    clearTypeBCaptureAndDiagnostic();
    setTypeBReviewNote(null);
  }, [
    loadedImageUrl,
    imageIntrinsicSize,
    selectedAutoFloorCandidateId,
    floorPolygon,
    clearTypeBCaptureAndDiagnostic,
  ]);

  const handleClearTypeBReview = useCallback(() => {
    const empty = createEmptyTypeBReviewState();
    typeBReviewRef.current = empty;
    setTypeBReview(empty);
    setTypeBOverlayVisible(false);
    resetTypeBInteraction();
    // B3E: clearing the review is an evidence change.
    clearTypeBCaptureAndDiagnostic();
    setTypeBReviewNote("Type B evidence review cleared.");
  }, [resetTypeBInteraction, clearTypeBCaptureAndDiagnostic]);

  const updateTypeBRearSeam = useCallback(
    (patch: Partial<TypeBDeclaredLineEvidence>) => {
      setTypeBReview((s) => ({
        ...s,
        rearSeam: applyDeclaredLinePatch(s.rearSeam, "rear_floor_wall_seam", patch),
      }));
      // B3E: a rear-seam edit is an evidence change.
      clearTypeBCaptureAndDiagnostic();
    },
    [clearTypeBCaptureAndDiagnostic]
  );

  const updateTypeBSideSeam = useCallback(
    (patch: Partial<TypeBDeclaredLineEvidence>) => {
      setTypeBReview((s) => ({
        ...s,
        strongSideSeam: applyDeclaredLinePatch(s.strongSideSeam, null, patch),
      }));
      // B3E: a strong-side-seam edit is an evidence change.
      clearTypeBCaptureAndDiagnostic();
    },
    [clearTypeBCaptureAndDiagnostic]
  );

  const setTypeBLatentCondition = useCallback(
    (condition: TypeBLatentNearCornerCondition) => {
      setTypeBReview((s) => ({ ...s, latentNearCornerCondition: condition }));
      // B3E: a latent-condition edit is an evidence change.
      clearTypeBCaptureAndDiagnostic();
    },
    [clearTypeBCaptureAndDiagnostic]
  );

  // --- Phase B2A: direct-overlay placement / drag interaction --------------
  // Keep the placement-target ref in sync so pointer handlers read a stable
  // value without being re-created on every arm/disarm.
  useEffect(() => {
    typeBPlacementTargetRef.current = typeBPlacementTarget;
  }, [typeBPlacementTarget]);

  // Arm / toggle a single placement target. Only one target may be armed; the
  // same button toggles it off. Arming NEVER alters any declaration.
  const armTypeBPlacementTarget = useCallback((target: TypeBEndpointTarget) => {
    setTypeBPlacementTarget((current) => (current === target ? null : target));
  }, []);

  const cancelTypeBPlacement = useCallback(() => {
    setTypeBPlacementTarget(null);
  }, []);

  // Converts a pointer client position to source-normalized image coordinates
  // using the SAME object-cover crop helpers as the manual (Type A) overlay, so
  // stored Type B endpoints stay aligned across resize / cover-crop and are
  // never viewport-relative. Returns null on invalid geometry / non-finite.
  const clientToTypeBSourceNorm = useCallback(
    (clientX: number, clientY: number): SourceNormPoint | null => {
      const overlay = typeBOverlayRef.current;
      if (!overlay || !imageIntrinsicSize || !manualFrameSize) return null;
      const rect = overlay.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      const containerNorm = {
        x: clampValue((clientX - rect.left) / rect.width, 0, 1),
        y: clampValue((clientY - rect.top) / rect.height, 0, 1),
      };
      return containerNormToSourceNorm(containerNorm, imageIntrinsicSize, manualFrameSize);
    },
    [imageIntrinsicSize, manualFrameSize]
  );

  // Armed placement: the next valid overlay click declares ONLY the armed
  // endpoint, then placement exits immediately (one click). An invalid/non-
  // finite conversion never mutates evidence (still consumes the click).
  const handleTypeBOverlayPointerDown = useCallback(
    (event: PointerEvent<SVGSVGElement>) => {
      const target = typeBPlacementTargetRef.current;
      if (!target) return;
      event.stopPropagation();
      event.preventDefault();
      setTypeBPlacementTarget(null);
      const point = clientToTypeBSourceNorm(event.clientX, event.clientY);
      if (!point) return;
      setTypeBReview((s) => patchTypeBReviewEndpoint(s, target, point).next);
      // B3E: a direct endpoint patch is an evidence change.
      clearTypeBCaptureAndDiagnostic();
    },
    [clientToTypeBSourceNorm, clearTypeBCaptureAndDiagnostic]
  );

  // Begin dragging a declared endpoint handle. Takes precedence over floor /
  // background interaction via stopPropagation + pointer capture.
  const handleTypeBHandlePointerDown = useCallback(
    (event: PointerEvent<SVGCircleElement>, target: TypeBEndpointTarget) => {
      if (typeBPlacementTargetRef.current) return;
      event.stopPropagation();
      event.preventDefault();
      typeBDraggingRef.current = { target, pointerId: event.pointerId };
      setTypeBDraggingTarget(target);
      try {
        typeBOverlayRef.current?.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is optional; dragging continues while in bounds.
      }
    },
    []
  );

  const handleTypeBOverlayPointerMove = useCallback(
    (event: PointerEvent<SVGSVGElement>) => {
      const dragging = typeBDraggingRef.current;
      if (!dragging) return;
      const point = clientToTypeBSourceNorm(event.clientX, event.clientY);
      if (!point) return;
      setTypeBReview((s) => patchTypeBReviewEndpoint(s, dragging.target, point).next);
      // B3E: endpoint drag movement is an evidence change.
      clearTypeBCaptureAndDiagnostic();
    },
    [clientToTypeBSourceNorm, clearTypeBCaptureAndDiagnostic]
  );

  const handleTypeBOverlayPointerUp = useCallback(
    (event: PointerEvent<SVGSVGElement>) => {
      const dragging = typeBDraggingRef.current;
      if (dragging && dragging.pointerId === event.pointerId) {
        try {
          typeBOverlayRef.current?.releasePointerCapture(event.pointerId);
        } catch {
          // Ignore release failures when capture is already cleared.
        }
        typeBDraggingRef.current = null;
        setTypeBDraggingTarget(null);
      }
    },
    []
  );

  // When the review becomes inactive (never begun / cleared) cancel any lingering
  // armed placement or drag so transient interaction can never outlive the review.
  useEffect(() => {
    if (!typeBReview.begun) {
      resetTypeBInteraction();
    }
  }, [typeBReview.begun, resetTypeBInteraction]);

  // Panel teardown / unmount: drop transient interaction (never persisted).
  useEffect(() => resetTypeBInteraction, [resetTypeBInteraction]);

  // Declared-only overlay geometry projected into container-normalized viewBox
  // percentages. Uses ONLY declared endpoints (never extended / intersected).
  const typeBOverlayRender = useMemo(() => {
    if (!imageIntrinsicSize || !manualFrameSize) return null;
    const segments = buildTypeBDeclaredSegments(
      typeBReview.rearSeam,
      typeBReview.strongSideSeam
    );
    if (segments.length === 0) return null;
    const toPct = (point: { x: number; y: number }) => {
      const container = sourceNormToContainerNorm(point, imageIntrinsicSize, manualFrameSize);
      return container ? { x: container.x * 100, y: container.y * 100 } : null;
    };
    const lines = segments
      .map((seg) => {
        const seam = seg.role === "rear" ? typeBReview.rearSeam : typeBReview.strongSideSeam;
        const start = toPct(seg.start);
        const end = toPct(seg.end);
        if (!start || !end || !seam) return null;
        return {
          role: seg.role,
          start,
          end,
          startStatus: seam.startEndpointStatus,
          endStatus: seam.endEndpointStatus,
        };
      })
      .filter((line): line is NonNullable<typeof line> => line !== null);
    const junctionPts = findTypeBSharedJunctionEndpoints(
      typeBReview.rearSeam,
      typeBReview.strongSideSeam
    );
    let junction: { a: { x: number; y: number }; b: { x: number; y: number } } | null = null;
    if (junctionPts) {
      const a = toPct(junctionPts.a);
      const b = toPct(junctionPts.b);
      if (a && b) junction = { a, b };
    }
    return { lines, junction };
  }, [imageIntrinsicSize, manualFrameSize, typeBReview.rearSeam, typeBReview.strongSideSeam]);

  // --- Phase B2A: draggable handle positions for DECLARED endpoints ONLY.
  // One handle per exactly-declared, finite endpoint (never a virtual/inferred
  // endpoint). Projected into container-normalized viewBox percentages with the
  // shared cover-crop helper so handles track the stored source-space coords.
  const typeBEndpointHandles = useMemo(() => {
    if (!imageIntrinsicSize || !manualFrameSize) {
      return [] as {
        target: TypeBEndpointTarget;
        role: "rear" | "side";
        x: number;
        y: number;
      }[];
    }
    const toPct = (point: { x: number; y: number }) => {
      const container = sourceNormToContainerNorm(point, imageIntrinsicSize, manualFrameSize);
      return container ? { x: container.x * 100, y: container.y * 100 } : null;
    };
    const isFiniteVec = (p: { x: number; y: number } | undefined | null) =>
      !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
    const handles: {
      target: TypeBEndpointTarget;
      role: "rear" | "side";
      x: number;
      y: number;
    }[] = [];
    const pushEndpoint = (
      seam: TypeBDeclaredLineEvidence | null,
      role: "rear" | "side",
      startTarget: TypeBEndpointTarget,
      endTarget: TypeBEndpointTarget
    ) => {
      if (!seam || !isFiniteVec(seam.startNorm) || !isFiniteVec(seam.endNorm)) return;
      const start = toPct(seam.startNorm);
      const end = toPct(seam.endNorm);
      if (start) handles.push({ target: startTarget, role, x: start.x, y: start.y });
      if (end) handles.push({ target: endTarget, role, x: end.x, y: end.y });
    };
    pushEndpoint(typeBReview.rearSeam, "rear", "rear_start", "rear_end");
    pushEndpoint(typeBReview.strongSideSeam, "side", "side_start", "side_end");
    return handles;
  }, [imageIntrinsicSize, manualFrameSize, typeBReview.rearSeam, typeBReview.strongSideSeam]);

  const typeBReviewActive = typeBReview.begun;
  const typeBHasDeclaredGeometry = typeBReviewHasDeclaredGeometry(typeBReview);

  // --- Phase B3E: explicit capture + diagnostic run wiring ------------------
  // Both actions happen ONLY on an explicit operator click; NEVER from an
  // effect, input change, panel expansion, image change, or capture success.
  // Neither mutates review / candidate / polygon / FOV / dimensions / readiness
  // / camera mode, and neither persists.

  // Branch-association raw fields are complete only when the toggle is OFF, or
  // ON with every required field nonblank. The UI validates NOTHING else about
  // topology / policy semantics; parsed values (including NaN) pass through so
  // B3D-2 returns its own honest non-assessment result.
  const typeBBranchFieldsComplete =
    !typeBRequestBranchAssociation ||
    [
      typeBTopologyOrderedProbesText,
      typeBTopologyStepText,
      typeBPolicyMaxPosText,
      typeBPolicyMaxRotText,
      typeBPolicyTiePosText,
      typeBPolicyTieRotText,
      typeBPolicyNearPosText,
      typeBPolicyNearRotText,
    ].every(typeBFieldPresent);

  const handleCaptureTypeBInputs = useCallback(() => {
    // Explicit Type B-only coverage, built VERBATIM from raw authored fields.
    const explicitInputs = {
      worldWidth: parseTypeBNumberField(typeBWorldWidthText),
      authorizedAspectRatios: parseTypeBNumberListField(typeBAspectRatiosText),
      primaryProductClasses: typeBProductClassRows.map((row) => ({
        primaryProductClassIdentity: row.identity,
        latentDepthProduct: {
          formulaId: TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA,
          value: parseTypeBNumberField(row.value),
        },
      })),
      fovProbesDeg: parseTypeBNumberListField(typeBFovProbesText),
    };

    // The capture input is built from LIVE Type B review facts. Missing / blank
    // / invalid live facts reach capture UNCHANGED (no invented fallback), so
    // the pure evaluator refuses honestly. The single cast forwards the live
    // (possibly nullable) values to the defensively-guarded pure evaluator,
    // which reads every field via a safe record accessor and never throws.
    const captureInput = {
      basis: {
        sourceImageIdentity: typeBGeometryContext.sourceImageIdentity,
        sourceFrameKey: typeBGeometryContext.sourceFrameKey,
        sourceFrame: typeBSourceFrame,
        candidateIdentity: typeBGeometryContext.candidateIdentity,
        floorPolygonKey: typeBGeometryContext.floorPolygonKey,
      },
      rearSeam: typeBReview.rearSeam,
      strongSideSeam: typeBReview.strongSideSeam,
      latentNearCornerCondition: typeBReview.latentNearCornerCondition,
      typeAContext: typeBTypeAContext,
      b1Qualification: typeBQualification,
      explicitInputs,
      // Constructed ONLY at this explicit operator click.
      capturedAtIso: new Date().toISOString(),
    } as unknown as TypeBSnapshotAndCoverageCaptureInput;

    const result = captureTypeBSnapshotAndCoverage(captureInput);
    // Store the exact result; a new capture attempt clears any prior envelope.
    setTypeBCaptureResult(result);
    clearTypeBDiagnosticEnvelope();
  }, [
    typeBWorldWidthText,
    typeBAspectRatiosText,
    typeBProductClassRows,
    typeBFovProbesText,
    typeBGeometryContext,
    typeBSourceFrame,
    typeBReview.rearSeam,
    typeBReview.strongSideSeam,
    typeBReview.latentNearCornerCondition,
    typeBTypeAContext,
    typeBQualification,
    clearTypeBDiagnosticEnvelope,
  ]);

  const typeBRunEnabled =
    typeBCaptureResult?.status === "captured" &&
    typeBReviewActive &&
    typeBBranchFieldsComplete;

  const handleRunTypeBDiagnostic = useCallback(() => {
    const capture = typeBCaptureResult;
    if (!capture || capture.status !== "captured") return;
    if (!typeBReviewActive) return;
    if (typeBRequestBranchAssociation && !typeBBranchFieldsComplete) return;

    // B3C tuple generation from the frozen captured snapshot + coverage.
    const tupleGeneration = generateTypeBBoundedDiagnosticTuples(
      capture.snapshot,
      capture.coverage
    );

    // Explicit topology + policy request (verbatim; NaN passes through) only
    // when association is ON; otherwise null. The UI supplies NO defaults.
    const envelope = assembleTypeBDiagnosticRun({
      snapshot: capture.snapshot,
      tupleGeneration,
      branchAssociation: typeBRequestBranchAssociation
        ? {
            topology: {
              schema: "vibode-type-b-fov-probe-topology/v0",
              orderedProbesDeg: parseTypeBNumberListField(
                typeBTopologyOrderedProbesText
              ),
              stepDeg: parseTypeBNumberField(typeBTopologyStepText),
            },
            policy: {
              schema: "vibode-type-b-branch-association-policy/v0",
              maxNormalizedCameraPositionDelta: parseTypeBNumberField(
                typeBPolicyMaxPosText
              ),
              maxRotationDeltaDeg: parseTypeBNumberField(typeBPolicyMaxRotText),
              tieMarginNormalizedCameraPosition: parseTypeBNumberField(
                typeBPolicyTiePosText
              ),
              tieMarginRotationDeg: parseTypeBNumberField(typeBPolicyTieRotText),
              nearCoincidentNormalizedCameraPositionDelta: parseTypeBNumberField(
                typeBPolicyNearPosText
              ),
              nearCoincidentRotationDeltaDeg: parseTypeBNumberField(
                typeBPolicyNearRotText
              ),
            },
          }
        : null,
    });

    // Store the returned envelope exactly. Capture result is left untouched.
    setTypeBDiagnosticEnvelope(envelope);
  }, [
    typeBCaptureResult,
    typeBReviewActive,
    typeBRequestBranchAssociation,
    typeBBranchFieldsComplete,
    typeBTopologyOrderedProbesText,
    typeBTopologyStepText,
    typeBPolicyMaxPosText,
    typeBPolicyMaxRotText,
    typeBPolicyTiePosText,
    typeBPolicyTieRotText,
    typeBPolicyNearPosText,
    typeBPolicyNearRotText,
  ]);

  // Explicit control: clear ONLY the capture result + envelope. It must NOT
  // clear the operator's evidence declarations or authored input fields.
  const handleClearTypeBCaptureResults = useCallback(() => {
    clearTypeBCaptureAndDiagnostic();
  }, [clearTypeBCaptureAndDiagnostic]);

  // Read-only projection of the current capture + envelope into safe display
  // rows. Pure; recomputed only when the stored results change.
  const typeBDiagnosticPresentation = useMemo(
    () =>
      presentTypeBDiagnosticRun({
        capture: typeBCaptureResult,
        envelope: typeBDiagnosticEnvelope,
      }),
    [typeBCaptureResult, typeBDiagnosticEnvelope]
  );

  // Brief literal run-state text.
  const typeBRunStateText =
    typeBCaptureResult === null
      ? "No captured inputs."
      : typeBCaptureResult.status === "refused"
        ? "Capture refused."
        : typeBRequestBranchAssociation && !typeBBranchFieldsComplete
          ? "Captured. Association request incomplete."
          : typeBDiagnosticEnvelope !== null
            ? "Diagnostic run stored."
            : "Captured.";

  // Explicit operator action: seed a bounded local refinement from ONE stored
  // coarse row. Builds the K-A seed from the EXACT stored coarse record (never
  // recomputed), runs the committed helper with its default bounded config, and
  // stores ONLY the returned diagnostic set. Does NOT touch the coupled set,
  // manual trials, or either preview system, and never auto-previews.
  const handleRunLocalRefinement = useCallback(
    (trial: CoupledSearchResultSet["trials"][number]) => {
      if (!coupledSearchResultSet) return;
      if (!coupledRowSeedEligibility(trial).canSeed) return;
      if (!selectedAutoFloorCandidate || !manualAnnotation || !imageIntrinsicSize || !manualFrameSize) {
        return;
      }
      const authority = manualAnnotation.adjustmentAuthority;
      if (authority.kind !== "single_corner") return;
      // Defensive: the chosen row must still belong to the current authority.
      if (trial.movableCorner !== authority.corner || trial.seamId !== authority.seamId) {
        setLocalRefinementNotice("Selected coarse row no longer matches the current Type A authority.");
        return;
      }
      if (trial.tuple.fovDeg === null) return;

      const candidateInput: CoupledSearchCandidate = {
        id: selectedAutoFloorCandidate.id,
        quadNorm: [
          { x: selectedAutoFloorCandidate.quadNorm[0].x, y: selectedAutoFloorCandidate.quadNorm[0].y },
          { x: selectedAutoFloorCandidate.quadNorm[1].x, y: selectedAutoFloorCandidate.quadNorm[1].y },
          { x: selectedAutoFloorCandidate.quadNorm[2].x, y: selectedAutoFloorCandidate.quadNorm[2].y },
          { x: selectedAutoFloorCandidate.quadNorm[3].x, y: selectedAutoFloorCandidate.quadNorm[3].y },
        ],
      };

      // Seed = EXACT stored coarse provenance (tNear/aspect/width/depth/probe FOV
      // /corridors/corner/seam), plus the operator-declared determining edge.
      const seed: LocalRefinementSeed = {
        sourceCandidateId: trial.sourceCandidateId,
        movableCorner: trial.movableCorner,
        seamId: trial.seamId,
        determiningEdge: manualAnnotation.determiningEdge,
        coarseTuple: {
          tNear: trial.tuple.tNear,
          aspectRatio: trial.tuple.aspectRatio,
          fixedWorldWidth: trial.worldWidth,
          worldDepth: trial.worldDepth,
          probeFovDeg: trial.tuple.fovDeg,
          coarseFovCorridors: trial.fovCorridors,
        },
      };

      const result = runTypeALocalRefinement(
        {
          candidate: candidateInput,
          annotation: manualAnnotation,
          seed,
          intrinsic: imageIntrinsicSize,
          frame: manualFrameSize,
        },
        {
          frame: manualFrameSize,
          fovScanConfig: DEFAULT_LOCAL_REFINEMENT_FOV_SCAN_CONFIG,
        }
      );

      if (!result) {
        localRefinementResultSetRef.current = null;
        setLocalRefinementResultSet(null);
        setLocalRefinementSeedTrialId(null);
        setLocalRefinementSignature(null);
        setLocalRefinementNotice(
          "No local refinement was produced for the selected coarse tuple."
        );
        return;
      }

      localRefinementResultSetRef.current = result;
      setLocalRefinementResultSet(result);
      setLocalRefinementSeedTrialId(trial.trialId);
      setLocalRefinementSignature(coupledSearchEvidenceSignature);
      setLocalRefinementNotice(null);
      setIsLocalRefinementOpen(true);
    },
    [
      coupledSearchResultSet,
      coupledRowSeedEligibility,
      selectedAutoFloorCandidate,
      manualAnnotation,
      imageIntrinsicSize,
      manualFrameSize,
      coupledSearchEvidenceSignature,
    ]
  );

  const handleClearLocalRefinement = useCallback(() => {
    localRefinementResultSetRef.current = null;
    setLocalRefinementResultSet(null);
    setLocalRefinementSeedTrialId(null);
    setLocalRefinementSignature(null);
    setLocalRefinementNotice(null);
  }, []);

  // Invalidation: local refinement clears whenever any source evidence changes
  // (same evidence set as the coupled-search invalidation) OR the broad coupled
  // result-set identity changes (broad clear/rerun). The seed is provenance from
  // a specific coarse set; if that set is replaced or evidence shifts, the local
  // result is stale and must not survive the transition.
  useEffect(() => {
    if (localRefinementResultSetRef.current !== null) {
      localRefinementResultSetRef.current = null;
      setLocalRefinementResultSet(null);
      setLocalRefinementSeedTrialId(null);
      setLocalRefinementSignature(null);
      setLocalRefinementNotice(
        "Local refinement cleared: source evidence or broad coupled diagnostics changed."
      );
    }
  }, [
    loadedImageUrl,
    imageIntrinsicSize,
    rendererSize.width,
    rendererSize.height,
    selectedAutoFloorCandidateId,
    selectedCoupledCandidateQuadSignature,
    manualAnnotation,
    floorMapping.worldWidth,
    floorMapping.worldDepth,
    cameraPoseFovYDeg,
    coupledSearchResultSet,
  ]);

  // Defensive render-time guard + fixed-order grouping for the local geometry
  // tuples. Returns null when the local result is stale: signature mismatch, the
  // broad coupled set is gone, or the chosen seed row no longer exists in it.
  // This blocks a stale local result from rendering even before effects flush.
  const localRefinementView = useMemo(() => {
    if (!localRefinementResultSet) return null;
    if (localRefinementSignature !== coupledSearchEvidenceSignature) return null;
    if (!coupledSearchResultSet) return null;
    if (
      localRefinementSeedTrialId &&
      !coupledSearchResultSet.trials.some((trial) => trial.trialId === localRefinementSeedTrialId)
    ) {
      return null;
    }
    const order: CoupledSearchPrimaryState[] = [
      "apply_safe_diagnostic",
      "high_confidence_not_apply_safe",
      "pose_poor",
      "no_pose",
      "invalid_geometry",
    ];
    const groups = order.map((state) => ({
      state,
      tuples: localRefinementResultSet.geometryTuples.filter((tuple) => tuple.state === state),
    }));
    return { groups, total: localRefinementResultSet.geometryTuples.length };
  }, [
    localRefinementResultSet,
    localRefinementSignature,
    coupledSearchEvidenceSignature,
    coupledSearchResultSet,
    localRefinementSeedTrialId,
  ]);

  // --- Phase 2O-K-C: local refinement exact preview -------------------------
  // A stored local geometry tuple is previewable only when it passed the
  // pre-solver geometry gate AND its exact stored quad is fully in-frame [0,1].
  // Pose/probe availability is irrelevant — preview is geometry inspection only,
  // never a solver endorsement and never an Apply-safe privilege.
  const isLocalTuplePreviewable = useCallback(
    (tuple: LocalRefinementResultSet["geometryTuples"][number]) => {
      if (!tuple.constraint.canEvaluate) return false;
      if (tuple.sampledCornerMoves.length === 0) return false;
      return tuple.quadNorm.every(
        (point) =>
          Number.isFinite(point.x) &&
          Number.isFinite(point.y) &&
          point.x >= 0 &&
          point.x <= 1 &&
          point.y >= 0 &&
          point.y <= 1
      );
    },
    []
  );

  // Explicit operator action: preview ONE stored local direct FOV probe. Clears
  // the manual and coupled previews (single active preview policy) and pins the
  // local preview to the current evidence signature. Stores ONLY ids; the exact
  // geometry/probe are always resolved from the stored result set below.
  const handlePreviewLocalProbe = useCallback(
    (geometryTupleId: string, probeId: string) => {
      setPreviewTrialId(null);
      setCoupledSearchPreviewTrialId(null);
      setCoupledSearchPreviewSignature(null);
      setLocalRefinementPreviewGeometryId(geometryTupleId);
      setLocalRefinementPreviewProbeId(probeId);
      setLocalRefinementPreviewSignature(coupledSearchEvidenceSignature);
    },
    [coupledSearchEvidenceSignature]
  );

  const handleClearLocalPreview = useCallback(() => {
    setLocalRefinementPreviewGeometryId(null);
    setLocalRefinementPreviewProbeId(null);
    setLocalRefinementPreviewSignature(null);
  }, []);

  // Invalidation: drop the active local preview on any source-evidence change
  // (same set as the local-refinement invalidation), on broad coupled set
  // identity change (clear/rerun), and on local result-set identity change
  // (local clear/rerun). The render-time resolver below additionally guards the
  // window before this effect flushes, so a stale overlay/detail can never draw.
  useEffect(() => {
    setLocalRefinementPreviewGeometryId(null);
    setLocalRefinementPreviewProbeId(null);
    setLocalRefinementPreviewSignature(null);
  }, [
    loadedImageUrl,
    imageIntrinsicSize,
    rendererSize.width,
    rendererSize.height,
    selectedAutoFloorCandidateId,
    selectedCoupledCandidateQuadSignature,
    manualAnnotation,
    floorMapping.worldWidth,
    floorMapping.worldDepth,
    cameraPoseFovYDeg,
    coupledSearchResultSet,
    localRefinementResultSet,
  ]);

  // Pure temporary view geometry for the previewed local probe. Resolves ONLY
  // from stored records (parent tuple exact quadNorm + sampledCornerMoves, and
  // the selected stored probe). Never resamples a seam, reruns the solver, reads
  // live FOV/dims, or derives a new quad. Returns null defensively when the
  // local set / seed row / evidence signature no longer match, the parent tuple
  // or probe is missing, or the parent geometry is not previewable.
  const localRefinementPreview = useMemo(() => {
    if (!localRefinementResultSet) return null;
    if (!localRefinementPreviewGeometryId || !localRefinementPreviewProbeId) return null;
    // Preview must match BOTH the evidence at activation and the evidence that
    // produced the stored local set.
    if (localRefinementPreviewSignature !== coupledSearchEvidenceSignature) return null;
    if (localRefinementSignature !== coupledSearchEvidenceSignature) return null;
    // The stored local result is provenance from a specific coarse set + row.
    if (!coupledSearchResultSet) return null;
    if (
      localRefinementSeedTrialId &&
      !coupledSearchResultSet.trials.some((trial) => trial.trialId === localRefinementSeedTrialId)
    ) {
      return null;
    }
    const tuple = localRefinementResultSet.geometryTuples.find(
      (candidate) => candidate.geometryTupleId === localRefinementPreviewGeometryId
    );
    if (!tuple) return null;
    const probe = tuple.probes.find((candidate) => candidate.probeId === localRefinementPreviewProbeId);
    if (!probe) return null;
    if (!Number.isFinite(probe.fovDeg)) return null;
    if (!isLocalTuplePreviewable(tuple)) return null;
    const cornerLabels: FloorCornerLabel[] = ["NL", "NR", "FR", "FL"];
    const movedCornerSet = new Set(tuple.changedCorners);
    const pointsAttribute = tuple.quadNorm
      .map((point) => `${point.x * 100},${point.y * 100}`)
      .join(" ");
    const cornerMarkers = tuple.quadNorm.map((point, index) => ({
      label: cornerLabels[index],
      x: point.x * 100,
      y: point.y * 100,
      moved: movedCornerSet.has(cornerLabels[index]),
    }));
    return { tuple, probe, pointsAttribute, cornerMarkers };
  }, [
    localRefinementResultSet,
    localRefinementPreviewGeometryId,
    localRefinementPreviewProbeId,
    localRefinementPreviewSignature,
    localRefinementSignature,
    coupledSearchEvidenceSignature,
    coupledSearchResultSet,
    localRefinementSeedTrialId,
    isLocalTuplePreviewable,
  ]);

  // --- Phase 2O-L-A: controlled load of one stored tuple into live controls --
  // Signature of the exact live values a load writes. Used to keep the success
  // receipt only while the live controls still equal the loaded tuple/probe; any
  // later live-control or evidence change diverges and clears the receipt. Key
  // order MUST match the signature built in handleLoadLocalProbeIntoLiveControls.
  const localTupleLoadLiveSignature = useMemo(
    () =>
      JSON.stringify({
        polygon: floorPolygon,
        width: floorMapping.worldWidth,
        depth: floorMapping.worldDepth,
        fov: cameraPoseFovYDeg,
        candidateId: selectedAutoFloorCandidateId,
        candidateQuad: selectedCoupledCandidateQuadSignature,
        annotation: manualAnnotation,
        image: loadedImageUrl,
        intrinsic: imageIntrinsicSize,
        frameW: rendererSize.width,
        frameH: rendererSize.height,
        calibratedActive: isCalibratedCameraActive,
      }),
    [
      floorPolygon,
      floorMapping.worldWidth,
      floorMapping.worldDepth,
      cameraPoseFovYDeg,
      selectedAutoFloorCandidateId,
      selectedCoupledCandidateQuadSignature,
      manualAnnotation,
      loadedImageUrl,
      imageIntrinsicSize,
      rendererSize.width,
      rendererSize.height,
      isCalibratedCameraActive,
    ]
  );

  // Clear the informational receipt as soon as the live controls/evidence no
  // longer match what was loaded (image/frame/intrinsic, candidate/geometry,
  // annotation/seam/support/authority, live width/depth/FOV, revert to legacy
  // camera, or a later load that writes a new signature). Independent of the
  // local result set, so it survives the normal post-load diagnostic clear.
  useEffect(() => {
    if (localTupleLoadReceipt && localTupleLoadReceipt.signature !== localTupleLoadLiveSignature) {
      setLocalTupleLoadReceipt(null);
    }
  }, [localTupleLoadLiveSignature, localTupleLoadReceipt]);

  // Controlled convenience action: copy ONE exact, currently-previewed,
  // Apply-safe local direct probe into the live editable controls. The handler
  // RE-CHECKS every safety condition before writing any live state (no bypass):
  // calibrated camera inactive; an active local preview that is exactly the
  // clicked tuple+probe; probe state apply_safe_diagnostic with Apply-gate
  // available and finite FOV; parent geometry exact, finite, fully in-frame. It
  // writes only floor polygon / world width / world depth / live FOV (each from
  // the EXACT stored record), never calibration, candidate, annotation, scene,
  // or persistence. It does NOT apply calibration or invoke Scan & Apply.
  const handleLoadLocalProbeIntoLiveControls = useCallback(
    (geometryTupleId: string, probeId: string) => {
      if (isCalibratedCameraActive) return;
      const preview = localRefinementPreview;
      if (!preview) return;
      if (preview.tuple.geometryTupleId !== geometryTupleId) return;
      if (preview.probe.probeId !== probeId) return;
      const { tuple, probe } = preview;
      if (probe.state !== "apply_safe_diagnostic") return;
      if (!probe.applyGateAvailable) return;
      if (!Number.isFinite(probe.fovDeg)) return;
      if (!tuple.constraint.canEvaluate) return;
      if (tuple.sampledCornerMoves.length === 0) return;
      const quadInFrame = tuple.quadNorm.every(
        (point) =>
          Number.isFinite(point.x) &&
          Number.isFinite(point.y) &&
          point.x >= 0 &&
          point.x <= 1 &&
          point.y >= 0 &&
          point.y <= 1
      );
      if (!quadInFrame) return;

      // Clear all three temporary previews before the controlled live writes.
      setPreviewTrialId(null);
      setCoupledSearchPreviewTrialId(null);
      setCoupledSearchPreviewSignature(null);
      setLocalRefinementPreviewGeometryId(null);
      setLocalRefinementPreviewProbeId(null);
      setLocalRefinementPreviewSignature(null);

      // Mirror manual-geometry-change safety (cancel any pending calibration
      // restore), exactly as the manual polygon-reset path does.
      cancelPendingCalibrationRestoreAfterManualGeometryChange();

      // floor polygon <- EXACT stored local tuple quad (clone; canonical
      // [NL, NR, FR, FL], same as the existing "Apply suggested quad" path).
      const loadedPolygon: FloorPoint[] = tuple.quadNorm.map((point) => ({ x: point.x, y: point.y }));
      setFloorPolygon(loadedPolygon);
      setActiveFloorHandleIndex(null);

      // live width/depth <- EXACT stored diagnostic dims, clamped to the SAME
      // limits a manual edit uses (no new thresholds introduced).
      const loadedWidth = clampValue(
        tuple.worldWidth,
        FLOOR_MAPPING_LIMITS.worldWidth.min,
        FLOOR_MAPPING_LIMITS.worldWidth.max
      );
      const loadedDepth = clampValue(
        tuple.worldDepth,
        FLOOR_MAPPING_LIMITS.worldDepth.min,
        FLOOR_MAPPING_LIMITS.worldDepth.max
      );
      const nextMapping = { ...floorMapping, worldWidth: loadedWidth, worldDepth: loadedDepth };
      setFloorMapping(nextMapping);
      if (lastAcceptedFloorClick) {
        const mapped = mapFloorPointToObjectTransform(lastAcceptedFloorClick, nextMapping);
        updateTransformState(
          (current) => ({ ...current, positionX: mapped.positionX, positionZ: mapped.positionZ }),
          { markOwned: true }
        );
      }

      // live FOV <- EXACT stored probe FOV (direct set, mirroring the existing
      // "Use recommended FOV" control; never the live FOV).
      setCameraPoseFovYDeg(probe.fovDeg);

      // Informational receipt only. Its signature is computed from the values
      // just written so it persists through this load but clears on the next
      // unrelated change. Key order MUST match localTupleLoadLiveSignature.
      const signature = JSON.stringify({
        polygon: loadedPolygon,
        width: loadedWidth,
        depth: loadedDepth,
        fov: probe.fovDeg,
        candidateId: selectedAutoFloorCandidateId,
        candidateQuad: selectedCoupledCandidateQuadSignature,
        annotation: manualAnnotation,
        image: loadedImageUrl,
        intrinsic: imageIntrinsicSize,
        frameW: rendererSize.width,
        frameH: rendererSize.height,
        calibratedActive: false,
      });
      setLocalTupleLoadReceipt({
        width: loadedWidth,
        depth: loadedDepth,
        fovDeg: probe.fovDeg,
        tNear: tuple.tNear,
        aspectRatio: tuple.aspectRatio,
        probeState: probe.state,
        signature,
      });
    },
    [
      isCalibratedCameraActive,
      localRefinementPreview,
      cancelPendingCalibrationRestoreAfterManualGeometryChange,
      floorMapping,
      lastAcceptedFloorClick,
      selectedAutoFloorCandidateId,
      selectedCoupledCandidateQuadSignature,
      manualAnnotation,
      loadedImageUrl,
      imageIntrinsicSize,
      rendererSize.width,
      rendererSize.height,
    ]
  );

  const assistedCandidateSolvabilityContext = useMemo(() => {
    if (!selectedAutoFloorCandidate) {
      return {
        state: "no-selected" as const,
        primaryText: "No assisted candidate selected.",
      };
    }
    if (assistedCandidateIdentity.isAppliedAndIdentical) {
      return {
        state: "identical-active" as const,
        primaryText: "Applied to active floor quad.",
        secondaryText: "Candidate diagnostics match the active floor quad and are shown in Calibration Readiness.",
      };
    }

    const result = selectedAssistedCandidateSolvability;
    const formatMetricPx = (value: number | null) =>
      value !== null && Number.isFinite(value) ? `${formatNumber(value)} px` : "Unavailable";
    const formatFovIntervals = (intervals: [number, number][] | null) => {
      if (!intervals) return "Unavailable";
      if (intervals.length === 0) return "None found";
      return intervals
        .map(([start, end]) => (start === end ? `${start}°` : `${start}°–${end}°`))
        .join(", ");
    };
    const formatCornerDiagnostic = (entry: { index: number; value: number } | null) =>
      entry ? `${CALIBRATION_CORNER_LABELS[entry.index] ?? "Unavailable"} — ${formatNumber(entry.value)} px` : "Unavailable";

    const cameraSolvableText = !result
      ? "Unavailable"
      : result.poseAvailable && !!result.applyCandidate
        ? "Yes"
        : result.prerequisitesAvailable
          ? "No"
          : "Unavailable";
    const highConfidenceText = !result
      ? "Unavailable"
      : result.decomposition
        ? result.decomposition.confidence === "high"
          ? "Yes"
          : "No"
        : "Unavailable";
    const applySafeText = !result
      ? "Unavailable"
      : result.applyEvaluation.available
        ? "Yes"
        : `No — ${result.applyEvaluation.reason}`;

    const validFovSampleText =
      !result || result.fovScan.sampleCount === 0
        ? "Unavailable"
        : result.fovScan.validSampleCount > 0
          ? `${formatFovIntervals(result.fovScan.validSampleIntervals)} (${result.fovScan.validSampleCount} of ${
              result.fovScan.sampleCount
            } sampled FOVs)`
          : "None found";
    const highConfidenceFovSampleText =
      !result || result.fovScan.sampleCount === 0
        ? "Unavailable"
        : result.fovScan.validSampleCount === 0
          ? "Unavailable"
          : result.fovScan.highConfidenceSampleCount > 0
            ? `${formatFovIntervals(result.fovScan.highConfidenceSampleIntervals)} (${
                result.fovScan.highConfidenceSampleCount
              } of ${result.fovScan.sampleCount} sampled FOVs)`
            : "None found";

    const mainBlockerReason = result?.applyEvaluation.reason ?? "candidate diagnostics unavailable";
    const firstFailingGate = result?.applyEvaluation.firstFailingGate ?? "no-candidate";
    let mainBlockerText = `Main blocker: ${mainBlockerReason}`;
    let mainBlockingContributorDetail: string | null = null;
    if (result?.applyEvaluation.available) {
      mainBlockerText = "Main blocker: none (candidate is Apply-safe at current FOV).";
    } else if (firstFailingGate === "cv-max" && result?.worstCorner.cv) {
      const label = CALIBRATION_CORNER_LABELS[result.worstCorner.cv.index] ?? "Unavailable";
      mainBlockingContributorDetail = `Worst CV corner: ${label} — ${formatNumber(result.worstCorner.cv.value)} px.`;
    } else if (firstFailingGate === "display-max" && result?.worstCorner.rendered) {
      const label = CALIBRATION_CORNER_LABELS[result.worstCorner.rendered.index] ?? "Unavailable";
      mainBlockingContributorDetail = `Worst rendered-camera corner: ${label} — ${formatNumber(
        result.worstCorner.rendered.value
      )} px.`;
    }

    return {
      state: "evaluated" as const,
      primaryText: "Evaluated without applying to the active floor quad.",
      editedAfterApplyingText: assistedCandidateIdentity.wasAppliedButNowDifferent
        ? "The active floor quad now differs from this selected candidate."
        : null,
      cameraSolvableText,
      highConfidenceText,
      applySafeLabel: `Apply-safe at current FOV (${formatNumber(cameraPoseFovYDeg)}°)`,
      applySafeText,
      cvAverageText: formatMetricPx(result?.cv.averagePx ?? null),
      cvMaximumText: formatMetricPx(result?.cv.maximumPx ?? null),
      renderedAverageText: formatMetricPx(result?.rendered.averagePx ?? null),
      renderedMaximumText: formatMetricPx(result?.rendered.maximumPx ?? null),
      deltaAverageText: formatMetricPx(result?.delta.averagePx ?? null),
      deltaMaximumText: formatMetricPx(result?.delta.maximumPx ?? null),
      validFovSampleText,
      highConfidenceFovSampleText,
      largestCvResidualText: `Largest CV residual: ${formatCornerDiagnostic(result?.worstCorner.cv ?? null)}`,
      largestRenderedResidualText: `Largest rendered-camera residual: ${formatCornerDiagnostic(
        result?.worstCorner.rendered ?? null
      )}`,
      largestDifferenceText: `Largest CV ↔ rendered-camera difference: ${formatCornerDiagnostic(
        result?.worstCorner.difference ?? null
      )}`,
      differenceDiagnosticNote: "Diagnostic only: Apply limits compare aggregate values, not this per-corner difference.",
      mainBlockerText,
      mainBlockingContributorDetail,
      diagnosticOnlyText: "Evaluation is diagnostic only. This does not apply or modify the selected candidate.",
    };
  }, [
    assistedCandidateIdentity.isAppliedAndIdentical,
    assistedCandidateIdentity.wasAppliedButNowDifferent,
    cameraPoseFovYDeg,
    selectedAssistedCandidateSolvability,
    selectedAutoFloorCandidate,
  ]);

  const debugRows = useMemo(
    () => [
      { label: "env", value: envEnabled ? "enabled" : "disabled" },
      { label: "image", value: imageLoadState },
      {
        label: "image intrinsic size",
        value: imageIntrinsicSize ? `${imageIntrinsicSize.width} x ${imageIntrinsicSize.height}` : "none",
      },
      { label: "image frame size", value: `${rendererSize.width} x ${rendererSize.height}` },
      { label: "image coordinate space", value: SCENE_IMAGE_COORDINATE_SPACE_V0 },
      { label: "model", value: formatModelStatus(modelLoadState, modelLoadError) },
      { label: "renderer", value: `${rendererSize.width} x ${rendererSize.height}` },
      {
        label: "transform",
        value: `x:${formatNumber(transform.positionX)} y:${formatNumber(transform.positionY)} z:${formatNumber(
          transform.positionZ
        )} ry:${formatNumber(transform.rotationYDeg)}deg s:${formatNumber(transform.uniformScale)}`,
      },
      { label: "model normalization adjusted", value: isModelNormalizationAdjusted ? "yes" : "no" },
      { label: "model y offset", value: formatNumber(modelNormalization.modelYOffset) },
      { label: "model yaw offset", value: `${formatNumber(modelNormalization.modelYawOffsetDeg)}deg` },
      { label: "model scale multiplier", value: formatNumber(modelNormalization.modelScaleMultiplier) },
      { label: "auto-normalize bounds", value: autoNormalizeBoundsEnabled ? "on" : "off" },
      {
        label: "auto-normalization status",
        value: !autoNormalizeBoundsEnabled
          ? "off"
          : autoBoundsInfo?.ok
            ? "applied"
            : `skipped (${autoBoundsInfo?.reason ?? "none"})`,
      },
      {
        label: "measured size",
        value: autoBoundsInfo
          ? `${formatNumber(autoBoundsInfo.measuredSize.x)} / ${formatNumber(
              autoBoundsInfo.measuredSize.y
            )} / ${formatNumber(autoBoundsInfo.measuredSize.z)}`
          : "none",
      },
      {
        label: "measured center",
        value: autoBoundsInfo
          ? `${formatNumber(autoBoundsInfo.measuredCenter.x)} / ${formatNumber(
              autoBoundsInfo.measuredCenter.y
            )} / ${formatNumber(autoBoundsInfo.measuredCenter.z)}`
          : "none",
      },
      {
        label: "auto offset",
        value: autoBoundsInfo
          ? `${formatNumber(autoBoundsInfo.offset.x)} / ${formatNumber(
              autoBoundsInfo.offset.y
            )} / ${formatNumber(autoBoundsInfo.offset.z)}`
          : "none",
      },
      { label: "auto scale", value: autoBoundsInfo ? formatNumber(autoBoundsInfo.scale) : "none" },
      { label: "auto-rotate", value: autoRotateEnabled ? "on" : "off" },
      { label: "active object", value: currentActiveObjectType },
      { label: "floor overlay", value: showFloorOverlay ? "on" : "off" },
      { label: "floor points", value: String(floorPolygon.length) },
      { label: "active floor handle", value: activeFloorHandleIndex === null ? "none" : String(activeFloorHandleIndex) },
      { label: "floor polygon", value: JSON.stringify(floorPolygon.map(roundPoint)) },
      { label: "auto floor status", value: autoFloorDetectionResult?.status ?? "idle" },
      { label: "auto floor candidate count", value: String(autoFloorDetectionResult?.candidates.length ?? 0) },
      {
        label: "auto floor selected candidate",
        value: selectedAutoFloorCandidate ? `${selectedAutoFloorCandidate.label} (${selectedAutoFloorCandidate.id})` : "none",
      },
      {
        label: "auto floor selected confidence",
        value: selectedAutoFloorCandidate ? selectedAutoFloorCandidate.confidence : "none",
      },
      {
        label: "auto floor selected confidence score",
        value: selectedAutoFloorCandidate ? formatNumber(selectedAutoFloorCandidate.confidenceScore) : "none",
      },
      {
        label: "auto floor selected notes",
        value:
          selectedAutoFloorCandidate && selectedAutoFloorCandidate.notes.length > 0
            ? selectedAutoFloorCandidate.notes.join(" | ")
            : "none",
      },
      {
        label: "auto floor selected risks",
        value:
          selectedAutoFloorCandidate && selectedAutoFloorCandidate.risks.length > 0
            ? selectedAutoFloorCandidate.risks.join(" | ")
            : "none",
      },
      {
        label: "auto floor geometry score",
        value: selectedAutoFloorCandidateScore ? formatNumber(selectedAutoFloorCandidateScore.score) : "none",
      },
      {
        label: "auto floor score band",
        value: selectedAutoFloorCandidateScore ? selectedAutoFloorCandidateScore.scoreBand : "none",
      },
      {
        label: "auto floor polygon sanity",
        value: selectedAutoFloorCandidateScore
          ? `ok=${selectedAutoFloorCandidateScore.polygon.ok ? "yes" : "no"} area=${
              selectedAutoFloorCandidateScore.polygon.areaNorm === null
                ? "n/a"
                : formatNumber(selectedAutoFloorCandidateScore.polygon.areaNorm)
            } convex=${selectedAutoFloorCandidateScore.polygon.convex ? "yes" : "no"} selfInt=${
              selectedAutoFloorCandidateScore.polygon.selfIntersecting ? "yes" : "no"
            } nearFar=${selectedAutoFloorCandidateScore.polygon.nearFarOrderingOk ? "ok" : "weak"} skinny=${
              selectedAutoFloorCandidateScore.polygon.skinnyRisk ? "yes" : "no"
            }`
          : "none",
      },
      {
        label: "auto floor corner ordering",
        value: selectedAutoFloorCandidateScore
          ? `ok=${selectedAutoFloorCandidateScore.cornerOrdering.ok ? "yes" : "no"} confidence=${
              selectedAutoFloorCandidateScore.cornerOrdering.confidence ?? "n/a"
            }`
          : "none",
      },
      {
        label: "auto floor homography status",
        value: selectedAutoFloorCandidateScore
          ? `ok=${selectedAutoFloorCandidateScore.homography.ok ? "yes" : "no"} reprojPx=${
              selectedAutoFloorCandidateScore.homography.sourceReprojectionErrorPx === null ||
              selectedAutoFloorCandidateScore.homography.sourceReprojectionErrorPx === undefined
                ? "n/a"
                : formatNumber(selectedAutoFloorCandidateScore.homography.sourceReprojectionErrorPx)
            } reprojTarget=${
              selectedAutoFloorCandidateScore.homography.targetReprojectionError === null ||
              selectedAutoFloorCandidateScore.homography.targetReprojectionError === undefined
                ? "n/a"
                : formatNumber(selectedAutoFloorCandidateScore.homography.targetReprojectionError)
            }`
          : "none",
      },
      {
        label: "auto floor scoring notes",
        value:
          selectedAutoFloorCandidateScore && selectedAutoFloorCandidateScore.overallNotes.length > 0
            ? selectedAutoFloorCandidateScore.overallNotes.join(" | ")
            : "none",
      },
      {
        label: "auto floor scoring risks",
        value:
          selectedAutoFloorCandidateScore && selectedAutoFloorCandidateScore.risks.length > 0
            ? selectedAutoFloorCandidateScore.risks.join(" | ")
            : "none",
      },
      { label: "auto floor applied candidate", value: appliedAutoFloorCandidateId ?? "none" },
      { label: "auto floor apply status", value: lastAutoFloorApplyMessage },
      {
        label: "auto floor provider",
        value: `${selectedAutoFloorProviderId} (default: ${ACTIVE_AUTO_FLOOR_DETECTION_PROVIDER_ID})`,
      },
      {
        label: "auto floor provider detail",
        value:
          selectedAutoFloorProviderId === "mock-api"
            ? "mock-api: canned lab-route response (no AI/external API)"
            : "mock-local: deterministic in-app mock (no network)",
      },
      { label: "auto floor detection run state", value: autoFloorDetectionRunState },
      {
        label: "auto floor detection failure reasons",
        value: autoFloorDetectionFailureReasons.length > 0 ? autoFloorDetectionFailureReasons.join(" | ") : "none",
      },
      { label: "floor placement mode", value: isFloorClickPlacementEnabled ? "on" : "off" },
      { label: "floor-click mapping mode", value: floorClickMappingMode },
      { label: "last floor-click mapping result", value: lastFloorClickMappingResult },
      {
        label: "mapping caution",
        value:
          floorClickMappingMode === "homography-experimental" && perspectiveDepthScaling.enabled
            ? "Homography mapping + depth scaling can double-count perspective. Consider disabling depth scaling while testing."
            : "none",
      },
      {
        label: "mapping note",
        value:
          floorClickMappingMode === "homography-experimental"
            ? "Experimental: homography floor-click mapping may not visually improve until camera pose is applied."
            : "none",
      },
      { label: "floor interaction mode", value: floorInteractionModeSummary },
      { label: "pointer precedence", value: "polygon handles > object handles > anchor drag > floor background" },
      { label: "object 2d handles", value: isObject2DHandlesEffectivelyEnabled ? "on" : "off" },
      { label: "active object handle mode", value: activeObjectHandleMode ?? "none" },
      { label: "last object handle move rejected", value: wasLastObjectHandleMoveRejected ? "yes" : "no" },
      {
        label: "last rotate delta (deg)",
        value: lastObjectHandleRotateDeltaDeg === null ? "none" : formatNumber(lastObjectHandleRotateDeltaDeg),
      },
      {
        label: "last scale drag multiplier",
        value: lastObjectHandleScaleMultiplier === null ? "none" : formatNumber(lastObjectHandleScaleMultiplier),
      },
      {
        label: "last height delta y",
        value: lastObjectHandleHeightDeltaYUnits === null ? "none" : formatNumber(lastObjectHandleHeightDeltaYUnits),
      },
      { label: "depth auto-scale", value: perspectiveDepthScaling.enabled ? "on" : "off" },
      { label: "depth scale multiplier", value: formatNumber(currentDepthScaleMultiplier) },
      { label: "effective object scale", value: formatNumber(currentEffectiveObjectScale) },
      {
        label: "near/far scale",
        value: `${formatNumber(perspectiveDepthScaling.nearScaleMultiplier)} / ${formatNumber(
          perspectiveDepthScaling.farScaleMultiplier
        )}`,
      },
      {
        label: "near/far floor y",
        value: `${formatNumber(perspectiveDepthScaling.nearFloorY)} / ${formatNumber(
          perspectiveDepthScaling.farFloorY
        )}`,
      },
      { label: "near/far ordering valid", value: isDepthNearFarOrderValid ? "yes" : "no" },
      {
        label: "depth scaling warning",
        value: depthNearFarOrderingWarning ?? "none",
      },
      { label: "floor anchor dragging", value: isFloorAnchorDragEffectivelyEnabled ? "on" : "off" },
      { label: "active anchor drag", value: isFloorAnchorDragActive ? "yes" : "no" },
      {
        label: "floor anchor model",
        value: isCalibratedCameraActive
          ? "floor-plane X/Z drives placement; screen marker is derived"
          : "screen marker drives legacy mapping",
      },
      {
        label: "stored floor marker",
        value: lastAcceptedFloorClick
          ? `${JSON.stringify(roundPoint(lastAcceptedFloorClick))} (screen-normalized marker; not canonical calibrated truth)`
          : "none",
      },
      {
        label: "floor anchor point",
        value: lastAcceptedFloorClick ? JSON.stringify(roundPoint(lastAcceptedFloorClick)) : "none",
      },
      { label: "last anchor drag outside reject", value: wasLastAnchorDragMoveRejected ? "yes" : "no" },
      {
        label: "last accepted floor click",
        value: lastAcceptedFloorClick ? JSON.stringify(roundPoint(lastAcceptedFloorClick)) : "none",
      },
      {
        label: "object projected screen point",
        value: objectProjectionDiagnostic.projectedNorm
          ? `x=${formatNumber(objectProjectionDiagnostic.projectedNorm.x)} y=${formatNumber(
              objectProjectionDiagnostic.projectedNorm.y
            )}`
          : "none",
      },
      {
        label: "stored floor anchor point",
        value: objectProjectionDiagnostic.anchorNorm ? JSON.stringify(roundPoint(objectProjectionDiagnostic.anchorNorm)) : "none",
      },
      {
        label: "legacy mapping controls",
        value: isCalibratedCameraActive ? "disabled while calibrated camera is active" : "enabled",
      },
      {
        label: "projected-vs-anchor delta",
        value:
          objectProjectionDiagnostic.deltaNorm && objectProjectionDiagnostic.deltaPx
            ? `dx=${formatNumber(objectProjectionDiagnostic.deltaNorm.dx)} dy=${formatNumber(
                objectProjectionDiagnostic.deltaNorm.dy
              )} distNorm=${formatNumber(objectProjectionDiagnostic.deltaNorm.distance)} distPx=${formatNumber(
                objectProjectionDiagnostic.deltaPx.distance
              )}`
            : "none",
      },
      {
        label: "projection diagnostic",
        value: objectProjectionDiagnostic.status,
      },
      {
        label: "last rejected floor click",
        value: lastRejectedFloorClick ? JSON.stringify(roundPoint(lastRejectedFloorClick)) : "none",
      },
      { label: "mapped object x/z", value: `${formatNumber(transform.positionX)} / ${formatNumber(transform.positionZ)}` },
      {
        label: "floor mapping constants",
        value: `width=${formatNumber(floorMapping.worldWidth)}, depth=${formatNumber(
          floorMapping.worldDepth
        )}, depthCenterY=${formatNumber(floorMapping.depthCenterY)}`,
      },
      ...homographyDebug.rows,
      ...rayFloorHomographyComparisonDebug.rows,
      ...cameraPoseDebug.rows,
      ...cameraPoseFovScanDebug.rows,
      { label: "camera mode", value: isCalibratedCameraActive ? "Calibrated snapshot" : "Legacy" },
      {
        label: "calibrated camera apply",
        value: calibratedCameraApplyStatus.available
          ? "available"
          : `unavailable — ${calibratedCameraApplyStatus.reason}`,
      },
      {
        label: "calibrated camera snapshot FOV",
        value: calibratedCameraSnapshot ? `${formatNumber(calibratedCameraSnapshot.fovDeg)}deg` : "none",
      },
      {
        label: "calibrated camera snapshot diagnostics",
        value: calibratedCameraSnapshot ? calibratedCameraSnapshot.diagnosticsSummary : "none",
      },
      {
        label: "calibrated camera warning",
        value: isCalibratedCameraActive
          ? "Experimental: calibrated camera can shift apparent placement/scale. Revert to legacy if alignment regresses."
          : "none",
      },
      {
        label: "object handles disabled while calibrated camera is active",
        value: isCalibratedCameraActive ? "yes" : "no",
      },
      {
        label: "calibrated depth scaling",
        value: calibratedDepthScalingStatus,
      },
      {
        label: "calibrated depth scaling warning",
        value: isCalibratedCameraActive
          ? "Depth scaling is neutralized while calibrated camera is active; pre-calibrated setting will restore on revert."
          : "none",
      },
      {
        label: "calibrated move handle",
        value: calibratedMoveHandleStatus.available
          ? "available"
          : `unavailable — ${calibratedMoveHandleStatus.reason}`,
      },
      {
        label: "calibrated move mapping",
        value: isCalibratedCameraActive
          ? "Calibrated move handle uses camera ray-floor mapping."
          : "not active",
      },
      {
        label: "calibrated move status",
        value: lastCalibratedMoveStatus,
      },
      {
        label: "calibrated rotate handle",
        value: calibratedRotateHandleStatus.available
          ? "available"
          : `unavailable — ${calibratedRotateHandleStatus.reason}`,
      },
      {
        label: "calibrated rotate status",
        value: lastCalibratedRotateStatus,
      },
      {
        label: "last calibrated rotate delta (deg)",
        value: lastCalibratedRotateDeltaDeg === null ? "none" : formatNumber(lastCalibratedRotateDeltaDeg),
      },
      {
        label: "calibrated scale handle",
        value: calibratedScaleHandleStatus.available
          ? "available"
          : `unavailable — ${calibratedScaleHandleStatus.reason}`,
      },
      {
        label: "calibrated scale status",
        value: lastCalibratedScaleStatus,
      },
      {
        label: "calibrated scale local floor contact Y",
        value: calibratedScaleLocalFloorContact.ok
          ? formatNumber(calibratedScaleLocalFloorContact.yLocal)
          : `n/a (${calibratedScaleLocalFloorContact.reason})`,
      },
      {
        label: "last calibrated scale multiplier",
        value: lastCalibratedScaleMultiplier === null ? "none" : formatNumber(lastCalibratedScaleMultiplier),
      },
      {
        label: "calibrated lift handle",
        value: calibratedLiftHandleStatus.available
          ? "available"
          : `unavailable — ${calibratedLiftHandleStatus.reason}`,
      },
      {
        label: "calibrated lift status",
        value: lastCalibratedLiftStatus,
      },
      {
        label: "calibrated lift state",
        value: isCalibratedObjectLifted ? "lifted" : "resting",
      },
      {
        label: "calibrated lift positionY",
        value: formatNumber(transform.positionY),
      },
      {
        label: "last calibrated lift delta Y",
        value: lastCalibratedLiftDeltaY === null ? "none" : formatNumber(lastCalibratedLiftDeltaY),
      },
      {
        label: "calibrated floor-anchor viewport status",
        value: calibratedLiftSafeRange.floorAnchorVisible
          ? "floor anchor visible in viewport"
          : `floor anchor not visible — ${calibratedLiftSafeRange.reason}`,
      },
      {
        label: "calibrated safe max lift Y",
        value: calibratedLiftSafeRange.ok ? formatNumber(calibratedLiftSafeRange.safeMaxLiftY) : "n/a",
      },
      {
        label: "calibrated lift safe-range status",
        value: calibratedLiftSafeRange.ok
          ? `ok (max ${formatNumber(calibratedLiftSafeRange.safeMaxLiftY)})`
          : `fail closed — ${calibratedLiftSafeRange.reason}`,
      },
      {
        label: "calibrated lift-handle placement status",
        value: calibratedLiftHandlePlacement.available
          ? calibratedLiftHandlePlacement.ideal
            ? `dx=${formatNumber(calibratedLiftHandlePlacement.offset.x)} dy=${formatNumber(
                calibratedLiftHandlePlacement.offset.y
              )} (clear, sep=${
                Number.isFinite(calibratedLiftHandlePlacement.separation)
                  ? formatNumber(calibratedLiftHandlePlacement.separation)
                  : "n/a"
              })`
            : `floor anchor visible; Lift handle offset inward (dx=${formatNumber(
                calibratedLiftHandlePlacement.offset.x
              )} dy=${formatNumber(calibratedLiftHandlePlacement.offset.y)}, sep=${
                Number.isFinite(calibratedLiftHandlePlacement.separation)
                  ? formatNumber(calibratedLiftHandlePlacement.separation)
                  : "n/a"
              })`
          : `unavailable — ${calibratedLiftHandlePlacement.reason}`,
      },
      {
        label: "calibrated floor marker meaning",
        value: isCalibratedObjectLifted
          ? "footprint / floor reference (object is lifted; not active contact)"
          : "active floor contact",
      },
      {
        label: "calibrated camera resize note",
        value: isCalibratedCameraActive
          ? "Re-apply calibrated camera snapshot after significant viewport resize."
          : "none",
      },
      {
        label: "calibrated camera frame match",
        value: calibratedCameraFrameMatchStatus.value,
      },
      {
        label: "calibrated camera restore",
        value: calibratedRestoreStatus,
      },
      {
        label: "projected-vs-anchor warning",
        value:
          isCalibratedCameraActive && objectProjectionDiagnostic.largeDelta
            ? "Projected object differs from stored floor anchor; overlay handles remain disabled until projection is unified."
            : "none",
      },
      { label: "model path", value: modelPath || "(empty)" },
    ],
    [
      activeFloorHandleIndex,
      activeObjectKind,
      autoRotateEnabled,
      autoFloorDetectionResult,
      selectedAutoFloorCandidate,
      selectedAutoFloorCandidateScore,
      appliedAutoFloorCandidateId,
      lastAutoFloorApplyMessage,
      autoFloorDetectionRunState,
      autoFloorDetectionFailureReasons,
      selectedAutoFloorProviderId,
      currentActiveObjectType,
      envEnabled,
      floorMapping.depthCenterY,
      floorMapping.worldDepth,
      floorMapping.worldWidth,
      floorPolygon,
      floorInteractionModeSummary,
      imageIntrinsicSize,
      imageLoadState,
      currentDepthScaleMultiplier,
      currentEffectiveObjectScale,
      isModelNormalizationAdjusted,
      autoNormalizeBoundsEnabled,
      autoBoundsInfo,
      depthNearFarOrderingWarning,
      isDepthNearFarOrderValid,
      isObject2DHandlesEffectivelyEnabled,
      activeObjectHandleMode,
      lastObjectHandleRotateDeltaDeg,
      lastObjectHandleScaleMultiplier,
      lastObjectHandleHeightDeltaYUnits,
      isFloorAnchorDragActive,
      isFloorAnchorDragEffectivelyEnabled,
      isFloorClickPlacementEnabled,
      floorClickMappingMode,
      lastFloorClickMappingResult,
      cameraPoseDebug.rows,
      cameraPoseFovScanDebug.rows,
      rayFloorHomographyComparisonDebug.rows,
      calibratedCameraApplyStatus.available,
      calibratedCameraApplyStatus.reason,
      calibratedDepthScalingStatus,
      calibratedMoveHandleStatus.available,
      calibratedMoveHandleStatus.reason,
      calibratedRotateHandleStatus.available,
      calibratedRotateHandleStatus.reason,
      lastCalibratedRotateStatus,
      lastCalibratedRotateDeltaDeg,
      calibratedScaleHandleStatus.available,
      calibratedScaleHandleStatus.reason,
      calibratedScaleLocalFloorContact,
      lastCalibratedScaleStatus,
      lastCalibratedScaleMultiplier,
      calibratedLiftHandleStatus.available,
      calibratedLiftHandleStatus.reason,
      isCalibratedObjectLifted,
      lastCalibratedLiftStatus,
      lastCalibratedLiftDeltaY,
      calibratedLiftSafeRange.ok,
      calibratedLiftSafeRange.safeMaxLiftY,
      calibratedLiftSafeRange.reason,
      calibratedLiftSafeRange.floorAnchorVisible,
      calibratedLiftHandlePlacement.available,
      calibratedLiftHandlePlacement.ideal,
      calibratedLiftHandlePlacement.offset,
      calibratedLiftHandlePlacement.separation,
      calibratedLiftHandlePlacement.reason,
      transform.positionY,
      calibratedCameraFrameMatchStatus.value,
      calibratedRestoreStatus,
      isCalibratedCameraActive,
      calibratedCameraSnapshot,
      lastCalibratedMoveStatus,
      lastAcceptedFloorClick,
      objectProjectionDiagnostic.anchorNorm,
      objectProjectionDiagnostic.deltaNorm,
      objectProjectionDiagnostic.deltaPx,
      objectProjectionDiagnostic.largeDelta,
      objectProjectionDiagnostic.projectedNorm,
      objectProjectionDiagnostic.status,
      lastRejectedFloorClick,
      modelLoadError,
      modelLoadState,
      modelPath,
      homographyDebug.rows,
      modelNormalization.modelScaleMultiplier,
      modelNormalization.modelYOffset,
      modelNormalization.modelYawOffsetDeg,
      perspectiveDepthScaling.enabled,
      perspectiveDepthScaling.farFloorY,
      perspectiveDepthScaling.farScaleMultiplier,
      perspectiveDepthScaling.nearFloorY,
      perspectiveDepthScaling.nearScaleMultiplier,
      rendererSize.height,
      rendererSize.width,
      showFloorOverlay,
      transform.positionX,
      transform.positionY,
      transform.positionZ,
      transform.rotationYDeg,
      transform.uniformScale,
      wasLastObjectHandleMoveRejected,
      wasLastAnchorDragMoveRejected,
    ]
  );

  const updateTransformField = (field: keyof TransformState, value: number) => {
    const limits = TRANSFORM_LIMITS[field];
    const clamped = clampValue(value, limits.min, limits.max);
    updateTransformState((prev) => ({ ...prev, [field]: clamped }), { markOwned: true });
  };

  const updateModelNormalizationField = (field: keyof ModelNormalizationState, value: number) => {
    const limits = MODEL_NORMALIZATION_LIMITS[field];
    const clamped = clampValue(value, limits.min, limits.max);
    setModelNormalization((prev) => ({ ...prev, [field]: clamped }));
  };

  const updateFloorMappingField = (
    field: keyof FloorMappingState,
    value: number,
    options?: { fromImport?: boolean }
  ) => {
    if (isCalibratedCameraActive && !options?.fromImport) {
      return;
    }
    const limits = FLOOR_MAPPING_LIMITS[field];
    const clamped = clampValue(value, limits.min, limits.max);
    const nextMapping = { ...floorMapping, [field]: clamped };
    setFloorMapping(nextMapping);
    if (!isCalibratedCameraActive && !options?.fromImport && lastAcceptedFloorClick) {
      const mapped = mapFloorPointToObjectTransform(lastAcceptedFloorClick, nextMapping);
      updateTransformState((current) => ({
        ...current,
        positionX: mapped.positionX,
        positionZ: mapped.positionZ,
      }), { markOwned: true });
    }
  };

  const handleResetFloorMapping = () => {
    if (isCalibratedCameraActive) {
      return;
    }
    setFloorMapping(DEFAULT_FLOOR_MAPPING);
    if (lastAcceptedFloorClick) {
      const mapped = mapFloorPointToObjectTransform(lastAcceptedFloorClick, DEFAULT_FLOOR_MAPPING);
      updateTransformState((current) => ({
        ...current,
        positionX: mapped.positionX,
        positionZ: mapped.positionZ,
      }), { markOwned: true });
    }
  };

  const updatePerspectiveDepthScalingField = (
    field: keyof Omit<PerspectiveDepthScalingState, "enabled">,
    value: number
  ) => {
    const limits = PERSPECTIVE_DEPTH_SCALING_LIMITS[field];
    const clamped = clampValue(value, limits.min, limits.max);
    setPerspectiveDepthScaling((prev) => ({
      ...prev,
      [field]: clamped,
    }));
  };

  const handleResetPerspectiveDepthScaling = () => {
    setPerspectiveDepthScaling(DEFAULT_PERSPECTIVE_DEPTH_SCALING);
  };

  const handleAutoFitFromFloor = () => {
    if (isCalibratedCameraActive) {
      setAutoFitStatus({ kind: "idle", message: LEGACY_FLOOR_MAPPING_DISABLED_MESSAGE });
      return;
    }
    const mappingResult = deriveFloorMappingFromPolygon(floorPolygon);
    const depthResult = deriveDepthScalingFromPolygon(floorPolygon);

    let mappingApplied = false;
    if (mappingResult.ok) {
      const nextMapping = mappingResult.value;
      setFloorMapping(nextMapping);
      mappingApplied = true;
      if (lastAcceptedFloorClick) {
        const mapped = mapFloorPointToObjectTransform(lastAcceptedFloorClick, nextMapping);
        updateTransformState(
          (current) => ({ ...current, positionX: mapped.positionX, positionZ: mapped.positionZ }),
          { markOwned: true }
        );
      }
    }

    let depthApplied = false;
    if (depthResult.ok) {
      setPerspectiveDepthScaling(depthResult.value);
      depthApplied = true;
    }

    if (!mappingApplied && !depthApplied) {
      const reason = !mappingResult.ok
        ? mappingResult.reason
        : !depthResult.ok
          ? depthResult.reason
          : "Auto-fit could not derive values.";
      setAutoFitStatus({ kind: "error", message: `Auto-fit failed: ${reason} Existing values kept.` });
      return;
    }

    const notes: string[] = [];
    if (mappingResult.ok && mappingResult.note) notes.push(mappingResult.note);
    if (depthResult.ok && depthResult.note) notes.push(depthResult.note);
    const lowConfidence =
      (mappingResult.ok && mappingResult.confidence === "low") ||
      (depthResult.ok && depthResult.confidence === "low");
    const suffix = notes.length ? ` ${notes.join(" ")}` : "";

    if (mappingApplied && depthApplied) {
      const base = lowConfidence
        ? "Auto-fit applied (low confidence) to floor mapping and depth scaling."
        : "Auto-fit applied to floor mapping and depth scaling.";
      setAutoFitStatus({ kind: "success", message: `${base}${suffix}` });
    } else if (mappingApplied) {
      const reason = depthResult.ok ? "" : ` ${depthResult.reason}`;
      setAutoFitStatus({
        kind: "success",
        message: `Auto-fit applied to floor mapping. Depth scaling kept (not derived):${reason || " skipped."}${suffix}`,
      });
    } else {
      const reason = mappingResult.ok ? "" : ` ${mappingResult.reason}`;
      setAutoFitStatus({
        kind: "success",
        message: `Auto-fit applied to depth scaling. Floor mapping kept (not derived):${reason || " skipped."}${suffix}`,
      });
    }
  };

  const handleFixPerspectiveNearFarOrder = () => {
    setPerspectiveDepthScaling((prev) => ({
      ...prev,
      nearFloorY: Math.max(prev.nearFloorY, prev.farFloorY),
      farFloorY: Math.min(prev.nearFloorY, prev.farFloorY),
    }));
  };

  const handleResetTransform = () => {
    cancelPendingCalibrationRestoreAfterManualGeometryChange();
    autoRotateOffsetDegRef.current = 0;
    updateTransformState(defaultTransformForKind(activeObjectKind), { markOwned: true });
  };

  const handleResetModelNormalization = () => {
    cancelPendingCalibrationRestoreAfterManualGeometryChange();
    setModelNormalization(DEFAULT_MODEL_NORMALIZATION);
  };

  const floorPolygonPointsAttribute = useMemo(
    () => floorPolygon.map((point) => `${point.x * 100},${point.y * 100}`).join(" "),
    [floorPolygon]
  );

  const autoFloorSuggestionPointsAttribute = useMemo(() => {
    if (!selectedAutoFloorCandidate) return null;
    return selectedAutoFloorCandidate.quadNorm
      .map((point) => `${point.x * 100},${point.y * 100}`)
      .join(" ");
  }, [selectedAutoFloorCandidate]);

  // Phase 2C optional enhancement: preview overlay styling reflects the geometry
  // score band. Still purely preview-only and non-interactive.
  const autoFloorSuggestionStyle = useMemo(() => {
    const band = selectedAutoFloorCandidateScore?.scoreBand ?? "medium";
    switch (band) {
      case "high":
        return {
          fill: "#34d399",
          fillOpacity: 0.12,
          stroke: "#34d399",
          strokeOpacity: 1,
          strokeWidth: 1.2,
          strokeDasharray: "2.4 1.2",
          textFill: "#bbf7d0",
          label: "suggestion (preview · high)",
        };
      case "low":
        return {
          fill: "#f59e0b",
          fillOpacity: 0.08,
          stroke: "#f59e0b",
          strokeOpacity: 0.7,
          strokeWidth: 0.85,
          strokeDasharray: "1.4 1.6",
          textFill: "#fde68a",
          label: "suggestion (preview · low)",
        };
      case "invalid":
        return {
          fill: "#f43f5e",
          fillOpacity: 0.08,
          stroke: "#f43f5e",
          strokeOpacity: 0.7,
          strokeWidth: 0.85,
          strokeDasharray: "1 1.8",
          textFill: "#fecdd3",
          label: "suggestion (preview · invalid)",
        };
      case "medium":
      default:
        return {
          fill: "#a855f7",
          fillOpacity: 0.1,
          stroke: "#c084fc",
          strokeOpacity: 0.95,
          strokeWidth: 1,
          strokeDasharray: "2 1.4",
          textFill: "#e9d5ff",
          label: "suggestion (preview · medium)",
        };
    }
  }, [selectedAutoFloorCandidateScore?.scoreBand]);

  // Phase 2E/2F-C: run detection through the selected provider boundary.
  // Structured as async; mock-local resolves immediately, mock-api round-trips
  // the lab-only route. Guards against duplicate concurrent runs. Never mutates
  // floorPolygon or calibrated camera state (results flow to preview/apply only).
  const handleDetectFloor = useCallback(async () => {
    if (autoFloorDetectionInFlightRef.current) return;
    autoFloorDetectionInFlightRef.current = true;
    setAutoFloorDetectionRunState("detecting");
    setAutoFloorDetectionFailureReasons([]);

    const input: AutoFloorDetectionInput = {
      imageUrl: roomImageUrl || null,
      frameSize:
        rendererSize.width > 0 && rendererSize.height > 0
          ? { width: rendererSize.width, height: rendererSize.height }
          : null,
      currentFloorPolygon: floorPolygon,
      floorRect: { widthMeters: floorMapping.worldWidth, depthMeters: floorMapping.worldDepth },
      intrinsicSize: imageIntrinsicSize
        ? { width: imageIntrinsicSize.width, height: imageIntrinsicSize.height }
        : null,
    };

    try {
      const result = await runAutoFloorDetection(selectedAutoFloorProviderId, input);

      if (result.status === "failed") {
        setAutoFloorDetectionRunState("failed");
        setAutoFloorDetectionFailureReasons(
          result.failureReasons.length > 0 ? result.failureReasons : ["Detection failed for an unknown reason."]
        );
        return;
      }

      setAutoFloorDetectionResult(result);
      setSelectedAutoFloorCandidateId(result.selectedCandidateId);
      setAutoFloorDetectionRunState("completed");
    } finally {
      autoFloorDetectionInFlightRef.current = false;
    }
  }, [
    floorPolygon,
    roomImageUrl,
    rendererSize.width,
    rendererSize.height,
    floorMapping.worldWidth,
    floorMapping.worldDepth,
    selectedAutoFloorProviderId,
    imageIntrinsicSize,
  ]);

  // Phase 2D: explicit, user-controlled apply of the selected suggestion into the
  // editable manual floor polygon. Never auto-applies; only invalid geometry is
  // blocked. Copies the quad (does not mutate the candidate object) and clears
  // in-progress floor interaction state so the manual editor stays consistent.
  const canApplyAutoFloorCandidate =
    !!selectedAutoFloorCandidate &&
    !!selectedAutoFloorCandidateScore &&
    selectedAutoFloorCandidateScore.scoreBand !== "invalid";

  const handleApplySuggestedQuad = useCallback(() => {
    if (
      !selectedAutoFloorCandidate ||
      !selectedAutoFloorCandidateScore ||
      selectedAutoFloorCandidateScore.scoreBand === "invalid"
    ) {
      return;
    }

    const appliedPolygon: FloorPoint[] = selectedAutoFloorCandidate.quadNorm.map((point) => ({
      x: point.x,
      y: point.y,
    }));
    setFloorPolygon(appliedPolygon);

    // Clear in-progress floor interaction state (mirrors the reset workflow).
    setActiveFloorHandleIndex(null);
    dragPointerIdRef.current = null;
    objectHandleDragPointerIdRef.current = null;
    setActiveObjectHandleMode(null);
    setWasLastObjectHandleMoveRejected(false);
    setLastObjectHandleRotateDeltaDeg(null);
    setLastObjectHandleScaleMultiplier(null);
    setLastObjectHandleHeightDeltaYUnits(null);
    floorAnchorDragPointerIdRef.current = null;
    setIsFloorAnchorDragActive(false);
    setWasLastAnchorDragMoveRejected(false);

    // Applying a new polygon invalidates any active calibrated camera snapshot.
    const wasCalibratedCameraActive = calibratedCameraActiveRef.current;
    if (wasCalibratedCameraActive) {
      deactivateCalibratedCameraMode({ clearAutoRevertReason: true });
    }

    setAppliedAutoFloorCandidateId(selectedAutoFloorCandidate.id);
    setLastAutoFloorApplyMessage(
      wasCalibratedCameraActive
        ? "Applied suggested quad; calibrated camera was reverted because the floor polygon changed."
        : `Applied suggested quad "${selectedAutoFloorCandidate.label}" to the editable floor polygon.`
    );
  }, [deactivateCalibratedCameraMode, selectedAutoFloorCandidate, selectedAutoFloorCandidateScore]);

  const buildCurrentSceneStatePayload = (exportedAtIso: string) =>
    {
      const roomImageUrlTrimmed = roomImageUrl.trim();
      const hasValidIntrinsicImageSize =
        !!imageIntrinsicSize &&
        Number.isFinite(imageIntrinsicSize.width) &&
        Number.isFinite(imageIntrinsicSize.height) &&
        imageIntrinsicSize.width > 0 &&
        imageIntrinsicSize.height > 0;
      const hasValidRendererSize =
        Number.isFinite(rendererSize.width) &&
        Number.isFinite(rendererSize.height) &&
        rendererSize.width > 0 &&
        rendererSize.height > 0;
      const authoritativeCalibrationFovDeg = calibratedCameraSnapshot?.fovDeg ?? null;
      const hasValidAuthoritativeFov =
        authoritativeCalibrationFovDeg !== null &&
        Number.isFinite(authoritativeCalibrationFovDeg) &&
        authoritativeCalibrationFovDeg >= CALIBRATED_SCENE_STATE_MIN_VERTICAL_FOV_DEG &&
        authoritativeCalibrationFovDeg <= CALIBRATED_SCENE_STATE_MAX_VERTICAL_FOV_DEG;
      const calibrationForExport: CalibratedSceneStateCalibrationV1 | undefined =
        isCalibratedCameraActive &&
        !!calibratedCameraSnapshot &&
        roomImageUrlTrimmed.length > 0 &&
        hasValidIntrinsicImageSize &&
        hasValidRendererSize &&
        hasValidAuthoritativeFov
          ? {
              calibrationVersion: CALIBRATED_SCENE_STATE_CALIBRATION_VERSION_V1,
              solver: CALIBRATED_SCENE_STATE_SOLVER_V1,
              intrinsics: {
                verticalFovDeg: authoritativeCalibrationFovDeg,
              },
              frameAspect: rendererSize.width / rendererSize.height,
              source: {
                imageUrl: roomImageUrlTrimmed,
                intrinsicWidth: imageIntrinsicSize.width,
                intrinsicHeight: imageIntrinsicSize.height,
              },
            }
          : undefined;

      return buildSceneStatePayload({
        exportedAtIso,
        roomImageUrl,
        modelPath,
        activeObjectType: currentActiveObjectType,
        glbLoadStatus: modelLoadState,
        modelNormalization,
        transform: {
          positionX: transform.positionX,
          positionY: transform.positionY,
          positionZ: transform.positionZ,
          rotationYDeg: transform.rotationYDeg,
          uniformScale: transform.uniformScale,
          autoRotate: autoRotateEnabled,
        },
        floor: {
          polygon: floorPolygon,
          overlayVisible: showFloorOverlay,
          placementModeEnabled: isFloorClickPlacementEnabled,
          lastAcceptedClick: lastAcceptedFloorClick,
          lastRejectedClick: lastRejectedFloorClick,
          mapping: floorMapping,
          perspectiveDepthScaling,
        },
        image: imageIntrinsicSize
          ? {
              intrinsicWidth: imageIntrinsicSize.width,
              intrinsicHeight: imageIntrinsicSize.height,
              coordinateSpace: SCENE_IMAGE_COORDINATE_SPACE_V0,
            }
          : null,
        calibration: calibrationForExport,
        debug: {
          rendererSize,
          imageStatus: imageLoadState,
          modelStatus: formatModelStatus(modelLoadState, modelLoadError),
        },
      });
    };

  const sceneStateJson = useMemo(() => {
    const payload = buildCurrentSceneStatePayload(sceneStateExportedAt);
    return JSON.stringify(payload, null, 2);
  }, [
    activeObjectKind,
    autoRotateEnabled,
    floorMapping.depthCenterY,
    floorMapping.worldDepth,
    floorMapping.worldWidth,
    perspectiveDepthScaling.enabled,
    perspectiveDepthScaling.farFloorY,
    perspectiveDepthScaling.farScaleMultiplier,
    perspectiveDepthScaling.nearFloorY,
    perspectiveDepthScaling.nearScaleMultiplier,
    floorPolygon,
    imageIntrinsicSize,
    imageLoadState,
    isFloorClickPlacementEnabled,
    lastAcceptedFloorClick,
    lastRejectedFloorClick,
    modelLoadError,
    modelLoadState,
    modelPath,
    modelNormalization.modelScaleMultiplier,
    modelNormalization.modelYOffset,
    modelNormalization.modelYawOffsetDeg,
    calibratedCameraSnapshot,
    isCalibratedCameraActive,
    rendererSize,
    roomImageUrl,
    sceneStateExportedAt,
    showFloorOverlay,
    transform.positionX,
    transform.positionY,
    transform.positionZ,
    transform.rotationYDeg,
    transform.uniformScale,
  ]);

  const getNormalizedOverlayPointFromClient = (clientX: number, clientY: number): FloorPoint | null => {
    const overlay = floorOverlayRef.current;
    if (!overlay) return null;
    const rect = overlay.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: clampValue((clientX - rect.left) / rect.width, 0, 1),
      y: clampValue((clientY - rect.top) / rect.height, 0, 1),
    };
  };

  const applyFloorPlacement = (point: FloorPoint, options?: { source?: "floor-click" | "other" }) => {
    let mapped = mapFloorPointToObjectTransform(point, floorMapping);
    let markerPointForAcceptedClick = point;

    if (options?.source === "floor-click") {
      let mappingResultForDebug = "Legacy";
      const tryHomographyMapping = (): { ok: true; mapped: { positionX: number; positionZ: number } } | { ok: false; reason: string } => {
        if (homographyDebug.cornerOrderStatus !== "ok") {
          return { ok: false, reason: "corner ordering unavailable" };
        }
        if (homographyDebug.cornerOrderConfidence !== "high") {
          return { ok: false, reason: "corner order confidence is not high" };
        }
        if (!homographyDebug.frameSize) {
          return { ok: false, reason: "frame size is invalid" };
        }
        if (homographyDebug.homographySolveStatus !== "ok" || !homographyDebug.homographyMatrixForPlacement) {
          return { ok: false, reason: homographyDebug.placementFallbackReason };
        }
        const pointPixels = normToPixels(point, homographyDebug.frameSize);
        if (!pointPixels) {
          return { ok: false, reason: "floor click could not convert to frame pixels" };
        }
        const mappedHomography = applyHomography(homographyDebug.homographyMatrixForPlacement, pointPixels);
        if (!mappedHomography || !Number.isFinite(mappedHomography.x) || !Number.isFinite(mappedHomography.y)) {
          return { ok: false, reason: "homography projection returned invalid coordinates" };
        }
        return {
          ok: true,
          mapped: {
            positionX: mappedHomography.x,
            positionZ: mappedHomography.y,
          },
        };
      };

      if (isCalibratedCameraActive) {
        const rayFloorResult = intersectOverlayRayWithFloorPlane(point, cameraRef.current, 0);
        if (rayFloorResult.ok) {
          mapped = {
            positionX: rayFloorResult.floorPlane2D.x,
            positionZ: rayFloorResult.floorPlane2D.y,
          };
          mappingResultForDebug = "Calibrated ray-floor";
          const frameSize: ImageFrameSize | null =
            rendererSize.width > 0 && rendererSize.height > 0
              ? { width: rendererSize.width, height: rendererSize.height }
              : null;
          if (frameSize && cameraRef.current) {
            const projectedFloorContact = projectWorldPointToOverlayNormalized(cameraRef.current, frameSize, {
              x: mapped.positionX,
              y: 0,
              z: mapped.positionZ,
            });
            if (
              projectedFloorContact &&
              projectedFloorContact.inFront &&
              Number.isFinite(projectedFloorContact.normalized.x) &&
              Number.isFinite(projectedFloorContact.normalized.y) &&
              projectedFloorContact.normalized.x >= 0 &&
              projectedFloorContact.normalized.x <= 1 &&
              projectedFloorContact.normalized.y >= 0 &&
              projectedFloorContact.normalized.y <= 1
            ) {
              markerPointForAcceptedClick = projectedFloorContact.normalized;
            }
          }
        } else {
          const homographyMapping = tryHomographyMapping();
          if (homographyMapping.ok) {
            mapped = homographyMapping.mapped;
            mappingResultForDebug = "Calibrated ray-floor fallback to homography";
          } else {
            mappingResultForDebug = `Calibrated ray-floor unavailable; homography unavailable — fell back to legacy (weak fallback): ${homographyMapping.reason}`;
          }
        }
      } else if (floorClickMappingMode === "homography-experimental") {
        const homographyMapping = tryHomographyMapping();
        if (homographyMapping.ok) {
          mapped = homographyMapping.mapped;
          mappingResultForDebug = "Homography experimental";
        } else {
          mappingResultForDebug = `Homography experimental unavailable — fell back to legacy: ${homographyMapping.reason}`;
        }
      }

      setLastFloorClickMappingResult(mappingResultForDebug);
    }

    updateTransformState((prev) => ({ ...prev, positionX: mapped.positionX, positionZ: mapped.positionZ }), {
      markOwned: true,
    });
    setLastAcceptedFloorClick(markerPointForAcceptedClick);
    setLastRejectedFloorClick(null);
  };

  const updateFloorHandleFromClientPoint = (clientX: number, clientY: number) => {
    const activeIndex = activeFloorHandleIndex;
    if (activeIndex === null) return;
    const normalizedPoint = getNormalizedOverlayPointFromClient(clientX, clientY);
    if (!normalizedPoint) return;
    setFloorPolygon((prev) =>
      prev.map((point, index) => (index === activeIndex ? normalizedPoint : point))
    );
  };

  const getAnchorClientVector = (clientX: number, clientY: number) => {
    if (!lastAcceptedFloorClick) return null;
    const overlay = floorOverlayRef.current;
    if (!overlay) return null;
    const rect = overlay.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const anchorClientX = rect.left + lastAcceptedFloorClick.x * rect.width;
    const anchorClientY = rect.top + lastAcceptedFloorClick.y * rect.height;
    const dx = clientX - anchorClientX;
    const dy = clientY - anchorClientY;
    const distance = Math.hypot(dx, dy);
    return { dx, dy, distance };
  };

  const handleObjectMoveHandlePointerDown = (event: PointerEvent<SVGCircleElement>) => {
    if (!isObject2DHandlesEffectivelyEnabled || !lastAcceptedFloorClick) return;
    event.preventDefault();
    event.stopPropagation();
    objectHandleDragPointerIdRef.current = event.pointerId;
    setActiveObjectHandleMode("move");
    setWasLastObjectHandleMoveRejected(false);
    try {
      floorOverlayRef.current?.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can fail in edge cases; move still works while pointer remains in bounds.
    }
  };

  const handleCalibratedMoveHandlePointerDown = (event: PointerEvent<SVGCircleElement>) => {
    if (!calibratedMoveHandleStatus.available) return;
    const normalizedPoint = getNormalizedOverlayPointFromClient(event.clientX, event.clientY);
    if (!normalizedPoint) {
      setLastCalibratedMoveStatus("rejected — pointer normalization unavailable");
      return;
    }
    const rayResult = intersectOverlayRayWithFloorPlane(normalizedPoint, cameraRef.current, 0);
    if (!rayResult.ok) {
      setLastCalibratedMoveStatus(`rejected — ${rayResult.reason}`);
      return;
    }
    const currentTransform = transformRef.current;
    calibratedMoveGrabOffsetRef.current = {
      offsetX: currentTransform.positionX - rayResult.floorPlane2D.x,
      offsetZ: currentTransform.positionZ - rayResult.floorPlane2D.y,
    };
    calibratedMoveDragPointerIdRef.current = event.pointerId;
    setLastCalibratedMoveStatus("dragging");
    event.preventDefault();
    event.stopPropagation();
    try {
      floorOverlayRef.current?.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can fail in edge cases; drag can continue while pointer stays in bounds.
    }
  };

  // Phase 2I-A: client-space vector from the authoritative calibrated floor-contact
  // anchor (projected { x: positionX, y: 0, z: positionZ }) to the pointer. This is
  // deliberately NOT sourced from lastAcceptedFloorClick.
  const getCalibratedRotateAnchorClientVector = (clientX: number, clientY: number) => {
    const anchor = calibratedMoveHandleAnchorProjection.normalized;
    if (!anchor) return null;
    const overlay = floorOverlayRef.current;
    if (!overlay) return null;
    const rect = overlay.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const anchorClientX = rect.left + anchor.x * rect.width;
    const anchorClientY = rect.top + anchor.y * rect.height;
    const dx = clientX - anchorClientX;
    const dy = clientY - anchorClientY;
    const distance = Math.hypot(dx, dy);
    return { dx, dy, distance };
  };

  const clearCalibratedRotateDragState = (event?: PointerEvent<SVGSVGElement>) => {
    const pointerId = event?.pointerId ?? calibratedRotateDragPointerIdRef.current;
    if (pointerId !== null) {
      try {
        floorOverlayRef.current?.releasePointerCapture(pointerId);
      } catch {
        // Ignore release failures when capture is already cleared.
      }
    }
    calibratedRotateDragPointerIdRef.current = null;
    calibratedRotateStartTransformRef.current = null;
  };

  const handleCalibratedRotateHandlePointerDown = (event: PointerEvent<SVGElement>) => {
    if (!calibratedRotateHandleStatus.available) return;
    const vector = getCalibratedRotateAnchorClientVector(event.clientX, event.clientY);
    if (!vector) {
      setLastCalibratedRotateStatus("rejected — rotate anchor unavailable");
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    calibratedRotateDragPointerIdRef.current = event.pointerId;
    calibratedRotateStartAngleRadRef.current = Math.atan2(vector.dy, vector.dx);
    calibratedRotateStartRotationDegRef.current = transformRef.current.rotationYDeg;
    // Capture the full starting transform so the move path can prove only
    // rotationYDeg changes (strict Rotate invariant).
    calibratedRotateStartTransformRef.current = transformRef.current;
    setLastCalibratedRotateStatus("dragging");
    setLastCalibratedRotateDeltaDeg(0);
    try {
      floorOverlayRef.current?.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can fail in edge cases; rotate still works while pointer remains in bounds.
    }
  };

  // Phase 2I-B1: client-space vector from the authoritative calibrated floor-contact
  // anchor (projected { x: positionX, y: 0, z: positionZ }) to the pointer. Same
  // anchor source as MOVE/Rotate; deliberately NOT lastAcceptedFloorClick.
  const getCalibratedScaleAnchorClientVector = (clientX: number, clientY: number) => {
    const anchor = calibratedMoveHandleAnchorProjection.normalized;
    if (!anchor) return null;
    const overlay = floorOverlayRef.current;
    if (!overlay) return null;
    const rect = overlay.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const anchorClientX = rect.left + anchor.x * rect.width;
    const anchorClientY = rect.top + anchor.y * rect.height;
    const dx = clientX - anchorClientX;
    const dy = clientY - anchorClientY;
    const distance = Math.hypot(dx, dy);
    return { dx, dy, distance };
  };

  const clearCalibratedScaleDragState = (event?: PointerEvent<SVGSVGElement>) => {
    const pointerId = event?.pointerId ?? calibratedScaleDragPointerIdRef.current;
    if (pointerId !== null) {
      try {
        floorOverlayRef.current?.releasePointerCapture(pointerId);
      } catch {
        // Ignore release failures when capture is already cleared.
      }
    }
    calibratedScaleDragPointerIdRef.current = null;
    calibratedScaleStartTransformRef.current = null;
  };

  const handleCalibratedScaleHandlePointerDown = (event: PointerEvent<SVGElement>) => {
    if (!calibratedScaleHandleStatus.available) return;
    const vector = getCalibratedScaleAnchorClientVector(event.clientX, event.clientY);
    if (!vector) {
      setLastCalibratedScaleStatus("rejected — scale anchor unavailable");
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    calibratedScaleDragPointerIdRef.current = event.pointerId;
    calibratedScaleStartDistancePxRef.current = Math.max(
      vector.distance,
      OBJECT_HANDLE_SCALE_MIN_START_DISTANCE_PX
    );
    calibratedScaleStartUniformScaleRef.current = transformRef.current.uniformScale;
    // Capture the full starting transform so the move path can prove only
    // uniformScale changes (strict Scale invariant).
    calibratedScaleStartTransformRef.current = transformRef.current;
    setLastCalibratedScaleStatus("dragging");
    setLastCalibratedScaleMultiplier(1);
    try {
      floorOverlayRef.current?.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can fail in edge cases; scale still works while pointer remains in bounds.
    }
  };

  const clearCalibratedLiftDragState = (event?: PointerEvent<SVGSVGElement>) => {
    const pointerId = event?.pointerId ?? calibratedLiftDragPointerIdRef.current;
    if (pointerId !== null) {
      try {
        floorOverlayRef.current?.releasePointerCapture(pointerId);
      } catch {
        // Ignore release failures when capture is already cleared.
      }
    }
    calibratedLiftDragPointerIdRef.current = null;
    calibratedLiftStartClientPointRef.current = null;
    calibratedLiftStartTransformRef.current = null;
  };

  const handleCalibratedLiftHandlePointerDown = (event: PointerEvent<SVGElement>) => {
    if (!calibratedLiftHandleStatus.available) return;
    event.preventDefault();
    event.stopPropagation();
    calibratedLiftDragPointerIdRef.current = event.pointerId;
    calibratedLiftStartPositionYRef.current = transformRef.current.positionY;
    calibratedLiftStartClientPointRef.current = { x: event.clientX, y: event.clientY };
    // Capture the full starting transform so the move path can prove only
    // positionY changes (strict Lift invariant).
    calibratedLiftStartTransformRef.current = transformRef.current;
    setLastCalibratedLiftStatus("dragging");
    setLastCalibratedLiftDeltaY(0);
    try {
      floorOverlayRef.current?.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can fail in edge cases; lift still works while pointer remains in bounds.
    }
  };

  // Phase 2I-C1: explicit return-to-floor. Sets positionY to exactly 0 while
  // preserving every other transform field and all calibrated/depth state.
  const handleCalibratedDropToFloor = () => {
    if (!calibratedDropToFloorAvailable) return;
    if (transformRef.current.positionY <= CALIBRATED_LIFT_RESTING_SNAP_EPSILON) return;
    updateTransformState(
      (prev) => ({
        positionX: prev.positionX,
        positionY: 0,
        positionZ: prev.positionZ,
        rotationYDeg: prev.rotationYDeg,
        uniformScale: prev.uniformScale,
      }),
      { markOwned: true }
    );
    setLastCalibratedLiftDeltaY(null);
    setLastCalibratedLiftStatus("dropped to floor");
  };

  const handleObjectRotateHandlePointerDown = (event: PointerEvent<SVGElement>) => {
    if (!isObject2DHandlesEffectivelyEnabled || !lastAcceptedFloorClick) return;
    const vector = getAnchorClientVector(event.clientX, event.clientY);
    if (!vector) return;
    event.preventDefault();
    event.stopPropagation();
    objectHandleDragPointerIdRef.current = event.pointerId;
    setActiveObjectHandleMode("rotate");
    setWasLastObjectHandleMoveRejected(false);
    objectHandleRotateStartAngleRadRef.current = Math.atan2(vector.dy, vector.dx);
    objectHandleRotateStartRotationDegRef.current = transformRef.current.rotationYDeg;
    setLastObjectHandleRotateDeltaDeg(0);
    try {
      floorOverlayRef.current?.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can fail in edge cases; rotate still works while pointer remains in bounds.
    }
  };

  const handleObjectScaleHandlePointerDown = (event: PointerEvent<SVGElement>) => {
    if (!isObject2DHandlesEffectivelyEnabled || !lastAcceptedFloorClick) return;
    const vector = getAnchorClientVector(event.clientX, event.clientY);
    if (!vector) return;
    event.preventDefault();
    event.stopPropagation();
    objectHandleDragPointerIdRef.current = event.pointerId;
    setActiveObjectHandleMode("scale");
    setWasLastObjectHandleMoveRejected(false);
    objectHandleScaleStartDistancePxRef.current = Math.max(
      vector.distance,
      OBJECT_HANDLE_SCALE_MIN_START_DISTANCE_PX
    );
    objectHandleScaleStartUniformScaleRef.current = transformRef.current.uniformScale;
    setLastObjectHandleScaleMultiplier(1);
    try {
      floorOverlayRef.current?.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can fail in edge cases; scale still works while pointer remains in bounds.
    }
  };

  const handleObjectHeightHandlePointerDown = (event: PointerEvent<SVGElement>) => {
    if (!isObject2DHandlesEffectivelyEnabled || !lastAcceptedFloorClick) return;
    event.preventDefault();
    event.stopPropagation();
    objectHandleDragPointerIdRef.current = event.pointerId;
    setActiveObjectHandleMode("height");
    setWasLastObjectHandleMoveRejected(false);
    objectHandleHeightStartClientYRef.current = event.clientY;
    objectHandleHeightStartPositionYRef.current = transformRef.current.positionY;
    setLastObjectHandleHeightDeltaYUnits(0);
    try {
      floorOverlayRef.current?.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can fail in edge cases; height adjust still works while pointer remains in bounds.
    }
  };

  const handleFloorHandlePointerDown = (index: number, event: PointerEvent<SVGCircleElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragPointerIdRef.current = event.pointerId;
    setActiveFloorHandleIndex(index);
    updateFloorHandleFromClientPoint(event.clientX, event.clientY);
    try {
      floorOverlayRef.current?.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can fail in some edge cases; dragging still works while pointer stays in bounds.
    }
  };

  const handleFloorOverlayPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (activeFloorHandleIndex !== null && dragPointerIdRef.current === event.pointerId) {
      event.preventDefault();
      updateFloorHandleFromClientPoint(event.clientX, event.clientY);
      return;
    }

    if (activeObjectHandleMode === "move" && objectHandleDragPointerIdRef.current === event.pointerId) {
      event.preventDefault();
      const normalizedPoint = getNormalizedOverlayPointFromClient(event.clientX, event.clientY);
      if (!normalizedPoint) return;
      const isInside = isPointInsidePolygon(normalizedPoint, floorPolygon);
      if (!isInside) {
        setWasLastObjectHandleMoveRejected(true);
        return;
      }
      setWasLastObjectHandleMoveRejected(false);
      applyFloorPlacement(normalizedPoint);
      return;
    }

    if (calibratedMoveDragPointerIdRef.current === event.pointerId) {
      if (!calibratedCameraActiveRef.current) {
        calibratedMoveDragPointerIdRef.current = null;
        calibratedMoveGrabOffsetRef.current = null;
        return;
      }
      event.preventDefault();
      const normalizedPoint = getNormalizedOverlayPointFromClient(event.clientX, event.clientY);
      if (!normalizedPoint) {
        setLastCalibratedMoveStatus("rejected — pointer normalization unavailable");
        return;
      }
      const rayResult = intersectOverlayRayWithFloorPlane(normalizedPoint, cameraRef.current, 0);
      if (!rayResult.ok) {
        setLastCalibratedMoveStatus(`rejected — ${rayResult.reason}`);
        return;
      }
      const grabOffset = calibratedMoveGrabOffsetRef.current;
      if (!grabOffset) {
        setLastCalibratedMoveStatus("rejected — grab offset unavailable");
        return;
      }
      const nextX = rayResult.floorPlane2D.x + grabOffset.offsetX;
      const nextZ = rayResult.floorPlane2D.y + grabOffset.offsetZ;
      const frameSize: ImageFrameSize | null =
        rendererSize.width > 0 && rendererSize.height > 0
          ? { width: rendererSize.width, height: rendererSize.height }
          : null;
      if (!frameSize || !cameraRef.current) {
        setLastCalibratedMoveStatus("rejected — camera or frame unavailable");
        return;
      }
      const projectedFloorContact = projectWorldPointToOverlayNormalized(cameraRef.current, frameSize, {
        x: nextX,
        y: 0,
        z: nextZ,
      });
      if (!projectedFloorContact || !projectedFloorContact.inFront) {
        setLastCalibratedMoveStatus("rejected — floor-contact projection unavailable");
        return;
      }
      const projectedNormalized = projectedFloorContact.normalized;
      if (
        !Number.isFinite(projectedNormalized.x) ||
        !Number.isFinite(projectedNormalized.y) ||
        projectedNormalized.x < 0 ||
        projectedNormalized.x > 1 ||
        projectedNormalized.y < 0 ||
        projectedNormalized.y > 1
      ) {
        setLastCalibratedMoveStatus("rejected — floor-contact projection is off-screen");
        return;
      }
      const isInside = isPointInsidePolygon(projectedNormalized, floorPolygon);
      if (!isInside) {
        setLastCalibratedMoveStatus("rejected — outside floor polygon");
        return;
      }
      updateTransformState((prev) => ({ ...prev, positionX: nextX, positionZ: nextZ }), {
        markOwned: true,
      });
      setLastAcceptedFloorClick(projectedNormalized);
      setLastRejectedFloorClick(null);
      setLastCalibratedMoveStatus("ok");
      return;
    }

    if (calibratedRotateDragPointerIdRef.current === event.pointerId) {
      // Calibrated Rotate is only valid while calibrated camera is active and
      // auto-rotate is off; otherwise bail and clear to avoid stale drags.
      if (!calibratedCameraActiveRef.current || autoRotateEnabledRef.current) {
        clearCalibratedRotateDragState();
        setLastCalibratedRotateStatus("none");
        return;
      }
      event.preventDefault();
      const vector = getCalibratedRotateAnchorClientVector(event.clientX, event.clientY);
      if (!vector) {
        setLastCalibratedRotateStatus("rejected — rotate anchor unavailable");
        return;
      }
      if (vector.distance < OBJECT_HANDLE_ROTATE_DEADZONE_PX) return;
      const currentAngle = Math.atan2(vector.dy, vector.dx);
      const rawDelta = currentAngle - calibratedRotateStartAngleRadRef.current;
      const normalizedDelta = Math.atan2(Math.sin(rawDelta), Math.cos(rawDelta));
      const deltaDeg = THREE.MathUtils.radToDeg(normalizedDelta);
      const nextRotation = clampValue(
        calibratedRotateStartRotationDegRef.current + deltaDeg,
        TRANSFORM_LIMITS.rotationYDeg.min,
        TRANSFORM_LIMITS.rotationYDeg.max
      );
      setLastCalibratedRotateDeltaDeg(deltaDeg);
      // Strict Rotate invariant guard: write ONLY rotationYDeg. Every other
      // transform field is carried over unchanged from current state, and depth
      // scaling / calibrated snapshot / mode are never touched here.
      updateTransformState(
        (prev) => ({
          positionX: prev.positionX,
          positionY: prev.positionY,
          positionZ: prev.positionZ,
          uniformScale: prev.uniformScale,
          rotationYDeg: nextRotation,
        }),
        { markOwned: true }
      );
      setLastCalibratedRotateStatus("ok");
      return;
    }

    if (calibratedScaleDragPointerIdRef.current === event.pointerId) {
      // Calibrated Scale is only valid while calibrated camera is active, auto-rotate
      // is off, and grounded eligibility still holds; otherwise bail and clear to
      // avoid stale drags. A mid-gesture eligibility loss must not mutate transform.
      if (
        !calibratedCameraActiveRef.current ||
        autoRotateEnabledRef.current ||
        !calibratedScaleHandleStatus.available
      ) {
        clearCalibratedScaleDragState();
        setLastCalibratedScaleStatus("none");
        return;
      }
      event.preventDefault();
      const vector = getCalibratedScaleAnchorClientVector(event.clientX, event.clientY);
      if (!vector) {
        setLastCalibratedScaleStatus("rejected — scale anchor unavailable");
        return;
      }
      const startDistance = Math.max(
        calibratedScaleStartDistancePxRef.current,
        OBJECT_HANDLE_SCALE_MIN_START_DISTANCE_PX
      );
      const multiplier = Math.max(vector.distance, OBJECT_HANDLE_SCALE_MIN_START_DISTANCE_PX) / startDistance;
      const nextScale = clampValue(
        calibratedScaleStartUniformScaleRef.current * multiplier,
        TRANSFORM_LIMITS.uniformScale.min,
        TRANSFORM_LIMITS.uniformScale.max
      );
      setLastCalibratedScaleMultiplier(multiplier);
      // Strict Scale invariant guard: write ONLY uniformScale. Every other
      // transform field is carried over unchanged from current state, and depth
      // scaling / calibrated snapshot / mode / lastAcceptedFloorClick are untouched.
      // No positionY compensation in this grounded-only slice.
      updateTransformState(
        (prev) => ({
          positionX: prev.positionX,
          positionY: prev.positionY,
          positionZ: prev.positionZ,
          rotationYDeg: prev.rotationYDeg,
          uniformScale: nextScale,
        }),
        { markOwned: true }
      );
      setLastCalibratedScaleStatus("ok");
      return;
    }

    if (calibratedLiftDragPointerIdRef.current === event.pointerId) {
      // Calibrated Lift is only valid while calibrated camera is active, auto-rotate
      // is off, and grounded eligibility still holds; otherwise bail and clear to
      // avoid stale drags. A mid-gesture eligibility loss must not mutate transform.
      if (
        !calibratedCameraActiveRef.current ||
        autoRotateEnabledRef.current ||
        !calibratedLiftHandleStatus.available
      ) {
        clearCalibratedLiftDragState();
        setLastCalibratedLiftStatus("none");
        return;
      }
      const startClientPoint = calibratedLiftStartClientPointRef.current;
      if (!startClientPoint) {
        setLastCalibratedLiftStatus("rejected — lift start point unavailable");
        return;
      }
      const camera = cameraRef.current;
      const frameSize: ImageFrameSize | null =
        rendererSize.width > 0 && rendererSize.height > 0
          ? { width: rendererSize.width, height: rendererSize.height }
          : null;
      if (!camera || !frameSize) {
        setLastCalibratedLiftStatus("rejected — camera or frame unavailable");
        return;
      }
      // Camera-aware vertical mapping: project a 1-unit world-Y reference segment
      // along the object's vertical line (centered at the current lift height) and
      // map pointer travel along that screen direction to a world-Y delta.
      const refLow = projectWorldPointToOverlayNormalized(camera, frameSize, {
        x: transform.positionX,
        y: calibratedLiftStartPositionYRef.current,
        z: transform.positionZ,
      });
      const refHigh = projectWorldPointToOverlayNormalized(camera, frameSize, {
        x: transform.positionX,
        y: calibratedLiftStartPositionYRef.current + 1,
        z: transform.positionZ,
      });
      if (!refLow || !refLow.inFront || !refHigh || !refHigh.inFront) {
        setLastCalibratedLiftStatus("rejected — vertical reference unavailable");
        return;
      }
      event.preventDefault();
      const mapping = mapPointerTravelToWorldYDelta({
        refLowScreenPx: refLow.pixels,
        refHighScreenPx: refHigh.pixels,
        refWorldYSpan: 1,
        startPointerPx: startClientPoint,
        currentPointerPx: { x: event.clientX, y: event.clientY },
      });
      if (!mapping.ok) {
        setLastCalibratedLiftStatus(`rejected — ${mapping.reason}`);
        return;
      }
      // Phase 2I-C1A: cap the gesture at the camera-aware safe maximum so the
      // lifted anchor/handle can never rise to a stranding (off-screen) height.
      const effectiveMaxLiftY = calibratedLiftSafeRange.ok
        ? Math.min(TRANSFORM_LIMITS.positionY.max, calibratedLiftSafeRange.safeMaxLiftY)
        : 0;
      const rawNextPositionY = calibratedLiftStartPositionYRef.current + mapping.deltaWorldY;
      let nextPositionY = clampValue(rawNextPositionY, 0, effectiveMaxLiftY);
      const cappedBySafeMax = rawNextPositionY > effectiveMaxLiftY && nextPositionY === effectiveMaxLiftY;
      if (nextPositionY <= CALIBRATED_LIFT_RESTING_SNAP_EPSILON) {
        nextPositionY = 0;
      }
      setLastCalibratedLiftDeltaY(nextPositionY - calibratedLiftStartPositionYRef.current);
      // Strict Lift invariant guard: write ONLY positionY. Every other transform
      // field is carried over unchanged from current state; depth scaling /
      // calibrated snapshot / mode / lastAcceptedFloorClick are untouched.
      updateTransformState(
        (prev) => ({
          positionX: prev.positionX,
          positionY: nextPositionY,
          positionZ: prev.positionZ,
          rotationYDeg: prev.rotationYDeg,
          uniformScale: prev.uniformScale,
        }),
        { markOwned: true }
      );
      setLastCalibratedLiftStatus(
        nextPositionY === 0
          ? "resting"
          : cappedBySafeMax
            ? "lift capped at calibrated safe viewport height"
            : "ok"
      );
      return;
    }

    if (activeObjectHandleMode === "rotate" && objectHandleDragPointerIdRef.current === event.pointerId) {
      event.preventDefault();
      const vector = getAnchorClientVector(event.clientX, event.clientY);
      if (!vector) return;
      if (vector.distance < OBJECT_HANDLE_ROTATE_DEADZONE_PX) return;
      const currentAngle = Math.atan2(vector.dy, vector.dx);
      const rawDelta = currentAngle - objectHandleRotateStartAngleRadRef.current;
      const normalizedDelta = Math.atan2(Math.sin(rawDelta), Math.cos(rawDelta));
      const deltaDeg = THREE.MathUtils.radToDeg(normalizedDelta);
      const nextRotation = clampValue(
        objectHandleRotateStartRotationDegRef.current + deltaDeg,
        TRANSFORM_LIMITS.rotationYDeg.min,
        TRANSFORM_LIMITS.rotationYDeg.max
      );
      setLastObjectHandleRotateDeltaDeg(deltaDeg);
      updateTransformState((prev) => ({ ...prev, rotationYDeg: nextRotation }), { markOwned: true });
      return;
    }

    if (activeObjectHandleMode === "scale" && objectHandleDragPointerIdRef.current === event.pointerId) {
      event.preventDefault();
      const vector = getAnchorClientVector(event.clientX, event.clientY);
      if (!vector) return;
      const startDistance = Math.max(
        objectHandleScaleStartDistancePxRef.current,
        OBJECT_HANDLE_SCALE_MIN_START_DISTANCE_PX
      );
      const multiplier = Math.max(vector.distance, OBJECT_HANDLE_SCALE_MIN_START_DISTANCE_PX) / startDistance;
      const nextScale = clampValue(
        objectHandleScaleStartUniformScaleRef.current * multiplier,
        TRANSFORM_LIMITS.uniformScale.min,
        TRANSFORM_LIMITS.uniformScale.max
      );
      setLastObjectHandleScaleMultiplier(multiplier);
      updateTransformState((prev) => ({ ...prev, uniformScale: nextScale }), { markOwned: true });
      return;
    }

    if (activeObjectHandleMode === "height" && objectHandleDragPointerIdRef.current === event.pointerId) {
      event.preventDefault();
      const deltaYPx = event.clientY - objectHandleHeightStartClientYRef.current;
      const deltaYUnits = -deltaYPx / OBJECT_HANDLE_HEIGHT_PIXELS_PER_UNIT;
      const nextPositionY = clampValue(
        objectHandleHeightStartPositionYRef.current + deltaYUnits,
        TRANSFORM_LIMITS.positionY.min,
        TRANSFORM_LIMITS.positionY.max
      );
      setLastObjectHandleHeightDeltaYUnits(deltaYUnits);
      updateTransformState((prev) => ({ ...prev, positionY: nextPositionY }), { markOwned: true });
      return;
    }

    if (!isFloorAnchorDragActive || floorAnchorDragPointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    const normalizedPoint = getNormalizedOverlayPointFromClient(event.clientX, event.clientY);
    if (!normalizedPoint) return;
    const isInside = isPointInsidePolygon(normalizedPoint, floorPolygon);
    if (!isInside) {
      setWasLastAnchorDragMoveRejected(true);
      return;
    }
    setWasLastAnchorDragMoveRejected(false);
    applyFloorPlacement(normalizedPoint, { source: "other" });
  };

  const handleFloorOverlayPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (!showFloorOverlay || !isFloorClickPlacementEnabled) return;
    if (activeFloorHandleIndex !== null) return;
    if (activeObjectHandleMode !== null) return;
    const normalizedPoint = getNormalizedOverlayPointFromClient(event.clientX, event.clientY);
    if (!normalizedPoint) return;
    const isInside = isPointInsidePolygon(normalizedPoint, floorPolygon);
    if (!isInside) {
      setLastRejectedFloorClick(normalizedPoint);
      return;
    }
    setWasLastAnchorDragMoveRejected(false);
    applyFloorPlacement(normalizedPoint, { source: "floor-click" });
  };

  const handleFloorAnchorPointerDown = (event: PointerEvent<SVGCircleElement>) => {
    if (!isFloorAnchorDragEffectivelyEnabled) return;
    event.preventDefault();
    event.stopPropagation();
    const acceptedPoint = lastAcceptedFloorClick;
    if (!acceptedPoint) return;
    floorAnchorDragPointerIdRef.current = event.pointerId;
    setIsFloorAnchorDragActive(true);
    setWasLastAnchorDragMoveRejected(false);
    try {
      floorOverlayRef.current?.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is optional in this lab; drag continues while pointer remains in bounds.
    }
  };

  const stopFloorHandleDrag = (event?: PointerEvent<SVGSVGElement>) => {
    const pointerId = event?.pointerId ?? dragPointerIdRef.current;
    if (pointerId !== null) {
      try {
        floorOverlayRef.current?.releasePointerCapture(pointerId);
      } catch {
        // Ignore release failures when capture is already cleared.
      }
    }
    dragPointerIdRef.current = null;
    setActiveFloorHandleIndex(null);

    const objectHandlePointerId = event?.pointerId ?? objectHandleDragPointerIdRef.current;
    if (objectHandlePointerId !== null) {
      try {
        floorOverlayRef.current?.releasePointerCapture(objectHandlePointerId);
      } catch {
        // Ignore release failures when capture is already cleared.
      }
    }
    objectHandleDragPointerIdRef.current = null;
    setActiveObjectHandleMode(null);

    const calibratedMovePointerId = event?.pointerId ?? calibratedMoveDragPointerIdRef.current;
    if (calibratedMovePointerId !== null) {
      try {
        floorOverlayRef.current?.releasePointerCapture(calibratedMovePointerId);
      } catch {
        // Ignore release failures when capture is already cleared.
      }
    }
    calibratedMoveDragPointerIdRef.current = null;
    calibratedMoveGrabOffsetRef.current = null;

    const calibratedRotatePointerId = event?.pointerId ?? calibratedRotateDragPointerIdRef.current;
    if (calibratedRotatePointerId !== null) {
      try {
        floorOverlayRef.current?.releasePointerCapture(calibratedRotatePointerId);
      } catch {
        // Ignore release failures when capture is already cleared.
      }
    }
    calibratedRotateDragPointerIdRef.current = null;
    calibratedRotateStartTransformRef.current = null;

    const calibratedScalePointerId = event?.pointerId ?? calibratedScaleDragPointerIdRef.current;
    if (calibratedScalePointerId !== null) {
      try {
        floorOverlayRef.current?.releasePointerCapture(calibratedScalePointerId);
      } catch {
        // Ignore release failures when capture is already cleared.
      }
    }
    calibratedScaleDragPointerIdRef.current = null;
    calibratedScaleStartTransformRef.current = null;

    const calibratedLiftPointerId = event?.pointerId ?? calibratedLiftDragPointerIdRef.current;
    if (calibratedLiftPointerId !== null) {
      try {
        floorOverlayRef.current?.releasePointerCapture(calibratedLiftPointerId);
      } catch {
        // Ignore release failures when capture is already cleared.
      }
    }
    calibratedLiftDragPointerIdRef.current = null;
    calibratedLiftStartClientPointRef.current = null;
    calibratedLiftStartTransformRef.current = null;

    const anchorPointerId = event?.pointerId ?? floorAnchorDragPointerIdRef.current;
    if (anchorPointerId !== null) {
      try {
        floorOverlayRef.current?.releasePointerCapture(anchorPointerId);
      } catch {
        // Ignore release failures when capture is already cleared.
      }
    }
    floorAnchorDragPointerIdRef.current = null;
    setIsFloorAnchorDragActive(false);
  };

  const handleCopySceneJson = async () => {
    const exportedAtIso = new Date().toISOString();
    const payload = buildCurrentSceneStatePayload(exportedAtIso);
    const jsonText = JSON.stringify(payload, null, 2);
    setSceneStateExportedAt(exportedAtIso);
    try {
      await navigator.clipboard.writeText(jsonText);
      setSceneJsonStatus({
        kind: "success",
        message: "Scene JSON copied to clipboard.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Clipboard write failed.";
      setSceneJsonStatus({
        kind: "error",
        message: `Copy failed: ${message}`,
      });
    }
  };

  const handleDownloadSceneJson = () => {
    const exportedAtIso = new Date().toISOString();
    const payload = buildCurrentSceneStatePayload(exportedAtIso);
    const jsonText = JSON.stringify(payload, null, 2);
    setSceneStateExportedAt(exportedAtIso);
    try {
      const blob = new Blob([jsonText], { type: "application/json" });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = "vibode-3d-room-lab-scene-state.json";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      setSceneJsonStatus({
        kind: "success",
        message: "Scene JSON download started.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Download failed.";
      setSceneJsonStatus({
        kind: "error",
        message: `Download failed: ${message}`,
      });
    }
  };

  const applyValidatedSceneState = (validated: ImportedSceneValidated, nextExportedAt: string) => {
    // Phase 2J-B3: any prior calibrated-camera mode/snapshot must not survive an
    // import. We always drop back to legacy first so a stale pre-import snapshot
    // can never leak into the restored scene; calibrated mode is only ever
    // re-established below through a fresh, compatible solve.
    deactivateCalibratedCameraMode({ clearAutoRevertReason: true });

    if (validated.modelPath !== null) {
      setModelPathInput(validated.modelPath);
      setModelPath(validated.modelPath);
    }
    setModelNormalization(validated.modelNormalization);
    const nextRoomImageUrl = validated.roomImageUrl ?? "";
    const nextRoomImageUrlTrimmed = nextRoomImageUrl.trim();
    setRoomImageInput(nextRoomImageUrl);
    setRoomImageUrl(nextRoomImageUrl);
    applyRoomImageRequest(nextRoomImageUrlTrimmed);

    // Phase 2J-B3: positionY resting-band normalization. Within the resting
    // epsilon we snap to exactly 0; values above the band stay lifted; values
    // below -epsilon are preserved as generic transform but will block
    // calibrated restore in the deferred effect below.
    const importedPositionY = validated.transform.positionY;
    const normalizedPositionY =
      Math.abs(importedPositionY) <= CALIBRATED_LIFT_RESTING_SNAP_EPSILON ? 0 : importedPositionY;

    updateTransformState(
      {
        positionX: validated.transform.positionX,
        positionY: normalizedPositionY,
        positionZ: validated.transform.positionZ,
        rotationYDeg: validated.transform.rotationYDeg,
        uniformScale: validated.transform.uniformScale,
      },
      { markOwned: true }
    );
    setAutoRotateEnabled(validated.transform.autoRotate);

    setFloorPolygon(validated.floor.polygon);
    setShowFloorOverlay(validated.floor.overlayVisible);
    setIsFloorClickPlacementEnabled(validated.floor.placementModeEnabled);
    setLastAcceptedFloorClick(validated.floor.lastAcceptedClick);
    setLastRejectedFloorClick(validated.floor.lastRejectedClick);
    setFloorMapping(validated.floor.mapping);
    setPerspectiveDepthScaling(validated.floor.perspectiveDepthScaling);
    setWasLastAnchorDragMoveRejected(false);
    setWasLastObjectHandleMoveRejected(false);
    setLastObjectHandleRotateDeltaDeg(null);
    setLastObjectHandleScaleMultiplier(null);
    setLastObjectHandleHeightDeltaYUnits(null);
    setIsFloorAnchorDragActive(false);
    setActiveFloorHandleIndex(null);
    dragPointerIdRef.current = null;
    objectHandleDragPointerIdRef.current = null;
    setActiveObjectHandleMode(null);
    floorAnchorDragPointerIdRef.current = null;

    // Phase 2J-B3: treat the optional calibration block as a deferred re-solve
    // request. Bumping the monotonic generation invalidates any older pending
    // request (e.g. a previous import whose image had not finished loading).
    const nextRestoreRequestId = calibrationRestoreRequestIdRef.current + 1;
    calibrationRestoreRequestIdRef.current = nextRestoreRequestId;
    if (validated.calibration.kind === "valid") {
      // Restore the persisted FOV assumption so the existing camera-pose
      // derivation re-solves against the imported floor + current frame.
      setCameraPoseFovYDeg(
        clampValue(
          validated.calibration.value.intrinsics.verticalFovDeg,
          CALIBRATED_SCENE_STATE_MIN_VERTICAL_FOV_DEG,
          CALIBRATED_SCENE_STATE_MAX_VERTICAL_FOV_DEG
        )
      );
      setPendingCalibrationRestore({
        requestId: nextRestoreRequestId,
        calibration: validated.calibration.value,
      });
      setCalibratedRestoreStatus(
        isRoomImageReadyForUrl(nextRoomImageUrlTrimmed)
          ? "Calibration pending: image ready; waiting for compatible frame/solve."
          : "Calibration pending: waiting for image and frame to become usable."
      );
    } else {
      setPendingCalibrationRestore(null);
      if (validated.calibration.kind === "ignored") {
        setCalibratedRestoreStatus(`Calibration ignored: ${validated.calibration.reason}`);
      } else {
        setCalibratedRestoreStatus("Imported scene has no calibrated camera provenance.");
      }
    }

    setSceneStateExportedAt(nextExportedAt);
  };

  const handleApplyImportedSceneJson = () => {
    if (!importSceneJsonInput.trim()) {
      setImportSceneStatus({
        kind: "error",
        message: "Paste scene JSON before applying.",
      });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(importSceneJsonInput);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid JSON syntax.";
      setImportSceneStatus({
        kind: "error",
        message: `Invalid JSON: ${message}`,
      });
      return;
    }

    const validated = validateImportedSceneJson(parsed, {
      transformLimits: TRANSFORM_LIMITS,
      modelNormalizationLimits: MODEL_NORMALIZATION_LIMITS,
      floorMappingLimits: FLOOR_MAPPING_LIMITS,
      perspectiveDepthScalingLimits: PERSPECTIVE_DEPTH_SCALING_LIMITS,
      defaultModelNormalization: DEFAULT_MODEL_NORMALIZATION,
      defaultFloorMapping: DEFAULT_FLOOR_MAPPING,
      defaultPerspectiveDepthScaling: DEFAULT_PERSPECTIVE_DEPTH_SCALING,
    });
    if (typeof validated === "string") {
      setImportSceneStatus({
        kind: "error",
        message: validated,
      });
      return;
    }

    applyValidatedSceneState(validated, validated.exportedAt ?? "imported-scene");
    setImportSceneStatus({
      kind: "success",
      message: "Imported scene JSON applied successfully.",
    });
  };

  const handleClearImportedSceneJson = () => {
    setImportSceneJsonInput("");
    setImportSceneStatus({
      kind: "idle",
      message: "Paste exported scene JSON to restore state.",
    });
  };

  const handleSaveLocalDraft = () => {
    const exportedAtIso = new Date().toISOString();
    const payload = buildCurrentSceneStatePayload(exportedAtIso);
    const jsonText = JSON.stringify(payload);
    try {
      window.localStorage.setItem(LOCAL_DRAFT_STORAGE_KEY, jsonText);
      setLocalDraftLastSavedAt(exportedAtIso);
      setLocalDraftStatus({
        kind: "success",
        message: "Local draft saved successfully.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "localStorage write failed.";
      setLocalDraftStatus({
        kind: "error",
        message: `Save failed: ${message}`,
      });
    }
  };

  const handleRestoreLocalDraft = () => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(LOCAL_DRAFT_STORAGE_KEY);
    } catch (error) {
      const message = error instanceof Error ? error.message : "localStorage read failed.";
      setLocalDraftStatus({
        kind: "error",
        message: `Restore failed: ${message}`,
      });
      return;
    }

    if (!stored) {
      setLocalDraftStatus({
        kind: "error",
        message: "No local draft found.",
      });
      setLocalDraftLastSavedAt(null);
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stored);
    } catch {
      setLocalDraftStatus({
        kind: "error",
        message: "Invalid/corrupt local draft.",
      });
      return;
    }

    const validated = validateImportedSceneJson(parsed, {
      transformLimits: TRANSFORM_LIMITS,
      modelNormalizationLimits: MODEL_NORMALIZATION_LIMITS,
      floorMappingLimits: FLOOR_MAPPING_LIMITS,
      perspectiveDepthScalingLimits: PERSPECTIVE_DEPTH_SCALING_LIMITS,
      defaultModelNormalization: DEFAULT_MODEL_NORMALIZATION,
      defaultFloorMapping: DEFAULT_FLOOR_MAPPING,
      defaultPerspectiveDepthScaling: DEFAULT_PERSPECTIVE_DEPTH_SCALING,
    });
    if (typeof validated === "string") {
      setLocalDraftStatus({
        kind: "error",
        message: "Invalid/corrupt local draft.",
      });
      return;
    }

    const restoredAt = validated.exportedAt ?? "restored-local-draft";
    applyValidatedSceneState(validated, restoredAt);
    setLocalDraftLastSavedAt(validated.exportedAt ?? null);
    setLocalDraftStatus({
      kind: "success",
      message: "Local draft restored successfully.",
    });
  };

  const handleClearLocalDraft = () => {
    try {
      window.localStorage.removeItem(LOCAL_DRAFT_STORAGE_KEY);
      setLocalDraftLastSavedAt(null);
      setLocalDraftStatus({
        kind: "success",
        message: "Local draft cleared successfully.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "localStorage remove failed.";
      setLocalDraftStatus({
        kind: "error",
        message: `Clear failed: ${message}`,
      });
    }
  };

  const handleLoadModelFromInput = () => {
    const nextPath = modelPathInput.trim();
    setModelPath(nextPath);
    const loadModel = loadModelFromPathRef.current;
    if (!loadModel) {
      setModelLoadState("error");
      setModelLoadError("Renderer is not ready yet.");
      return;
    }
    loadModel(nextPath);
  };

  const handleUseFallbackCube = () => {
    const useFallbackCube = useFallbackCubeRef.current;
    if (!useFallbackCube) {
      setModelLoadState("error");
      setModelLoadError("Renderer is not ready yet.");
      return;
    }
    useFallbackCube();
  };

  useEffect(() => {
    if (!envEnabled) return;
    const container = containerRef.current;
    const canvasHost = canvasHostRef.current;
    if (!container || !canvasHost) return;

    let isDisposed = false;
    setModelLoadState("loading");
    setModelLoadError(null);
    setActiveObjectKind(null);
    autoRotateOffsetDegRef.current = 0;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(LEGACY_CAMERA_FOV_DEG, 1, 0.1, 100);
    camera.position.set(...LEGACY_CAMERA_POSITION);
    cameraRef.current = camera;

    const applyActiveCameraState = () => {
      const activeSnapshot =
        calibratedCameraActiveRef.current && calibratedCameraSnapshotRef.current
          ? calibratedCameraSnapshotRef.current
          : null;
      if (!activeSnapshot) {
        camera.fov = LEGACY_CAMERA_FOV_DEG;
        camera.position.set(...LEGACY_CAMERA_POSITION);
        camera.up.set(0, 1, 0);
        camera.rotation.set(0, 0, 0);
        return;
      }
      camera.fov = activeSnapshot.fovDeg;
      camera.position.set(
        activeSnapshot.pose.position.x,
        activeSnapshot.pose.position.y,
        activeSnapshot.pose.position.z
      );
      camera.up.set(activeSnapshot.pose.up.x, activeSnapshot.pose.up.y, activeSnapshot.pose.up.z);
      camera.lookAt(activeSnapshot.pose.lookAt.x, activeSnapshot.pose.lookAt.y, activeSnapshot.pose.lookAt.z);
    };

    const ambient = new THREE.AmbientLight(0xffffff, 0.8);
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
    keyLight.position.set(3, 6, 5);
    scene.add(ambient);
    scene.add(keyLight);
    const placementGroup = new THREE.Group();
    const modelNormalizationGroup = new THREE.Group();
    const autoBoundsGroup = new THREE.Group();
    modelNormalizationGroup.add(autoBoundsGroup);
    placementGroup.add(modelNormalizationGroup);
    scene.add(placementGroup);
    placementGroupRef.current = placementGroup;
    modelNormalizationGroupRef.current = modelNormalizationGroup;
    autoBoundsGroupRef.current = autoBoundsGroup;
    applyPlacementTransform();
    applyModelNormalization();
    applyAutoBoundsNormalization();

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.position = "absolute";
    renderer.domElement.style.inset = "0";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    canvasHost.appendChild(renderer.domElement);

    const syncRendererSize = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      renderer.setSize(width, height, false);
      applyActiveCameraState();
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      setRendererSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };

    syncRendererSize();
    window.addEventListener("resize", syncRendererSize);
    const resizeObserver = new ResizeObserver(syncRendererSize);
    resizeObserver.observe(container);
    resizeObserverRef.current = resizeObserver;

    const removeActiveObject = () => {
      const current = activeObjectRef.current;
      if (!current) return;
      autoBoundsGroup.remove(current);
      disposeObject3D(current);
      activeObjectRef.current = null;
    };

    const setActiveObject = (object: THREE.Object3D, kind: ActiveObjectKind) => {
      removeActiveObject();
      // Measure the raw object before parenting under transformed groups so
      // ancestor scale/position never contaminate the bounds, and recompute
      // from scratch on every load/swap to avoid compounding normalization.
      const normalization = computeAutoBoundsNormalization(object);
      lastAutoBoundsRef.current = normalization;
      setAutoBoundsInfo(normalization);
      autoBoundsGroup.add(object);
      activeObjectRef.current = object;
      setActiveObjectKind(kind);
      applyAutoBoundsNormalization();
      applyPlacementTransform();
      applyModelNormalization();
    };

    const addFallbackCube = (reason: string) => {
      setModelLoadState("fallback");
      setModelLoadError(reason);
      const geometry = new THREE.BoxGeometry(0.8, 0.8, 0.8);
      const material = new THREE.MeshStandardMaterial({
        color: "#34d399",
        metalness: 0.1,
        roughness: 0.6,
      });
      const cube = new THREE.Mesh(geometry, material);
      setActiveObject(cube, "fallback");
      applyPlacementTransform();
      applyModelNormalization();
    };

    const loader = new GLTFLoader();
    let activeLoadToken = 0;
    const loadModelFromPath = (path: string) => {
      const trimmedPath = path.trim();
      if (!trimmedPath) {
        addFallbackCube("Model path is empty.");
        return;
      }

      setModelLoadState("loading");
      setModelLoadError(null);
      const loadToken = ++activeLoadToken;
      loader.load(
        trimmedPath,
        (gltf) => {
          if (isDisposed || loadToken !== activeLoadToken) {
            disposeObject3D(gltf.scene);
            return;
          }
          setActiveObject(gltf.scene, "gltf");
          setModelLoadState("loaded");
          setModelLoadError(null);
          applyPlacementTransform();
          applyModelNormalization();
        },
        undefined,
        (error) => {
          if (isDisposed || loadToken !== activeLoadToken) return;
          const message = error instanceof Error ? error.message : "Unable to load GLB asset.";
          addFallbackCube(message);
        }
      );
    };

    loadModelFromPathRef.current = loadModelFromPath;
    useFallbackCubeRef.current = () => {
      addFallbackCube("Manual fallback cube.");
    };
    loadModelFromPath(modelPath);

    const animate = () => {
      if (isDisposed) return;
      animationFrameRef.current = window.requestAnimationFrame(animate);
      if (autoRotateEnabledRef.current) {
        autoRotateOffsetDegRef.current = (autoRotateOffsetDegRef.current + 0.3) % 360;
      }
      applyActiveCameraState();
      camera.updateProjectionMatrix();
      applyPlacementTransform();
      renderer.render(scene, camera);
    };

    animate();

    return () => {
      isDisposed = true;
      window.removeEventListener("resize", syncRendererSize);
      resizeObserver.disconnect();
      resizeObserverRef.current = null;
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
      loadModelFromPathRef.current = null;
      useFallbackCubeRef.current = null;
      cameraRef.current = null;
      if (activeObjectRef.current) {
        autoBoundsGroup.remove(activeObjectRef.current);
        disposeObject3D(activeObjectRef.current);
        activeObjectRef.current = null;
      }
      placementGroupRef.current = null;
      modelNormalizationGroupRef.current = null;
      autoBoundsGroupRef.current = null;
      scene.remove(placementGroup);
      scene.remove(ambient);
      scene.remove(keyLight);
      renderer.dispose();
      renderer.forceContextLoss();
      const canvas = renderer.domElement;
      if (canvas.parentElement === canvasHost) {
        canvasHost.removeChild(canvas);
      }
    };
  }, [envEnabled]);

  const handleImageSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextUrl = roomImageInput.trim();
    setRoomImageUrl(nextUrl);
    applyRoomImageRequest(nextUrl);
    // Phase 2J-B3: a manual image change supersedes any pending calibrated
    // restore (cancellation-safe via the monotonic generation bump).
    if (pendingCalibrationRestore) {
      calibrationRestoreRequestIdRef.current += 1;
      setPendingCalibrationRestore(null);
      setCalibratedRestoreStatus("Calibration restore cancelled: room image changed before restore.");
    }
  };

  // --- Phase 2F-G1: fixture harness helpers --------------------------------
  const selectedFixture = getAutoFloorFixtureById(selectedFixtureId);
  const fixtureObservationCount = fixtureObservations.filter(
    (observation) => observation.fixtureId === selectedFixtureId
  ).length;

  // Reuse existing debug readouts rather than recomputing any geometry.
  const findDebugValue = (label: string): string | null => {
    const row = debugRows.find((entry) => entry.label === label);
    return row ? String(row.value) : null;
  };

  const resolveFixtureImageUrl = (imageUrl: string): string => {
    if (imageUrl.startsWith("/")) {
      return new URL(imageUrl, window.location.origin).toString();
    }
    if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
      return imageUrl;
    }
    return imageUrl;
  };

  // Loading a fixture only swaps the room image URL/input. It intentionally does
  // NOT run detection, mutate floorPolygon, or touch calibrated camera state.
  const handleLoadFixtureImage = () => {
    if (!selectedFixture) {
      setFixtureHarnessMessage("No fixture selected.");
      return;
    }
    const nextUrl = resolveFixtureImageUrl(selectedFixture.imageUrl);
    setRoomImageInput(nextUrl);
    setRoomImageUrl(nextUrl);
    applyRoomImageRequest(nextUrl);
    // Phase 2J-B3: swapping the fixture image supersedes any pending restore.
    if (pendingCalibrationRestore) {
      calibrationRestoreRequestIdRef.current += 1;
      setPendingCalibrationRestore(null);
      setCalibratedRestoreStatus("Calibration restore cancelled: room image changed before restore.");
    }
    setFixtureHarnessMessage(
      `Loaded fixture "${selectedFixture.label}". Detection not run; manual polygon preserved.`
    );
  };

  // Runs detection with the currently selected provider against the current room
  // image. Reuses the existing handleDetectFloor flow; no fixture auto-loading.
  const handleRunFixtureDetection = () => {
    setFixtureHarnessMessage(
      `Running detection (${selectedAutoFloorProviderId}) for "${selectedFixture?.label ?? "current image"}".`
    );
    void handleDetectFloor();
  };

  const handleRecordFixtureObservation = () => {
    if (!selectedFixture) {
      setFixtureHarnessMessage("No fixture selected; nothing recorded.");
      return;
    }
    const detectionStatus: AutoFloorFixtureObservation["detectionStatus"] =
      autoFloorDetectionRunState === "failed"
        ? "failed"
        : autoFloorDetectionResult?.status === "ok"
          ? "ok"
          : autoFloorDetectionResult?.status === "failed"
            ? "failed"
            : "needs_review";

    const observation: AutoFloorFixtureObservation = {
      fixtureId: selectedFixture.id,
      fixtureCategory: selectedFixture.category,
      providerId: selectedAutoFloorProviderId,
      model: selectedAutoFloorProviderId === "vision-model" ? DEFAULT_AUTO_FLOOR_VISION_MODEL : null,
      timestamp: new Date().toISOString(),
      detectionStatus,
      candidateCount: autoFloorDetectionResult?.candidates.length ?? 0,
      selectedCandidateId: selectedAutoFloorCandidate?.id ?? null,
      selectedScoreBand: selectedAutoFloorCandidateScore?.scoreBand ?? null,
      selectedScore: selectedAutoFloorCandidateScore?.score ?? null,
      homographyStatus: findDebugValue("homography solve"),
      cameraPoseStatus: findDebugValue("camera pose grid status"),
      fovScanStatus: findDebugValue("camera pose FOV scan"),
      rayHomographyAgreement: null,
      latestFailureReason:
        autoFloorDetectionFailureReasons.length > 0
          ? autoFloorDetectionFailureReasons.join(" | ")
          : null,
      assist: buildAssistObservationFields(),
      manualCorrectionAssessment: fixtureManualCorrection,
      humanAssessment: fixtureHumanAssessment,
      notes: fixtureObservationNotes.trim(),
    };

    setFixtureObservations((previous) => [...previous, observation]);
    setFixtureObservationNotes("");
    setFixtureHarnessMessage(
      `Recorded observation for "${selectedFixture.label}" (local only, not persisted).`
    );
  };

  const handleCopyFixtureObservations = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(fixtureObservations, null, 2));
      setFixtureHarnessMessage(`Copied ${fixtureObservations.length} observation(s) to clipboard.`);
    } catch {
      setFixtureHarnessMessage("Copy failed (clipboard unavailable in this context).");
    }
  };

  const handleClearFixtureObservations = () => {
    setFixtureObservations([]);
    setFixtureHarnessMessage("Cleared all fixture observations.");
  };

  // --- Phase 2H-B: empty-room assist orchestration -------------------------
  function buildEmptyRoomAssistMessage(
    assist: EmptyRoomAssistApiResponse["assist"],
    generateOnly: boolean
  ): string {
    if (assist.emptyRoomAssistStatus === "unavailable") {
      return `Unavailable: ${assist.failureReason ?? "empty-room assist is not available."}`;
    }
    if (assist.emptyRoomAssistStatus === "generated") {
      return `Empty-room ready (cache ${assist.emptyRoomCacheStatus}). Now click “Run assisted detection”.`;
    }
    if (generateOnly) return "Empty-room generation completed.";
    const structural = assist.structuralPreservation?.band ?? "unavailable";
    const transfer =
      assist.coordinateCompatibility.transferMode === "aspect_rescaled"
        ? "aspect-rescaled transfer"
        : "exact-grid transfer";
    switch (assist.recommendationProvenance) {
      case "empty_primary_verified":
        return `Completed — empty-room quad surfaced as primary (verified; ${transfer}; structural ${structural}).`;
      case "empty_primary_review": {
        const cameraNote = assist.calibratedCameraEligible
          ? ""
          : " — floor proposal valid, but calibrated camera unavailable (camera pose needs manual adjustment)";
        return `Completed — empty-room quad surfaced for review (${transfer}; structural ${structural})${cameraNote}.`;
      }
      case "empty_primary_blocked":
        return `Blocked — empty quad failed a hard gate (${assist.coordinateCompatibility.reason ?? assist.failureReason ?? "self-validity/compatibility"}). Showing original as review-only fallback.`;
      case "original_fallback": {
        const why =
          assist.emptyDetectionStatus === "failed" && assist.emptyDetectionFailureReason
            ? ` (empty detection failed: ${assist.emptyDetectionFailureReason})`
            : "";
        return `Completed — empty-room unusable; original quad surfaced as review-only fallback.${why}`;
      }
      case "manual_required":
      default:
        return `Manual setup required — ${assist.failureReason ?? "no usable floor candidate was produced."}`;
    }
  }

  function buildAssistObservationFields(): AutoFloorAssistObservationFields | null {
    if (!emptyRoomAssistResult) return null;
    const a = emptyRoomAssistResult.assist;
    const compat: "ok" | "incompatible" | "not_evaluated" = a.coordinateCompatibility.ok
      ? "ok"
      : a.coordinateCompatibility.emptySize
        ? "incompatible"
        : "not_evaluated";
    return {
      emptyRoomAssistStatus: a.emptyRoomAssistStatus,
      emptyRoomCacheStatus: a.emptyRoomCacheStatus,
      originalDetectionStatus: a.originalDetectionStatus,
      emptyDetectionStatus: a.emptyDetectionStatus,
      coordinateCompatibilityStatus: compat,
      compatibilityTier: a.coordinateCompatibility.tier,
      relativeAspectError: a.coordinateCompatibility.relativeAspectError,
      quadAgreementBand: a.agreement?.band ?? null,
      agreementIou: a.agreement?.iou ?? null,
      agreementMeanCornerDistance: a.agreement?.meanCornerDistance ?? null,
      agreementAreaAgreement: a.agreement?.areaAgreement ?? null,
      recommendationProvenance: a.recommendationProvenance,
      surfacedSource: a.surfacedSource,
      confidenceCeiling: a.confidenceCeiling,
      emptyQuadSelfValidityBand: a.emptyQuadSelfValidity?.band ?? null,
      emptyCameraPoseOk: a.emptyQuadSelfValidity?.cameraPoseOk ?? null,
      emptyCameraPoseConfidence: a.emptyQuadSelfValidity?.cameraPoseConfidence ?? null,
      emptyCameraPoseBestFovDeg: a.emptyQuadSelfValidity?.cameraPoseBestFovDeg ?? null,
      emptyCameraPoseValidFovCount: a.emptyQuadSelfValidity?.cameraPoseValidFovCount ?? null,
      structuralPreservationBand: a.structuralPreservation?.band ?? null,
      structuralPreservationScore: a.structuralPreservation?.score ?? null,
      // Phase 2H-J: read-only extent diagnostics carried from the assist response.
      emptyCandidateCount: a.extentDiagnostics?.emptyCandidateCount ?? null,
      originalCandidateCount: a.extentDiagnostics?.originalCandidateCount ?? null,
      selectedCandidateRank: a.extentDiagnostics?.selectedCandidateRank ?? null,
      selectedCandidateIntent: a.extentDiagnostics?.selectedCandidateIntent ?? null,
      selectedCandidateArea: a.extentDiagnostics?.selectedCandidateArea ?? null,
      largestValidCandidateArea: a.extentDiagnostics?.largestValidCandidateArea ?? null,
      selectedVsLargestAreaRatio: a.extentDiagnostics?.selectedVsLargestAreaRatio ?? null,
      openingAmbiguityFlag: a.extentDiagnostics?.openingAmbiguityFlag ?? null,
      retryOccurred: a.extentDiagnostics?.retryOccurred ?? null,
      retryReason: a.extentDiagnostics?.retryReason ?? null,
      // Phase 2H-JF: read-only multi-candidate same-plane consensus diagnostics.
      multiCandidatePoseValidCount: a.multiCandidateConsensus?.poseValidCandidateCount ?? null,
      samePlaneConsensusStatus: a.multiCandidateConsensus?.samePlaneConsensusStatus ?? null,
      sharedFovRange: a.multiCandidateConsensus?.sharedFovRange ?? null,
      bestFovSpreadDeg: a.multiCandidateConsensus?.bestFovSpreadDeg ?? null,
      consensusCandidateIndexes: a.multiCandidateConsensus?.consensusCandidateIndexes ?? null,
      consensusHasClampedCandidate: a.multiCandidateConsensus?.hasClampedCandidateInConsensus ?? null,
      advisoryPreferredAnchorIndex: a.multiCandidateConsensus?.advisoryPreferredAnchorIndex ?? null,
      advisoryPreferredAnchorReason: a.multiCandidateConsensus?.advisoryPreferredAnchorReason ?? null,
      // Human floor-extent assessment is manual-only; never auto-recorded here.
      stoppedEarlyAtDoorway: null,
      stoppedEarlyAtCloset: null,
      overExtendedAdjacentRoom: null,
      correctMainRoomExtent: null,
      // Human same-plane assessment is manual-only; never auto-recorded here.
      baysAppearCoplanar: null,
      advisoryAnchorLooksCorrect: null,
    };
  }

  const runEmptyRoomAssist = async (generateOnly: boolean) => {
    if (!emptyRoomAssistEnabled) {
      setEmptyRoomAssistMessage("Empty-room assist is disabled on the server.");
      setEmptyRoomAssistUiStatus("unavailable");
      return;
    }
    if (emptyRoomAssistInFlightRef.current) return;
    const imageUrl = (roomImageUrl ?? "").trim();
    if (!imageUrl) {
      setEmptyRoomAssistMessage("Load a room image first.");
      return;
    }
    if (!imageIntrinsicSize || rendererSize.width <= 0 || rendererSize.height <= 0) {
      setEmptyRoomAssistMessage("Image is not fully loaded yet — wait for it to render, then retry.");
      return;
    }

    emptyRoomAssistInFlightRef.current = true;
    setEmptyRoomAssistUiStatus(generateOnly ? "generating" : "detecting_original");
    setEmptyRoomAssistMessage(
      generateOnly ? "Generating empty-room assist…" : "Running assisted detection…"
    );

    try {
      const res = await fetch("/api/admin/3d-room-lab/empty-room-assist/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl,
          intrinsicSize: { width: imageIntrinsicSize.width, height: imageIntrinsicSize.height },
          frameSize: { width: rendererSize.width, height: rendererSize.height },
          floorRect: { widthMeters: floorMapping.worldWidth, depthMeters: floorMapping.worldDepth },
          generateOnly,
        }),
      });
      const data = (await res.json()) as EmptyRoomAssistApiResponse | { error?: string };
      if (!("assist" in data) || !data.assist) {
        setEmptyRoomAssistUiStatus("failed");
        setEmptyRoomAssistMessage("Assist request was rejected by the server.");
        return;
      }

      const typed = data as EmptyRoomAssistApiResponse;
      setEmptyRoomAssistResult(typed);
      const assist = typed.assist;
      const ui: EmptyRoomAssistUiStatus =
        assist.emptyRoomAssistStatus === "unavailable"
          ? "unavailable"
          : assist.emptyRoomAssistStatus === "blocked"
            ? "blocked"
            : assist.emptyRoomAssistStatus === "failed"
              ? "failed"
              : "completed";
      setEmptyRoomAssistUiStatus(ui);

      // Surface the policy-chosen candidate (empty-primary when promoted) into
      // the existing preview/Apply flow. Never on generate-only, never
      // auto-applied (Apply remains a separate explicit action), never mutates
      // floorPolygon here.
      if (!generateOnly && typed.surfacedResult && typed.surfacedResult.candidates.length > 0) {
        setAutoFloorDetectionResult(typed.surfacedResult);
        setSelectedAutoFloorCandidateId(typed.surfacedResult.selectedCandidateId);
        setAutoFloorDetectionFailureReasons([]);
        setAutoFloorDetectionRunState("completed");
      }

      setEmptyRoomAssistMessage(buildEmptyRoomAssistMessage(assist, generateOnly));
    } catch {
      setEmptyRoomAssistUiStatus("failed");
      setEmptyRoomAssistMessage("Assist request failed (network or server error).");
    } finally {
      emptyRoomAssistInFlightRef.current = false;
    }
  };

  const handleGenerateEmptyRoomAssist = () => {
    void runEmptyRoomAssist(true);
  };
  const handleRunAssistedDetection = () => {
    void runEmptyRoomAssist(false);
  };

  if (!envEnabled) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-50 px-4 py-10">
        <div className="mx-auto w-full max-w-5xl rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
          <h1 className="text-xl font-semibold tracking-tight">3D Room Lab</h1>
          <p className="mt-2 text-sm text-slate-300">3D Room Lab is not enabled.</p>
          <p className="mt-1 text-xs text-slate-500">
            Set <code>NEXT_PUBLIC_VIBODE_ENABLE_3D_ROOM_LAB=1</code> and restart the dev server.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">3D Room Lab — Research Prototype</h1>
          <p className="text-sm text-slate-400">
            Static proof: room image base layer with transparent Three.js overlay and one local GLB test asset.
          </p>
        </header>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <form className="flex flex-col gap-2 md:flex-row md:items-end" onSubmit={handleImageSubmit}>
            <label className="flex-1">
              <span className="text-xs text-slate-400">Room image URL</span>
              <input
                type="url"
                value={roomImageInput}
                onChange={(event) => setRoomImageInput(event.target.value)}
                placeholder="https://example.com/room.jpg"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-400"
              />
            </label>
            <button
              type="submit"
              className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-400"
            >
              Load Image
            </button>
          </form>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-slate-100">Model source</h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleLoadModelFromInput}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200"
              >
                Load model
              </button>
              <button
                type="button"
                onClick={handleUseFallbackCube}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-slate-500 hover:text-slate-100"
              >
                Use fallback cube
              </button>
            </div>
          </div>
          <label className="mt-3 block">
            <span className="text-xs text-slate-400">Local/public GLB path</span>
            <input
              type="text"
              value={modelPathInput}
              onChange={(event) => setModelPathInput(event.target.value)}
              placeholder="/3d-lab/furniture-test-chair.glb"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-400"
            />
          </label>
          <p className="mt-2 text-xs text-slate-400">Active object type: {currentActiveObjectType}</p>
          <p className="mt-1 text-xs text-slate-400">Current model path: {modelPath || "(empty)"}</p>
          <p className="mt-1 text-xs text-slate-400">Model status: {formatModelStatus(modelLoadState, modelLoadError)}</p>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <div
            ref={containerRef}
            className="relative w-full overflow-hidden rounded-xl border border-slate-800 bg-slate-950"
            style={{ aspectRatio: "16 / 10" }}
          >
            {roomImageUrl ? (
              <img
                src={roomImageUrl}
                alt="Room base"
                className="absolute inset-0 z-0 h-full w-full object-cover"
                onLoad={(event) => {
                  const loadedUrl = roomImageUrl.trim();
                  const width = event.currentTarget.naturalWidth;
                  const height = event.currentTarget.naturalHeight;
                  if (width > 0 && height > 0) {
                    setImageIntrinsicSize({ width, height });
                    setLoadedImageUrl(loadedUrl || null);
                    setImageLoadState("loaded");
                    return;
                  }
                  setImageIntrinsicSize(null);
                  setLoadedImageUrl(null);
                  setImageLoadState("error");
                }}
                onError={() => {
                  setImageIntrinsicSize(null);
                  setLoadedImageUrl(null);
                  setImageLoadState("error");
                }}
              />
            ) : (
              <div className="absolute inset-0 z-0 flex items-center justify-center text-xs text-slate-500">
                Paste a room image URL and click Load Image.
              </div>
            )}
            <div ref={canvasHostRef} className="pointer-events-none absolute inset-0 z-10" />
            {showFloorOverlay && (
              <svg
                ref={floorOverlayRef}
                className="absolute inset-0 z-20 h-full w-full"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                onPointerDown={handleFloorOverlayPointerDown}
                onPointerMove={handleFloorOverlayPointerMove}
                onPointerUp={stopFloorHandleDrag}
                onPointerCancel={stopFloorHandleDrag}
                onPointerLeave={stopFloorHandleDrag}
                style={{ touchAction: "none" }}
              >
                <polygon
                  points={floorPolygonPointsAttribute}
                  fill="#ffffff"
                  fillOpacity={0.08}
                  stroke="#facc15"
                  strokeOpacity={1}
                  strokeWidth={1.2}
                  pointerEvents="none"
                />
                {autoFloorSuggestionPointsAttribute && selectedAutoFloorCandidate && (
                  <g pointerEvents="none" aria-hidden="true">
                    <polygon
                      points={autoFloorSuggestionPointsAttribute}
                      fill={autoFloorSuggestionStyle.fill}
                      fillOpacity={autoFloorSuggestionStyle.fillOpacity}
                      stroke={autoFloorSuggestionStyle.stroke}
                      strokeOpacity={autoFloorSuggestionStyle.strokeOpacity}
                      strokeWidth={autoFloorSuggestionStyle.strokeWidth}
                      strokeDasharray={autoFloorSuggestionStyle.strokeDasharray}
                    />
                    <text
                      x={selectedAutoFloorCandidate.quadNorm[3].x * 100 + 0.8}
                      y={selectedAutoFloorCandidate.quadNorm[3].y * 100 - 1}
                      fill={autoFloorSuggestionStyle.textFill}
                      fontSize="2.2"
                      fontWeight="600"
                    >
                      {autoFloorSuggestionStyle.label}
                    </text>
                  </g>
                )}
                {showHomographyDebugOverlay && (
                  <g pointerEvents="none" aria-hidden="true">
                    {homographyDebug.gridPolylinesNorm.map((line, index) => (
                      <polyline
                        key={`homography-grid-${index}`}
                        points={line.map((point) => `${point.x * 100},${point.y * 100}`).join(" ")}
                        fill="none"
                        stroke="#22c55e"
                        strokeOpacity={0.55}
                        strokeWidth={0.35}
                      />
                    ))}
                    {cameraPoseGridPolylinesNorm.map((line, index) => (
                      <polyline
                        key={`camera-pose-grid-${index}`}
                        points={line.map((point) => `${point.x * 100},${point.y * 100}`).join(" ")}
                        fill="none"
                        stroke="#22d3ee"
                        strokeOpacity={0.5}
                        strokeWidth={0.35}
                        strokeDasharray="1.2 0.8"
                      />
                    ))}
                    {homographyDebug.orderedCornersNorm?.map((point, index) => {
                      const label = index === 0 ? "NL" : index === 1 ? "NR" : index === 2 ? "FR" : "FL";
                      return (
                        <g key={`homography-corner-${label}`}>
                          <circle
                            cx={point.x * 100}
                            cy={point.y * 100}
                            r={1.05}
                            fill="#10b981"
                            fillOpacity={0.9}
                            stroke="#052e16"
                            strokeWidth={0.45}
                          />
                          <text
                            x={point.x * 100 + 1.1}
                            y={point.y * 100 - 0.9}
                            fill="#bbf7d0"
                            fontSize="2"
                            fontWeight="600"
                          >
                            {label}
                          </text>
                        </g>
                      );
                    })}
                    {objectProjectionDiagnostic.projectedNorm && (
                      <g>
                        {objectProjectionDiagnostic.anchorNorm && (
                          <line
                            x1={objectProjectionDiagnostic.anchorNorm.x * 100}
                            y1={objectProjectionDiagnostic.anchorNorm.y * 100}
                            x2={objectProjectionDiagnostic.projectedNorm.x * 100}
                            y2={objectProjectionDiagnostic.projectedNorm.y * 100}
                            stroke="#e879f9"
                            strokeOpacity={0.65}
                            strokeWidth={0.35}
                            strokeDasharray="0.9 0.7"
                          />
                        )}
                        <circle
                          cx={objectProjectionDiagnostic.projectedNorm.x * 100}
                          cy={objectProjectionDiagnostic.projectedNorm.y * 100}
                          r={1.05}
                          fill="#e879f9"
                          fillOpacity={0.85}
                          stroke="#831843"
                          strokeWidth={0.45}
                        />
                        <text
                          x={objectProjectionDiagnostic.projectedNorm.x * 100 + 1.1}
                          y={objectProjectionDiagnostic.projectedNorm.y * 100 + 2.1}
                          fill="#f5d0fe"
                          fontSize="1.9"
                          fontWeight="600"
                        >
                          projected object
                        </text>
                        {objectProjectionDiagnostic.anchorNorm && (
                          <text
                            x={objectProjectionDiagnostic.anchorNorm.x * 100 + 1.1}
                            y={objectProjectionDiagnostic.anchorNorm.y * 100 + 2.1}
                            fill="#fecdd3"
                            fontSize="1.9"
                            fontWeight="600"
                          >
                            stored anchor
                          </text>
                        )}
                      </g>
                    )}
                  </g>
                )}
                {floorPolygon.map((point, index) => (
                  <circle
                    key={`floor-handle-${index}`}
                    cx={point.x * 100}
                    cy={point.y * 100}
                    r={2.1}
                    fill={activeFloorHandleIndex === index ? "#f97316" : "#22d3ee"}
                    stroke="#020617"
                    strokeOpacity={1}
                    strokeWidth={0.75}
                    className="cursor-grab active:cursor-grabbing"
                    pointerEvents="all"
                    aria-label={`Floor polygon handle ${index + 1}`}
                    onPointerDown={(event) => handleFloorHandlePointerDown(index, event)}
                  />
                ))}
                {lastAcceptedFloorClick && (
                  <circle
                    cx={lastAcceptedFloorClick.x * 100}
                    cy={lastAcceptedFloorClick.y * 100}
                    r={isFloorAnchorDragActive ? 1.7 : 1.45}
                    fill={isFloorAnchorDragActive ? "#fb7185" : "#f43f5e"}
                    stroke="#ffffff"
                    strokeWidth={0.6}
                    className={isFloorAnchorDragEffectivelyEnabled ? "cursor-move" : undefined}
                    pointerEvents={isFloorAnchorDragEffectivelyEnabled ? "all" : "none"}
                    aria-label="Object floor anchor marker"
                    onPointerDown={handleFloorAnchorPointerDown}
                  />
                )}
                {calibratedMoveHandleStatus.available && calibratedMoveHandleAnchorProjection.normalized && (
                  <g>
                    <circle
                      cx={calibratedMoveHandleAnchorProjection.normalized.x * 100}
                      cy={calibratedMoveHandleAnchorProjection.normalized.y * 100}
                      r={2.1}
                      fill="#0f172a"
                      fillOpacity={0.5}
                      stroke="#bae6fd"
                      strokeOpacity={0.8}
                      strokeWidth={0.4}
                      pointerEvents="none"
                    />
                    <line
                      x1={calibratedMoveHandleAnchorProjection.normalized.x * 100}
                      y1={calibratedMoveHandleAnchorProjection.normalized.y * 100}
                      x2={calibratedMoveHandleAnchorProjection.normalized.x * 100 + 4.2}
                      y2={calibratedMoveHandleAnchorProjection.normalized.y * 100 - 4.2}
                      stroke="#38bdf8"
                      strokeWidth={0.8}
                      strokeOpacity={0.95}
                      pointerEvents="none"
                    />
                    <circle
                      cx={calibratedMoveHandleAnchorProjection.normalized.x * 100 + 4.2}
                      cy={calibratedMoveHandleAnchorProjection.normalized.y * 100 - 4.2}
                      r={1.85}
                      fill="#38bdf8"
                      stroke="#ffffff"
                      strokeWidth={0.6}
                      className="cursor-move"
                      pointerEvents="all"
                      aria-label="Calibrated move handle"
                      onPointerDown={handleCalibratedMoveHandlePointerDown}
                    >
                      <title>Move (calibrated ray-floor)</title>
                    </circle>
                    <rect
                      x={calibratedMoveHandleAnchorProjection.normalized.x * 100 + 5.3}
                      y={calibratedMoveHandleAnchorProjection.normalized.y * 100 - 6.9}
                      width={9.8}
                      height={2.2}
                      rx={0.55}
                      fill="#0c4a6e"
                      fillOpacity={0.88}
                      pointerEvents="none"
                    />
                    <text
                      x={calibratedMoveHandleAnchorProjection.normalized.x * 100 + 5.8}
                      y={calibratedMoveHandleAnchorProjection.normalized.y * 100 - 5.3}
                      fill="#e0f2fe"
                      fontSize="2.05"
                      pointerEvents="none"
                    >
                      Move (ray)
                    </text>
                  </g>
                )}
                {calibratedRotateHandleStatus.available && calibratedMoveHandleAnchorProjection.normalized && (
                  <g>
                    <line
                      x1={calibratedMoveHandleAnchorProjection.normalized.x * 100}
                      y1={calibratedMoveHandleAnchorProjection.normalized.y * 100}
                      x2={calibratedMoveHandleAnchorProjection.normalized.x * 100 - 4.2}
                      y2={calibratedMoveHandleAnchorProjection.normalized.y * 100 - 4.2}
                      stroke={calibratedRotateDragPointerIdRef.current !== null ? "#d97706" : "#f59e0b"}
                      strokeWidth={calibratedRotateDragPointerIdRef.current !== null ? 0.9 : 0.8}
                      strokeOpacity={0.95}
                      pointerEvents="none"
                    />
                    <circle
                      cx={calibratedMoveHandleAnchorProjection.normalized.x * 100 - 4.2}
                      cy={calibratedMoveHandleAnchorProjection.normalized.y * 100 - 4.2}
                      r={1.85}
                      fill="#f59e0b"
                      stroke="#ffffff"
                      strokeWidth={0.6}
                      className="cursor-crosshair"
                      pointerEvents="all"
                      aria-label="Calibrated rotate handle"
                      onPointerDown={handleCalibratedRotateHandlePointerDown}
                    >
                      <title>Rotate (calibrated floor-contact)</title>
                    </circle>
                    <rect
                      x={calibratedMoveHandleAnchorProjection.normalized.x * 100 - 16.3}
                      y={calibratedMoveHandleAnchorProjection.normalized.y * 100 - 6.9}
                      width={11.6}
                      height={2.2}
                      rx={0.55}
                      fill="#78350f"
                      fillOpacity={0.88}
                      pointerEvents="none"
                    />
                    <text
                      x={calibratedMoveHandleAnchorProjection.normalized.x * 100 - 15.8}
                      y={calibratedMoveHandleAnchorProjection.normalized.y * 100 - 5.3}
                      fill="#fef3c7"
                      fontSize="2.05"
                      pointerEvents="none"
                    >
                      Rotate (cal)
                    </text>
                  </g>
                )}
                {calibratedScaleHandleStatus.available && calibratedMoveHandleAnchorProjection.normalized && (
                  <g>
                    <line
                      x1={calibratedMoveHandleAnchorProjection.normalized.x * 100}
                      y1={calibratedMoveHandleAnchorProjection.normalized.y * 100}
                      x2={calibratedMoveHandleAnchorProjection.normalized.x * 100 + 4.3}
                      y2={calibratedMoveHandleAnchorProjection.normalized.y * 100 + 3.75}
                      stroke={calibratedScaleDragPointerIdRef.current !== null ? "#16a34a" : "#22c55e"}
                      strokeWidth={calibratedScaleDragPointerIdRef.current !== null ? 0.9 : 0.8}
                      strokeOpacity={0.95}
                      pointerEvents="none"
                    />
                    <circle
                      cx={calibratedMoveHandleAnchorProjection.normalized.x * 100 + 4.3}
                      cy={calibratedMoveHandleAnchorProjection.normalized.y * 100 + 3.75}
                      r={1.85}
                      fill="#22c55e"
                      stroke="#ffffff"
                      strokeWidth={0.6}
                      className="cursor-nwse-resize"
                      pointerEvents="all"
                      aria-label="Calibrated scale handle"
                      onPointerDown={handleCalibratedScaleHandlePointerDown}
                    >
                      <title>Scale (calibrated, grounded)</title>
                    </circle>
                    <rect
                      x={calibratedMoveHandleAnchorProjection.normalized.x * 100 + 5.4}
                      y={calibratedMoveHandleAnchorProjection.normalized.y * 100 + 2.6}
                      width={10.4}
                      height={2.2}
                      rx={0.55}
                      fill="#14532d"
                      fillOpacity={0.88}
                      pointerEvents="none"
                    />
                    <text
                      x={calibratedMoveHandleAnchorProjection.normalized.x * 100 + 5.9}
                      y={calibratedMoveHandleAnchorProjection.normalized.y * 100 + 4.2}
                      fill="#dcfce7"
                      fontSize="2.05"
                      pointerEvents="none"
                    >
                      Scale (cal)
                    </text>
                  </g>
                )}
                {calibratedLiftHandleStatus.available &&
                  calibratedLiftHandleAnchorProjection.normalized &&
                  calibratedLiftHandlePlacement.available && (
                  <g>
                    {calibratedMoveHandleAnchorProjection.normalized && (
                      <line
                        x1={calibratedMoveHandleAnchorProjection.normalized.x * 100}
                        y1={calibratedMoveHandleAnchorProjection.normalized.y * 100}
                        x2={calibratedLiftHandleAnchorProjection.normalized.x * 100}
                        y2={calibratedLiftHandleAnchorProjection.normalized.y * 100}
                        stroke="#a78bfa"
                        strokeWidth={0.6}
                        strokeOpacity={isCalibratedObjectLifted ? 0.95 : 0.5}
                        strokeDasharray="1.6 1.2"
                        pointerEvents="none"
                      />
                    )}
                    <circle
                      cx={calibratedLiftHandleAnchorProjection.normalized.x * 100}
                      cy={calibratedLiftHandleAnchorProjection.normalized.y * 100}
                      r={1.0}
                      fill="#8b5cf6"
                      fillOpacity={0.7}
                      stroke="#ede9fe"
                      strokeOpacity={0.85}
                      strokeWidth={0.35}
                      pointerEvents="none"
                    />
                    <line
                      x1={calibratedLiftHandleAnchorProjection.normalized.x * 100}
                      y1={calibratedLiftHandleAnchorProjection.normalized.y * 100}
                      x2={calibratedLiftHandleAnchorProjection.normalized.x * 100 + calibratedLiftHandlePlacement.offset.x}
                      y2={calibratedLiftHandleAnchorProjection.normalized.y * 100 + calibratedLiftHandlePlacement.offset.y}
                      stroke={calibratedLiftDragPointerIdRef.current !== null ? "#7c3aed" : "#8b5cf6"}
                      strokeWidth={calibratedLiftDragPointerIdRef.current !== null ? 0.9 : 0.8}
                      strokeOpacity={0.95}
                      pointerEvents="none"
                    />
                    <circle
                      cx={calibratedLiftHandleAnchorProjection.normalized.x * 100 + calibratedLiftHandlePlacement.offset.x}
                      cy={calibratedLiftHandleAnchorProjection.normalized.y * 100 + calibratedLiftHandlePlacement.offset.y}
                      r={1.85}
                      fill="#8b5cf6"
                      stroke="#ffffff"
                      strokeWidth={0.6}
                      className="cursor-ns-resize"
                      pointerEvents="all"
                      aria-label="Calibrated lift handle"
                      onPointerDown={handleCalibratedLiftHandlePointerDown}
                    >
                      <title>Lift (calibrated, grounded, upward-only)</title>
                    </circle>
                    <rect
                      x={
                        calibratedLiftHandleAnchorProjection.normalized.x * 100 +
                        calibratedLiftHandlePlacement.offset.x -
                        12.0
                      }
                      y={
                        calibratedLiftHandleAnchorProjection.normalized.y * 100 +
                        calibratedLiftHandlePlacement.offset.y -
                        1.15
                      }
                      width={11.4}
                      height={2.2}
                      rx={0.55}
                      fill="#4c1d95"
                      fillOpacity={0.88}
                      pointerEvents="none"
                    />
                    <text
                      x={
                        calibratedLiftHandleAnchorProjection.normalized.x * 100 +
                        calibratedLiftHandlePlacement.offset.x -
                        11.5
                      }
                      y={
                        calibratedLiftHandleAnchorProjection.normalized.y * 100 +
                        calibratedLiftHandlePlacement.offset.y +
                        0.45
                      }
                      fill="#ede9fe"
                      fontSize="2.05"
                      pointerEvents="none"
                    >
                      Lift (cal)
                    </text>
                  </g>
                )}
                {isObject2DHandlesEffectivelyEnabled && lastAcceptedFloorClick && (
                  <g>
                    <circle
                      cx={lastAcceptedFloorClick.x * 100}
                      cy={lastAcceptedFloorClick.y * 100}
                      r={2.95}
                      fill="#0f172a"
                      fillOpacity={0.45}
                      stroke="#e2e8f0"
                      strokeOpacity={0.45}
                      strokeWidth={0.35}
                      pointerEvents="none"
                    />
                    <line
                      x1={lastAcceptedFloorClick.x * 100}
                      y1={lastAcceptedFloorClick.y * 100}
                      x2={lastAcceptedFloorClick.x * 100 + 4.2}
                      y2={lastAcceptedFloorClick.y * 100 - 4.2}
                      stroke={activeObjectHandleMode === "move" ? "#0ea5e9" : "#38bdf8"}
                      strokeWidth={activeObjectHandleMode === "move" ? 0.9 : 0.65}
                      strokeOpacity={activeObjectHandleMode === "move" ? 1 : 0.95}
                      pointerEvents="none"
                    />
                    <line
                      x1={lastAcceptedFloorClick.x * 100}
                      y1={lastAcceptedFloorClick.y * 100}
                      x2={lastAcceptedFloorClick.x * 100 - 4.4}
                      y2={lastAcceptedFloorClick.y * 100 - 4.2}
                      stroke={activeObjectHandleMode === "rotate" ? "#d97706" : "#f59e0b"}
                      strokeWidth={activeObjectHandleMode === "rotate" ? 0.9 : 0.65}
                      strokeOpacity={activeObjectHandleMode === "rotate" ? 1 : 0.95}
                      pointerEvents="none"
                    />
                    <line
                      x1={lastAcceptedFloorClick.x * 100}
                      y1={lastAcceptedFloorClick.y * 100}
                      x2={lastAcceptedFloorClick.x * 100 + 4.3}
                      y2={lastAcceptedFloorClick.y * 100 + 3.75}
                      stroke={activeObjectHandleMode === "scale" ? "#16a34a" : "#22c55e"}
                      strokeWidth={activeObjectHandleMode === "scale" ? 0.9 : 0.65}
                      strokeOpacity={activeObjectHandleMode === "scale" ? 1 : 0.95}
                      pointerEvents="none"
                    />
                    <line
                      x1={lastAcceptedFloorClick.x * 100}
                      y1={lastAcceptedFloorClick.y * 100}
                      x2={lastAcceptedFloorClick.x * 100}
                      y2={lastAcceptedFloorClick.y * 100 - 5.8}
                      stroke={activeObjectHandleMode === "height" ? "#7c3aed" : "#8b5cf6"}
                      strokeWidth={activeObjectHandleMode === "height" ? 0.9 : 0.65}
                      strokeOpacity={activeObjectHandleMode === "height" ? 1 : 0.95}
                      pointerEvents="none"
                    />
                    <circle
                      cx={lastAcceptedFloorClick.x * 100 + 4.2}
                      cy={lastAcceptedFloorClick.y * 100 - 4.2}
                      r={activeObjectHandleMode === "move" ? 1.95 : 1.6}
                      fill={activeObjectHandleMode === "move" ? "#0ea5e9" : "#38bdf8"}
                      stroke="#ffffff"
                      strokeWidth={0.6}
                      className="cursor-move"
                      pointerEvents="all"
                      aria-label="Move object handle"
                      onPointerDown={handleObjectMoveHandlePointerDown}
                    >
                      <title>Move</title>
                    </circle>
                    <rect
                      x={lastAcceptedFloorClick.x * 100 + 5.3}
                      y={lastAcceptedFloorClick.y * 100 - 6.9}
                      width={5.9}
                      height={2.2}
                      rx={0.55}
                      fill="#0c4a6e"
                      fillOpacity={activeObjectHandleMode === "move" ? 0.95 : 0.82}
                      pointerEvents="none"
                    />
                    <text
                      x={lastAcceptedFloorClick.x * 100 + 5.8}
                      y={lastAcceptedFloorClick.y * 100 - 5.3}
                      fill="#e0f2fe"
                      fontSize="2.05"
                      pointerEvents="none"
                    >
                      Move
                    </text>

                    <circle
                      cx={lastAcceptedFloorClick.x * 100 - 4.4}
                      cy={lastAcceptedFloorClick.y * 100 - 4.2}
                      r={activeObjectHandleMode === "rotate" ? 1.95 : 1.6}
                      fill={activeObjectHandleMode === "rotate" ? "#d97706" : "#f59e0b"}
                      stroke="#ffffff"
                      strokeWidth={0.6}
                      className="cursor-crosshair"
                      pointerEvents="all"
                      aria-label="Rotate object handle"
                      onPointerDown={handleObjectRotateHandlePointerDown}
                    >
                      <title>Rotate</title>
                    </circle>
                    <rect
                      x={lastAcceptedFloorClick.x * 100 - 10.6}
                      y={lastAcceptedFloorClick.y * 100 - 6.9}
                      width={6.9}
                      height={2.2}
                      rx={0.55}
                      fill="#78350f"
                      fillOpacity={activeObjectHandleMode === "rotate" ? 0.95 : 0.82}
                      pointerEvents="none"
                    />
                    <text
                      x={lastAcceptedFloorClick.x * 100 - 10.1}
                      y={lastAcceptedFloorClick.y * 100 - 5.3}
                      fill="#fef3c7"
                      fontSize="2.05"
                      pointerEvents="none"
                    >
                      Rotate
                    </text>

                    <rect
                      x={lastAcceptedFloorClick.x * 100 + 3.05}
                      y={lastAcceptedFloorClick.y * 100 + 2.45}
                      width={activeObjectHandleMode === "scale" ? 2.9 : 2.55}
                      height={activeObjectHandleMode === "scale" ? 2.9 : 2.55}
                      rx={0.45}
                      fill={activeObjectHandleMode === "scale" ? "#16a34a" : "#22c55e"}
                      stroke="#ffffff"
                      strokeWidth={0.6}
                      className="cursor-nesw-resize"
                      pointerEvents="all"
                      aria-label="Scale object handle"
                      onPointerDown={handleObjectScaleHandlePointerDown}
                    >
                      <title>Scale</title>
                    </rect>
                    <rect
                      x={lastAcceptedFloorClick.x * 100 + 6.4}
                      y={lastAcceptedFloorClick.y * 100 + 5}
                      width={5.9}
                      height={2.2}
                      rx={0.55}
                      fill="#14532d"
                      fillOpacity={activeObjectHandleMode === "scale" ? 0.95 : 0.82}
                      pointerEvents="none"
                    />
                    <text
                      x={lastAcceptedFloorClick.x * 100 + 6.8}
                      y={lastAcceptedFloorClick.y * 100 + 6.6}
                      fill="#dcfce7"
                      fontSize="2.05"
                      pointerEvents="none"
                    >
                      Scale
                    </text>

                    <polygon
                      points={`${lastAcceptedFloorClick.x * 100 - 1.15},${lastAcceptedFloorClick.y * 100 - 6.05} ${
                        lastAcceptedFloorClick.x * 100 + 1.15
                      },${lastAcceptedFloorClick.y * 100 - 6.05} ${lastAcceptedFloorClick.x * 100},${
                        lastAcceptedFloorClick.y * 100 - 8.15
                      }`}
                      fill={activeObjectHandleMode === "height" ? "#7c3aed" : "#8b5cf6"}
                      stroke="#ffffff"
                      strokeWidth={0.6}
                      className="cursor-ns-resize"
                      pointerEvents="all"
                      aria-label="Height object handle"
                      onPointerDown={handleObjectHeightHandlePointerDown}
                    >
                      <title>Adjust height / Position Y</title>
                    </polygon>
                    <rect
                      x={lastAcceptedFloorClick.x * 100 + 1.3}
                      y={lastAcceptedFloorClick.y * 100 - 9.4}
                      width={6.9}
                      height={2.2}
                      rx={0.55}
                      fill="#4c1d95"
                      fillOpacity={activeObjectHandleMode === "height" ? 0.95 : 0.82}
                      pointerEvents="none"
                    />
                    <text
                      x={lastAcceptedFloorClick.x * 100 + 1.75}
                      y={lastAcceptedFloorClick.y * 100 - 7.8}
                      fill="#ede9fe"
                      fontSize="2.05"
                      pointerEvents="none"
                    >
                      Height
                    </text>
                  </g>
                )}
              </svg>
            )}
            {manualAnnotation && manualSeamRenderData && (
              <svg
                ref={manualOverlayRef}
                className="absolute inset-0 z-30 h-full w-full"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                onPointerDown={handleManualOverlayPointerDown}
                onPointerMove={handleManualOverlayPointerMove}
                onPointerUp={handleManualOverlayPointerUp}
                onPointerCancel={handleManualOverlayPointerUp}
                style={{
                  touchAction: "none",
                  pointerEvents: isPlacingManualSeam || isDraggingManualVertex ? "auto" : "none",
                  cursor: isPlacingManualSeam ? "crosshair" : "default",
                }}
                aria-label="Manual seam annotation overlay (diagnostic only)"
              >
                {manualSeamRenderData.seams.map(({ id, projected, corridorStrokeWidth }) => {
                  if (projected.length === 0) return null;
                  const isSelected = id === selectedManualSeamId;
                  const pointsAttr = projected.map((point) => `${point.x},${point.y}`).join(" ");
                  return (
                    <g key={`manual-seam-${id}`}>
                      {projected.length >= 2 && corridorStrokeWidth > 0 && (
                        /* Subtle corridor band beneath the centerline; its width
                           tracks the seam's source-pixel half-width. */
                        <polyline
                          points={pointsAttr}
                          fill="none"
                          stroke="#f472b6"
                          strokeOpacity={0.18}
                          strokeWidth={corridorStrokeWidth}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          pointerEvents="none"
                        />
                      )}
                      {projected.length >= 2 && (
                        <polyline
                          points={pointsAttr}
                          fill="none"
                          stroke={isSelected ? "#f472b6" : "#fb7185"}
                          strokeOpacity={isSelected ? 1 : 0.85}
                          strokeWidth={isSelected ? 0.9 : 0.7}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          pointerEvents="none"
                        />
                      )}
                      {projected.map((point, index) => (
                        <circle
                          key={`manual-vertex-${id}-${index}`}
                          cx={point.x}
                          cy={point.y}
                          r={isSelected ? 1.15 : 0.95}
                          fill={isSelected ? "#f472b6" : "#fb7185"}
                          stroke="#1f0612"
                          strokeWidth={0.4}
                          className="cursor-grab"
                          pointerEvents="all"
                          onPointerDown={(event) => handleManualVertexPointerDown(event, id, index)}
                        >
                          <title>{`Seam ${id} · vertex ${index}`}</title>
                        </circle>
                      ))}
                    </g>
                  );
                })}
                {manualSeamRenderData.draft.length > 0 && (
                  <g aria-hidden="true">
                    {manualSeamRenderData.draft.length >= 2 && (
                      <polyline
                        points={manualSeamRenderData.draft.map((point) => `${point.x},${point.y}`).join(" ")}
                        fill="none"
                        stroke="#fbbf24"
                        strokeOpacity={0.95}
                        strokeWidth={0.7}
                        strokeDasharray="1.4 1"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        pointerEvents="none"
                      />
                    )}
                    {manualSeamRenderData.draft.map((point, index) => (
                      <circle
                        key={`manual-draft-${index}`}
                        cx={point.x}
                        cy={point.y}
                        r={0.95}
                        fill="#fbbf24"
                        stroke="#3b2a05"
                        strokeWidth={0.4}
                        pointerEvents="none"
                      />
                    ))}
                  </g>
                )}
              </svg>
            )}
            {manualTrialPreview && (
              <svg
                className="pointer-events-none absolute inset-0 z-40 h-full w-full"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-label="Constrained diagnostic trial preview overlay (temporary, diagnostic only)"
                aria-hidden="true"
              >
                {/* Temporary preview of the EXACT generated trial quad. Read-only
                    view-state; it never mutates floorPolygon, candidate, FOV, or
                    calibration. The baseline/selected candidate stays drawn in the
                    floor overlay above and is intentionally left unchanged. */}
                <polygon
                  points={manualTrialPreview.pointsAttribute}
                  fill="#06b6d4"
                  fillOpacity={0.12}
                  stroke="#22d3ee"
                  strokeOpacity={0.95}
                  strokeWidth={0.9}
                  strokeDasharray="2 1.2"
                  strokeLinejoin="round"
                />
                {manualTrialPreview.cornerMarkers.map((marker) => (
                  <g key={`trial-preview-corner-${marker.label}`}>
                    <circle
                      cx={marker.x}
                      cy={marker.y}
                      r={marker.moved ? 1.25 : 0.85}
                      fill={marker.moved ? "#22d3ee" : "#0e7490"}
                      fillOpacity={marker.moved ? 0.95 : 0.7}
                      stroke="#082f49"
                      strokeWidth={0.4}
                    />
                    <text
                      x={marker.x + 1.1}
                      y={marker.y - 0.9}
                      fill="#a5f3fc"
                      fontSize="2"
                      fontWeight="600"
                    >
                      {marker.label}
                      {marker.moved ? "*" : ""}
                    </text>
                  </g>
                ))}
              </svg>
            )}
            {coupledSearchPreview && (
              <>
                <div className="pointer-events-none absolute left-2 top-2 z-40 rounded border border-violet-400/70 bg-violet-950/80 px-2 py-0.5 text-[10px] font-medium text-violet-100">
                  Coupled diagnostic preview — temporary
                </div>
                <svg
                  className="pointer-events-none absolute inset-0 z-40 h-full w-full"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  aria-label="Type A coupled-search diagnostic preview overlay (temporary, diagnostic only)"
                  aria-hidden="true"
                >
                  {/* Temporary preview of the EXACT stored coupled-search trial
                      quad. Read-only view-state; it never mutates floorPolygon,
                      candidate, FOV, dimensions, or calibration. The baseline /
                      selected candidate stays drawn in the floor overlay above and
                      is intentionally left unchanged. Violet dashed treatment is
                      deliberately distinct from the baseline overlay and from the
                      cyan Phase 2O-E manual-trial preview. */}
                  <polygon
                    points={coupledSearchPreview.pointsAttribute}
                    fill="#8b5cf6"
                    fillOpacity={0.1}
                    stroke="#c084fc"
                    strokeOpacity={0.95}
                    strokeWidth={0.9}
                    strokeDasharray="1.4 1.4"
                    strokeLinejoin="round"
                  />
                  {coupledSearchPreview.cornerMarkers.map((marker) => (
                    <g key={`coupled-preview-corner-${marker.label}`}>
                      <circle
                        cx={marker.x}
                        cy={marker.y}
                        r={marker.moved ? 1.25 : 0.85}
                        fill={marker.moved ? "#c084fc" : "#6d28d9"}
                        fillOpacity={marker.moved ? 0.95 : 0.7}
                        stroke="#2e1065"
                        strokeWidth={0.4}
                      />
                      <text
                        x={marker.x + 1.1}
                        y={marker.y - 0.9}
                        fill="#ddd6fe"
                        fontSize="2"
                        fontWeight="600"
                      >
                        {marker.label}
                        {marker.moved ? "*" : ""}
                      </text>
                    </g>
                  ))}
                </svg>
              </>
            )}
            {localRefinementPreview && (
              <>
                <div className="pointer-events-none absolute left-2 top-2 z-40 rounded border border-rose-400/70 bg-rose-950/80 px-2 py-0.5 text-[10px] font-medium text-rose-100">
                  Local refinement preview — temporary
                </div>
                <svg
                  className="pointer-events-none absolute inset-0 z-40 h-full w-full"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  aria-label="Type A local-refinement diagnostic preview overlay (temporary, diagnostic only)"
                  aria-hidden="true"
                >
                  {/* Temporary preview of the EXACT stored local-refinement parent
                      tuple quad for one stored direct FOV probe. Read-only
                      view-state; it never mutates floorPolygon, candidate, FOV,
                      dimensions, or calibration. The baseline / selected candidate
                      stays drawn in the floor overlay above and is intentionally
                      left unchanged. The rose dotted treatment is deliberately
                      distinct from the cyan Phase 2O-E manual-trial preview, the
                      violet Phase 2O-I coupled preview, the green floor-fit grid,
                      and the cyan camera-pose grid. */}
                  <polygon
                    points={localRefinementPreview.pointsAttribute}
                    fill="#f43f5e"
                    fillOpacity={0.1}
                    stroke="#fb7185"
                    strokeOpacity={0.95}
                    strokeWidth={0.9}
                    strokeDasharray="0.6 1.3"
                    strokeLinejoin="round"
                  />
                  {localRefinementPreview.cornerMarkers.map((marker) => (
                    <g key={`localref-preview-corner-${marker.label}`}>
                      <circle
                        cx={marker.x}
                        cy={marker.y}
                        r={marker.moved ? 1.25 : 0.85}
                        fill={marker.moved ? "#fb7185" : "#9f1239"}
                        fillOpacity={marker.moved ? 0.95 : 0.7}
                        stroke="#4c0519"
                        strokeWidth={0.4}
                      />
                      <text
                        x={marker.x + 1.1}
                        y={marker.y - 0.9}
                        fill="#fecdd3"
                        fontSize="2"
                        fontWeight="600"
                      >
                        {marker.label}
                        {marker.moved ? "*" : ""}
                      </text>
                    </g>
                  ))}
                </svg>
              </>
            )}
            {/* Phase B2A: Type B direct-edit overlay. Mounted whenever a Type B
                review is active so an armed placement click can be captured even
                before the display overlay is shown. The SVG ROOT only captures
                pointer events while a placement target is armed or an endpoint
                drag is active; otherwise it stays pointer-events:none so unarmed
                Type B never blocks floor/manual/background interaction. Declared
                endpoint handles opt back IN with pointer-events:all (only while
                the overlay is visible and nothing is armed) so a handle drag
                takes precedence over floor clicks. It draws ONLY operator-
                declared endpoints/segments: it never extends a seam, intersects
                the seams, or synthesizes an off-frame corner / quadrilateral /
                wall plane / vanishing point / camera pose / FOV corridor /
                preview / calibration-ready treatment. */}
            {typeBReviewActive && imageIntrinsicSize && manualFrameSize && (
              <>
                {typeBOverlayVisible && (
                  <div className="pointer-events-none absolute right-2 top-2 z-40 rounded border border-amber-400/70 bg-amber-950/80 px-2 py-0.5 text-[10px] font-medium text-amber-100">
                    Type B declared visible observations
                  </div>
                )}
                {typeBPlacementTarget && (
                  <div className="pointer-events-none absolute left-2 top-2 z-40 rounded border border-emerald-400/70 bg-emerald-950/85 px-2 py-0.5 text-[10px] font-medium text-emerald-100">
                    {`Placing ${TYPE_B_PLACEMENT_TARGET_LABELS[typeBPlacementTarget]} — click on the image`}
                  </div>
                )}
                <svg
                  ref={typeBOverlayRef}
                  className="absolute inset-0 z-40 h-full w-full"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  onPointerDown={handleTypeBOverlayPointerDown}
                  onPointerMove={handleTypeBOverlayPointerMove}
                  onPointerUp={handleTypeBOverlayPointerUp}
                  onPointerCancel={handleTypeBOverlayPointerUp}
                  style={{
                    touchAction: "none",
                    pointerEvents:
                      typeBPlacementTarget || typeBDraggingTarget ? "auto" : "none",
                    cursor: typeBPlacementTarget ? "crosshair" : "default",
                  }}
                  aria-label="Type B declared evidence overlay (diagnostic only, operator-declared)"
                >
                  {typeBOverlayVisible && typeBOverlayRender && (
                    <g aria-hidden="true" pointerEvents="none">
                      {typeBOverlayRender.junction && (
                        <line
                          x1={typeBOverlayRender.junction.a.x}
                          y1={typeBOverlayRender.junction.a.y}
                          x2={typeBOverlayRender.junction.b.x}
                          y2={typeBOverlayRender.junction.b.y}
                          stroke="#fcd34d"
                          strokeOpacity={0.7}
                          strokeWidth={0.5}
                          strokeDasharray="0.6 0.9"
                          pointerEvents="none"
                        />
                      )}
                      {typeBOverlayRender.lines.map((line) => (
                        <g key={`type-b-line-${line.role}`} pointerEvents="none">
                          <line
                            x1={line.start.x}
                            y1={line.start.y}
                            x2={line.end.x}
                            y2={line.end.y}
                            stroke={line.role === "rear" ? "#f59e0b" : "#fbbf24"}
                            strokeOpacity={0.95}
                            strokeWidth={0.8}
                            strokeDasharray="2 1.2"
                            strokeLinecap="round"
                            pointerEvents="none"
                          />
                          {[
                            { p: line.start, status: line.startStatus, key: "start" },
                            { p: line.end, status: line.endStatus, key: "end" },
                          ].map((endpoint) => (
                            <text
                              key={`type-b-${line.role}-${endpoint.key}`}
                              x={endpoint.p.x + 1.1}
                              y={endpoint.p.y - 0.9}
                              fill="#fde68a"
                              fontSize="2"
                              fontWeight="600"
                              pointerEvents="none"
                            >
                              {`${line.role === "rear" ? "R" : "S"}·${TYPE_B_ENDPOINT_STATUS_GLYPH[endpoint.status]}`}
                            </text>
                          ))}
                        </g>
                      ))}
                    </g>
                  )}
                  {/* Draggable handles for DECLARED endpoints only. Hollow amber
                      rings are deliberately distinct from Type A's filled pink
                      vertices, the floor-polygon handles, candidates, previews,
                      and any readiness/calibration treatment. They opt into
                      pointer events only while the overlay is visible and no
                      placement is armed (placement clicks take the whole overlay). */}
                  {typeBOverlayVisible &&
                    typeBEndpointHandles.map((handle) => {
                      const isDragging = typeBDraggingTarget === handle.target;
                      const color = handle.role === "rear" ? "#f59e0b" : "#fbbf24";
                      return (
                        <circle
                          key={`type-b-handle-${handle.target}`}
                          cx={handle.x}
                          cy={handle.y}
                          r={isDragging ? 2.1 : 1.7}
                          fill={isDragging ? color : "transparent"}
                          fillOpacity={isDragging ? 0.35 : 1}
                          stroke={color}
                          strokeWidth={isDragging ? 0.9 : 0.7}
                          className="cursor-grab"
                          pointerEvents={typeBPlacementTarget ? "none" : "all"}
                          onPointerDown={(event) =>
                            handleTypeBHandlePointerDown(event, handle.target)
                          }
                        >
                          <title>{`Type B ${TYPE_B_PLACEMENT_TARGET_LABELS[handle.target]} (drag to adjust)`}</title>
                        </circle>
                      );
                    })}
                </svg>
              </>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <h2 className="text-sm font-medium text-slate-100">Lab status</h2>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-300">
            <span className="rounded border border-slate-800 bg-slate-950/70 px-2 py-1">
              <span className="text-slate-500">model:</span> {formatModelStatus(modelLoadState, modelLoadError)}
            </span>
            <span className="rounded border border-slate-800 bg-slate-950/70 px-2 py-1">
              <span className="text-slate-500">object:</span> {currentActiveObjectType}
            </span>
            <span className="rounded border border-slate-800 bg-slate-950/70 px-2 py-1">
              <span className="text-slate-500">renderer:</span> {rendererSize.width} x {rendererSize.height}
            </span>
            <span className="rounded border border-slate-800 bg-slate-950/70 px-2 py-1">
              <span className="text-slate-500">auto-normalize:</span>{" "}
              {!autoNormalizeBoundsEnabled
                ? "off"
                : autoBoundsInfo?.ok
                  ? "applied"
                  : `skipped (${autoBoundsInfo?.reason ?? "none"})`}
            </span>
            <span className="rounded border border-slate-800 bg-slate-950/70 px-2 py-1">
              <span className="text-slate-500">auto-fit:</span> {autoFitStatus.message}
            </span>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-slate-100">Basic controls</h2>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={showFloorOverlay}
                  onChange={(event) => setShowFloorOverlay(event.target.checked)}
                  className="accent-emerald-400"
                />
                Show floor polygon
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={isFloorClickPlacementEnabled}
                  onChange={(event) => setIsFloorClickPlacementEnabled(event.target.checked)}
                  className="accent-emerald-400"
                />
                Click floor to place object
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={isFloorAnchorDragEnabled}
                  onChange={(event) => setIsFloorAnchorDragEnabled(event.target.checked)}
                  className="accent-emerald-400"
                />
                Drag floor anchor to move object
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={isObject2DHandlesEnabled}
                  onChange={(event) => setIsObject2DHandlesEnabled(event.target.checked)}
                  className="accent-emerald-400"
                />
                Enable object 2D handles
              </label>
              <button
                type="button"
                onClick={handleAutoFitFromFloor}
                disabled={isCalibratedCameraActive}
                className="rounded-lg border border-emerald-500/70 px-3 py-1.5 text-xs text-emerald-200 transition hover:border-emerald-300 hover:text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Auto-fit from floor
              </button>
              <button
                type="button"
                onClick={handleResetTransform}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200"
              >
                Reset transform
              </button>
              <button
                type="button"
                onClick={() => {
                  cancelPendingCalibrationRestoreAfterManualGeometryChange();
                  setFloorPolygon(DEFAULT_FLOOR_POLYGON);
                  setActiveFloorHandleIndex(null);
                  dragPointerIdRef.current = null;
                  objectHandleDragPointerIdRef.current = null;
                  setActiveObjectHandleMode(null);
                  setWasLastObjectHandleMoveRejected(false);
                  setLastObjectHandleRotateDeltaDeg(null);
                  setLastObjectHandleScaleMultiplier(null);
                  setLastObjectHandleHeightDeltaYUnits(null);
                  floorAnchorDragPointerIdRef.current = null;
                  setIsFloorAnchorDragActive(false);
                  setWasLastAnchorDragMoveRejected(false);
                }}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200"
              >
                Reset floor polygon
              </button>
            </div>
          </div>
          <p
            className={`mt-2 text-xs ${
              autoFitStatus.kind === "error"
                ? "text-rose-300"
                : autoFitStatus.kind === "success"
                  ? "text-emerald-300"
                  : "text-slate-500"
            }`}
          >
            {autoFitStatus.message}
          </p>
          {isCalibratedCameraActive && (
            <p className="mt-1 text-xs text-amber-300">{LEGACY_FLOOR_MAPPING_DISABLED_MESSAGE}</p>
          )}
          {isFloorAnchorDragEffectivelyEnabled && !lastAcceptedFloorClick && (
            <p className="mt-2 text-xs text-amber-300">
              Click inside the floor polygon first to create an anchor marker, then drag it to move the object.
            </p>
          )}
          {isObject2DHandlesEffectivelyEnabled && !lastAcceptedFloorClick && (
            <p className="mt-1 text-xs text-amber-300">
              Enable object 2D handles is on. Click inside the floor polygon first to create an anchor.
            </p>
          )}
          {isObject2DHandlesEffectivelyEnabled && lastAcceptedFloorClick && (
            <p className="mt-1 text-xs text-sky-200">
              Overlay handles are attached to the active object anchor. Drag Move/Height/Rotate/Scale handles to manipulate the
              active 3D object.
            </p>
          )}
          <div className="mt-2 rounded-lg border border-slate-800 bg-slate-950/50 p-2 text-[11px] text-slate-300">
            <p>
              <span className="text-slate-400">Click floor to place object:</span> click the floor background inside
              the polygon to set the object anchor.
            </p>
            <p className="mt-1">
              <span className="text-slate-400">Drag floor anchor to move object:</span> drag the pink anchor marker.
            </p>
            <p className="mt-1">
              <span className="text-slate-400">Object 2D move handle:</span> drag the blue move handle near the anchor.
            </p>
            <p className="mt-1">
              <span className="text-slate-400">Object 2D height handle:</span> drag the violet handle up/down to adjust Position Y.
            </p>
            <p className="mt-1">
              <span className="text-slate-400">Object 2D rotate handle:</span> drag the amber handle around the anchor.
            </p>
            <p className="mt-1">
              <span className="text-slate-400">Object 2D scale handle:</span> drag the green handle away/toward the anchor.
            </p>
            {isFloorClickPlacementEnabled && isFloorAnchorDragEffectivelyEnabled && (
              <p className="mt-1 text-amber-200">
                Anchor drag takes precedence on the marker; background floor clicks still place the object.
              </p>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-sm font-medium text-slate-100">Auto Floor Detection</h2>
              <p className="mt-1 text-xs text-slate-400">
                Runs through a mockable detection provider. Suggestions stay preview-only until you explicitly click Apply
                suggested quad.
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <button
                type="button"
                onClick={handleDetectFloor}
                disabled={autoFloorDetectionRunState === "detecting"}
                className="rounded-lg border border-fuchsia-500/70 px-3 py-1.5 text-xs text-fuchsia-200 transition hover:border-fuchsia-300 hover:text-fuchsia-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {autoFloorDetectionRunState === "detecting" ? "Detecting floor…" : "Detect floor"}
              </button>
              <span className="text-[10px] uppercase tracking-wide text-slate-500">
                using {selectedAutoFloorProviderId} (mock)
              </span>
            </div>
          </div>
          {availableAutoFloorProviders.length > 1 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-300">
              <span className="text-slate-500">Provider</span>
              <div className="flex flex-wrap gap-1">
                {availableAutoFloorProviders.map((provider) => {
                  const isSelected = provider.id === selectedAutoFloorProviderId;
                  return (
                    <button
                      key={provider.id}
                      type="button"
                      onClick={() => setSelectedAutoFloorProviderId(provider.id)}
                      disabled={autoFloorDetectionRunState === "detecting"}
                      aria-pressed={isSelected}
                      title={provider.description}
                      className={`rounded-md border px-2 py-1 text-[11px] transition disabled:cursor-not-allowed disabled:opacity-50 ${
                        isSelected
                          ? "border-fuchsia-400/80 bg-fuchsia-500/10 text-fuchsia-100"
                          : "border-slate-700 text-slate-300 hover:border-slate-500"
                      }`}
                    >
                      {provider.label}
                    </button>
                  );
                })}
              </div>
              {selectedAutoFloorProviderId === "mock-api" && (
                <span className="basis-full text-[11px] text-slate-500">
                  Exercises the lab API boundary using canned vision-model-shaped data. No AI or external API is called.
                </span>
              )}
              {selectedAutoFloorProviderId === "vision-model" && (
                <span className="basis-full text-[11px] text-amber-400/80">
                  Experimental lab provider. Gemini proposes candidates; Vibode validates geometry before preview.
                </span>
              )}
            </div>
          )}
          {autoFloorDetectionRunState === "failed" && (
            <p className="mt-3 rounded-lg border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">
              Detection failed.
              {autoFloorDetectionFailureReasons.length > 0
                ? ` ${autoFloorDetectionFailureReasons.join(" ")}`
                : ""}{" "}
              The manual floor polygon was not changed.
            </p>
          )}
          {autoFloorDetectionResult ? (
            <div className="mt-3 space-y-3">
              <div className="text-xs text-slate-400">
                <span className="text-slate-500">status:</span> {autoFloorDetectionResult.status}
                <span className="ml-3 text-slate-500">candidates:</span> {autoFloorDetectionResult.candidates.length}
              </div>
              <div className="flex flex-col gap-2">
                {autoFloorDetectionResult.candidates.map((candidate) => {
                  const isSelected = selectedAutoFloorCandidate?.id === candidate.id;
                  return (
                    <label
                      key={candidate.id}
                      className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-xs transition ${
                        isSelected
                          ? "border-fuchsia-400/80 bg-fuchsia-500/10 text-fuchsia-100"
                          : "border-slate-800 bg-slate-950/50 text-slate-300 hover:border-slate-600"
                      }`}
                    >
                      <input
                        type="radio"
                        name="auto-floor-candidate"
                        value={candidate.id}
                        checked={isSelected}
                        onChange={() => setSelectedAutoFloorCandidateId(candidate.id)}
                        className="mt-0.5 accent-fuchsia-400"
                      />
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-slate-100">{candidate.label}</span>
                          <span className="rounded bg-slate-800/80 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-300">
                            {candidate.confidence} · {candidate.confidenceScore.toFixed(2)}
                          </span>
                        </span>
                        {candidate.notes.length > 0 && (
                          <span className="mt-1 block text-[11px] text-slate-400">{candidate.notes.join(" ")}</span>
                        )}
                        {candidate.risks.length > 0 && (
                          <span className="mt-1 block text-[11px] text-amber-300/90">
                            Risks: {candidate.risks.join(" ")}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
              {selectedAutoFloorCandidate && selectedAutoFloorCandidateScore && (
                <div
                  className={`rounded-lg border px-3 py-2 text-[11px] ${
                    selectedAutoFloorCandidateScore.scoreBand === "high"
                      ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-100"
                      : selectedAutoFloorCandidateScore.scoreBand === "medium"
                        ? "border-sky-500/50 bg-sky-500/10 text-sky-100"
                        : selectedAutoFloorCandidateScore.scoreBand === "low"
                          ? "border-amber-500/50 bg-amber-500/10 text-amber-100"
                          : "border-rose-500/60 bg-rose-500/10 text-rose-100"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">Geometry score (preview)</span>
                    <span className="flex items-center gap-2">
                      <span className="rounded bg-slate-900/60 px-1.5 py-0.5 uppercase tracking-wide">
                        {selectedAutoFloorCandidateScore.scoreBand}
                      </span>
                      <span className="tabular-nums">{selectedAutoFloorCandidateScore.score.toFixed(2)}</span>
                    </span>
                  </div>
                  <dl className="mt-2 grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-2">
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-300/80">polygon sanity</dt>
                      <dd>{selectedAutoFloorCandidateScore.polygon.ok ? "ok" : "issues"}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-300/80">normalized area</dt>
                      <dd>
                        {selectedAutoFloorCandidateScore.polygon.areaNorm === null
                          ? "n/a"
                          : selectedAutoFloorCandidateScore.polygon.areaNorm.toFixed(4)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-300/80">convex / self-int</dt>
                      <dd>
                        {selectedAutoFloorCandidateScore.polygon.convex ? "convex" : "non-convex"} /{" "}
                        {selectedAutoFloorCandidateScore.polygon.selfIntersecting ? "self-int" : "clean"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-300/80">near/far ordering</dt>
                      <dd>{selectedAutoFloorCandidateScore.polygon.nearFarOrderingOk ? "ok" : "weak"}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-300/80">corner ordering</dt>
                      <dd>
                        {selectedAutoFloorCandidateScore.cornerOrdering.ok ? "ok" : "fail"}
                        {selectedAutoFloorCandidateScore.cornerOrdering.confidence !== null
                          ? ` (${selectedAutoFloorCandidateScore.cornerOrdering.confidence})`
                          : ""}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-300/80">homography</dt>
                      <dd>
                        {selectedAutoFloorCandidateScore.homography.ok ? "ok" : "fail/none"}
                        {selectedAutoFloorCandidateScore.homography.sourceReprojectionErrorPx !== null &&
                        selectedAutoFloorCandidateScore.homography.sourceReprojectionErrorPx !== undefined
                          ? ` (reproj ${selectedAutoFloorCandidateScore.homography.sourceReprojectionErrorPx.toFixed(2)}px)`
                          : ""}
                      </dd>
                    </div>
                  </dl>
                  {selectedAutoFloorCandidateScore.overallNotes.length > 0 && (
                    <p className="mt-2 text-slate-200/80">{selectedAutoFloorCandidateScore.overallNotes.join(" ")}</p>
                  )}
                  {selectedAutoFloorCandidateScore.risks.length > 0 && (
                    <p className="mt-1 text-amber-200/90">Risks: {selectedAutoFloorCandidateScore.risks.join(" ")}</p>
                  )}
                </div>
              )}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={handleApplySuggestedQuad}
                    disabled={!canApplyAutoFloorCandidate}
                    className="rounded-lg border border-emerald-500/70 px-3 py-1.5 text-xs text-emerald-200 transition hover:border-emerald-300 hover:text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Apply suggested quad
                  </button>
                  {appliedAutoFloorCandidateId && selectedAutoFloorCandidate?.id === appliedAutoFloorCandidateId && (
                    <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-emerald-200">
                      applied
                    </span>
                  )}
                </div>
                {selectedAutoFloorCandidateScore?.scoreBand === "invalid" ? (
                  <p className="text-[11px] text-rose-300">
                    This suggestion cannot be applied because its geometry score is invalid.
                  </p>
                ) : selectedAutoFloorCandidateScore?.scoreBand === "low" ? (
                  <p className="text-[11px] text-amber-300">
                    Low-confidence suggestion — adjust manually after applying.
                  </p>
                ) : null}
                <p className="text-[11px] text-slate-500">
                  Applies the selected suggestion to the editable floor polygon. You can adjust corners manually after
                  applying.
                </p>
                {lastAutoFloorApplyMessage !== "none" && (
                  <p className="text-[11px] text-emerald-300/90">{lastAutoFloorApplyMessage}</p>
                )}
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-[11px]">
                <p className="font-medium text-slate-200">Assisted candidate solvability</p>
                <p className="mt-1 text-slate-300">{assistedCandidateSolvabilityContext.primaryText}</p>
                {assistedCandidateSolvabilityContext.state === "identical-active" ? (
                  <p className="mt-1 text-slate-500">{assistedCandidateSolvabilityContext.secondaryText}</p>
                ) : null}
                {assistedCandidateSolvabilityContext.state === "evaluated" ? (
                  <div className="mt-2 space-y-1 text-slate-300">
                    {assistedCandidateSolvabilityContext.editedAfterApplyingText ? (
                      <p className="text-slate-400">{assistedCandidateSolvabilityContext.editedAfterApplyingText}</p>
                    ) : null}
                    <p>Camera-solvable: {assistedCandidateSolvabilityContext.cameraSolvableText}</p>
                    <p>High confidence: {assistedCandidateSolvabilityContext.highConfidenceText}</p>
                    <p>
                      {assistedCandidateSolvabilityContext.applySafeLabel}: {assistedCandidateSolvabilityContext.applySafeText}
                    </p>
                    <p>
                      CV reprojection: Average: {assistedCandidateSolvabilityContext.cvAverageText} · Maximum:{" "}
                      {assistedCandidateSolvabilityContext.cvMaximumText}
                    </p>
                    <p>
                      Rendered-camera reprojection: Average: {assistedCandidateSolvabilityContext.renderedAverageText} ·
                      Maximum: {assistedCandidateSolvabilityContext.renderedMaximumText}
                    </p>
                    <p>
                      CV ↔ rendered-camera difference: Average: {assistedCandidateSolvabilityContext.deltaAverageText} ·
                      Maximum: {assistedCandidateSolvabilityContext.deltaMaximumText}
                    </p>
                    <p>FOV scan (valid pose sampled intervals): {assistedCandidateSolvabilityContext.validFovSampleText}</p>
                    <p>FOV scan (high-confidence sampled intervals): {assistedCandidateSolvabilityContext.highConfidenceFovSampleText}</p>
                    <p>{assistedCandidateSolvabilityContext.largestCvResidualText}</p>
                    <p>{assistedCandidateSolvabilityContext.largestRenderedResidualText}</p>
                    <p>{assistedCandidateSolvabilityContext.largestDifferenceText}</p>
                    <p className="text-slate-500">{assistedCandidateSolvabilityContext.differenceDiagnosticNote}</p>
                    <p>{assistedCandidateSolvabilityContext.mainBlockerText}</p>
                    {assistedCandidateSolvabilityContext.mainBlockingContributorDetail ? (
                      <p className="text-slate-400">{assistedCandidateSolvabilityContext.mainBlockingContributorDetail}</p>
                    ) : null}
                    <p className="text-slate-500">{assistedCandidateSolvabilityContext.diagnosticOnlyText}</p>
                  </div>
                ) : null}
              </div>
              {assistedCandidateSupportReadout ? (
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-[11px]">
                  <p className="font-medium text-slate-200">Support classification (diagnostic only)</p>
                  <p className="mt-1 text-slate-300">Classification: {assistedCandidateSupportReadout.classLabel}</p>
                  <p className="text-slate-300">Suspected target: {assistedCandidateSupportReadout.targetText}</p>
                  <p className="text-slate-300">
                    Frame-edge contacts (geometry only): {assistedCandidateSupportReadout.frameEdgeText}
                  </p>
                  <p className="text-slate-400">Corridor available: No — physical seam evidence unavailable</p>
                  <div className="mt-1 space-y-1 text-slate-500">
                    {assistedCandidateSupportReadout.reasons.map((reason, index) => (
                      <p key={`support-reason-${index}`}>• {reason}</p>
                    ))}
                  </div>
                  <p className="mt-1 text-slate-500">
                    Diagnostic only — does not move corners, change candidate selection, or enable any geometry search.
                  </p>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="mt-3 text-xs text-slate-500">
              No suggestions yet. Click “Detect floor” to run the mock-local provider and create deterministic candidate
              quads.
            </p>
          )}
        </section>

        <CollapsibleSection
          title="Manual Seam / Support Annotation — Diagnostic Only"
          open={isManualAnnotationOpen}
          onToggle={() => setIsManualAnnotationOpen((open) => !open)}
          description="Records visible image evidence only. Does not move corners, change FOV, apply calibration, or affect Scan & Apply."
          meta={
            <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-rose-200">
              lab-only · local · not persisted
            </span>
          }
        >
          <div className="space-y-3 text-[11px] text-slate-300">
            <p className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-rose-100/90">
              Operator declaration of visible image evidence only. This layer is independent of the green/dashed/grid
              guide geometry and never derives, implies, or claims physical seam truth, crop truth, occlusion
              continuation, solver correctness, or permission to move a corner.
            </p>
            {manualAnnotationResetReason && (
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-200">
                {manualAnnotationResetReason}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {!manualAnnotation ? (
                <button
                  type="button"
                  onClick={handleBeginManualAnnotation}
                  className="rounded-lg border border-rose-500/70 px-3 py-1.5 text-rose-200 transition hover:border-rose-300 hover:text-rose-100"
                >
                  Begin annotation
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleClearManualAnnotation}
                  className="rounded-lg border border-slate-600 px-3 py-1.5 text-slate-200 transition hover:border-slate-400"
                >
                  Clear annotation
                </button>
              )}
            </div>

            {manualAnnotation && !manualAnnotationCoordsReady && (
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-200">
                Source image dimensions or renderer size are not yet available. Load an image so seam coordinates can be
                stored in source-normalized space.
              </p>
            )}

            {manualAnnotation && (
              <>
                {/* Seam capture controls */}
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {!isPlacingManualSeam ? (
                      <button
                        type="button"
                        onClick={handleStartAddSeam}
                        disabled={!manualAnnotationCoordsReady}
                        className="rounded-lg border border-rose-500/70 px-3 py-1.5 text-rose-200 transition hover:border-rose-300 hover:text-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Add visible floor-wall seam
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={handleFinishSeam}
                          disabled={manualSeamDraftPoints.length < 2}
                          className="rounded-lg border border-emerald-500/70 px-3 py-1.5 text-emerald-200 transition hover:border-emerald-300 hover:text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Finish seam
                        </button>
                        <button
                          type="button"
                          onClick={handleCancelSeamDraft}
                          className="rounded-lg border border-slate-600 px-3 py-1.5 text-slate-200 transition hover:border-slate-400"
                        >
                          Cancel
                        </button>
                        <span className="text-slate-400">
                          Click on the image to place vertices ({manualSeamDraftPoints.length} placed). Minimum two
                          points.
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* Seam list */}
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                  <p className="font-medium text-slate-200">Seams ({manualAnnotation.seams.length})</p>
                  {manualAnnotation.seams.length === 0 ? (
                    <p className="mt-1 text-slate-500">No seams yet. Use “Add visible floor-wall seam”.</p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {manualAnnotation.seams.map((seam) => {
                        const isSelected = seam.id === selectedManualSeamId;
                        const lengthPx = manualSeamLengths[seam.id];
                        const isLongest = seam.id === longestManualSeamId && manualAnnotation.seams.length > 1;
                        return (
                          <li
                            key={seam.id}
                            className={`rounded-lg border px-3 py-2 ${
                              isSelected
                                ? "border-rose-500/60 bg-rose-500/10"
                                : "border-slate-800 bg-slate-900/60"
                            }`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <button
                                type="button"
                                onClick={() => setSelectedManualSeamId(isSelected ? null : seam.id)}
                                className="text-left font-medium text-slate-100"
                              >
                                {seam.id} · {seam.points.length} pts
                              </button>
                              <div className="flex items-center gap-2">
                                {typeof lengthPx === "number" && (
                                  <span className="rounded bg-slate-900/70 px-1.5 py-0.5 text-[10px] text-slate-400">
                                    {lengthPx.toFixed(1)} src px{isLongest ? " · longest (measured)" : ""}
                                  </span>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleDeleteSeam(seam.id)}
                                  className="rounded border border-rose-500/50 px-2 py-0.5 text-[10px] text-rose-200 transition hover:border-rose-300"
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                            {isSelected && (
                              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                <label className="flex flex-col gap-1">
                                  <span className="text-slate-400">Corridor half-width (source px)</span>
                                  <input
                                    type="number"
                                    min={0.5}
                                    step={0.5}
                                    value={seam.corridor.halfWidthSourcePx}
                                    onChange={(event) => {
                                      const parsed = Number.parseFloat(event.target.value);
                                      if (Number.isFinite(parsed)) handleSetSeamCorridor(seam.id, parsed);
                                    }}
                                    className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100 outline-none focus:border-rose-400"
                                  />
                                </label>
                                <label className="flex flex-col gap-1">
                                  <span className="text-slate-400">Note (optional)</span>
                                  <input
                                    type="text"
                                    value={seam.notes ?? ""}
                                    onChange={(event) => handleSetSeamNote(seam.id, event.target.value)}
                                    placeholder="e.g. clear baseboard line under window"
                                    className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100 outline-none focus:border-rose-400"
                                  />
                                </label>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                {/* Per-corner support */}
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                  <p className="font-medium text-slate-200">Per-corner support (operator-declared evidence)</p>
                  <p className="mt-1 text-slate-500">
                    Declares what is visibly evident at each canonical corner. Not crop/occlusion truth and not
                    permission to move a corner.
                  </p>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {/* Phase 2O-E1: visual render order only — display far/rear (FL,
                        FR) on the top row and near/front (NL, NR) on the bottom row to
                        match room-overlay perspective. Canonical identifiers,
                        support-state keys, handlers, and bindings are unchanged. */}
                    {(["FL", "FR", "NL", "NR"] as const).map((corner) => {
                      const support = manualAnnotation.cornerSupport[corner];
                      return (
                        <div key={`corner-${corner}`} className="rounded-lg border border-slate-800 bg-slate-900/60 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-slate-100">{corner}</span>
                            <select
                              value={support?.state ?? "unset"}
                              onChange={(event) =>
                                handleSetCornerSupportState(
                                  corner,
                                  event.target.value as ManualCornerSupportState | "unset"
                                )
                              }
                              className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100 outline-none focus:border-rose-400"
                            >
                              <option value="unset">—</option>
                              <option value="trustworthy">trustworthy</option>
                              <option value="frame_truncated">frame_truncated</option>
                              <option value="occluded">occluded</option>
                              <option value="uncertain">uncertain</option>
                            </select>
                          </div>
                          {support && (
                            <label className="mt-2 flex flex-col gap-1">
                              <span className="text-slate-400">Linked seam (optional)</span>
                              <select
                                value={support.linkedSeamId ?? ""}
                                onChange={(event) => handleSetCornerSupportLinkedSeam(corner, event.target.value)}
                                className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100 outline-none focus:border-rose-400"
                              >
                                <option value="">none</option>
                                {manualAnnotation.seams.map((seam) => (
                                  <option key={`${corner}-link-${seam.id}`} value={seam.id}>
                                    {seam.id}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Mode + authority */}
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                  <p className="font-medium text-slate-200">Search / authority mode (diagnostic only)</p>
                  <p className="mt-1 text-slate-500">No mode alters calibration, candidate selection, or any geometry search.</p>
                  <label className="mt-2 flex flex-col gap-1">
                    <span className="text-slate-400">Mode</span>
                    <select
                      value={manualAnnotation.mode}
                      onChange={(event) => handleSetManualMode(event.target.value as ManualSearchMode)}
                      className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100 outline-none focus:border-rose-400"
                    >
                      <option value="direct">Direct — no adjustment authority</option>
                      <option value="single_corner_constrained">Single-corner constrained</option>
                      <option value="coupled_far_edge_constrained">Coupled far edge constrained (FL + FR)</option>
                      <option value="abstain">Insufficient support / abstain</option>
                    </select>
                  </label>

                  {manualAnnotation.adjustmentAuthority.kind === "single_corner" && (
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <label className="flex flex-col gap-1">
                        <span className="text-slate-400">Corner</span>
                        <select
                          value={manualAnnotation.adjustmentAuthority.corner}
                          onChange={(event) => handleSetAuthorityCorner(event.target.value as FloorCornerLabel)}
                          className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100 outline-none focus:border-rose-400"
                        >
                          {FLOOR_CORNER_LABELS.map((corner) => (
                            <option key={`auth-corner-${corner}`} value={corner}>
                              {corner}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-slate-400">Seam</span>
                        <select
                          value={manualAnnotation.adjustmentAuthority.seamId}
                          onChange={(event) => handleSetAuthoritySeam(event.target.value)}
                          className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100 outline-none focus:border-rose-400"
                        >
                          <option value="">select seam…</option>
                          {manualAnnotation.seams.map((seam) => (
                            <option key={`auth-seam-${seam.id}`} value={seam.id}>
                              {seam.id}
                            </option>
                          ))}
                        </select>
                      </label>
                      <p className="text-slate-500 sm:col-span-2">Allowed span: full usable seam (0 → 1).</p>
                    </div>
                  )}

                  {manualAnnotation.adjustmentAuthority.kind === "coupled_far_edge" && (
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <p className="text-slate-300 sm:col-span-2">Corners: FL + FR (structurally fixed).</p>
                      <label className="flex flex-col gap-1">
                        <span className="text-slate-400">Seam</span>
                        <select
                          value={manualAnnotation.adjustmentAuthority.seamId}
                          onChange={(event) => handleSetAuthoritySeam(event.target.value)}
                          className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100 outline-none focus:border-rose-400"
                        >
                          <option value="">select seam…</option>
                          {manualAnnotation.seams.map((seam) => (
                            <option key={`coupled-seam-${seam.id}`} value={seam.id}>
                              {seam.id}
                            </option>
                          ))}
                        </select>
                      </label>
                      <p className="text-slate-500 sm:col-span-2">
                        FL/FR allowed spans: full usable seam (0 → 1). Coupling preserves order and edge direction. No
                        trial generation or mutation is performed in this phase.
                      </p>
                    </div>
                  )}
                </div>

                {/* Determining edge */}
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                  <p className="font-medium text-slate-200">Longest Determining Edge (operator assertion)</p>
                  <p className="mt-1 text-slate-500">
                    Never auto-selected from measured length. This is an operator assertion of the strongest truthful
                    visible support span; measured lengths above are diagnostic only.
                  </p>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label className="flex flex-col gap-1">
                      <span className="text-slate-400">Determining seam</span>
                      <select
                        value={manualAnnotation.determiningEdge?.seamId ?? ""}
                        onChange={(event) => handleSetDeterminingEdgeSeam(event.target.value)}
                        className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100 outline-none focus:border-rose-400"
                      >
                        <option value="">none</option>
                        {manualAnnotation.seams.map((seam) => (
                          <option key={`det-seam-${seam.id}`} value={seam.id}>
                            {seam.id}
                          </option>
                        ))}
                      </select>
                    </label>
                    {manualAnnotation.determiningEdge && (
                      <label className="flex flex-col gap-1">
                        <span className="text-slate-400">Role</span>
                        <select
                          value={manualAnnotation.determiningEdge.role}
                          onChange={(event) =>
                            handleSetDeterminingEdgeRole(
                              event.target.value as "rear_floor_wall_edge" | "other_visible_floor_boundary"
                            )
                          }
                          className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100 outline-none focus:border-rose-400"
                        >
                          <option value="rear_floor_wall_edge">rear_floor_wall_edge (FL → FR)</option>
                          <option value="other_visible_floor_boundary">other_visible_floor_boundary</option>
                        </select>
                      </label>
                    )}
                  </div>
                  {manualAnnotation.determiningEdge &&
                    manualAnnotation.determiningEdge.role === "other_visible_floor_boundary" && (
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        <span className="text-slate-400">Intended canonical support:</span>
                        {FLOOR_CORNER_LABELS.map((corner) => (
                          <label key={`det-corner-${corner}`} className="flex items-center gap-1 text-slate-200">
                            <input
                              type="checkbox"
                              checked={manualAnnotation.determiningEdge!.intendedCanonicalSupport.includes(corner)}
                              onChange={() => handleToggleDeterminingEdgeCorner(corner)}
                            />
                            {corner}
                          </label>
                        ))}
                      </div>
                    )}
                  {manualAnnotation.determiningEdge &&
                    manualAnnotation.determiningEdge.role === "rear_floor_wall_edge" && (
                      <p className="mt-2 text-slate-500">Intended canonical support: FL + FR (rear floor-wall edge).</p>
                    )}
                </div>

                {/* Validation / completeness */}
                {manualAnnotationValidation && (
                  <div
                    className={`rounded-lg border p-3 ${
                      manualAnnotationValidation.ok
                        ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-100"
                        : "border-rose-500/60 bg-rose-500/10 text-rose-100"
                    }`}
                  >
                    <p className="font-medium">
                      Annotation validation: {manualAnnotationValidation.ok ? "valid" : "invalid"} (pure integrity check)
                    </p>
                    {manualAnnotationValidation.errors.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {manualAnnotationValidation.errors.map((error, index) => (
                          <li key={`manual-error-${index}`}>• {error}</li>
                        ))}
                      </ul>
                    )}
                    {manualAnnotationValidation.warnings.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-amber-200/90">
                        {manualAnnotationValidation.warnings.map((warning, index) => (
                          <li key={`manual-warning-${index}`}>• {warning}</li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-1 text-slate-400">
                      Integrity-only: warnings never block, and validation has no dependency on solver, FOV, Apply, or
                      candidate solvability.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          title="Constrained Diagnostic Trials — Diagnostic Only"
          open={isManualTrialsOpen}
          onToggle={() => setIsManualTrialsOpen((open) => !open)}
          description="Temporary, operator-evidence-bounded trial quads for solver comparison only. Nothing is selected, applied, or written to calibration state."
          meta={
            <span className="rounded bg-cyan-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-cyan-200">
              lab-only · local · not persisted
            </span>
          }
        >
          <div className="space-y-3 text-[11px] text-slate-300">
            <p className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 px-3 py-2 text-cyan-100/90">
              Baseline candidate is unchanged. Trials are temporary diagnostic records. Nothing is selected, applied,
              or written to calibration state. Trials are constrained by operator-approved seam evidence — this does
              not claim the current corner&apos;s true position is known.
            </p>

            {manualTrialNotice && (
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-200">
                {manualTrialNotice}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleGenerateManualTrials}
                disabled={!manualTrialEligibility.canGenerate}
                className="rounded-lg border border-cyan-500/70 px-3 py-1.5 text-cyan-200 transition enabled:hover:border-cyan-300 enabled:hover:text-cyan-100 disabled:cursor-not-allowed disabled:border-slate-700 disabled:text-slate-500"
              >
                Generate diagnostic trials
              </button>
              <button
                type="button"
                onClick={handleClearManualTrials}
                disabled={!manualTrialSet}
                className="rounded-lg border border-slate-600 px-3 py-1.5 text-slate-200 transition enabled:hover:border-slate-400 disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-600"
              >
                Clear trials
              </button>
            </div>

            {!manualTrialEligibility.canGenerate && manualTrialEligibility.reason && (
              <p className="text-slate-400">Generation unavailable: {manualTrialEligibility.reason}</p>
            )}

            {manualTrialSet && manualTrialView && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-slate-400">
                  <span>
                    Run mode: <span className="text-slate-200">{manualTrialSet.generatedFor.mode}</span>
                  </span>
                  <span>·</span>
                  <span>
                    Authority: <span className="text-slate-200">{manualTrialSet.generatedFor.authorityKind}</span>
                  </span>
                  {manualTrialSet.truncated && (
                    <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-200">
                      sample family truncated to cap
                    </span>
                  )}
                </div>

                {manualTrialSet.notes.length > 0 && (
                  <ul className="space-y-0.5 text-amber-200/90">
                    {manualTrialSet.notes.map((note, index) => (
                      <li key={`trial-note-${index}`}>• {note}</li>
                    ))}
                  </ul>
                )}

                {manualTrialView.baseline && (
                  <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                    <p className="font-medium text-slate-100">Baseline — selected candidate unchanged</p>
                    <p className="mt-1 text-slate-400">
                      pose: {manualTrialView.baseline.solver?.poseAvailable ? "available" : "unavailable"} · CV avg{" "}
                      {formatTrialPx(manualTrialView.baseline.solver?.cv.averagePx)} · CV max{" "}
                      {formatTrialPx(manualTrialView.baseline.solver?.cv.maximumPx)} · rendered avg{" "}
                      {formatTrialPx(manualTrialView.baseline.solver?.rendered.averagePx)}
                    </p>
                    {!manualTrialView.baseline.constraint.canEvaluate && (
                      <p className="mt-1 text-rose-300">
                        Baseline not solver-evaluable: {manualTrialView.baseline.constraint.hardReasons.join("; ")}
                      </p>
                    )}
                  </div>
                )}

                {manualTrialPreview && (
                  <div className="rounded-lg border border-cyan-400/60 bg-cyan-500/10 p-3 text-cyan-100">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">
                        Active preview (temporary, diagnostic-only): {manualTrialPreview.trial.kind} · sample{" "}
                        {manualTrialPreview.trial.generation.sampleIndex}
                      </p>
                      <button
                        type="button"
                        onClick={handleClearTrialPreview}
                        className="rounded border border-cyan-300/70 px-2 py-0.5 text-[10px] text-cyan-100 transition hover:border-cyan-200"
                      >
                        Clear preview
                      </button>
                    </div>
                    <p className="mt-1 text-cyan-200/90">
                      corners [{manualTrialPreview.trial.changedCorners.join(", ")}] · seam{" "}
                      {manualTrialPreview.trial.evidenceRefs.seamId ?? "—"}
                    </p>
                    {manualTrialPreview.trial.sampledCornerMoves.length > 0 ? (
                      <div className="mt-1 space-y-0.5 font-mono text-[10px] text-cyan-200/80">
                        {manualTrialPreview.trial.sampledCornerMoves.map((move) => (
                          <p key={`preview-move-${manualTrialPreview.trial.trialId}-${move.corner}`}>
                            {move.corner} · t={formatTrialExact(move.t)} · img-norm(
                            {formatTrialExact(move.sourceNorm.x)}, {formatTrialExact(move.sourceNorm.y)}) · container(
                            {formatTrialExact(move.containerNorm.x)}, {formatTrialExact(move.containerNorm.y)}) · px(
                            {formatTrialExact(move.sourcePx.x, 1)}, {formatTrialExact(move.sourcePx.y, 1)})
                          </p>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-1 text-cyan-200/70">No corner moved (baseline geometry).</p>
                    )}
                    <p className="mt-1 text-cyan-200/70">
                      Temporary preview only — the baseline/selected candidate is unchanged; nothing is applied,
                      selected, or written to calibration state.
                    </p>
                  </div>
                )}

                {manualTrialView.evaluable.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="font-medium text-slate-200">
                      Evaluable trials ({manualTrialView.evaluable.length}) — generation order, no metric ranking
                    </p>
                    {manualTrialView.evaluable.map((trial) => {
                      const deltaCv =
                        trial.solver?.cv.averagePx != null && manualTrialView.baselineCvAvgPx != null
                          ? trial.solver.cv.averagePx - manualTrialView.baselineCvAvgPx
                          : null;
                      const isPreviewing = previewTrialId === trial.trialId;
                      return (
                        <div
                          key={trial.trialId}
                          className={`rounded-lg border p-2.5 ${
                            isPreviewing
                              ? "border-cyan-400/70 bg-cyan-500/10"
                              : "border-slate-700/70 bg-slate-900/40"
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-slate-100">
                              {trial.kind} · corners [{trial.changedCorners.join(", ")}] · sample{" "}
                              {trial.generation.sampleIndex}
                            </span>
                            <span className="text-emerald-300">evaluable</span>
                          </div>
                          <p className="mt-1 text-slate-400">
                            CV avg {formatTrialPx(trial.solver?.cv.averagePx)} · CV max{" "}
                            {formatTrialPx(trial.solver?.cv.maximumPx)} · rendered avg{" "}
                            {formatTrialPx(trial.solver?.rendered.averagePx)} · Δavg vs baseline{" "}
                            {deltaCv === null
                              ? "—"
                              : `${deltaCv >= 0 ? "+" : ""}${formatNumber(deltaCv)}px`}
                          </p>
                          <p className="mt-0.5 text-slate-500">
                            seam {trial.evidenceRefs.seamId ?? "—"}
                            {trial.generation.sharedDeltaSourcePx != null
                              ? ` · shared Δ ${formatNumber(trial.generation.sharedDeltaSourcePx)}px`
                              : trial.generation.tAlongUsableSpan != null
                                ? ` · t ${formatNumber(trial.generation.tAlongUsableSpan)}`
                                : ""}{" "}
                            · Apply-gate diagnostic:{" "}
                            {trial.solver?.applyGateAvailable ? "available" : "unavailable"} (
                            {trial.solver?.applyGateReason ?? "—"})
                          </p>
                          {trial.sampledCornerMoves.length > 0 ? (
                            <div className="mt-1 space-y-0.5 font-mono text-[10px] text-slate-500">
                              {trial.sampledCornerMoves.map((move) => (
                                <p key={`move-${trial.trialId}-${move.corner}`}>
                                  {move.corner} · t={formatTrialExact(move.t)} · img-norm(
                                  {formatTrialExact(move.sourceNorm.x)}, {formatTrialExact(move.sourceNorm.y)}) · px(
                                  {formatTrialExact(move.sourcePx.x, 1)}, {formatTrialExact(move.sourcePx.y, 1)})
                                </p>
                              ))}
                            </div>
                          ) : (
                            <p className="mt-1 text-slate-600">no corner moved</p>
                          )}
                          {trial.constraint.warnings.length > 0 && (
                            <p className="mt-0.5 text-amber-200/90">
                              warnings: {trial.constraint.warnings.join("; ")}
                            </p>
                          )}
                          <div className="mt-1.5 flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handlePreviewTrial(trial.trialId)}
                              aria-pressed={isPreviewing}
                              className={`rounded border px-2 py-0.5 text-[10px] transition ${
                                isPreviewing
                                  ? "border-cyan-300 bg-cyan-500/20 text-cyan-100"
                                  : "border-cyan-500/60 text-cyan-200 hover:border-cyan-300 hover:text-cyan-100"
                              }`}
                            >
                              {isPreviewing ? "Previewing" : "Preview trial"}
                            </button>
                            {isPreviewing && (
                              <button
                                type="button"
                                onClick={handleClearTrialPreview}
                                className="rounded border border-slate-600 px-2 py-0.5 text-[10px] text-slate-300 transition hover:border-slate-400"
                              >
                                Clear preview
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {manualTrialView.rejected.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="font-medium text-rose-200">
                      Rejected trials ({manualTrialView.rejected.length}) — never passed to the solver
                    </p>
                    {manualTrialView.rejected.map((trial) => (
                      <div
                        key={trial.trialId}
                        className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-2.5 text-rose-100/90"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span>
                            {trial.kind} · corners [{trial.changedCorners.join(", ")}] · sample{" "}
                            {trial.generation.sampleIndex}
                          </span>
                          <span className="text-rose-300">rejected</span>
                        </div>
                        <p className="mt-1">hard reasons: {trial.constraint.hardReasons.join("; ")}</p>
                        {trial.sampledCornerMoves.length > 0 && (
                          <div className="mt-1 space-y-0.5 font-mono text-[10px] text-rose-200/70">
                            {trial.sampledCornerMoves.map((move) => (
                              <p key={`rej-move-${trial.trialId}-${move.corner}`}>
                                {move.corner} · t={formatTrialExact(move.t)} · img-norm(
                                {formatTrialExact(move.sourceNorm.x)}, {formatTrialExact(move.sourceNorm.y)}) ·
                                container({formatTrialExact(move.containerNorm.x)},{" "}
                                {formatTrialExact(move.containerNorm.y)})
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <p className="text-slate-500">
                  Apply-gate values above are diagnostic only and are never used to sort, recommend, select, or apply a
                  trial. No trial may be applied, promoted, or set as the floor.
                </p>
              </div>
            )}
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          title="Type A Support Qualification"
          open={isSupportQualificationOpen}
          onToggle={() => setIsSupportQualificationOpen((open) => !open)}
          description="Read-only support sufficiency and broad-search viability diagnostics for the current Type A annotation and evidence. This does not change movement authority, run diagnostics, choose a seed, switch modes, load controls, or apply calibration."
          meta={
            <span className="rounded bg-slate-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-200">
              lab-only · read-only · not persisted
            </span>
          }
        >
          {(() => {
            const q = supportQualification;
            const f = q.facts;
            const ann = manualAnnotation;
            const cornerLabels: FloorCornerLabel[] = ["NL", "NR", "FR", "FL"];
            const signatureStatus = !q.broadSearchProvenance
              ? "unavailable"
              : f.broadSearchCurrent
                ? "current"
                : f.broadSearchRun
                  ? "stale"
                  : "unavailable";
            return (
              <div className="space-y-3 text-[11px] text-slate-300">
                <p className="rounded-lg border border-slate-600/40 bg-slate-800/40 px-3 py-2 text-slate-200">
                  Diagnostic only. This panel describes support sufficiency for the current Type A annotation and
                  evidence. It does not alter the Type A workflow, switch modes, authorize movement, run diagnostics,
                  choose a seed, load controls, or apply calibration.
                </p>

                {/* A. Support-sufficiency axis (primary verdict) */}
                <div className={`rounded-lg border px-3 py-2 ${SUPPORT_QUALIFICATION_TONES[q.classification]}`}>
                  <p className="text-[10px] uppercase tracking-wide opacity-70">Type A support sufficiency</p>
                  <p className="mt-0.5 text-sm font-medium">{SUPPORT_QUALIFICATION_LABELS[q.classification]}</p>
                  {q.classification === "type_a_exhausted_type_b_candidate" && (
                    <p className="mt-1 text-[11px] text-violet-100/90">
                      Conditional diagnostic handoff candidate. This depends on current completed Type A
                      broad-search coverage and does not switch modes or implement Type B.
                    </p>
                  )}
                </div>

                {/* B. Broad-search viability axis (separate, distinct treatment) */}
                <div
                  className={`rounded-lg border border-dashed px-3 py-2 ${SUPPORT_QUALIFICATION_VIABILITY_TONES[q.broadSearchViability]}`}
                >
                  <p className="text-[10px] uppercase tracking-wide opacity-70">
                    Current Type A broad-search viability
                  </p>
                  <p className="mt-0.5 text-sm font-medium">
                    {SUPPORT_QUALIFICATION_VIABILITY_LABELS[q.broadSearchViability]}
                  </p>
                  <p className="mt-1 text-[11px] opacity-90">
                    {SUPPORT_QUALIFICATION_VIABILITY_NOTES[q.broadSearchViability]}
                  </p>
                  <p className="mt-1 text-[10px] opacity-70">
                    Separate axis from support sufficiency. Broad-search viability never changes the support
                    verdict and never implies a mode switch.
                  </p>
                </div>

                {/* C. Advisory evidence facts (non-routing) */}
                <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                  <p className="font-medium text-slate-100">Advisory evidence facts</p>
                  {q.advisoryEvidenceFacts.length > 0 ? (
                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-slate-300">
                      {q.advisoryEvidenceFacts.map((fact) => (
                        <li key={fact}>{SUPPORT_QUALIFICATION_ADVISORY_LABELS[fact] ?? fact}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-slate-400">No advisory evidence facts currently reported.</p>
                  )}
                  <p className="mt-1 text-[10px] text-slate-500">
                    Advisory facts are visible evidence notes only. They do not change movement authority and
                    do not independently weaken Type A support.
                  </p>
                </div>

                {/* D. Substantive weak-support indicators (drive the support verdict) */}
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                  <p className="font-medium text-amber-100">Substantive weak-support indicators</p>
                  {q.weakSupportIndicators.length > 0 ? (
                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-amber-200/90">
                      {q.weakSupportIndicators.map((indicator) => (
                        <li key={indicator}>{SUPPORT_QUALIFICATION_WEAK_LABELS[indicator] ?? indicator}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-amber-200/70">
                      No substantive weak-support indicators currently reported.
                    </p>
                  )}
                  <p className="mt-1 text-[10px] text-amber-200/70">
                    These substantive support facts never change the declared movement authority. A near-frame
                    endpoint is not listed here; it is advisory evidence only.
                  </p>
                </div>

                {/* E. Ordered classifier reasons */}
                {q.reasons.length > 0 && (
                  <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                    <p className="font-medium text-slate-100">Reasons</p>
                    <p className="mt-0.5 text-[10px] text-slate-500">
                      Ordered classifier output. Lines are prefixed to distinguish support-sufficiency
                      explanation, advisory endpoint-frame facts, broad-search viability, and any conditional
                      handoff explanation.
                    </p>
                    <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-slate-300">
                      {q.reasons.map((reason, index) => (
                        <li key={index}>{reason}</li>
                      ))}
                    </ol>
                  </div>
                )}

                {/* 2. Declared Type A evidence */}
                <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                  <p className="font-medium text-slate-100">Declared Type A evidence (read-only)</p>
                  <div className="mt-1 grid grid-cols-1 gap-x-4 gap-y-0.5 text-slate-400 sm:grid-cols-2">
                    <span>
                      annotation: <span className="text-slate-200">{f.annotationValid ? "valid" : "invalid / not evaluated"}</span>
                    </span>
                    <span>
                      authority mode: <span className="text-slate-200">{ann?.mode ?? "—"}</span>
                    </span>
                    <span>
                      movable corner: <span className="text-slate-200">{f.movableCorner ?? "—"}</span>
                    </span>
                    <span>
                      movable seam id: <span className="text-slate-200">{f.movableSeamId ?? "—"}</span>
                    </span>
                    <span>
                      determining seam id: <span className="text-slate-200">{f.determiningSeamId ?? "—"}</span>
                    </span>
                    <span>
                      authority kind: <span className="text-slate-200">{ann?.adjustmentAuthority?.kind ?? "—"}</span>
                    </span>
                  </div>
                  {ann && (
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-slate-400">
                      {cornerLabels.map((corner) => (
                        <span key={corner}>
                          {corner}: <span className="text-slate-200">{ann.cornerSupport?.[corner]?.state ?? "—"}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* 3. Seam-support geometry facts */}
                <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                  <p className="font-medium text-slate-100">Seam-support geometry</p>
                  <div className="mt-1 grid grid-cols-1 gap-x-4 gap-y-0.5 text-slate-400 sm:grid-cols-2">
                    <span>
                      Movable-side span: <span className="text-slate-200">{formatQualPx(f.movableSideSpanSourcePx)}</span>
                    </span>
                    <span>
                      Determining-side span:{" "}
                      <span className="text-slate-200">{formatQualPx(f.determiningSideSpanSourcePx)}</span>
                    </span>
                    <span>
                      Rear-seam span: <span className="text-slate-200">{formatQualPx(f.rearSeamSpanSourcePx)}</span>
                    </span>
                    <span>
                      Determining / movable ratio:{" "}
                      <span className="text-slate-200">{formatQualRatio(f.spanRatioDeterminingToMovable)}</span>
                    </span>
                    <span>
                      Image diagonal: <span className="text-slate-200">{formatQualPx(f.imageDiagonalSourcePx)}</span>
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] text-slate-500">
                    Spans are measured source-pixel evidence facts. Measured span never creates or changes movement
                    authority.
                  </p>
                </div>

                {/* 4. Frame-edge evidence */}
                <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                  <p className="font-medium text-slate-100">Frame-edge evidence</p>
                  <div className="mt-1 grid grid-cols-1 gap-x-4 gap-y-0.5 text-slate-400 sm:grid-cols-2">
                    <span>
                      Endpoint A nearest frame-edge distance:{" "}
                      <span className="text-slate-200">
                        {formatQualPx(f.determiningEndpointMinEdgeDistanceSourcePx?.[0])}
                      </span>
                    </span>
                    <span>
                      Endpoint B nearest frame-edge distance:{" "}
                      <span className="text-slate-200">
                        {formatQualPx(f.determiningEndpointMinEdgeDistanceSourcePx?.[1])}
                      </span>
                    </span>
                    <span>
                      Endpoint A near frame:{" "}
                      <span className="text-slate-200">{formatQualBool(f.determiningEndpointNearFrame?.[0])}</span>
                    </span>
                    <span>
                      Endpoint B near frame:{" "}
                      <span className="text-slate-200">{formatQualBool(f.determiningEndpointNearFrame?.[1])}</span>
                    </span>
                    <span>
                      Determining seam frame-edge collapsed:{" "}
                      <span className="text-slate-200">{formatQualBool(f.determiningSeamFrameEdgeCollapsed)}</span>
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] text-slate-500">
                    A near-frame endpoint is advisory evidence only. Frame-edge collapse requires a short/weak
                    determining span together with near-frame support loss. Frame-edge facts never change the
                    declared movement authority.
                  </p>
                </div>

                {/* 5. Threshold provenance */}
                <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                  <p className="font-medium text-slate-100">Active thresholds</p>
                  <div className="mt-1 grid grid-cols-1 gap-x-4 gap-y-0.5 text-slate-400 sm:grid-cols-2">
                    <span>
                      Minimum usable determining span:{" "}
                      <span className="text-slate-200">{q.thresholdsUsed.minUsableDeterminingSpanPx} px</span>
                    </span>
                    <span>
                      Weak determining span:{" "}
                      <span className="text-slate-200">{q.thresholdsUsed.weakDeterminingSpanPx} px</span>
                    </span>
                    <span>
                      Weak determining / image-diagonal ratio:{" "}
                      <span className="text-slate-200">{q.thresholdsUsed.weakDeterminingSpanImageDiagonalRatio}</span>
                    </span>
                    <span>
                      Frame-edge margin ratio:{" "}
                      <span className="text-slate-200">{q.thresholdsUsed.frameEdgeMarginRatio}</span>
                    </span>
                    <span>
                      Weak determining-to-movable ratio:{" "}
                      <span className="text-slate-200">{q.thresholdsUsed.weakDeterminingToMovableSpanRatio}</span>
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] text-slate-500">
                    These are lab-only, adjustable diagnostic thresholds, not final physical truth.
                  </p>
                </div>

                {/* 6. Broad-search / exhaustion facts */}
                <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                  <p className="font-medium text-slate-100">Broad-search &amp; exhaustion facts</p>
                  <p className="mt-0.5 text-[10px] text-slate-500">
                    Underlying evidence for the “Current Type A broad-search viability” axis above. A stale,
                    absent, truncated, incomplete, or unknown-seed result reads as viability unknown/not-run and
                    never implies exhaustion or a Type B handoff.
                  </p>
                  {!f.broadSearchRun ? (
                    <p className="mt-1 text-slate-400">
                      No Type A broad coupled-search result set is present for the current evidence. Absent broad
                      diagnostics are not treated as a failed Type A.
                    </p>
                  ) : (
                    <>
                      <div className="mt-1 grid grid-cols-1 gap-x-4 gap-y-0.5 text-slate-400 sm:grid-cols-2">
                        <span>
                          broad search run: <span className="text-slate-200">{formatQualBool(f.broadSearchRun)}</span>
                        </span>
                        <span>
                          broad search current:{" "}
                          <span className="text-slate-200">{formatQualBool(f.broadSearchCurrent)}</span>
                        </span>
                        <span>
                          broad search complete:{" "}
                          <span className="text-slate-200">{formatQualBool(f.broadSearchComplete)}</span>
                        </span>
                        <span>
                          broad search truncated:{" "}
                          <span className="text-slate-200">{formatQualBool(f.broadSearchTruncated)}</span>
                        </span>
                        <span>
                          tuple count: <span className="text-slate-200">{f.broadSearchTupleCount ?? "—"}</span>
                        </span>
                        <span>
                          any high-confidence corridor:{" "}
                          <span className="text-slate-200">{formatQualBool(f.anyTupleHasHighConfidenceCorridor)}</span>
                        </span>
                        <span>
                          eligible local seed exists:{" "}
                          <span className="text-slate-200">{formatQualBool(f.eligibleLocalSeedExists)}</span>
                        </span>
                      </div>
                      {f.broadSearchStateCounts && (
                        <div className="mt-1 grid grid-cols-1 gap-x-4 gap-y-0.5 text-slate-400 sm:grid-cols-2">
                          <span>
                            invalid geometry:{" "}
                            <span className="text-slate-200">{f.broadSearchStateCounts.invalid_geometry}</span>
                          </span>
                          <span>
                            no pose: <span className="text-slate-200">{f.broadSearchStateCounts.no_pose}</span>
                          </span>
                          <span>
                            pose poor: <span className="text-slate-200">{f.broadSearchStateCounts.pose_poor}</span>
                          </span>
                          <span>
                            high-confidence not Apply-safe:{" "}
                            <span className="text-slate-200">
                              {f.broadSearchStateCounts.high_confidence_not_apply_safe}
                            </span>
                          </span>
                          <span>
                            Apply-safe diagnostic:{" "}
                            <span className="text-slate-200">{f.broadSearchStateCounts.apply_safe_diagnostic}</span>
                          </span>
                        </div>
                      )}
                    </>
                  )}

                  {q.exhaustion && (
                    <div className="mt-2 border-t border-slate-700/70 pt-2">
                      <p className="text-slate-300">Exhaustion (no-usable-basin) assessment</p>
                      <div className="mt-1 grid grid-cols-1 gap-x-4 gap-y-0.5 text-slate-400 sm:grid-cols-2">
                        <span>
                          no usable basin:{" "}
                          <span className="text-slate-200">{formatQualBool(q.exhaustion.noUsableBasin)}</span>
                        </span>
                        <span>
                          exhaustion eligible:{" "}
                          <span className="text-slate-200">{formatQualBool(q.exhaustion.eligible)}</span>
                        </span>
                      </div>
                      {q.exhaustion.missing.length > 0 && (
                        <p className="mt-1 text-slate-400">
                          unmet requirements:{" "}
                          <span className="text-slate-200">{q.exhaustion.missing.join(", ")}</span>
                        </p>
                      )}
                    </div>
                  )}

                  {q.broadSearchProvenance && (
                    <div className="mt-2 border-t border-slate-700/70 pt-2">
                      <p className="text-slate-300">Coverage provenance</p>
                      <div className="mt-1 grid grid-cols-1 gap-x-4 gap-y-0.5 text-slate-400 sm:grid-cols-2">
                        <span>
                          evidence signature: <span className="text-slate-200">{signatureStatus}</span>
                        </span>
                        <span>
                          tuple count: <span className="text-slate-200">{q.broadSearchProvenance.tupleCount ?? "—"}</span>
                        </span>
                        <span>
                          truncated: <span className="text-slate-200">{formatQualBool(q.broadSearchProvenance.truncated)}</span>
                        </span>
                        {q.broadSearchProvenance.configSummary && (
                          <>
                            <span>
                              tNear sample count:{" "}
                              <span className="text-slate-200">
                                {q.broadSearchProvenance.configSummary.tNearSampleCount ?? "—"}
                              </span>
                            </span>
                            <span>
                              aspect-ratio count:{" "}
                              <span className="text-slate-200">
                                {q.broadSearchProvenance.configSummary.aspectRatioCount ?? "—"}
                              </span>
                            </span>
                            <span>
                              max evaluations:{" "}
                              <span className="text-slate-200">
                                {q.broadSearchProvenance.configSummary.maxEvaluations ?? "—"}
                              </span>
                            </span>
                          </>
                        )}
                      </div>
                      <p className="mt-1 text-[10px] text-slate-500">
                        Current coverage only. A future Type A search envelope could produce a different outcome.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </CollapsibleSection>

        <CollapsibleSection
          title="Type A Coupled Diagnostic Search"
          open={isCoupledSearchOpen}
          onToggle={() => setIsCoupledSearchOpen((open) => !open)}
          description="Diagnostic-only bounded search over approved near-corner position, floor aspect ratio, and solver FOV corridors. Does not change the candidate, FOV, dimensions, or calibration."
          meta={
            <span className="rounded bg-cyan-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-cyan-200">
              lab-only · local · not persisted
            </span>
          }
        >
          <div className="space-y-3 text-[11px] text-slate-300">
            <p className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 px-3 py-2 text-cyan-100/90">
              Read-only diagnostics. Width/depth are diagnostic solver inputs (not actual room measurements);
              aspectRatio = depth / width. Nothing here is previewed, selected, applied, promoted, ranked, or written to
              calibration state.
            </p>

            {coupledSearchNotice && (
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-200">
                {coupledSearchNotice}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleRunCoupledSearch}
                disabled={!coupledSearchEligibility.canRun}
                className="rounded-lg border border-cyan-500/70 px-3 py-1.5 text-cyan-200 transition enabled:hover:border-cyan-300 enabled:hover:text-cyan-100 disabled:cursor-not-allowed disabled:border-slate-700 disabled:text-slate-500"
              >
                Run Type A coupled diagnostics
              </button>
              <button
                type="button"
                onClick={handleClearCoupledSearch}
                disabled={!coupledSearchResultSet}
                className="rounded-lg border border-slate-600 px-3 py-1.5 text-slate-200 transition enabled:hover:border-slate-400 disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-600"
              >
                Clear coupled diagnostics
              </button>
            </div>

            {!coupledSearchEligibility.canRun && coupledSearchEligibility.reason && (
              <p className="text-slate-400">Unavailable: {coupledSearchEligibility.reason}</p>
            )}

            {coupledSearchResultSet && coupledSearchView && coupledSearchSnapshot && (
              <div className="space-y-2">
                <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                  <p className="font-medium text-slate-100">Run snapshot</p>
                  <div className="mt-1 grid grid-cols-1 gap-x-4 gap-y-0.5 text-slate-400 sm:grid-cols-2">
                    <span>
                      movable corner: <span className="text-slate-200">{coupledSearchSnapshot.movableCorner}</span>
                    </span>
                    <span>
                      approved seam: <span className="text-slate-200">{coupledSearchSnapshot.approvedSeamId}</span>
                    </span>
                    <span>
                      determining seam:{" "}
                      <span className="text-slate-200">
                        {coupledSearchSnapshot.determiningEdgeSeamId} ({coupledSearchSnapshot.determiningEdgeRole})
                      </span>
                    </span>
                    <span>
                      fixed width (diagnostic):{" "}
                      <span className="text-slate-200">{formatNumber(coupledSearchSnapshot.fixedWorldWidth)}</span>
                    </span>
                    <span>
                      probe FOV: <span className="text-slate-200">{formatNumber(coupledSearchSnapshot.probeFovDeg)}°</span>
                    </span>
                    <span>
                      live aspect (source identity):{" "}
                      <span className="text-slate-200">{formatTrialExact(coupledSearchSnapshot.liveAspectRatio)}</span>
                    </span>
                    <span>
                      tuples: <span className="text-slate-200">{coupledSearchView.total}</span>
                    </span>
                    {coupledSearchResultSet.truncated && (
                      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-200">
                        truncated to evaluation cap
                      </span>
                    )}
                  </div>
                  {coupledSearchResultSet.notes.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-amber-200/90">
                      {coupledSearchResultSet.notes.map((note, index) => (
                        <li key={`coupled-note-${index}`}>• {note}</li>
                      ))}
                    </ul>
                  )}
                </div>

                {coupledSearchPreview && (
                  <div className="rounded-lg border border-violet-500/40 bg-violet-500/5 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium text-violet-100">
                        Active coupled preview (temporary diagnostic geometry)
                      </p>
                      <button
                        type="button"
                        onClick={handleClearCoupledPreview}
                        className="rounded border border-slate-600 px-2 py-0.5 text-slate-300 transition hover:border-slate-400 hover:text-slate-100"
                      >
                        Clear preview
                      </button>
                    </div>
                    <p className="mt-1 text-violet-200/80">
                      All values below are result-record diagnostics from the stored coupled-search result, not live
                      calibration values.
                    </p>
                    <div className="mt-1.5 grid grid-cols-1 gap-x-4 gap-y-0.5 text-slate-400 sm:grid-cols-2">
                      <span>
                        state:{" "}
                        <span className={describeCoupledState(coupledSearchPreview.trial.state).tone}>
                          {describeCoupledState(coupledSearchPreview.trial.state).label}
                        </span>
                      </span>
                      <span>
                        movable corner:{" "}
                        <span className="text-slate-200">{coupledSearchPreview.trial.movableCorner}</span>
                      </span>
                      <span>
                        approved seam: <span className="text-slate-200">{coupledSearchPreview.trial.seamId}</span>
                      </span>
                      <span>
                        exact tNear:{" "}
                        <span className="text-slate-200">{formatTrialExact(coupledSearchPreview.trial.tuple.tNear)}</span>
                      </span>
                      <span>
                        aspect ratio:{" "}
                        <span className="text-slate-200">
                          {formatTrialExact(coupledSearchPreview.trial.tuple.aspectRatio)}
                        </span>
                      </span>
                      <span>
                        fixed width (diagnostic):{" "}
                        <span className="text-slate-200">{formatNumber(coupledSearchPreview.trial.worldWidth)}</span>
                      </span>
                      <span>
                        derived depth (diagnostic):{" "}
                        <span className="text-slate-200">{formatNumber(coupledSearchPreview.trial.worldDepth)}</span>
                      </span>
                      <span>
                        probe FOV:{" "}
                        <span className="text-slate-200">
                          {coupledSearchPreview.trial.tuple.fovDeg === null
                            ? "—"
                            : `${formatNumber(coupledSearchPreview.trial.tuple.fovDeg)}°`}
                        </span>
                      </span>
                      <span>
                        valid FOV corridor:{" "}
                        <span className="text-slate-200">
                          {formatFovCorridor(coupledSearchPreview.trial.fovCorridors?.valid)}
                        </span>
                      </span>
                      <span>
                        high-confidence FOV corridor:{" "}
                        <span className="text-slate-200">
                          {formatFovCorridor(coupledSearchPreview.trial.fovCorridors?.highConfidence)}
                        </span>
                      </span>
                      <span>
                        pose:{" "}
                        <span className="text-slate-200">
                          {coupledSearchPreview.trial.solver
                            ? coupledSearchPreview.trial.solver.poseAvailable
                              ? "available"
                              : "unavailable"
                            : "—"}
                        </span>
                      </span>
                      <span>
                        confidence:{" "}
                        <span className="text-slate-200">{coupledSearchPreview.trial.solver?.confidence ?? "—"}</span>
                      </span>
                      <span>
                        Apply-gate diagnostic:{" "}
                        <span className="text-slate-200">
                          {coupledSearchPreview.trial.solver
                            ? `${
                                coupledSearchPreview.trial.solver.applyGateAvailable ? "available" : "unavailable"
                              } (${coupledSearchPreview.trial.solver.applyGateReason})`
                            : "—"}
                        </span>
                      </span>
                    </div>
                    <p className="mt-1.5 text-slate-500">
                      Drawn from exact stored geometry (quadNorm + sampledCornerMoves). The baseline candidate and floor
                      overlay remain unchanged beneath this temporary overlay. Preview is geometry inspection only — not a
                      selection, recommendation, or apply.
                    </p>
                  </div>
                )}

                {coupledSearchView.groups.map((group) => {
                  if (group.trials.length === 0) return null;
                  const meta = describeCoupledState(group.state);
                  const collapsedByDefault = group.state === "no_pose" || group.state === "invalid_geometry";
                  const rows = group.trials.map((trial) => {
                    const rowMeta = describeCoupledState(trial.state);
                    const previewable = isCoupledTrialPreviewable(trial);
                    const isPreviewing = coupledSearchPreviewTrialId === trial.trialId;
                    const rowSeed = coupledRowSeedEligibility(trial);
                    return (
                      <div
                        key={trial.trialId}
                        className={`rounded-lg border p-2.5 ${meta.heading}`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-slate-100">
                            {trial.movableCorner} · seam {trial.seamId} · tNear{" "}
                            {formatTrialExact(trial.tuple.tNear)} · aspect {formatTrialExact(trial.tuple.aspectRatio)}
                          </span>
                          <span className={rowMeta.tone}>{rowMeta.label}</span>
                        </div>
                        <p className="mt-1 text-slate-400">
                          width {formatNumber(trial.worldWidth)} · depth {formatNumber(trial.worldDepth)} · probe FOV{" "}
                          {trial.tuple.fovDeg === null ? "—" : `${formatNumber(trial.tuple.fovDeg)}°`} · pose{" "}
                          {trial.solver ? (trial.solver.poseAvailable ? "available" : "unavailable") : "—"} · confidence{" "}
                          {trial.solver?.confidence ?? "—"}
                        </p>
                        <p className="mt-0.5 text-slate-500">
                          valid FOV corridor: {formatFovCorridor(trial.fovCorridors?.valid)} · high-confidence FOV
                          corridor: {formatFovCorridor(trial.fovCorridors?.highConfidence)}
                        </p>
                        {trial.solver && (
                          <p className="mt-0.5 text-slate-500">
                            CV avg {formatTrialPx(trial.solver.cv.averagePx)} · CV max{" "}
                            {formatTrialPx(trial.solver.cv.maximumPx)} · rendered avg{" "}
                            {formatTrialPx(trial.solver.rendered.averagePx)} · rendered max{" "}
                            {formatTrialPx(trial.solver.rendered.maximumPx)} · Apply-gate diagnostic:{" "}
                            {trial.solver.applyGateAvailable ? "available" : "unavailable"} (
                            {trial.solver.applyGateReason})
                          </p>
                        )}
                        {!trial.constraint.canEvaluate && trial.constraint.hardReasons.length > 0 && (
                          <p className="mt-0.5 text-rose-300">
                            geometry rejection: {trial.constraint.hardReasons.join("; ")}
                          </p>
                        )}
                        {trial.constraint.warnings.length > 0 && (
                          <p className="mt-0.5 text-amber-200/90">warnings: {trial.constraint.warnings.join("; ")}</p>
                        )}
                        {previewable ? (
                          <div className="mt-2 space-y-1.5">
                            <div className="flex flex-wrap items-center gap-2">
                              {isPreviewing ? (
                                <>
                                  <span className="rounded border border-violet-400/60 bg-violet-500/10 px-2 py-0.5 text-violet-200">
                                    Previewing (temporary)
                                  </span>
                                  <button
                                    type="button"
                                    onClick={handleClearCoupledPreview}
                                    className="rounded border border-slate-600 px-2 py-0.5 text-slate-300 transition hover:border-slate-400 hover:text-slate-100"
                                  >
                                    Clear preview
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handlePreviewCoupledTrial(trial.trialId)}
                                  className="rounded border border-violet-500/60 px-2 py-0.5 text-violet-200 transition hover:border-violet-300 hover:text-violet-100"
                                >
                                  Preview tuple
                                </button>
                              )}
                              <span className="text-slate-500">Exact stored geometry · temporary diagnostic preview</span>
                            </div>
                            {rowSeed.canSeed ? (
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleRunLocalRefinement(trial)}
                                  className="rounded border border-teal-500/60 px-2 py-0.5 text-teal-200 transition hover:border-teal-300 hover:text-teal-100"
                                >
                                  Refine around this tuple
                                </button>
                                <span className="text-slate-500">
                                  Seeds a bounded local diagnostic search (provenance only)
                                </span>
                              </div>
                            ) : (
                              <p className="text-slate-600">Local refinement unavailable — {rowSeed.reason}.</p>
                            )}
                          </div>
                        ) : (
                          <p className="mt-2 text-slate-600">
                            Preview unavailable — exact quad is not in-frame for drawing.
                          </p>
                        )}
                      </div>
                    );
                  });
                  return (
                    <div key={`coupled-group-${group.state}`} className="space-y-1.5">
                      {collapsedByDefault ? (
                        <details>
                          <summary className={`cursor-pointer font-medium ${meta.tone}`}>
                            {meta.label} ({group.trials.length}) — generation order, no ranking
                          </summary>
                          <div className="mt-1.5 space-y-1.5">{rows}</div>
                        </details>
                      ) : (
                        <>
                          <p className={`font-medium ${meta.tone}`}>
                            {meta.label} ({group.trials.length}) — generation order, no ranking
                          </p>
                          {rows}
                        </>
                      )}
                    </div>
                  );
                })}

                <p className="text-slate-500">
                  States are truthful classifications, not rankings. Apply-gate, FOV corridor, and confidence values are
                  diagnostic only and are never used to recommend, select, or apply a tuple. No tuple may be previewed,
                  selected, promoted, or applied.
                </p>
              </div>
            )}
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          title="Type A Local Refinement Diagnostics"
          open={isLocalRefinementOpen}
          onToggle={() => setIsLocalRefinementOpen((open) => !open)}
          description="Explicitly seeded, bounded local diagnostic search around one coarse tuple. Refines approved near-corner position, diagnostic aspect ratio, and direct FOV probes. Does not alter the candidate, FOV, dimensions, calibration, or scene state."
          meta={
            <span className="rounded bg-teal-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-teal-200">
              lab-only · local · not persisted
            </span>
          }
        >
          <div className="space-y-3 text-[11px] text-slate-300">
            <p className="rounded-lg border border-teal-500/30 bg-teal-500/5 px-3 py-2 text-teal-100/90">
              Read-only diagnostics. Seeded ONLY by an explicit “Refine around this tuple” action on a coarse
              coupled-search row (no auto-seed, no “best tuple”). Width/depth are diagnostic solver inputs (not actual
              room measurements); aspectRatio = depth / width. Nothing here is previewed, selected, applied, promoted,
              ranked, or written to calibration state.
            </p>

            {localRefinementNotice && (
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-200">
                {localRefinementNotice}
              </p>
            )}

            {localTupleLoadReceipt && (
              <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-emerald-100/90">
                <p className="font-medium text-emerald-100">
                  Exact local diagnostic tuple loaded into live controls. Calibration has not been applied.
                </p>
                <div className="mt-1 grid grid-cols-1 gap-x-4 gap-y-0.5 text-slate-400 sm:grid-cols-2">
                  <span>
                    width: <span className="text-slate-200">{formatNumber(localTupleLoadReceipt.width)}</span>
                  </span>
                  <span>
                    depth: <span className="text-slate-200">{formatNumber(localTupleLoadReceipt.depth)}</span>
                  </span>
                  <span>
                    FOV: <span className="text-slate-200">{formatNumber(localTupleLoadReceipt.fovDeg)}°</span>
                  </span>
                  <span>
                    local tNear:{" "}
                    <span className="text-slate-200">{formatTrialExact(localTupleLoadReceipt.tNear)}</span>
                  </span>
                  <span>
                    aspect ratio:{" "}
                    <span className="text-slate-200">{formatTrialExact(localTupleLoadReceipt.aspectRatio)}</span>
                  </span>
                  <span>
                    direct probe state:{" "}
                    <span className={describeCoupledState(localTupleLoadReceipt.probeState).tone}>
                      {describeCoupledState(localTupleLoadReceipt.probeState).label}
                    </span>
                  </span>
                </div>
                <p className="mt-1 text-slate-500">
                  Informational only — not persisted and not a source of calibration authority. Inspect Calibration
                  readiness and click the existing Apply calibration control to activate. This receipt clears on the
                  next live-control or evidence change.
                </p>
              </div>
            )}

            {!coupledSearchResultSet ? (
              <p className="text-slate-400">
                No coarse coupled-search result set. Run Type A coupled diagnostics, then choose a coarse tuple to refine.
              </p>
            ) : !localRefinementView ? (
              <p className="text-slate-400">
                No eligible seed selected. Use “Refine around this tuple” on an eligible coarse row (valid in-frame
                geometry with a high-confidence FOV corridor) above.
              </p>
            ) : null}

            {localRefinementResultSet && localRefinementView && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-slate-100">Local refinement ready (seeded provenance)</p>
                  <button
                    type="button"
                    onClick={handleClearLocalRefinement}
                    className="rounded border border-slate-600 px-2 py-0.5 text-slate-300 transition hover:border-slate-400 hover:text-slate-100"
                  >
                    Clear local refinement
                  </button>
                </div>

                <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                  <p className="font-medium text-slate-100">Seed snapshot (exact stored coarse provenance)</p>
                  <div className="mt-1 grid grid-cols-1 gap-x-4 gap-y-0.5 text-slate-400 sm:grid-cols-2">
                    <span>
                      movable corner:{" "}
                      <span className="text-slate-200">{localRefinementResultSet.seed.movableCorner}</span>
                    </span>
                    <span>
                      approved seam: <span className="text-slate-200">{localRefinementResultSet.seed.seamId}</span>
                    </span>
                    <span>
                      determining seam:{" "}
                      <span className="text-slate-200">
                        {localRefinementResultSet.seed.determiningEdge
                          ? `${localRefinementResultSet.seed.determiningEdge.seamId} (${localRefinementResultSet.seed.determiningEdge.role})`
                          : "—"}
                      </span>
                    </span>
                    <span>
                      source candidate:{" "}
                      <span className="text-slate-200">{localRefinementResultSet.seed.sourceCandidateId}</span>
                    </span>
                    <span>
                      seed tNear:{" "}
                      <span className="text-slate-200">
                        {formatTrialExact(localRefinementResultSet.seed.coarseTuple.tNear)}
                      </span>
                    </span>
                    <span>
                      seed aspect ratio:{" "}
                      <span className="text-slate-200">
                        {formatTrialExact(localRefinementResultSet.seed.coarseTuple.aspectRatio)}
                      </span>
                    </span>
                    <span>
                      seed fixed width:{" "}
                      <span className="text-slate-200">
                        {formatNumber(localRefinementResultSet.seed.coarseTuple.fixedWorldWidth)}
                      </span>
                    </span>
                    <span>
                      seed derived depth:{" "}
                      <span className="text-slate-200">
                        {formatNumber(localRefinementResultSet.seed.coarseTuple.worldDepth)}
                      </span>
                    </span>
                    <span>
                      seed probe FOV:{" "}
                      <span className="text-slate-200">
                        {formatNumber(localRefinementResultSet.seed.coarseTuple.probeFovDeg)}°
                      </span>
                    </span>
                    <span>
                      seed valid FOV corridor:{" "}
                      <span className="text-slate-200">
                        {formatFovCorridor(localRefinementResultSet.seed.coarseTuple.coarseFovCorridors?.valid)}
                      </span>
                    </span>
                    <span>
                      seed high-confidence FOV corridor:{" "}
                      <span className="text-slate-200">
                        {formatFovCorridor(
                          localRefinementResultSet.seed.coarseTuple.coarseFovCorridors?.highConfidence
                        )}
                      </span>
                    </span>
                  </div>
                  <div className="mt-1.5 grid grid-cols-1 gap-x-4 gap-y-0.5 text-slate-500 sm:grid-cols-2">
                    <span>
                      t offsets:{" "}
                      <span className="text-slate-300">[{localRefinementResultSet.config.tNearOffsets.join(", ")}]</span>
                    </span>
                    <span>
                      aspect-ratio range:{" "}
                      <span className="text-slate-300">
                        {localRefinementResultSet.config.aspectRatios[0]} –{" "}
                        {
                          localRefinementResultSet.config.aspectRatios[
                            localRefinementResultSet.config.aspectRatios.length - 1
                          ]
                        }{" "}
                        ({localRefinementResultSet.config.aspectRatios.length})
                      </span>
                    </span>
                    <span>
                      FOV probe range:{" "}
                      <span className="text-slate-300">
                        {localRefinementResultSet.config.fovProbesDeg[0]}° –{" "}
                        {
                          localRefinementResultSet.config.fovProbesDeg[
                            localRefinementResultSet.config.fovProbesDeg.length - 1
                          ]
                        }
                        ° ({localRefinementResultSet.config.fovProbesDeg.length})
                      </span>
                    </span>
                    <span>
                      geometry tuples: <span className="text-slate-300">{localRefinementView.total}</span>
                    </span>
                    <span>
                      direct probes evaluated:{" "}
                      <span className="text-slate-300">{localRefinementResultSet.probeEvaluationCount}</span>
                      {localRefinementResultSet.truncatedProbes && (
                        <span className="ml-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-200">
                          truncated at probe cap
                        </span>
                      )}
                    </span>
                  </div>
                  {localRefinementResultSet.notes.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-amber-200/90">
                      {localRefinementResultSet.notes.map((note, index) => (
                        <li key={`localref-note-${index}`}>• {note}</li>
                      ))}
                    </ul>
                  )}
                </div>

                {localRefinementPreview && (
                  <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-3 text-rose-100/90">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium text-rose-100">
                        Active local refinement preview (temporary diagnostic geometry)
                      </p>
                      <button
                        type="button"
                        onClick={handleClearLocalPreview}
                        className="rounded border border-slate-600 px-2 py-0.5 text-slate-300 transition hover:border-slate-400 hover:text-slate-100"
                      >
                        Clear preview
                      </button>
                    </div>
                    <p className="mt-1 text-rose-200/80">
                      All values below are exact stored local-result and direct-probe diagnostics. They are not live
                      candidate, FOV, floor-dimension, or calibration values.
                    </p>
                    <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-0.5 text-slate-400 sm:grid-cols-2">
                      <span>
                        geometry state:{" "}
                        <span className={describeCoupledState(localRefinementPreview.tuple.state).tone}>
                          {describeCoupledState(localRefinementPreview.tuple.state).label}
                        </span>
                      </span>
                      <span>
                        probe state:{" "}
                        <span className={describeCoupledState(localRefinementPreview.probe.state).tone}>
                          {describeCoupledState(localRefinementPreview.probe.state).label}
                        </span>
                      </span>
                      <span>
                        movable corner:{" "}
                        <span className="text-slate-200">{localRefinementPreview.tuple.movableCorner}</span>
                      </span>
                      <span>
                        approved seam: <span className="text-slate-200">{localRefinementPreview.tuple.seamId}</span>
                      </span>
                      <span>
                        determining seam:{" "}
                        <span className="text-slate-200">
                          {localRefinementResultSet.seed.determiningEdge
                            ? `${localRefinementResultSet.seed.determiningEdge.seamId} (${localRefinementResultSet.seed.determiningEdge.role})`
                            : "—"}
                        </span>
                      </span>
                      <span>
                        source candidate:{" "}
                        <span className="text-slate-200">{localRefinementPreview.tuple.sourceCandidateId}</span>
                      </span>
                      <span>
                        local tNear:{" "}
                        <span className="text-slate-200">{formatTrialExact(localRefinementPreview.tuple.tNear)}</span>
                      </span>
                      <span>
                        local aspect ratio:{" "}
                        <span className="text-slate-200">
                          {formatTrialExact(localRefinementPreview.tuple.aspectRatio)}
                        </span>
                      </span>
                      <span>
                        fixed width (diagnostic):{" "}
                        <span className="text-slate-200">{formatNumber(localRefinementPreview.tuple.worldWidth)}</span>
                      </span>
                      <span>
                        derived depth (diagnostic):{" "}
                        <span className="text-slate-200">{formatNumber(localRefinementPreview.tuple.worldDepth)}</span>
                      </span>
                      <span>
                        selected direct probe FOV:{" "}
                        <span className="text-slate-200">{formatNumber(localRefinementPreview.probe.fovDeg)}°</span>
                      </span>
                      <span>
                        parent valid FOV corridor:{" "}
                        <span className="text-slate-200">
                          {formatFovCorridor(localRefinementPreview.tuple.fovCorridors?.valid)}
                        </span>
                      </span>
                      <span>
                        parent high-confidence FOV corridor:{" "}
                        <span className="text-slate-200">
                          {formatFovCorridor(localRefinementPreview.tuple.fovCorridors?.highConfidence)}
                        </span>
                      </span>
                      <span>
                        probe pose:{" "}
                        <span className="text-slate-200">
                          {localRefinementPreview.probe.poseAvailable ? "available" : "unavailable"}
                        </span>
                      </span>
                      <span>
                        probe confidence:{" "}
                        <span className="text-slate-200">{localRefinementPreview.probe.confidence ?? "—"}</span>
                      </span>
                      <span>
                        probe CV avg / max:{" "}
                        <span className="text-slate-200">
                          {formatTrialPx(localRefinementPreview.probe.cv.averagePx)} /{" "}
                          {formatTrialPx(localRefinementPreview.probe.cv.maximumPx)}
                        </span>
                      </span>
                      <span>
                        probe rendered avg / max:{" "}
                        <span className="text-slate-200">
                          {formatTrialPx(localRefinementPreview.probe.rendered.averagePx)} /{" "}
                          {formatTrialPx(localRefinementPreview.probe.rendered.maximumPx)}
                        </span>
                      </span>
                      <span>
                        probe Apply-gate:{" "}
                        <span className="text-slate-200">
                          {localRefinementPreview.probe.applyGateAvailable ? "available" : "unavailable"}
                          {localRefinementPreview.probe.applyGateReason
                            ? ` (${localRefinementPreview.probe.applyGateReason})`
                            : ""}
                        </span>
                      </span>
                    </div>
                    {!localRefinementPreview.tuple.constraint.canEvaluate &&
                      localRefinementPreview.tuple.constraint.hardReasons.length > 0 && (
                        <p className="mt-1 text-rose-300">
                          geometry rejection: {localRefinementPreview.tuple.constraint.hardReasons.join("; ")}
                        </p>
                      )}
                    {localRefinementPreview.tuple.constraint.warnings.length > 0 && (
                      <p className="mt-1 text-amber-200/90">
                        warnings: {localRefinementPreview.tuple.constraint.warnings.join("; ")}
                      </p>
                    )}
                    <p className="mt-1.5 text-slate-500">
                      Drawn from exact stored local geometry. Preview is temporary; the baseline candidate and floor
                      overlay remain unchanged. No live FOV, dimensions, candidate, calibration, or scene state changes —
                      geometry inspection only. This is not a recommendation, selection, or apply.
                    </p>
                  </div>
                )}

                {localRefinementView.groups.map((group) => {
                  if (group.tuples.length === 0) return null;
                  const meta = describeCoupledState(group.state);
                  const collapsedByDefault = group.state === "no_pose" || group.state === "invalid_geometry";
                  const rows = group.tuples.map((tuple) => {
                    const rowMeta = describeCoupledState(tuple.state);
                    const move = tuple.sampledCornerMoves[0];
                    const tuplePreviewable = isLocalTuplePreviewable(tuple);
                    return (
                      <div key={tuple.geometryTupleId} className={`rounded-lg border p-2.5 ${meta.heading}`}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-slate-100">
                            {tuple.movableCorner} · seam {tuple.seamId} · tNear {formatTrialExact(tuple.tNear)} · aspect{" "}
                            {formatTrialExact(tuple.aspectRatio)}
                          </span>
                          <span className={rowMeta.tone}>{rowMeta.label}</span>
                        </div>
                        {move && (
                          <p className="mt-1 text-slate-500">
                            img-norm({formatTrialExact(move.sourceNorm.x)}, {formatTrialExact(move.sourceNorm.y)}) ·
                            img-px({formatTrialExact(move.sourcePx.x, 1)}, {formatTrialExact(move.sourcePx.y, 1)}) ·
                            container({formatTrialExact(move.containerNorm.x)}, {formatTrialExact(move.containerNorm.y)})
                          </p>
                        )}
                        <p className="mt-0.5 text-slate-400">
                          width {formatNumber(tuple.worldWidth)} · depth {formatNumber(tuple.worldDepth)} · pose{" "}
                          {tuple.solver ? (tuple.solver.poseAvailable ? "available" : "unavailable") : "—"} · confidence{" "}
                          {tuple.solver?.confidence ?? "—"}
                        </p>
                        <p className="mt-0.5 text-slate-500">
                          valid FOV corridor: {formatFovCorridor(tuple.fovCorridors?.valid)} · high-confidence FOV
                          corridor: {formatFovCorridor(tuple.fovCorridors?.highConfidence)}
                        </p>
                        {tuple.solver && (
                          <p className="mt-0.5 text-slate-500">
                            CV avg {formatTrialPx(tuple.solver.cv.averagePx)} · CV max{" "}
                            {formatTrialPx(tuple.solver.cv.maximumPx)} · rendered avg{" "}
                            {formatTrialPx(tuple.solver.rendered.averagePx)} · rendered max{" "}
                            {formatTrialPx(tuple.solver.rendered.maximumPx)}
                          </p>
                        )}
                        {!tuple.constraint.canEvaluate && tuple.constraint.hardReasons.length > 0 && (
                          <p className="mt-0.5 text-rose-300">
                            geometry rejection: {tuple.constraint.hardReasons.join("; ")}
                          </p>
                        )}
                        {tuple.constraint.warnings.length > 0 && (
                          <p className="mt-0.5 text-amber-200/90">warnings: {tuple.constraint.warnings.join("; ")}</p>
                        )}
                        <p className="mt-1 text-slate-500">
                          direct FOV probes: {tuple.probes.length}
                          {localRefinementResultSet.truncatedProbes && tuple.probes.length === 0
                            ? " (none — probe cap reached)"
                            : ""}
                        </p>
                        {tuple.probes.length > 0 && (
                          <div className="mt-1 space-y-1 border-l border-slate-700 pl-2">
                            {tuple.probes.map((probe) => {
                              const probeMeta = describeCoupledState(probe.state);
                              const isPreviewingProbe =
                                localRefinementPreviewGeometryId === tuple.geometryTupleId &&
                                localRefinementPreviewProbeId === probe.probeId;
                              const probeFovFinite = Number.isFinite(probe.fovDeg);
                              // Phase 2O-L-A: the controlled live-controls load is
                              // offered ONLY for an Apply-safe + Apply-gate probe
                              // whose exact geometry is the active local preview,
                              // and only while calibrated camera is inactive.
                              const probeApplySafe =
                                probe.state === "apply_safe_diagnostic" && probe.applyGateAvailable;
                              return (
                                <div key={probe.probeId} className="text-slate-400">
                                  <span className="text-slate-300">direct FOV probe {formatNumber(probe.fovDeg)}°</span>{" "}
                                  · <span className={probeMeta.tone}>{probeMeta.label}</span> · pose{" "}
                                  {probe.poseAvailable ? "available" : "unavailable"} · confidence{" "}
                                  {probe.confidence ?? "—"} · CV avg {formatTrialPx(probe.cv.averagePx)} · CV max{" "}
                                  {formatTrialPx(probe.cv.maximumPx)} · rendered avg{" "}
                                  {formatTrialPx(probe.rendered.averagePx)} · Apply-gate{" "}
                                  {probe.applyGateAvailable ? "available" : "unavailable"}
                                  {probe.applyGateReason ? ` (${probe.applyGateReason})` : ""}
                                  <span className="ml-2 inline-flex flex-wrap items-center gap-2 align-middle">
                                    {tuplePreviewable && probeFovFinite ? (
                                      isPreviewingProbe ? (
                                        <>
                                          <span className="rounded border border-rose-400/60 bg-rose-500/10 px-1.5 py-0.5 text-rose-200">
                                            Previewing (temporary)
                                          </span>
                                          <button
                                            type="button"
                                            onClick={handleClearLocalPreview}
                                            className="rounded border border-slate-600 px-1.5 py-0.5 text-slate-300 transition hover:border-slate-400 hover:text-slate-100"
                                          >
                                            Clear preview
                                          </button>
                                        </>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() => handlePreviewLocalProbe(tuple.geometryTupleId, probe.probeId)}
                                          className="rounded border border-rose-500/60 px-1.5 py-0.5 text-rose-200 transition hover:border-rose-300 hover:text-rose-100"
                                        >
                                          Preview probe geometry
                                        </button>
                                      )
                                    ) : !probeFovFinite ? (
                                      <span className="text-slate-600">
                                        Preview unavailable — direct probe record is incomplete.
                                      </span>
                                    ) : (
                                      <span className="text-slate-600">
                                        Preview unavailable — exact local geometry is not in-frame for drawing.
                                      </span>
                                    )}
                                  </span>
                                  {probeApplySafe && (
                                    <span className="ml-2 inline-flex flex-wrap items-center gap-2 align-middle">
                                      {isCalibratedCameraActive ? (
                                        <span className="text-slate-600">
                                          Revert to legacy camera before loading a diagnostic tuple.
                                        </span>
                                      ) : isPreviewingProbe && localRefinementPreview ? (
                                        <>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              handleLoadLocalProbeIntoLiveControls(tuple.geometryTupleId, probe.probeId)
                                            }
                                            className="rounded border border-slate-600 px-1.5 py-0.5 text-slate-300 transition hover:border-slate-400 hover:text-slate-100"
                                          >
                                            Load exact tuple into live controls
                                          </button>
                                          <span className="text-slate-600">
                                            Copies this exact stored diagnostic tuple into the editable live floor/FOV
                                            controls. Calibration is not applied.
                                          </span>
                                        </>
                                      ) : (
                                        <span className="text-slate-600">
                                          Preview this exact probe geometry before loading it into live controls.
                                        </span>
                                      )}
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  });
                  return (
                    <div key={`localref-group-${group.state}`} className="space-y-1.5">
                      {collapsedByDefault ? (
                        <details>
                          <summary className={`cursor-pointer font-medium ${meta.tone}`}>
                            {meta.label} ({group.tuples.length}) — generation order, no ranking
                          </summary>
                          <div className="mt-1.5 space-y-1.5">{rows}</div>
                        </details>
                      ) : (
                        <>
                          <p className={`font-medium ${meta.tone}`}>
                            {meta.label} ({group.tuples.length}) — generation order, no ranking
                          </p>
                          {rows}
                        </>
                      )}
                    </div>
                  );
                })}

                <p className="text-slate-500">
                  States are truthful classifications, not rankings. Geometry-level FOV corridors are kept distinct from
                  per-probe Apply-gate diagnostics; a high-confidence corridor never implies Apply-safe. Nothing here is
                  previewed, selected, promoted, applied, or written to calibration.
                </p>
              </div>
            )}
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          title="TYPE B EVIDENCE REVIEW"
          open={isTypeBReviewOpen}
          onToggle={() => setIsTypeBReviewOpen((open) => !open)}
          description="Record visible support evidence for a future bounded Type B diagnostic. This does not change calibration."
          meta={
            <span className="rounded bg-slate-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-200">
              {TYPE_B_COLLAPSED_STATUS_LABELS[typeBQualification.status]}
            </span>
          }
        >
          {(() => {
            const q = typeBQualification;
            const facts = typeBGeometryFacts;
            const rear = typeBReview.rearSeam;
            const side = typeBReview.strongSideSeam;

            const numField = (
              value: number | "",
              onNum: (n: number) => void,
              ariaLabel: string
            ) => (
              <input
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={value}
                aria-label={ariaLabel}
                onChange={(event) => {
                  const parsed = sanitizeNormComponent(Number.parseFloat(event.target.value));
                  if (parsed !== null) onNum(parsed);
                }}
                className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-sky-500"
              />
            );

            const selectField = <T extends string>(
              value: T,
              options: { value: T; label: string }[],
              onSel: (value: T) => void,
              ariaLabel: string
            ) => (
              <select
                value={value}
                aria-label={ariaLabel}
                onChange={(event) => onSel(event.target.value as T)}
                className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-sky-500"
              >
                {options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            );

            const lineEditor = (
              kind: "rear" | "side",
              seam: TypeBDeclaredLineEvidence | null,
              update: (patch: Partial<TypeBDeclaredLineEvidence>) => void
            ) => (
              <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                <p className="font-medium text-slate-100">
                  {kind === "rear" ? "Rear seam" : "Strong side support seam"}
                </p>
                {kind === "rear" ? (
                  <p className="text-[11px] text-slate-400">
                    Role: <span className="text-slate-200">Rear floor-wall seam</span> (fixed)
                  </p>
                ) : (
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-wide text-slate-500">Role</span>
                    {selectField<TypeBStructuralLineRole>(
                      (seam?.role as TypeBStructuralLineRole) ?? "unresolved",
                      TYPE_B_SIDE_ROLE_OPTIONS,
                      (value) => update({ role: value }),
                      "Strong side support role"
                    )}
                  </label>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-wide text-slate-500">Start x (source-norm)</span>
                    {numField(
                      seam ? seam.startNorm.x : "",
                      (n) => update({ startNorm: { x: n, y: seam?.startNorm.y ?? 0 } }),
                      `${kind} start x`
                    )}
                  </label>
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-wide text-slate-500">Start y (source-norm)</span>
                    {numField(
                      seam ? seam.startNorm.y : "",
                      (n) => update({ startNorm: { x: seam?.startNorm.x ?? 0, y: n } }),
                      `${kind} start y`
                    )}
                  </label>
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-wide text-slate-500">End x (source-norm)</span>
                    {numField(
                      seam ? seam.endNorm.x : "",
                      (n) => update({ endNorm: { x: n, y: seam?.endNorm.y ?? 0 } }),
                      `${kind} end x`
                    )}
                  </label>
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-wide text-slate-500">End y (source-norm)</span>
                    {numField(
                      seam ? seam.endNorm.y : "",
                      (n) => update({ endNorm: { x: seam?.endNorm.x ?? 0, y: n } }),
                      `${kind} end y`
                    )}
                  </label>
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-wide text-slate-500">Start endpoint</span>
                    {selectField<TypeBEndpointStatus>(
                      seam?.startEndpointStatus ?? "unresolved",
                      TYPE_B_ENDPOINT_STATUS_OPTIONS,
                      (value) => update({ startEndpointStatus: value }),
                      `${kind} start endpoint status`
                    )}
                  </label>
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-wide text-slate-500">End endpoint</span>
                    {selectField<TypeBEndpointStatus>(
                      seam?.endEndpointStatus ?? "unresolved",
                      TYPE_B_ENDPOINT_STATUS_OPTIONS,
                      (value) => update({ endEndpointStatus: value }),
                      `${kind} end endpoint status`
                    )}
                  </label>
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-wide text-slate-500">Start frame contact</span>
                    {selectField<TypeBFrameContactStatus>(
                      seam?.startFrameContact ?? "unknown",
                      TYPE_B_FRAME_CONTACT_OPTIONS,
                      (value) => update({ startFrameContact: value }),
                      `${kind} start frame contact`
                    )}
                  </label>
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-wide text-slate-500">End frame contact</span>
                    {selectField<TypeBFrameContactStatus>(
                      seam?.endFrameContact ?? "unknown",
                      TYPE_B_FRAME_CONTACT_OPTIONS,
                      (value) => update({ endFrameContact: value }),
                      `${kind} end frame contact`
                    )}
                  </label>
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-wide text-slate-500">Occlusion</span>
                    {selectField<TypeBOcclusionStatus>(
                      seam?.occlusionStatus ?? "unknown",
                      TYPE_B_OCCLUSION_OPTIONS,
                      (value) => update({ occlusionStatus: value }),
                      `${kind} occlusion status`
                    )}
                  </label>
                </div>
                <label className="block">
                  <span className="text-[10px] uppercase tracking-wide text-slate-500">Note (optional)</span>
                  <input
                    type="text"
                    value={seam?.notes ?? ""}
                    aria-label={`${kind} note`}
                    onChange={(event) => update({ notes: event.target.value })}
                    className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-sky-500"
                  />
                </label>
              </div>
            );

            return (
              <div className="space-y-3 text-[11px] text-slate-300">
                <p className="rounded-lg border border-slate-600/40 bg-slate-800/40 px-3 py-2 text-slate-200">
                  Diagnostic only. This panel records declared visible support evidence for a possible future
                  bounded Type B diagnostic. It does not run any search, solver, FOV probe, preview, load, or
                  calibration, and it never changes the floor polygon, selected candidate, FOV, readiness, or
                  applied calibration.
                </p>

                {/* Primary Type B qualification status */}
                <div className={`rounded-lg border px-3 py-2 ${TYPE_B_STATUS_TONES[q.status]}`}>
                  <p className="text-[10px] uppercase tracking-wide opacity-70">Type B qualification</p>
                  <p className="mt-0.5 text-sm font-medium">{TYPE_B_STATUS_LABELS[q.status]}</p>
                  {q.status === "type_b_diagnostic_eligible" && (
                    <p className="mt-1 text-[11px] opacity-90">
                      A future bounded Type B diagnostic may be considered. No search, preview, load, or
                      calibration action is available here.
                    </p>
                  )}
                </div>

                {/* Type A context (read-only) */}
                <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                  <p className="font-medium text-slate-100">Type A context (read-only)</p>
                  <p className="mt-0.5 text-slate-300">{q.typeAContext}</p>
                  <p className="mt-1 text-[10px] text-slate-500">
                    Type A context is descriptive only. It does not grant Type B authority.
                  </p>
                </div>

                {!typeBReviewActive ? (
                  <button
                    type="button"
                    onClick={handleBeginTypeBReview}
                    className="rounded-lg border border-sky-600/50 bg-sky-600/10 px-3 py-1.5 text-sm font-medium text-sky-100 transition hover:bg-sky-600/20"
                  >
                    Begin evidence review
                  </button>
                ) : (
                  <>
                    {/* Declared visible evidence */}
                    <div className="space-y-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        Declared visible evidence
                      </p>

                      {/* Phase B2A: direct on-image placement controls. Arming a
                          target lets the operator declare ONLY that endpoint with
                          the next image click; placement exits after one click.
                          Numeric fields below remain an exact fallback and stay
                          synchronized with direct placement / drag. */}
                      <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium text-slate-100">Place / drag on image</p>
                          {typeBPlacementTarget && (
                            <button
                              type="button"
                              onClick={cancelTypeBPlacement}
                              className="rounded border border-slate-600 bg-slate-800/60 px-2 py-0.5 text-[10px] font-medium text-slate-200 transition hover:bg-slate-800"
                            >
                              Cancel placement
                            </button>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                          {(
                            [
                              "rear_start",
                              "rear_end",
                              "side_start",
                              "side_end",
                            ] as TypeBEndpointTarget[]
                          ).map((target) => {
                            const armed = typeBPlacementTarget === target;
                            return (
                              <button
                                key={`type-b-place-${target}`}
                                type="button"
                                aria-pressed={armed}
                                onClick={() => armTypeBPlacementTarget(target)}
                                className={`rounded border px-2 py-1 text-[11px] font-medium transition ${
                                  armed
                                    ? "border-emerald-400/70 bg-emerald-500/15 text-emerald-100"
                                    : "border-slate-600 bg-slate-800/50 text-slate-200 hover:bg-slate-800"
                                }`}
                              >
                                {`Place ${TYPE_B_PLACEMENT_TARGET_LABELS[target]}`}
                              </button>
                            );
                          })}
                        </div>
                        <p className="text-[10px] text-slate-500">
                          {typeBPlacementTarget
                            ? `Click on the room image to declare the ${TYPE_B_PLACEMENT_TARGET_LABELS[typeBPlacementTarget]}.`
                            : "Arm a target, then click the room image. Enable the overlay below to see and drag declared endpoints."}
                        </p>
                      </div>

                      {lineEditor("rear", rear, updateTypeBRearSeam)}
                      {lineEditor("side", side, updateTypeBSideSeam)}
                      <p className="text-[10px] text-slate-500">
                        “Contacts frame” describes image visibility only. It does not establish a physical
                        continuation.
                      </p>

                      {/* Latent near-corner condition */}
                      <div className="space-y-1 rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                        <p className="font-medium text-slate-100">Latent near-corner condition</p>
                        {selectField<TypeBLatentNearCornerCondition>(
                          typeBReview.latentNearCornerCondition,
                          TYPE_B_LATENT_OPTIONS,
                          setTypeBLatentCondition,
                          "Latent near-corner condition"
                        )}
                        <p className="text-[10px] text-slate-500">
                          This records what is visible or unavailable. It does not create an off-frame corner.
                        </p>
                      </div>
                    </div>

                    {/* Derived image-space facts */}
                    <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                      <p className="font-medium text-slate-100">Derived image-space facts</p>
                      <div className="mt-1 grid grid-cols-1 gap-x-4 gap-y-0.5 text-slate-400 sm:grid-cols-2">
                        <span>
                          Rear seam visible span: <span className="text-slate-200">{formatTypeBPx(facts.rearSpanSourcePx)}</span>
                        </span>
                        <span>
                          Side support visible span: <span className="text-slate-200">{formatTypeBPx(facts.sideSpanSourcePx)}</span>
                        </span>
                        <span>
                          Rear-to-side span ratio: <span className="text-slate-200">{formatTypeBRatio(facts.rearToSideSpanRatio)}</span>
                        </span>
                        <span>
                          Rear-to-side angle: <span className="text-slate-200">{formatTypeBAngle(facts.rearSideAngleDeg)}</span>
                        </span>
                        <span>
                          Rear start frame distance: <span className="text-slate-200">{formatTypeBPx(facts.rearStartDistanceToFramePx)}</span>
                        </span>
                        <span>
                          Rear end frame distance: <span className="text-slate-200">{formatTypeBPx(facts.rearEndDistanceToFramePx)}</span>
                        </span>
                        <span>
                          Side start frame distance: <span className="text-slate-200">{formatTypeBPx(facts.sideStartDistanceToFramePx)}</span>
                        </span>
                        <span>
                          Side end frame distance: <span className="text-slate-200">{formatTypeBPx(facts.sideEndDistanceToFramePx)}</span>
                        </span>
                        <span>
                          Shared endpoint proximity: <span className="text-slate-200">{formatTypeBPx(facts.sharedJunctionDistanceSourcePx)}</span>
                        </span>
                        <span>
                          Shared visible junction: <span className="text-slate-200">{formatTypeBBool(facts.sharedJunctionPresent)}</span>
                        </span>
                        <span>
                          Source frame valid: <span className="text-slate-200">{formatTypeBBool(facts.validSourceFrame)}</span>
                        </span>
                        <span>
                          Declared geometry finite: <span className="text-slate-200">{formatTypeBBool(facts.finiteDeclaredGeometry)}</span>
                        </span>
                      </div>
                    </div>

                    {/* Evidence summary */}
                    <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                      <p className="font-medium text-slate-100">Evidence summary</p>
                      <div className="mt-1 grid grid-cols-1 gap-x-4 gap-y-0.5 text-slate-400 sm:grid-cols-2">
                        <span>
                          Rear seam usable: <span className="text-slate-200">{formatTypeBBool(q.evidenceSummary.rearSeamUsable)}</span>
                        </span>
                        <span>
                          Strong side support usable: <span className="text-slate-200">{formatTypeBBool(q.evidenceSummary.strongSideSeamUsable)}</span>
                        </span>
                        <span>
                          Rear-side relationship usable: <span className="text-slate-200">{formatTypeBBool(q.evidenceSummary.rearSideRelationshipUsable)}</span>
                        </span>
                        <span>
                          Latent near-corner bounded: <span className="text-slate-200">{formatTypeBBool(q.evidenceSummary.latentNearCornerBounded)}</span>
                        </span>
                        <span>
                          Crop interpretation usable: <span className="text-slate-200">{formatTypeBBool(q.evidenceSummary.cropInterpretationUsable)}</span>
                        </span>
                      </div>
                      <p className="mt-1 text-[10px] text-slate-500">
                        This is a declared-evidence summary only. It is not calibration readiness.
                      </p>
                    </div>

                    {/* Blocking evidence gaps */}
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                      <p className="font-medium text-amber-100">Blocking evidence gaps</p>
                      {q.blockingReasons.length > 0 ? (
                        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-amber-200/90">
                          {q.blockingReasons.map((reason) => (
                            <li key={reason}>{TYPE_B_REASON_LABELS[reason]}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-1 text-amber-200/70">No blocking evidence gaps.</p>
                      )}
                    </div>

                    {/* Advisory observations */}
                    <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                      <p className="font-medium text-slate-100">Advisory observations</p>
                      {q.advisoryReasons.length > 0 ? (
                        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-slate-300">
                          {q.advisoryReasons.map((reason) => (
                            <li key={reason}>{TYPE_B_REASON_LABELS[reason]}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-1 text-slate-400">No advisory observations.</p>
                      )}
                    </div>

                    {/* Overlay toggle + clear */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="flex items-center gap-2 text-slate-300">
                        <input
                          type="checkbox"
                          checked={typeBOverlayVisible}
                          onChange={(event) => setTypeBOverlayVisible(event.target.checked)}
                          disabled={!typeBHasDeclaredGeometry}
                        />
                        <span>Show Type B evidence overlay</span>
                      </label>
                      <button
                        type="button"
                        onClick={handleClearTypeBReview}
                        className="rounded-lg border border-slate-600 bg-slate-800/60 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-800"
                      >
                        Clear Type B evidence review
                      </button>
                    </div>

                    {/* ---- Phase B3E: read-only Type B capture + diagnostic ---- */}
                    <div className="space-y-3 border-t border-slate-700/70 pt-3">
                      <p className="rounded-lg border border-slate-600/40 bg-slate-800/40 px-3 py-2 text-[11px] text-slate-200">
                        Lab-only read-only diagnostic. Authoring inputs, capturing,
                        and running a diagnostic never rank, recommend, select,
                        preview, load, Apply, or change calibration / camera /
                        candidate / floor / FOV / dimensions / readiness state.
                      </p>

                      {/* A. Type B capture inputs */}
                      <div className="space-y-2 rounded-lg border border-emerald-600/30 bg-emerald-500/5 p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-200/80">
                          Type B capture inputs
                        </p>
                        <p className="text-[10px] text-slate-500">
                          Explicit operator-authored coverage, used exactly as typed
                          and never seeded from Type A. List fields are
                          comma-separated.
                        </p>
                        <label className="block">
                          <span className="text-[10px] uppercase tracking-wide text-slate-500">
                            World width
                          </span>
                          <input
                            type="text"
                            value={typeBWorldWidthText}
                            aria-label="Type B world width"
                            onChange={(event) =>
                              updateTypeBWorldWidthText(event.target.value)
                            }
                            className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-sky-500"
                          />
                        </label>
                        <label className="block">
                          <span className="text-[10px] uppercase tracking-wide text-slate-500">
                            Authorized aspect ratios (comma-separated)
                          </span>
                          <input
                            type="text"
                            value={typeBAspectRatiosText}
                            aria-label="Type B authorized aspect ratios"
                            onChange={(event) =>
                              updateTypeBAspectRatiosText(event.target.value)
                            }
                            className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-sky-500"
                          />
                        </label>
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] uppercase tracking-wide text-slate-500">
                              Primary product classes
                            </span>
                            <button
                              type="button"
                              onClick={addTypeBProductClassRow}
                              className="rounded border border-slate-600 bg-slate-800/50 px-2 py-0.5 text-[10px] font-medium text-slate-200 transition hover:bg-slate-800"
                            >
                              Add product class
                            </button>
                          </div>
                          {typeBProductClassRows.length === 0 ? (
                            <p className="text-[10px] text-slate-500">
                              No product classes authored.
                            </p>
                          ) : (
                            typeBProductClassRows.map((row, index) => (
                              <div
                                key={`type-b-product-class-${index}`}
                                className="flex items-center gap-1.5"
                              >
                                <input
                                  type="text"
                                  value={row.identity}
                                  placeholder="identity"
                                  aria-label={`Type B product class ${index + 1} identity`}
                                  onChange={(event) =>
                                    updateTypeBProductClassRow(index, {
                                      identity: event.target.value,
                                    })
                                  }
                                  className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-sky-500"
                                />
                                <input
                                  type="text"
                                  value={row.value}
                                  placeholder="product value"
                                  aria-label={`Type B product class ${index + 1} product value`}
                                  onChange={(event) =>
                                    updateTypeBProductClassRow(index, {
                                      value: event.target.value,
                                    })
                                  }
                                  className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-sky-500"
                                />
                                <button
                                  type="button"
                                  onClick={() => removeTypeBProductClassRow(index)}
                                  aria-label={`Remove product class ${index + 1}`}
                                  className="shrink-0 rounded border border-slate-600 bg-slate-800/50 px-2 py-1 text-[10px] font-medium text-slate-200 transition hover:bg-slate-800"
                                >
                                  Remove
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                        <label className="block">
                          <span className="text-[10px] uppercase tracking-wide text-slate-500">
                            FOV probes (comma-separated degrees)
                          </span>
                          <input
                            type="text"
                            value={typeBFovProbesText}
                            aria-label="Type B FOV probes"
                            onChange={(event) =>
                              updateTypeBFovProbesText(event.target.value)
                            }
                            className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-sky-500"
                          />
                        </label>
                        <div className="flex flex-wrap gap-2 pt-1">
                          <button
                            type="button"
                            onClick={handleCaptureTypeBInputs}
                            className="rounded-lg border border-emerald-600/50 bg-emerald-600/10 px-3 py-1.5 text-sm font-medium text-emerald-100 transition hover:bg-emerald-600/20"
                          >
                            Capture Type B Inputs
                          </button>
                          <button
                            type="button"
                            onClick={handleClearTypeBCaptureResults}
                            className="rounded-lg border border-slate-600 bg-slate-800/60 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-800"
                          >
                            Clear Type B Capture / Results
                          </button>
                        </div>
                      </div>

                      {/* B. Optional branch association */}
                      <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                        <label className="flex items-center gap-2 text-slate-200">
                          <input
                            type="checkbox"
                            checked={typeBRequestBranchAssociation}
                            onChange={toggleTypeBRequestBranchAssociation}
                          />
                          <span className="font-medium">Request branch association</span>
                        </label>
                        <p className="text-[10px] text-slate-500">
                          Optional; default off. When off, branch association is not
                          requested. No topology is implied from FOV order and no
                          default is supplied.
                        </p>
                        {typeBRequestBranchAssociation && (
                          <div className="space-y-1.5">
                            <label className="block">
                              <span className="text-[10px] uppercase tracking-wide text-slate-500">
                                Ordered topology probes (comma-separated)
                              </span>
                              <input
                                type="text"
                                value={typeBTopologyOrderedProbesText}
                                aria-label="Type B ordered topology probes"
                                onChange={(event) =>
                                  updateTypeBAssociationField(
                                    setTypeBTopologyOrderedProbesText,
                                    event.target.value
                                  )
                                }
                                className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-sky-500"
                              />
                            </label>
                            <label className="block">
                              <span className="text-[10px] uppercase tracking-wide text-slate-500">
                                Topology step
                              </span>
                              <input
                                type="text"
                                value={typeBTopologyStepText}
                                aria-label="Type B topology step"
                                onChange={(event) =>
                                  updateTypeBAssociationField(
                                    setTypeBTopologyStepText,
                                    event.target.value
                                  )
                                }
                                className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-sky-500"
                              />
                            </label>
                            <label className="block">
                              <span className="text-[10px] uppercase tracking-wide text-slate-500">
                                Max normalized camera-position delta
                              </span>
                              <input
                                type="text"
                                value={typeBPolicyMaxPosText}
                                aria-label="Type B max normalized camera-position delta"
                                onChange={(event) =>
                                  updateTypeBAssociationField(
                                    setTypeBPolicyMaxPosText,
                                    event.target.value
                                  )
                                }
                                className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-sky-500"
                              />
                            </label>
                            <label className="block">
                              <span className="text-[10px] uppercase tracking-wide text-slate-500">
                                Max rotation delta
                              </span>
                              <input
                                type="text"
                                value={typeBPolicyMaxRotText}
                                aria-label="Type B max rotation delta"
                                onChange={(event) =>
                                  updateTypeBAssociationField(
                                    setTypeBPolicyMaxRotText,
                                    event.target.value
                                  )
                                }
                                className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-sky-500"
                              />
                            </label>
                            <label className="block">
                              <span className="text-[10px] uppercase tracking-wide text-slate-500">
                                Position tie margin
                              </span>
                              <input
                                type="text"
                                value={typeBPolicyTiePosText}
                                aria-label="Type B position tie margin"
                                onChange={(event) =>
                                  updateTypeBAssociationField(
                                    setTypeBPolicyTiePosText,
                                    event.target.value
                                  )
                                }
                                className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-sky-500"
                              />
                            </label>
                            <label className="block">
                              <span className="text-[10px] uppercase tracking-wide text-slate-500">
                                Rotation tie margin
                              </span>
                              <input
                                type="text"
                                value={typeBPolicyTieRotText}
                                aria-label="Type B rotation tie margin"
                                onChange={(event) =>
                                  updateTypeBAssociationField(
                                    setTypeBPolicyTieRotText,
                                    event.target.value
                                  )
                                }
                                className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-sky-500"
                              />
                            </label>
                            <label className="block">
                              <span className="text-[10px] uppercase tracking-wide text-slate-500">
                                Near-coincident position delta
                              </span>
                              <input
                                type="text"
                                value={typeBPolicyNearPosText}
                                aria-label="Type B near-coincident position delta"
                                onChange={(event) =>
                                  updateTypeBAssociationField(
                                    setTypeBPolicyNearPosText,
                                    event.target.value
                                  )
                                }
                                className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-sky-500"
                              />
                            </label>
                            <label className="block">
                              <span className="text-[10px] uppercase tracking-wide text-slate-500">
                                Near-coincident rotation delta
                              </span>
                              <input
                                type="text"
                                value={typeBPolicyNearRotText}
                                aria-label="Type B near-coincident rotation delta"
                                onChange={(event) =>
                                  updateTypeBAssociationField(
                                    setTypeBPolicyNearRotText,
                                    event.target.value
                                  )
                                }
                                className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-sky-500"
                              />
                            </label>
                            {!typeBBranchFieldsComplete && (
                              <p className="rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-[10px] text-amber-200/80">
                                Branch association request is incomplete. All fields
                                must be authored before a diagnostic run.
                              </p>
                            )}
                          </div>
                        )}
                      </div>

                      {/* C. Type B diagnostic run */}
                      <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                          Type B diagnostic run
                        </p>
                        <button
                          type="button"
                          onClick={handleRunTypeBDiagnostic}
                          disabled={!typeBRunEnabled}
                          className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                            typeBRunEnabled
                              ? "border-sky-600/50 bg-sky-600/10 text-sky-100 hover:bg-sky-600/20"
                              : "cursor-not-allowed border-slate-700 bg-slate-800/40 text-slate-500"
                          }`}
                        >
                          Run Type B Diagnostic
                        </button>
                        <p className="text-[10px] text-slate-400">{typeBRunStateText}</p>
                      </div>

                      {/* D. Read-only Type B diagnostic results */}
                      {typeBCaptureResult !== null && (
                        <div className="space-y-2">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                            Read-only Type B diagnostic results
                          </p>

                          {/* Capture refusal facts (visible) */}
                          {typeBDiagnosticPresentation.capture?.status ===
                            "refused" && (
                            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                              <p className="font-medium text-amber-100">
                                Capture refusal facts
                              </p>
                              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-amber-200/90">
                                {typeBDiagnosticPresentation.capture.refusalLiterals.map(
                                  (reason, index) => (
                                    <li key={`type-b-cap-refusal-${index}`}>
                                      {reason}
                                    </li>
                                  )
                                )}
                              </ul>
                            </div>
                          )}

                          {/* Captured facts (visible) */}
                          {typeBDiagnosticPresentation.capture?.status ===
                            "captured" && (
                            <div className="space-y-1 rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-[11px] text-slate-300">
                              <p className="font-medium text-slate-100">
                                Captured facts
                              </p>
                              <p className="break-all">
                                Evidence fingerprint:{" "}
                                <span className="text-slate-200">
                                  {typeBDiagnosticPresentation.capture.evidenceFingerprint}
                                </span>
                              </p>
                              <p className="break-all">
                                Coverage fingerprint:{" "}
                                <span className="text-slate-200">
                                  {typeBDiagnosticPresentation.capture.coverageFingerprint}
                                </span>
                              </p>
                              <p>
                                Captured at:{" "}
                                <span className="text-slate-200">
                                  {typeBDiagnosticPresentation.capture.capturedAtIso}
                                </span>
                              </p>
                              <p>
                                Basis:{" "}
                                <span className="text-slate-200">
                                  {typeBDiagnosticPresentation.capture.basis.sourceImageIdentity}
                                  {" · "}
                                  {typeBDiagnosticPresentation.capture.basis.sourceFrameKey}
                                  {" · "}
                                  {typeBDiagnosticPresentation.capture.basis.candidateIdentity ?? "—"}
                                  {" · "}
                                  {typeBDiagnosticPresentation.capture.basis.floorPolygonKey ?? "—"}
                                </span>
                              </p>
                              <p>
                                World width:{" "}
                                <span className="text-slate-200">
                                  {formatTypeBNumber(
                                    typeBDiagnosticPresentation.capture.worldWidth
                                  )}
                                </span>
                              </p>
                              <p>
                                Authorized aspect ratios:{" "}
                                <span className="text-slate-200">
                                  {typeBDiagnosticPresentation.capture.authorizedAspectRatios
                                    .map(formatTypeBNumber)
                                    .join(", ") || "—"}
                                </span>
                              </p>
                              <p>
                                Product classes:{" "}
                                <span className="text-slate-200">
                                  {typeBDiagnosticPresentation.capture.productClasses
                                    .map(
                                      (entry) =>
                                        `${entry.primaryProductClassIdentity}=${formatTypeBNumber(entry.latentDepthProductValue)}`
                                    )
                                    .join(", ") || "—"}
                                </span>
                              </p>
                              <p>
                                FOV probes:{" "}
                                <span className="text-slate-200">
                                  {typeBDiagnosticPresentation.capture.fovProbesDeg
                                    .map(formatTypeBNumber)
                                    .join(", ") || "—"}
                                </span>
                              </p>
                            </div>
                          )}

                          {/* Run manifest (visible) */}
                          {typeBDiagnosticPresentation.runManifest && (
                            <div className="space-y-1 rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-[11px] text-slate-300">
                              <p className="font-medium text-slate-100">Run manifest</p>
                              <p className="break-all">
                                Assembly schema:{" "}
                                <span className="text-slate-200">
                                  {typeBDiagnosticPresentation.runManifest.assemblySchema}
                                </span>
                              </p>
                              <p className="break-all">
                                Diagnostic schema:{" "}
                                <span className="text-slate-200">
                                  {typeBDiagnosticPresentation.runManifest.diagnosticSchema}
                                </span>
                              </p>
                              <p>
                                Evidence family:{" "}
                                <span className="text-slate-200">
                                  {typeBDiagnosticPresentation.runManifest.evidenceFamily ?? "—"}
                                </span>
                              </p>
                              <p>
                                Evaluator family:{" "}
                                <span className="text-slate-200">
                                  {typeBDiagnosticPresentation.runManifest.evaluatorFamily ?? "—"}
                                </span>
                              </p>
                              <p>
                                Tuple-generation status:{" "}
                                <span className="text-slate-200">
                                  {typeBDiagnosticPresentation.runManifest.tupleGenerationStatus}
                                </span>
                              </p>
                              <p>
                                Association requested:{" "}
                                <span className="text-slate-200">
                                  {typeBDiagnosticPresentation.runManifest.associationRequested
                                    ? "Yes"
                                    : "No"}
                                </span>
                              </p>
                            </div>
                          )}

                          {/* Run-level refusal / non-assessment facts (visible) */}
                          {typeBDiagnosticPresentation.runManifest && (
                            <div className="space-y-1 rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-[11px] text-slate-300">
                              <p className="font-medium text-slate-100">
                                Run-level refusal / non-assessment facts
                              </p>
                              <p>
                                Tuple-generation refusals:{" "}
                                <span className="text-slate-200">
                                  {typeBDiagnosticPresentation.runManifest.tupleGenerationRefusalLiterals.join(
                                    ", "
                                  ) || "—"}
                                </span>
                              </p>
                              <p>
                                Run-level refusals:{" "}
                                <span className="text-slate-200">
                                  {typeBDiagnosticPresentation.runManifest.runRefusalLiterals.join(
                                    ", "
                                  ) || "—"}
                                </span>
                              </p>
                              {typeBDiagnosticPresentation.branchCorridors && (
                                <p>
                                  Branch non-assessment:{" "}
                                  <span className="text-slate-200">
                                    {typeBDiagnosticPresentation.branchCorridors.notAssessedLiterals.join(
                                      ", "
                                    ) || "—"}
                                  </span>
                                </p>
                              )}
                              {typeBDiagnosticPresentation.frameTruncation && (
                                <p>
                                  Frame-truncation non-assessment:{" "}
                                  <span className="text-slate-200">
                                    {typeBDiagnosticPresentation.frameTruncation.notAssessedLiterals.join(
                                      ", "
                                    ) || "—"}
                                  </span>
                                </p>
                              )}
                            </div>
                          )}

                          {/* Tuple class details (collapsed by default) */}
                          {typeBDiagnosticPresentation.tupleClasses.length > 0 && (
                            <CollapsibleSection
                              title="Tuple class details"
                              open={isTypeBTupleClassesOpen}
                              onToggle={() =>
                                setIsTypeBTupleClassesOpen((open) => !open)
                              }
                            >
                              <div className="space-y-2 text-[11px] text-slate-300">
                                {typeBDiagnosticPresentation.tupleClasses.map(
                                  (cls, index) => (
                                    <div
                                      key={`type-b-tuple-class-${index}`}
                                      className="rounded border border-slate-700 bg-slate-950/40 p-2"
                                    >
                                      <p className="text-slate-100">
                                        {cls.primaryProductClassIdentity} · {cls.status}
                                      </p>
                                      <p>
                                        Product-equivalence key:{" "}
                                        <span className="text-slate-200">
                                          {cls.productEquivalenceKey ?? "—"}
                                        </span>
                                      </p>
                                      <p>
                                        Primary latent-depth product:{" "}
                                        <span className="text-slate-200">
                                          {formatTypeBNumber(cls.primaryLatentDepthProduct)}
                                        </span>
                                      </p>
                                      {cls.refusalLiterals.length > 0 && (
                                        <p>
                                          Class refusals:{" "}
                                          <span className="text-slate-200">
                                            {cls.refusalLiterals.join(", ")}
                                          </span>
                                        </p>
                                      )}
                                      {cls.members.map((member, memberIndex) => (
                                        <p
                                          key={`type-b-member-${index}-${memberIndex}`}
                                          className="pl-2 text-slate-400"
                                        >
                                          aspect {formatTypeBNumber(member.memberAspectRatio)} · latent-side extent{" "}
                                          {formatTypeBNumber(member.memberLatentSideExtent)} · probes{" "}
                                          {member.probeListDeg
                                            .map(formatTypeBNumber)
                                            .join(", ") || "—"}
                                        </p>
                                      ))}
                                    </div>
                                  )
                                )}
                              </div>
                            </CollapsibleSection>
                          )}

                          {/* P3P probe outcomes (collapsed by default) */}
                          {typeBDiagnosticPresentation.poseProbeOutcomes.length > 0 && (
                            <CollapsibleSection
                              title="P3P probe outcomes"
                              open={isTypeBProbeOutcomesOpen}
                              onToggle={() =>
                                setIsTypeBProbeOutcomesOpen((open) => !open)
                              }
                            >
                              <div className="space-y-2 text-[11px] text-slate-300">
                                {typeBDiagnosticPresentation.poseProbeOutcomes.map(
                                  (probe, index) => (
                                    <div
                                      key={`type-b-probe-${index}`}
                                      className="rounded border border-slate-700 bg-slate-950/40 p-2"
                                    >
                                      <p className="text-slate-100">
                                        {probe.productEquivalenceKey} · FOV{" "}
                                        {formatTypeBNumber(probe.fovProbeDeg)} ·{" "}
                                        {probe.poseStageKind}
                                      </p>
                                      {probe.stageRefusalLiterals.length > 0 && (
                                        <p>
                                          Stage refusals:{" "}
                                          <span className="text-slate-200">
                                            {probe.stageRefusalLiterals.join(", ")}
                                          </span>
                                        </p>
                                      )}
                                      {probe.rootCensus && (
                                        <p className="text-slate-400">
                                          Root census: algebraic{" "}
                                          {probe.rootCensus.algebraicCandidateCount} · real{" "}
                                          {probe.rootCensus.realRootCount} · positive-distance{" "}
                                          {probe.rootCensus.positiveDistanceRootCount} · deduplicated{" "}
                                          {probe.rootCensus.deduplicatedRootCount}
                                        </p>
                                      )}
                                      {probe.hypotheses.map((hypothesis, hIndex) => (
                                        <div
                                          key={`type-b-hypothesis-${index}-${hIndex}`}
                                          className="pl-2 text-slate-400"
                                        >
                                          <p>Hypothesis index: {hypothesis.hypothesisIndex}</p>
                                          {hypothesis.constructionObservations.map(
                                            (obs, oIndex) => (
                                              <p
                                                key={`type-b-cons-${index}-${hIndex}-${oIndex}`}
                                              >
                                                construction: {obs.label} · {obs.state} · residual{" "}
                                                {formatTypeBNumber(obs.residual)}
                                              </p>
                                            )
                                          )}
                                          {hypothesis.plausibilityObservations.map(
                                            (obs, oIndex) => (
                                              <p
                                                key={`type-b-plaus-${index}-${hIndex}-${oIndex}`}
                                              >
                                                plausibility: {obs.label} · {obs.state}
                                              </p>
                                            )
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  )
                                )}
                              </div>
                            </CollapsibleSection>
                          )}

                          {/* Branch corridors (collapsed; only when requested) */}
                          {typeBDiagnosticPresentation.branchCorridors && (
                            <CollapsibleSection
                              title="Branch corridors"
                              open={isTypeBBranchCorridorsOpen}
                              onToggle={() =>
                                setIsTypeBBranchCorridorsOpen((open) => !open)
                              }
                            >
                              <div className="space-y-2 text-[11px] text-slate-300">
                                <p>
                                  B3D-2 status:{" "}
                                  <span className="text-slate-200">
                                    {typeBDiagnosticPresentation.branchCorridors.status}
                                  </span>
                                </p>
                                <p>
                                  Topology:{" "}
                                  <span className="text-slate-200">
                                    {typeBDiagnosticPresentation.branchCorridors.topology
                                      ? `${typeBDiagnosticPresentation.branchCorridors.topology.orderedProbesDeg
                                          .map(formatTypeBNumber)
                                          .join(", ")} · step ${formatTypeBNumber(typeBDiagnosticPresentation.branchCorridors.topology.stepDeg)}`
                                      : "—"}
                                  </span>
                                </p>
                                {typeBDiagnosticPresentation.branchCorridors.policy && (
                                  <p className="text-slate-400">
                                    Policy: maxPos{" "}
                                    {formatTypeBNumber(
                                      typeBDiagnosticPresentation.branchCorridors.policy
                                        .maxNormalizedCameraPositionDelta
                                    )}{" "}
                                    · maxRot{" "}
                                    {formatTypeBNumber(
                                      typeBDiagnosticPresentation.branchCorridors.policy
                                        .maxRotationDeltaDeg
                                    )}{" "}
                                    · tiePos{" "}
                                    {formatTypeBNumber(
                                      typeBDiagnosticPresentation.branchCorridors.policy
                                        .tieMarginNormalizedCameraPosition
                                    )}{" "}
                                    · tieRot{" "}
                                    {formatTypeBNumber(
                                      typeBDiagnosticPresentation.branchCorridors.policy
                                        .tieMarginRotationDeg
                                    )}{" "}
                                    · nearPos{" "}
                                    {formatTypeBNumber(
                                      typeBDiagnosticPresentation.branchCorridors.policy
                                        .nearCoincidentNormalizedCameraPositionDelta
                                    )}{" "}
                                    · nearRot{" "}
                                    {formatTypeBNumber(
                                      typeBDiagnosticPresentation.branchCorridors.policy
                                        .nearCoincidentRotationDeltaDeg
                                    )}
                                  </p>
                                )}
                                {typeBDiagnosticPresentation.branchCorridors
                                  .notAssessedLiterals.length > 0 && (
                                  <p>
                                    Non-assessment:{" "}
                                    <span className="text-slate-200">
                                      {typeBDiagnosticPresentation.branchCorridors.notAssessedLiterals.join(
                                        ", "
                                      )}
                                    </span>
                                  </p>
                                )}
                                {typeBDiagnosticPresentation.branchCorridors.branches.map(
                                  (branch, index) => (
                                    <div
                                      key={`type-b-branch-${index}`}
                                      className="rounded border border-slate-700 bg-slate-950/40 p-2"
                                    >
                                      <p className="text-slate-100">
                                        Branch {branch.branchIndex} ({branch.branchIndexLabel})
                                      </p>
                                      {branch.rootReferences.map((ref, rIndex) => (
                                        <p
                                          key={`type-b-branch-ref-${index}-${rIndex}`}
                                          className="pl-2 text-slate-400"
                                        >
                                          {ref.poseProbeEquivalenceKey} · FOV{" "}
                                          {formatTypeBNumber(ref.fovProbeDeg)} · hypothesis{" "}
                                          {ref.hypothesisIndex}
                                        </p>
                                      ))}
                                      {branch.annotations.map((annotation, aIndex) => (
                                        <p
                                          key={`type-b-branch-annotation-${index}-${aIndex}`}
                                          className="pl-2 text-slate-500"
                                        >
                                          annotation: {annotation.state}
                                        </p>
                                      ))}
                                    </div>
                                  )
                                )}
                              </div>
                            </CollapsibleSection>
                          )}

                          {/* Frame-truncation compatibility (collapsed by default) */}
                          {typeBDiagnosticPresentation.frameTruncation && (
                            <CollapsibleSection
                              title="Frame-truncation compatibility"
                              open={isTypeBFrameTruncationOpen}
                              onToggle={() =>
                                setIsTypeBFrameTruncationOpen((open) => !open)
                              }
                            >
                              <div className="space-y-2 text-[11px] text-slate-300">
                                <p>
                                  B3D-3 status:{" "}
                                  <span className="text-slate-200">
                                    {typeBDiagnosticPresentation.frameTruncation.status}
                                  </span>
                                </p>
                                {typeBDiagnosticPresentation.frameTruncation.records.map(
                                  (record, index) => (
                                    <p
                                      key={`type-b-frame-truncation-${index}`}
                                      className="text-slate-400"
                                    >
                                      {record.primaryProductClassIdentity} · aspect{" "}
                                      {formatTypeBNumber(record.floorAspectRatio)} · latent-side extent{" "}
                                      {formatTypeBNumber(record.latentSideExtent)} ·{" "}
                                      {record.poseProbeEquivalenceKey} · hypothesis{" "}
                                      {record.hypothesisIndex} · {record.cropCompatibility}
                                    </p>
                                  )
                                )}
                              </div>
                            </CollapsibleSection>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}

                {typeBReviewNote && (
                  <p className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-[11px] text-slate-300">
                    {typeBReviewNote}
                  </p>
                )}
              </div>
            );
          })()}
        </CollapsibleSection>

        <section className="rounded-2xl border border-fuchsia-500/30 bg-slate-900/70 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-slate-100">Fixture Harness</h2>
            <span className="rounded bg-fuchsia-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-fuchsia-200">
              lab-only · local · not persisted
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Deliberate, human-driven testing of known room-image categories. Fixture images are local/dev-only
            and are never committed or persisted. No automatic batch runs.
          </p>

          <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-end">
            <label className="flex-1">
              <span className="text-xs text-slate-400">Fixture</span>
              <select
                value={selectedFixtureId}
                onChange={(event) => setSelectedFixtureId(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-fuchsia-400"
              >
                {AUTO_FLOOR_FIXTURES.map((fixture) => (
                  <option key={fixture.id} value={fixture.id}>
                    {fixture.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleLoadFixtureImage}
                className="rounded-lg border border-fuchsia-500/70 px-3 py-2 text-xs text-fuchsia-200 transition hover:border-fuchsia-300 hover:text-fuchsia-100"
              >
                Load fixture image
              </button>
              <button
                type="button"
                onClick={handleRunFixtureDetection}
                disabled={autoFloorDetectionRunState === "detecting"}
                className="rounded-lg border border-emerald-500/70 px-3 py-2 text-xs text-emerald-200 transition hover:border-emerald-300 hover:text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Run detection for current fixture
              </button>
            </div>
          </div>

          {selectedFixture && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
              <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">
                category: {selectedFixture.category}
              </span>
              <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">
                expected: {selectedFixture.expectedBehavior}
              </span>
              <span className="text-slate-500">{selectedFixture.imageUrl}</span>
            </div>
          )}
          {selectedFixture && selectedFixture.notes.length > 0 && (
            <p className="mt-1 text-[11px] text-slate-400">{selectedFixture.notes.join(" ")}</p>
          )}
          {imageLoadState === "error" && (
            <p className="mt-2 text-[11px] text-rose-300">
              Image failed to load. If this is a fixture, drop the file into{" "}
              <code>public/3d-lab/fixtures/</code> (local/dev-only).
            </p>
          )}

          {/* Compact metrics readout, reusing existing diagnostics */}
          <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-[11px]">
            <div className="mb-1 font-medium text-slate-200">Latest detection readout</div>
            <dl className="grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-2">
              <div className="flex justify-between gap-2">
                <dt className="text-slate-400">fixture</dt>
                <dd className="text-slate-200">
                  {selectedFixture ? `${selectedFixture.label}` : "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-400">provider / model</dt>
                <dd className="text-slate-200">
                  {selectedAutoFloorProviderId}
                  {selectedAutoFloorProviderId === "vision-model" ? ` · ${DEFAULT_AUTO_FLOOR_VISION_MODEL}` : ""}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-400">detection status</dt>
                <dd className="text-slate-200">
                  {autoFloorDetectionRunState}
                  {autoFloorDetectionResult ? ` · ${autoFloorDetectionResult.status}` : ""}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-400">candidates</dt>
                <dd className="text-slate-200">{autoFloorDetectionResult?.candidates.length ?? 0}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-400">selected score / band</dt>
                <dd className="text-slate-200">
                  {selectedAutoFloorCandidateScore
                    ? `${selectedAutoFloorCandidateScore.score.toFixed(2)} · ${selectedAutoFloorCandidateScore.scoreBand}`
                    : "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-400">homography</dt>
                <dd className="text-slate-200">{findDebugValue("homography solve") ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-400">calibrated camera</dt>
                <dd className="text-slate-200">{findDebugValue("camera pose grid status") ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-400">FOV scan</dt>
                <dd className="text-slate-200">{findDebugValue("camera pose FOV scan") ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-400">ray-floor vs homography</dt>
                <dd className="text-slate-200">{findDebugValue("ray-floor click vs homography") ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-400">observations (this fixture)</dt>
                <dd className="text-slate-200">{fixtureObservationCount}</dd>
              </div>
            </dl>
            {selectedAutoFloorCandidateScore && selectedAutoFloorCandidateScore.risks.length > 0 && (
              <p className="mt-2 text-amber-200/90">Risks: {selectedAutoFloorCandidateScore.risks.join(" ")}</p>
            )}
            {autoFloorDetectionFailureReasons.length > 0 && (
              <p className="mt-2 text-rose-300">
                Latest failure: {autoFloorDetectionFailureReasons.join(" | ")}
              </p>
            )}
          </div>

          {/* Manual observation capture (explicit; never automatic) */}
          <div className="mt-3 space-y-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
            <div className="text-[11px] font-medium text-slate-200">Record observation</div>
            <div className="flex flex-col gap-2 md:flex-row">
              <label className="flex-1">
                <span className="text-[11px] text-slate-400">Human assessment</span>
                <select
                  value={fixtureHumanAssessment}
                  onChange={(event) =>
                    setFixtureHumanAssessment(event.target.value as AutoFloorFixtureHumanAssessment)
                  }
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs outline-none focus:border-fuchsia-400"
                >
                  <option value="good">Good</option>
                  <option value="needs_review">Needs review</option>
                  <option value="bad">Bad</option>
                  <option value="expected_failure">Expected failure</option>
                </select>
              </label>
              <label className="flex-1">
                <span className="text-[11px] text-slate-400">Manual correction</span>
                <select
                  value={fixtureManualCorrection}
                  onChange={(event) =>
                    setFixtureManualCorrection(event.target.value as AutoFloorFixtureManualCorrection)
                  }
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs outline-none focus:border-fuchsia-400"
                >
                  <option value="none">None</option>
                  <option value="minor">Minor</option>
                  <option value="major">Major</option>
                  <option value="manual_required">Manual required</option>
                  <option value="not_applicable">Not applicable</option>
                </select>
              </label>
            </div>
            <label className="block">
              <span className="text-[11px] text-slate-400">Notes (optional)</span>
              <input
                type="text"
                value={fixtureObservationNotes}
                onChange={(event) => setFixtureObservationNotes(event.target.value)}
                placeholder="Short note for later analysis"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs outline-none focus:border-fuchsia-400"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleRecordFixtureObservation}
                className="rounded-lg border border-fuchsia-500/70 px-3 py-1.5 text-xs text-fuchsia-200 transition hover:border-fuchsia-300 hover:text-fuchsia-100"
              >
                Record observation
              </button>
              <button
                type="button"
                onClick={handleCopyFixtureObservations}
                disabled={fixtureObservations.length === 0}
                className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Copy observations JSON ({fixtureObservations.length})
              </button>
              <button
                type="button"
                onClick={handleClearFixtureObservations}
                disabled={fixtureObservations.length === 0}
                className="rounded-lg border border-rose-500/60 px-3 py-1.5 text-xs text-rose-200 transition hover:border-rose-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Clear observations
              </button>
            </div>
          </div>

          {fixtureHarnessMessage !== "none" && (
            <p className="mt-2 text-[11px] text-slate-400">{fixtureHarnessMessage}</p>
          )}
        </section>

        <section className="rounded-2xl border border-indigo-500/30 bg-slate-900/70 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-slate-100">Empty-Room Assist (lab)</h2>
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
                emptyRoomAssistEnabled
                  ? "bg-indigo-500/15 text-indigo-200"
                  : "bg-slate-700/40 text-slate-400"
              }`}
            >
              {emptyRoomAssistEnabled ? "available · lab-only" : "disabled on server"}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Empty-room PRIMARY policy (lab): when coordinate-compatible and the empty quad is self-valid with a
            solvable camera pose, the empty-room quad is surfaced as the primary candidate. The original detector is
            diagnostic-only (disagreement never vetoes). A static-region structural-preservation heuristic can only
            downgrade confidence (verified → review) — it never approves, promotes, or auto-applies. Near-standard NBP
            grids (small aspect-ratio drift) are accepted via a narrow aspect-tolerant normalized transfer, which is
            capped at review/medium (never verified). No tokens are charged and nothing is persisted.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleGenerateEmptyRoomAssist}
              disabled={!emptyRoomAssistEnabled || emptyRoomAssistUiStatus === "generating"}
              className="rounded-lg border border-indigo-500/70 px-3 py-1.5 text-xs text-indigo-200 transition hover:border-indigo-300 hover:text-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Generate empty-room assist
            </button>
            <button
              type="button"
              onClick={handleRunAssistedDetection}
              disabled={
                !emptyRoomAssistEnabled ||
                emptyRoomAssistUiStatus === "generating" ||
                emptyRoomAssistUiStatus === "detecting_original" ||
                emptyRoomAssistUiStatus === "detecting_empty" ||
                emptyRoomAssistUiStatus === "validating" ||
                emptyRoomAssistUiStatus === "comparing"
              }
              className="rounded-lg border border-emerald-500/70 px-3 py-1.5 text-xs text-emerald-200 transition hover:border-emerald-300 hover:text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Run assisted detection
            </button>
            <label className="ml-auto flex items-center gap-1.5 text-[11px] text-slate-400">
              <input
                type="checkbox"
                checked={showEmptyRoomAssistDebug}
                onChange={(event) => setShowEmptyRoomAssistDebug(event.target.checked)}
              />
              Show empty-room assist debug
            </label>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">status: {emptyRoomAssistUiStatus}</span>
            {emptyRoomAssistResult && (
              <>
                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">
                  provenance: {emptyRoomAssistResult.assist.recommendationProvenance}
                </span>
                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">
                  tier: {emptyRoomAssistResult.assist.coordinateCompatibility.tier}
                </span>
                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">
                  surfaced: {emptyRoomAssistResult.assist.surfacedSource ?? "none"}
                </span>
                <span
                  className={`rounded px-1.5 py-0.5 ${
                    emptyRoomAssistResult.assist.calibratedCameraEligible
                      ? "bg-emerald-500/15 text-emerald-200"
                      : "bg-amber-500/15 text-amber-200"
                  }`}
                >
                  calibrated camera:{" "}
                  {emptyRoomAssistResult.assist.calibratedCameraEligible ? "available" : "unavailable"}
                </span>
                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">
                  structural: {emptyRoomAssistResult.assist.structuralPreservation?.band ?? "n/a"}
                </span>
                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">
                  agreement: {emptyRoomAssistResult.assist.agreement?.band ?? "n/a"}
                </span>
                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">
                  cache: {emptyRoomAssistResult.assist.emptyRoomCacheStatus}
                </span>
              </>
            )}
          </div>
          {emptyRoomAssistMessage !== "none" && (
            <p className="mt-2 text-[11px] text-slate-400">{emptyRoomAssistMessage}</p>
          )}

          {showEmptyRoomAssistDebug && emptyRoomAssistResult && (
            <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-[11px]">
              <div className="mb-1 font-medium text-slate-200">Assist debug</div>
              <dl className="grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-2">
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-400">compatibility tier</dt>
                  <dd className="text-slate-200">
                    {emptyRoomAssistResult.assist.coordinateCompatibility.tier} (
                    {emptyRoomAssistResult.assist.coordinateCompatibility.transferMode})
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-400">aspect (orig / empty)</dt>
                  <dd className="text-slate-200">
                    {emptyRoomAssistResult.assist.coordinateCompatibility.originalAspect != null
                      ? emptyRoomAssistResult.assist.coordinateCompatibility.originalAspect.toFixed(4)
                      : "—"}{" "}
                    /{" "}
                    {emptyRoomAssistResult.assist.coordinateCompatibility.emptyAspect != null
                      ? emptyRoomAssistResult.assist.coordinateCompatibility.emptyAspect.toFixed(4)
                      : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-400">relative aspect error</dt>
                  <dd className="text-slate-200">
                    {emptyRoomAssistResult.assist.coordinateCompatibility.relativeAspectError != null
                      ? `${(emptyRoomAssistResult.assist.coordinateCompatibility.relativeAspectError * 100).toFixed(2)}%`
                      : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-400">original size</dt>
                  <dd className="text-slate-200">
                    {emptyRoomAssistResult.assist.coordinateCompatibility.originalSize
                      ? `${emptyRoomAssistResult.assist.coordinateCompatibility.originalSize.width}×${emptyRoomAssistResult.assist.coordinateCompatibility.originalSize.height}`
                      : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-400">empty size</dt>
                  <dd className="text-slate-200">
                    {emptyRoomAssistResult.assist.coordinateCompatibility.emptySize
                      ? `${emptyRoomAssistResult.assist.coordinateCompatibility.emptySize.width}×${emptyRoomAssistResult.assist.coordinateCompatibility.emptySize.height}`
                      : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-400">original / empty detection</dt>
                  <dd className="text-slate-200">
                    {emptyRoomAssistResult.assist.originalDetectionStatus} /{" "}
                    {emptyRoomAssistResult.assist.emptyDetectionStatus}
                  </dd>
                </div>
                {emptyRoomAssistResult.assist.emptyDetectionStatus === "failed" &&
                  emptyRoomAssistResult.assist.emptyDetectionFailureReason && (
                    <div className="flex justify-between gap-2 sm:col-span-2">
                      <dt className="text-slate-400">empty detection failure</dt>
                      <dd className="text-right text-amber-200">
                        {emptyRoomAssistResult.assist.emptyDetectionFailureReason}
                      </dd>
                    </div>
                  )}
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-400">candidates (empty / orig)</dt>
                  <dd className="text-slate-200">
                    {emptyRoomAssistResult.assist.extentDiagnostics.emptyCandidateCount} /{" "}
                    {emptyRoomAssistResult.assist.extentDiagnostics.originalCandidateCount}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-400">selected rank / intent</dt>
                  <dd className="text-right text-slate-200">
                    {emptyRoomAssistResult.assist.extentDiagnostics.selectedCandidateRank != null
                      ? `#${emptyRoomAssistResult.assist.extentDiagnostics.selectedCandidateRank}`
                      : "—"}{" "}
                    / {emptyRoomAssistResult.assist.extentDiagnostics.selectedCandidateIntent ?? "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-400">selected / largest area ratio</dt>
                  <dd className="text-slate-200">
                    {emptyRoomAssistResult.assist.extentDiagnostics.selectedVsLargestAreaRatio != null
                      ? emptyRoomAssistResult.assist.extentDiagnostics.selectedVsLargestAreaRatio.toFixed(3)
                      : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-400">opening ambiguity</dt>
                  <dd className="text-slate-200">
                    {emptyRoomAssistResult.assist.extentDiagnostics.openingAmbiguityFlag ? "yes" : "no"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-400">retry</dt>
                  <dd className="text-slate-200">
                    {emptyRoomAssistResult.assist.extentDiagnostics.retryOccurred
                      ? emptyRoomAssistResult.assist.extentDiagnostics.retryReason ?? "yes"
                      : "none"}
                  </dd>
                </div>
                <div className="mt-1 border-t border-slate-700/60 pt-1 text-[10px] uppercase tracking-wide text-slate-500">
                  same-plane consensus (diagnostic only)
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-400">pose-scan (eligible / valid)</dt>
                  <dd className="text-slate-200">
                    {emptyRoomAssistResult.assist.multiCandidateConsensus.eligibleCandidateCount} /{" "}
                    {emptyRoomAssistResult.assist.multiCandidateConsensus.poseValidCandidateCount}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-400">consensus status</dt>
                  <dd className="text-right text-slate-200">
                    {emptyRoomAssistResult.assist.multiCandidateConsensus.samePlaneConsensusStatus}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-400">shared FOV range</dt>
                  <dd className="text-slate-200">
                    {emptyRoomAssistResult.assist.multiCandidateConsensus.sharedFovRange
                      ? `${emptyRoomAssistResult.assist.multiCandidateConsensus.sharedFovRange[0]}–${emptyRoomAssistResult.assist.multiCandidateConsensus.sharedFovRange[1]}°`
                      : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-400">best-FOV spread</dt>
                  <dd className="text-slate-200">
                    {emptyRoomAssistResult.assist.multiCandidateConsensus.bestFovSpreadDeg != null
                      ? `${emptyRoomAssistResult.assist.multiCandidateConsensus.bestFovSpreadDeg}°`
                      : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-400">consensus indexes</dt>
                  <dd className="text-right text-slate-200">
                    {emptyRoomAssistResult.assist.multiCandidateConsensus.consensusCandidateIndexes.length > 0
                      ? emptyRoomAssistResult.assist.multiCandidateConsensus.consensusCandidateIndexes
                          .map((i) => `#${i}`)
                          .join(", ")
                      : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-400">clamped in consensus</dt>
                  <dd className="text-slate-200">
                    {emptyRoomAssistResult.assist.multiCandidateConsensus.hasClampedCandidateInConsensus
                      ? "yes (cautioned)"
                      : "no"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-400">advisory anchor</dt>
                  <dd className="text-right text-slate-200">
                    {emptyRoomAssistResult.assist.multiCandidateConsensus.advisoryPreferredAnchorIndex != null
                      ? `#${emptyRoomAssistResult.assist.multiCandidateConsensus.advisoryPreferredAnchorIndex}`
                      : "—"}
                  </dd>
                </div>
                {emptyRoomAssistResult.assist.multiCandidateConsensus.advisoryPreferredAnchorReason ? (
                  <div className="text-[11px] text-slate-400">
                    advisory: {emptyRoomAssistResult.assist.multiCandidateConsensus.advisoryPreferredAnchorReason}
                  </div>
                ) : null}
                {emptyRoomAssistResult.assist.multiCandidateConsensus.note ? (
                  <div className="text-[11px] text-slate-500">
                    {emptyRoomAssistResult.assist.multiCandidateConsensus.note}
                  </div>
                ) : null}
                <div className="mt-1 border-t border-slate-700/60 pt-1 text-[10px] uppercase tracking-wide text-slate-500">
                  agreement (diagnostic)
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-400">IoU</dt>
                  <dd className="text-slate-200">
                    {emptyRoomAssistResult.assist.agreement?.iou != null
                      ? emptyRoomAssistResult.assist.agreement.iou.toFixed(3)
                      : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-400">mean / max corner dist</dt>
                  <dd className="text-slate-200">
                    {emptyRoomAssistResult.assist.agreement?.meanCornerDistance != null
                      ? emptyRoomAssistResult.assist.agreement.meanCornerDistance.toFixed(4)
                      : "—"}{" "}
                    /{" "}
                    {emptyRoomAssistResult.assist.agreement?.maxCornerDistance != null
                      ? emptyRoomAssistResult.assist.agreement.maxCornerDistance.toFixed(4)
                      : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-400">area agreement</dt>
                  <dd className="text-slate-200">
                    {emptyRoomAssistResult.assist.agreement?.areaAgreement != null
                      ? emptyRoomAssistResult.assist.agreement.areaAgreement.toFixed(3)
                      : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-400">geometry-confident (both)</dt>
                  <dd className="text-slate-200">
                    {emptyRoomAssistResult.assist.poseCompatSummary
                      ? emptyRoomAssistResult.assist.poseCompatSummary.bothGeometryConfident
                        ? "yes"
                        : "no"
                      : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-400">surfaced / ceiling</dt>
                  <dd className="text-slate-200">
                    {emptyRoomAssistResult.assist.surfacedSource ?? "none"} /{" "}
                    {emptyRoomAssistResult.assist.confidenceCeiling ?? "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-400">floor proposal / calibrated camera</dt>
                  <dd className="text-slate-200">
                    {emptyRoomAssistResult.assist.surfacedSource === "empty" ? "valid" : "—"} /{" "}
                    {emptyRoomAssistResult.assist.calibratedCameraEligible
                      ? "available"
                      : emptyRoomAssistResult.assist.surfacedSource === "empty"
                        ? "camera pose needs adjustment"
                        : "unavailable"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-400">empty self-validity</dt>
                  <dd className="text-slate-200">
                    {emptyRoomAssistResult.assist.emptyQuadSelfValidity
                      ? `band ${emptyRoomAssistResult.assist.emptyQuadSelfValidity.band ?? "—"} · pose ${
                          emptyRoomAssistResult.assist.emptyQuadSelfValidity.cameraPoseOk ? "ok" : "fail"
                        } (${emptyRoomAssistResult.assist.emptyQuadSelfValidity.cameraPoseConfidence ?? "—"})`
                      : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-400">camera pose FOV scan</dt>
                  <dd className="text-slate-200">
                    {emptyRoomAssistResult.assist.emptyQuadSelfValidity
                      ? `best ${
                          emptyRoomAssistResult.assist.emptyQuadSelfValidity.cameraPoseBestFovDeg != null
                            ? `${emptyRoomAssistResult.assist.emptyQuadSelfValidity.cameraPoseBestFovDeg}°`
                            : "—"
                        } · ${emptyRoomAssistResult.assist.emptyQuadSelfValidity.cameraPoseValidFovCount} valid${
                          emptyRoomAssistResult.assist.emptyQuadSelfValidity.cameraPoseValidFovRange
                            ? ` (${emptyRoomAssistResult.assist.emptyQuadSelfValidity.cameraPoseValidFovRange[0]}–${emptyRoomAssistResult.assist.emptyQuadSelfValidity.cameraPoseValidFovRange[1]}°)`
                            : ""
                        }`
                      : "—"}
                  </dd>
                </div>
                {emptyRoomAssistResult.assist.emptyQuadSelfValidity?.cameraPoseReason && (
                  <div className="flex justify-between gap-2 sm:col-span-2">
                    <dt className="text-slate-400">camera pose reason</dt>
                    <dd className="text-right text-slate-200">
                      {emptyRoomAssistResult.assist.emptyQuadSelfValidity.cameraPoseReason}
                    </dd>
                  </div>
                )}
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-400">structural heuristic</dt>
                  <dd className="text-slate-200">
                    {emptyRoomAssistResult.assist.structuralPreservation
                      ? `${emptyRoomAssistResult.assist.structuralPreservation.band}${
                          emptyRoomAssistResult.assist.structuralPreservation.score != null
                            ? ` (${emptyRoomAssistResult.assist.structuralPreservation.score.toFixed(3)})`
                            : ""
                        }`
                      : "—"}
                  </dd>
                </div>
              </dl>
              {emptyRoomAssistResult.assist.policyReasons.length > 0 && (
                <div className="mt-2">
                  <div className="text-slate-400">policy reasons</div>
                  <ul className="mt-1 list-disc pl-4 text-slate-300">
                    {emptyRoomAssistResult.assist.policyReasons.map((reason, idx) => (
                      <li key={idx}>{reason}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="mt-2 text-[11px] text-slate-500">
                Structural-preservation is a lab-tunable heuristic over static room-shell regions (upper wall/ceiling,
                side-wall strips, far-wall band; lower-center floor excluded). It is downgrade-only — never an approval
                gate. Empty-room preview is intentionally withheld: the generated image is server-side only with no
                lab-only safe-serving mechanism yet. Only derived metadata/statuses are shown.
              </p>
            </div>
          )}
        </section>

        <CollapsibleSection
          title="Calibrated camera"
          description="Scan-first camera calibration from your floor corners."
          open={isCalibratedCameraOpen}
          onToggle={() => setIsCalibratedCameraOpen((prev) => !prev)}
        >
          <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-medium text-slate-200">Calibration readiness</h3>
              <span
                className={
                  calibrationReadiness.overall === "ready"
                    ? "rounded-full border border-emerald-500/60 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-300"
                    : calibrationReadiness.overall === "adjust"
                      ? "rounded-full border border-amber-500/60 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-300"
                      : "rounded-full border border-rose-500/60 bg-rose-500/10 px-2 py-0.5 text-xs font-medium text-rose-300"
                }
              >
                {calibrationReadiness.overallLabel}
              </span>
            </div>
            <ul className="mt-3 space-y-1.5">
              {calibrationReadiness.checklist.map((item) => (
                <li key={item.key} className="flex items-start gap-2 text-xs">
                  <span
                    aria-hidden="true"
                    className={
                      item.state === "pass"
                        ? "mt-0.5 text-emerald-400"
                        : item.state === "attention"
                          ? "mt-0.5 text-amber-400"
                          : item.state === "fail"
                            ? "mt-0.5 text-rose-400"
                            : "mt-0.5 text-slate-500"
                    }
                  >
                    ●
                  </span>
                  <span className="shrink-0 text-slate-400">{item.label}:</span>
                  <span className="text-slate-200">{item.detail}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 border-t border-slate-800 pt-2 text-xs">
              <p className="text-slate-300">{calibrationReadiness.largestCvResidualText}</p>
              <p className="mt-1 text-slate-300">{calibrationReadiness.largestRenderedResidualText}</p>
              <p className="mt-1 text-slate-300">{calibrationReadiness.largestDifferenceText}</p>
              <p className="mt-1 text-slate-500">{calibrationReadiness.differenceDiagnosticNote}</p>
              <p className="mt-2 text-slate-200">{calibrationReadiness.mainBlockingContributorTitle}</p>
              {calibrationReadiness.mainBlockingContributorDetail ? (
                <p className="mt-1 text-slate-400">{calibrationReadiness.mainBlockingContributorDetail}</p>
              ) : null}
            </div>
          </div>

          <div className="mt-3 rounded-lg border border-slate-700 bg-slate-950/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-medium text-slate-200">Visual preview</h3>
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={showHomographyDebugOverlay}
                  onChange={(event) => setShowHomographyDebugOverlay(event.target.checked)}
                  className="accent-emerald-400"
                />
                Show floor fit preview
              </label>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Shows how the selected floor corners map onto the visible floor. This is a floor-mapping preview only —
              it does not confirm camera calibration or that Apply is ready.
            </p>

            <ul className="mt-3 space-y-1.5">
              <li className="flex items-start gap-2 text-xs">
                <span
                  aria-hidden="true"
                  className={
                    calibrationReadiness.floorFitPreviewAvailable ? "mt-0.5 text-emerald-400" : "mt-0.5 text-slate-600"
                  }
                >
                  ●
                </span>
                <span className="text-slate-200">
                  Floor fit preview {calibrationReadiness.floorFitPreviewAvailable ? "available" : "unavailable"}
                </span>
                <span className="text-slate-500">— green solid grid</span>
              </li>
              <li className="flex items-start gap-2 text-xs">
                <span
                  aria-hidden="true"
                  className={
                    calibrationReadiness.cameraPosePreviewAvailable ? "mt-0.5 text-cyan-300" : "mt-0.5 text-slate-600"
                  }
                >
                  ●
                </span>
                <span className="text-slate-200">
                  Camera pose preview {calibrationReadiness.cameraPosePreviewAvailable ? "available" : "unavailable"}
                </span>
                <span className="text-slate-500">— cyan dashed grid (current FOV)</span>
              </li>
              <li className="flex items-start gap-2 text-xs">
                <span
                  aria-hidden="true"
                  className={calibrationReadiness.applyReady ? "mt-0.5 text-emerald-400" : "mt-0.5 text-slate-600"}
                >
                  ●
                </span>
                <span className="text-slate-200">
                  Calibration {calibrationReadiness.applyReady ? "ready to apply" : "not ready to apply"}
                </span>
                <span className="text-slate-500">— all safety checks</span>
              </li>
            </ul>

            {calibrationReadiness.cameraPosePreviewAvailable && !calibrationReadiness.applyReady ? (
              <div className="mt-3 rounded border border-amber-500/60 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-200">
                Camera pose preview is visible, but calibration still needs additional checks:{" "}
                {calibrationReadiness.applyReason}
              </div>
            ) : (
              <p className="mt-3 text-xs text-slate-500">
                The cyan grid previews the current camera pose. It is not confirmation that calibration is ready to
                apply.
              </p>
            )}

            {showHomographyDebugOverlay && (
              <div className="mt-3 space-y-1 border-t border-slate-800 pt-2 text-xs">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0 font-medium text-emerald-400">Green solid grid</span>
                  <span className="text-slate-400">
                    Floor fit preview — the floor mapping is valid enough to preview.
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0 font-medium text-cyan-300">Cyan dashed grid</span>
                  <span className="text-slate-400">
                    Camera pose preview — a camera-pose candidate exists at the current FOV.
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0 font-medium text-emerald-300">Emerald indicator</span>
                  <span className="text-slate-400">
                    Ready to apply — all existing calibrated-camera safety checks pass.
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="mt-3 rounded-lg border border-slate-700 bg-slate-950/60 p-3">
            <h3 className="text-xs font-medium text-slate-200">Recommended lens (FOV)</h3>
            <p className="mt-1 text-sm text-slate-100">{calibrationReadiness.recommendationText}</p>
            <p className="mt-1 text-xs text-slate-500">
              Calculated from the current floor corners and floor dimensions.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  if (calibrationReadiness.recommendedFov === null) return;
                  setScanAndApplyResult(null);
                  setCameraPoseFovYDeg(calibrationReadiness.recommendedFov);
                }}
                disabled={calibrationReadiness.recommendedFov === null || pendingScanAndApplyFov !== null}
                className="rounded border border-emerald-500/70 px-2 py-1 font-medium text-emerald-200 transition hover:border-emerald-300 hover:text-emerald-100 disabled:cursor-not-allowed disabled:border-slate-700 disabled:text-slate-500 disabled:opacity-60"
              >
                Use recommended FOV
              </button>
              {calibrationReadiness.recommendedFov === null ? (
                <span className="text-slate-500">No recommendation yet — refine the floor corners or dimensions.</span>
              ) : cameraPoseFovYDeg === calibrationReadiness.recommendedFov ? (
                <span className="text-emerald-300">
                  Using recommended FOV: {calibrationReadiness.recommendedFov}°
                </span>
              ) : (
                <span className="text-slate-500">
                  Current FOV {formatNumber(cameraPoseFovYDeg)}° — click to use{" "}
                  {calibrationReadiness.recommendedFov}°.
                </span>
              )}
            </div>
            <div className="mt-3 border-t border-slate-800 pt-2 text-xs">
              <p className="text-slate-300">{calibrationReadiness.fovScanRangesTitle}</p>
              <p className="mt-1 text-slate-300">Valid pose samples: {calibrationReadiness.validFovSampleText}</p>
              <p className="mt-1 text-slate-300">
                High-confidence samples: {calibrationReadiness.highConfidenceFovSampleText}
              </p>
              <p className="mt-1 text-slate-300">
                {calibrationReadiness.applySafeAtCurrentFovText === "Unavailable"
                  ? "Apply-safe at current FOV"
                  : `Apply-safe at current FOV (${formatNumber(cameraPoseFovYDeg)}°)`}
                :{" "}
                {calibrationReadiness.applySafeAtCurrentFovText}
              </p>
              <p className="mt-1 text-slate-500">{calibrationReadiness.currentFovMembershipText}</p>
              <p className="mt-1 text-slate-500">{calibrationReadiness.fovScanApplySafetyNote}</p>
            </div>
          </div>

          <div className="mt-3 rounded-lg border border-slate-700 bg-slate-950/60 p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  if (
                    calibrationReadiness.recommendedFov === null ||
                    isCalibratedCameraActive ||
                    pendingScanAndApplyFov !== null
                  ) {
                    return;
                  }
                  setScanAndApplyResult(null);
                  setCameraPoseFovYDeg(calibrationReadiness.recommendedFov);
                  setPendingScanAndApplyFov(calibrationReadiness.recommendedFov);
                }}
                disabled={
                  calibrationReadiness.recommendedFov === null ||
                  isCalibratedCameraActive ||
                  pendingScanAndApplyFov !== null
                }
                className="rounded border border-cyan-500/70 px-2 py-1 font-medium text-cyan-200 transition hover:border-cyan-300 hover:text-cyan-100 disabled:cursor-not-allowed disabled:border-slate-700 disabled:text-slate-500 disabled:opacity-60"
              >
                {pendingScanAndApplyFov !== null ? "Checking recommended FOV…" : "Scan & apply calibration"}
              </button>
              <span className="text-slate-500">
                {calibrationReadiness.recommendedFov === null
                  ? "No recommendation yet — refine the floor corners or dimensions."
                  : isCalibratedCameraActive
                    ? "Calibrated camera is already active."
                    : "Uses the recommended FOV, then applies only if all existing safety checks pass."}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Scan &amp; apply uses the same checks as Apply calibration. It never applies based on the scan result
              alone.
            </p>
            {scanAndApplyResult?.kind === "applied" && isCalibratedCameraActive && (
              <p className="mt-2 text-xs text-emerald-300">
                Calibration applied using recommended FOV: {scanAndApplyResult.fov}°
              </p>
            )}
            {scanAndApplyResult?.kind === "blocked" &&
              !isCalibratedCameraActive &&
              !calibratedCameraApplyStatus.available && (
                <p className="mt-2 text-xs text-amber-300/90">
                  Recommended FOV applied, but calibration was not applied: {calibratedCameraApplyStatus.reason}
                </p>
              )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => {
                const candidate = cameraPoseDebug.applyCandidate;
                if (!candidate || !calibratedCameraApplyStatus.available) return;
                setScanAndApplyResult(null);
                applyCalibratedCameraSnapshotFromCandidate(candidate, cameraPoseFovYDeg);
              }}
              disabled={!calibratedCameraApplyStatus.available || pendingScanAndApplyFov !== null}
              className="rounded border border-slate-700 px-2 py-1 text-slate-200 transition hover:border-cyan-400/80 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Apply calibration
            </button>
            <button
              type="button"
              onClick={() => {
                deactivateCalibratedCameraMode({ clearAutoRevertReason: true });
              }}
              disabled={!isCalibratedCameraActive && !calibratedCameraSnapshot}
              className="rounded border border-slate-700 px-2 py-1 text-slate-200 transition hover:border-rose-400/80 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Revert to legacy camera
            </button>
            <button
              type="button"
              onClick={handleCalibratedDropToFloor}
              disabled={!calibratedDropToFloorAvailable}
              className="rounded border border-slate-700 px-2 py-1 text-slate-200 transition hover:border-violet-400/80 hover:text-violet-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Drop to floor
            </button>
          </div>
          <p
            className={
              calibratedCameraApplyStatus.available
                ? "mt-2 text-xs text-emerald-300"
                : "mt-2 text-xs text-amber-300/90"
            }
          >
            {calibratedCameraApplyStatus.available
              ? "Calibration is ready to apply."
              : `Not ready: ${calibratedCameraApplyStatus.reason}`}
          </p>
          {(isCalibratedCameraActive || calibratedCameraSnapshot) && (
            <p className="mt-1 text-xs text-slate-500">
              Frame match: {calibratedCameraFrameMatchStatus.value}
            </p>
          )}

          <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs text-slate-400">
            <li>Set the four floor corners.</li>
            <li>Confirm the green floor grid follows the visible floor.</li>
            <li>Use the recommended FOV.</li>
            <li>Review readiness, then apply calibration.</li>
          </ol>
          <p className="mt-2 text-xs text-slate-500">
            The floor fit preview checks the floor mapping. Camera calibration also checks lens fit and
            projection agreement, so a matching grid alone does not prove calibration is ready.
          </p>
        </CollapsibleSection>

        <CollapsibleSection
          title="Advanced calibration"
          description="Manual transform, model normalization, floor mapping, and perspective depth scaling."
          open={isAdvancedControlsOpen}
          onToggle={() => setIsAdvancedControlsOpen((prev) => !prev)}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-medium text-slate-200">Manual transform</h3>
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={autoRotateEnabled}
                onChange={(event) => setAutoRotateEnabled(event.target.checked)}
                className="accent-emerald-400"
              />
              Auto-rotate
            </label>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <TransformControlRow
              label="Position X"
              value={transform.positionX}
              min={TRANSFORM_LIMITS.positionX.min}
              max={TRANSFORM_LIMITS.positionX.max}
              step={TRANSFORM_LIMITS.positionX.step}
              onChange={(value) => updateTransformField("positionX", value)}
            />
            <TransformControlRow
              label="Position Y"
              value={transform.positionY}
              min={TRANSFORM_LIMITS.positionY.min}
              max={TRANSFORM_LIMITS.positionY.max}
              step={TRANSFORM_LIMITS.positionY.step}
              onChange={(value) => updateTransformField("positionY", value)}
            />
            <TransformControlRow
              label="Position Z"
              value={transform.positionZ}
              min={TRANSFORM_LIMITS.positionZ.min}
              max={TRANSFORM_LIMITS.positionZ.max}
              step={TRANSFORM_LIMITS.positionZ.step}
              onChange={(value) => updateTransformField("positionZ", value)}
            />
            <TransformControlRow
              label="Rotation Y (deg)"
              value={transform.rotationYDeg}
              min={TRANSFORM_LIMITS.rotationYDeg.min}
              max={TRANSFORM_LIMITS.rotationYDeg.max}
              step={TRANSFORM_LIMITS.rotationYDeg.step}
              onChange={(value) => updateTransformField("rotationYDeg", value)}
            />
            <TransformControlRow
              label="Uniform Scale"
              value={transform.uniformScale}
              min={TRANSFORM_LIMITS.uniformScale.min}
              max={TRANSFORM_LIMITS.uniformScale.max}
              step={TRANSFORM_LIMITS.uniformScale.step}
              onChange={(value) => updateTransformField("uniformScale", value)}
            />
          </div>
          <div className="mt-4 border-t border-slate-800 pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-medium text-slate-200">Model normalization</h3>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={autoNormalizeBoundsEnabled}
                    onChange={(event) => setAutoNormalizeBoundsEnabled(event.target.checked)}
                    className="accent-emerald-400"
                  />
                  Auto-normalize model bounds
                </label>
                <button
                  type="button"
                  onClick={handleResetModelNormalization}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200"
                >
                  Reset normalization
                </button>
              </div>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Normalization corrects the loaded model itself (floor contact, facing, native scale). Transform controls
              still place the object in the room. Auto-normalize measures each loaded model&apos;s bounds and applies
              floor contact, X/Z centering, and target-size scaling automatically; the sliders below layer on top.
            </p>
            <div className="mt-2 grid gap-2 md:grid-cols-3">
              <TransformControlRow
                label="Model Y offset"
                value={modelNormalization.modelYOffset}
                min={MODEL_NORMALIZATION_LIMITS.modelYOffset.min}
                max={MODEL_NORMALIZATION_LIMITS.modelYOffset.max}
                step={MODEL_NORMALIZATION_LIMITS.modelYOffset.step}
                onChange={(value) => updateModelNormalizationField("modelYOffset", value)}
              />
              <TransformControlRow
                label="Model yaw offset (deg)"
                value={modelNormalization.modelYawOffsetDeg}
                min={MODEL_NORMALIZATION_LIMITS.modelYawOffsetDeg.min}
                max={MODEL_NORMALIZATION_LIMITS.modelYawOffsetDeg.max}
                step={MODEL_NORMALIZATION_LIMITS.modelYawOffsetDeg.step}
                onChange={(value) => updateModelNormalizationField("modelYawOffsetDeg", value)}
              />
              <TransformControlRow
                label="Model scale multiplier"
                value={modelNormalization.modelScaleMultiplier}
                min={MODEL_NORMALIZATION_LIMITS.modelScaleMultiplier.min}
                max={MODEL_NORMALIZATION_LIMITS.modelScaleMultiplier.max}
                step={MODEL_NORMALIZATION_LIMITS.modelScaleMultiplier.step}
                onChange={(value) => updateModelNormalizationField("modelScaleMultiplier", value)}
              />
            </div>
          </div>
          <div className="mt-4 border-t border-slate-800 pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-medium text-slate-200">Floor mapping tuning</h3>
              <button
                type="button"
                onClick={handleResetFloorMapping}
                disabled={isCalibratedCameraActive}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Reset mapping
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              World size and depth center used to map floor clicks to 3D placement. Use Auto-fit from floor in Basic
              controls to estimate these from the polygon.
            </p>
            {isCalibratedCameraActive && (
              <p className="mt-1 text-xs text-amber-300">{LEGACY_FLOOR_MAPPING_DISABLED_MESSAGE}</p>
            )}
            <div className="mt-3 grid gap-2 md:grid-cols-3">
              <TransformControlRow
                label="World width"
                value={floorMapping.worldWidth}
                min={FLOOR_MAPPING_LIMITS.worldWidth.min}
                max={FLOOR_MAPPING_LIMITS.worldWidth.max}
                step={FLOOR_MAPPING_LIMITS.worldWidth.step}
                disabled={isCalibratedCameraActive}
                onChange={(value) => updateFloorMappingField("worldWidth", value)}
              />
              <TransformControlRow
                label="World depth"
                value={floorMapping.worldDepth}
                min={FLOOR_MAPPING_LIMITS.worldDepth.min}
                max={FLOOR_MAPPING_LIMITS.worldDepth.max}
                step={FLOOR_MAPPING_LIMITS.worldDepth.step}
                disabled={isCalibratedCameraActive}
                onChange={(value) => updateFloorMappingField("worldDepth", value)}
              />
              <TransformControlRow
                label="Depth center Y"
                value={floorMapping.depthCenterY}
                min={FLOOR_MAPPING_LIMITS.depthCenterY.min}
                max={FLOOR_MAPPING_LIMITS.depthCenterY.max}
                step={FLOOR_MAPPING_LIMITS.depthCenterY.step}
                disabled={isCalibratedCameraActive}
                onChange={(value) => updateFloorMappingField("depthCenterY", value)}
              />
            </div>
          </div>
          <div className="mt-4 border-t border-slate-800 pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-medium text-slate-200">Perspective depth scaling</h3>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={perspectiveDepthScaling.enabled}
                    onChange={(event) =>
                      setPerspectiveDepthScaling((prev) => ({ ...prev, enabled: event.target.checked }))
                    }
                    className="accent-emerald-400"
                  />
                  Auto-scale by floor depth
                </label>
                <button
                  type="button"
                  onClick={handleResetPerspectiveDepthScaling}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200"
                >
                  Reset depth scaling
                </button>
              </div>
            </div>
            {perspectiveDepthScaling.enabled && !lastAcceptedFloorClick && (
              <p className="mt-2 text-xs text-amber-300">
                Click inside the floor polygon to set an anchor so depth scaling can be applied.
              </p>
            )}
            {depthNearFarOrderingWarning && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <p className="text-xs text-amber-300">{depthNearFarOrderingWarning}</p>
                <button
                  type="button"
                  onClick={handleFixPerspectiveNearFarOrder}
                  className="rounded-lg border border-amber-500/70 px-2 py-1 text-[11px] text-amber-200 transition hover:border-amber-300 hover:text-amber-100"
                >
                  Fix near/far order
                </button>
              </div>
            )}
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <TransformControlRow
                label="Near scale multiplier"
                value={perspectiveDepthScaling.nearScaleMultiplier}
                min={PERSPECTIVE_DEPTH_SCALING_LIMITS.nearScaleMultiplier.min}
                max={PERSPECTIVE_DEPTH_SCALING_LIMITS.nearScaleMultiplier.max}
                step={PERSPECTIVE_DEPTH_SCALING_LIMITS.nearScaleMultiplier.step}
                onChange={(value) => updatePerspectiveDepthScalingField("nearScaleMultiplier", value)}
              />
              <TransformControlRow
                label="Far scale multiplier"
                value={perspectiveDepthScaling.farScaleMultiplier}
                min={PERSPECTIVE_DEPTH_SCALING_LIMITS.farScaleMultiplier.min}
                max={PERSPECTIVE_DEPTH_SCALING_LIMITS.farScaleMultiplier.max}
                step={PERSPECTIVE_DEPTH_SCALING_LIMITS.farScaleMultiplier.step}
                onChange={(value) => updatePerspectiveDepthScalingField("farScaleMultiplier", value)}
              />
              <TransformControlRow
                label="Near floor Y"
                value={perspectiveDepthScaling.nearFloorY}
                min={PERSPECTIVE_DEPTH_SCALING_LIMITS.nearFloorY.min}
                max={PERSPECTIVE_DEPTH_SCALING_LIMITS.nearFloorY.max}
                step={PERSPECTIVE_DEPTH_SCALING_LIMITS.nearFloorY.step}
                onChange={(value) => updatePerspectiveDepthScalingField("nearFloorY", value)}
              />
              <TransformControlRow
                label="Far floor Y"
                value={perspectiveDepthScaling.farFloorY}
                min={PERSPECTIVE_DEPTH_SCALING_LIMITS.farFloorY.min}
                max={PERSPECTIVE_DEPTH_SCALING_LIMITS.farFloorY.max}
                step={PERSPECTIVE_DEPTH_SCALING_LIMITS.farFloorY.step}
                onChange={(value) => updatePerspectiveDepthScalingField("farFloorY", value)}
              />
            </div>
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          title="Scene state & local draft"
          description="Export, import, and local draft persistence."
          open={isSceneStateOpen}
          onToggle={() => setIsSceneStateOpen((prev) => !prev)}
          contentClassName="px-3 pb-3"
        >
          <SceneJsonPanel
            sceneJsonPreview={sceneStateJson}
            sceneStateExportedAt={sceneStateExportedAt}
            exportStatus={sceneJsonStatus}
            importTextValue={importSceneJsonInput}
            importStatus={importSceneStatus}
            localDraftStatus={localDraftStatus}
            localDraftLastSavedAt={localDraftLastSavedAt}
            onCopySceneJson={handleCopySceneJson}
            onDownloadSceneJson={handleDownloadSceneJson}
            onImportTextChange={setImportSceneJsonInput}
            onApplyImport={handleApplyImportedSceneJson}
            onClearImport={handleClearImportedSceneJson}
            onSaveLocalDraft={handleSaveLocalDraft}
            onRestoreLocalDraft={handleRestoreLocalDraft}
            onClearLocalDraft={handleClearLocalDraft}
          />
        </CollapsibleSection>

        <CollapsibleSection
          title="Debug status"
          description="Full diagnostic rows and default asset path."
          open={isDebugOpen}
          onToggle={() => setIsDebugOpen((prev) => !prev)}
        >
          <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-slate-300">
            <span className="text-slate-400">Floor-click mapping</span>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="floor-click-mapping-mode"
                value="legacy"
                checked={floorClickMappingMode === "legacy"}
                onChange={() => setFloorClickMappingMode("legacy")}
                className="accent-emerald-400"
              />
              Legacy (default)
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="floor-click-mapping-mode"
                value="homography-experimental"
                checked={floorClickMappingMode === "homography-experimental"}
                onChange={() => setFloorClickMappingMode("homography-experimental")}
                className="accent-emerald-400"
              />
              Homography (experimental)
            </label>
          </div>
          <p className="mb-3 text-xs text-amber-300/80">
            Experimental: homography floor-click mapping may not visually improve until camera pose is applied.
          </p>
          <label className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-300">
            <span className="text-slate-400">Manual FOV override (advanced)</span>
            <input
              type="number"
              min={20}
              max={90}
              step={1}
              value={cameraPoseFovYDeg}
              onChange={(event) => {
                const parsed = Number.parseFloat(event.target.value);
                if (!Number.isFinite(parsed)) return;
                setCameraPoseFovYDeg(clampValue(parsed, 20, 90));
              }}
              className="w-20 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
            />
            <span className="text-slate-500">(20-90)</span>
          </label>
          <p className="mb-3 text-xs text-slate-500">
            Advanced/debug only. For the normal workflow use the Calibrated camera panel above (Use recommended FOV,
            then Apply calibration). The camera-pose FOV scan and reprojection rows below are diagnostics; the
            cyan/green overlays alone do not prove calibration is ready.
          </p>
          <label className="mb-1 flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={showHomographyDebugOverlay}
              onChange={(event) => setShowHomographyDebugOverlay(event.target.checked)}
              className="accent-emerald-400"
            />
            Calibration preview overlays (floor fit + camera pose)
          </label>
          <p className="mb-3 text-xs text-slate-500">
            Same overlay state as &quot;Show floor fit preview&quot; in the Calibrated camera panel above; the two
            controls stay in sync. Green = floor fit; cyan dashed = camera-pose preview at the current FOV.
          </p>
          <div className="grid gap-2 text-xs text-slate-300 md:grid-cols-2">
            {debugRows.map((row) => (
              <p key={row.label} className="rounded border border-slate-800 bg-slate-950/70 px-2 py-1">
                <span className="text-slate-500">{row.label}:</span> {row.value}
              </p>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Default local asset path: <code>{DEFAULT_MODEL_GLB_PATH}</code>
          </p>
        </CollapsibleSection>
      </div>
    </main>
  );
}
