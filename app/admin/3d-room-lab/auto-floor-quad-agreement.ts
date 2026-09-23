import type { Vec2 } from "./perspective-solve";

// --- Phase 2H-B: pure quad-agreement comparator -----------------------------
// Compares two ordered four-corner quads that live in the SAME coordinate space
// (for the assist pipeline: intrinsic-source-normalized-v0, after the identical
// dimensions/orientation gate). Both quads MUST already be corner-corresponded
// in the canonical [nearLeft, nearRight, farRight, farLeft] order (the Phase
// 2F-B mapper guarantees this via the unlabelled-input canonicalizer), so index i ↔ index i.
//
// This module is pure: no homography/FOV/pose math is reimplemented here. It
// reports corner agreement, polygon IoU, and area agreement only. Camera-pose /
// FOV compatibility is summarized by the caller from existing per-detection
// geometry scores.

export type QuadAgreementBand =
  | "strong_agreement"
  | "review_agreement"
  | "weak_agreement"
  | "incompatible"
  | "unavailable";

export type QuadAgreementResult = {
  band: QuadAgreementBand;
  meanCornerDistance: number | null;
  maxCornerDistance: number | null;
  iou: number | null;
  areaA: number | null;
  areaB: number | null;
  // Directional ratio areaA / areaB (diagnostic).
  areaRatio: number | null;
  // Symmetric closeness min(areaA, areaB) / max(areaA, areaB) in (0, 1].
  areaAgreement: number | null;
  reason: string | null;
};

// ---------------------------------------------------------------------------
// THRESHOLDS — conservative initial LAB values. Tunable as we gather fixture
// evidence; these are deliberately strict because Phase 2H-B only uses agreement
// to CORROBORATE the original quad, never to promote empty-room geometry.
//
// Distances are in normalized units (fraction of the image dimension), so 0.03
// ≈ a 3% average corner shift. The IoU/area thresholds intentionally echo the
// tightness of the existing calibrated-camera scaleRatio band (0.85–1.18).
// ---------------------------------------------------------------------------
const STRONG_MEAN_CORNER_DISTANCE = 0.03; // lab-tunable
const STRONG_MAX_CORNER_DISTANCE = 0.06; // lab-tunable
const STRONG_IOU = 0.85; // lab-tunable
const STRONG_AREA_AGREEMENT = 0.85; // lab-tunable (≈ scaleRatio 0.85–1.18 tightness)

const REVIEW_IOU = 0.6; // lab-tunable
const WEAK_IOU = 0.3; // lab-tunable
const INCOMPATIBLE_AREA_AGREEMENT = 0.5; // lab-tunable

function isFinitePoint(p: Vec2 | undefined): p is Vec2 {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

function isValidQuad(quad: Vec2[] | null | undefined): quad is [Vec2, Vec2, Vec2, Vec2] {
  return Array.isArray(quad) && quad.length === 4 && quad.every(isFinitePoint);
}

function signedArea(poly: Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

export function polygonArea(poly: Vec2[]): number {
  return Math.abs(signedArea(poly));
}

function toCounterClockwise(poly: Vec2[]): Vec2[] {
  return signedArea(poly) < 0 ? [...poly].reverse() : poly;
}

// Sutherland–Hodgman convex polygon clipping. `clip` must be convex and CCW.
function clipPolygon(subject: Vec2[], clip: Vec2[]): Vec2[] {
  let output = subject;
  for (let i = 0; i < clip.length; i += 1) {
    if (output.length === 0) break;
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    // Inside test for a CCW edge a->b: point is inside if it is to the LEFT.
    const inside = (p: Vec2) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= 0;
    const input = output;
    output = [];
    for (let j = 0; j < input.length; j += 1) {
      const current = input[j];
      const prev = input[(j + input.length - 1) % input.length];
      const currentInside = inside(current);
      const prevInside = inside(prev);
      if (currentInside) {
        if (!prevInside) {
          const pt = intersect(prev, current, a, b);
          if (pt) output.push(pt);
        }
        output.push(current);
      } else if (prevInside) {
        const pt = intersect(prev, current, a, b);
        if (pt) output.push(pt);
      }
    }
  }
  return output;
}

function intersect(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): Vec2 | null {
  const d = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);
  if (Math.abs(d) < 1e-12) return null;
  const t = ((p1.x - p3.x) * (p3.y - p4.y) - (p1.y - p3.y) * (p3.x - p4.x)) / d;
  return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
}

function intersectionArea(a: Vec2[], b: Vec2[]): number {
  const clipped = clipPolygon(toCounterClockwise(a), toCounterClockwise(b));
  if (clipped.length < 3) return 0;
  return polygonArea(clipped);
}

function meanAndMaxCornerDistance(
  a: [Vec2, Vec2, Vec2, Vec2],
  b: [Vec2, Vec2, Vec2, Vec2]
): { mean: number; max: number } {
  let total = 0;
  let max = 0;
  for (let i = 0; i < 4; i += 1) {
    const d = Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y);
    total += d;
    if (d > max) max = d;
  }
  return { mean: total / 4, max };
}

function unavailable(reason: string): QuadAgreementResult {
  return {
    band: "unavailable",
    meanCornerDistance: null,
    maxCornerDistance: null,
    iou: null,
    areaA: null,
    areaB: null,
    areaRatio: null,
    areaAgreement: null,
    reason,
  };
}

/**
 * Compares two ordered, same-space quads. Pure; never throws. `a` is treated as
 * the reference (the original-image quad in the assist pipeline).
 */
export function compareSourceNormalizedQuads(
  a: Vec2[] | null | undefined,
  b: Vec2[] | null | undefined
): QuadAgreementResult {
  if (!isValidQuad(a)) return unavailable("Reference quad unavailable.");
  if (!isValidQuad(b)) return unavailable("Comparison quad unavailable.");

  const { mean, max } = meanAndMaxCornerDistance(a, b);
  const areaA = polygonArea(a);
  const areaB = polygonArea(b);

  if (areaA <= 0 || areaB <= 0) {
    return {
      band: "incompatible",
      meanCornerDistance: mean,
      maxCornerDistance: max,
      iou: 0,
      areaA,
      areaB,
      areaRatio: areaB > 0 ? areaA / areaB : null,
      areaAgreement: 0,
      reason: "Degenerate (zero-area) quad.",
    };
  }

  const inter = intersectionArea(a, b);
  const union = areaA + areaB - inter;
  const iou = union > 0 ? Math.max(0, Math.min(1, inter / union)) : 0;
  const areaRatio = areaA / areaB;
  const areaAgreement = Math.min(areaA, areaB) / Math.max(areaA, areaB);

  let band: QuadAgreementBand;
  let reason: string | null = null;
  if (iou < WEAK_IOU || areaAgreement < INCOMPATIBLE_AREA_AGREEMENT) {
    band = "incompatible";
    reason = "Quads overlap too little or differ greatly in area.";
  } else if (
    iou >= STRONG_IOU &&
    mean <= STRONG_MEAN_CORNER_DISTANCE &&
    max <= STRONG_MAX_CORNER_DISTANCE &&
    areaAgreement >= STRONG_AREA_AGREEMENT
  ) {
    band = "strong_agreement";
  } else if (iou >= REVIEW_IOU) {
    band = "review_agreement";
  } else {
    band = "weak_agreement";
  }

  return {
    band,
    meanCornerDistance: mean,
    maxCornerDistance: max,
    iou,
    areaA,
    areaB,
    areaRatio,
    areaAgreement,
    reason,
  };
}
