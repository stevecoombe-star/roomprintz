import type { CalibrationImageBasis } from "./calibration-image-basis";
import type { ImageFrameSize } from "./image-space";
import {
  deriveCeilingPlane,
  intersectRayWithPlane,
  type SupportPlane,
  type SupportVec3,
} from "./support-plane-math";
import type { SupportReviewStatus, SupportSource } from "./support-model";
import type { SourceNormPoint } from "./wall-support-geometry";

/** Image-space order: lower-left, lower-right, upper-right, upper-left. */
export type CeilingPolygon = [SourceNormPoint, SourceNormPoint, SourceNormPoint, SourceNormPoint];
export type CeilingRay = { origin: SupportVec3; direction: SupportVec3 };
export type CeilingVec2 = { x: number; y: number };

export type CeilingConfirmationStamp = {
  ceilingPolygonKey: string;
  roomHeightKey: string;
  imageBasisId: string;
  imageBasisFingerprint: string;
  cameraAppliedAtIso: string;
  frameWidth: number;
  frameHeight: number;
};

export type CeilingSupportDraft = {
  enabled: boolean;
  source: SupportSource;
  imagePolygonSourceNorm: CeilingPolygon | null;
  roomHeight: number;
  reviewStatus: SupportReviewStatus;
  confirmationStamp: CeilingConfirmationStamp | null;
};

export type CeilingSupportFailureReason =
  | "ceiling_not_configured"
  | "ceiling_polygon_invalid"
  | "ceiling_polygon_out_of_range"
  | "ceiling_polygon_self_intersecting"
  | "ceiling_polygon_zero_area"
  | "ceiling_height_invalid"
  | "ceiling_height_below_camera"
  | "ceiling_camera_clearance_insufficient"
  | "ceiling_ray_invalid"
  | "ceiling_ray_parallel"
  | "ceiling_intersection_behind_camera"
  | "ceiling_intersection_non_finite"
  | "ceiling_boundary_invalid"
  | "ceiling_boundary_self_intersecting"
  | "ceiling_boundary_zero_area"
  | "ceiling_width_excessive"
  | "ceiling_depth_excessive"
  | "ceiling_camera_distance_excessive"
  | "ceiling_reprojection_error";

export type CeilingSupportDiagnostics = {
  roomHeight: number;
  cameraHeight: number;
  cameraClearance: number;
  ceilingWidthU: number;
  ceilingDepthV: number;
  maxCameraDistance: number;
  maxRoundTripPx: number;
};

export type CeilingSupportDerivation =
  | {
      ok: true;
      plane: SupportPlane;
      boundaryWorld: SupportVec3[];
      boundaryUV: CeilingVec2[];
      diagnostics: CeilingSupportDiagnostics;
    }
  | { ok: false; reasons: CeilingSupportFailureReason[]; diagnostics?: Partial<CeilingSupportDiagnostics> };

// Broad lab-safety bounds in the existing floor-world coordinate system. They
// constrain unstable extrapolation; they do not describe a measured room.
export const CEILING_SUPPORT_LIMITS = {
  minImagePolygonArea: 1e-8,
  minBoundaryArea: 1e-8,
  minWidthU: 0.05,
  minDepthV: 0.05,
  maxDimensionToFloorRatio: 5,
  maxWorldDistance: 50,
  maxRoundTripReprojectionErrorPx: 3,
  minCameraClearance: 0.1,
} as const;

type DeriveCeilingSupportInput = {
  polygonSourceNorm: CeilingPolygon | null;
  polygonContainerNorm: CeilingPolygon | null;
  frameSize: ImageFrameSize | null;
  cameraPosition: SupportVec3;
  rays: readonly [CeilingRay | null, CeilingRay | null, CeilingRay | null, CeilingRay | null];
  projectWorldToPixels: (point: SupportVec3) => CeilingVec2 | null;
  roomHeight: number;
  floorBounds?: { minX: number; maxX: number; minZ: number; maxZ: number };
};

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function finite2(value: CeilingVec2 | null | undefined): value is CeilingVec2 {
  return !!value && finite(value.x) && finite(value.y);
}

function finite3(value: SupportVec3 | null | undefined): value is SupportVec3 {
  return !!value && finite(value.x) && finite(value.y) && finite(value.z);
}

function polygonArea(points: readonly CeilingVec2[]): number {
  return points.reduce((total, point, index) => {
    const next = points[(index + 1) % points.length];
    return total + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

function orientation(a: CeilingVec2, b: CeilingVec2, c: CeilingVec2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsIntersect(a: CeilingVec2, b: CeilingVec2, c: CeilingVec2, d: CeilingVec2): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return abC * abD < 0 && cdA * cdB < 0;
}

function selfIntersecting(points: readonly CeilingVec2[]): boolean {
  return points.length === 4 && (
    segmentsIntersect(points[0], points[1], points[2], points[3]) ||
    segmentsIntersect(points[1], points[2], points[3], points[0])
  );
}

function distance3(a: SupportVec3, b: SupportVec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function failure(
  reasons: CeilingSupportFailureReason[],
  diagnostics?: Partial<CeilingSupportDiagnostics>
): CeilingSupportDerivation {
  return { ok: false, reasons: [...new Set(reasons)], diagnostics };
}

export function buildCeilingPolygonKey(polygon: CeilingPolygon | null): string {
  return polygon ? polygon.map((point) => `${point.x.toFixed(8)},${point.y.toFixed(8)}`).join("|") : "none";
}

/** Stable decimal serialization avoids browser-dependent floating-point keys. */
export function buildRoomHeightKey(roomHeight: number): string {
  return Number.isFinite(roomHeight) ? roomHeight.toFixed(6) : "invalid";
}

export function createCeilingConfirmationStamp(
  polygon: CeilingPolygon,
  roomHeight: number,
  basis: CalibrationImageBasis,
  cameraAppliedAtIso: string,
  frameSize: ImageFrameSize
): CeilingConfirmationStamp {
  return {
    ceilingPolygonKey: buildCeilingPolygonKey(polygon),
    roomHeightKey: buildRoomHeightKey(roomHeight),
    imageBasisId: basis.basisId,
    imageBasisFingerprint: basis.basisFingerprint,
    cameraAppliedAtIso,
    frameWidth: frameSize.width,
    frameHeight: frameSize.height,
  };
}

export function isCeilingConfirmationCurrent(input: {
  stamp: CeilingConfirmationStamp | null;
  polygon: CeilingPolygon | null;
  roomHeight: number;
  basis: CalibrationImageBasis | null;
  cameraAppliedAtIso: string | null;
  frameSize: ImageFrameSize | null;
}): boolean {
  const { stamp, polygon, roomHeight, basis, cameraAppliedAtIso, frameSize } = input;
  return !!(
    stamp && polygon && basis && cameraAppliedAtIso && frameSize &&
    stamp.ceilingPolygonKey === buildCeilingPolygonKey(polygon) &&
    stamp.roomHeightKey === buildRoomHeightKey(roomHeight) &&
    stamp.imageBasisId === basis.basisId &&
    stamp.imageBasisFingerprint === basis.basisFingerprint &&
    stamp.cameraAppliedAtIso === cameraAppliedAtIso &&
    stamp.frameWidth === frameSize.width &&
    stamp.frameHeight === frameSize.height
  );
}

/**
 * Derives a finite horizontal boundary. U is world +X and V is world +Z;
 * the plane's mathematical normal is -Y, the room-facing ceiling normal.
 */
export function deriveCeilingSupport(input: DeriveCeilingSupportInput): CeilingSupportDerivation {
  const { polygonSourceNorm, polygonContainerNorm, frameSize, cameraPosition, roomHeight } = input;
  if (!polygonSourceNorm || !polygonContainerNorm || !frameSize || frameSize.width <= 0 || frameSize.height <= 0) {
    return failure(["ceiling_not_configured"]);
  }
  if (!polygonSourceNorm.every(finite2) || !polygonContainerNorm.every(finite2) || !finite3(cameraPosition)) {
    return failure(["ceiling_polygon_invalid"]);
  }
  if (polygonSourceNorm.some((point) => point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)) {
    return failure(["ceiling_polygon_out_of_range"]);
  }
  if (selfIntersecting(polygonSourceNorm)) return failure(["ceiling_polygon_self_intersecting"]);
  if (Math.abs(polygonArea(polygonSourceNorm)) <= CEILING_SUPPORT_LIMITS.minImagePolygonArea) {
    return failure(["ceiling_polygon_zero_area"]);
  }
  const planeResult = deriveCeilingPlane(roomHeight);
  if (!planeResult.ok) return failure(["ceiling_height_invalid"]);
  const diagnostics: Partial<CeilingSupportDiagnostics> = {
    roomHeight,
    cameraHeight: cameraPosition.y,
    cameraClearance: roomHeight - cameraPosition.y,
  };
  if (roomHeight <= cameraPosition.y) return failure(["ceiling_height_below_camera"], diagnostics);
  if (roomHeight - cameraPosition.y <= CEILING_SUPPORT_LIMITS.minCameraClearance) {
    return failure(["ceiling_camera_clearance_insufficient"], diagnostics);
  }

  const plane = planeResult.plane;
  const boundaryWorld: SupportVec3[] = [];
  for (const ray of input.rays) {
    if (!ray || !finite3(ray.origin) || !finite3(ray.direction)) return failure(["ceiling_ray_invalid"], diagnostics);
    const intersection = intersectRayWithPlane({
      rayOrigin: ray.origin,
      rayDirection: ray.direction,
      planePoint: plane.point,
      planeNormal: plane.normal,
    });
    if (!intersection.ok) {
      const reason: CeilingSupportFailureReason =
        intersection.reason === "ray_parallel_to_plane" ? "ceiling_ray_parallel" :
        intersection.reason === "intersection_behind_ray" ? "ceiling_intersection_behind_camera" :
        intersection.reason === "non_finite_intersection" ? "ceiling_intersection_non_finite" :
        "ceiling_ray_invalid";
      return failure([reason], diagnostics);
    }
    boundaryWorld.push(intersection.point);
  }
  const boundaryUV = boundaryWorld.map((point) => ({ x: point.x - plane.point.x, y: point.z - plane.point.z }));
  if (!boundaryUV.every(finite2)) return failure(["ceiling_boundary_invalid"], diagnostics);
  if (selfIntersecting(boundaryUV)) return failure(["ceiling_boundary_self_intersecting"], diagnostics);
  if (Math.abs(polygonArea(boundaryUV)) <= CEILING_SUPPORT_LIMITS.minBoundaryArea) {
    return failure(["ceiling_boundary_zero_area"], diagnostics);
  }
  const xs = boundaryUV.map((point) => point.x);
  const ys = boundaryUV.map((point) => point.y);
  const ceilingWidthU = Math.max(...xs) - Math.min(...xs);
  const ceilingDepthV = Math.max(...ys) - Math.min(...ys);
  const extents = { ...diagnostics, ceilingWidthU, ceilingDepthV };
  if (ceilingWidthU < CEILING_SUPPORT_LIMITS.minWidthU || !finite(ceilingWidthU)) {
    return failure(["ceiling_boundary_zero_area"], extents);
  }
  if (ceilingDepthV < CEILING_SUPPORT_LIMITS.minDepthV || !finite(ceilingDepthV)) {
    return failure(["ceiling_boundary_zero_area"], extents);
  }
  const floorWidth = input.floorBounds ? input.floorBounds.maxX - input.floorBounds.minX : 10;
  const floorDepth = input.floorBounds ? input.floorBounds.maxZ - input.floorBounds.minZ : 10;
  if (!finite(floorWidth) || ceilingWidthU > floorWidth * CEILING_SUPPORT_LIMITS.maxDimensionToFloorRatio) {
    return failure(["ceiling_width_excessive"], extents);
  }
  if (!finite(floorDepth) || ceilingDepthV > floorDepth * CEILING_SUPPORT_LIMITS.maxDimensionToFloorRatio) {
    return failure(["ceiling_depth_excessive"], extents);
  }
  const maxCameraDistance = Math.max(...boundaryWorld.map((point) => distance3(point, cameraPosition)));
  if (!finite(maxCameraDistance) || maxCameraDistance > CEILING_SUPPORT_LIMITS.maxWorldDistance) {
    return failure(["ceiling_camera_distance_excessive"], { ...extents, maxCameraDistance });
  }
  let maxRoundTripPx = 0;
  for (let index = 0; index < boundaryWorld.length; index += 1) {
    const projected = input.projectWorldToPixels(boundaryWorld[index]);
    const expected = {
      x: polygonContainerNorm[index].x * frameSize.width,
      y: polygonContainerNorm[index].y * frameSize.height,
    };
    if (!finite2(projected)) return failure(["ceiling_reprojection_error"], { ...extents, maxCameraDistance });
    maxRoundTripPx = Math.max(maxRoundTripPx, Math.hypot(projected.x - expected.x, projected.y - expected.y));
  }
  if (maxRoundTripPx > CEILING_SUPPORT_LIMITS.maxRoundTripReprojectionErrorPx) {
    return failure(["ceiling_reprojection_error"], { ...extents, maxCameraDistance, maxRoundTripPx });
  }
  return {
    ok: true,
    plane,
    boundaryWorld,
    boundaryUV,
    diagnostics: {
      roomHeight,
      cameraHeight: cameraPosition.y,
      cameraClearance: roomHeight - cameraPosition.y,
      ceilingWidthU,
      ceilingDepthV,
      maxCameraDistance,
      maxRoundTripPx,
    },
  };
}
