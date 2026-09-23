import type { CalibrationImageBasis } from "./calibration-image-basis";
import type { ImageFrameSize } from "./image-space";
import {
  deriveVerticalWallPlane,
  intersectRayWithPlane,
  type SupportPlane,
  type SupportVec3,
} from "./support-plane-math";
import type { SupportReviewStatus, SupportSource } from "./support-model";

export type WallSupportKind = "wall_back" | "wall_left" | "wall_right";
export type SourceNormPoint = { x: number; y: number };
export type WallRay = { origin: SupportVec3; direction: SupportVec3 };
export type WallVec2 = { x: number; y: number };

/** Polygon order is lower-start, lower-end, upper-end, upper-start. */
export type WallPolygon = [SourceNormPoint, SourceNormPoint, SourceNormPoint, SourceNormPoint];

// Bump the active policy exactly when wall geometry authority materially changes:
// boundaryWorld/boundaryUV construction, plane/seam authority, upper-corner
// reconstruction, basis interpretation, polygon ordering, or finite-patch
// semantics. Do not bump for diagnostics, wording, presentation, or
// threshold-only changes that leave accepted geometry unchanged. Any intentional
// rewrite of material golden geometry values requires a policy bump.
export const WALL_GEOMETRY_POLICY_VERSION = "wall-support-geometry-policy/v1";
export const LEGACY_WALL_GEOMETRY_POLICY_VERSION = "wall-support-geometry-policy/v1";

export type WallConfirmationStamp = {
  wallPolygonKey: string;
  imageBasisId: string;
  imageBasisFingerprint: string;
  cameraAppliedAtIso: string;
  frameWidth: number;
  frameHeight: number;
  wallGeometryPolicyVersion?: string;
};

export type WallSupportDraft = {
  kind: WallSupportKind;
  enabled: boolean;
  source: SupportSource;
  imagePolygonSourceNorm: WallPolygon | null;
  reviewStatus: SupportReviewStatus;
  confirmationStamp: WallConfirmationStamp | null;
};

export type WallSupportFailureReason =
  | "wall_not_configured"
  | "wall_polygon_invalid"
  | "wall_polygon_out_of_range"
  | "wall_polygon_self_intersecting"
  | "wall_polygon_zero_area"
  | "wall_seam_too_short_image"
  | "wall_homography_invalid"
  | "wall_seam_invalid"
  | "wall_seam_too_short_world"
  | "wall_seam_camera_inconsistent"
  | "wall_excessive_extrapolation"
  | "wall_plane_invalid"
  | "wall_ray_invalid"
  | "wall_ray_parallel"
  | "wall_intersection_behind_camera"
  | "wall_intersection_non_finite"
  | "wall_upper_reconstruction_ill_conditioned"
  | "wall_upper_below_seam"
  | "wall_height_invalid"
  | "wall_height_excessive"
  | "wall_width_excessive"
  | "wall_camera_distance_excessive"
  | "wall_boundary_invalid"
  | "wall_boundary_self_intersecting"
  | "wall_boundary_zero_area"
  | "wall_reprojection_error";

export type WallSupportDiagnostics = {
  mappedSeamWorldLength: number;
  wallWidth: number;
  /** Conservative usable height: the smaller of the two per-corner heights. */
  wallHeight: number;
  upperStartHeight: number;
  upperEndHeight: number;
  minCornerHeight: number;
  maxCornerHeight: number;
  lowerSeamDisagreementStartWorld: number;
  lowerSeamDisagreementEndWorld: number;
  maxLowerSeamDisagreementWorld: number;
  /** Dot products of the normalized lower-boundary rays and wall-plane normal. */
  lowerSeamRayPlaneDenominatorStart: number;
  lowerSeamRayPlaneDenominatorEnd: number;
  /** Angle between the observed lower-seam ray and authoritative Floor point. */
  lowerSeamCameraAngleStartRad: number;
  lowerSeamCameraAngleEndRad: number;
  maxLowerSeamCameraAngleRad: number;
  /** Stable lower-seam camera-consistency policy limit, in radians. */
  maxLowerSeamCameraAngleThresholdRad: number;
  /** Signed normalized upper-start ray/plane denominator (polygon/ray index 3). */
  upperRayPlaneDenominatorStart: number;
  /** Signed normalized upper-end ray/plane denominator (polygon/ray index 2). */
  upperRayPlaneDenominatorEnd: number;
  /** Minimum absolute normalized upper-ray/plane denominator. */
  minUpperRayPlaneDenominator: number;
  /** Dimensionless upper-ray conditioning acceptance threshold. */
  minUpperRayPlaneDenominatorThreshold: number;
  maxRoundTripReprojectionErrorPx: number;
  maxSeamExtrapolationWorld: number;
  maxCameraDistance: number;
  localBasisConvention: "U=reviewed-seam; V=world-up; seamNormal=U×V";
};

export type WallSupportDerivation =
  | {
      ok: true;
      plane: SupportPlane;
      /**
       * Deterministic local-frame normal: normalize(plane.basisU × plane.basisV).
       * This may oppose the camera-facing plane.normal.
       */
      seamNormal: SupportVec3;
      boundaryWorld: SupportVec3[];
      boundaryUV: WallVec2[];
      seamWorld: [SupportVec3, SupportVec3];
      diagnostics: WallSupportDiagnostics;
    }
  | { ok: false; reasons: WallSupportFailureReason[]; diagnostics?: Partial<WallSupportDiagnostics> };

export const WALL_SUPPORT_LIMITS = {
  minImageSeamPixels: 8,
  minWorldSeamLength: 0.05,
  minWallHeight: 0.05,
  maxWallHeight: 20,
  maxWallWidthToSeamRatio: 5,
  maxWorldDistance: 50,
  maxRoundTripReprojectionErrorPx: 3,
  maxFloorExtrapolationRatio: 0.35,
  // Two degrees of observed-ray vs Floor-seam disagreement. This is angular
  // (not world-space), so it does not grow with a grazing plane intersection.
  maxLowerSeamCameraAngleRad: Math.PI / 90,
  // Dimensionless grazing-incidence measure abs(dot(normalized ray, plane normal)).
  // Values below this are too ill-conditioned for reliable upper reconstruction;
  // exact equality accepts.
  minUpperRayPlaneDenominator: 0.035,
} as const;

type DeriveWallSupportInput = {
  kind: WallSupportKind;
  polygonSourceNorm: WallPolygon | null;
  polygonContainerNorm: WallPolygon | null;
  frameSize: ImageFrameSize | null;
  mapImagePixelToFloor: (point: WallVec2) => WallVec2 | null;
  cameraPosition: SupportVec3;
  rays: readonly [WallRay | null, WallRay | null, WallRay | null, WallRay | null];
  projectWorldToPixels: (point: SupportVec3) => WallVec2 | null;
  floorBounds?: { minX: number; maxX: number; minZ: number; maxZ: number };
};

function isFiniteVec2(value: WallVec2 | null | undefined): value is WallVec2 {
  return !!value && Number.isFinite(value.x) && Number.isFinite(value.y);
}

function isFiniteVec3(value: SupportVec3 | null | undefined): value is SupportVec3 {
  return !!value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

function distance2(a: WallVec2, b: WallVec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distance3(a: SupportVec3, b: SupportVec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function subtract3(a: SupportVec3, b: SupportVec3): SupportVec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot3(a: SupportVec3, b: SupportVec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross3(a: SupportVec3, b: SupportVec3): SupportVec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normalize3(value: SupportVec3): SupportVec3 | null {
  const magnitude = Math.hypot(value.x, value.y, value.z);
  if (!Number.isFinite(magnitude) || magnitude <= 1e-9) return null;
  const normalized = { x: value.x / magnitude, y: value.y / magnitude, z: value.z / magnitude };
  return isFiniteVec3(normalized) ? normalized : null;
}

function angleBetweenNormalized3(left: SupportVec3, right: SupportVec3): number | null {
  const leftNormalized = normalize3(left);
  const rightNormalized = normalize3(right);
  if (!leftNormalized || !rightNormalized) return null;
  const cosine = Math.max(-1, Math.min(1, dot3(leftNormalized, rightNormalized)));
  const angle = Math.acos(cosine);
  return Number.isFinite(angle) ? angle : null;
}

function polygonArea(points: readonly WallVec2[]): number {
  return points.reduce((total, point, index) => {
    const next = points[(index + 1) % points.length];
    return total + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

function orientation(a: WallVec2, b: WallVec2, c: WallVec2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsIntersect(a: WallVec2, b: WallVec2, c: WallVec2, d: WallVec2): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return abC * abD < 0 && cdA * cdB < 0;
}

function isSelfIntersecting(points: readonly WallVec2[]): boolean {
  return segmentsIntersect(points[0], points[1], points[2], points[3]) ||
    segmentsIntersect(points[1], points[2], points[3], points[0]);
}

function localUv(point: SupportVec3, origin: SupportVec3, plane: SupportPlane): WallVec2 {
  const offset = subtract3(point, origin);
  return { x: dot3(offset, plane.basisU), y: dot3(offset, plane.basisV) };
}

function outsideFloorDistance(point: WallVec2, bounds: NonNullable<DeriveWallSupportInput["floorBounds"]>): number {
  const dx = Math.max(bounds.minX - point.x, 0, point.x - bounds.maxX);
  const dz = Math.max(bounds.minZ - point.y, 0, point.y - bounds.maxZ);
  return Math.hypot(dx, dz);
}

function failure(
  reasons: WallSupportFailureReason[],
  diagnostics?: Partial<WallSupportDiagnostics>
): WallSupportDerivation {
  return { ok: false, reasons: [...new Set(reasons)], diagnostics };
}

export function buildWallPolygonKey(polygon: WallPolygon | null): string {
  if (!polygon) return "none";
  return polygon.map((point) => `${point.x.toFixed(8)},${point.y.toFixed(8)}`).join("|");
}

export function createWallConfirmationStamp(
  polygon: WallPolygon,
  basis: CalibrationImageBasis,
  cameraAppliedAtIso: string,
  frameSize: ImageFrameSize
): WallConfirmationStamp {
  return {
    wallPolygonKey: buildWallPolygonKey(polygon),
    imageBasisId: basis.basisId,
    imageBasisFingerprint: basis.basisFingerprint,
    cameraAppliedAtIso,
    frameWidth: frameSize.width,
    frameHeight: frameSize.height,
    wallGeometryPolicyVersion: WALL_GEOMETRY_POLICY_VERSION,
  };
}

export function isWallConfirmationCurrent(input: {
  stamp: WallConfirmationStamp | null;
  polygon: WallPolygon | null;
  basis: CalibrationImageBasis | null;
  cameraAppliedAtIso: string | null;
  frameSize: ImageFrameSize | null;
}, activePolicyVersion = WALL_GEOMETRY_POLICY_VERSION): boolean {
  const { stamp, polygon, basis, cameraAppliedAtIso, frameSize } = input;
  const effectiveStampPolicy = stamp?.wallGeometryPolicyVersion ?? LEGACY_WALL_GEOMETRY_POLICY_VERSION;
  return !!(
    stamp &&
    polygon &&
    basis &&
    cameraAppliedAtIso &&
    frameSize &&
    effectiveStampPolicy === activePolicyVersion &&
    stamp.wallPolygonKey === buildWallPolygonKey(polygon) &&
    stamp.imageBasisId === basis.basisId &&
    stamp.imageBasisFingerprint === basis.basisFingerprint &&
    stamp.cameraAppliedAtIso === cameraAppliedAtIso &&
    stamp.frameWidth === frameSize.width &&
    stamp.frameHeight === frameSize.height
  );
}

/**
 * The local boundary coordinate system deliberately preserves reviewed seam
 * direction: U is lower-start -> lower-end and V is world +Y. `seamNormal` is
 * the deterministic normalized U×V normal for a future support-local frame.
 * `plane.normal` remains independently camera-facing for intersection and
 * front/back presentation, so callers must not infer the two normals coincide.
 */
export function deriveWallSupport(input: DeriveWallSupportInput): WallSupportDerivation {
  const { polygonSourceNorm, polygonContainerNorm, frameSize } = input;
  if (!polygonSourceNorm || !polygonContainerNorm || !frameSize || frameSize.width <= 0 || frameSize.height <= 0) {
    return failure(["wall_not_configured"]);
  }
  if (!polygonSourceNorm.every(isFiniteVec2) || !polygonContainerNorm.every(isFiniteVec2)) {
    return failure(["wall_polygon_invalid"]);
  }
  if (polygonSourceNorm.some((point) => point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)) {
    return failure(["wall_polygon_out_of_range"]);
  }
  if (isSelfIntersecting(polygonSourceNorm)) return failure(["wall_polygon_self_intersecting"]);
  if (Math.abs(polygonArea(polygonSourceNorm)) <= 1e-8) return failure(["wall_polygon_zero_area"]);

  const seamPixels: [WallVec2, WallVec2] = [
    { x: polygonContainerNorm[0].x * frameSize.width, y: polygonContainerNorm[0].y * frameSize.height },
    { x: polygonContainerNorm[1].x * frameSize.width, y: polygonContainerNorm[1].y * frameSize.height },
  ];
  if (distance2(...seamPixels) < WALL_SUPPORT_LIMITS.minImageSeamPixels) {
    return failure(["wall_seam_too_short_image"]);
  }
  const mappedSeam = seamPixels.map(input.mapImagePixelToFloor);
  if (!isFiniteVec2(mappedSeam[0]) || !isFiniteVec2(mappedSeam[1])) return failure(["wall_homography_invalid"]);
  const seamWorld: [SupportVec3, SupportVec3] = [
    { x: mappedSeam[0].x, y: 0, z: mappedSeam[0].y },
    { x: mappedSeam[1].x, y: 0, z: mappedSeam[1].y },
  ];
  const mappedSeamWorldLength = distance3(...seamWorld);
  if (mappedSeamWorldLength < WALL_SUPPORT_LIMITS.minWorldSeamLength) {
    return failure(["wall_seam_too_short_world"], { mappedSeamWorldLength });
  }

  let maxSeamExtrapolationWorld = 0;
  if (input.floorBounds) {
    const floorWidth = input.floorBounds.maxX - input.floorBounds.minX;
    const floorDepth = input.floorBounds.maxZ - input.floorBounds.minZ;
    const margin = Math.max(floorWidth, floorDepth) * WALL_SUPPORT_LIMITS.maxFloorExtrapolationRatio;
    maxSeamExtrapolationWorld = Math.max(
      outsideFloorDistance(mappedSeam[0], input.floorBounds),
      outsideFloorDistance(mappedSeam[1], input.floorBounds)
    );
    if (!Number.isFinite(margin) || maxSeamExtrapolationWorld > margin) {
      return failure(["wall_excessive_extrapolation"], { mappedSeamWorldLength, maxSeamExtrapolationWorld });
    }
  }

  const planeResult = deriveVerticalWallPlane(seamWorld[0], seamWorld[1], input.cameraPosition);
  if (!planeResult.ok) {
    return failure(
      [planeResult.reason === "invalid_wall_seam" ? "wall_seam_invalid" : "wall_plane_invalid"],
      { mappedSeamWorldLength, maxSeamExtrapolationWorld }
    );
  }
  const plane = planeResult.plane;
  const seamNormal = normalize3(cross3(plane.basisU, plane.basisV));
  if (!seamNormal) {
    return failure(["wall_plane_invalid"], { mappedSeamWorldLength, maxSeamExtrapolationWorld });
  }
  const boundaryWorld: SupportVec3[] = [];
  for (const ray of input.rays) {
    if (!ray || !isFiniteVec3(ray.origin) || !isFiniteVec3(ray.direction)) {
      return failure(["wall_ray_invalid"], { mappedSeamWorldLength, maxSeamExtrapolationWorld });
    }
    const intersection = intersectRayWithPlane({
      rayOrigin: ray.origin,
      rayDirection: ray.direction,
      planePoint: plane.point,
      planeNormal: plane.normal,
    });
    if (!intersection.ok) {
      const reason: WallSupportFailureReason =
        intersection.reason === "ray_parallel_to_plane"
          ? "wall_ray_parallel"
          : intersection.reason === "intersection_behind_ray"
            ? "wall_intersection_behind_camera"
            : intersection.reason === "non_finite_intersection"
              ? "wall_intersection_non_finite"
              : "wall_ray_invalid";
      return failure([reason], { mappedSeamWorldLength, maxSeamExtrapolationWorld });
    }
    boundaryWorld.push(intersection.point);
  }

  const lowerSeamDisagreementStartWorld = distance3(seamWorld[0], boundaryWorld[0]);
  const lowerSeamDisagreementEndWorld = distance3(seamWorld[1], boundaryWorld[1]);
  const maxLowerSeamDisagreementWorld = Math.max(
    lowerSeamDisagreementStartWorld,
    lowerSeamDisagreementEndWorld
  );
  const lowerStartRay = input.rays[0];
  const lowerEndRay = input.rays[1];
  if (!lowerStartRay || !lowerEndRay) {
    return failure(["wall_ray_invalid"], { mappedSeamWorldLength, maxSeamExtrapolationWorld });
  }
  const lowerStartDirection = normalize3(lowerStartRay.direction);
  const lowerEndDirection = normalize3(lowerEndRay.direction);
  if (!lowerStartDirection || !lowerEndDirection) {
    return failure(["wall_ray_invalid"], { mappedSeamWorldLength, maxSeamExtrapolationWorld });
  }
  const lowerSeamRayPlaneDenominatorStart = dot3(lowerStartDirection, plane.normal);
  const lowerSeamRayPlaneDenominatorEnd = dot3(lowerEndDirection, plane.normal);
  const lowerSeamCameraAngleStartRad = angleBetweenNormalized3(
    lowerStartDirection,
    subtract3(seamWorld[0], lowerStartRay.origin)
  );
  const lowerSeamCameraAngleEndRad = angleBetweenNormalized3(
    lowerEndDirection,
    subtract3(seamWorld[1], lowerEndRay.origin)
  );
  if (
    !Number.isFinite(lowerSeamRayPlaneDenominatorStart) ||
    !Number.isFinite(lowerSeamRayPlaneDenominatorEnd) ||
    lowerSeamCameraAngleStartRad === null ||
    lowerSeamCameraAngleEndRad === null
  ) {
    return failure(["wall_ray_invalid"], { mappedSeamWorldLength, maxSeamExtrapolationWorld });
  }
  const maxLowerSeamCameraAngleRad = Math.max(lowerSeamCameraAngleStartRad, lowerSeamCameraAngleEndRad);
  const lowerSeamDiagnostics = {
    mappedSeamWorldLength,
    maxSeamExtrapolationWorld,
    lowerSeamDisagreementStartWorld,
    lowerSeamDisagreementEndWorld,
    maxLowerSeamDisagreementWorld,
    lowerSeamRayPlaneDenominatorStart,
    lowerSeamRayPlaneDenominatorEnd,
    lowerSeamCameraAngleStartRad,
    lowerSeamCameraAngleEndRad,
    maxLowerSeamCameraAngleRad,
    maxLowerSeamCameraAngleThresholdRad: WALL_SUPPORT_LIMITS.maxLowerSeamCameraAngleRad,
  };
  // The Floor-derived seam is authoritative. World disagreement with the
  // ray/plane reconstruction remains diagnostic-only because it is amplified
  // by grazing intersections; camera consistency is tested against the
  // observed lower-seam rays directly.
  if (maxLowerSeamCameraAngleRad > WALL_SUPPORT_LIMITS.maxLowerSeamCameraAngleRad + 1e-9) {
    return failure(["wall_seam_camera_inconsistent"], lowerSeamDiagnostics);
  }

  // Polygon order is lower-start, lower-end, upper-end, upper-start.
  const upperStartRay = input.rays[3];
  const upperEndRay = input.rays[2];
  if (!upperStartRay || !upperEndRay) {
    return failure(["wall_ray_invalid"], lowerSeamDiagnostics);
  }
  const upperStartDirection = normalize3(upperStartRay.direction);
  const upperEndDirection = normalize3(upperEndRay.direction);
  if (!upperStartDirection || !upperEndDirection) {
    return failure(["wall_ray_invalid"], lowerSeamDiagnostics);
  }
  const upperRayPlaneDenominatorStart = dot3(upperStartDirection, plane.normal);
  const upperRayPlaneDenominatorEnd = dot3(upperEndDirection, plane.normal);
  const minUpperRayPlaneDenominator = Math.min(
    Math.abs(upperRayPlaneDenominatorStart),
    Math.abs(upperRayPlaneDenominatorEnd)
  );
  if (
    !Number.isFinite(upperRayPlaneDenominatorStart) ||
    !Number.isFinite(upperRayPlaneDenominatorEnd) ||
    !Number.isFinite(minUpperRayPlaneDenominator)
  ) {
    return failure(["wall_ray_invalid"], lowerSeamDiagnostics);
  }
  const upperConditioningDiagnostics = {
    ...lowerSeamDiagnostics,
    upperRayPlaneDenominatorStart,
    upperRayPlaneDenominatorEnd,
    minUpperRayPlaneDenominator,
    minUpperRayPlaneDenominatorThreshold: WALL_SUPPORT_LIMITS.minUpperRayPlaneDenominator,
  };
  if (minUpperRayPlaneDenominator < WALL_SUPPORT_LIMITS.minUpperRayPlaneDenominator) {
    return failure(["wall_upper_reconstruction_ill_conditioned"], upperConditioningDiagnostics);
  }

  const boundaryUV = boundaryWorld.map((point) => localUv(point, plane.point, plane));
  if (!boundaryUV.every(isFiniteVec2)) return failure(["wall_boundary_invalid"], upperConditioningDiagnostics);

  // Polygon order gives upper-end ↔ lower-end and upper-start ↔ lower-start.
  // Each must independently clear the minimum; an average cannot hide a bad corner.
  const upperEndHeight = boundaryUV[2].y - boundaryUV[1].y;
  const upperStartHeight = boundaryUV[3].y - boundaryUV[0].y;
  const minCornerHeight = Math.min(upperStartHeight, upperEndHeight);
  const maxCornerHeight = Math.max(upperStartHeight, upperEndHeight);
  const wallHeight = minCornerHeight;
  const heightDiagnostics = {
    ...upperConditioningDiagnostics,
    wallHeight,
    upperStartHeight,
    upperEndHeight,
    minCornerHeight,
    maxCornerHeight,
  };
  if (
    upperStartHeight <= WALL_SUPPORT_LIMITS.minWallHeight ||
    upperEndHeight <= WALL_SUPPORT_LIMITS.minWallHeight
  ) {
    return failure(["wall_upper_below_seam"], heightDiagnostics);
  }
  if (maxCornerHeight > WALL_SUPPORT_LIMITS.maxWallHeight) {
    return failure(["wall_height_excessive"], heightDiagnostics);
  }
  if (isSelfIntersecting(boundaryUV)) return failure(["wall_boundary_self_intersecting"], heightDiagnostics);
  const boundaryArea = Math.abs(polygonArea(boundaryUV));
  if (boundaryArea <= 1e-8) return failure(["wall_boundary_zero_area"], heightDiagnostics);
  const wallWidth = Math.max(distance2(boundaryUV[0], boundaryUV[1]), distance2(boundaryUV[2], boundaryUV[3]));
  if (wallWidth > mappedSeamWorldLength * WALL_SUPPORT_LIMITS.maxWallWidthToSeamRatio) {
    return failure(["wall_width_excessive"], { ...heightDiagnostics, wallWidth });
  }
  const maxCameraDistance = Math.max(...boundaryWorld.map((point) => distance3(point, input.cameraPosition)));
  if (maxCameraDistance > WALL_SUPPORT_LIMITS.maxWorldDistance) {
    return failure(["wall_camera_distance_excessive"], {
      ...heightDiagnostics,
      wallWidth,
      maxCameraDistance,
    });
  }

  let maxRoundTripReprojectionErrorPx = 0;
  for (let index = 0; index < boundaryWorld.length; index += 1) {
    const projected = input.projectWorldToPixels(boundaryWorld[index]);
    const expected = {
      x: polygonContainerNorm[index].x * frameSize.width,
      y: polygonContainerNorm[index].y * frameSize.height,
    };
    if (!isFiniteVec2(projected)) return failure(["wall_reprojection_error"], upperConditioningDiagnostics);
    maxRoundTripReprojectionErrorPx = Math.max(maxRoundTripReprojectionErrorPx, distance2(projected, expected));
  }
  if (maxRoundTripReprojectionErrorPx > WALL_SUPPORT_LIMITS.maxRoundTripReprojectionErrorPx) {
    return failure(["wall_reprojection_error"], {
      ...heightDiagnostics,
      wallWidth,
      maxCameraDistance,
      maxRoundTripReprojectionErrorPx,
    });
  }
  return {
    ok: true,
    plane,
    seamNormal,
    boundaryWorld,
    boundaryUV,
    seamWorld,
    diagnostics: {
      mappedSeamWorldLength,
      wallWidth,
      wallHeight,
      upperStartHeight,
      upperEndHeight,
      minCornerHeight,
      maxCornerHeight,
      lowerSeamDisagreementStartWorld,
      lowerSeamDisagreementEndWorld,
      maxLowerSeamDisagreementWorld,
      lowerSeamRayPlaneDenominatorStart,
      lowerSeamRayPlaneDenominatorEnd,
      lowerSeamCameraAngleStartRad,
      lowerSeamCameraAngleEndRad,
      maxLowerSeamCameraAngleRad,
      maxLowerSeamCameraAngleThresholdRad: WALL_SUPPORT_LIMITS.maxLowerSeamCameraAngleRad,
      upperRayPlaneDenominatorStart,
      upperRayPlaneDenominatorEnd,
      minUpperRayPlaneDenominator,
      minUpperRayPlaneDenominatorThreshold: WALL_SUPPORT_LIMITS.minUpperRayPlaneDenominator,
      maxRoundTripReprojectionErrorPx,
      maxSeamExtrapolationWorld,
      maxCameraDistance,
      localBasisConvention: "U=reviewed-seam; V=world-up; seamNormal=U×V",
    },
  };
}
