"use client";

import { FormEvent, PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import SceneJsonPanel from "./SceneJsonPanel";
import {
  DEFAULT_FLOOR_MAPPING,
  DEFAULT_PERSPECTIVE_DEPTH_SCALING,
  FLOOR_MAPPING_LIMITS,
  PERSPECTIVE_DEPTH_SCALING_LIMITS,
  clampValue,
  getDepthNearFarOrderingInfo,
  getDepthScaleMultiplier,
  getEffectiveObjectScale,
  isPointInsidePolygon,
  mapFloorPointToObjectTransform,
} from "./floor-math";
import {
  buildSceneStatePayload,
  validateImportedSceneJson,
  type FloorMappingState,
  type FloorPoint,
  type ImportedSceneValidated,
  type ModelNormalizationState,
  type PerspectiveDepthScalingState,
  type TransformState,
} from "./scene-state";

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

const OBJECT_HANDLE_ROTATE_DEADZONE_PX = 14;
const OBJECT_HANDLE_SCALE_MIN_START_DISTANCE_PX = 10;
const OBJECT_HANDLE_HEIGHT_PIXELS_PER_UNIT = 120;

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

const GLB_DEFAULT_TRANSFORM: TransformState = {
  positionX: 0,
  positionY: -0.85,
  positionZ: 0,
  rotationYDeg: 0,
  uniformScale: 1.15,
};

const FALLBACK_DEFAULT_TRANSFORM: TransformState = {
  positionX: 0,
  positionY: -0.35,
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
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
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
          onChange={(event) => {
            const next = Number.parseFloat(event.target.value);
            if (!Number.isFinite(next)) return;
            onChange(clampValue(next, min, max));
          }}
          className="w-24 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 outline-none focus:border-emerald-400"
        />
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(clampValue(Number.parseFloat(event.target.value), min, max))}
        className="mt-2 w-full accent-emerald-400"
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
  const floorAnchorDragPointerIdRef = useRef<number | null>(null);
  const lastAcceptedFloorClickRef = useRef<FloorPoint | null>(null);
  const perspectiveDepthScalingRef = useRef<PerspectiveDepthScalingState>(
    DEFAULT_PERSPECTIVE_DEPTH_SCALING
  );

  const [roomImageInput, setRoomImageInput] = useState(DEFAULT_ROOM_IMAGE_URL);
  const [roomImageUrl, setRoomImageUrl] = useState(DEFAULT_ROOM_IMAGE_URL);
  const [imageLoadState, setImageLoadState] = useState<ImageLoadState>(
    DEFAULT_ROOM_IMAGE_URL ? "loading" : "idle"
  );
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
  const [wasLastAnchorDragMoveRejected, setWasLastAnchorDragMoveRejected] = useState(false);
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

  const currentDepthScaleMultiplier = useMemo(
    () => getDepthScaleMultiplier(lastAcceptedFloorClick?.y ?? null, perspectiveDepthScaling),
    [lastAcceptedFloorClick?.y, perspectiveDepthScaling]
  );

  const currentEffectiveObjectScale = useMemo(
    () => getEffectiveObjectScale(transform.uniformScale, lastAcceptedFloorClick, perspectiveDepthScaling),
    [lastAcceptedFloorClick, perspectiveDepthScaling, transform.uniformScale]
  );

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
  const floorInteractionModeSummary = isFloorClickPlacementEnabled
    ? isFloorAnchorDragEnabled
      ? isObject2DHandlesEnabled
        ? "place + drag-anchor + object-handle"
        : "place + drag-anchor"
      : isObject2DHandlesEnabled
        ? "place + object-handle"
      : "place"
    : isFloorAnchorDragEnabled
      ? isObject2DHandlesEnabled
        ? "drag-anchor + object-handle"
        : "drag-anchor"
      : isObject2DHandlesEnabled
        ? "object-handle"
        : "none";

  const debugRows = useMemo(
    () => [
      { label: "env", value: envEnabled ? "enabled" : "disabled" },
      { label: "image", value: imageLoadState },
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
      { label: "auto-rotate", value: autoRotateEnabled ? "on" : "off" },
      { label: "active object", value: currentActiveObjectType },
      { label: "floor overlay", value: showFloorOverlay ? "on" : "off" },
      { label: "floor points", value: String(floorPolygon.length) },
      { label: "active floor handle", value: activeFloorHandleIndex === null ? "none" : String(activeFloorHandleIndex) },
      { label: "floor polygon", value: JSON.stringify(floorPolygon.map(roundPoint)) },
      { label: "floor placement mode", value: isFloorClickPlacementEnabled ? "on" : "off" },
      { label: "floor interaction mode", value: floorInteractionModeSummary },
      { label: "pointer precedence", value: "polygon handles > object handles > anchor drag > floor background" },
      { label: "object 2d handles", value: isObject2DHandlesEnabled ? "on" : "off" },
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
      { label: "floor anchor dragging", value: isFloorAnchorDragEnabled ? "on" : "off" },
      { label: "active anchor drag", value: isFloorAnchorDragActive ? "yes" : "no" },
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
      imageLoadState,
      currentDepthScaleMultiplier,
      currentEffectiveObjectScale,
      isModelNormalizationAdjusted,
      depthNearFarOrderingWarning,
      isDepthNearFarOrderValid,
      isObject2DHandlesEnabled,
      activeObjectHandleMode,
      lastObjectHandleRotateDeltaDeg,
      lastObjectHandleScaleMultiplier,
      lastObjectHandleHeightDeltaYUnits,
      isFloorAnchorDragActive,
      isFloorAnchorDragEnabled,
      isFloorClickPlacementEnabled,
      lastAcceptedFloorClick,
      lastRejectedFloorClick,
      modelLoadError,
      modelLoadState,
      modelPath,
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
    const limits = FLOOR_MAPPING_LIMITS[field];
    const clamped = clampValue(value, limits.min, limits.max);
    const nextMapping = { ...floorMapping, [field]: clamped };
    setFloorMapping(nextMapping);
    if (!options?.fromImport && lastAcceptedFloorClick) {
      const mapped = mapFloorPointToObjectTransform(lastAcceptedFloorClick, nextMapping);
      updateTransformState((current) => ({
        ...current,
        positionX: mapped.positionX,
        positionZ: mapped.positionZ,
      }), { markOwned: true });
    }
  };

  const handleResetFloorMapping = () => {
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

  const applyFloorPlacement = (point: FloorPoint) => {
    const mapped = mapFloorPointToObjectTransform(point, floorMapping);
    updateTransformState((prev) => ({ ...prev, positionX: mapped.positionX, positionZ: mapped.positionZ }), {
      markOwned: true,
    });
    setLastAcceptedFloorClick(point);
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
    if (!isObject2DHandlesEnabled || !lastAcceptedFloorClick) return;
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

  const handleObjectRotateHandlePointerDown = (event: PointerEvent<SVGElement>) => {
    if (!isObject2DHandlesEnabled || !lastAcceptedFloorClick) return;
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
    if (!isObject2DHandlesEnabled || !lastAcceptedFloorClick) return;
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
    if (!isObject2DHandlesEnabled || !lastAcceptedFloorClick) return;
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
    applyFloorPlacement(normalizedPoint);
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
    applyFloorPlacement(normalizedPoint);
  };

  const handleFloorAnchorPointerDown = (event: PointerEvent<SVGCircleElement>) => {
    if (!isFloorAnchorDragEnabled) return;
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
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 1.1, 3.2);

    const ambient = new THREE.AmbientLight(0xffffff, 0.8);
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
    keyLight.position.set(3, 6, 5);
    scene.add(ambient);
    scene.add(keyLight);
    const placementGroup = new THREE.Group();
    const modelNormalizationGroup = new THREE.Group();
    placementGroup.add(modelNormalizationGroup);
    scene.add(placementGroup);
    placementGroupRef.current = placementGroup;
    modelNormalizationGroupRef.current = modelNormalizationGroup;
    applyPlacementTransform();
    applyModelNormalization();

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
      modelNormalizationGroup.remove(current);
      disposeObject3D(current);
      activeObjectRef.current = null;
    };

    const setActiveObject = (object: THREE.Object3D, kind: ActiveObjectKind) => {
      removeActiveObject();
      modelNormalizationGroup.add(object);
      activeObjectRef.current = object;
      setActiveObjectKind(kind);
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
      if (activeObjectRef.current) {
        modelNormalizationGroup.remove(activeObjectRef.current);
        disposeObject3D(activeObjectRef.current);
        activeObjectRef.current = null;
      }
      placementGroupRef.current = null;
      modelNormalizationGroupRef.current = null;
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
          <h1 className="text-2xl font-semibold tracking-tight">3D Room Lab (Phase 0A)</h1>
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-slate-100">Manual Transform Controls</h2>
            <div className="flex items-center gap-2">
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
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={autoRotateEnabled}
                  onChange={(event) => setAutoRotateEnabled(event.target.checked)}
                  className="accent-emerald-400"
                />
                Auto-rotate
              </label>
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
              <button
                type="button"
                onClick={handleResetFloorMapping}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200"
              >
                Reset mapping
              </button>
              <button
                type="button"
                onClick={handleResetPerspectiveDepthScaling}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200"
              >
                Reset depth scaling
              </button>
            </div>
          </div>
          {isFloorAnchorDragEnabled && !lastAcceptedFloorClick && (
            <p className="mt-2 text-xs text-amber-300">
              Click inside the floor polygon first to create an anchor marker, then drag it to move the object.
            </p>
          )}
          {isObject2DHandlesEnabled && !lastAcceptedFloorClick && (
            <p className="mt-1 text-xs text-amber-300">
              Enable object 2D handles is on. Click inside the floor polygon first to create an anchor.
            </p>
          )}
          {isObject2DHandlesEnabled && lastAcceptedFloorClick && (
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
            {isFloorClickPlacementEnabled && isFloorAnchorDragEnabled && (
              <p className="mt-1 text-amber-200">
                Anchor drag takes precedence on the marker; background floor clicks still place the object.
              </p>
            )}
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
              <button
                type="button"
                onClick={handleResetModelNormalization}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200"
              >
                Reset normalization
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Normalization corrects the loaded model itself (floor contact, facing, native scale). Transform controls
              still place the object in the room.
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
            <h3 className="text-xs font-medium text-slate-200">Floor mapping tuning</h3>
            <div className="mt-2 grid gap-2 md:grid-cols-3">
              <TransformControlRow
                label="World width"
                value={floorMapping.worldWidth}
                min={FLOOR_MAPPING_LIMITS.worldWidth.min}
                max={FLOOR_MAPPING_LIMITS.worldWidth.max}
                step={FLOOR_MAPPING_LIMITS.worldWidth.step}
                onChange={(value) => updateFloorMappingField("worldWidth", value)}
              />
              <TransformControlRow
                label="World depth"
                value={floorMapping.worldDepth}
                min={FLOOR_MAPPING_LIMITS.worldDepth.min}
                max={FLOOR_MAPPING_LIMITS.worldDepth.max}
                step={FLOOR_MAPPING_LIMITS.worldDepth.step}
                onChange={(value) => updateFloorMappingField("worldDepth", value)}
              />
              <TransformControlRow
                label="Depth center Y"
                value={floorMapping.depthCenterY}
                min={FLOOR_MAPPING_LIMITS.depthCenterY.min}
                max={FLOOR_MAPPING_LIMITS.depthCenterY.max}
                step={FLOOR_MAPPING_LIMITS.depthCenterY.step}
                onChange={(value) => updateFloorMappingField("depthCenterY", value)}
              />
            </div>
          </div>
          <div className="mt-4 border-t border-slate-800 pt-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-medium text-slate-200">Perspective depth scaling</h3>
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
                onLoad={() => setImageLoadState("loaded")}
                onError={() => setImageLoadState("error")}
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
                    className={isFloorAnchorDragEnabled ? "cursor-move" : undefined}
                    pointerEvents={isFloorAnchorDragEnabled ? "all" : "none"}
                    aria-label="Object floor anchor marker"
                    onPointerDown={handleFloorAnchorPointerDown}
                  />
                )}
                {isObject2DHandlesEnabled && lastAcceptedFloorClick && (
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
          <h2 className="text-sm font-medium text-slate-100">Debug status</h2>
          <div className="mt-2 grid gap-2 text-xs text-slate-300 md:grid-cols-2">
            {debugRows.map((row) => (
              <p key={row.label} className="rounded border border-slate-800 bg-slate-950/70 px-2 py-1">
                <span className="text-slate-500">{row.label}:</span> {row.value}
              </p>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Default local asset path: <code>{DEFAULT_MODEL_GLB_PATH}</code>
          </p>
        </section>

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
      </div>
    </main>
  );
}
