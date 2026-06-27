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
import { normToPixels, type ImageFrameSize, type ImageIntrinsicSize } from "./image-space";
import {
  applyHomography,
  buildCameraIntrinsicsFromFov,
  computeReprojectionError,
  decomposeHomographyToCameraPose,
  floorVec3ToPlane2D,
  getFloorRectCorners,
  type HomographyMatrix,
  invertHomography,
  orderFloorCorners,
  projectFloorPointThroughCameraPoseCv,
  projectFloorPointThroughPose,
  scanCameraPoseOverFov,
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
const CALIBRATED_CAMERA_APPLY_MAX_CV_AVG_PX = 4;
const CALIBRATED_CAMERA_APPLY_MAX_CV_MAX_PX = 10;
const CALIBRATED_CAMERA_APPLY_MAX_DISPLAY_AVG_PX = 10;
const CALIBRATED_CAMERA_APPLY_MAX_DISPLAY_MAX_PX = 10;
const CALIBRATED_CAMERA_APPLY_MAX_AVG_DELTA_PX = 1;
const CALIBRATED_CAMERA_APPLY_MAX_MAX_DELTA_PX = 1;
const CALIBRATED_CAMERA_APPLY_MIN_SCALE_RATIO = 0.85;
const CALIBRATED_CAMERA_APPLY_MAX_SCALE_RATIO = 1.18;
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

    if (!homographyDebug.frameSize) {
      unavailableReason = "frame pixel size unavailable";
      rows.push({
        label: "camera pose diagnostic",
        value: "fail (frame pixel size unavailable)",
      });
      return makeResult();
    }
    if (homographyDebug.homographySolveStatus !== "ok" || !homographyDebug.homographyMatrixForPlacement) {
      unavailableReason = homographyDebug.placementFallbackReason;
      rows.push({
        label: "camera pose diagnostic",
        value: `fail (${homographyDebug.placementFallbackReason})`,
      });
      return makeResult();
    }

    const intrinsicsResult = buildCameraIntrinsicsFromFov(homographyDebug.frameSize, cameraPoseFovYDeg);
    if (!intrinsicsResult.ok) {
      unavailableReason = intrinsicsResult.reason;
      rows.push({
        label: "camera pose diagnostic",
        value: `fail (${intrinsicsResult.reason})`,
      });
      return makeResult();
    }

    if (!homographyDebug.orderedCornersNorm) {
      unavailableReason = "ordered homography corners unavailable";
      rows.push({
        label: "camera pose diagnostic",
        value: "fail (ordered homography corners unavailable)",
      });
      return makeResult();
    }
    const imagePointsPx: { x: number; y: number }[] = [];
    for (const point of homographyDebug.orderedCornersNorm) {
      const pixels = normToPixels(point, homographyDebug.frameSize);
      if (!pixels) {
        unavailableReason = "could not convert ordered corners from normalized -> pixels";
        rows.push({
          label: "camera pose diagnostic",
          value: "fail (could not convert ordered corners from normalized -> pixels)",
        });
        return makeResult();
      }
      imagePointsPx.push(pixels);
    }
    const floorRectResult = getFloorRectCorners({
      widthMeters: floorMapping.worldWidth,
      depthMeters: floorMapping.worldDepth,
    });
    if (!floorRectResult.ok) {
      unavailableReason = floorRectResult.reason;
      rows.push({
        label: "camera pose diagnostic",
        value: `fail (${floorRectResult.reason})`,
      });
      return makeResult();
    }
    const floorPlanePoints2D = floorRectResult.value.asArray.map((point) => floorVec3ToPlane2D(point));

    const decompositionResult = decomposeHomographyToCameraPose(
      homographyDebug.homographyMatrixForPlacement,
      homographyDebug.frameSize,
      { verticalFovDeg: cameraPoseFovYDeg },
      {
        floorPlanePoints2D,
        imagePointsPx,
      }
    );
    if (!decompositionResult.ok) {
      unavailableReason = decompositionResult.reason;
      rows.push({
        label: "camera pose diagnostic",
        value: `fail (${decompositionResult.reason})`,
      });
      return makeResult();
    }

    rows.push({
      label: "camera pose diagnostic",
      value: `ok (${decompositionResult.confidence})${decompositionResult.note ? ` — ${decompositionResult.note}` : ""}`,
    });
    rows.push({
      label: "camera pose lookAt (derived)",
      value: `${formatNumber(decompositionResult.value.pose.lookAt.x)} / ${formatNumber(
        decompositionResult.value.pose.lookAt.y
      )} / ${formatNumber(decompositionResult.value.pose.lookAt.z)}`,
    });
    rows.push({
      label: "camera pose up (derived)",
      value: `${formatNumber(decompositionResult.value.pose.up.x)} / ${formatNumber(
        decompositionResult.value.pose.up.y
      )} / ${formatNumber(decompositionResult.value.pose.up.z)}`,
    });
    rows.push({
      label: "camera pose position",
      value: `${formatNumber(decompositionResult.value.pose.position.x)} / ${formatNumber(
        decompositionResult.value.pose.position.y
      )} / ${formatNumber(decompositionResult.value.pose.position.z)}`,
    });
    rows.push({
      label: "camera pose height",
      value: formatNumber(decompositionResult.value.diagnostics.cameraHeight),
    });
    rows.push({
      label: "camera pose z",
      value: formatNumber(decompositionResult.value.diagnostics.cameraZ),
    });
    rows.push({
      label: "camera pose focal px",
      value: formatNumber(intrinsicsResult.value.fy),
    });
    rows.push({
      label: "camera pose lambda",
      value: formatNumber(decompositionResult.value.diagnostics.lambda),
    });
    rows.push({
      label: "camera pose scale ratio",
      value: formatNumber(decompositionResult.value.diagnostics.columnScaleRatio),
    });
    rows.push({
      label: "camera pose scale ratio note",
      value: "Closer to 1 is better; high values suggest floor rect aspect/polygon mismatch.",
    });
    rows.push({
      label: "camera pose determinant",
      value: formatNumber(decompositionResult.value.diagnostics.determinant),
    });
    rows.push({
      label: "camera pose orthonormality error",
      value: formatNumber(decompositionResult.value.diagnostics.orthonormalityError),
    });
    rows.push({
      label: "camera pose CV reprojection avg px",
      value: formatNumber(decompositionResult.value.diagnostics.averageCameraPoseReprojectionPx),
    });
    rows.push({
      label: "camera pose CV reprojection max px",
      value: formatNumber(decompositionResult.value.diagnostics.maxCameraPoseReprojectionPx),
    });

    let displayReprojectionTotal = 0;
    let displayReprojectionMax = 0;
    let displayReprojectionCount = 0;
    const perCornerRenderedResidualPx: (number | null)[] = new Array(floorPlanePoints2D.length).fill(null);
    for (let i = 0; i < floorPlanePoints2D.length; i += 1) {
      const projected = projectFloorPointThroughPose(
        decompositionResult.value.pose,
        homographyDebug.frameSize,
        { verticalFovDeg: cameraPoseFovYDeg },
        floorPlanePoints2D[i]
      );
      if (!projected.ok) continue;
      const error = Math.hypot(projected.value.x - imagePointsPx[i].x, projected.value.y - imagePointsPx[i].y);
      if (!Number.isFinite(error)) continue;
      perCornerRenderedResidualPx[i] = error;
      displayReprojectionTotal += error;
      if (error > displayReprojectionMax) displayReprojectionMax = error;
      displayReprojectionCount += 1;
    }
    const cvPerCornerDiagnostics = decompositionResult.value.diagnostics.perCornerCvReprojectionPx;
    const perCornerCvResidualPx: (number | null)[] | null =
      Array.isArray(cvPerCornerDiagnostics) && cvPerCornerDiagnostics.length === floorPlanePoints2D.length
        ? cvPerCornerDiagnostics.map((value) => (Number.isFinite(value) ? value : null))
        : null;
    cornerResidualDiagnostics = {
      perCornerCvResidualPx,
      perCornerRenderedResidualPx,
    };
    rows.push({
      label: "camera pose display reprojection avg px",
      value:
        displayReprojectionCount > 0
          ? formatNumber(displayReprojectionTotal / displayReprojectionCount)
          : "unavailable",
    });
    rows.push({
      label: "camera pose display reprojection max px",
      value: displayReprojectionCount > 0 ? formatNumber(displayReprojectionMax) : "unavailable",
    });
    rows.push({
      label: "camera pose selected scale sign",
      value: String(decompositionResult.value.diagnostics.selectedScaleSign),
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
        decompositionResult.confidence === "high"
          ? "eligible to render when homography debug overlay is on"
          : "skipped (low confidence)",
    });

    applyCandidate = {
      confidence: decompositionResult.confidence,
      cvAvgPx: decompositionResult.value.diagnostics.averageCameraPoseReprojectionPx,
      cvMaxPx: decompositionResult.value.diagnostics.maxCameraPoseReprojectionPx,
      displayAvgPx: displayReprojectionCount > 0 ? displayReprojectionTotal / displayReprojectionCount : null,
      displayMaxPx: displayReprojectionCount > 0 ? displayReprojectionMax : null,
      scaleRatio: decompositionResult.value.diagnostics.columnScaleRatio,
      diagnosticsSummary: `cv avg=${formatNumber(
        decompositionResult.value.diagnostics.averageCameraPoseReprojectionPx
      )} max=${formatNumber(decompositionResult.value.diagnostics.maxCameraPoseReprojectionPx)} scale=${formatNumber(
        decompositionResult.value.diagnostics.columnScaleRatio
      )}`,
      pose: decompositionResult.value.pose,
      frameSize: homographyDebug.frameSize,
    };

    decomposition = {
      confidence: decompositionResult.confidence,
      frameSize: homographyDebug.frameSize,
      cvProjection: decompositionResult.value.cvProjection,
      pose: decompositionResult.value.pose,
    };

    return makeResult();
  }, [
    cameraPoseFovYDeg,
    homographyDebug.frameSize,
    homographyDebug.orderedCornersNorm,
    homographyDebug.homographyMatrixForPlacement,
    homographyDebug.homographySolveStatus,
    homographyDebug.placementFallbackReason,
    floorMapping.worldDepth,
    floorMapping.worldWidth,
  ]);

  const cameraPoseFovScanDebug = useMemo(() => {
    const rows: { label: string; value: string }[] = [];
    const scanMinFov = 20;
    const scanMaxFov = 90;
    const scanStepDeg = 1;
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

    if (!homographyDebug.frameSize) {
      rows.push({ label: "camera pose FOV scan", value: "unavailable (frame pixel size unavailable)" });
      return { rows, bestFov, recommendation };
    }
    if (homographyDebug.homographySolveStatus !== "ok" || !homographyDebug.homographyMatrixForPlacement) {
      rows.push({
        label: "camera pose FOV scan",
        value: `unavailable (${homographyDebug.placementFallbackReason})`,
      });
      return { rows, bestFov, recommendation };
    }
    if (!homographyDebug.orderedCornersNorm) {
      rows.push({ label: "camera pose FOV scan", value: "unavailable (ordered homography corners unavailable)" });
      return { rows, bestFov, recommendation };
    }

    const imagePointsPx: { x: number; y: number }[] = [];
    for (const point of homographyDebug.orderedCornersNorm) {
      const pixels = normToPixels(point, homographyDebug.frameSize);
      if (!pixels) {
        rows.push({
          label: "camera pose FOV scan",
          value: "unavailable (could not convert ordered corners from normalized -> pixels)",
        });
        return { rows, bestFov, recommendation };
      }
      imagePointsPx.push(pixels);
    }
    const floorRectResult = getFloorRectCorners({
      widthMeters: floorMapping.worldWidth,
      depthMeters: floorMapping.worldDepth,
    });
    if (!floorRectResult.ok) {
      rows.push({
        label: "camera pose FOV scan",
        value: `unavailable (${floorRectResult.reason})`,
      });
      return { rows, bestFov, recommendation };
    }
    const floorPlanePoints2D = floorRectResult.value.asArray.map((point) => floorVec3ToPlane2D(point));

    // Shared, pure FOV scan (same range/step/selection used by the empty-room
    // assist camera self-validity gate). See scanCameraPoseOverFov.
    const scan = scanCameraPoseOverFov(
      homographyDebug.homographyMatrixForPlacement,
      homographyDebug.frameSize,
      { floorPlanePoints2D, imagePointsPx },
      { minFovDeg: scanMinFov, maxFovDeg: scanMaxFov, stepDeg: scanStepDeg }
    );

    rows.push({
      label: "camera pose FOV scan",
      value: `ok (range ${scanMinFov}-${scanMaxFov} step ${scanStepDeg})`,
    });
    rows.push({
      label: "camera pose scan samples",
      value: `${scan.samples.length} tested, ${scan.validCount} valid, ${scan.highConfidenceCount} high`,
    });
    const buildContiguousIntervals = (
      values: typeof scan.samples,
      qualifies: (sample: (typeof scan.samples)[number]) => boolean
    ): [number, number][] => {
      const intervals: [number, number][] = [];
      let startFov: number | null = null;
      let previousFov: number | null = null;
      for (const sample of values) {
        if (!qualifies(sample)) {
          if (startFov !== null && previousFov !== null) intervals.push([startFov, previousFov]);
          startFov = null;
          previousFov = null;
          continue;
        }
        if (startFov === null) {
          startFov = sample.fov;
          previousFov = sample.fov;
          continue;
        }
        const isContiguous =
          previousFov !== null && Math.abs(sample.fov - previousFov - scanStepDeg) <= Number.EPSILON * 8;
        if (!isContiguous) {
          intervals.push([startFov, previousFov ?? startFov]);
          startFov = sample.fov;
        }
        previousFov = sample.fov;
      }
      if (startFov !== null && previousFov !== null) intervals.push([startFov, previousFov]);
      return intervals;
    };
    const isValidSample = (sample: (typeof scan.samples)[number]) =>
      sample.ok && sample.avgPx !== undefined && sample.maxPx !== undefined;
    const validSampleIntervals = buildContiguousIntervals(scan.samples, isValidSample);
    const highConfidenceSampleIntervals = buildContiguousIntervals(
      scan.samples,
      (sample) => isValidSample(sample) && sample.confidence === "high"
    );
    recommendation = {
      bestFov: scan.bestFovDeg,
      bestConfidence: scan.bestConfidence,
      validFovRange: scan.validFovRange,
      highConfidenceFovRange: scan.highConfidenceFovRange,
      bestAvgPx: scan.bestAvgPx,
      bestMaxPx: scan.bestMaxPx,
      validSampleIntervals,
      highConfidenceSampleIntervals,
      validSampleCount: scan.validCount,
      highConfidenceSampleCount: scan.highConfidenceCount,
      sampleCount: scan.samples.length,
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
  }, [
    floorMapping.worldDepth,
    floorMapping.worldWidth,
    homographyDebug.frameSize,
    homographyDebug.homographyMatrixForPlacement,
    homographyDebug.homographySolveStatus,
    homographyDebug.orderedCornersNorm,
    homographyDebug.placementFallbackReason,
  ]);

  const calibratedCameraApplyStatus = useMemo(() => {
    const candidate = cameraPoseDebug.applyCandidate;
    if (!candidate) {
      return {
        available: false,
        reason: cameraPoseDebug.unavailableReason ?? "camera pose diagnostics unavailable",
      };
    }
    if (candidate.confidence !== "high") {
      return { available: false, reason: "camera pose confidence is not high" };
    }
    if (candidate.cvAvgPx >= CALIBRATED_CAMERA_APPLY_MAX_CV_AVG_PX) {
      return { available: false, reason: "CV reprojection average is too high" };
    }
    if (candidate.cvMaxPx >= CALIBRATED_CAMERA_APPLY_MAX_CV_MAX_PX) {
      return { available: false, reason: "CV reprojection max is too high" };
    }
    if (
      candidate.displayAvgPx === null ||
      candidate.displayMaxPx === null ||
      !Number.isFinite(candidate.displayAvgPx) ||
      !Number.isFinite(candidate.displayMaxPx)
    ) {
      return { available: false, reason: "display reprojection diagnostics are unavailable" };
    }
    if (candidate.displayAvgPx >= CALIBRATED_CAMERA_APPLY_MAX_DISPLAY_AVG_PX) {
      return { available: false, reason: "display reprojection average is too high" };
    }
    if (candidate.displayMaxPx >= CALIBRATED_CAMERA_APPLY_MAX_DISPLAY_MAX_PX) {
      return { available: false, reason: "display reprojection max is too high" };
    }
    if (Math.abs(candidate.displayAvgPx - candidate.cvAvgPx) > CALIBRATED_CAMERA_APPLY_MAX_AVG_DELTA_PX) {
      return { available: false, reason: "display/CV average reprojection mismatch is too high" };
    }
    if (Math.abs(candidate.displayMaxPx - candidate.cvMaxPx) > CALIBRATED_CAMERA_APPLY_MAX_MAX_DELTA_PX) {
      return { available: false, reason: "display/CV max reprojection mismatch is too high" };
    }
    if (
      candidate.scaleRatio < CALIBRATED_CAMERA_APPLY_MIN_SCALE_RATIO ||
      candidate.scaleRatio > CALIBRATED_CAMERA_APPLY_MAX_SCALE_RATIO
    ) {
      return { available: false, reason: "camera pose scale ratio is outside apply bounds" };
    }
    if (candidate.frameSize.width <= 0 || candidate.frameSize.height <= 0) {
      return { available: false, reason: "frame size is invalid for apply snapshot" };
    }
    return { available: true, reason: "available" };
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
    const pickLargestFiniteCorner = (values: (number | null)[] | null): { index: number; value: number } | null => {
      if (!values) return null;
      let best: { index: number; value: number } | null = null;
      for (let i = 0; i < values.length; i += 1) {
        const value = values[i];
        if (value === null || !Number.isFinite(value)) continue;
        if (!best || value > best.value) {
          best = { index: i, value };
        }
      }
      return best;
    };
    const readinessMetrics =
      candidate &&
      candidate.displayAvgPx !== null &&
      candidate.displayMaxPx !== null &&
      Number.isFinite(candidate.displayAvgPx) &&
      Number.isFinite(candidate.displayMaxPx)
        ? {
            cvAvgPx: candidate.cvAvgPx,
            cvMaxPx: candidate.cvMaxPx,
            displayAvgPx: candidate.displayAvgPx,
            displayMaxPx: candidate.displayMaxPx,
            avgDeltaPx: Math.abs(candidate.displayAvgPx - candidate.cvAvgPx),
            maxDeltaPx: Math.abs(candidate.displayMaxPx - candidate.cvMaxPx),
          }
        : candidate
          ? {
              cvAvgPx: candidate.cvAvgPx,
              cvMaxPx: candidate.cvMaxPx,
              displayAvgPx: null,
              displayMaxPx: null,
              avgDeltaPx: null,
              maxDeltaPx: null,
            }
          : null;
    const perCornerDiagnostics = cameraPoseDebug.cornerResidualDiagnostics;
    const worstCvCorner = pickLargestFiniteCorner(perCornerDiagnostics?.perCornerCvResidualPx ?? null);
    const worstRenderedCorner = pickLargestFiniteCorner(perCornerDiagnostics?.perCornerRenderedResidualPx ?? null);
    const largestPerCornerDifference = (() => {
      if (!perCornerDiagnostics?.perCornerCvResidualPx || !perCornerDiagnostics.perCornerRenderedResidualPx) return null;
      const cvValues = perCornerDiagnostics.perCornerCvResidualPx;
      const renderedValues = perCornerDiagnostics.perCornerRenderedResidualPx;
      const count = Math.min(cvValues.length, renderedValues.length);
      let best: { index: number; value: number } | null = null;
      for (let i = 0; i < count; i += 1) {
        const cvResidual = cvValues[i];
        const renderedResidual = renderedValues[i];
        if (
          cvResidual === null ||
          renderedResidual === null ||
          !Number.isFinite(cvResidual) ||
          !Number.isFinite(renderedResidual)
        ) {
          continue;
        }
        const difference = Math.abs(renderedResidual - cvResidual);
        if (!best || difference > best.value) {
          best = { index: i, value: difference };
        }
      }
      return best;
    })();
    type FirstFailingGate =
      | "no-candidate"
      | "confidence"
      | "cv-avg"
      | "cv-max"
      | "display-unavailable"
      | "display-avg"
      | "display-max"
      | "delta-avg"
      | "delta-max"
      | "scale-ratio"
      | "frame-size"
      | "none";
    const firstFailingGate: FirstFailingGate = (() => {
      if (!candidate) return "no-candidate";
      if (candidate.confidence !== "high") return "confidence";
      if (candidate.cvAvgPx >= CALIBRATED_CAMERA_APPLY_MAX_CV_AVG_PX) return "cv-avg";
      if (candidate.cvMaxPx >= CALIBRATED_CAMERA_APPLY_MAX_CV_MAX_PX) return "cv-max";
      if (!readinessMetrics || readinessMetrics.displayAvgPx === null || readinessMetrics.displayMaxPx === null) {
        return "display-unavailable";
      }
      if (readinessMetrics.displayAvgPx >= CALIBRATED_CAMERA_APPLY_MAX_DISPLAY_AVG_PX) return "display-avg";
      if (readinessMetrics.displayMaxPx >= CALIBRATED_CAMERA_APPLY_MAX_DISPLAY_MAX_PX) return "display-max";
      if (readinessMetrics.avgDeltaPx !== null && readinessMetrics.avgDeltaPx > CALIBRATED_CAMERA_APPLY_MAX_AVG_DELTA_PX) {
        return "delta-avg";
      }
      if (readinessMetrics.maxDeltaPx !== null && readinessMetrics.maxDeltaPx > CALIBRATED_CAMERA_APPLY_MAX_MAX_DELTA_PX) {
        return "delta-max";
      }
      if (
        candidate.scaleRatio < CALIBRATED_CAMERA_APPLY_MIN_SCALE_RATIO ||
        candidate.scaleRatio > CALIBRATED_CAMERA_APPLY_MAX_SCALE_RATIO
      ) {
        return "scale-ratio";
      }
      if (candidate.frameSize.width <= 0 || candidate.frameSize.height <= 0) return "frame-size";
      return "none";
    })();

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
    cameraPoseDebug.applyCandidate,
    cameraPoseDebug.cornerResidualDiagnostics,
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

  const assistedCandidateSolvabilityContext = useMemo(() => {
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
    const candidateStatusLabel = !selectedAutoFloorCandidate
      ? "No assisted candidate selected"
      : appliedAutoFloorCandidateId === selectedAutoFloorCandidate.id && activeFloorMatchesSelectedCandidate
        ? "Applied to active floor quad"
        : "Selected — not applied or edited after applying";
    const metricsScopeText =
      selectedAutoFloorCandidate &&
      appliedAutoFloorCandidateId === selectedAutoFloorCandidate.id &&
      activeFloorMatchesSelectedCandidate
        ? "Metrics below reflect the applied assisted candidate and current manual FOV."
        : "Metrics below reflect the active floor quad and current manual FOV.";

    const candidate = cameraPoseDebug.applyCandidate;
    const formatMetricPx = (value: number | null) =>
      value !== null && Number.isFinite(value) ? `${formatNumber(value)} px` : "Unavailable";
    const hasRenderableDiagnostics =
      !!candidate &&
      candidate.displayAvgPx !== null &&
      candidate.displayMaxPx !== null &&
      Number.isFinite(candidate.displayAvgPx) &&
      Number.isFinite(candidate.displayMaxPx);
    const cvAverageText = formatMetricPx(candidate?.cvAvgPx ?? null);
    const cvMaximumText = formatMetricPx(candidate?.cvMaxPx ?? null);
    const renderedAverageText = formatMetricPx(hasRenderableDiagnostics ? candidate!.displayAvgPx : null);
    const renderedMaximumText = formatMetricPx(hasRenderableDiagnostics ? candidate!.displayMaxPx : null);
    const deltaAverageText = formatMetricPx(
      hasRenderableDiagnostics ? Math.abs(candidate!.displayAvgPx! - candidate!.cvAvgPx) : null
    );
    const deltaMaximumText = formatMetricPx(
      hasRenderableDiagnostics ? Math.abs(candidate!.displayMaxPx! - candidate!.cvMaxPx) : null
    );

    const evaluationPrerequisitesAvailable =
      !!homographyDebug.frameSize &&
      homographyDebug.homographySolveStatus === "ok" &&
      !!homographyDebug.homographyMatrixForPlacement &&
      !!homographyDebug.orderedCornersNorm;
    const cameraSolvableText = candidate ? "Yes" : evaluationPrerequisitesAvailable ? "No" : "Unavailable";
    const poseAvailableText = candidate ? "Yes" : evaluationPrerequisitesAvailable ? "No" : "Unavailable";
    const cheiralityText = candidate ? "Pass" : "Unavailable";
    const scaleRatioText = candidate ? formatNumber(candidate.scaleRatio) : "Unavailable";
    const applySafeLabel =
      calibrationReadiness.applySafeAtCurrentFovText === "Unavailable"
        ? "Apply-safe at current FOV"
        : `Apply-safe at current FOV (${formatNumber(cameraPoseFovYDeg)}°)`;
    const mainBlockerText = candidate
      ? calibrationReadiness.mainBlockingContributorTitle
      : `Main blocker: ${cameraPoseDebug.unavailableReason ?? "camera pose diagnostics unavailable"}`;

    return {
      candidateStatusLabel,
      metricsScopeText,
      cameraSolvableText,
      poseAvailableText,
      cheiralityText,
      scaleRatioText,
      cvAverageText,
      cvMaximumText,
      renderedAverageText,
      renderedMaximumText,
      deltaAverageText,
      deltaMaximumText,
      validFovSampleText: calibrationReadiness.validFovSampleText,
      highConfidenceFovSampleText: calibrationReadiness.highConfidenceFovSampleText,
      applySafeLabel,
      applySafeAtCurrentFovText: calibrationReadiness.applySafeAtCurrentFovText,
      largestCvResidualText: calibrationReadiness.largestCvResidualText,
      largestRenderedResidualText: calibrationReadiness.largestRenderedResidualText,
      largestDifferenceText: calibrationReadiness.largestDifferenceText,
      differenceDiagnosticNote: calibrationReadiness.differenceDiagnosticNote,
      mainBlockerText,
      mainBlockingContributorDetail: candidate ? calibrationReadiness.mainBlockingContributorDetail : null,
      candidateIdentityWarning:
        selectedAutoFloorCandidate &&
        !(appliedAutoFloorCandidateId === selectedAutoFloorCandidate.id && activeFloorMatchesSelectedCandidate)
          ? "Metrics below reflect the active floor quad, not this selected candidate."
          : null,
      applySafetyScopeNote: "Apply-safety is evaluated for the active floor quad at the current FOV only.",
    };
  }, [
    appliedAutoFloorCandidateId,
    calibrationReadiness.applySafeAtCurrentFovText,
    calibrationReadiness.differenceDiagnosticNote,
    calibrationReadiness.highConfidenceFovSampleText,
    calibrationReadiness.largestCvResidualText,
    calibrationReadiness.largestDifferenceText,
    calibrationReadiness.largestRenderedResidualText,
    calibrationReadiness.mainBlockingContributorDetail,
    calibrationReadiness.mainBlockingContributorTitle,
    calibrationReadiness.validFovSampleText,
    cameraPoseDebug.applyCandidate,
    cameraPoseDebug.unavailableReason,
    cameraPoseFovYDeg,
    floorPolygon,
    homographyDebug.frameSize,
    homographyDebug.homographyMatrixForPlacement,
    homographyDebug.homographySolveStatus,
    homographyDebug.orderedCornersNorm,
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
                <p className="mt-1 text-slate-300">Candidate status: {assistedCandidateSolvabilityContext.candidateStatusLabel}</p>
                {assistedCandidateSolvabilityContext.candidateIdentityWarning ? (
                  <p className="mt-1 text-slate-400">{assistedCandidateSolvabilityContext.candidateIdentityWarning}</p>
                ) : null}
                <p className="mt-1 text-slate-500">{assistedCandidateSolvabilityContext.metricsScopeText}</p>
                <div className="mt-2 space-y-1 text-slate-300">
                  <p>Camera-solvable: {assistedCandidateSolvabilityContext.cameraSolvableText}</p>
                  <p>Pose available: {assistedCandidateSolvabilityContext.poseAvailableText}</p>
                  <p>Cheirality: {assistedCandidateSolvabilityContext.cheiralityText}</p>
                  <p>Scale ratio: {assistedCandidateSolvabilityContext.scaleRatioText}</p>
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
                  <p>Valid pose samples: {assistedCandidateSolvabilityContext.validFovSampleText}</p>
                  <p>High-confidence samples: {assistedCandidateSolvabilityContext.highConfidenceFovSampleText}</p>
                  <p>
                    {assistedCandidateSolvabilityContext.applySafeLabel}:{" "}
                    {assistedCandidateSolvabilityContext.applySafeAtCurrentFovText}
                  </p>
                  <p>{assistedCandidateSolvabilityContext.largestCvResidualText}</p>
                  <p>{assistedCandidateSolvabilityContext.largestRenderedResidualText}</p>
                  <p>{assistedCandidateSolvabilityContext.largestDifferenceText}</p>
                  <p className="text-slate-500">{assistedCandidateSolvabilityContext.differenceDiagnosticNote}</p>
                  <p>{assistedCandidateSolvabilityContext.mainBlockerText}</p>
                  {assistedCandidateSolvabilityContext.mainBlockingContributorDetail ? (
                    <p className="text-slate-400">{assistedCandidateSolvabilityContext.mainBlockingContributorDetail}</p>
                  ) : null}
                  <p className="text-slate-500">{assistedCandidateSolvabilityContext.applySafetyScopeNote}</p>
                </div>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-xs text-slate-500">
              No suggestions yet. Click “Detect floor” to run the mock-local provider and create deterministic candidate
              quads.
            </p>
          )}
        </section>

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
