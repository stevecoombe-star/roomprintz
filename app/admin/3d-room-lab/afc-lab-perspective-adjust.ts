import {
  AFC_LAB_GEOMETRY_SEMANTIC_ORDER,
  constructAfcLabNrAdjustedPolygon,
} from "./afc-lab-geometry-candidate";

type Point = Readonly<{ x: number; y: number }>;
type Polygon = readonly [Point, Point, Point, Point];

export const AFC_PERSPECTIVE_ADJUST_DELTA_LIMIT = 0.05;
export const AFC_PERSPECTIVE_ADJUST_KEYBOARD_DEBOUNCE_MS = 150;

export type AfcPerspectiveAdjustCandidateFailure =
  | "invalid_baseline_seam"
  | "invalid_requested_delta"
  | "candidate_seam_out_of_domain"
  | "source_polygon_invalid";

export type AfcPerspectiveAdjustCandidateInput = Readonly<{
  rawSourceNormalizedPolygon: unknown;
  baselineSeamT: number;
  requestedDeltaSeamT: number;
}>;

export type AfcPerspectiveAdjustCandidate = Readonly<{
  semanticOrder: typeof AFC_LAB_GEOMETRY_SEMANTIC_ORDER;
  baselineSeamT: number;
  requestedDeltaSeamT: number;
  committedDeltaSeamT: number;
  candidateSeamT: number;
  sourceNormalizedPolygon: Polygon;
}>;

export type AfcPerspectiveAdjustCandidateResult =
  | Readonly<{ ok: true; candidate: AfcPerspectiveAdjustCandidate }>
  | Readonly<{ ok: false; reason: AfcPerspectiveAdjustCandidateFailure }>;

export type AfcPerspectiveFloorCommitOptions = Readonly<{
  preservePerspectiveSession?: boolean;
}>;

export function clampAfcPerspectiveAdjustDelta(delta: number): number | null {
  if (!Number.isFinite(delta)) return null;
  return Math.max(-AFC_PERSPECTIVE_ADJUST_DELTA_LIMIT, Math.min(AFC_PERSPECTIVE_ADJUST_DELTA_LIMIT, delta));
}

/**
 * A Perspective session owns only its deliberate Floor commit. Every other
 * authority mutation, including manual corner edits, invalidates the session.
 */
export function shouldInvalidateAfcPerspectiveSessionForFloorCommit(
  options?: AfcPerspectiveFloorCommitOptions
): boolean {
  return options?.preservePerspectiveSession !== true;
}

/**
 * Converts immutable AFC geometry plus a bounded user delta into a new
 * fixed-seam polygon. It is deliberately pure: settling and all Floor/camera
 * writes remain in the Lab host.
 */
export function buildAfcPerspectiveAdjustCandidate(
  input: AfcPerspectiveAdjustCandidateInput
): AfcPerspectiveAdjustCandidateResult {
  if (!Number.isFinite(input.baselineSeamT) || input.baselineSeamT <= 0 || input.baselineSeamT >= 1) {
    return Object.freeze({ ok: false as const, reason: "invalid_baseline_seam" as const });
  }
  const committedDeltaSeamT = clampAfcPerspectiveAdjustDelta(input.requestedDeltaSeamT);
  if (committedDeltaSeamT === null) {
    return Object.freeze({ ok: false as const, reason: "invalid_requested_delta" as const });
  }
  const candidateSeamT = input.baselineSeamT + committedDeltaSeamT;
  // The seam construction primitive accepts the fixture's inclusive domain for
  // historical automatic-candidate validation. Perspective adjustment is
  // stricter: degenerate endpoint seams are never legal.
  if (candidateSeamT <= 0 || candidateSeamT >= 1) {
    return Object.freeze({ ok: false as const, reason: "candidate_seam_out_of_domain" as const });
  }
  const sourceNormalizedPolygon = constructAfcLabNrAdjustedPolygon(input.rawSourceNormalizedPolygon, candidateSeamT);
  if (!sourceNormalizedPolygon) {
    return Object.freeze({ ok: false as const, reason: "source_polygon_invalid" as const });
  }
  return Object.freeze({
    ok: true as const,
    candidate: Object.freeze({
      semanticOrder: AFC_LAB_GEOMETRY_SEMANTIC_ORDER,
      baselineSeamT: input.baselineSeamT,
      requestedDeltaSeamT: input.requestedDeltaSeamT,
      committedDeltaSeamT,
      candidateSeamT,
      sourceNormalizedPolygon,
    }),
  });
}
