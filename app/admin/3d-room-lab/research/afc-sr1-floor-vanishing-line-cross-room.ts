/**
 * AFC-SR1 TR0: pure projective bridge from a deterministic floor vanishing
 * line to existing Track 1a cross-room evidence.
 *
 * This module deliberately owns neither image reading nor seamT acceptance.
 */
import {
  AFC_SR1_CROSS_ROOM_LINE_EVIDENCE_VERSION,
  deriveAfcSr1AdjustableCornerFromTruncatedAnchor,
  deriveAfcSr1CrossRoomPrior,
  type AfcSr1CrossRoomLineEvidenceV1,
  type AfcSr1CrossRoomPriorResultV1,
  type AfcSr1CrossRoomTruncatedAnchorV1,
  type AfcSr1CrossRoomUsablePriorV1,
} from "./afc-sr1-cross-room-prior";
import {
  AFC_SR1_COORDINATE_SPACE,
  deriveAfcSr1CanonicalNearToFarSeams,
  validateAfcSr1SourcePolygon,
  type AfcSr1Point,
  type AfcSr1SourcePolygon,
} from "./afc-sr1-semantic-prior";
import {
  euclideanizeFinitePoint,
  finitePointToHomogeneous,
  intersectLines,
  isFiniteHomogeneousPoint,
  lineThroughPoints,
  normalizeCanonicalLine,
  type EuclideanPoint2,
  type HomogeneousLine2,
  type HomogeneousPoint2,
} from "./afc-sr1-homogeneous-geometry";

export type AfcSr1AnalysisImageV1 = Readonly<{
  decodedWidth: number;
  decodedHeight: number;
}>;

export type AfcSr1PixelLineV1 = Readonly<{
  a: number;
  b: number;
  c: number;
}>;

export type AfcSr1FloorVanishingLineCrossRoomInputV1 = Readonly<{
  analysisImage: AfcSr1AnalysisImageV1;
  floorVanishingLinePixel: AfcSr1PixelLineV1;
  sourcePolygon: AfcSr1SourcePolygon;
  truncatedAnchor: AfcSr1CrossRoomTruncatedAnchorV1;
}>;

export type AfcSr1FloorVanishingLineCrossRoomRejectReasonV1 =
  | "invalid_input"
  | "invalid_analysis_image"
  | "invalid_floor_vanishing_line"
  | "invalid_source_polygon"
  | "degenerate_far_width_line"
  | "degenerate_width_vanishing_point"
  | "degenerate_cross_room_line"
  | "invalid_opposite_intersection"
  | "non_finite_opposite_endpoint"
  | "track1a_rejected";

export type AfcSr1WidthVanishingPointV1 = Readonly<{
  homogeneous: HomogeneousPoint2;
  finite: boolean;
}>;

export type AfcSr1FloorVanishingLineCrossRoomUsableV1 = Readonly<{
  status: "usable";
  floorVanishingLineSourceNorm: HomogeneousLine2;
  farWidthLine: HomogeneousLine2;
  widthVanishingPoint: AfcSr1WidthVanishingPointV1;
  crossRoomLine: HomogeneousLine2;
  oppositeEndpoint: EuclideanPoint2;
  crossRoomEvidence: AfcSr1CrossRoomLineEvidenceV1;
  prior: AfcSr1CrossRoomUsablePriorV1;
}>;

export type AfcSr1FloorVanishingLineCrossRoomRejectedV1 = Readonly<{
  status: "rejected";
  reason: AfcSr1FloorVanishingLineCrossRoomRejectReasonV1;
  prior?: AfcSr1CrossRoomPriorResultV1;
}>;

export type AfcSr1FloorVanishingLineCrossRoomResultV1 =
  | AfcSr1FloorVanishingLineCrossRoomUsableV1
  | AfcSr1FloorVanishingLineCrossRoomRejectedV1;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validAnalysisImage(value: unknown): value is AfcSr1AnalysisImageV1 {
  return isPlainRecord(value) &&
    hasExactKeys(value, ["decodedWidth", "decodedHeight"]) &&
    typeof value.decodedWidth === "number" &&
    Number.isInteger(value.decodedWidth) && value.decodedWidth > 0 &&
    typeof value.decodedHeight === "number" &&
    Number.isInteger(value.decodedHeight) && value.decodedHeight > 0;
}

function validPixelLineShape(value: unknown): value is AfcSr1PixelLineV1 {
  return isPlainRecord(value) && hasExactKeys(value, ["a", "b", "c"]) &&
    typeof value.a === "number" && typeof value.b === "number" && typeof value.c === "number";
}

function rejected(
  reason: AfcSr1FloorVanishingLineCrossRoomRejectReasonV1,
  prior?: AfcSr1CrossRoomPriorResultV1
): AfcSr1FloorVanishingLineCrossRoomRejectedV1 {
  return Object.freeze(prior === undefined
    ? { status: "rejected" as const, reason }
    : { status: "rejected" as const, reason, prior });
}

function freezeSourcePoint(point: AfcSr1Point): EuclideanPoint2 {
  return Object.freeze({ x: point.x, y: point.y });
}

/**
 * Converts an image-pixel line to source-normalized coordinates.
 *
 * image-space.ts defines p_source = diag(1/W, 1/H, 1) p_pixel.  The dual
 * transform is therefore l_source = diag(W, H, 1) l_pixel, canonicalized
 * afterwards because homogeneous line scale is immaterial.
 */
export function convertAfcSr1PixelLineToSourceNormalized(
  image: AfcSr1AnalysisImageV1,
  line: AfcSr1PixelLineV1
): HomogeneousLine2 | null {
  if (!validAnalysisImage(image) || !validPixelLineShape(line)) return null;
  return normalizeCanonicalLine({
    a: line.a * image.decodedWidth,
    b: line.b * image.decodedHeight,
    c: line.c,
  });
}

/**
 * Builds legal cross-room evidence from a source polygon plus a floor
 * vanishing line. Track 1a remains the sole seamT authority.
 */
export function deriveAfcSr1FloorVanishingLineCrossRoom(
  value: unknown
): AfcSr1FloorVanishingLineCrossRoomResultV1 {
  if (!isPlainRecord(value) ||
      !hasExactKeys(value, ["analysisImage", "floorVanishingLinePixel", "sourcePolygon", "truncatedAnchor"])) {
    return rejected("invalid_input");
  }
  if (!validAnalysisImage(value.analysisImage)) return rejected("invalid_analysis_image");
  if (!validPixelLineShape(value.floorVanishingLinePixel)) return rejected("invalid_floor_vanishing_line");
  if (value.truncatedAnchor !== "NL" && value.truncatedAnchor !== "NR") return rejected("invalid_input");

  try {
    validateAfcSr1SourcePolygon(value.sourcePolygon);
  } catch {
    return rejected("invalid_source_polygon");
  }
  const sourcePolygon = value.sourcePolygon;
  const floorVanishingLineSourceNorm = convertAfcSr1PixelLineToSourceNormalized(
    value.analysisImage,
    value.floorVanishingLinePixel
  );
  if (!floorVanishingLineSourceNorm) return rejected("invalid_floor_vanishing_line");

  const farLeft = finitePointToHomogeneous(sourcePolygon[3]);
  const farRight = finitePointToHomogeneous(sourcePolygon[2]);
  const farWidthLine = farLeft && farRight ? lineThroughPoints(farLeft, farRight) : null;
  if (!farWidthLine) return rejected("degenerate_far_width_line");

  const widthVanishingPoint = intersectLines(farWidthLine, floorVanishingLineSourceNorm);
  if (!widthVanishingPoint) return rejected("degenerate_width_vanishing_point");

  const anchorIndex = value.truncatedAnchor === "NL" ? 0 : 1;
  const anchorEndpoint = freezeSourcePoint(sourcePolygon[anchorIndex]);
  const anchorPoint = finitePointToHomogeneous(anchorEndpoint);
  const crossRoomLine = anchorPoint ? lineThroughPoints(anchorPoint, widthVanishingPoint) : null;
  if (!crossRoomLine) return rejected("degenerate_cross_room_line");

  const adjustableCorner = deriveAfcSr1AdjustableCornerFromTruncatedAnchor(value.truncatedAnchor);
  const legalSeam = deriveAfcSr1CanonicalNearToFarSeams(sourcePolygon)[adjustableCorner];
  const seamStart = finitePointToHomogeneous(legalSeam.seamStartNear);
  const seamEnd = finitePointToHomogeneous(legalSeam.seamEndFar);
  const oppositeSeamLine = seamStart && seamEnd ? lineThroughPoints(seamStart, seamEnd) : null;
  if (!oppositeSeamLine) return rejected("invalid_opposite_intersection");

  const oppositeIntersection = intersectLines(crossRoomLine, oppositeSeamLine);
  if (!oppositeIntersection) return rejected("invalid_opposite_intersection");
  if (!isFiniteHomogeneousPoint(oppositeIntersection)) return rejected("non_finite_opposite_endpoint");
  const oppositeEndpoint = euclideanizeFinitePoint(oppositeIntersection);
  if (!oppositeEndpoint) return rejected("non_finite_opposite_endpoint");

  const crossRoomEvidence = Object.freeze({
    schemaVersion: AFC_SR1_CROSS_ROOM_LINE_EVIDENCE_VERSION,
    coordinateSpace: AFC_SR1_COORDINATE_SPACE,
    truncatedAnchor: value.truncatedAnchor,
    anchorEndpoint,
    oppositeEndpoint,
  });
  const prior = deriveAfcSr1CrossRoomPrior({ sourcePolygon, evidence: crossRoomEvidence });
  if (prior.status === "rejected") return rejected("track1a_rejected", prior);

  return Object.freeze({
    status: "usable" as const,
    floorVanishingLineSourceNorm,
    farWidthLine,
    widthVanishingPoint: Object.freeze({
      homogeneous: widthVanishingPoint,
      finite: isFiniteHomogeneousPoint(widthVanishingPoint),
    }),
    crossRoomLine,
    oppositeEndpoint,
    crossRoomEvidence,
    prior,
  });
}
