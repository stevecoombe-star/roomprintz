import {
  validateFloorSourcePolygonExtent,
} from "./floor-coordinate-extent";
import { validateOrderedFloorCorners } from "./perspective-solve";
import type { FloorPoint } from "./scene-state";

export const AFC_TILED_PERSPECTIVE_ADJUST_MODE =
  "tiled_symmetric_near_edge_v1" as const;
export const AFC_TILED_PERSPECTIVE_ADJUST_DELTA_LIMIT = 0.15;

export type AfcTiledPerspectivePolygon = readonly [
  Readonly<FloorPoint>,
  Readonly<FloorPoint>,
  Readonly<FloorPoint>,
  Readonly<FloorPoint>,
];

export type AfcTiledPerspectiveAdjustmentRange = Readonly<{
  minDelta: number;
  maxDelta: number;
  usable: boolean;
}>;

export type AfcTiledPerspectiveAdjustmentResult =
  | Readonly<{ ok: true; sourceNormalizedPolygon: AfcTiledPerspectivePolygon; committedDelta: number }>
  | Readonly<{ ok: false; reason: "invalid_automatic_polygon" | "invalid_requested_delta" }>;

const RANGE_STEPS = 120;
const RANGE_EPSILON = 1e-6;

function clonePolygon(polygon: AfcTiledPerspectivePolygon): AfcTiledPerspectivePolygon {
  return Object.freeze(polygon.map((point) => Object.freeze({ x: point.x, y: point.y }))) as AfcTiledPerspectivePolygon;
}

function isSemanticallyNear(polygon: AfcTiledPerspectivePolygon): boolean {
  const nearY = (polygon[0].y + polygon[1].y) / 2;
  const farY = (polygon[2].y + polygon[3].y) / 2;
  return nearY > farY;
}

/** Uses the established AFC perimeter/order and source-extent validators. */
export function isValidAfcTiledPerspectivePolygon(
  polygon: AfcTiledPerspectivePolygon
): boolean {
  return validateFloorSourcePolygonExtent(polygon).ok &&
    validateOrderedFloorCorners(polygon.map((point) => ({ ...point }))).ok &&
    isSemanticallyNear(polygon);
}

export function clampAfcTiledPerspectiveDelta(
  delta: number,
  range: AfcTiledPerspectiveAdjustmentRange
): number | null {
  if (!Number.isFinite(delta) || !range.usable) return null;
  return Math.max(range.minDelta, Math.min(range.maxDelta, delta));
}

/**
 * Builds the S2B symmetric-near-edge adjustment from immutable TILED
 * Automatic geometry. At zero it intentionally returns a direct copy.
 */
export function buildAfcTiledPerspectiveAdjustPolygon(
  automaticPolygon: AfcTiledPerspectivePolygon,
  requestedDelta: number,
  range?: AfcTiledPerspectiveAdjustmentRange
): AfcTiledPerspectiveAdjustmentResult {
  if (!isValidAfcTiledPerspectivePolygon(automaticPolygon)) {
    return Object.freeze({ ok: false, reason: "invalid_automatic_polygon" });
  }
  const committedDelta = range
    ? clampAfcTiledPerspectiveDelta(requestedDelta, range)
    : Number.isFinite(requestedDelta)
      ? Math.max(-AFC_TILED_PERSPECTIVE_ADJUST_DELTA_LIMIT,
        Math.min(AFC_TILED_PERSPECTIVE_ADJUST_DELTA_LIMIT, requestedDelta))
      : null;
  if (committedDelta === null) {
    return Object.freeze({ ok: false, reason: "invalid_requested_delta" });
  }
  if (committedDelta === 0) {
    return Object.freeze({
      ok: true,
      committedDelta: 0,
      sourceNormalizedPolygon: clonePolygon(automaticPolygon),
    });
  }
  const scale = 1 - committedDelta;
  const [NL, NR, FR, FL] = automaticPolygon;
  const polygon = Object.freeze([
    Object.freeze({ x: FL.x + scale * (NL.x - FL.x), y: FL.y + scale * (NL.y - FL.y) }),
    Object.freeze({ x: FR.x + scale * (NR.x - FR.x), y: FR.y + scale * (NR.y - FR.y) }),
    Object.freeze({ x: FR.x, y: FR.y }),
    Object.freeze({ x: FL.x, y: FL.y }),
  ]) as AfcTiledPerspectivePolygon;
  return isValidAfcTiledPerspectivePolygon(polygon)
    ? Object.freeze({ ok: true, committedDelta, sourceNormalizedPolygon: polygon })
    : Object.freeze({ ok: false, reason: "invalid_requested_delta" });
}

function travelLimit(
  automaticPolygon: AfcTiledPerspectivePolygon,
  direction: -1 | 1
): number {
  let valid = 0;
  for (let step = 1; step <= RANGE_STEPS; step += 1) {
    const candidate = direction * AFC_TILED_PERSPECTIVE_ADJUST_DELTA_LIMIT * step / RANGE_STEPS;
    const built = buildAfcTiledPerspectiveAdjustPolygon(automaticPolygon, candidate);
    if (!built.ok) break;
    valid = candidate;
  }
  if (Math.abs(valid) === AFC_TILED_PERSPECTIVE_ADJUST_DELTA_LIMIT) return valid;
  const invalid = valid + direction * AFC_TILED_PERSPECTIVE_ADJUST_DELTA_LIMIT / RANGE_STEPS;
  let low = Math.abs(valid);
  let high = Math.min(AFC_TILED_PERSPECTIVE_ADJUST_DELTA_LIMIT, Math.abs(invalid));
  for (let iteration = 0; iteration < 32; iteration += 1) {
    const middle = (low + high) / 2;
    if (buildAfcTiledPerspectiveAdjustPolygon(automaticPolygon, direction * middle).ok) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return direction * low;
}

/** Finds contiguous geometry-valid travel from Automatic inside the S2B window. */
export function computeAfcTiledPerspectiveAdjustmentRange(
  automaticPolygon: AfcTiledPerspectivePolygon
): AfcTiledPerspectiveAdjustmentRange | null {
  if (!isValidAfcTiledPerspectivePolygon(automaticPolygon)) return null;
  const minDelta = travelLimit(automaticPolygon, -1);
  const maxDelta = travelLimit(automaticPolygon, 1);
  return Object.freeze({
    minDelta,
    maxDelta,
    usable: minDelta < -RANGE_EPSILON || maxDelta > RANGE_EPSILON,
  });
}
