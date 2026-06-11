"use client";

import { FormEvent, PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const LAB_GLB_PATH = "/3d-lab/furniture-test-chair.glb";
const DEFAULT_ROOM_IMAGE_URL =
  "https://images.unsplash.com/photo-1505693314120-0d443867891c?auto=format&fit=crop&w=1600&q=80";

type ImageLoadState = "idle" | "loading" | "loaded" | "error";
type ModelLoadState = "idle" | "loading" | "loaded" | "fallback" | "error";
type ActiveObjectKind = "gltf" | "fallback" | null;
type FloorPoint = { x: number; y: number };
type SceneJsonStatus = { kind: "idle" | "success" | "error"; message: string };
type TransformState = {
  positionX: number;
  positionY: number;
  positionZ: number;
  rotationYDeg: number;
  uniformScale: number;
};
type FloorMappingState = {
  worldWidth: number;
  worldDepth: number;
  depthCenterY: number;
};
type TransformStateUpdater = TransformState | ((prev: TransformState) => TransformState);
type ImportedSceneValidated = {
  roomImageUrl: string | null;
  transform: {
    positionX: number;
    positionY: number;
    positionZ: number;
    rotationYDeg: number;
    uniformScale: number;
    autoRotate: boolean;
  };
  floor: {
    polygon: FloorPoint[];
    overlayVisible: boolean;
    placementModeEnabled: boolean;
    lastAcceptedClick: FloorPoint | null;
    lastRejectedClick: FloorPoint | null;
    mapping: FloorMappingState;
  };
  exportedAt: string | null;
};

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

const DEFAULT_FLOOR_MAPPING: FloorMappingState = {
  worldWidth: 4,
  worldDepth: 4,
  depthCenterY: 0.75,
};

const FLOOR_MAPPING_LIMITS = {
  worldWidth: { min: 0.5, max: 12, step: 0.1 },
  worldDepth: { min: 0.5, max: 12, step: 0.1 },
  depthCenterY: { min: 0, max: 1, step: 0.01 },
} as const;

const TRANSFORM_LIMITS = {
  positionX: { min: -5, max: 5, step: 0.01 },
  positionY: { min: -5, max: 5, step: 0.01 },
  positionZ: { min: -10, max: 10, step: 0.01 },
  rotationYDeg: { min: -180, max: 180, step: 1 },
  uniformScale: { min: 0.1, max: 4, step: 0.01 },
} as const;

function clampValue(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

function roundPoint(point: FloorPoint): FloorPoint {
  return {
    x: Number(point.x.toFixed(3)),
    y: Number(point.y.toFixed(3)),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function parseOptionalString(value: unknown): string | null {
  if (value === null || typeof value === "undefined") return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseFloorPoint(value: unknown): FloorPoint | null {
  if (!isRecord(value)) return null;
  const x = parseFiniteNumber(value.x);
  const y = parseFiniteNumber(value.y);
  if (x === null || y === null) return null;
  return {
    x: clampValue(x, 0, 1),
    y: clampValue(y, 0, 1),
  };
}

function parseOptionalFloorPoint(value: unknown): FloorPoint | null {
  if (value === null || typeof value === "undefined") return null;
  return parseFloorPoint(value);
}

function parseFloorPolygon(value: unknown): FloorPoint[] | null {
  if (!Array.isArray(value)) return null;
  const points = value.map(parseFloorPoint).filter((point): point is FloorPoint => point !== null);
  return points.length >= 3 ? points : null;
}

function isPointInsidePolygon(point: FloorPoint, polygon: FloorPoint[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
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
  const activeObjectRef = useRef<THREE.Object3D | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const transformRef = useRef<TransformState>(GLB_DEFAULT_TRANSFORM);
  const transformOwnedRef = useRef(false);
  const autoRotateEnabledRef = useRef(false);
  const autoRotateOffsetDegRef = useRef(0);
  const dragPointerIdRef = useRef<number | null>(null);
  const floorAnchorDragPointerIdRef = useRef<number | null>(null);

  const [roomImageInput, setRoomImageInput] = useState(DEFAULT_ROOM_IMAGE_URL);
  const [roomImageUrl, setRoomImageUrl] = useState(DEFAULT_ROOM_IMAGE_URL);
  const [imageLoadState, setImageLoadState] = useState<ImageLoadState>(
    DEFAULT_ROOM_IMAGE_URL ? "loading" : "idle"
  );
  const [modelLoadState, setModelLoadState] = useState<ModelLoadState>("idle");
  const [modelLoadError, setModelLoadError] = useState<string | null>(null);
  const [rendererSize, setRendererSize] = useState({ width: 0, height: 0 });
  const [activeObjectKind, setActiveObjectKind] = useState<ActiveObjectKind>(null);
  const [autoRotateEnabled, setAutoRotateEnabled] = useState(false);
  const [transform, setTransform] = useState<TransformState>(GLB_DEFAULT_TRANSFORM);
  const [showFloorOverlay, setShowFloorOverlay] = useState(true);
  const [floorPolygon, setFloorPolygon] = useState<FloorPoint[]>(DEFAULT_FLOOR_POLYGON);
  const [activeFloorHandleIndex, setActiveFloorHandleIndex] = useState<number | null>(null);
  const [isFloorClickPlacementEnabled, setIsFloorClickPlacementEnabled] = useState(false);
  const [isFloorAnchorDragEnabled, setIsFloorAnchorDragEnabled] = useState(false);
  const [isFloorAnchorDragActive, setIsFloorAnchorDragActive] = useState(false);
  const [wasLastAnchorDragMoveRejected, setWasLastAnchorDragMoveRejected] = useState(false);
  const [lastAcceptedFloorClick, setLastAcceptedFloorClick] = useState<FloorPoint | null>(null);
  const [lastRejectedFloorClick, setLastRejectedFloorClick] = useState<FloorPoint | null>(null);
  const [floorMapping, setFloorMapping] = useState<FloorMappingState>(DEFAULT_FLOOR_MAPPING);
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

  useEffect(() => {
    transformRef.current = transform;
  }, [transform]);

  useEffect(() => {
    autoRotateEnabledRef.current = autoRotateEnabled;
    if (!autoRotateEnabled) {
      autoRotateOffsetDegRef.current = 0;
    }
  }, [autoRotateEnabled]);

  const applyTransformToActiveObject = () => {
    const object = activeObjectRef.current;
    if (!object) return;
    const currentTransform = transformRef.current;
    object.position.set(currentTransform.positionX, currentTransform.positionY, currentTransform.positionZ);
    const finalRotationDeg = currentTransform.rotationYDeg + autoRotateOffsetDegRef.current;
    object.rotation.y = THREE.MathUtils.degToRad(finalRotationDeg);
    object.scale.setScalar(currentTransform.uniformScale);
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
    applyTransformToActiveObject();
  }, [transform, autoRotateEnabled]);

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
      { label: "auto-rotate", value: autoRotateEnabled ? "on" : "off" },
      { label: "active object", value: activeObjectKind ?? "none" },
      { label: "floor overlay", value: showFloorOverlay ? "on" : "off" },
      { label: "floor points", value: String(floorPolygon.length) },
      { label: "active floor handle", value: activeFloorHandleIndex === null ? "none" : String(activeFloorHandleIndex) },
      { label: "floor polygon", value: JSON.stringify(floorPolygon.map(roundPoint)) },
      { label: "floor placement mode", value: isFloorClickPlacementEnabled ? "on" : "off" },
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
      { label: "glb path", value: LAB_GLB_PATH },
    ],
    [
      activeFloorHandleIndex,
      activeObjectKind,
      autoRotateEnabled,
      envEnabled,
      floorMapping.depthCenterY,
      floorMapping.worldDepth,
      floorMapping.worldWidth,
      floorPolygon,
      imageLoadState,
      isFloorAnchorDragActive,
      isFloorAnchorDragEnabled,
      isFloorClickPlacementEnabled,
      lastAcceptedFloorClick,
      lastRejectedFloorClick,
      modelLoadError,
      modelLoadState,
      rendererSize.height,
      rendererSize.width,
      showFloorOverlay,
      transform.positionX,
      transform.positionY,
      transform.positionZ,
      transform.rotationYDeg,
      transform.uniformScale,
      wasLastAnchorDragMoveRejected,
    ]
  );

  const updateTransformField = (field: keyof TransformState, value: number) => {
    const limits = TRANSFORM_LIMITS[field];
    const clamped = clampValue(value, limits.min, limits.max);
    updateTransformState((prev) => ({ ...prev, [field]: clamped }), { markOwned: true });
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

  const handleResetTransform = () => {
    autoRotateOffsetDegRef.current = 0;
    updateTransformState(defaultTransformForKind(activeObjectKind), { markOwned: true });
  };

  const floorPolygonPointsAttribute = useMemo(
    () => floorPolygon.map((point) => `${point.x * 100},${point.y * 100}`).join(" "),
    [floorPolygon]
  );

  const buildSceneStatePayload = (exportedAtIso: string) => ({
    schemaVersion: "vibode-3d-room-lab-scene-state/v0",
    exportedAt: exportedAtIso,
    roomImageUrl: roomImageUrl || null,
    model: {
      modelPath: LAB_GLB_PATH,
      activeObjectType: toSceneActiveObjectType(activeObjectKind),
      glbLoadStatus: modelLoadState,
    },
    transform: {
      positionX: transform.positionX,
      positionY: transform.positionY,
      positionZ: transform.positionZ,
      rotationYDegrees: transform.rotationYDeg,
      scale: transform.uniformScale,
      autoRotate: autoRotateEnabled,
    },
    floor: {
      polygon: floorPolygon.map(roundPoint),
      overlayVisible: showFloorOverlay,
      placementModeEnabled: isFloorClickPlacementEnabled,
      lastAcceptedClick: lastAcceptedFloorClick ? roundPoint(lastAcceptedFloorClick) : null,
      lastRejectedClick: lastRejectedFloorClick ? roundPoint(lastRejectedFloorClick) : null,
      mapping: {
        worldWidth: floorMapping.worldWidth,
        worldDepth: floorMapping.worldDepth,
        depthCenterY: floorMapping.depthCenterY,
      },
    },
    debug: {
      rendererSize,
      imageStatus: imageLoadState,
      modelStatus: formatModelStatus(modelLoadState, modelLoadError),
    },
    notes: [
      "Floor polygon points are normalized to the displayed container, not true uncropped source image pixels.",
      "Phase 0D floor click placement uses temporary linear mapping constants and is not perspective-calibrated.",
    ],
  });

  const sceneStateJson = useMemo(() => {
    const payload = buildSceneStatePayload(sceneStateExportedAt);
    return JSON.stringify(payload, null, 2);
  }, [
    activeObjectKind,
    autoRotateEnabled,
    floorMapping.depthCenterY,
    floorMapping.worldDepth,
    floorMapping.worldWidth,
    floorPolygon,
    imageLoadState,
    isFloorClickPlacementEnabled,
    lastAcceptedFloorClick,
    lastRejectedFloorClick,
    modelLoadError,
    modelLoadState,
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

  const mapFloorPointToObjectTransform = (point: FloorPoint, mapping: FloorMappingState = floorMapping) => ({
    positionX: (point.x - 0.5) * mapping.worldWidth,
    positionZ: (point.y - mapping.depthCenterY) * mapping.worldDepth,
  });

  const applyFloorPlacement = (point: FloorPoint) => {
    const mapped = mapFloorPointToObjectTransform(point);
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
    const payload = buildSceneStatePayload(exportedAtIso);
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
    const payload = buildSceneStatePayload(exportedAtIso);
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

  const validateImportedSceneJson = (raw: unknown): ImportedSceneValidated | string => {
    if (!isRecord(raw)) return "Imported payload must be a JSON object.";
    if (raw.schemaVersion !== "vibode-3d-room-lab-scene-state/v0") {
      return "Unsupported schemaVersion. Expected vibode-3d-room-lab-scene-state/v0.";
    }

    const roomImageUrlRaw = (raw as Record<string, unknown>).roomImageUrl;
    const roomImageUrl =
      roomImageUrlRaw === null
        ? null
        : typeof roomImageUrlRaw === "string"
          ? roomImageUrlRaw.trim()
          : null;
    if (roomImageUrlRaw !== null && typeof roomImageUrlRaw !== "string") {
      return "roomImageUrl must be a string or null.";
    }

    const transformRaw = (raw as Record<string, unknown>).transform;
    const floorRaw = (raw as Record<string, unknown>).floor;
    if (!isRecord(transformRaw) || !isRecord(floorRaw)) {
      return "Imported payload must include transform and floor objects.";
    }

    const positionX = parseFiniteNumber(transformRaw.positionX);
    const positionY = parseFiniteNumber(transformRaw.positionY);
    const positionZ = parseFiniteNumber(transformRaw.positionZ);
    const rotationYDeg = parseFiniteNumber(transformRaw.rotationYDegrees);
    const uniformScale = parseFiniteNumber(transformRaw.scale);
    const autoRotate = parseBoolean(transformRaw.autoRotate);
    if (
      positionX === null ||
      positionY === null ||
      positionZ === null ||
      rotationYDeg === null ||
      uniformScale === null ||
      autoRotate === null
    ) {
      return "transform fields are invalid. Expected numeric position/rotation/scale and boolean autoRotate.";
    }

    const polygon = parseFloorPolygon(floorRaw.polygon);
    const mappingRaw = floorRaw.mapping;
    const overlayVisible = parseBoolean(floorRaw.overlayVisible);
    const placementModeEnabled = parseBoolean(floorRaw.placementModeEnabled);
    const lastAcceptedClick = parseOptionalFloorPoint(floorRaw.lastAcceptedClick);
    const lastRejectedClick = parseOptionalFloorPoint(floorRaw.lastRejectedClick);
    if (!polygon) {
      return "floor.polygon must include at least 3 valid {x,y} points.";
    }
    if (overlayVisible === null || placementModeEnabled === null) {
      return "floor.overlayVisible and floor.placementModeEnabled must be booleans.";
    }
    if (floorRaw.lastAcceptedClick !== null && typeof floorRaw.lastAcceptedClick !== "undefined" && !lastAcceptedClick) {
      return "floor.lastAcceptedClick must be null or a valid {x,y} point.";
    }
    if (floorRaw.lastRejectedClick !== null && typeof floorRaw.lastRejectedClick !== "undefined" && !lastRejectedClick) {
      return "floor.lastRejectedClick must be null or a valid {x,y} point.";
    }

    let mapping: FloorMappingState = DEFAULT_FLOOR_MAPPING;
    if (typeof mappingRaw !== "undefined") {
      if (!isRecord(mappingRaw)) {
        return "floor.mapping must be an object with worldWidth/worldDepth/depthCenterY.";
      }
      const worldWidth = parseFiniteNumber(mappingRaw.worldWidth);
      const worldDepth = parseFiniteNumber(mappingRaw.worldDepth);
      const depthCenterY = parseFiniteNumber(mappingRaw.depthCenterY);
      if (worldWidth === null || worldDepth === null || depthCenterY === null) {
        return "floor.mapping values must be numeric.";
      }
      mapping = {
        worldWidth: clampValue(
          worldWidth,
          FLOOR_MAPPING_LIMITS.worldWidth.min,
          FLOOR_MAPPING_LIMITS.worldWidth.max
        ),
        worldDepth: clampValue(
          worldDepth,
          FLOOR_MAPPING_LIMITS.worldDepth.min,
          FLOOR_MAPPING_LIMITS.worldDepth.max
        ),
        depthCenterY: clampValue(
          depthCenterY,
          FLOOR_MAPPING_LIMITS.depthCenterY.min,
          FLOOR_MAPPING_LIMITS.depthCenterY.max
        ),
      };
    }

    return {
      roomImageUrl,
      transform: {
        positionX: clampValue(positionX, TRANSFORM_LIMITS.positionX.min, TRANSFORM_LIMITS.positionX.max),
        positionY: clampValue(positionY, TRANSFORM_LIMITS.positionY.min, TRANSFORM_LIMITS.positionY.max),
        positionZ: clampValue(positionZ, TRANSFORM_LIMITS.positionZ.min, TRANSFORM_LIMITS.positionZ.max),
        rotationYDeg: clampValue(
          rotationYDeg,
          TRANSFORM_LIMITS.rotationYDeg.min,
          TRANSFORM_LIMITS.rotationYDeg.max
        ),
        uniformScale: clampValue(
          uniformScale,
          TRANSFORM_LIMITS.uniformScale.min,
          TRANSFORM_LIMITS.uniformScale.max
        ),
        autoRotate,
      },
      floor: {
        polygon,
        overlayVisible,
        placementModeEnabled,
        lastAcceptedClick,
        lastRejectedClick,
        mapping,
      },
      exportedAt: parseOptionalString((raw as Record<string, unknown>).exportedAt),
    };
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

    const validated = validateImportedSceneJson(parsed);
    if (typeof validated === "string") {
      setImportSceneStatus({
        kind: "error",
        message: validated,
      });
      return;
    }

    const nextRoomImageUrl = validated.roomImageUrl ?? "";
    setRoomImageInput(nextRoomImageUrl);
    setRoomImageUrl(nextRoomImageUrl);
    setImageLoadState(nextRoomImageUrl ? "loading" : "idle");

    updateTransformState({
      positionX: validated.transform.positionX,
      positionY: validated.transform.positionY,
      positionZ: validated.transform.positionZ,
      rotationYDeg: validated.transform.rotationYDeg,
      uniformScale: validated.transform.uniformScale,
    }, { markOwned: true });
    setAutoRotateEnabled(validated.transform.autoRotate);

    setFloorPolygon(validated.floor.polygon);
    setShowFloorOverlay(validated.floor.overlayVisible);
    setIsFloorClickPlacementEnabled(validated.floor.placementModeEnabled);
    setLastAcceptedFloorClick(validated.floor.lastAcceptedClick);
    setLastRejectedFloorClick(validated.floor.lastRejectedClick);
    setFloorMapping(validated.floor.mapping);
    setWasLastAnchorDragMoveRejected(false);
    setIsFloorAnchorDragActive(false);
    setActiveFloorHandleIndex(null);
    dragPointerIdRef.current = null;
    floorAnchorDragPointerIdRef.current = null;

    setSceneStateExportedAt(validated.exportedAt ?? "imported-scene");
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
      scene.add(cube);
      activeObjectRef.current = cube;
      setActiveObjectKind("fallback");
      if (!transformOwnedRef.current) {
        updateTransformState(FALLBACK_DEFAULT_TRANSFORM);
      }
      applyTransformToActiveObject();
    };

    const loader = new GLTFLoader();
    loader.load(
      LAB_GLB_PATH,
      (gltf) => {
        if (isDisposed) {
          disposeObject3D(gltf.scene);
          return;
        }
        gltf.scene.scale.set(1.15, 1.15, 1.15);
        gltf.scene.position.set(0, -0.85, 0);
        scene.add(gltf.scene);
        activeObjectRef.current = gltf.scene;
        setActiveObjectKind("gltf");
        if (!transformOwnedRef.current) {
          updateTransformState(GLB_DEFAULT_TRANSFORM);
        }
        setModelLoadState("loaded");
        applyTransformToActiveObject();
      },
      undefined,
      (error) => {
        if (isDisposed) return;
        const message = error instanceof Error ? error.message : "Unable to load GLB asset.";
        addFallbackCube(message);
      }
    );

    const animate = () => {
      if (isDisposed) return;
      animationFrameRef.current = window.requestAnimationFrame(animate);
      if (autoRotateEnabledRef.current) {
        autoRotateOffsetDegRef.current = (autoRotateOffsetDegRef.current + 0.3) % 360;
      }
      applyTransformToActiveObject();
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
      if (activeObjectRef.current) {
        scene.remove(activeObjectRef.current);
        disposeObject3D(activeObjectRef.current);
        activeObjectRef.current = null;
      }
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
            </div>
          </div>
          {isFloorAnchorDragEnabled && !lastAcceptedFloorClick && (
            <p className="mt-2 text-xs text-amber-300">
              Click inside the floor polygon first to create an anchor marker, then drag it to move the object.
            </p>
          )}
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
                    onPointerDown={handleFloorAnchorPointerDown}
                  />
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
            Expected local asset path: <code>{LAB_GLB_PATH}</code>
          </p>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-slate-100">Scene State JSON</h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleCopySceneJson()}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200"
              >
                Copy scene JSON
              </button>
              <button
                type="button"
                onClick={handleDownloadSceneJson}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200"
              >
                Download scene JSON
              </button>
            </div>
          </div>
          <p
            className={`mt-2 text-xs ${
              sceneJsonStatus.kind === "error"
                ? "text-rose-300"
                : sceneJsonStatus.kind === "success"
                  ? "text-emerald-300"
                  : "text-slate-400"
            }`}
          >
            {sceneJsonStatus.message}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">Exported at: {sceneStateExportedAt}</p>
          <textarea
            readOnly
            value={sceneStateJson}
            className="mt-3 h-80 w-full rounded-lg border border-slate-800 bg-slate-950/80 p-3 font-mono text-xs text-slate-200 outline-none"
            aria-label="Scene State JSON"
          />

          <div className="mt-5 border-t border-slate-800 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium text-slate-100">Import Scene JSON</h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleApplyImportedSceneJson}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200"
                >
                  Apply imported JSON
                </button>
                <button
                  type="button"
                  onClick={handleClearImportedSceneJson}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-slate-500 hover:text-slate-100"
                >
                  Clear import
                </button>
              </div>
            </div>
            <p
              className={`mt-2 text-xs ${
                importSceneStatus.kind === "error"
                  ? "text-rose-300"
                  : importSceneStatus.kind === "success"
                    ? "text-emerald-300"
                    : "text-slate-400"
              }`}
            >
              {importSceneStatus.message}
            </p>
            <textarea
              value={importSceneJsonInput}
              onChange={(event) => setImportSceneJsonInput(event.target.value)}
              placeholder='Paste a payload with schemaVersion "vibode-3d-room-lab-scene-state/v0"'
              className="mt-3 h-56 w-full rounded-lg border border-slate-800 bg-slate-950/80 p-3 font-mono text-xs text-slate-200 outline-none focus:border-emerald-400"
              aria-label="Import Scene JSON"
            />
          </div>
        </section>
      </div>
    </main>
  );
}
