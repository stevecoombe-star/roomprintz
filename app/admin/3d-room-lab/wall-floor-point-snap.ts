import {
  normToPixels,
  sourceNormToContainerNorm,
  type ImageFrameSize,
  type ImageIntrinsicSize,
  type PixelPoint,
} from "./image-space";
import type { SourceNormPoint, WallSupportKind } from "./wall-support-geometry";

export type WallLowerPointRole = "lower_left" | "lower_right";

export type FloorCornerKind = "NL" | "NR" | "FR" | "FL";

export type WallFloorSnapTarget = Readonly<{
  wallKind: WallSupportKind;
  wallPointRole: WallLowerPointRole;
  floorCorner: FloorCornerKind;
}>;

export const WALL_FLOOR_SNAP_ENTER_PX = 14;
export const WALL_FLOOR_SNAP_RELEASE_PX = 22;
export const WALL_FLOOR_SEAM_SNAP_ENTER_PX = 10;
export const WALL_FLOOR_SEAM_SNAP_RELEASE_PX = 16;

const WALL_FLOOR_SNAP_TARGETS: readonly WallFloorSnapTarget[] = [
  { wallKind: "wall_back", wallPointRole: "lower_left", floorCorner: "FL" },
  { wallKind: "wall_back", wallPointRole: "lower_right", floorCorner: "FR" },
  { wallKind: "wall_left", wallPointRole: "lower_left", floorCorner: "NL" },
  { wallKind: "wall_left", wallPointRole: "lower_right", floorCorner: "FL" },
  { wallKind: "wall_right", wallPointRole: "lower_left", floorCorner: "FR" },
  { wallKind: "wall_right", wallPointRole: "lower_right", floorCorner: "NR" },
];

export type WallFloorSnapKind = "corner" | "seam";

export type WallFloorSeamTarget = Readonly<{
  startFloorCorner: FloorCornerKind;
  endFloorCorner: FloorCornerKind;
}>;

export function getWallFloorSnapTarget(
  wallKind: WallSupportKind,
  wallPointRole: WallLowerPointRole | null
): FloorCornerKind | null {
  if (!wallPointRole) return null;
  return (
    WALL_FLOOR_SNAP_TARGETS.find(
      (target) => target.wallKind === wallKind && target.wallPointRole === wallPointRole
    )?.floorCorner ?? null
  );
}

/**
 * The same semantic lower-handle map that pins endpoint corners also defines
 * the authoritative Floor edge for each wall. Keep this derived rather than
 * duplicating a second wall-to-seam table.
 */
export function getWallFloorSeamTarget(wallKind: WallSupportKind): WallFloorSeamTarget | null {
  const lowerLeft = getWallFloorSnapTarget(wallKind, "lower_left");
  const lowerRight = getWallFloorSnapTarget(wallKind, "lower_right");
  if (!lowerLeft || !lowerRight) return null;
  return {
    startFloorCorner: lowerLeft,
    endFloorCorner: lowerRight,
  };
}

/**
 * WallPolygon is committed as [lower-start, lower-end, upper-end, upper-start].
 * The operator-facing lower roles are therefore fixed at indices 0 and 1.
 */
export function getWallLowerPointRole(vertexIndex: number): WallLowerPointRole | null {
  if (vertexIndex === 0) return "lower_left";
  if (vertexIndex === 1) return "lower_right";
  return null;
}

export type WallFloorPointSnapInput = Readonly<{
  available: boolean;
  wallKind: WallSupportKind;
  wallPointRole: WallLowerPointRole | null;
  activeSnapKind: WallFloorSnapKind | null;
  unsnappedWallPointSourceNorm: SourceNormPoint;
  pointerContainerNorm: SourceNormPoint | null;
  floorSourceCorners: Readonly<Partial<Record<FloorCornerKind, SourceNormPoint>>>;
  intrinsicSize: ImageIntrinsicSize | null;
  frameSize: ImageFrameSize | null;
}>;

export type WallFloorPointSnapResult = Readonly<{
  snapped: boolean;
  snapKind: WallFloorSnapKind | null;
  floorCorner: FloorCornerKind | null;
  floorSeam: WallFloorSeamTarget | null;
  seamT: number | null;
  pointSourceNorm: SourceNormPoint;
  targetContainerNorm: SourceNormPoint | null;
  targetOverlayPx: PixelPoint | null;
  distancePx: number | null;
  showTarget: boolean;
}>;

function isFinitePoint(point: SourceNormPoint | null | undefined): point is SourceNormPoint {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function unchanged(
  pointSourceNorm: SourceNormPoint,
  floorCorner: FloorCornerKind | null = null,
  floorSeam: WallFloorSeamTarget | null = null
): WallFloorPointSnapResult {
  return {
    snapped: false,
    snapKind: null,
    floorCorner,
    floorSeam,
    seamT: null,
    pointSourceNorm: { x: pointSourceNorm.x, y: pointSourceNorm.y },
    targetContainerNorm: null,
    targetOverlayPx: null,
    distancePx: null,
    showTarget: false,
  };
}

export type SourceNormSegmentProjection = Readonly<{
  pointSourceNorm: SourceNormPoint;
  t: number;
}>;

/**
 * Projects in source-image pixels, then returns the mathematically equivalent
 * source-normalized interpolation. This deliberately avoids all viewport and
 * container rounding so persisted wall geometry remains source-authoritative.
 */
export function projectSourceNormPointToSegment(
  point: SourceNormPoint,
  start: SourceNormPoint,
  end: SourceNormPoint,
  intrinsicSize: ImageIntrinsicSize | null
): SourceNormSegmentProjection | null {
  if (
    !isFinitePoint(point) ||
    !isFinitePoint(start) ||
    !isFinitePoint(end) ||
    !intrinsicSize ||
    !Number.isFinite(intrinsicSize.width) ||
    !Number.isFinite(intrinsicSize.height) ||
    intrinsicSize.width <= 0 ||
    intrinsicSize.height <= 0
  ) {
    return null;
  }

  const startX = start.x * intrinsicSize.width;
  const startY = start.y * intrinsicSize.height;
  const endX = end.x * intrinsicSize.width;
  const endY = end.y * intrinsicSize.height;
  const pointX = point.x * intrinsicSize.width;
  const pointY = point.y * intrinsicSize.height;
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  const coordinateScale = Math.max(
    1,
    Math.abs(startX),
    Math.abs(startY),
    Math.abs(endX),
    Math.abs(endY)
  );
  if (
    !Number.isFinite(startX) ||
    !Number.isFinite(startY) ||
    !Number.isFinite(endX) ||
    !Number.isFinite(endY) ||
    !Number.isFinite(pointX) ||
    !Number.isFinite(pointY) ||
    !Number.isFinite(lengthSquared) ||
    lengthSquared <= Number.EPSILON * coordinateScale * coordinateScale
  ) {
    return null;
  }

  const unclampedT =
    ((pointX - startX) * deltaX + (pointY - startY) * deltaY) / lengthSquared;
  if (!Number.isFinite(unclampedT)) return null;
  const t = Math.max(0, Math.min(1, unclampedT));
  return {
    pointSourceNorm:
      t === 0
        ? { x: start.x, y: start.y }
        : t === 1
          ? { x: end.x, y: end.y }
          : {
              x: start.x + t * (end.x - start.x),
              y: start.y + t * (end.y - start.y),
            },
    t,
  };
}

function isWithinThreshold(distancePx: number, thresholdPx: number): boolean {
  const numericalTolerance =
    Number.EPSILON * Math.max(1, Math.abs(distancePx), Math.abs(thresholdPx)) * 16;
  return distancePx <= thresholdPx + numericalTolerance;
}

function toTargetDisplay(
  targetSourceNorm: SourceNormPoint,
  intrinsicSize: ImageIntrinsicSize,
  frameSize: ImageFrameSize
): { targetContainerNorm: SourceNormPoint; targetOverlayPx: PixelPoint } | null {
  const targetContainerNorm = sourceNormToContainerNorm(targetSourceNorm, intrinsicSize, frameSize);
  const targetOverlayPx = targetContainerNorm
    ? normToPixels(targetContainerNorm, frameSize)
    : null;
  if (!targetContainerNorm || !targetOverlayPx) return null;
  return {
    targetContainerNorm: { x: targetContainerNorm.x, y: targetContainerNorm.y },
    targetOverlayPx: { x: targetOverlayPx.x, y: targetOverlayPx.y },
  };
}

/**
 * Resolves lower-wall snapping with deterministic priority: mapped Floor corner,
 * then the corresponding finite Floor seam, then the unmodified draft point.
 */
export function resolveWallFloorPointSnap(input: WallFloorPointSnapInput): WallFloorPointSnapResult {
  const floorCorner = getWallFloorSnapTarget(input.wallKind, input.wallPointRole);
  if (!isFinitePoint(input.unsnappedWallPointSourceNorm)) {
    return unchanged(input.unsnappedWallPointSourceNorm, floorCorner);
  }
  if (!input.available || !floorCorner || !isFinitePoint(input.pointerContainerNorm)) {
    return unchanged(input.unsnappedWallPointSourceNorm, floorCorner);
  }

  const targetSourceNorm = input.floorSourceCorners[floorCorner];
  if (!isFinitePoint(targetSourceNorm) || !input.intrinsicSize || !input.frameSize) {
    return unchanged(input.unsnappedWallPointSourceNorm, floorCorner);
  }

  const pointerOverlayPx = normToPixels(input.pointerContainerNorm, input.frameSize);
  const cornerDisplay = toTargetDisplay(targetSourceNorm, input.intrinsicSize, input.frameSize);
  if (!pointerOverlayPx || !cornerDisplay) {
    return unchanged(input.unsnappedWallPointSourceNorm, floorCorner);
  }

  const cornerDistancePx = Math.hypot(
    pointerOverlayPx.x - cornerDisplay.targetOverlayPx.x,
    pointerOverlayPx.y - cornerDisplay.targetOverlayPx.y
  );
  if (!Number.isFinite(cornerDistancePx)) {
    return unchanged(input.unsnappedWallPointSourceNorm, floorCorner);
  }

  const cornerThreshold =
    input.activeSnapKind === "corner"
      ? WALL_FLOOR_SNAP_RELEASE_PX
      : WALL_FLOOR_SNAP_ENTER_PX;
  if (isWithinThreshold(cornerDistancePx, cornerThreshold)) {
    return {
      snapped: true,
      snapKind: "corner",
      floorCorner,
      floorSeam: null,
      seamT: null,
      pointSourceNorm: { x: targetSourceNorm.x, y: targetSourceNorm.y },
      targetContainerNorm: cornerDisplay.targetContainerNorm,
      targetOverlayPx: cornerDisplay.targetOverlayPx,
      distancePx: cornerDistancePx,
      showTarget: true,
    };
  }

  const unsnappedCornerResult: WallFloorPointSnapResult = {
    snapped: false,
    snapKind: null,
    floorCorner,
    floorSeam: null,
    seamT: null,
    pointSourceNorm: {
      x: input.unsnappedWallPointSourceNorm.x,
      y: input.unsnappedWallPointSourceNorm.y,
    },
    targetContainerNorm: cornerDisplay.targetContainerNorm,
    targetOverlayPx: cornerDisplay.targetOverlayPx,
    distancePx: cornerDistancePx,
    showTarget: false,
  };
  const floorSeam = getWallFloorSeamTarget(input.wallKind);
  const seamStartSourceNorm = floorSeam
    ? input.floorSourceCorners[floorSeam.startFloorCorner]
    : null;
  const seamEndSourceNorm = floorSeam
    ? input.floorSourceCorners[floorSeam.endFloorCorner]
    : null;
  if (!isFinitePoint(seamStartSourceNorm) || !isFinitePoint(seamEndSourceNorm)) {
    return unsnappedCornerResult;
  }
  const projection = projectSourceNormPointToSegment(
    input.unsnappedWallPointSourceNorm,
    seamStartSourceNorm,
    seamEndSourceNorm,
    input.intrinsicSize
  );
  if (!projection) return unsnappedCornerResult;
  const seamDisplay = toTargetDisplay(
    projection.pointSourceNorm,
    input.intrinsicSize,
    input.frameSize
  );
  if (!seamDisplay) return unsnappedCornerResult;

  const seamDistancePx = Math.hypot(
    pointerOverlayPx.x - seamDisplay.targetOverlayPx.x,
    pointerOverlayPx.y - seamDisplay.targetOverlayPx.y
  );
  if (!Number.isFinite(seamDistancePx)) {
    return unsnappedCornerResult;
  }
  const seamThreshold =
    input.activeSnapKind === "seam"
      ? WALL_FLOOR_SEAM_SNAP_RELEASE_PX
      : WALL_FLOOR_SEAM_SNAP_ENTER_PX;
  if (!isWithinThreshold(seamDistancePx, seamThreshold)) {
    return unsnappedCornerResult;
  }
  return {
    snapped: true,
    snapKind: "seam",
    floorCorner: null,
    floorSeam,
    seamT: projection.t,
    pointSourceNorm: projection.pointSourceNorm,
    targetContainerNorm: seamDisplay.targetContainerNorm,
    targetOverlayPx: seamDisplay.targetOverlayPx,
    distancePx: seamDistancePx,
    showTarget: true,
  };
}
