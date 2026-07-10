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

export type WallConfirmationStamp = {
  wallPolygonKey: string;
  imageBasisId: string;
  imageBasisFingerprint: string;
  cameraAppliedAtIso: string;
  frameWidth: number;
  frameHeight: number;
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
  | "wall_excessive_extrapolation"
  | "wall_plane_invalid"
  | "wall_ray_invalid"
  | "wall_ray_parallel"
  | "wall_intersection_behind_camera"
  | "wall_intersection_non_finite"
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
  wallHeight: number;
  maxRoundTripReprojectionErrorPx: number;
  maxSeamExtrapolationWorld: number;
  maxCameraDistance: number;
  localBasisConvention: "U=reviewed-seam; V=world-up; seamNormal=U×V";
};

export type WallSupportDerivation =
  | {
      ok: true;
      plane: SupportPlane;
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
  };
}

export function isWallConfirmationCurrent(input: {
  stamp: WallConfirmationStamp | null;
  polygon: WallPolygon | null;
  basis: CalibrationImageBasis | null;
  cameraAppliedAtIso: string | null;
  frameSize: ImageFrameSize | null;
}): boolean {
  const { stamp, polygon, basis, cameraAppliedAtIso, frameSize } = input;
  return !!(
    stamp &&
    polygon &&
    basis &&
    cameraAppliedAtIso &&
    frameSize &&
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
 * direction: U is lower-start -> lower-end and V is world +Y. `plane.normal`
 * remains camera-facing, so callers must not infer U×V equals that normal.
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

  const boundaryUV = boundaryWorld.map((point) => localUv(point, plane.point, plane));
  if (!boundaryUV.every(isFiniteVec2)) return failure(["wall_boundary_invalid"], { mappedSeamWorldLength, maxSeamExtrapolationWorld });
  if (isSelfIntersecting(boundaryUV)) return failure(["wall_boundary_self_intersecting"], { mappedSeamWorldLength, maxSeamExtrapolationWorld });
  const boundaryArea = Math.abs(polygonArea(boundaryUV));
  if (boundaryArea <= 1e-8) return failure(["wall_boundary_zero_area"], { mappedSeamWorldLength, maxSeamExtrapolationWorld });

  const lowerY = (boundaryUV[0].y + boundaryUV[1].y) / 2;
  const upperY = (boundaryUV[2].y + boundaryUV[3].y) / 2;
  const wallHeight = upperY - lowerY;
  if (wallHeight <= WALL_SUPPORT_LIMITS.minWallHeight) {
    return failure(["wall_upper_below_seam"], { mappedSeamWorldLength, maxSeamExtrapolationWorld, wallHeight });
  }
  if (wallHeight > WALL_SUPPORT_LIMITS.maxWallHeight) {
    return failure(["wall_height_excessive"], { mappedSeamWorldLength, maxSeamExtrapolationWorld, wallHeight });
  }
  const wallWidth = Math.max(distance2(boundaryUV[0], boundaryUV[1]), distance2(boundaryUV[2], boundaryUV[3]));
  if (wallWidth > mappedSeamWorldLength * WALL_SUPPORT_LIMITS.maxWallWidthToSeamRatio) {
    return failure(["wall_width_excessive"], { mappedSeamWorldLength, maxSeamExtrapolationWorld, wallHeight, wallWidth });
  }
  const maxCameraDistance = Math.max(...boundaryWorld.map((point) => distance3(point, input.cameraPosition)));
  if (maxCameraDistance > WALL_SUPPORT_LIMITS.maxWorldDistance) {
    return failure(["wall_camera_distance_excessive"], {
      mappedSeamWorldLength,
      maxSeamExtrapolationWorld,
      wallHeight,
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
    if (!isFiniteVec2(projected)) return failure(["wall_reprojection_error"]);
    maxRoundTripReprojectionErrorPx = Math.max(maxRoundTripReprojectionErrorPx, distance2(projected, expected));
  }
  if (maxRoundTripReprojectionErrorPx > WALL_SUPPORT_LIMITS.maxRoundTripReprojectionErrorPx) {
    return failure(["wall_reprojection_error"], {
      mappedSeamWorldLength,
      maxSeamExtrapolationWorld,
      wallHeight,
      wallWidth,
      maxCameraDistance,
      maxRoundTripReprojectionErrorPx,
    });
  }
  return {
    ok: true,
    plane,
    boundaryWorld,
    boundaryUV,
    seamWorld,
    diagnostics: {
      mappedSeamWorldLength,
      wallWidth,
      wallHeight,
      maxRoundTripReprojectionErrorPx,
      maxSeamExtrapolationWorld,
      maxCameraDistance,
      localBasisConvention: "U=reviewed-seam; V=world-up; seamNormal=U×V",
    },
  };
}
