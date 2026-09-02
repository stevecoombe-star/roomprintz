/**
 * Live/view-time X/Z UI control-range derivation.
 *
 * This is not movement authority and is never written into S4 receipts.
 * Active collision walls, swept collision, and the calibrated floor plane
 * remain the physical constraints. Later World Scale can change realized
 * extents; this helper re-derives from the current Floor rectangle and
 * active runtime collision-wall endpoints.
 *
 * Floor rectangle uses the same origin-centered XZ frame as the ORIGINAL
 * viewer PlaneGeometry (width along X, reference depth along Z).
 */

export type AxisControlRange = Readonly<{
  min: number;
  max: number;
  step: number;
}>;

export type SceneMovementControlRange = Readonly<{
  positionX: AxisControlRange;
  positionZ: AxisControlRange;
}>;

export type SceneFloorRectangle = Readonly<{
  worldWidthM: number;
  referenceDepthM: number;
}>;

export type SceneCollisionWallXz = Readonly<{
  a: Readonly<{ x: number; z: number }>;
  b: Readonly<{ x: number; z: number }>;
}>;

/**
 * Extra meters beyond the Floor/wall union so sliders are not wall-to-wall
 * while still letting an object approach every active boundary.
 */
export const MOVEMENT_CONTROL_RANGE_MARGIN_M = 1;

/**
 * Small rooms must not collapse into a hypersensitive slider. 10 m matches
 * the historical X control span (-5 → +5) as a minimum practical window.
 */
export const MOVEMENT_CONTROL_RANGE_MIN_SPAN_M = 10;

/**
 * Fallback when Floor/wall extents are missing or invalid.
 * UX range only — not architectural authority.
 */
export const MOVEMENT_CONTROL_RANGE_FALLBACK_ABS_M = 20;

/**
 * Cap each axis bound so malformed geometry cannot produce unusable sliders.
 * 50 m is well above current calibrated-room extents (~6 m class) and the
 * ±20 fallback. Collision logic is independent of this cap.
 */
export const MOVEMENT_CONTROL_RANGE_MAX_ABS_M = 50;

export const MOVEMENT_CONTROL_RANGE_STEP_M = 0.01;

const FALLBACK_AXIS: AxisControlRange = Object.freeze({
  min: -MOVEMENT_CONTROL_RANGE_FALLBACK_ABS_M,
  max: MOVEMENT_CONTROL_RANGE_FALLBACK_ABS_M,
  step: MOVEMENT_CONTROL_RANGE_STEP_M,
});

export function deriveSceneMovementControlRange(input: Readonly<{
  floor?: SceneFloorRectangle | null;
  collisionWalls?: readonly SceneCollisionWallXz[] | null;
}>): SceneMovementControlRange {
  return {
    positionX: deriveAxisRange(collectAxisValues(input, "x")),
    positionZ: deriveAxisRange(collectAxisValues(input, "z")),
  };
}

function collectAxisValues(
  input: Readonly<{
    floor?: SceneFloorRectangle | null;
    collisionWalls?: readonly SceneCollisionWallXz[] | null;
  }>,
  axis: "x" | "z",
): number[] {
  const values: number[] = [];
  const floor = input.floor;
  if (floor) {
    const span = axis === "x" ? floor.worldWidthM : floor.referenceDepthM;
    if (isPositiveFinite(span)) {
      const half = span / 2;
      values.push(-half, half);
    }
  }
  for (const wall of input.collisionWalls ?? []) {
    const a = axis === "x" ? wall.a.x : wall.a.z;
    const b = axis === "x" ? wall.b.x : wall.b.z;
    if (Number.isFinite(a)) values.push(a);
    if (Number.isFinite(b)) values.push(b);
  }
  return values;
}

function deriveAxisRange(values: readonly number[]): AxisControlRange {
  if (values.length === 0) return FALLBACK_AXIS;
  let extentMin = Infinity;
  let extentMax = -Infinity;
  for (const value of values) {
    if (value < extentMin) extentMin = value;
    if (value > extentMax) extentMax = value;
  }
  if (!Number.isFinite(extentMin) || !Number.isFinite(extentMax)) {
    return FALLBACK_AXIS;
  }
  let min = extentMin - MOVEMENT_CONTROL_RANGE_MARGIN_M;
  let max = extentMax + MOVEMENT_CONTROL_RANGE_MARGIN_M;
  const span = max - min;
  if (span < MOVEMENT_CONTROL_RANGE_MIN_SPAN_M) {
    const mid = (min + max) / 2;
    const half = MOVEMENT_CONTROL_RANGE_MIN_SPAN_M / 2;
    min = mid - half;
    max = mid + half;
  }
  min = Math.max(min, -MOVEMENT_CONTROL_RANGE_MAX_ABS_M);
  max = Math.min(max, MOVEMENT_CONTROL_RANGE_MAX_ABS_M);
  if (!(max > min) || !Number.isFinite(min) || !Number.isFinite(max)) {
    return FALLBACK_AXIS;
  }
  return {
    min,
    max,
    step: MOVEMENT_CONTROL_RANGE_STEP_M,
  };
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
