import type { CalibrationImageBasis } from "./calibration-image-basis";
import {
  isStrictUtcIsoTimestamp,
  parseCalibratedCameraAppliedAuthority,
  type CalibratedCameraAppliedAuthority,
  type ParsedCalibratedCameraAppliedAuthority,
} from "./calibrated-camera-restore-authority";
import type { ObjectSupportAttachment } from "./support-attachment";
import type { SupportReviewStatus, SupportSource } from "./support-model";
import type {
  CeilingConfirmationStamp,
  CeilingPolygon,
  CeilingSupportDraft,
} from "./ceiling-support-geometry";
import type {
  WallConfirmationStamp,
  WallPolygon,
  WallSupportDraft,
  WallSupportKind,
} from "./wall-support-geometry";
import {
  CEILING_HEIGHT_MAX_WORLD_UNITS,
  CEILING_HEIGHT_MIN_WORLD_UNITS,
} from "./support-plane-math";

export const LEGACY_SCENE_STATE_SCHEMA_VERSION = "vibode-3d-room-lab-scene-state/v0";
export const SCENE_STATE_SCHEMA_VERSION = "vibode-3d-room-lab-scene-state/v1";
export const SCENE_IMAGE_COORDINATE_SPACE_V0 = "container-normalized-v0";
export const CALIBRATED_SCENE_STATE_CALIBRATION_VERSION_V1 = "calibrated-camera/v1";
export const CALIBRATED_SCENE_STATE_CALIBRATION_VERSION_V2 = "calibrated-camera/v2";
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

export type CalibratedSceneStateCalibrationV2 = {
  calibrationVersion: typeof CALIBRATED_SCENE_STATE_CALIBRATION_VERSION_V2;
  solver: typeof CALIBRATED_SCENE_STATE_SOLVER_V1;
  intrinsics: {
    verticalFovDeg: number;
  };
  source: {
    imageBasis: CalibrationImageBasis;
    sourceFloorPolygon: FloorPoint[];
  };
};

export type ValidatedCalibrationBlock =
  | {
      kind: "valid";
      value: CalibratedSceneStateCalibrationV2;
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
  calibration: CalibratedSceneStateCalibrationV2;
  currentImageBasis: CalibrationImageBasis | null;
}): CalibrationRestoreCompatibility {
  const { calibration, currentImageBasis } = input;

  // Remain fail-closed even though B1 validation already guarantees these.
  if (calibration.calibrationVersion !== CALIBRATED_SCENE_STATE_CALIBRATION_VERSION_V2) {
    return { ok: false, reason: "unsupported calibration version" };
  }
  if (calibration.solver !== CALIBRATED_SCENE_STATE_SOLVER_V1) {
    return { ok: false, reason: "unsupported solver" };
  }
  if (!currentImageBasis) {
    return { ok: false, reason: "basis_unavailable" };
  }
  const persistedBasis = calibration.source.imageBasis;
  if (currentImageBasis.basisFingerprint !== persistedBasis.basisFingerprint) {
    return { ok: false, reason: "basis_fingerprint_mismatch" };
  }
  if (
    currentImageBasis.decodedWidth !== persistedBasis.decodedWidth ||
    currentImageBasis.decodedHeight !== persistedBasis.decodedHeight
  ) {
    return { ok: false, reason: "basis_dimension_mismatch" };
  }
  if (
    currentImageBasis.encodedOrientation !== persistedBasis.encodedOrientation ||
    currentImageBasis.decodedOrientationNormal !== persistedBasis.decodedOrientationNormal ||
    currentImageBasis.orientationTransform !== persistedBasis.orientationTransform
  ) {
    return { ok: false, reason: "basis_orientation_not_normal" };
  }
  if (
    currentImageBasis.coordinateSpaceVersion.decoderId !==
      persistedBasis.coordinateSpaceVersion.decoderId ||
    currentImageBasis.coordinateSpaceVersion.normalizationPolicyVersion !==
      persistedBasis.coordinateSpaceVersion.normalizationPolicyVersion ||
    currentImageBasis.coordinateSpaceVersion.orientationApplied !==
      persistedBasis.coordinateSpaceVersion.orientationApplied
  ) {
    return { ok: false, reason: "basis_coordinate_space_mismatch" };
  }
  if (currentImageBasis.basisKind !== persistedBasis.basisKind) {
    return { ok: false, reason: "basis_derivative_not_authority_eligible" };
  }
  return { ok: true, aspectDeltaPercent: 0, warning: null };
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
  calibrationAppliedAuthority: ParsedCalibratedCameraAppliedAuthority | null;
  supports: PersistedSupportState | null;
  attachment: ObjectSupportAttachment | null;
  exportedAt: string | null;
};

export type PersistedFloorSupportState = {
  sourceNormalizedPolygon: FloorPoint[];
  reviewStatus: SupportReviewStatus;
  source: SupportSource;
  supportImageBasis: CalibrationImageBasis | null;
  authorityEligible: boolean;
};

export type PersistedWallSupportState = {
  draft: WallSupportDraft;
  supportImageBasis: CalibrationImageBasis | null;
};

export type PersistedCeilingSupportState = {
  draft: CeilingSupportDraft;
  supportImageBasis: CalibrationImageBasis | null;
};

export type PersistedSupportState = {
  floor: PersistedFloorSupportState;
  walls: Record<WallSupportKind, PersistedWallSupportState | null>;
  ceiling: PersistedCeilingSupportState | null;
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
  calibration?: CalibratedSceneStateCalibrationV2;
  calibrationAppliedAuthority?: CalibratedCameraAppliedAuthority;
  supports: PersistedSupportState;
  attachment: ObjectSupportAttachment | null;
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

function parseCalibrationImageBasis(
  value: unknown
): CalibrationImageBasis | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.basisId !== "string" ||
    typeof value.basisFingerprint !== "string" ||
    typeof value.sourceImageUrl !== "string"
  ) {
    return null;
  }
  const decodedWidth = parseFiniteNumber(value.decodedWidth);
  const decodedHeight = parseFiniteNumber(value.decodedHeight);
  const encodedOrientation = parseFiniteNumber(value.encodedOrientation);
  if (
    decodedWidth === null ||
    decodedHeight === null ||
    encodedOrientation === null ||
    decodedWidth <= 0 ||
    decodedHeight <= 0
  ) {
    return null;
  }
  if (value.decodedOrientationNormal !== true) return null;
  if (value.orientationTransform !== "identity") return null;
  if (value.dimensionSource !== "server") return null;
  if (!isRecord(value.coordinateSpaceVersion)) return null;
  const coordinateSpaceVersion = value.coordinateSpaceVersion;
  if (
    typeof coordinateSpaceVersion.decoderId !== "string" ||
    typeof coordinateSpaceVersion.normalizationPolicyVersion !== "string" ||
    typeof coordinateSpaceVersion.orientationApplied !== "boolean"
  ) {
    return null;
  }
  if (value.basisKind !== "original" && value.basisKind !== "derivative") return null;
  return {
    basisId: value.basisId,
    basisFingerprint: value.basisFingerprint,
    sourceImageUrl: value.sourceImageUrl,
    decodedWidth,
    decodedHeight,
    encodedOrientation,
    decodedOrientationNormal: true,
    orientationTransform: "identity",
    dimensionSource: "server",
    coordinateSpaceVersion: {
      decoderId: coordinateSpaceVersion.decoderId,
      normalizationPolicyVersion: coordinateSpaceVersion.normalizationPolicyVersion,
      orientationApplied: coordinateSpaceVersion.orientationApplied,
    },
    basisKind: value.basisKind,
  };
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
  if (calibrationVersion === CALIBRATED_SCENE_STATE_CALIBRATION_VERSION_V1) {
    return {
      kind: "ignored",
      reason: "basis_legacy_receipt_missing",
    };
  }
  if (calibrationVersion !== CALIBRATED_SCENE_STATE_CALIBRATION_VERSION_V2) {
    return {
      kind: "ignored",
      reason: `Unsupported calibration.calibrationVersion. Expected ${CALIBRATED_SCENE_STATE_CALIBRATION_VERSION_V2}.`,
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

  if (!isRecord(rawCalibration.source)) {
    return { kind: "ignored", reason: "calibration.source must be an object." };
  }
  const imageBasis = parseCalibrationImageBasis(rawCalibration.source.imageBasis);
  const sourceFloorPolygon = parseSourceNormalizedQuad(rawCalibration.source.sourceFloorPolygon);
  if (!imageBasis) {
    return {
      kind: "ignored",
      reason: "calibration.source.imageBasis must be a valid basis receipt.",
    };
  }
  if (!sourceFloorPolygon || sourceFloorPolygon.length !== 4) {
    return {
      kind: "ignored",
      reason: "calibration.source.sourceFloorPolygon must contain exactly four valid points.",
    };
  }

  return {
    kind: "valid",
    value: {
      calibrationVersion: CALIBRATED_SCENE_STATE_CALIBRATION_VERSION_V2,
      solver: CALIBRATED_SCENE_STATE_SOLVER_V1,
      intrinsics: {
        verticalFovDeg,
      },
      source: {
        imageBasis,
        sourceFloorPolygon,
      },
    },
  };
}

const SUPPORT_REVIEW_STATUSES: readonly SupportReviewStatus[] = [
  "unavailable",
  "suggested",
  "needs_review",
  "manually_confirmed",
  "locally_verified",
];
const SUPPORT_SOURCES: readonly SupportSource[] = ["manual", "model_suggested", "derived"];
const WALL_SUPPORT_KINDS: readonly WallSupportKind[] = ["wall_back", "wall_left", "wall_right"];

function parseExactString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseReviewStatus(value: unknown): SupportReviewStatus | null {
  return typeof value === "string" && SUPPORT_REVIEW_STATUSES.includes(value as SupportReviewStatus)
    ? value as SupportReviewStatus
    : null;
}

function parseSupportSource(value: unknown): SupportSource | null {
  return typeof value === "string" && SUPPORT_SOURCES.includes(value as SupportSource)
    ? value as SupportSource
    : null;
}

function parseSourceNormalizedQuad(value: unknown): [FloorPoint, FloorPoint, FloorPoint, FloorPoint] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const points: FloorPoint[] = [];
  for (const point of value) {
    if (!isRecord(point)) return null;
    const x = parseFiniteNumber(point.x);
    const y = parseFiniteNumber(point.y);
    if (x === null || y === null || x < 0 || x > 1 || y < 0 || y > 1) return null;
    points.push({ x, y });
  }
  return points as [FloorPoint, FloorPoint, FloorPoint, FloorPoint];
}

function parseWallConfirmationStamp(value: unknown, requireStrictTimestamp: boolean): WallConfirmationStamp | null {
  if (value === null) return null;
  if (!isRecord(value)) return null;
  const wallPolygonKey = parseExactString(value.wallPolygonKey);
  const imageBasisId = parseExactString(value.imageBasisId);
  const imageBasisFingerprint = parseExactString(value.imageBasisFingerprint);
  const cameraAppliedAtIso = parseExactString(value.cameraAppliedAtIso);
  const frameWidth = parseFiniteNumber(value.frameWidth);
  const frameHeight = parseFiniteNumber(value.frameHeight);
  const hasWallGeometryPolicyVersion = Object.prototype.hasOwnProperty.call(value, "wallGeometryPolicyVersion");
  let wallGeometryPolicyVersion: string | undefined;
  if (hasWallGeometryPolicyVersion) {
    if (
      typeof value.wallGeometryPolicyVersion !== "string" ||
      value.wallGeometryPolicyVersion.trim().length === 0
    ) return null;
    wallGeometryPolicyVersion = value.wallGeometryPolicyVersion;
  }
  if (!wallPolygonKey || !imageBasisId || !imageBasisFingerprint || !cameraAppliedAtIso ||
    (requireStrictTimestamp && !isStrictUtcIsoTimestamp(cameraAppliedAtIso)) ||
    frameWidth === null || frameHeight === null || frameWidth <= 0 || frameHeight <= 0) return null;
  return {
    wallPolygonKey,
    imageBasisId,
    imageBasisFingerprint,
    cameraAppliedAtIso,
    frameWidth,
    frameHeight,
    ...(hasWallGeometryPolicyVersion ? { wallGeometryPolicyVersion } : {}),
  };
}

function parseCeilingConfirmationStamp(value: unknown, requireStrictTimestamp: boolean): CeilingConfirmationStamp | null {
  if (value === null) return null;
  if (!isRecord(value)) return null;
  const ceilingPolygonKey = parseExactString(value.ceilingPolygonKey);
  const roomHeightKey = parseExactString(value.roomHeightKey);
  const imageBasisId = parseExactString(value.imageBasisId);
  const imageBasisFingerprint = parseExactString(value.imageBasisFingerprint);
  const cameraAppliedAtIso = parseExactString(value.cameraAppliedAtIso);
  const frameWidth = parseFiniteNumber(value.frameWidth);
  const frameHeight = parseFiniteNumber(value.frameHeight);
  if (!ceilingPolygonKey || !roomHeightKey || !imageBasisId || !imageBasisFingerprint || !cameraAppliedAtIso ||
    (requireStrictTimestamp && !isStrictUtcIsoTimestamp(cameraAppliedAtIso)) ||
    frameWidth === null || frameHeight === null || frameWidth <= 0 || frameHeight <= 0) return null;
  return { ceilingPolygonKey, roomHeightKey, imageBasisId, imageBasisFingerprint, cameraAppliedAtIso, frameWidth, frameHeight };
}

function parseWallSupportState(
  value: unknown,
  expectedKind: WallSupportKind,
  requireStrictTimestamp: boolean
): PersistedWallSupportState | null {
  if (value === null) return null;
  if (!isRecord(value) || !isRecord(value.draft)) return null;
  const draft = value.draft;
  const kind = draft.kind;
  const enabled = parseBoolean(draft.enabled);
  const source = parseSupportSource(draft.source);
  const reviewStatus = parseReviewStatus(draft.reviewStatus);
  const polygon = draft.imagePolygonSourceNorm === null
    ? null
    : parseSourceNormalizedQuad(draft.imagePolygonSourceNorm);
  const confirmationStamp = parseWallConfirmationStamp(draft.confirmationStamp, requireStrictTimestamp);
  const supportImageBasis = value.supportImageBasis === null
    ? null
    : parseCalibrationImageBasis(value.supportImageBasis);
  if (kind !== expectedKind || enabled === null || !source || !reviewStatus ||
    (draft.imagePolygonSourceNorm !== null && !polygon) ||
    (draft.confirmationStamp !== null && !confirmationStamp) ||
    (value.supportImageBasis !== null && !supportImageBasis)) return null;
  return {
    draft: {
      kind: expectedKind,
      enabled,
      source,
      imagePolygonSourceNorm: polygon as WallPolygon | null,
      reviewStatus,
      confirmationStamp,
    },
    supportImageBasis,
  };
}

function parseCeilingSupportState(value: unknown, requireStrictTimestamp: boolean): PersistedCeilingSupportState | null {
  if (value === null) return null;
  if (!isRecord(value) || !isRecord(value.draft)) return null;
  const draft = value.draft;
  const enabled = parseBoolean(draft.enabled);
  const source = parseSupportSource(draft.source);
  const reviewStatus = parseReviewStatus(draft.reviewStatus);
  const polygon = draft.imagePolygonSourceNorm === null
    ? null
    : parseSourceNormalizedQuad(draft.imagePolygonSourceNorm);
  const roomHeight = parseFiniteNumber(draft.roomHeight);
  const confirmationStamp = parseCeilingConfirmationStamp(draft.confirmationStamp, requireStrictTimestamp);
  const supportImageBasis = value.supportImageBasis === null
    ? null
    : parseCalibrationImageBasis(value.supportImageBasis);
  if (enabled === null || !source || !reviewStatus || roomHeight === null ||
    roomHeight < CEILING_HEIGHT_MIN_WORLD_UNITS || roomHeight > CEILING_HEIGHT_MAX_WORLD_UNITS ||
    (draft.imagePolygonSourceNorm !== null && !polygon) ||
    (draft.confirmationStamp !== null && !confirmationStamp) ||
    (value.supportImageBasis !== null && !supportImageBasis)) return null;
  return {
    draft: {
      enabled,
      source,
      imagePolygonSourceNorm: polygon as CeilingPolygon | null,
      roomHeight,
      reviewStatus,
      confirmationStamp,
    },
    supportImageBasis,
  };
}

function parsePersistedSupports(value: unknown, requireStrictTimestamp: boolean): PersistedSupportState | null {
  if (!isRecord(value) || !isRecord(value.floor) || !isRecord(value.walls)) return null;
  const floor = value.floor;
  const sourceNormalizedPolygon = parseSourceNormalizedQuad(floor.sourceNormalizedPolygon);
  const reviewStatus = parseReviewStatus(floor.reviewStatus);
  const source = parseSupportSource(floor.source);
  const supportImageBasis = floor.supportImageBasis === null
    ? null
    : parseCalibrationImageBasis(floor.supportImageBasis);
  const authorityEligible = parseBoolean(floor.authorityEligible);
  if (!sourceNormalizedPolygon || !reviewStatus || !source || authorityEligible === null ||
    (floor.supportImageBasis !== null && !supportImageBasis)) return null;
  const walls = {
    wall_back: parseWallSupportState(value.walls.wall_back, "wall_back", requireStrictTimestamp),
    wall_left: parseWallSupportState(value.walls.wall_left, "wall_left", requireStrictTimestamp),
    wall_right: parseWallSupportState(value.walls.wall_right, "wall_right", requireStrictTimestamp),
  };
  if (
    (value.walls.wall_back !== null && !walls.wall_back) ||
    (value.walls.wall_left !== null && !walls.wall_left) ||
    (value.walls.wall_right !== null && !walls.wall_right)
  ) return null;
  const ceiling = parseCeilingSupportState(value.ceiling, requireStrictTimestamp);
  if (value.ceiling !== null && !ceiling) return null;
  return { floor: { sourceNormalizedPolygon, reviewStatus, source, supportImageBasis, authorityEligible }, walls, ceiling };
}

function parseAttachment(
  value: unknown,
  scaleRange: NumberRange,
  requireStrictTimestamp: boolean
): ObjectSupportAttachment | null {
  if (value === null) return null;
  if (!isRecord(value)) return null;
  const supportKind = value.supportKind;
  const supportBindingKey = typeof value.supportBindingKey === "string" ? value.supportBindingKey : null;
  const localPosition = isRecord(value.localPosition) ? value.localPosition : null;
  const u = localPosition ? parseFiniteNumber(localPosition.u) : null;
  const v = localPosition ? parseFiniteNumber(localPosition.v) : null;
  const rotationAboutNormalDeg = parseFiniteNumber(value.rotationAboutNormalDeg);
  const uniformScale = parseFiniteNumber(value.uniformScale);
  const attachedAtIso = parseExactString(value.attachedAtIso);
  const contactProfile = value.contactProfile;
  if (
    !WALL_SUPPORT_KINDS.includes(supportKind as WallSupportKind) && supportKind !== "floor" && supportKind !== "ceiling" ||
    supportBindingKey === null || u === null || v === null || rotationAboutNormalDeg === null ||
    uniformScale === null || uniformScale < scaleRange.min || uniformScale > scaleRange.max || !attachedAtIso ||
    (requireStrictTimestamp && !isStrictUtcIsoTimestamp(attachedAtIso)) ||
    !isRecord(contactProfile)
  ) return null;
  const validProfile =
    (supportKind === "floor" && contactProfile.kind === "floor" && contactProfile.contactAxis === "local_y" && contactProfile.contactSide === "min") ||
    (WALL_SUPPORT_KINDS.includes(supportKind as WallSupportKind) && contactProfile.kind === "wall" && contactProfile.contactAxis === "local_z" &&
      (contactProfile.contactSide === "min" || contactProfile.contactSide === "max")) ||
    (supportKind === "ceiling" && contactProfile.kind === "ceiling" && contactProfile.contactAxis === "local_y" &&
      (contactProfile.contactSide === "min" || contactProfile.contactSide === "max"));
  if (!validProfile) return null;
  return {
    supportKind,
    supportBindingKey,
    localPosition: { u, v },
    rotationAboutNormalDeg,
    uniformScale,
    contactProfile: contactProfile as ObjectSupportAttachment["contactProfile"],
    attachedAtIso,
  } as ObjectSupportAttachment;
}

function calibrationImageBasesExactlyEqual(left: CalibrationImageBasis, right: CalibrationImageBasis): boolean {
  return (
    left.basisId === right.basisId &&
    left.basisFingerprint === right.basisFingerprint &&
    left.sourceImageUrl === right.sourceImageUrl &&
    left.decodedWidth === right.decodedWidth &&
    left.decodedHeight === right.decodedHeight &&
    left.encodedOrientation === right.encodedOrientation &&
    left.decodedOrientationNormal === right.decodedOrientationNormal &&
    left.orientationTransform === right.orientationTransform &&
    left.dimensionSource === right.dimensionSource &&
    left.coordinateSpaceVersion.decoderId === right.coordinateSpaceVersion.decoderId &&
    left.coordinateSpaceVersion.normalizationPolicyVersion === right.coordinateSpaceVersion.normalizationPolicyVersion &&
    left.coordinateSpaceVersion.orientationApplied === right.coordinateSpaceVersion.orientationApplied &&
    left.basisKind === right.basisKind
  );
}

function sourceFloorPolygonsExactlyEqual(left: readonly FloorPoint[], right: readonly FloorPoint[]): boolean {
  return left.length === 4 && right.length === 4 && left.every((point, index) =>
    point.x === right[index].x && point.y === right[index].y
  );
}

function authorityCrossFieldsMatch(input: {
  calibration: ValidatedCalibrationBlock;
  supports: PersistedSupportState;
  authority: ParsedCalibratedCameraAppliedAuthority;
  floorMappingRaw: unknown;
}): boolean {
  const { calibration, supports, authority, floorMappingRaw } = input;
  if (calibration.kind !== "valid" || !isRecord(floorMappingRaw)) return false;
  const worldWidth = parseFiniteNumber(floorMappingRaw.worldWidth);
  const worldDepth = parseFiniteNumber(floorMappingRaw.worldDepth);
  return !!(
    sourceFloorPolygonsExactlyEqual(calibration.value.source.sourceFloorPolygon, supports.floor.sourceNormalizedPolygon) &&
    sourceFloorPolygonsExactlyEqual(calibration.value.source.sourceFloorPolygon, authority.sourceFloorPolygon) &&
    calibration.value.intrinsics.verticalFovDeg === authority.verticalFovDeg &&
    calibration.value.calibrationVersion === authority.calibrationVersion &&
    calibration.value.solver === authority.solver &&
    calibrationImageBasesExactlyEqual(calibration.value.source.imageBasis, authority.imageBasis) &&
    worldWidth !== null &&
    worldDepth !== null &&
    worldWidth === authority.floorMapping.worldWidth &&
    worldDepth === authority.floorMapping.worldDepth
  );
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
          source: {
            imageBasis: input.calibration.source.imageBasis,
            sourceFloorPolygon: input.calibration.source.sourceFloorPolygon.map((point) => ({
              x: point.x,
              y: point.y,
            })),
          },
        }
      : undefined,
    calibrationAppliedAuthority: input.calibrationAppliedAuthority
      ? {
          authorityVersion: input.calibrationAppliedAuthority.authorityVersion,
          appliedAtIso: input.calibrationAppliedAuthority.appliedAtIso,
          verticalFovDeg: input.calibrationAppliedAuthority.verticalFovDeg,
          frameSize: { ...input.calibrationAppliedAuthority.frameSize },
          pose: {
            position: { ...input.calibrationAppliedAuthority.pose.position },
            lookAt: { ...input.calibrationAppliedAuthority.pose.lookAt },
            up: { ...input.calibrationAppliedAuthority.pose.up },
          },
          imageBasis: {
            ...input.calibrationAppliedAuthority.imageBasis,
            coordinateSpaceVersion: { ...input.calibrationAppliedAuthority.imageBasis.coordinateSpaceVersion },
          },
          sourceFloorPolygon: input.calibrationAppliedAuthority.sourceFloorPolygon.map((point) => ({
            x: point.x,
            y: point.y,
          })),
          floorMapping: { ...input.calibrationAppliedAuthority.floorMapping },
          calibrationVersion: input.calibrationAppliedAuthority.calibrationVersion,
          solver: input.calibrationAppliedAuthority.solver,
          diagnosticsSummary: input.calibrationAppliedAuthority.diagnosticsSummary,
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
    supports: {
      floor: {
        sourceNormalizedPolygon: input.supports.floor.sourceNormalizedPolygon.map((point) => ({ x: point.x, y: point.y })),
        reviewStatus: input.supports.floor.reviewStatus,
        source: input.supports.floor.source,
        supportImageBasis: input.supports.floor.supportImageBasis,
        authorityEligible: input.supports.floor.authorityEligible,
      },
      walls: Object.fromEntries(
        WALL_SUPPORT_KINDS.map((kind) => {
          const support = input.supports.walls[kind];
          return [kind, support
            ? {
                draft: {
                  ...support.draft,
                  imagePolygonSourceNorm: support.draft.imagePolygonSourceNorm?.map((point) => ({ x: point.x, y: point.y })) ?? null,
                  confirmationStamp: support.draft.confirmationStamp
                    ? { ...support.draft.confirmationStamp }
                    : null,
                },
                supportImageBasis: support.supportImageBasis,
              }
            : null];
        })
      ),
      ceiling: input.supports.ceiling
        ? {
            draft: {
              ...input.supports.ceiling.draft,
              imagePolygonSourceNorm: input.supports.ceiling.draft.imagePolygonSourceNorm?.map((point) => ({ x: point.x, y: point.y })) ?? null,
              confirmationStamp: input.supports.ceiling.draft.confirmationStamp
                ? { ...input.supports.ceiling.draft.confirmationStamp }
                : null,
            },
            supportImageBasis: input.supports.ceiling.supportImageBasis,
          }
        : null,
    },
    attachment: input.attachment
      ? {
          supportKind: input.attachment.supportKind,
          supportBindingKey: input.attachment.supportBindingKey,
          localPosition: { ...input.attachment.localPosition },
          rotationAboutNormalDeg: input.attachment.rotationAboutNormalDeg,
          uniformScale: input.attachment.uniformScale,
          contactProfile: { ...input.attachment.contactProfile },
          attachedAtIso: input.attachment.attachedAtIso,
        }
      : null,
    debug: {
      rendererSize: input.debug.rendererSize,
      imageStatus: input.debug.imageStatus,
      modelStatus: input.debug.modelStatus,
    },
    notes: [
      "Floor polygon points are normalized to the displayed container for UI editing.",
      "Source-normalized floor polygon is persisted for Type A calibration authority and restore compatibility.",
      "Phase 0D floor click placement uses temporary linear mapping constants and is not perspective-calibrated.",
    ],
  };
}

export function validateImportedSceneJson(
  raw: unknown,
  config: SceneStateValidationConfig
): ImportedSceneValidated | string {
  if (!isRecord(raw)) return "Imported payload must be a JSON object.";
  const isCurrentVersion = raw.schemaVersion === SCENE_STATE_SCHEMA_VERSION;
  if (!isCurrentVersion && raw.schemaVersion !== LEGACY_SCENE_STATE_SCHEMA_VERSION) {
    return `Unsupported schemaVersion. Expected ${SCENE_STATE_SCHEMA_VERSION} or ${LEGACY_SCENE_STATE_SCHEMA_VERSION}.`;
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

  let supports: PersistedSupportState | null = null;
  let attachment: ObjectSupportAttachment | null = null;
  let calibrationAppliedAuthority: ParsedCalibratedCameraAppliedAuthority | null = null;
  if (isCurrentVersion) {
    if (!Object.prototype.hasOwnProperty.call(raw, "supports")) {
      return "supports is required for the current scene schema.";
    }
    if (!Object.prototype.hasOwnProperty.call(raw, "attachment")) {
      return "attachment is required for the current scene schema.";
    }
    supports = parsePersistedSupports(raw.supports, true);
    if (!supports) {
      return "supports must contain valid source-normalized floor, wall, and ceiling authority.";
    }
    if (
      calibration.kind === "valid" &&
      !sourceFloorPolygonsExactlyEqual(
        calibration.value.source.sourceFloorPolygon,
        supports.floor.sourceNormalizedPolygon
      )
    ) {
      return "calibration.source.sourceFloorPolygon contradicts supports.floor.sourceNormalizedPolygon.";
    }
    attachment = parseAttachment(raw.attachment, config.transformLimits.uniformScale, true);
    if (raw.attachment !== null && !attachment) {
      return "attachment must be a valid exact support attachment record or null.";
    }
    if (typeof raw.calibrationAppliedAuthority !== "undefined") {
      const parsedAuthority = parseCalibratedCameraAppliedAuthority(raw.calibrationAppliedAuthority);
      if (!parsedAuthority.ok) {
        return `calibrationAppliedAuthority is malformed (${parsedAuthority.reason}).`;
      }
      calibrationAppliedAuthority = parsedAuthority.value;
      if (!authorityCrossFieldsMatch({
        calibration,
        supports,
        authority: calibrationAppliedAuthority,
        floorMappingRaw: mappingRaw,
      })) {
        return "calibrationAppliedAuthority contradicts duplicated current-v1 calibration or floor authority.";
      }
    }
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
    calibrationAppliedAuthority,
    supports,
    attachment,
    exportedAt: parseOptionalString((raw as Record<string, unknown>).exportedAt),
  };
}
