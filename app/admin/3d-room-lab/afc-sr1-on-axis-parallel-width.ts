import { validateFloorSourcePolygonExtent } from "./floor-coordinate-extent";
import { validateOrderedFloorCorners } from "./perspective-solve";
import {
  euclideanizeFinitePoint,
  finitePointToHomogeneous,
  intersectLines,
  lineThroughPoints,
} from "./research/afc-sr1-homogeneous-geometry";
import type {
  AfcSr1Point,
  AfcSr1SourcePolygon,
} from "./research/afc-sr1-semantic-prior";
import { validateAfcSr1SourcePolygon } from "./research/afc-sr1-semantic-prior";

export const AFC_SR1_ON_AXIS_PARALLEL_WIDTH_VERSION =
  "afc-sr1-on-axis-parallel-width/v1" as const;

const EPSILON = 1e-9;

export type AfcSr1OnAxisParallelWidthResult =
  | Readonly<{
      status: "derived";
      authorityKind: "on_axis_parallel_width_derived";
      derivationVersion: typeof AFC_SR1_ON_AXIS_PARALLEL_WIDTH_VERSION;
      construction: "NL_fixed" | "NR_fixed";
      adjustableCorner: "NR" | "NL";
      constructionSeamT: number;
      sourcePolygon: AfcSr1SourcePolygon;
      correctedPolygon: AfcSr1SourcePolygon;
    }>
  | Readonly<{
      status: "rejected";
      derivationVersion: typeof AFC_SR1_ON_AXIS_PARALLEL_WIDTH_VERSION;
      reason:
        | "invalid_source_polygon"
        | "collapsed_far_width"
        | "no_legal_parallel_width_construction";
    }>;

function validPolygon(value: unknown): value is AfcSr1SourcePolygon {
  try {
    validateAfcSr1SourcePolygon(value);
  } catch {
    return false;
  }
  return (
    validateFloorSourcePolygonExtent(value).ok &&
    validateOrderedFloorCorners(value.map((point) => ({ ...point }))).ok
  );
}

function clonePolygon(polygon: AfcSr1SourcePolygon): AfcSr1SourcePolygon {
  return Object.freeze(
    polygon.map((point) => Object.freeze({ ...point })) as [
      AfcSr1Point,
      AfcSr1Point,
      AfcSr1Point,
      AfcSr1Point,
    ]
  );
}

function seamParameter(
  point: AfcSr1Point,
  near: AfcSr1Point,
  far: AfcSr1Point
): number | null {
  const dx = far.x - near.x;
  const dy = far.y - near.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!Number.isFinite(lengthSquared) || lengthSquared <= EPSILON) return null;
  const t = ((point.x - near.x) * dx + (point.y - near.y) * dy) /
    lengthSquared;
  const projected = {
    x: near.x + t * dx,
    y: near.y + t * dy,
  };
  if (
    !Number.isFinite(t) ||
    Math.hypot(projected.x - point.x, projected.y - point.y) > EPSILON
  ) {
    return null;
  }
  if (t < -EPSILON || t >= 1 - EPSILON) return null;
  return Math.abs(t) <= EPSILON ? 0 : t;
}

function parallelIntersection(
  fixedNear: AfcSr1Point,
  farLeft: AfcSr1Point,
  farRight: AfcSr1Point,
  seamNear: AfcSr1Point,
  seamFar: AfcSr1Point
): AfcSr1Point | null {
  const fixed = finitePointToHomogeneous(fixedNear);
  const directionAtInfinity = {
    x: farRight.x - farLeft.x,
    y: farRight.y - farLeft.y,
    w: 0,
  };
  const seamStart = finitePointToHomogeneous(seamNear);
  const seamEnd = finitePointToHomogeneous(seamFar);
  if (!fixed || !seamStart || !seamEnd) return null;
  const constructionLine = lineThroughPoints(fixed, directionAtInfinity);
  const seamLine = lineThroughPoints(seamStart, seamEnd);
  if (!constructionLine || !seamLine) return null;
  const intersection = intersectLines(constructionLine, seamLine);
  return intersection ? euclideanizeFinitePoint(intersection) : null;
}

function tryConstruction(
  source: AfcSr1SourcePolygon,
  construction: "NL_fixed" | "NR_fixed"
): Extract<AfcSr1OnAxisParallelWidthResult, { status: "derived" }> | null {
  const [nl, nr, fr, fl] = source;
  const nlFixed = construction === "NL_fixed";
  const fixedNear = nlFixed ? nl : nr;
  const seamNear = nlFixed ? nr : nl;
  const seamFar = nlFixed ? fr : fl;
  const intersection = parallelIntersection(
    fixedNear,
    fl,
    fr,
    seamNear,
    seamFar
  );
  if (!intersection) return null;
  const t = seamParameter(intersection, seamNear, seamFar);
  if (t === null) return null;
  const adjustedNear = t === 0 ? seamNear : intersection;

  const corrected = clonePolygon(
    (nlFixed
      ? [nl, adjustedNear, fr, fl]
      : [adjustedNear, nr, fr, fl]) as AfcSr1SourcePolygon
  );
  if (!validPolygon(corrected)) return null;

  return Object.freeze({
    status: "derived",
    authorityKind: "on_axis_parallel_width_derived",
    derivationVersion: AFC_SR1_ON_AXIS_PARALLEL_WIDTH_VERSION,
    construction,
    adjustableCorner: nlFixed ? "NR" : "NL",
    constructionSeamT: t,
    sourcePolygon: clonePolygon(source),
    correctedPolygon: corrected,
  });
}

export function deriveAfcSr1OnAxisParallelWidthFloor(
  value: unknown
): AfcSr1OnAxisParallelWidthResult {
  if (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every(
      (point) =>
        point !== null &&
        typeof point === "object" &&
        Number.isFinite((point as AfcSr1Point).x) &&
        Number.isFinite((point as AfcSr1Point).y)
    )
  ) {
    const [, , fr, fl] = value as unknown as AfcSr1SourcePolygon;
    if (Math.hypot(fr.x - fl.x, fr.y - fl.y) <= EPSILON) {
      return Object.freeze({
        status: "rejected",
        derivationVersion: AFC_SR1_ON_AXIS_PARALLEL_WIDTH_VERSION,
        reason: "collapsed_far_width",
      });
    }
  }
  if (!validPolygon(value)) {
    return Object.freeze({
      status: "rejected",
      derivationVersion: AFC_SR1_ON_AXIS_PARALLEL_WIDTH_VERSION,
      reason: "invalid_source_polygon",
    });
  }

  return (
    tryConstruction(value, "NL_fixed") ??
    tryConstruction(value, "NR_fixed") ??
    Object.freeze({
      status: "rejected" as const,
      derivationVersion: AFC_SR1_ON_AXIS_PARALLEL_WIDTH_VERSION,
      reason: "no_legal_parallel_width_construction" as const,
    })
  );
}
