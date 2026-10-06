/**
 * AFR-4A source-image floor quad.
 *
 * The human edits NL, NR, FR, FL in source-normalized image space, the same
 * order as floor.sourceNormalizedPolygon. World X/Z is not an edit surface.
 * A settled calibration rebuilds the centered rectangle with getFloorRectCorners.
 */

import {
  FLOOR_SOURCE_COORDINATE_MAX,
  FLOOR_SOURCE_COORDINATE_MIN,
  validateFloorSourcePolygonExtent,
} from "@/app/admin/3d-room-lab/floor-coordinate-extent";
import {
  getFloorRectCorners,
  validateOrderedFloorCorners,
} from "@/app/admin/3d-room-lab/perspective-solve";

export const MANUAL_PERSPECTIVE_CORNERS = ["NL", "NR", "FR", "FL"] as const;

export type ManualPerspectiveCorner = (typeof MANUAL_PERSPECTIVE_CORNERS)[number];

export const MANUAL_PERSPECTIVE_CORRESPONDENCE_ORDER = MANUAL_PERSPECTIVE_CORNERS;

export type ManualPerspectiveImagePoint = Readonly<{ x: number; y: number }>;

export type ManualPerspectiveImagePoints = Readonly<
  Record<ManualPerspectiveCorner, ManualPerspectiveImagePoint>
>;

export type ManualPerspectiveImageQuad = readonly [
  ManualPerspectiveImagePoint,
  ManualPerspectiveImagePoint,
  ManualPerspectiveImagePoint,
  ManualPerspectiveImagePoint,
];

export type ManualPerspectiveVec3 = Readonly<{ x: number; y: number; z: number }>;

export type ManualPerspectiveWorldCorner = Readonly<{ x: number; z: number }>;

export type ManualPerspectiveWorldRectangle = Readonly<{
  worldWidthM: number;
  referenceDepthM: number;
  widthDepthRatio: number;
  corners: Readonly<Record<ManualPerspectiveCorner, ManualPerspectiveWorldCorner>>;
}>;

/**
 * Visible default trapezoid for a generation with no automatic floor quad.
 *
 * Source-normalized image Y increases downward, so the near edge NL–NR sits
 * lower in the frame than the far edge FL–FR. These points are a placement
 * aid, not an inferred room.
 */
export const MANUAL_PERSPECTIVE_BOOTSTRAP_QUAD: ManualPerspectiveImagePoints = Object.freeze({
  NL: Object.freeze({ x: 0.22, y: 0.9 }),
  NR: Object.freeze({ x: 0.78, y: 0.9 }),
  FR: Object.freeze({ x: 0.64, y: 0.58 }),
  FL: Object.freeze({ x: 0.36, y: 0.58 }),
});

export function manualPerspectiveBootstrapQuad(): ManualPerspectiveImagePoints {
  return cloneManualPerspectiveImagePoints(MANUAL_PERSPECTIVE_BOOTSTRAP_QUAD);
}

export function manualPerspectiveOverlayPoints(
  points: ManualPerspectiveImagePoints,
): readonly { label: ManualPerspectiveCorner; x: number; y: number }[] {
  return MANUAL_PERSPECTIVE_CORRESPONDENCE_ORDER.map((label) =>
    Object.freeze({
      label,
      x: points[label].x,
      y: points[label].y,
    }),
  );
}

export function imagePointsFromQuad(
  quad: readonly ManualPerspectiveImagePoint[],
): ManualPerspectiveImagePoints | null {
  if (quad.length !== 4) return null;
  const [NL, NR, FR, FL] = quad;
  if (!NL || !NR || !FR || !FL) return null;
  if (![NL, NR, FR, FL].every(finiteImagePoint)) return null;
  return Object.freeze({
    NL: Object.freeze({ x: NL.x, y: NL.y }),
    NR: Object.freeze({ x: NR.x, y: NR.y }),
    FR: Object.freeze({ x: FR.x, y: FR.y }),
    FL: Object.freeze({ x: FL.x, y: FL.y }),
  });
}

export function quadFromImagePoints(
  points: ManualPerspectiveImagePoints,
): ManualPerspectiveImageQuad {
  return Object.freeze(
    MANUAL_PERSPECTIVE_CORRESPONDENCE_ORDER.map((corner) =>
      Object.freeze({ x: points[corner].x, y: points[corner].y }),
    ),
  ) as ManualPerspectiveImageQuad;
}

export function cloneManualPerspectiveImagePoints(
  points: ManualPerspectiveImagePoints,
): ManualPerspectiveImagePoints {
  return Object.freeze({
    NL: Object.freeze({ ...points.NL }),
    NR: Object.freeze({ ...points.NR }),
    FR: Object.freeze({ ...points.FR }),
    FL: Object.freeze({ ...points.FL }),
  });
}

export function replaceManualPerspectiveImageCoordinate(
  points: ManualPerspectiveImagePoints,
  corner: ManualPerspectiveCorner,
  axis: "x" | "y",
  value: number,
): ManualPerspectiveImagePoints {
  return Object.freeze({
    ...cloneManualPerspectiveImagePoints(points),
    [corner]: Object.freeze({
      ...points[corner],
      [axis]: value,
    }),
  });
}

/** Matches the transparent corner hit circle in the manual overlay. */
export const MANUAL_PERSPECTIVE_HANDLE_HIT_RADIUS = 0.018;

export type ManualPerspectiveDragTarget = ManualPerspectiveCorner | "body" | "outside";

/**
 * Corner handles win over the quad body. The body includes the polygon
 * interior and its edges. Everything else is outside.
 */
export function manualPerspectiveDragTarget(
  point: Readonly<{ x: number; y: number }>,
  quad: ManualPerspectiveImagePoints,
): ManualPerspectiveDragTarget {
  let closest: { corner: ManualPerspectiveCorner; distance: number } | null = null;
  for (const corner of MANUAL_PERSPECTIVE_CORNERS) {
    const distance = Math.hypot(point.x - quad[corner].x, point.y - quad[corner].y);
    if (
      distance <= MANUAL_PERSPECTIVE_HANDLE_HIT_RADIUS &&
      (closest == null || distance < closest.distance)
    ) {
      closest = { corner, distance };
    }
  }
  if (closest) return closest.corner;
  return pointInManualQuad(point, quad) ? "body" : "outside";
}

/**
 * Rigid image-space translation. One shared delta is applied to every corner.
 * If that delta would leave the manual source extent, the whole delta is
 * reduced so pairwise offsets stay unchanged.
 */
export function translateManualPerspectiveImagePoints(
  points: ManualPerspectiveImagePoints,
  deltaX: number,
  deltaY: number,
): ManualPerspectiveImagePoints {
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
    return cloneManualPerspectiveImagePoints(points);
  }
  const delta = clampManualPerspectiveTranslation(points, deltaX, deltaY);
  return Object.freeze({
    NL: Object.freeze({ x: points.NL.x + delta.x, y: points.NL.y + delta.y }),
    NR: Object.freeze({ x: points.NR.x + delta.x, y: points.NR.y + delta.y }),
    FR: Object.freeze({ x: points.FR.x + delta.x, y: points.FR.y + delta.y }),
    FL: Object.freeze({ x: points.FL.x + delta.x, y: points.FL.y + delta.y }),
  });
}

export function clampManualPerspectiveTranslation(
  points: ManualPerspectiveImagePoints,
  deltaX: number,
  deltaY: number,
): Readonly<{ x: number; y: number }> {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const corner of MANUAL_PERSPECTIVE_CORNERS) {
    minX = Math.min(minX, points[corner].x);
    maxX = Math.max(maxX, points[corner].x);
    minY = Math.min(minY, points[corner].y);
    maxY = Math.max(maxY, points[corner].y);
  }
  return Object.freeze({
    x: clampSharedDelta(deltaX, minX, maxX),
    y: clampSharedDelta(deltaY, minY, maxY),
  });
}

function clampSharedDelta(delta: number, minValue: number, maxValue: number): number {
  if (!Number.isFinite(delta)) return 0;
  const lower = FLOOR_SOURCE_COORDINATE_MIN - minValue;
  const upper = FLOOR_SOURCE_COORDINATE_MAX - maxValue;
  // A quad that already sits outside the extent keeps the requested delta.
  // Corner edits are unrestricted, and pulling those points back would move
  // the quad without a pointer request. While the quad fits, reduce the
  // shared delta so every corner stays inside together.
  if (!(lower <= 0 && upper >= 0)) return delta;
  return Math.min(upper, Math.max(lower, delta));
}

function pointInManualQuad(
  point: Readonly<{ x: number; y: number }>,
  quad: ManualPerspectiveImagePoints,
): boolean {
  const polygon = MANUAL_PERSPECTIVE_CORNERS.map((corner) => quad[corner]);
  let sign = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    if (!start || !end) return false;
    const cross = (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x);
    if (cross === 0) continue;
    const next = Math.sign(cross);
    if (sign === 0) sign = next;
    else if (next !== sign) return false;
  }
  return true;
}

export function imagePointsEqual(
  left: ManualPerspectiveImagePoints,
  right: ManualPerspectiveImagePoints,
): boolean {
  return MANUAL_PERSPECTIVE_CORNERS.every(
    (corner) => left[corner].x === right[corner].x && left[corner].y === right[corner].y,
  );
}

/**
 * The polygon is acceptable to the production settle gates: four finite
 * source-normalized corners, inside the existing floor extent, ordered
 * NL, NR, FR, FL. This does not move a rejected point.
 */
export function manualPerspectiveImageQuadValid(
  points: ManualPerspectiveImagePoints,
): boolean {
  const quad = quadFromImagePoints(points);
  return (
    validateFloorSourcePolygonExtent(quad).ok &&
    validateOrderedFloorCorners(quad.map((point) => ({ x: point.x, y: point.y }))).ok
  );
}

export function canonicalWorldRectangle(
  worldWidthM: number,
  referenceDepthM: number,
): ManualPerspectiveWorldRectangle | null {
  if (!(worldWidthM > 0) || !(referenceDepthM > 0)) return null;
  const rectangle = getFloorRectCorners({
    widthMeters: worldWidthM,
    depthMeters: referenceDepthM,
  });
  if (!rectangle.ok) return null;
  const widthDepthRatio = worldWidthM / referenceDepthM;
  if (!Number.isFinite(widthDepthRatio) || !(widthDepthRatio > 0)) return null;
  const corners = rectangle.value;
  return Object.freeze({
    worldWidthM,
    referenceDepthM,
    widthDepthRatio,
    corners: Object.freeze({
      NL: Object.freeze({ x: corners.nearLeft.x, z: corners.nearLeft.z }),
      NR: Object.freeze({ x: corners.nearRight.x, z: corners.nearRight.z }),
      FR: Object.freeze({ x: corners.farRight.x, z: corners.farRight.z }),
      FL: Object.freeze({ x: corners.farLeft.x, z: corners.farLeft.z }),
    }),
  });
}

function finiteImagePoint(point: ManualPerspectiveImagePoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}
