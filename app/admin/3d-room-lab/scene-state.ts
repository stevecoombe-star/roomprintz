export const SCENE_STATE_SCHEMA_VERSION = "vibode-3d-room-lab-scene-state/v0";
export const SCENE_IMAGE_COORDINATE_SPACE_V0 = "container-normalized-v0";
export const CALIBRATED_SCENE_STATE_CALIBRATION_VERSION_V1 = "calibrated-camera/v1";
export const CALIBRATED_SCENE_STATE_SOLVER_V1 = "homography-planar-cv/v1";
export const CALIBRATED_SCENE_STATE_MIN_VERTICAL_FOV_DEG = 20;
export const CALIBRATED_SCENE_STATE_MAX_VERTICAL_FOV_DEG = 90;

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

export type ModelNormalizationState = {
  modelYOffset: number;
  modelYawOffsetDeg: number;
  modelScaleMultiplier: number;
};

export type SceneImageMetadata = {
  intrinsicWidth: number;
  intrinsicHeight: number;
  coordinateSpace: typeof SCENE_IMAGE_COORDINATE_SPACE_V0;
};

export type CalibratedSceneStateCalibrationV1 = {
  calibrationVersion: typeof CALIBRATED_SCENE_STATE_CALIBRATION_VERSION_V1;
  solver: typeof CALIBRATED_SCENE_STATE_SOLVER_V1;
  intrinsics: {
    verticalFovDeg: number;
  };
  frameAspect: number;
  source: {
    imageUrl: string;
    intrinsicWidth: number;
    intrinsicHeight: number;
  };
};

export type ValidatedCalibrationBlock =
  | {
      kind: "valid";
      value: CalibratedSceneStateCalibrationV1;
    }
  | {
      kind: "absent";
    }
  | {
      kind: "ignored";
      reason: string;
    };

// Phase 2J-B3: pure provenance compatibility check used during deferred
// calibrated-camera restore. It compares a persisted (already B1-validated)
// calibration block against the currently usable image/frame context. It does
// NOT evaluate solver/apply confidence gates (those live with the live camera
// pose diagnostics) and it never compares raw viewport pixels — only the
// persisted frameAspect vs. the current usable renderer aspect. Aspect
// thresholds are passed in by the caller so the existing calibrated frame-match
// constants remain the single source of truth (no second threshold system).
export type CalibrationRestoreCompatibility =
  | { ok: true; aspectDeltaPercent: number; warning: string | null }
  | { ok: false; reason: string };

export function evaluateCalibrationRestoreCompatibility(input: {
  calibration: CalibratedSceneStateCalibrationV1;
  currentRoomImageUrl: string;
  currentIntrinsicWidth: number | null;
  currentIntrinsicHeight: number | null;
  currentFrameAspect: number;
  aspectWarnDeltaPercent: number;
  aspectAutoRevertDeltaPercent: number;
}): CalibrationRestoreCompatibility {
  const { calibration } = input;

  // Remain fail-closed even though B1 validation already guarantees these.
  if (calibration.calibrationVersion !== CALIBRATED_SCENE_STATE_CALIBRATION_VERSION_V1) {
    return { ok: false, reason: "unsupported calibration version" };
  }
  if (calibration.solver !== CALIBRATED_SCENE_STATE_SOLVER_V1) {
    return { ok: false, reason: "unsupported solver" };
  }

  const persistedUrl = calibration.source.imageUrl.trim();
  const currentUrl = input.currentRoomImageUrl.trim();
  if (persistedUrl.length === 0 || currentUrl.length === 0 || persistedUrl !== currentUrl) {
    return { ok: false, reason: "room image URL differs from calibration source" };
  }

  if (
    input.currentIntrinsicWidth === null ||
    input.currentIntrinsicHeight === null ||
    !Number.isFinite(input.currentIntrinsicWidth) ||
    !Number.isFinite(input.currentIntrinsicHeight) ||
    input.currentIntrinsicWidth <= 0 ||
    input.currentIntrinsicHeight <= 0
  ) {
    return { ok: false, reason: "current intrinsic image dimensions unavailable" };
  }
  if (
    input.currentIntrinsicWidth !== calibration.source.intrinsicWidth ||
    input.currentIntrinsicHeight !== calibration.source.intrinsicHeight
  ) {
    return { ok: false, reason: "intrinsic image dimensions differ from calibration source" };
  }

  const persistedAspect = calibration.frameAspect;
  if (!Number.isFinite(persistedAspect) || persistedAspect <= 0) {
    return { ok: false, reason: "persisted frame aspect invalid" };
  }
  if (!Number.isFinite(input.currentFrameAspect) || input.currentFrameAspect <= 0) {
    return { ok: false, reason: "current frame aspect unavailable" };
  }

  const aspectDeltaPercent =
    (Math.abs(input.currentFrameAspect - persistedAspect) / persistedAspect) * 100;
  if (aspectDeltaPercent >= input.aspectAutoRevertDeltaPercent) {
    return {
      ok: false,
      reason: `frame aspect changed too much (da=${aspectDeltaPercent.toFixed(2)}%)`,
    };
  }

  const warning =
    aspectDeltaPercent > input.aspectWarnDeltaPercent
      ? `frame aspect drift within tolerance (da=${aspectDeltaPercent.toFixed(2)}%)`
      : null;
  return { ok: true, aspectDeltaPercent, warning };
}

export type ImportedSceneValidated = {
  roomImageUrl: string | null;
  modelPath: string | null;
  modelNormalization: ModelNormalizationState;
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
  image: SceneImageMetadata | null;
  calibration: ValidatedCalibrationBlock;
  exportedAt: string | null;
};

type NumberRange = { min: number; max: number };

export type SceneStateValidationConfig = {
  transformLimits: Record<keyof TransformState, NumberRange>;
  modelNormalizationLimits: Record<keyof ModelNormalizationState, NumberRange>;
  floorMappingLimits: Record<keyof FloorMappingState, NumberRange>;
  perspectiveDepthScalingLimits: Record<
    keyof Omit<PerspectiveDepthScalingState, "enabled">,
    NumberRange
  >;
  defaultModelNormalization: ModelNormalizationState;
  defaultFloorMapping: FloorMappingState;
  defaultPerspectiveDepthScaling: PerspectiveDepthScalingState;
};

export type SceneStatePayloadInput = {
  exportedAtIso: string;
  roomImageUrl: string;
  modelPath: string;
  activeObjectType: "glb" | "fallbackCube" | "none";
  glbLoadStatus: string;
  modelNormalization: ModelNormalizationState;
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
  image?: SceneImageMetadata | null;
  calibration?: CalibratedSceneStateCalibrationV1;
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

function parseRequiredTrimmedString(value: unknown): string | null {
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

function parseValidatedCalibrationBlock(rawCalibration: unknown): ValidatedCalibrationBlock {
  if (typeof rawCalibration === "undefined") {
    return { kind: "absent" };
  }
  if (!isRecord(rawCalibration)) {
    return { kind: "ignored", reason: "calibration must be an object when provided." };
  }

  const calibrationVersion = parseRequiredTrimmedString(rawCalibration.calibrationVersion);
  if (!calibrationVersion) {
    return { kind: "ignored", reason: "calibration.calibrationVersion is required." };
  }
  if (calibrationVersion !== CALIBRATED_SCENE_STATE_CALIBRATION_VERSION_V1) {
    return {
      kind: "ignored",
      reason: `Unsupported calibration.calibrationVersion. Expected ${CALIBRATED_SCENE_STATE_CALIBRATION_VERSION_V1}.`,
    };
  }

  const solver = parseRequiredTrimmedString(rawCalibration.solver);
  if (!solver) {
    return { kind: "ignored", reason: "calibration.solver is required." };
  }
  if (solver !== CALIBRATED_SCENE_STATE_SOLVER_V1) {
    return {
      kind: "ignored",
      reason: `Unsupported calibration.solver. Expected ${CALIBRATED_SCENE_STATE_SOLVER_V1}.`,
    };
  }

  if (!isRecord(rawCalibration.intrinsics)) {
    return { kind: "ignored", reason: "calibration.intrinsics must be an object." };
  }
  const verticalFovDeg = parseFiniteNumber(rawCalibration.intrinsics.verticalFovDeg);
  if (
    verticalFovDeg === null ||
    verticalFovDeg < CALIBRATED_SCENE_STATE_MIN_VERTICAL_FOV_DEG ||
    verticalFovDeg > CALIBRATED_SCENE_STATE_MAX_VERTICAL_FOV_DEG
  ) {
    return {
      kind: "ignored",
      reason: `calibration.intrinsics.verticalFovDeg must be within ${CALIBRATED_SCENE_STATE_MIN_VERTICAL_FOV_DEG}-${CALIBRATED_SCENE_STATE_MAX_VERTICAL_FOV_DEG}.`,
    };
  }

  const frameAspect = parseFiniteNumber(rawCalibration.frameAspect);
  if (frameAspect === null || frameAspect <= 0) {
    return { kind: "ignored", reason: "calibration.frameAspect must be a positive number." };
  }

  if (!isRecord(rawCalibration.source)) {
    return { kind: "ignored", reason: "calibration.source must be an object." };
  }
  const imageUrl = parseRequiredTrimmedString(rawCalibration.source.imageUrl);
  const intrinsicWidth = parseFiniteNumber(rawCalibration.source.intrinsicWidth);
  const intrinsicHeight = parseFiniteNumber(rawCalibration.source.intrinsicHeight);
  if (!imageUrl) {
    return { kind: "ignored", reason: "calibration.source.imageUrl must be a non-empty string." };
  }
  if (intrinsicWidth === null || intrinsicHeight === null || intrinsicWidth <= 0 || intrinsicHeight <= 0) {
    return {
      kind: "ignored",
      reason: "calibration.source.intrinsicWidth and calibration.source.intrinsicHeight must be positive numbers.",
    };
  }

  return {
    kind: "valid",
    value: {
      calibrationVersion: CALIBRATED_SCENE_STATE_CALIBRATION_VERSION_V1,
      solver: CALIBRATED_SCENE_STATE_SOLVER_V1,
      intrinsics: {
        verticalFovDeg,
      },
      frameAspect,
      source: {
        imageUrl,
        intrinsicWidth,
        intrinsicHeight,
      },
    },
  };
}

export function buildSceneStatePayload(input: SceneStatePayloadInput) {
  return {
    schemaVersion: SCENE_STATE_SCHEMA_VERSION,
    exportedAt: input.exportedAtIso,
    roomImageUrl: input.roomImageUrl || null,
    image: input.image
      ? {
          intrinsicWidth: input.image.intrinsicWidth,
          intrinsicHeight: input.image.intrinsicHeight,
          coordinateSpace: input.image.coordinateSpace,
        }
      : undefined,
    calibration: input.calibration
      ? {
          calibrationVersion: input.calibration.calibrationVersion,
          solver: input.calibration.solver,
          intrinsics: {
            verticalFovDeg: input.calibration.intrinsics.verticalFovDeg,
          },
          frameAspect: input.calibration.frameAspect,
          source: {
            imageUrl: input.calibration.source.imageUrl,
            intrinsicWidth: input.calibration.source.intrinsicWidth,
            intrinsicHeight: input.calibration.source.intrinsicHeight,
          },
        }
      : undefined,
    model: {
      modelPath: input.modelPath,
      activeObjectType: input.activeObjectType,
      glbLoadStatus: input.glbLoadStatus,
      normalization: {
        yOffset: input.modelNormalization.modelYOffset,
        yawOffsetDeg: input.modelNormalization.modelYawOffsetDeg,
        scaleMultiplier: input.modelNormalization.modelScaleMultiplier,
      },
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
  const imageRaw = (raw as Record<string, unknown>).image;
  const calibrationRaw = (raw as Record<string, unknown>).calibration;
  const modelRaw = (raw as Record<string, unknown>).model;
  const calibration = parseValidatedCalibrationBlock(calibrationRaw);
  const modelPath =
    isRecord(modelRaw) && typeof modelRaw.modelPath === "string" ? modelRaw.modelPath.trim() : null;
  const modelNormalizationRaw = isRecord(modelRaw) ? modelRaw.normalization : undefined;
  const roomImageUrl =
    roomImageUrlRaw === null
      ? null
      : typeof roomImageUrlRaw === "string"
        ? roomImageUrlRaw.trim()
        : null;
  if (roomImageUrlRaw !== null && typeof roomImageUrlRaw !== "string") {
    return "roomImageUrl must be a string or null.";
  }

  let image: SceneImageMetadata | null = null;
  if (typeof imageRaw !== "undefined") {
    if (!isRecord(imageRaw)) {
      return "image must be an object when provided.";
    }
    const intrinsicWidth = parseFiniteNumber(imageRaw.intrinsicWidth);
    const intrinsicHeight = parseFiniteNumber(imageRaw.intrinsicHeight);
    if (intrinsicWidth === null || intrinsicHeight === null || intrinsicWidth <= 0 || intrinsicHeight <= 0) {
      return "image.intrinsicWidth and image.intrinsicHeight must be positive numbers.";
    }
    if (imageRaw.coordinateSpace !== SCENE_IMAGE_COORDINATE_SPACE_V0) {
      return `image.coordinateSpace must be ${SCENE_IMAGE_COORDINATE_SPACE_V0}.`;
    }
    image = {
      intrinsicWidth,
      intrinsicHeight,
      coordinateSpace: SCENE_IMAGE_COORDINATE_SPACE_V0,
    };
  }

  let modelNormalization = config.defaultModelNormalization;
  if (typeof modelNormalizationRaw !== "undefined") {
    if (!isRecord(modelNormalizationRaw)) {
      return "model.normalization must be an object with yOffset/yawOffsetDeg/scaleMultiplier.";
    }
    const yOffset = parseFiniteNumber(modelNormalizationRaw.yOffset);
    const yawOffsetDeg = parseFiniteNumber(modelNormalizationRaw.yawOffsetDeg);
    const scaleMultiplier = parseFiniteNumber(modelNormalizationRaw.scaleMultiplier);
    if (yOffset === null || yawOffsetDeg === null || scaleMultiplier === null) {
      return "model.normalization values must be numeric.";
    }
    modelNormalization = {
      modelYOffset: clampValue(
        yOffset,
        config.modelNormalizationLimits.modelYOffset.min,
        config.modelNormalizationLimits.modelYOffset.max
      ),
      modelYawOffsetDeg: clampValue(
        yawOffsetDeg,
        config.modelNormalizationLimits.modelYawOffsetDeg.min,
        config.modelNormalizationLimits.modelYawOffsetDeg.max
      ),
      modelScaleMultiplier: clampValue(
        scaleMultiplier,
        config.modelNormalizationLimits.modelScaleMultiplier.min,
        config.modelNormalizationLimits.modelScaleMultiplier.max
      ),
    };
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
    modelPath,
    modelNormalization,
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
    image,
    calibration,
    exportedAt: parseOptionalString((raw as Record<string, unknown>).exportedAt),
  };
}
