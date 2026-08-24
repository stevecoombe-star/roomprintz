import {
  CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
  type CalibrationImageBasis,
} from "./calibration-image-basis";
import {
  UNIT_SOURCE_COORDINATE_EXTENT,
  validateFloorSourcePolygonExtent,
  type FloorSourceCoordinateExtent,
  type FloorSourcePoint,
} from "./floor-coordinate-extent";

export const CALIBRATED_CAMERA_APPLIED_AUTHORITY_VERSION =
  "calibrated-camera-applied-authority/v1" as const;
export const CALIBRATED_CAMERA_AUTHORITY_CALIBRATION_VERSION =
  "calibrated-camera/v2" as const;
export const CALIBRATED_CAMERA_AUTHORITY_SOLVER =
  "homography-planar-cv/v1" as const;
export const CALIBRATED_CAMERA_AUTHORITY_MIN_VERTICAL_FOV_DEG = 20;
export const CALIBRATED_CAMERA_AUTHORITY_MAX_VERTICAL_FOV_DEG = 90;
export const CALIBRATED_CAMERA_AUTHORITY_POSE_COMPONENT_TOLERANCE = 1e-6;

export type AuthorityFrameSize = { width: number; height: number };
export type AuthorityFloorPoint = { x: number; y: number };
export type AuthorityFloorPolygon = readonly [
  AuthorityFloorPoint,
  AuthorityFloorPoint,
  AuthorityFloorPoint,
  AuthorityFloorPoint,
];
export type AuthorityFloorMapping = {
  worldWidth: number;
  worldDepth: number;
};
export type AuthorityCameraPose = {
  position: { x: number; y: number; z: number };
  lookAt: { x: number; y: number; z: number };
  up: { x: number; y: number; z: number };
};

export type CalibratedCameraAppliedAuthority = {
  authorityVersion: typeof CALIBRATED_CAMERA_APPLIED_AUTHORITY_VERSION;
  appliedAtIso: string;
  verticalFovDeg: number;
  frameSize: AuthorityFrameSize;
  pose: AuthorityCameraPose;
  imageBasis: CalibrationImageBasis;
  sourceFloorPolygon: AuthorityFloorPolygon;
  floorMapping: AuthorityFloorMapping;
  calibrationVersion: typeof CALIBRATED_CAMERA_AUTHORITY_CALIBRATION_VERSION;
  solver: typeof CALIBRATED_CAMERA_AUTHORITY_SOLVER;
  diagnosticsSummary: string;
};

declare const parsedAuthorityBrand: unique symbol;
export type ParsedCalibratedCameraAppliedAuthority =
  Readonly<CalibratedCameraAppliedAuthority> & {
    readonly [parsedAuthorityBrand]: true;
  };

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

const UTC_ISO_MILLIS_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
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

function parseVec3(
  value: unknown
): { x: number; y: number; z: number } | null {
  if (
    !isRecord(value) ||
    !finite(value.x) ||
    !finite(value.y) ||
    !finite(value.z)
  ) {
    return null;
  }
  return { x: value.x, y: value.y, z: value.z };
}

function vectorLength(vector: {
  x: number;
  y: number;
  z: number;
}): number {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function subtract(
  left: { x: number; y: number; z: number },
  right: { x: number; y: number; z: number }
): { x: number; y: number; z: number } {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
    z: left.z - right.z,
  };
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

function parseStrictImageBasis(
  value: unknown
): CalibrationImageBasis | null {
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
    value.coordinateSpaceVersion.decoderId !==
      CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION.decoderId ||
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
      decoderId:
        CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION.decoderId,
      normalizationPolicyVersion:
        CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION.normalizationPolicyVersion,
      orientationApplied:
        CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION.orientationApplied,
    },
    basisKind: value.basisKind,
  };
}

function parseFloorPolygon(
  value: unknown,
  extent: FloorSourceCoordinateExtent
): AuthorityFloorPolygon | null {
  const points = Array.isArray(value)
    ? value.map((point): FloorSourcePoint | null => {
        if (!isRecord(point)) return null;
        return {
          x: finite(point.x) ? point.x : Number.NaN,
          y: finite(point.y) ? point.y : Number.NaN,
        };
      })
    : null;
  const validation = validateFloorSourcePolygonExtent(points, extent);
  return validation.ok
    ? (validation.points as AuthorityFloorPolygon)
    : null;
}

/** Uses the same stable decimal receipt style as support polygon keys. */
export function buildExactSourceFloorPolygonKey(
  polygon: readonly AuthorityFloorPoint[]
): string {
  return polygon
    .map((point) => `${point.x.toFixed(8)},${point.y.toFixed(8)}`)
    .join("|");
}

/** Accepts precisely the UTC millisecond representation emitted by Date#toISOString. */
export function isStrictUtcIsoTimestamp(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !UTC_ISO_MILLIS_PATTERN.test(value)
  ) {
    return false;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

/**
 * Parse-only calibrated-camera authority contract. This module deliberately has
 * no camera solver, homography, renderer, scene-state, or compositor imports.
 */
export function parseCalibratedCameraAppliedAuthority(
  raw: unknown,
  floorSourceCoordinateExtent: FloorSourceCoordinateExtent =
    UNIT_SOURCE_COORDINATE_EXTENT
): AppliedAuthorityParseResult {
  if (!isRecord(raw)) {
    return { ok: false, reason: "authority_not_object" };
  }
  if (
    raw.authorityVersion !== CALIBRATED_CAMERA_APPLIED_AUTHORITY_VERSION
  ) {
    return { ok: false, reason: "authority_version" };
  }
  if (!isStrictUtcIsoTimestamp(raw.appliedAtIso)) {
    return { ok: false, reason: "applied_at_iso" };
  }
  if (
    !finite(raw.verticalFovDeg) ||
    raw.verticalFovDeg <
      CALIBRATED_CAMERA_AUTHORITY_MIN_VERTICAL_FOV_DEG ||
    raw.verticalFovDeg >
      CALIBRATED_CAMERA_AUTHORITY_MAX_VERTICAL_FOV_DEG
  ) {
    return { ok: false, reason: "vertical_fov" };
  }
  if (
    !isRecord(raw.frameSize) ||
    !finite(raw.frameSize.width) ||
    !finite(raw.frameSize.height) ||
    raw.frameSize.width <= 0 ||
    raw.frameSize.height <= 0
  ) {
    return { ok: false, reason: "frame_size" };
  }
  if (!isRecord(raw.pose)) return { ok: false, reason: "pose" };
  const position = parseVec3(raw.pose.position);
  const lookAt = parseVec3(raw.pose.lookAt);
  const up = parseVec3(raw.pose.up);
  if (!position || !lookAt || !up) {
    return { ok: false, reason: "pose" };
  }
  const view = subtract(lookAt, position);
  const upLength = vectorLength(up);
  if (
    vectorLength(view) <= MIN_VIEW_VECTOR_LENGTH ||
    Math.abs(upLength - 1) >
      CALIBRATED_CAMERA_AUTHORITY_POSE_COMPONENT_TOLERANCE ||
    vectorLength(cross(view, up)) <= MIN_VIEW_UP_CROSS_LENGTH
  ) {
    return { ok: false, reason: "pose" };
  }
  const imageBasis = parseStrictImageBasis(raw.imageBasis);
  if (!imageBasis) return { ok: false, reason: "image_basis" };
  const sourceFloorPolygon = parseFloorPolygon(
    raw.sourceFloorPolygon,
    floorSourceCoordinateExtent
  );
  if (!sourceFloorPolygon) {
    return { ok: false, reason: "source_floor_polygon" };
  }
  if (
    !isRecord(raw.floorMapping) ||
    !finite(raw.floorMapping.worldWidth) ||
    !finite(raw.floorMapping.worldDepth) ||
    raw.floorMapping.worldWidth <= 0 ||
    raw.floorMapping.worldDepth <= 0
  ) {
    return { ok: false, reason: "floor_mapping" };
  }
  if (
    raw.calibrationVersion !==
    CALIBRATED_CAMERA_AUTHORITY_CALIBRATION_VERSION
  ) {
    return { ok: false, reason: "calibration_version" };
  }
  if (raw.solver !== CALIBRATED_CAMERA_AUTHORITY_SOLVER) {
    return { ok: false, reason: "solver" };
  }
  if (!nonEmptyString(raw.diagnosticsSummary)) {
    return { ok: false, reason: "diagnostics_summary" };
  }

  return {
    ok: true,
    value: {
      authorityVersion: CALIBRATED_CAMERA_APPLIED_AUTHORITY_VERSION,
      appliedAtIso: raw.appliedAtIso,
      verticalFovDeg: raw.verticalFovDeg,
      frameSize: {
        width: raw.frameSize.width,
        height: raw.frameSize.height,
      },
      pose: { position, lookAt, up },
      imageBasis,
      sourceFloorPolygon,
      floorMapping: {
        worldWidth: raw.floorMapping.worldWidth,
        worldDepth: raw.floorMapping.worldDepth,
      },
      calibrationVersion:
        CALIBRATED_CAMERA_AUTHORITY_CALIBRATION_VERSION,
      solver: CALIBRATED_CAMERA_AUTHORITY_SOLVER,
      diagnosticsSummary: raw.diagnosticsSummary,
    } as ParsedCalibratedCameraAppliedAuthority,
  };
}
