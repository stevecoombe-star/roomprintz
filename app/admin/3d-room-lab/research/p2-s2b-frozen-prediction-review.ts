import type {
  EmptyRegionBoundaryFragment,
} from "./empty-region-boundary-fragments";

export const P2_S2B_FROZEN_REVIEW_ROOMS = ["room-b", "room-d"] as const;
export const P2_S2B_FROZEN_REVIEW_BOUNDARY_STATES = [
  "physical_wall",
  "unknown",
  "frame_truncated",
] as const;

export type P2S2BFrozenReviewRoomId =
  typeof P2_S2B_FROZEN_REVIEW_ROOMS[number];
export type P2S2BFrozenReviewBoundaryState =
  typeof P2_S2B_FROZEN_REVIEW_BOUNDARY_STATES[number];
export type P2S2BFrozenReviewDimensions = Readonly<{
  width: number;
  height: number;
}>;
export type P2S2BFrozenReviewPoint = Readonly<{ x: number; y: number }>;

export function isP2S2BFrozenReviewRoomId(
  value: unknown
): value is P2S2BFrozenReviewRoomId {
  return typeof value === "string" &&
    P2_S2B_FROZEN_REVIEW_ROOMS.includes(value as P2S2BFrozenReviewRoomId);
}

/**
 * Receipt coordinates were frozen as source pixel / full source extent.
 * Multiplying by that same extent recovers the persisted source geometry
 * without smoothing, extension, merging, closure, or integer quantization.
 */
export function p2S2BReviewNormalizedToSourcePixel(
  point: P2S2BFrozenReviewPoint,
  dimensions: P2S2BFrozenReviewDimensions
): P2S2BFrozenReviewPoint {
  return Object.freeze({
    x: point.x * dimensions.width,
    y: point.y * dimensions.height,
  });
}

/**
 * Maps a pointer ratio to the containing source pixel. Floor is intentional:
 * rounding a ratio times the full extent creates a +1 center-pixel bias.
 */
export function p2S2BReviewRatioToSourcePixel(
  ratio: number,
  extent: number
): number {
  if (!Number.isFinite(ratio) || !Number.isInteger(extent) || extent <= 0) {
    throw new TypeError("source-pixel mapping requires a finite ratio and extent");
  }
  return Math.min(extent - 1, Math.max(0, Math.floor(ratio * extent)));
}

export function p2S2BReviewPointerToSourcePixel(
  point: P2S2BFrozenReviewPoint,
  renderedDimensions: P2S2BFrozenReviewDimensions,
  sourceDimensions: P2S2BFrozenReviewDimensions
): P2S2BFrozenReviewPoint {
  if (renderedDimensions.width <= 0 || renderedDimensions.height <= 0) {
    throw new TypeError("rendered dimensions must be positive");
  }
  return Object.freeze({
    x: p2S2BReviewRatioToSourcePixel(
      point.x / renderedDimensions.width,
      sourceDimensions.width
    ),
    y: p2S2BReviewRatioToSourcePixel(
      point.y / renderedDimensions.height,
      sourceDimensions.height
    ),
  });
}

export function p2S2BReviewFragmentPolyline(
  fragment: Pick<EmptyRegionBoundaryFragment, "pointsSourceNormalized">,
  dimensions: P2S2BFrozenReviewDimensions
): readonly P2S2BFrozenReviewPoint[] {
  return Object.freeze(fragment.pointsSourceNormalized.map(point =>
    p2S2BReviewNormalizedToSourcePixel(point, dimensions)
  ));
}

export function p2S2BReviewFragmentsForState(
  fragments: readonly EmptyRegionBoundaryFragment[],
  state: P2S2BFrozenReviewBoundaryState
): readonly EmptyRegionBoundaryFragment[] {
  return Object.freeze(fragments.filter(fragment =>
    fragment.boundaryState === state
  ));
}

export function p2S2BReviewFragmentCounts(
  fragments: readonly EmptyRegionBoundaryFragment[]
): Readonly<Record<P2S2BFrozenReviewBoundaryState, number>> {
  const counts: Record<P2S2BFrozenReviewBoundaryState, number> = {
    physical_wall: 0,
    unknown: 0,
    frame_truncated: 0,
  };
  for (const fragment of fragments) counts[fragment.boundaryState] += 1;
  return Object.freeze(counts);
}
