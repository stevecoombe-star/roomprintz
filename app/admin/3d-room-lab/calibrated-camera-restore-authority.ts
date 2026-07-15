import {
  CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
  type CalibrationImageBasis,
} from "./calibration-image-basis";
import { floorVec3ToPlane2D, getFloorRectCorners, projectFloorPointThroughPose, type CameraPose } from "./perspective-solve";

export const CALIBRATED_CAMERA_APPLIED_AUTHORITY_VERSION =
  "calibrated-camera-applied-authority/v1" as const;
export const CALIBRATED_CAMERA_IDENTITY_EQUIVALENCE_VERSION =
  "calibrated-camera-identity-equivalence/v1" as const;
export const IDENTITY_EQUIVALENCE_MAX_CORNER_DELTA_PX = 0.01;
export const IDENTITY_EQUIVALENCE_MAX_COMPONENT_DELTA = 1e-6;

export const CALIBRATED_CAMERA_AUTHORITY_CALIBRATION_VERSION = "calibrated-camera/v2" as const;
export const CALIBRATED_CAMERA_AUTHORITY_SOLVER = "homography-planar-cv/v1" as const;
export const CALIBRATED_CAMERA_AUTHORITY_MIN_VERTICAL_FOV_DEG = 20;
export const CALIBRATED_CAMERA_AUTHORITY_MAX_VERTICAL_FOV_DEG = 90;

export type AuthorityFrameSize = { width: number; height: number };
export type AuthorityFloorPoint = { x: number; y: number };
export type AuthorityFloorPolygon = readonly [
  AuthorityFloorPoint,
  AuthorityFloorPoint,
  AuthorityFloorPoint,
  AuthorityFloorPoint,
];
export type AuthorityFloorMapping = { worldWidth: number; worldDepth: number };

export type CalibratedCameraAppliedAuthority = {
  authorityVersion: typeof CALIBRATED_CAMERA_APPLIED_AUTHORITY_VERSION;
  appliedAtIso: string;
  verticalFovDeg: number;
  frameSize: AuthorityFrameSize;
  pose: CameraPose;
  imageBasis: CalibrationImageBasis;
  sourceFloorPolygon: AuthorityFloorPolygon;
  floorMapping: AuthorityFloorMapping;
  calibrationVersion: typeof CALIBRATED_CAMERA_AUTHORITY_CALIBRATION_VERSION;
  solver: typeof CALIBRATED_CAMERA_AUTHORITY_SOLVER;
  diagnosticsSummary: string;
};

declare const parsedAuthorityBrand: unique symbol;
export type ParsedCalibratedCameraAppliedAuthority = Readonly<CalibratedCameraAppliedAuthority> & {
  readonly [parsedAuthorityBrand]: true;
};

declare const restorableIdentityBrand: unique symbol;
export type RestorableCameraIdentity = {
  readonly appliedAtIso: string;
  readonly receipt: {
    readonly authorityVersion: typeof CALIBRATED_CAMERA_APPLIED_AUTHORITY_VERSION;
    readonly equivalencePolicyVersion: typeof CALIBRATED_CAMERA_IDENTITY_EQUIVALENCE_VERSION;
    readonly maxCornerDeltaPx: number;
    readonly sourceFloorPolygonKey: string;
    readonly frameSize: AuthorityFrameSize;
    readonly basisId: string;
    readonly basisFingerprint: string;
  };
  readonly [restorableIdentityBrand]: true;
};

export type CameraIdentityMode =
  | { kind: "new_apply" }
  | { kind: "restore_existing_identity"; identity: RestorableCameraIdentity };

export type AppliedAuthorityParseResult =
  | { ok: true; value: ParsedCalibratedCameraAppliedAuthority }
  | { ok: false; reason: AppliedAuthorityParseFailureReason };

export type AppliedAuthorityParseFailureReason =
  | "authority_not_object"
  | "authority_version"
  | "applied_at_iso"
  | "vertical_fov"
  | "frame_size"
  | "pose"
  | "image_basis"
  | "source_floor_polygon"
  | "floor_mapping"
  | "calibration_version"
  | "solver"
  | "diagnostics_summary";

export type CameraIdentityRestoreFailureReason =
  | "authority-version"
  | "calibration-version"
  | "solver-version"
  | "image-basis"
  | "frame-width"
  | "frame-height"
  | "source-floor-polygon"
  | "floor-world-width"
  | "floor-world-depth"
  | "vertical-fov"
  | "pose-component-delta"
  | "projection-invalid"
  | "projection-delta";

export type CameraIdentityRestoreEvaluation =
  | { ok: true; identity: RestorableCameraIdentity }
  | { ok: false; reason: CameraIdentityRestoreFailureReason };

const UTC_ISO_MILLIS_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MIN_VIEW_VECTOR_LENGTH = 1e-9;
const MIN_VIEW_UP_CROSS_LENGTH = 1e-9;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function parseVec3(value: unknown): { x: number; y: number; z: number } | null {
  if (!isRecord(value) || !finite(value.x) || !finite(value.y) || !finite(value.z)) return null;
  return { x: value.x, y: value.y, z: value.z };
}

function vectorLength(vector: { x: number; y: number; z: number }): number {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function subtract(
  left: { x: number; y: number; z: number },
  right: { x: number; y: number; z: number }
): { x: number; y: number; z: number } {
  return { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z };
}

function cross(
  left: { x: number; y: number; z: number },
  right: { x: number; y: number; z: number }
): { x: number; y: number; z: number } {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  };
}

function parseStrictImageBasis(value: unknown): CalibrationImageBasis | null {
  if (!isRecord(value)) return null;
  if (
    !nonEmptyString(value.basisId) ||
    !nonEmptyString(value.basisFingerprint) ||
    !nonEmptyString(value.sourceImageUrl) ||
    !finite(value.decodedWidth) ||
    !finite(value.decodedHeight) ||
    value.decodedWidth <= 0 ||
    value.decodedHeight <= 0 ||
    value.encodedOrientation !== 1 ||
    value.decodedOrientationNormal !== true ||
    value.orientationTransform !== "identity" ||
    value.dimensionSource !== "server" ||
    (value.basisKind !== "original" && value.basisKind !== "derivative") ||
    !isRecord(value.coordinateSpaceVersion) ||
    value.coordinateSpaceVersion.decoderId !== CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION.decoderId ||
    value.coordinateSpaceVersion.normalizationPolicyVersion !==
      CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION.normalizationPolicyVersion ||
    value.coordinateSpaceVersion.orientationApplied !==
      CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION.orientationApplied
  ) {
    return null;
  }
  return {
    basisId: value.basisId,
    basisFingerprint: value.basisFingerprint,
    sourceImageUrl: value.sourceImageUrl,
    decodedWidth: value.decodedWidth,
    decodedHeight: value.decodedHeight,
    encodedOrientation: value.encodedOrientation,
    decodedOrientationNormal: true,
    orientationTransform: "identity",
    dimensionSource: "server",
    coordinateSpaceVersion: {
      decoderId: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION.decoderId,
      normalizationPolicyVersion: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION.normalizationPolicyVersion,
      orientationApplied: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION.orientationApplied,
    },
    basisKind: value.basisKind,
  };
}

function parseFloorPolygon(value: unknown): AuthorityFloorPolygon | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const points: AuthorityFloorPoint[] = [];
  for (const point of value) {
    if (!isRecord(point) || !finite(point.x) || !finite(point.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) {
      return null;
    }
    points.push({ x: point.x, y: point.y });
  }
  return points as unknown as AuthorityFloorPolygon;
}

function imageBasesEqual(left: CalibrationImageBasis, right: CalibrationImageBasis): boolean {
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

function floorPolygonsEqual(left: readonly AuthorityFloorPoint[], right: readonly AuthorityFloorPoint[]): boolean {
  return left.length === 4 && right.length === 4 && left.every((point, index) =>
    point.x === right[index].x && point.y === right[index].y
  );
}

function poseComponentsMatch(left: CameraPose, right: CameraPose): boolean {
  const components = [
    left.position.x - right.position.x,
    left.position.y - right.position.y,
    left.position.z - right.position.z,
    left.lookAt.x - right.lookAt.x,
    left.lookAt.y - right.lookAt.y,
    left.lookAt.z - right.lookAt.z,
    left.up.x - right.up.x,
    left.up.y - right.up.y,
    left.up.z - right.up.z,
  ];
  return components.every((delta) => Number.isFinite(delta) && Math.abs(delta) <= IDENTITY_EQUIVALENCE_MAX_COMPONENT_DELTA);
}

/** Uses the same stable decimal receipt style as support polygon keys. */
export function buildExactSourceFloorPolygonKey(polygon: readonly AuthorityFloorPoint[]): string {
  return polygon.map((point) => `${point.x.toFixed(8)},${point.y.toFixed(8)}`).join("|");
}

/** Accepts precisely the UTC millisecond representation emitted by Date#toISOString. */
export function isStrictUtcIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !UTC_ISO_MILLIS_PATTERN.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

export function parseCalibratedCameraAppliedAuthority(raw: unknown): AppliedAuthorityParseResult {
  if (!isRecord(raw)) return { ok: false, reason: "authority_not_object" };
  if (raw.authorityVersion !== CALIBRATED_CAMERA_APPLIED_AUTHORITY_VERSION) {
    return { ok: false, reason: "authority_version" };
  }
  if (!isStrictUtcIsoTimestamp(raw.appliedAtIso)) return { ok: false, reason: "applied_at_iso" };
  if (
    !finite(raw.verticalFovDeg) ||
    raw.verticalFovDeg < CALIBRATED_CAMERA_AUTHORITY_MIN_VERTICAL_FOV_DEG ||
    raw.verticalFovDeg > CALIBRATED_CAMERA_AUTHORITY_MAX_VERTICAL_FOV_DEG
  ) {
    return { ok: false, reason: "vertical_fov" };
  }
  if (!isRecord(raw.frameSize) || !finite(raw.frameSize.width) || !finite(raw.frameSize.height) ||
    raw.frameSize.width <= 0 || raw.frameSize.height <= 0) {
    return { ok: false, reason: "frame_size" };
  }
  if (!isRecord(raw.pose)) return { ok: false, reason: "pose" };
  const position = parseVec3(raw.pose.position);
  const lookAt = parseVec3(raw.pose.lookAt);
  const up = parseVec3(raw.pose.up);
  if (!position || !lookAt || !up) return { ok: false, reason: "pose" };
  const view = subtract(lookAt, position);
  const upLength = vectorLength(up);
  if (
    vectorLength(view) <= MIN_VIEW_VECTOR_LENGTH ||
    Math.abs(upLength - 1) > IDENTITY_EQUIVALENCE_MAX_COMPONENT_DELTA ||
    vectorLength(cross(view, up)) <= MIN_VIEW_UP_CROSS_LENGTH
  ) {
    return { ok: false, reason: "pose" };
  }
  const imageBasis = parseStrictImageBasis(raw.imageBasis);
  if (!imageBasis) return { ok: false, reason: "image_basis" };
  const sourceFloorPolygon = parseFloorPolygon(raw.sourceFloorPolygon);
  if (!sourceFloorPolygon) return { ok: false, reason: "source_floor_polygon" };
  if (!isRecord(raw.floorMapping) || !finite(raw.floorMapping.worldWidth) || !finite(raw.floorMapping.worldDepth) ||
    raw.floorMapping.worldWidth <= 0 || raw.floorMapping.worldDepth <= 0) {
    return { ok: false, reason: "floor_mapping" };
  }
  if (raw.calibrationVersion !== CALIBRATED_CAMERA_AUTHORITY_CALIBRATION_VERSION) {
    return { ok: false, reason: "calibration_version" };
  }
  if (raw.solver !== CALIBRATED_CAMERA_AUTHORITY_SOLVER) return { ok: false, reason: "solver" };
  if (!nonEmptyString(raw.diagnosticsSummary)) return { ok: false, reason: "diagnostics_summary" };

  return {
    ok: true,
    value: {
      authorityVersion: CALIBRATED_CAMERA_APPLIED_AUTHORITY_VERSION,
      appliedAtIso: raw.appliedAtIso,
      verticalFovDeg: raw.verticalFovDeg,
      frameSize: { width: raw.frameSize.width, height: raw.frameSize.height },
      pose: { position, lookAt, up },
      imageBasis,
      sourceFloorPolygon,
      floorMapping: { worldWidth: raw.floorMapping.worldWidth, worldDepth: raw.floorMapping.worldDepth },
      calibrationVersion: CALIBRATED_CAMERA_AUTHORITY_CALIBRATION_VERSION,
      solver: CALIBRATED_CAMERA_AUTHORITY_SOLVER,
      diagnosticsSummary: raw.diagnosticsSummary,
    } as ParsedCalibratedCameraAppliedAuthority,
  };
}

export function evaluateCalibratedCameraIdentityRestore(input: {
  authority: ParsedCalibratedCameraAppliedAuthority;
  currentImageBasis: CalibrationImageBasis;
  currentFrameSize: AuthorityFrameSize;
  currentSourceFloorPolygon: readonly AuthorityFloorPoint[];
  currentFloorMapping: AuthorityFloorMapping;
  currentFovDeg: number;
  freshCandidatePose: CameraPose;
  currentCalibrationVersion?: string;
  currentSolver?: string;
}): CameraIdentityRestoreEvaluation {
  const authority = input.authority;
  if (authority.authorityVersion !== CALIBRATED_CAMERA_APPLIED_AUTHORITY_VERSION) {
    return { ok: false, reason: "authority-version" };
  }
  if ((input.currentCalibrationVersion ?? CALIBRATED_CAMERA_AUTHORITY_CALIBRATION_VERSION) !== authority.calibrationVersion) {
    return { ok: false, reason: "calibration-version" };
  }
  if ((input.currentSolver ?? CALIBRATED_CAMERA_AUTHORITY_SOLVER) !== authority.solver) {
    return { ok: false, reason: "solver-version" };
  }
  if (!imageBasesEqual(authority.imageBasis, input.currentImageBasis)) return { ok: false, reason: "image-basis" };
  if (authority.frameSize.width !== input.currentFrameSize.width) return { ok: false, reason: "frame-width" };
  if (authority.frameSize.height !== input.currentFrameSize.height) return { ok: false, reason: "frame-height" };
  if (!floorPolygonsEqual(authority.sourceFloorPolygon, input.currentSourceFloorPolygon)) {
    return { ok: false, reason: "source-floor-polygon" };
  }
  if (authority.floorMapping.worldWidth !== input.currentFloorMapping.worldWidth) {
    return { ok: false, reason: "floor-world-width" };
  }
  if (authority.floorMapping.worldDepth !== input.currentFloorMapping.worldDepth) {
    return { ok: false, reason: "floor-world-depth" };
  }
  if (authority.verticalFovDeg !== input.currentFovDeg) return { ok: false, reason: "vertical-fov" };
  if (!poseComponentsMatch(authority.pose, input.freshCandidatePose)) {
    return { ok: false, reason: "pose-component-delta" };
  }

  const corners = getFloorRectCorners({
    widthMeters: authority.floorMapping.worldWidth,
    depthMeters: authority.floorMapping.worldDepth,
  });
  if (!corners.ok) return { ok: false, reason: "projection-invalid" };
  let maxCornerDeltaPx = 0;
  for (const worldCorner of corners.value.asArray) {
    const floorCorner = floorVec3ToPlane2D(worldCorner);
    const persistedProjection = projectFloorPointThroughPose(
      authority.pose,
      authority.frameSize,
      { verticalFovDeg: authority.verticalFovDeg },
      floorCorner
    );
    const freshProjection = projectFloorPointThroughPose(
      input.freshCandidatePose,
      input.currentFrameSize,
      { verticalFovDeg: input.currentFovDeg },
      floorCorner
    );
    if (!persistedProjection.ok || !freshProjection.ok) return { ok: false, reason: "projection-invalid" };
    const delta = Math.hypot(
      persistedProjection.value.x - freshProjection.value.x,
      persistedProjection.value.y - freshProjection.value.y
    );
    if (!Number.isFinite(delta)) return { ok: false, reason: "projection-invalid" };
    maxCornerDeltaPx = Math.max(maxCornerDeltaPx, delta);
  }
  if (maxCornerDeltaPx > IDENTITY_EQUIVALENCE_MAX_CORNER_DELTA_PX) {
    return { ok: false, reason: "projection-delta" };
  }
  return {
    ok: true,
    identity: {
      appliedAtIso: authority.appliedAtIso,
      receipt: {
        authorityVersion: CALIBRATED_CAMERA_APPLIED_AUTHORITY_VERSION,
        equivalencePolicyVersion: CALIBRATED_CAMERA_IDENTITY_EQUIVALENCE_VERSION,
        maxCornerDeltaPx,
        sourceFloorPolygonKey: buildExactSourceFloorPolygonKey(authority.sourceFloorPolygon),
        frameSize: { ...authority.frameSize },
        basisId: authority.imageBasis.basisId,
        basisFingerprint: authority.imageBasis.basisFingerprint,
      },
    } as RestorableCameraIdentity,
  };
}

export function selectAppliedAtIso(identityMode: CameraIdentityMode, nowIso: string): string {
  return identityMode.kind === "restore_existing_identity" ? identityMode.identity.appliedAtIso : nowIso;
}
