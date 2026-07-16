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

const WALL_FLOOR_SNAP_TARGETS: readonly WallFloorSnapTarget[] = [
  { wallKind: "wall_back", wallPointRole: "lower_left", floorCorner: "FL" },
  { wallKind: "wall_back", wallPointRole: "lower_right", floorCorner: "FR" },
  { wallKind: "wall_left", wallPointRole: "lower_left", floorCorner: "NL" },
  { wallKind: "wall_left", wallPointRole: "lower_right", floorCorner: "FL" },
  { wallKind: "wall_right", wallPointRole: "lower_left", floorCorner: "FR" },
  { wallKind: "wall_right", wallPointRole: "lower_right", floorCorner: "NR" },
];

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
  isSnapped: boolean;
  unsnappedWallPointSourceNorm: SourceNormPoint;
  pointerContainerNorm: SourceNormPoint | null;
  floorSourceCorners: Readonly<Partial<Record<FloorCornerKind, SourceNormPoint>>>;
  intrinsicSize: ImageIntrinsicSize | null;
  frameSize: ImageFrameSize | null;
}>;

export type WallFloorPointSnapResult = Readonly<{
  snapped: boolean;
  floorCorner: FloorCornerKind | null;
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
  floorCorner: FloorCornerKind | null = null
): WallFloorPointSnapResult {
  return {
    snapped: false,
    floorCorner,
    pointSourceNorm: { x: pointSourceNorm.x, y: pointSourceNorm.y },
    targetContainerNorm: null,
    targetOverlayPx: null,
    distancePx: null,
    showTarget: false,
  };
}

/**
 * Resolves one explicitly mapped lower-wall snap target. Proximity is measured
 * in current overlay pixels; the accepted result copies the exact authoritative
 * Floor source-normalized coordinate without modifying the Floor input.
 */
export function resolveWallFloorPointSnap(input: WallFloorPointSnapInput): WallFloorPointSnapResult {
  const floorCorner = getWallFloorSnapTarget(input.wallKind, input.wallPointRole);
  if (!isFinitePoint(input.unsnappedWallPointSourceNorm)) {
    return unchanged({ x: 0, y: 0 }, floorCorner);
  }
  if (!input.available || !floorCorner || !isFinitePoint(input.pointerContainerNorm)) {
    return unchanged(input.unsnappedWallPointSourceNorm, floorCorner);
  }

  const targetSourceNorm = input.floorSourceCorners[floorCorner];
  if (!isFinitePoint(targetSourceNorm) || !input.intrinsicSize || !input.frameSize) {
    return unchanged(input.unsnappedWallPointSourceNorm, floorCorner);
  }
  const targetContainerNorm = sourceNormToContainerNorm(
    targetSourceNorm,
    input.intrinsicSize,
    input.frameSize
  );
  const pointerOverlayPx = normToPixels(input.pointerContainerNorm, input.frameSize);
  const targetOverlayPx = targetContainerNorm
    ? normToPixels(targetContainerNorm, input.frameSize)
    : null;
  if (!targetContainerNorm || !pointerOverlayPx || !targetOverlayPx) {
    return unchanged(input.unsnappedWallPointSourceNorm, floorCorner);
  }

  const distancePx = Math.hypot(
    pointerOverlayPx.x - targetOverlayPx.x,
    pointerOverlayPx.y - targetOverlayPx.y
  );
  if (!Number.isFinite(distancePx)) {
    return unchanged(input.unsnappedWallPointSourceNorm, floorCorner);
  }

  const threshold = input.isSnapped ? WALL_FLOOR_SNAP_RELEASE_PX : WALL_FLOOR_SNAP_ENTER_PX;
  const snapped = distancePx <= threshold;
  return {
    snapped,
    floorCorner,
    pointSourceNorm: snapped
      ? { x: targetSourceNorm.x, y: targetSourceNorm.y }
      : { x: input.unsnappedWallPointSourceNorm.x, y: input.unsnappedWallPointSourceNorm.y },
    targetContainerNorm: { x: targetContainerNorm.x, y: targetContainerNorm.y },
    targetOverlayPx: { x: targetOverlayPx.x, y: targetOverlayPx.y },
    distancePx,
    showTarget: snapped || distancePx <= WALL_FLOOR_SNAP_ENTER_PX,
  };
}
