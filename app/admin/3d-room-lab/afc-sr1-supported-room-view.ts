import { validateFloorSourcePolygonExtent } from "./floor-coordinate-extent";
import { validateOrderedFloorCorners } from "./perspective-solve";
import {
  AFC_SR1_HOMOGENEOUS_EPSILON,
  finitePointToHomogeneous,
  intersectLines,
  lineThroughPoints,
  normalizePointForDiagnostics,
} from "./research/afc-sr1-homogeneous-geometry";
import type {
  AfcSr1Point,
  AfcSr1SourcePolygon,
} from "./research/afc-sr1-semantic-prior";
import { validateAfcSr1SourcePolygon } from "./research/afc-sr1-semantic-prior";

export const AFC_SR1_SUPPORTED_ROOM_VIEW_CLASSIFIER_VERSION =
  "afc-sr1-supported-room-view-classifier/v2" as const;

/**
 * Provisional v2 supported-domain tolerances. These are product policy, not a
 * claim of scientific certification. In particular, `moreTruncatedSide` is an
 * empirical threshold that must be revalidated against live supported rooms.
 */
export const AFC_SR1_SUPPORTED_ROOM_VIEW_TOLERANCES_V2 = Object.freeze({
  onAxisNearDrop: 0.02,
  farWallCenterOffset: 0.1,
  moreTruncatedSide: 0.08,
});

export type AfcSr1SupportedRoomViewDimensions = Readonly<{
  decodedWidth: number;
  decodedHeight: number;
}>;

export type AfcSr1SupportedRoomViewObservables = Readonly<{
  dyNear: number;
  dyFar: number;
  farMidX: number;
  widthVanishingPointAtInfinity: boolean;
  leftVisibleRunPx: number;
  rightVisibleRunPx: number;
  truncationAsymmetry: number;
}>;

export type AfcSr1SupportedRoomPhotoClass =
  | "off_axis_left_near"
  | "off_axis_right_near"
  | "on_axis";

export type AfcSr1SupportedRoomViewResult =
  | Readonly<{
      status: "supported";
      classifierVersion: typeof AFC_SR1_SUPPORTED_ROOM_VIEW_CLASSIFIER_VERSION;
      photoClass: AfcSr1SupportedRoomPhotoClass;
      truncatedAnchor: "NL" | "NR" | null;
      observables: AfcSr1SupportedRoomViewObservables;
    }>
  | Readonly<{
      status: "unsupported";
      classifierVersion: typeof AFC_SR1_SUPPORTED_ROOM_VIEW_CLASSIFIER_VERSION;
      reason:
        | "invalid_polygon"
        | "invalid_empty_dimensions"
        | "degenerate_side_edge"
        | "ambiguous_supported_domain";
      observables: AfcSr1SupportedRoomViewObservables | null;
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

function line(first: AfcSr1Point, second: AfcSr1Point) {
  const firstH = finitePointToHomogeneous(first);
  const secondH = finitePointToHomogeneous(second);
  return firstH && secondH ? lineThroughPoints(firstH, secondH) : null;
}

function widthVanishingPointAtInfinity(
  [nl, nr, fr, fl]: AfcSr1SourcePolygon
): boolean {
  const nearWidth = line(nl, nr);
  const farWidth = line(fl, fr);
  if (!nearWidth || !farWidth) return false;
  const intersection = intersectLines(nearWidth, farWidth);
  const normalized = intersection
    ? normalizePointForDiagnostics(intersection)
    : null;
  return (
    normalized !== null &&
    Math.abs(normalized.w) <= AFC_SR1_HOMOGENEOUS_EPSILON
  );
}

function validDimensions(
  dimensions: AfcSr1SupportedRoomViewDimensions
): boolean {
  return (
    Number.isFinite(dimensions.decodedWidth) &&
    dimensions.decodedWidth > 0 &&
    Number.isFinite(dimensions.decodedHeight) &&
    dimensions.decodedHeight > 0
  );
}

function pixelLength(
  first: AfcSr1Point,
  second: AfcSr1Point,
  dimensions: AfcSr1SupportedRoomViewDimensions
): number {
  return Math.hypot(
    (second.x - first.x) * dimensions.decodedWidth,
    (second.y - first.y) * dimensions.decodedHeight
  );
}

export function classifyAfcSr1SupportedRoomView(
  value: unknown,
  dimensions: AfcSr1SupportedRoomViewDimensions
): AfcSr1SupportedRoomViewResult {
  if (!validPolygon(value)) {
    return Object.freeze({
      status: "unsupported",
      classifierVersion: AFC_SR1_SUPPORTED_ROOM_VIEW_CLASSIFIER_VERSION,
      reason: "invalid_polygon",
      observables: null,
    });
  }
  if (!validDimensions(dimensions)) {
    return Object.freeze({
      status: "unsupported",
      classifierVersion: AFC_SR1_SUPPORTED_ROOM_VIEW_CLASSIFIER_VERSION,
      reason: "invalid_empty_dimensions",
      observables: null,
    });
  }

  const [nl, nr, fr, fl] = value;
  const dyNear = nl.y - nr.y;
  const dyFar = fl.y - fr.y;
  const farMidX = (fl.x + fr.x) / 2;
  const atInfinity = widthVanishingPointAtInfinity(value);
  const leftVisibleRunPx = pixelLength(nl, fl, dimensions);
  const rightVisibleRunPx = pixelLength(nr, fr, dimensions);
  if (
    !Number.isFinite(leftVisibleRunPx) ||
    !Number.isFinite(rightVisibleRunPx) ||
    leftVisibleRunPx <= 0 ||
    rightVisibleRunPx <= 0
  ) {
    return Object.freeze({
      status: "unsupported",
      classifierVersion: AFC_SR1_SUPPORTED_ROOM_VIEW_CLASSIFIER_VERSION,
      reason: "degenerate_side_edge",
      observables: null,
    });
  }
  const truncationAsymmetry = Math.abs(leftVisibleRunPx - rightVisibleRunPx) /
    Math.max(leftVisibleRunPx, rightVisibleRunPx);
  const observables = Object.freeze({
    dyNear,
    dyFar,
    farMidX,
    widthVanishingPointAtInfinity: atInfinity,
    leftVisibleRunPx,
    rightVisibleRunPx,
    truncationAsymmetry,
  });
  const tolerances = AFC_SR1_SUPPORTED_ROOM_VIEW_TOLERANCES_V2;

  // Geometry establishes true parallelism before framing/crop observables can
  // select an off-axis anchor.
  if (atInfinity) {
    return Object.freeze({
      status: "supported",
      classifierVersion: AFC_SR1_SUPPORTED_ROOM_VIEW_CLASSIFIER_VERSION,
      photoClass: "on_axis",
      truncatedAnchor: null,
      observables,
    });
  }
  if (
    Math.abs(dyNear) <= tolerances.onAxisNearDrop &&
    Math.abs(dyFar) <= tolerances.onAxisNearDrop &&
    Math.abs(farMidX - 0.5) <= tolerances.farWallCenterOffset
  ) {
    return Object.freeze({
      status: "supported",
      classifierVersion: AFC_SR1_SUPPORTED_ROOM_VIEW_CLASSIFIER_VERSION,
      photoClass: "on_axis",
      truncatedAnchor: null,
      observables,
    });
  }

  if (truncationAsymmetry < tolerances.moreTruncatedSide) {
    return Object.freeze({
      status: "unsupported",
      classifierVersion: AFC_SR1_SUPPORTED_ROOM_VIEW_CLASSIFIER_VERSION,
      reason: "ambiguous_supported_domain",
      observables,
    });
  }

  if (leftVisibleRunPx < rightVisibleRunPx) {
    return Object.freeze({
      status: "supported",
      classifierVersion: AFC_SR1_SUPPORTED_ROOM_VIEW_CLASSIFIER_VERSION,
      photoClass: "off_axis_left_near",
      truncatedAnchor: "NL",
      observables,
    });
  }

  if (rightVisibleRunPx < leftVisibleRunPx) {
    return Object.freeze({
      status: "supported",
      classifierVersion: AFC_SR1_SUPPORTED_ROOM_VIEW_CLASSIFIER_VERSION,
      photoClass: "off_axis_right_near",
      truncatedAnchor: "NR",
      observables,
    });
  }

  return Object.freeze({
    status: "unsupported",
    classifierVersion: AFC_SR1_SUPPORTED_ROOM_VIEW_CLASSIFIER_VERSION,
    reason: "ambiguous_supported_domain",
    observables,
  });
}
