export const SCENE_STATE_SCHEMA_VERSION = "vibode-3d-room-lab-scene-state/v0";

export type FloorPoint = { x: number; y: number };

export type TransformState = {
  positionX: number;
  positionY: number;
  positionZ: number;
  rotationYDeg: number;
  uniformScale: number;
};

export type FloorMappingState = {
  worldWidth: number;
  worldDepth: number;
  depthCenterY: number;
};

export type PerspectiveDepthScalingState = {
  enabled: boolean;
  nearScaleMultiplier: number;
  farScaleMultiplier: number;
  nearFloorY: number;
  farFloorY: number;
};

export type ImportedSceneValidated = {
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
    perspectiveDepthScaling: PerspectiveDepthScalingState;
  };
  exportedAt: string | null;
};

type NumberRange = { min: number; max: number };

export type SceneStateValidationConfig = {
  transformLimits: Record<keyof TransformState, NumberRange>;
  floorMappingLimits: Record<keyof FloorMappingState, NumberRange>;
  perspectiveDepthScalingLimits: Record<
    keyof Omit<PerspectiveDepthScalingState, "enabled">,
    NumberRange
  >;
  defaultFloorMapping: FloorMappingState;
  defaultPerspectiveDepthScaling: PerspectiveDepthScalingState;
};

export type SceneStatePayloadInput = {
  exportedAtIso: string;
  roomImageUrl: string;
  modelPath: string;
  activeObjectType: "glb" | "fallbackCube" | "none";
  glbLoadStatus: string;
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
    perspectiveDepthScaling: PerspectiveDepthScalingState;
  };
  debug: {
    rendererSize: { width: number; height: number };
    imageStatus: string;
    modelStatus: string;
  };
};

function clampValue(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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

export function buildSceneStatePayload(input: SceneStatePayloadInput) {
  return {
    schemaVersion: SCENE_STATE_SCHEMA_VERSION,
    exportedAt: input.exportedAtIso,
    roomImageUrl: input.roomImageUrl || null,
    model: {
      modelPath: input.modelPath,
      activeObjectType: input.activeObjectType,
      glbLoadStatus: input.glbLoadStatus,
    },
    transform: {
      positionX: input.transform.positionX,
      positionY: input.transform.positionY,
      positionZ: input.transform.positionZ,
      rotationYDegrees: input.transform.rotationYDeg,
      scale: input.transform.uniformScale,
      autoRotate: input.transform.autoRotate,
    },
    floor: {
      polygon: input.floor.polygon.map(roundPoint),
      overlayVisible: input.floor.overlayVisible,
      placementModeEnabled: input.floor.placementModeEnabled,
      lastAcceptedClick: input.floor.lastAcceptedClick ? roundPoint(input.floor.lastAcceptedClick) : null,
      lastRejectedClick: input.floor.lastRejectedClick ? roundPoint(input.floor.lastRejectedClick) : null,
      mapping: {
        worldWidth: input.floor.mapping.worldWidth,
        worldDepth: input.floor.mapping.worldDepth,
        depthCenterY: input.floor.mapping.depthCenterY,
      },
      perspectiveDepthScaling: {
        enabled: input.floor.perspectiveDepthScaling.enabled,
        nearScaleMultiplier: input.floor.perspectiveDepthScaling.nearScaleMultiplier,
        farScaleMultiplier: input.floor.perspectiveDepthScaling.farScaleMultiplier,
        nearFloorY: input.floor.perspectiveDepthScaling.nearFloorY,
        farFloorY: input.floor.perspectiveDepthScaling.farFloorY,
      },
    },
    debug: {
      rendererSize: input.debug.rendererSize,
      imageStatus: input.debug.imageStatus,
      modelStatus: input.debug.modelStatus,
    },
    notes: [
      "Floor polygon points are normalized to the displayed container, not true uncropped source image pixels.",
      "Phase 0D floor click placement uses temporary linear mapping constants and is not perspective-calibrated.",
    ],
  };
}

export function validateImportedSceneJson(
  raw: unknown,
  config: SceneStateValidationConfig
): ImportedSceneValidated | string {
  if (!isRecord(raw)) return "Imported payload must be a JSON object.";
  if (raw.schemaVersion !== SCENE_STATE_SCHEMA_VERSION) {
    return `Unsupported schemaVersion. Expected ${SCENE_STATE_SCHEMA_VERSION}.`;
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
  const perspectiveDepthScalingRaw = floorRaw.perspectiveDepthScaling;
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

  let mapping: FloorMappingState = config.defaultFloorMapping;
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
        config.floorMappingLimits.worldWidth.min,
        config.floorMappingLimits.worldWidth.max
      ),
      worldDepth: clampValue(
        worldDepth,
        config.floorMappingLimits.worldDepth.min,
        config.floorMappingLimits.worldDepth.max
      ),
      depthCenterY: clampValue(
        depthCenterY,
        config.floorMappingLimits.depthCenterY.min,
        config.floorMappingLimits.depthCenterY.max
      ),
    };
  }

  let perspectiveDepthScaling = config.defaultPerspectiveDepthScaling;
  if (typeof perspectiveDepthScalingRaw !== "undefined") {
    if (!isRecord(perspectiveDepthScalingRaw)) {
      return "floor.perspectiveDepthScaling must be an object.";
    }
    const enabled = parseBoolean(perspectiveDepthScalingRaw.enabled);
    const nearScaleMultiplier = parseFiniteNumber(perspectiveDepthScalingRaw.nearScaleMultiplier);
    const farScaleMultiplier = parseFiniteNumber(perspectiveDepthScalingRaw.farScaleMultiplier);
    const nearFloorY = parseFiniteNumber(perspectiveDepthScalingRaw.nearFloorY);
    const farFloorY = parseFiniteNumber(perspectiveDepthScalingRaw.farFloorY);
    if (
      enabled === null ||
      nearScaleMultiplier === null ||
      farScaleMultiplier === null ||
      nearFloorY === null ||
      farFloorY === null
    ) {
      return "floor.perspectiveDepthScaling fields must be boolean/numeric.";
    }
    perspectiveDepthScaling = {
      enabled,
      nearScaleMultiplier: clampValue(
        nearScaleMultiplier,
        config.perspectiveDepthScalingLimits.nearScaleMultiplier.min,
        config.perspectiveDepthScalingLimits.nearScaleMultiplier.max
      ),
      farScaleMultiplier: clampValue(
        farScaleMultiplier,
        config.perspectiveDepthScalingLimits.farScaleMultiplier.min,
        config.perspectiveDepthScalingLimits.farScaleMultiplier.max
      ),
      nearFloorY: clampValue(
        nearFloorY,
        config.perspectiveDepthScalingLimits.nearFloorY.min,
        config.perspectiveDepthScalingLimits.nearFloorY.max
      ),
      farFloorY: clampValue(
        farFloorY,
        config.perspectiveDepthScalingLimits.farFloorY.min,
        config.perspectiveDepthScalingLimits.farFloorY.max
      ),
    };
  }

  return {
    roomImageUrl,
    transform: {
      positionX: clampValue(
        positionX,
        config.transformLimits.positionX.min,
        config.transformLimits.positionX.max
      ),
      positionY: clampValue(
        positionY,
        config.transformLimits.positionY.min,
        config.transformLimits.positionY.max
      ),
      positionZ: clampValue(
        positionZ,
        config.transformLimits.positionZ.min,
        config.transformLimits.positionZ.max
      ),
      rotationYDeg: clampValue(
        rotationYDeg,
        config.transformLimits.rotationYDeg.min,
        config.transformLimits.rotationYDeg.max
      ),
      uniformScale: clampValue(
        uniformScale,
        config.transformLimits.uniformScale.min,
        config.transformLimits.uniformScale.max
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
      perspectiveDepthScaling,
    },
    exportedAt: parseOptionalString((raw as Record<string, unknown>).exportedAt),
  };
}
