/**
 * Lab UX helpers. Not metric eligibility, Auto formula, or overlay
 * geometry authority. Visualization and control defaults only.
 */

import { METRIC_CORRESPONDENCE_EMPTY_IMAGE_SPACE } from "./metric-correspondence-span-contract";
import type { RoomBoundaryCandidate } from "./room-boundary-authority-contract";

export const METRIC_SPAN_EMPTY_OVERLAY_IMAGE_SPACE =
  METRIC_CORRESPONDENCE_EMPTY_IMAGE_SPACE;

export function defaultTrustSelectedBackSpanAsFullWidth(
  compatibilityTier: string | null | undefined,
): boolean {
  return compatibilityTier === "exact_grid_compatible";
}

export function labCompatibilityTierForTrustDefault(input: Readonly<{
  oldCompatibilityTier?: string | null;
  emptyAuthoritativeCompatibilityTier?: string | null;
  roomBoundaryCompatibilityTier?: string | null;
}>): string | null {
  return input.oldCompatibilityTier ??
    input.emptyAuthoritativeCompatibilityTier ??
    input.roomBoundaryCompatibilityTier ??
    null;
}

function finitePoint(
  point: Readonly<{ x: number; y: number }> | null | undefined,
): point is Readonly<{ x: number; y: number }> {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

/**
 * EMPTY-basis A/B for Path A visualization only. Does not replace
 * correspondence imageA/imageB or recompute canonicalLength.
 */
export function emptyImageEndpointsFromS4aCandidate(
  candidate: RoomBoundaryCandidate | null | undefined,
): Readonly<{
  imageA: Readonly<{ x: number; y: number }>;
  imageB: Readonly<{ x: number; y: number }>;
}> | null {
  if (!candidate) return null;
  const polyline = candidate.imageEvidence.polyline;
  if (polyline.length >= 2) {
    const first = polyline[0];
    const last = polyline[polyline.length - 1];
    if (finitePoint(first) && finitePoint(last)) {
      return Object.freeze({
        imageA: Object.freeze({ x: first.x, y: first.y }),
        imageB: Object.freeze({ x: last.x, y: last.y }),
      });
    }
  }
  const points = candidate.projection.points;
  if (points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  if (!first?.ok || !last?.ok) return null;
  if (
    !finitePoint(first.emptySourceNormalized) ||
    !finitePoint(last.emptySourceNormalized)
  ) {
    return null;
  }
  return Object.freeze({
    imageA: Object.freeze({
      x: first.emptySourceNormalized.x,
      y: first.emptySourceNormalized.y,
    }),
    imageB: Object.freeze({
      x: last.emptySourceNormalized.x,
      y: last.emptySourceNormalized.y,
    }),
  });
}
