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
  mapFloorPointToObjectTransform,
} from "./floor-math";
import {
  SCENE_IMAGE_COORDINATE_SPACE_V0,
  buildSceneStatePayload,
  validateImportedSceneJson,
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
  solvePlaneHomography,
} from "./perspective-solve";
import {
  computeAutoBoundsNormalization,
  type AutoBoundsNormalization,
} from "./model-bounds";

const DEFAULT_MODEL_GLB_PATH = "/3d-lab/furniture-test-chair.glb";
const LOCAL_DRAFT_STORAGE_KEY = "vibode:3d-room-lab:scene-state:v0";
const DEFAULT_ROOM_IMAGE_URL =
  "https://images.unsplash.com/photo-1505693314120-0d443867891c?auto=format&fit=crop&w=1600&q=80";

type ImageLoadState = "idle" | "loading" | "loaded" | "error";
type ModelLoadState = "idle" | "loading" | "loaded" | "fallback" | "error";
type ActiveObjectKind = "gltf" | "fallback" | null;
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

export default function ThreeRoomLab() {
  const envEnabled = process.env.NEXT_PUBLIC_VIBODE_ENABLE_3D_ROOM_LAB === "1";
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
  const [isAdvancedControlsOpen, setIsAdvancedControlsOpen] = useState(false);
  const [isSceneStateOpen, setIsSceneStateOpen] = useState(false);
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [showHomographyDebugOverlay, setShowHomographyDebugOverlay] = useState(false);
  const [cameraPoseFovYDeg, setCameraPoseFovYDeg] = useState(50);
  const [isCalibratedCameraActive, setIsCalibratedCameraActive] = useState(false);
  const [calibratedCameraSnapshot, setCalibratedCameraSnapshot] = useState<CalibratedCameraSnapshot | null>(null);
  const [lastCalibratedCameraAutoRevertReason, setLastCalibratedCameraAutoRevertReason] = useState<string | null>(null);
  const [floorClickMappingMode, setFloorClickMappingMode] = useState<FloorClickMappingMode>("legacy");
  const [lastFloorClickMappingResult, setLastFloorClickMappingResult] = useState<string>("legacy");
  const [showFloorOverlay, setShowFloorOverlay] = useState(true);
  const [floorPolygon, setFloorPolygon] = useState<FloorPoint[]>(DEFAULT_FLOOR_POLYGON);
  const [activeFloorHandleIndex, setActiveFloorHandleIndex] = useState<number | null>(null);
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
    restoreDepthScalingAfterCalibratedMode();
    if (options?.clearAutoRevertReason) {
      setLastCalibratedCameraAutoRevertReason(null);
    }
  }, [restoreDepthScalingAfterCalibratedMode]);

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
    floorAnchorDragPointerIdRef.current = null;
    setActiveObjectHandleMode(null);
    setIsFloorAnchorDragActive(false);
    setLastCalibratedMoveStatus("none");
  }, [isCalibratedCameraActive]);

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
      return { rows, decomposition, applyCandidate, unavailableReason };
    }
    if (homographyDebug.homographySolveStatus !== "ok" || !homographyDebug.homographyMatrixForPlacement) {
      unavailableReason = homographyDebug.placementFallbackReason;
      rows.push({
        label: "camera pose diagnostic",
        value: `fail (${homographyDebug.placementFallbackReason})`,
      });
      return { rows, decomposition, applyCandidate, unavailableReason };
    }

    const intrinsicsResult = buildCameraIntrinsicsFromFov(homographyDebug.frameSize, cameraPoseFovYDeg);
    if (!intrinsicsResult.ok) {
      unavailableReason = intrinsicsResult.reason;
      rows.push({
        label: "camera pose diagnostic",
        value: `fail (${intrinsicsResult.reason})`,
      });
      return { rows, decomposition, applyCandidate, unavailableReason };
    }

    if (!homographyDebug.orderedCornersNorm) {
      unavailableReason = "ordered homography corners unavailable";
      rows.push({
        label: "camera pose diagnostic",
        value: "fail (ordered homography corners unavailable)",
      });
      return { rows, decomposition, applyCandidate, unavailableReason };
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
        return { rows, decomposition, applyCandidate, unavailableReason };
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
      return { rows, decomposition, applyCandidate, unavailableReason };
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
      return { rows, decomposition, applyCandidate, unavailableReason };
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
      displayReprojectionTotal += error;
      if (error > displayReprojectionMax) displayReprojectionMax = error;
      displayReprojectionCount += 1;
    }
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

    return { rows, decomposition, applyCandidate, unavailableReason };
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

    if (!homographyDebug.frameSize) {
      rows.push({ label: "camera pose FOV scan", value: "unavailable (frame pixel size unavailable)" });
      return { rows, bestFov };
    }
    if (homographyDebug.homographySolveStatus !== "ok" || !homographyDebug.homographyMatrixForPlacement) {
      rows.push({
        label: "camera pose FOV scan",
        value: `unavailable (${homographyDebug.placementFallbackReason})`,
      });
      return { rows, bestFov };
    }
    if (!homographyDebug.orderedCornersNorm) {
      rows.push({ label: "camera pose FOV scan", value: "unavailable (ordered homography corners unavailable)" });
      return { rows, bestFov };
    }

    const imagePointsPx: { x: number; y: number }[] = [];
    for (const point of homographyDebug.orderedCornersNorm) {
      const pixels = normToPixels(point, homographyDebug.frameSize);
      if (!pixels) {
        rows.push({
          label: "camera pose FOV scan",
          value: "unavailable (could not convert ordered corners from normalized -> pixels)",
        });
        return { rows, bestFov };
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
      return { rows, bestFov };
    }
    const floorPlanePoints2D = floorRectResult.value.asArray.map((point) => floorVec3ToPlane2D(point));

    const samples: Array<{
      fov: number;
      ok: boolean;
      confidence?: "high" | "low";
      avgPx?: number;
      maxPx?: number;
      scaleRatio?: number;
      reason?: string;
    }> = [];

    for (let fov = scanMinFov; fov <= scanMaxFov; fov += scanStepDeg) {
      const decompositionResult = decomposeHomographyToCameraPose(
        homographyDebug.homographyMatrixForPlacement,
        homographyDebug.frameSize,
        { verticalFovDeg: fov },
        {
          floorPlanePoints2D,
          imagePointsPx,
        }
      );
      if (!decompositionResult.ok) {
        samples.push({
          fov,
          ok: false,
          reason: decompositionResult.reason,
        });
        continue;
      }
      samples.push({
        fov,
        ok: true,
        confidence: decompositionResult.confidence,
        avgPx: decompositionResult.value.diagnostics.averageCameraPoseReprojectionPx,
        maxPx: decompositionResult.value.diagnostics.maxCameraPoseReprojectionPx,
        scaleRatio: decompositionResult.value.diagnostics.columnScaleRatio,
      });
    }

    const validSamples = samples.filter((sample) => sample.ok && sample.avgPx !== undefined && sample.maxPx !== undefined);
    const highConfidenceSamples = validSamples.filter((sample) => sample.confidence === "high");

    rows.push({
      label: "camera pose FOV scan",
      value: `ok (range ${scanMinFov}-${scanMaxFov} step ${scanStepDeg})`,
    });
    rows.push({
      label: "camera pose scan samples",
      value: `${samples.length} tested, ${validSamples.length} valid, ${highConfidenceSamples.length} high`,
    });

    if (validSamples.length === 0) {
      const firstFailure = samples.find((sample) => !sample.ok)?.reason ?? "all samples failed";
      rows.push({
        label: "camera pose best FOV",
        value: `none (no valid decomposition results — ${firstFailure})`,
      });
      return { rows, bestFov };
    }

    const sortedByBest = [...validSamples].sort((a, b) => {
      if (a.confidence !== b.confidence) return a.confidence === "high" ? -1 : 1;
      if (a.avgPx! !== b.avgPx!) return a.avgPx! - b.avgPx!;
      return a.maxPx! - b.maxPx!;
    });
    const bestSample = sortedByBest[0];
    bestFov = bestSample.fov;

    const validFovs = validSamples.map((sample) => sample.fov);
    const highFovs = highConfidenceSamples.map((sample) => sample.fov);
    const formatRange = (values: number[]) =>
      values.length === 0
        ? "none"
        : `${Math.min(...values)}deg-${Math.max(...values)}deg`;

    rows.push({
      label: "camera pose best FOV",
      value: `${bestSample.fov}deg (${bestSample.confidence})`,
    });
    rows.push({
      label: "camera pose best reprojection",
      value: `avg=${formatNumber(bestSample.avgPx!)} max=${formatNumber(bestSample.maxPx!)}`,
    });
    rows.push({
      label: "camera pose best scale ratio",
      value: formatNumber(bestSample.scaleRatio ?? 0),
    });
    rows.push({
      label: "camera pose valid FOV range",
      value: formatRange(validFovs),
    });
    rows.push({
      label: "camera pose high-confidence FOV range",
      value: formatRange(highFovs),
    });

    return { rows, bestFov };
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

  const cameraPoseGridPolylinesNorm = useMemo(() => {
    if (!showHomographyDebugOverlay) return [] as FloorPoint[][];
    if (!cameraPoseDebug.decomposition) return [] as FloorPoint[][];
    if (cameraPoseDebug.decomposition.confidence !== "high") return [] as FloorPoint[][];

    const renderSize = cameraPoseDebug.decomposition.frameSize;
    const halfWidth = floorMapping.worldWidth / 2;
    const halfDepth = floorMapping.worldDepth / 2;
    const gridLineCount = 7;
    const samplesPerLine = 20;
    const lines: FloorPoint[][] = [];

    const projectFloorToOverlayNorm = (x: number, z: number): FloorPoint | null => {
      const projected = projectFloorPointThroughCameraPoseCv(
        cameraPoseDebug.decomposition.cvProjection,
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

    const clickComparison = compareTarget(lastAcceptedFloorClick);
    const objectProjectionComparison = compareTarget(objectProjectionDiagnostic.projectedNorm);

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

    return { rows, clickComparison, objectProjectionComparison };
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
    if (
      !objectProjectionDiagnostic.projectedNorm ||
      !objectProjectionDiagnostic.status.startsWith("ok")
    ) {
      return { available: false, reason: "object projection diagnostic is not ok" };
    }
    if (!rayFloorHomographyComparisonDebug.objectProjectionComparison.available) {
      return { available: false, reason: "ray-floor object comparison unavailable" };
    }
    const objectProjectionDistance = rayFloorHomographyComparisonDebug.objectProjectionComparison.worldDistance;
    if (objectProjectionDistance === null || objectProjectionDistance > RAY_FLOOR_HOMOGRAPHY_WARNING_WORLD_DISTANCE) {
      return { available: false, reason: "ray-floor vs homography distance exceeds threshold" };
    }
    if (perspectiveDepthScaling.enabled) {
      return { available: false, reason: "depth scaling is not neutralized" };
    }
    if (!calibratedMoveHandleAnchorProjection.ok || !calibratedMoveHandleAnchorProjection.normalized) {
      return { available: false, reason: calibratedMoveHandleAnchorProjection.reason };
    }
    return { available: true, reason: "available" };
  }, [
    calibratedCameraFrameMatchStatus.diagnostics,
    calibratedCameraSnapshot,
    calibratedMoveHandleAnchorProjection.normalized,
    calibratedMoveHandleAnchorProjection.ok,
    calibratedMoveHandleAnchorProjection.reason,
    isCalibratedCameraActive,
    objectProjectionDiagnostic.projectedNorm,
    objectProjectionDiagnostic.status,
    perspectiveDepthScaling.enabled,
    rayFloorHomographyComparisonDebug.objectProjectionComparison.available,
    rayFloorHomographyComparisonDebug.objectProjectionComparison.worldDistance,
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
      calibratedCameraFrameMatchStatus.value,
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
    autoRotateOffsetDegRef.current = 0;
    updateTransformState(defaultTransformForKind(activeObjectKind), { markOwned: true });
  };

  const handleResetModelNormalization = () => {
    setModelNormalization(DEFAULT_MODEL_NORMALIZATION);
  };

  const floorPolygonPointsAttribute = useMemo(
    () => floorPolygon.map((point) => `${point.x * 100},${point.y * 100}`).join(" "),
    [floorPolygon]
  );

  const buildCurrentSceneStatePayload = (exportedAtIso: string) =>
    buildSceneStatePayload({
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
      debug: {
        rendererSize,
        imageStatus: imageLoadState,
        modelStatus: formatModelStatus(modelLoadState, modelLoadError),
      },
    });

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
    if (validated.modelPath !== null) {
      setModelPathInput(validated.modelPath);
      setModelPath(validated.modelPath);
    }
    setModelNormalization(validated.modelNormalization);
    const nextRoomImageUrl = validated.roomImageUrl ?? "";
    setRoomImageInput(nextRoomImageUrl);
    setRoomImageUrl(nextRoomImageUrl);
    setImageLoadState(nextRoomImageUrl ? "loading" : "idle");
    setImageIntrinsicSize(
      validated.image
        ? {
            width: validated.image.intrinsicWidth,
            height: validated.image.intrinsicHeight,
          }
        : null
    );

    updateTransformState(
      {
        positionX: validated.transform.positionX,
        positionY: validated.transform.positionY,
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
    setImageLoadState(nextUrl ? "loading" : "idle");
    setImageIntrinsicSize(null);
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
                  const width = event.currentTarget.naturalWidth;
                  const height = event.currentTarget.naturalHeight;
                  setImageIntrinsicSize(width > 0 && height > 0 ? { width, height } : null);
                  setImageLoadState("loaded");
                }}
                onError={() => {
                  setImageIntrinsicSize(null);
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
            <span className="text-slate-400">Camera pose FOV</span>
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
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => {
                const candidate = cameraPoseDebug.applyCandidate;
                if (!candidate || !calibratedCameraApplyStatus.available) return;
                captureAndNeutralizeDepthScalingForCalibratedMode();
                setLastCalibratedCameraAutoRevertReason(null);
                setCalibratedCameraSnapshot({
                  pose: candidate.pose,
                  fovDeg: cameraPoseFovYDeg,
                  frameSize: candidate.frameSize,
                  diagnosticsSummary: candidate.diagnosticsSummary,
                  appliedAtIso: new Date().toISOString(),
                });
                setIsCalibratedCameraActive(true);
              }}
              disabled={!calibratedCameraApplyStatus.available}
              className="rounded border border-slate-700 px-2 py-1 text-slate-200 transition hover:border-cyan-400/80 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Apply calibrated camera
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
            <span className="text-slate-500">
              {calibratedCameraApplyStatus.available
                ? "Calibrated camera apply is available."
                : `Calibrated camera apply unavailable: ${calibratedCameraApplyStatus.reason}`}
            </span>
          </div>
          <p className="mb-3 text-xs text-slate-500">
            Experimental: tune FOV until the camera pose diagnostic reads high and the cyan grid aligns with the
            green grid. A valid pose may exist only in a narrow FOV band.
          </p>
          <div className="mb-3 flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => {
                if (cameraPoseFovScanDebug.bestFov === null) return;
                setCameraPoseFovYDeg(cameraPoseFovScanDebug.bestFov);
              }}
              disabled={cameraPoseFovScanDebug.bestFov === null}
              className="rounded border border-slate-700 px-2 py-1 text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Use best scanned FOV
            </button>
            <span className="text-slate-500">
              FOV scan is diagnostic only; use it to find a range where the cyan grid aligns with the green grid.
            </span>
          </div>
          <label className="mb-3 flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={showHomographyDebugOverlay}
              onChange={(event) => setShowHomographyDebugOverlay(event.target.checked)}
              className="accent-emerald-400"
            />
            Show homography debug overlay
          </label>
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
