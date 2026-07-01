// --- Phase B1: Type B geometry-fact helper (pure) ---------------------------
// Pure, deterministic, READ-ONLY derivation of SOURCE-IMAGE-ONLY geometry facts
// from declared Type B evidence. See type-b-evidence-types.ts for the full
// containment scope.
//
// Guarantees (Phase B1):
//   - no mutation of inputs;
//   - no solver / FOV / calibration imports;
//   - no browser / React / UI / scene-state imports;
//   - values remain SOURCE-IMAGE geometry only (never live crop / world space);
//   - it may identify a near shared VISIBLE junction from DECLARED endpoints
//     only. It must NOT extend lines, invent an off-frame junction, or infer a
//     room corner from line intersection;
//   - it returns `null` facts wherever inputs are missing, invalid, or
//     non-finite. It never throws for malformed input.
//
// This module imports ONLY pure Type B type aliases.

import type {
  TypeBDeclaredLineEvidence,
  TypeBGeometryFacts,
  TypeBSourceFrame,
  TypeBVec2,
} from "./type-b-evidence-types";

// Shared-junction proximity tolerance, as a fraction of the SMALLER source-frame
// dimension. This is an IMAGE-ANNOTATION PROXIMITY TOLERANCE (how close two
// DECLARED endpoints must be to be read as the same visible junction), NOT a
// claim of physical truth about a room corner. Kept conservative on purpose.
export const TYPE_B_SHARED_JUNCTION_TOLERANCE_RATIO = 0.02;

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isValidFrame(
  frame: TypeBSourceFrame | null | undefined
): frame is TypeBSourceFrame {
  if (!frame) return false;
  return isFinitePositive(frame.width) && isFinitePositive(frame.height);
}

function isFiniteVec2(point: TypeBVec2 | null | undefined): point is TypeBVec2 {
  if (!point) return false;
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function lineGeometryFinite(
  line: TypeBDeclaredLineEvidence | null | undefined
): line is TypeBDeclaredLineEvidence {
  if (!line) return false;
  return isFiniteVec2(line.startNorm) && isFiniteVec2(line.endNorm);
}

// Source-pixel coordinate of a source-normalized point on a valid frame.
function toSourcePx(point: TypeBVec2, frame: TypeBSourceFrame): TypeBVec2 {
  return { x: point.x * frame.width, y: point.y * frame.height };
}

function distancePx(a: TypeBVec2, b: TypeBVec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Nearest source-frame-edge distance (source pixels) for a source-pixel point.
// The frame is the intrinsic source image, so this is stable regardless of any
// live container crop.
function minEdgeDistancePx(pointPx: TypeBVec2, frame: TypeBSourceFrame): number {
  return Math.min(
    pointPx.x,
    frame.width - pointPx.x,
    pointPx.y,
    frame.height - pointPx.y
  );
}

// Source-pixel span (arc length of the single declared segment) of a line.
function spanSourcePx(
  line: TypeBDeclaredLineEvidence,
  frame: TypeBSourceFrame
): number {
  return distancePx(toSourcePx(line.startNorm, frame), toSourcePx(line.endNorm, frame));
}

// Undirected angle in [0, 90] degrees between two line directions. Undirected so
// endpoint ordering does not change the reported separation. Returns null when
// either direction is degenerate (zero-length in source px).
function undirectedAngleDeg(
  a: TypeBDeclaredLineEvidence,
  b: TypeBDeclaredLineEvidence,
  frame: TypeBSourceFrame
): number | null {
  const aStart = toSourcePx(a.startNorm, frame);
  const aEnd = toSourcePx(a.endNorm, frame);
  const bStart = toSourcePx(b.startNorm, frame);
  const bEnd = toSourcePx(b.endNorm, frame);
  const ax = aEnd.x - aStart.x;
  const ay = aEnd.y - aStart.y;
  const bx = bEnd.x - bStart.x;
  const by = bEnd.y - bStart.y;
  const aLen = Math.hypot(ax, ay);
  const bLen = Math.hypot(bx, by);
  if (!isFinitePositive(aLen) || !isFinitePositive(bLen)) return null;
  const cos = (ax * bx + ay * by) / (aLen * bLen);
  // Clamp against floating-point drift before acos.
  const clamped = Math.max(-1, Math.min(1, cos));
  const deg = (Math.acos(clamped) * 180) / Math.PI;
  // Fold to the undirected [0, 90] separation.
  return deg > 90 ? 180 - deg : deg;
}

// Closest-endpoint distance (source px) between the two lines, using DECLARED
// endpoints only. Never an intersection, never an extension.
function closestEndpointDistancePx(
  a: TypeBDeclaredLineEvidence,
  b: TypeBDeclaredLineEvidence,
  frame: TypeBSourceFrame
): number {
  const aStart = toSourcePx(a.startNorm, frame);
  const aEnd = toSourcePx(a.endNorm, frame);
  const bStart = toSourcePx(b.startNorm, frame);
  const bEnd = toSourcePx(b.endNorm, frame);
  return Math.min(
    distancePx(aStart, bStart),
    distancePx(aStart, bEnd),
    distancePx(aEnd, bStart),
    distancePx(aEnd, bEnd)
  );
}

function emptyFacts(validSourceFrame: boolean): TypeBGeometryFacts {
  return {
    rearSpanSourcePx: null,
    sideSpanSourcePx: null,
    rearToSideSpanRatio: null,
    rearSideAngleDeg: null,
    rearAndSideNonDegenerate: null,
    rearStartDistanceToFramePx: null,
    rearEndDistanceToFramePx: null,
    sideStartDistanceToFramePx: null,
    sideEndDistanceToFramePx: null,
    sharedJunctionDistanceSourcePx: null,
    sharedJunctionPresent: null,
    validSourceFrame,
    finiteDeclaredGeometry: false,
  };
}

/**
 * Pure derivation of source-image-only Type B geometry facts from declared
 * evidence. Returns a fresh record on every call; never mutates its input.
 * Fields are `null` when the underlying inputs are missing, invalid, or
 * non-finite. This helper NEVER extends a line, invents an off-frame junction,
 * or infers a room corner from an intersection.
 */
export function deriveTypeBGeometryFacts(input: {
  sourceFrame: TypeBSourceFrame | null;
  rearSeam: TypeBDeclaredLineEvidence | null;
  strongSideSeam: TypeBDeclaredLineEvidence | null;
}): TypeBGeometryFacts {
  const frameValid = isValidFrame(input.sourceFrame);
  if (!frameValid) {
    return emptyFacts(false);
  }
  const frame: TypeBSourceFrame = {
    width: input.sourceFrame!.width,
    height: input.sourceFrame!.height,
  };

  const rear = input.rearSeam;
  const side = input.strongSideSeam;
  const rearFinite = lineGeometryFinite(rear);
  const sideFinite = lineGeometryFinite(side);

  const facts = emptyFacts(true);
  facts.finiteDeclaredGeometry = rearFinite && sideFinite;

  if (rearFinite) {
    facts.rearSpanSourcePx = spanSourcePx(rear, frame);
    facts.rearStartDistanceToFramePx = minEdgeDistancePx(
      toSourcePx(rear.startNorm, frame),
      frame
    );
    facts.rearEndDistanceToFramePx = minEdgeDistancePx(
      toSourcePx(rear.endNorm, frame),
      frame
    );
  }

  if (sideFinite) {
    facts.sideSpanSourcePx = spanSourcePx(side, frame);
    facts.sideStartDistanceToFramePx = minEdgeDistancePx(
      toSourcePx(side.startNorm, frame),
      frame
    );
    facts.sideEndDistanceToFramePx = minEdgeDistancePx(
      toSourcePx(side.endNorm, frame),
      frame
    );
  }

  if (
    facts.rearSpanSourcePx !== null &&
    facts.sideSpanSourcePx !== null &&
    facts.sideSpanSourcePx > 0
  ) {
    facts.rearToSideSpanRatio = facts.rearSpanSourcePx / facts.sideSpanSourcePx;
  }

  if (rearFinite && sideFinite) {
    facts.rearSideAngleDeg = undirectedAngleDeg(rear, side, frame);
    // Non-degenerate only when both spans are finite and non-zero AND an angle
    // could be computed. This is finite-geometry non-degeneracy ONLY; it makes
    // no physical / corner claim.
    const bothSpansPositive =
      isFinitePositive(facts.rearSpanSourcePx ?? 0) &&
      isFinitePositive(facts.sideSpanSourcePx ?? 0);
    facts.rearAndSideNonDegenerate =
      bothSpansPositive && facts.rearSideAngleDeg !== null;

    const junctionDist = closestEndpointDistancePx(rear, side, frame);
    facts.sharedJunctionDistanceSourcePx = junctionDist;
    const tolerancePx =
      TYPE_B_SHARED_JUNCTION_TOLERANCE_RATIO * Math.min(frame.width, frame.height);
    facts.sharedJunctionPresent = junctionDist <= tolerancePx;
  }

  return facts;
}
