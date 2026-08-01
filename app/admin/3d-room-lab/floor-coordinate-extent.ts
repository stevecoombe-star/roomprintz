// AFC-CP1A: shared source-image-normalized Floor coordinate extent.
//
// Source-image-normalized Floor geometry is the canonical authority space.
// Container-normalized geometry is a derived editing/display/solver projection.
// A legitimate Floor corner may sit outside the visible container frame, so the
// authority extent is deliberately WIDER than [0,1].
//
// This module is dependency-neutral on purpose: no React, no DOM, no server
// runtime, no provider/compositor/proposal imports. It may therefore be shared
// by client geometry code and by any future non-client consumer without
// creating a boundary violation or a circular import.
//
// This module NEVER clamps. It only reports whether a point is inside the
// extent and, when it is not, why. Callers own their own accept/reject policy.

export const FLOOR_SOURCE_COORDINATE_EXTENT_VERSION =
  "afc-cp1a-floor-source-extent/v1" as const;

/** Inclusive lower bound for a source-image-normalized Floor coordinate. */
export const FLOOR_SOURCE_COORDINATE_MIN = -0.25;
/** Inclusive upper bound for a source-image-normalized Floor coordinate. */
export const FLOOR_SOURCE_COORDINATE_MAX = 1.25;

export type FloorSourceCoordinateExtent = Readonly<{
  version: typeof FLOOR_SOURCE_COORDINATE_EXTENT_VERSION;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}>;

export const FLOOR_SOURCE_COORDINATE_EXTENT: FloorSourceCoordinateExtent = Object.freeze({
  version: FLOOR_SOURCE_COORDINATE_EXTENT_VERSION,
  minX: FLOOR_SOURCE_COORDINATE_MIN,
  maxX: FLOOR_SOURCE_COORDINATE_MAX,
  minY: FLOOR_SOURCE_COORDINATE_MIN,
  maxY: FLOOR_SOURCE_COORDINATE_MAX,
});

/** A finite point expressed in source-image-normalized coordinates. */
export type FloorSourcePoint = Readonly<{ x: number; y: number }>;

export type FloorSourceExtentRejectReason =
  | "source_x_not_finite"
  | "source_y_not_finite"
  | "source_x_below_min"
  | "source_x_above_max"
  | "source_y_below_min"
  | "source_y_above_max";

export type FloorSourceExtentValidation =
  | Readonly<{ ok: true; point: FloorSourcePoint }>
  | Readonly<{ ok: false; reason: FloorSourceExtentRejectReason }>;

/**
 * Pure extent validation for a single source-image-normalized point.
 *
 * Fails closed with a structured reason. Never clamps, never rounds, never
 * mutates the input, and never substitutes a nearby in-extent value.
 *
 * A missing point is reported as a non-finite x so that callers reaching this
 * function through untyped boundaries still get a structured reason instead of
 * a thrown error.
 */
export function validateFloorSourcePointExtent(
  point: FloorSourcePoint | null | undefined,
  extent: FloorSourceCoordinateExtent = FLOOR_SOURCE_COORDINATE_EXTENT
): FloorSourceExtentValidation {
  if (!point || !Number.isFinite(point.x)) {
    return { ok: false, reason: "source_x_not_finite" };
  }
  if (!Number.isFinite(point.y)) {
    return { ok: false, reason: "source_y_not_finite" };
  }
  if (point.x < extent.minX) return { ok: false, reason: "source_x_below_min" };
  if (point.x > extent.maxX) return { ok: false, reason: "source_x_above_max" };
  if (point.y < extent.minY) return { ok: false, reason: "source_y_below_min" };
  if (point.y > extent.maxY) return { ok: false, reason: "source_y_above_max" };
  return { ok: true, point: { x: point.x, y: point.y } };
}

/** Convenience predicate over validateFloorSourcePointExtent. */
export function isFloorSourcePointWithinExtent(
  point: FloorSourcePoint | null | undefined,
  extent: FloorSourceCoordinateExtent = FLOOR_SOURCE_COORDINATE_EXTENT
): boolean {
  return validateFloorSourcePointExtent(point, extent).ok;
}

// --- Machine-precision unit-boundary canonicalization -----------------------
//
// A source coordinate that is semantically exactly on an image boundary can
// come back from a lossless container round trip one ULP away, for example
// 1 -> 1.0000000000000002. That value is mathematically correct but it is
// representational noise, not geometry, and scene-v1 persistence strictly
// rejects anything above 1, so a boundary-touching scene could fail re-import.
//
// This canonicalization removes ONLY that noise. It is not a clamp and not a
// rounding grid: a coordinate that is genuinely outside the unit range, even
// by a millionth, is returned untouched.

/**
 * Half-width of the canonicalization window around 0 and 1, in absolute units.
 *
 * Deliberately tiny: a few ULPs at magnitude 1, far below any coordinate a
 * human or a solver could mean.
 */
export const SOURCE_UNIT_BOUNDARY_EPSILON = 8 * Number.EPSILON;

/**
 * Snaps a source-normalized coordinate to exactly 0 or exactly 1 when it sits
 * within SOURCE_UNIT_BOUNDARY_EPSILON of that boundary. Any other value is
 * returned unchanged. Non-finite input fails closed with null.
 */
export function canonicalizeSourceUnitBoundaryCoordinate(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  if (Math.abs(value) <= SOURCE_UNIT_BOUNDARY_EPSILON) return 0;
  if (Math.abs(value - 1) <= SOURCE_UNIT_BOUNDARY_EPSILON) return 1;
  return value;
}

/**
 * Point-level form of canonicalizeSourceUnitBoundaryCoordinate. Returns a new
 * point and never mutates the input; null if either coordinate is non-finite.
 */
export function canonicalizeSourceUnitBoundaryPoint(
  point: FloorSourcePoint | null | undefined
): FloorSourcePoint | null {
  if (!point) return null;
  const x = canonicalizeSourceUnitBoundaryCoordinate(point.x);
  const y = canonicalizeSourceUnitBoundaryCoordinate(point.y);
  if (x === null || y === null) return null;
  return { x, y };
}
