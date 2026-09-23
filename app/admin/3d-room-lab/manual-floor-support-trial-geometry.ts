// --- Phase 2O-D: Constrained Diagnostic Trial geometry ----------------------
// Pure geometry + image-space helpers for constrained trial generation.
//
// IMPORT BOUNDARY: this module may use pure geometry, the cover-crop image-space
// helpers, and validateOrderedFloorCorners. It MUST NOT import the solver evaluation
// (evaluateQuadSolvability), Apply/FOV/snapshot/scene-state, or any UI/state.
//
// All arc-length / corridor / separation math is performed in SOURCE-IMAGE
// PIXEL space (via the intrinsic width/height), never container size, so trial
// density and tolerances are independent of container resize.

import {
  containerNormToSourceNorm,
  sourceNormToContainerNormDiagnostic,
  type ImageFrameSize,
  type ImageIntrinsicSize,
  type SourceToContainerDiagnostic,
} from "./image-space";
import type {
  FloorCornerLabel,
  ManualPhysicalSeam,
  SourceNormPoint,
} from "./manual-floor-support-types";
import { validateOrderedFloorCorners } from "./perspective-solve";
import {
  createEvaluableConstraintStatus,
  mergeConstraintStatus,
  type ManualTrialConstraintStatus,
  type TrialPoint,
  type TrialQuadNorm,
} from "./manual-floor-support-trial-types";

// Re-export the image size types so the generation module can stay limited to
// trial-types + trial-geometry + annotation types/validation.
export type { ImageFrameSize, ImageIntrinsicSize, SourceToContainerDiagnostic };

// Canonical corner label -> quad index. Mirrors the semantic Floor order:
//   [NL, NR, FR, FL]
export const CANONICAL_CORNER_INDEX: Record<FloorCornerLabel, number> = {
  NL: 0,
  NR: 1,
  FR: 2,
  FL: 3,
};

// Tunables (all in SOURCE-IMAGE PIXEL space unless noted).
export const TRIAL_SAMPLE_STEP_SOURCE_PX = 48;
export const TRIAL_MIN_PAIR_SEPARATION_SOURCE_PX = 8;
// Container-normalized minimum signed area for a non-degenerate trial quad.
export const TRIAL_MIN_QUAD_AREA_NORM = 0.004;
// Container-normalized margin below which an in-frame sample is "near edge".
export const TRIAL_NEAR_EDGE_MARGIN_NORM = 0.02;

const EPS = 1e-9;

function isFinitePoint(p: { x: number; y: number } | null | undefined): p is TrialPoint {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

// --- Usable seam arc-length model -------------------------------------------
// Source-image pixel arc length along the operator-approved usable polyline
// span [startVertexIndex .. endVertexIndex].
export type UsableSeam = {
  // Source-normalized vertices for the usable span only.
  pointsSourceNorm: SourceNormPoint[];
  // Cumulative source-pixel arc length at each vertex (cumulativeArcPx[0] = 0).
  cumulativeArcPx: number[];
  totalArcPx: number;
  intrinsic: ImageIntrinsicSize;
};

function sourceDistancePx(
  a: SourceNormPoint,
  b: SourceNormPoint,
  intrinsic: ImageIntrinsicSize
): number {
  const dx = (b.x - a.x) * intrinsic.width;
  const dy = (b.y - a.y) * intrinsic.height;
  return Math.hypot(dx, dy);
}

export function buildUsableSeam(
  seam: ManualPhysicalSeam,
  intrinsic: ImageIntrinsicSize
): UsableSeam | null {
  if (!seam || !Array.isArray(seam.points)) return null;
  if (!Number.isFinite(intrinsic.width) || !Number.isFinite(intrinsic.height)) return null;
  if (intrinsic.width <= 0 || intrinsic.height <= 0) return null;

  const span = seam.usableSpan;
  if (!span) return null;
  const { startVertexIndex: start, endVertexIndex: end } = span;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < 0 ||
    start >= seam.points.length ||
    end >= seam.points.length ||
    start >= end
  ) {
    return null;
  }

  const pointsSourceNorm: SourceNormPoint[] = [];
  for (let i = start; i <= end; i += 1) {
    const p = seam.points[i];
    if (!isFinitePoint(p)) return null;
    pointsSourceNorm.push({ x: p.x, y: p.y });
  }
  if (pointsSourceNorm.length < 2) return null;

  const cumulativeArcPx: number[] = [0];
  for (let i = 1; i < pointsSourceNorm.length; i += 1) {
    const segLen = sourceDistancePx(pointsSourceNorm[i - 1], pointsSourceNorm[i], intrinsic);
    cumulativeArcPx.push(cumulativeArcPx[i - 1] + segLen);
  }
  const totalArcPx = cumulativeArcPx[cumulativeArcPx.length - 1];
  if (!(totalArcPx > 0)) return null;

  return { pointsSourceNorm, cumulativeArcPx, totalArcPx, intrinsic };
}

export function arcPxAtT(usable: UsableSeam, t: number): number {
  return clamp(t, 0, 1) * usable.totalArcPx;
}

export function tAtArcPx(usable: UsableSeam, arcPx: number): number {
  if (usable.totalArcPx <= 0) return 0;
  return clamp(arcPx / usable.totalArcPx, 0, 1);
}

export function pointAtArcPx(usable: UsableSeam, arcPx: number): SourceNormPoint {
  const target = clamp(arcPx, 0, usable.totalArcPx);
  const cum = usable.cumulativeArcPx;
  for (let i = 1; i < cum.length; i += 1) {
    if (target <= cum[i] + EPS) {
      const segLen = cum[i] - cum[i - 1];
      const f = segLen > 0 ? (target - cum[i - 1]) / segLen : 0;
      const a = usable.pointsSourceNorm[i - 1];
      const b = usable.pointsSourceNorm[i];
      return { x: a.x + f * (b.x - a.x), y: a.y + f * (b.y - a.y) };
    }
  }
  const last = usable.pointsSourceNorm[usable.pointsSourceNorm.length - 1];
  return { x: last.x, y: last.y };
}

export function pointAtT(usable: UsableSeam, t: number): SourceNormPoint {
  return pointAtArcPx(usable, arcPxAtT(usable, t));
}

export type NearestSeamResult = {
  tGlobal: number;
  arcPx: number;
  pointSourceNorm: SourceNormPoint;
  distanceSourcePx: number;
};

// Nearest point on the usable seam to a query (source-normalized) point. All
// projection math is performed in source-pixel space so the returned distance
// is a true source-pixel distance.
export function nearestPointOnUsableSeam(
  usable: UsableSeam,
  querySourceNorm: SourceNormPoint
): NearestSeamResult {
  const W = usable.intrinsic.width;
  const H = usable.intrinsic.height;
  const qx = querySourceNorm.x * W;
  const qy = querySourceNorm.y * H;

  let best: NearestSeamResult | null = null;
  const pts = usable.pointsSourceNorm;
  for (let i = 1; i < pts.length; i += 1) {
    const ax = pts[i - 1].x * W;
    const ay = pts[i - 1].y * H;
    const bx = pts[i].x * W;
    const by = pts[i].y * H;
    const dx = bx - ax;
    const dy = by - ay;
    const segLenSq = dx * dx + dy * dy;
    let f = 0;
    if (segLenSq > EPS) {
      f = clamp(((qx - ax) * dx + (qy - ay) * dy) / segLenSq, 0, 1);
    }
    const projX = ax + f * dx;
    const projY = ay + f * dy;
    const dist = Math.hypot(qx - projX, qy - projY);
    if (!best || dist < best.distanceSourcePx) {
      const segLen = usable.cumulativeArcPx[i] - usable.cumulativeArcPx[i - 1];
      const arcPx = usable.cumulativeArcPx[i - 1] + f * segLen;
      best = {
        tGlobal: tAtArcPx(usable, arcPx),
        arcPx,
        pointSourceNorm: { x: projX / W, y: projY / H },
        distanceSourcePx: dist,
      };
    }
  }
  // pts.length >= 2 guaranteed by buildUsableSeam.
  return best as NearestSeamResult;
}

export function distanceToUsableSeamSourcePx(
  usable: UsableSeam,
  querySourceNorm: SourceNormPoint
): number {
  return nearestPointOnUsableSeam(usable, querySourceNorm).distanceSourcePx;
}

// Source-pixel arc-length separation between two parameter values.
export function separationSourcePx(usable: UsableSeam, tA: number, tB: number): number {
  return Math.abs(arcPxAtT(usable, tA) - arcPxAtT(usable, tB));
}

// --- Coordinate bridge wrappers ---------------------------------------------
// Generation goes through these so it never imports image-space directly.

export function sourceToContainerForTrial(
  point: SourceNormPoint,
  intrinsic: ImageIntrinsicSize,
  frame: ImageFrameSize
): SourceToContainerDiagnostic | null {
  return sourceNormToContainerNormDiagnostic(point, intrinsic, frame);
}

export function containerToSourceForAnchor(
  point: TrialPoint,
  intrinsic: ImageIntrinsicSize,
  frame: ImageFrameSize
): SourceNormPoint | null {
  return containerNormToSourceNorm(point, intrinsic, frame);
}

export function isNearFrameEdge(point: TrialPoint): boolean {
  const margin = Math.min(point.x, 1 - point.x, point.y, 1 - point.y);
  return margin < TRIAL_NEAR_EDGE_MARGIN_NORM;
}

// --- Pure quad geometry primitives ------------------------------------------
function signedAreaNorm(quad: TrialQuadNorm): number {
  let sum = 0;
  for (let i = 0; i < quad.length; i += 1) {
    const a = quad[i];
    const b = quad[(i + 1) % quad.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

function isConvexOrderedQuad(quad: TrialQuadNorm): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i += 1) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const c = quad[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < EPS) return false; // collinear / degenerate
    const cur = cross > 0 ? 1 : -1;
    if (sign === 0) sign = cur;
    else if (cur !== sign) return false;
  }
  return true;
}

function segmentsProperlyIntersect(
  p1: TrialPoint,
  p2: TrialPoint,
  p3: TrialPoint,
  p4: TrialPoint
): boolean {
  const orient = (a: TrialPoint, b: TrialPoint, c: TrialPoint): number => {
    const v = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(v) < EPS) return 0;
    return v > 0 ? 1 : -1;
  };
  const d1 = orient(p3, p4, p1);
  const d2 = orient(p3, p4, p2);
  const d3 = orient(p1, p2, p3);
  const d4 = orient(p1, p2, p4);
  return d1 !== d2 && d3 !== d4 && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0;
}

function selfIntersectsQuad(quad: TrialQuadNorm): boolean {
  // Non-adjacent edge pairs of NL->NR->FR->FL->NL.
  return (
    segmentsProperlyIntersect(quad[0], quad[1], quad[2], quad[3]) ||
    segmentsProperlyIntersect(quad[1], quad[2], quad[3], quad[0])
  );
}

function pointsDistinct(a: TrialPoint, b: TrialPoint): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) > 1e-6;
}

// --- Pre-solver geometry gate (quad-level) ----------------------------------
export type TrialQuadGateParams = {
  quad: TrialQuadNorm;
  baselineQuad: TrialQuadNorm;
  // Quad indices permitted to differ from baseline (others must be identical).
  changedCornerIndices: number[];
  minAreaNorm?: number;
};

// Pure pre-solver gate. Returns hard reasons (block the solver) and warnings
// (advisory). Does NOT call the solver. Coupled seam-relationship checks live in
// checkCoupledSeamConstraints and are merged by the generator.
export function gateTrialQuad(params: TrialQuadGateParams): ManualTrialConstraintStatus {
  const { quad, baselineQuad, changedCornerIndices } = params;
  const minArea = params.minAreaNorm ?? TRIAL_MIN_QUAD_AREA_NORM;
  let status = createEvaluableConstraintStatus();

  // Finite + in-range container-normalized points (off-frame conversion already
  // surfaces separately, but this is a defensive hard guard).
  for (let i = 0; i < quad.length; i += 1) {
    const p = quad[i];
    if (!isFinitePoint(p)) {
      status = mergeConstraintStatus(status, { hardReasons: [`corner ${i} is non-finite`] });
    } else if (p.x < -EPS || p.x > 1 + EPS || p.y < -EPS || p.y > 1 + EPS) {
      status = mergeConstraintStatus(status, {
        hardReasons: [`corner ${i} is out of container-normalized range`],
      });
    }
  }
  if (!status.canEvaluate) return status;

  // Fixed-corner invariance: every corner NOT permitted to change must be
  // byte-identical to baseline.
  const changedSet = new Set(changedCornerIndices);
  for (let i = 0; i < quad.length; i += 1) {
    if (changedSet.has(i)) continue;
    if (quad[i].x !== baselineQuad[i].x || quad[i].y !== baselineQuad[i].y) {
      status = mergeConstraintStatus(status, {
        hardReasons: [`fixed corner ${i} changed from baseline`],
      });
    }
  }

  // Distinct corners / zero-length edges.
  for (let i = 0; i < quad.length; i += 1) {
    for (let j = i + 1; j < quad.length; j += 1) {
      if (!pointsDistinct(quad[i], quad[j])) {
        status = mergeConstraintStatus(status, {
          hardReasons: [`corners ${i} and ${j} are not distinct`],
        });
      }
    }
  }

  // Canonical orderability.
  const ordered = validateOrderedFloorCorners(quad);
  if (!ordered.ok) {
    status = mergeConstraintStatus(status, {
      hardReasons: [`canonical order failure: ${ordered.reason}`],
    });
  }

  // Convexity + self-intersection.
  if (!isConvexOrderedQuad(quad)) {
    status = mergeConstraintStatus(status, { hardReasons: ["quad is non-convex"] });
  }
  if (selfIntersectsQuad(quad)) {
    status = mergeConstraintStatus(status, { hardReasons: ["quad self-intersects"] });
  }

  // Orientation must match baseline (no flip).
  const baseArea = signedAreaNorm(baselineQuad);
  const trialArea = signedAreaNorm(quad);
  const baseSign = baseArea > 0 ? 1 : baseArea < 0 ? -1 : 0;
  const trialSign = trialArea > 0 ? 1 : trialArea < 0 ? -1 : 0;
  if (baseSign !== 0 && trialSign !== baseSign) {
    status = mergeConstraintStatus(status, {
      hardReasons: ["orientation/signed-area mismatch against baseline"],
    });
  }

  // Minimum area.
  const absArea = Math.abs(trialArea);
  if (absArea < minArea) {
    status = mergeConstraintStatus(status, {
      hardReasons: [`quad area ${absArea.toFixed(5)} below minimum ${minArea}`],
    });
  } else if (absArea < minArea * 2) {
    status = mergeConstraintStatus(status, { warnings: ["quad area near minimum"] });
  }

  return status;
}

// --- Coupled FL/FR seam-relationship checks ---------------------------------
export type CoupledSeamCheckParams = {
  // Arc positions (source px) of the two moved anchors for this sample.
  arcFL: number;
  arcFR: number;
  // Baseline anchor arc positions used to define the preserved relationship.
  baselineArcFL: number;
  baselineArcFR: number;
  minSeparationSourcePx: number;
  maxRelativeAlongSeamDeltaSourcePx: number;
};

export function checkCoupledSeamConstraints(
  params: CoupledSeamCheckParams
): ManualTrialConstraintStatus {
  let status = createEvaluableConstraintStatus();

  const baselineDiff = params.baselineArcFR - params.baselineArcFL;
  const sampleDiff = params.arcFR - params.arcFL;

  // Order preserved (no inversion of FL -> FR ordering along the seam).
  const baseSign = baselineDiff > 0 ? 1 : baselineDiff < 0 ? -1 : 0;
  const sampleSign = sampleDiff > 0 ? 1 : sampleDiff < 0 ? -1 : 0;
  if (baseSign === 0 || sampleSign !== baseSign) {
    status = mergeConstraintStatus(status, {
      hardReasons: ["coupled FL/FR order failure"],
    });
  }

  // Non-collapse.
  if (Math.abs(sampleDiff) < params.minSeparationSourcePx) {
    status = mergeConstraintStatus(status, {
      hardReasons: ["coupled FL/FR pair collapse (insufficient separation)"],
    });
  }

  // Relative (shared-delta) drift bound. A genuine shared delta preserves the
  // relationship exactly (relative drift 0); this is a defensive guard.
  const relativeDriftPx = Math.abs(sampleDiff - baselineDiff);
  if (relativeDriftPx > params.maxRelativeAlongSeamDeltaSourcePx + EPS) {
    status = mergeConstraintStatus(status, {
      hardReasons: ["coupled maximum-relative-delta violation"],
    });
  }

  return status;
}

export function cloneQuad(quad: TrialQuadNorm): TrialQuadNorm {
  return [
    { x: quad[0].x, y: quad[0].y },
    { x: quad[1].x, y: quad[1].y },
    { x: quad[2].x, y: quad[2].y },
    { x: quad[3].x, y: quad[3].y },
  ];
}

export function isFiniteQuadInUnitRange(quad: TrialQuadNorm | null | undefined): boolean {
  if (!quad || quad.length !== 4) return false;
  return quad.every(
    (p) => isFinitePoint(p) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1
  );
}
