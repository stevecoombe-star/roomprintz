/**
 * AFC-SR1 Track 1a: provider-neutral, source-normalized cross-room evidence
 * projected onto an already-certified canonical SR1 seam.
 *
 * This module produces advisory geometry only. It has no Floor or Camera
 * acceptance or mutation authority.
 */
import {
  AFC_SR1_COORDINATE_SPACE,
  deriveAfcSr1CanonicalNearToFarSeams,
  projectPointOntoAfcSr1NearToFarSeam,
  validateAfcSr1SourcePolygon,
  type AfcSr1AdjustableCorner,
  type AfcSr1CanonicalNearToFarSeamV1,
  type AfcSr1Point,
  type AfcSr1SourcePolygon,
} from "./afc-sr1-semantic-prior";
import { validateFloorSourcePointExtent } from "../floor-coordinate-extent";

export const AFC_SR1_CROSS_ROOM_LINE_EVIDENCE_VERSION =
  "afc-sr1-cross-room-line-evidence/v1" as const;
export const AFC_SR1_CROSS_ROOM_PRIOR_VERSION =
  "afc-sr1-cross-room-prior/v1" as const;

/**
 * Both thresholds are source-basis normalized distances. They deliberately
 * admit small annotation/adapter noise while rejecting observations that no
 * longer describe the declared corner or legal seam. Track 1b may tune them
 * against real adapter evidence, but must version any changed policy.
 */
export const AFC_SR1_CROSS_ROOM_ANCHOR_DISTANCE_TOLERANCE_SOURCE_NORM = 0.1;
export const AFC_SR1_CROSS_ROOM_MAX_PROJECTION_RESIDUAL_SOURCE_NORM = 0.1;

export type AfcSr1CrossRoomTruncatedAnchorV1 = "NL" | "NR";
export type AfcSr1CrossRoomCanonicalSeamIdV1 = "NL_to_FL" | "NR_to_FR";

/**
 * A later adapter owns acquisition and normalization of this observation.
 * Its output remains raw external evidence until it has passed this module's
 * semantic and seam-projection gates.
 */
export type AfcSr1CrossRoomLineEvidenceV1 = Readonly<{
  schemaVersion: typeof AFC_SR1_CROSS_ROOM_LINE_EVIDENCE_VERSION;
  coordinateSpace: typeof AFC_SR1_COORDINATE_SPACE;
  truncatedAnchor: AfcSr1CrossRoomTruncatedAnchorV1;
  anchorEndpoint: AfcSr1Point;
  oppositeEndpoint: AfcSr1Point;
}>;

export type AfcSr1ValidatedCrossRoomLineEvidenceV1 =
  AfcSr1CrossRoomLineEvidenceV1;

export type AfcSr1CrossRoomEvidenceRejectReasonV1 =
  | "evidence_shape_invalid"
  | "evidence_schema_version_invalid"
  | "evidence_coordinate_space_invalid"
  | "truncated_anchor_invalid"
  | "anchor_endpoint_shape_invalid"
  | "opposite_endpoint_shape_invalid"
  | "anchor_endpoint_extent_invalid"
  | "opposite_endpoint_extent_invalid"
  | "evidence_line_collapsed";

export type AfcSr1CrossRoomPriorRejectReasonV1 =
  | "prior_input_shape_invalid"
  | "source_polygon_invalid"
  | AfcSr1CrossRoomEvidenceRejectReasonV1
  | "anchor_endpoint_inconsistent"
  | "projection_failed"
  | "opposite_endpoint_off_legal_seam"
  | "projected_seam_t_outside_domain";

export type AfcSr1CrossRoomEvidenceValidationV1 =
  | Readonly<{
      status: "valid";
      evidence: AfcSr1ValidatedCrossRoomLineEvidenceV1;
    }>
  | Readonly<{
      status: "rejected";
      reason: AfcSr1CrossRoomEvidenceRejectReasonV1;
    }>;

export type AfcSr1CrossRoomPriorInputV1 = Readonly<{
  sourcePolygon: AfcSr1SourcePolygon;
  evidence: AfcSr1CrossRoomLineEvidenceV1;
}>;

export type AfcSr1CrossRoomUsablePriorV1 = Readonly<{
  schemaVersion: typeof AFC_SR1_CROSS_ROOM_PRIOR_VERSION;
  authority: "advisory_only";
  status: "usable";
  truncatedAnchor: AfcSr1CrossRoomTruncatedAnchorV1;
  adjustableCorner: AfcSr1AdjustableCorner;
  canonicalSeamId: AfcSr1CrossRoomCanonicalSeamIdV1;
  legalSeam: AfcSr1CanonicalNearToFarSeamV1;
  seamT: number;
  projectedPoint: AfcSr1Point;
  projectionResidualSourceNorm: number;
}>;

export type AfcSr1CrossRoomRejectedPriorV1 = Readonly<{
  schemaVersion: typeof AFC_SR1_CROSS_ROOM_PRIOR_VERSION;
  authority: "advisory_only";
  status: "rejected";
  reason: AfcSr1CrossRoomPriorRejectReasonV1;
}>;

export type AfcSr1CrossRoomPriorResultV1 =
  | AfcSr1CrossRoomUsablePriorV1
  | AfcSr1CrossRoomRejectedPriorV1;

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

function isPointShape(value: unknown): value is AfcSr1Point {
  return isPlainRecord(value) && hasExactKeys(value, ["x", "y"]);
}

function freezePoint(point: AfcSr1Point): AfcSr1Point {
  return Object.freeze({ x: point.x, y: point.y });
}

function rejectedEvidence(
  reason: AfcSr1CrossRoomEvidenceRejectReasonV1
): AfcSr1CrossRoomEvidenceValidationV1 {
  return Object.freeze({ status: "rejected" as const, reason });
}

function rejectedPrior(reason: AfcSr1CrossRoomPriorRejectReasonV1): AfcSr1CrossRoomRejectedPriorV1 {
  return Object.freeze({
    schemaVersion: AFC_SR1_CROSS_ROOM_PRIOR_VERSION,
    authority: "advisory_only" as const,
    status: "rejected" as const,
    reason,
  });
}

/**
 * The cross-room truncated anchor is distinct from the corner that may be
 * adjusted. This explicit semantic mapping prevents P0 decision terminology
 * from being reused as cross-room evidence terminology.
 */
export function deriveAfcSr1AdjustableCornerFromTruncatedAnchor(
  truncatedAnchor: AfcSr1CrossRoomTruncatedAnchorV1
): AfcSr1AdjustableCorner {
  return truncatedAnchor === "NL" ? "NR" : "NL";
}

export function validateAfcSr1CrossRoomLineEvidence(
  value: unknown
): AfcSr1CrossRoomEvidenceValidationV1 {
  const keys = [
    "schemaVersion", "coordinateSpace", "truncatedAnchor", "anchorEndpoint", "oppositeEndpoint",
  ];
  if (!isPlainRecord(value) || !hasExactKeys(value, keys)) return rejectedEvidence("evidence_shape_invalid");
  if (value.schemaVersion !== AFC_SR1_CROSS_ROOM_LINE_EVIDENCE_VERSION) {
    return rejectedEvidence("evidence_schema_version_invalid");
  }
  if (value.coordinateSpace !== AFC_SR1_COORDINATE_SPACE) {
    return rejectedEvidence("evidence_coordinate_space_invalid");
  }
  if (value.truncatedAnchor !== "NL" && value.truncatedAnchor !== "NR") {
    return rejectedEvidence("truncated_anchor_invalid");
  }
  if (!isPointShape(value.anchorEndpoint)) return rejectedEvidence("anchor_endpoint_shape_invalid");
  if (!isPointShape(value.oppositeEndpoint)) return rejectedEvidence("opposite_endpoint_shape_invalid");
  if (!validateFloorSourcePointExtent(value.anchorEndpoint).ok) {
    return rejectedEvidence("anchor_endpoint_extent_invalid");
  }
  if (!validateFloorSourcePointExtent(value.oppositeEndpoint).ok) {
    return rejectedEvidence("opposite_endpoint_extent_invalid");
  }
  if (value.anchorEndpoint.x === value.oppositeEndpoint.x &&
      value.anchorEndpoint.y === value.oppositeEndpoint.y) {
    return rejectedEvidence("evidence_line_collapsed");
  }
  return Object.freeze({
    status: "valid" as const,
    evidence: Object.freeze({
      schemaVersion: AFC_SR1_CROSS_ROOM_LINE_EVIDENCE_VERSION,
      coordinateSpace: AFC_SR1_COORDINATE_SPACE,
      truncatedAnchor: value.truncatedAnchor,
      anchorEndpoint: freezePoint(value.anchorEndpoint),
      oppositeEndpoint: freezePoint(value.oppositeEndpoint),
    }),
  });
}

function cornerForTruncatedAnchor(
  polygon: AfcSr1SourcePolygon,
  truncatedAnchor: AfcSr1CrossRoomTruncatedAnchorV1
): AfcSr1Point {
  return truncatedAnchor === "NL" ? polygon[0] : polygon[1];
}

function canonicalSeamId(
  adjustableCorner: AfcSr1AdjustableCorner
): AfcSr1CrossRoomCanonicalSeamIdV1 {
  return adjustableCorner === "NL" ? "NL_to_FL" : "NR_to_FR";
}

/**
 * Projects validated raw evidence onto the legal near-to-far seam. The result
 * is a usable advisory prior or an explicit rejection; it never accepts or
 * mutates Floor or Camera geometry.
 */
export function deriveAfcSr1CrossRoomPrior(value: unknown): AfcSr1CrossRoomPriorResultV1 {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["sourcePolygon", "evidence"])) {
    return rejectedPrior("prior_input_shape_invalid");
  }

  try {
    validateAfcSr1SourcePolygon(value.sourcePolygon);
  } catch {
    return rejectedPrior("source_polygon_invalid");
  }
  const sourcePolygon = value.sourcePolygon;
  const evidenceValidation = validateAfcSr1CrossRoomLineEvidence(value.evidence);
  if (evidenceValidation.status === "rejected") return rejectedPrior(evidenceValidation.reason);
  const evidence = evidenceValidation.evidence;

  const anchorCorner = cornerForTruncatedAnchor(sourcePolygon, evidence.truncatedAnchor);
  const anchorDistance = Math.hypot(
    evidence.anchorEndpoint.x - anchorCorner.x,
    evidence.anchorEndpoint.y - anchorCorner.y
  );
  if (anchorDistance > AFC_SR1_CROSS_ROOM_ANCHOR_DISTANCE_TOLERANCE_SOURCE_NORM) {
    return rejectedPrior("anchor_endpoint_inconsistent");
  }

  const adjustableCorner = deriveAfcSr1AdjustableCornerFromTruncatedAnchor(evidence.truncatedAnchor);
  const legalSeam = deriveAfcSr1CanonicalNearToFarSeams(sourcePolygon)[adjustableCorner];
  let projection: ReturnType<typeof projectPointOntoAfcSr1NearToFarSeam>;
  try {
    projection = projectPointOntoAfcSr1NearToFarSeam(legalSeam, evidence.oppositeEndpoint);
  } catch {
    return rejectedPrior("projection_failed");
  }
  if (projection.perpendicularErrorSourceNorm > AFC_SR1_CROSS_ROOM_MAX_PROJECTION_RESIDUAL_SOURCE_NORM) {
    return rejectedPrior("opposite_endpoint_off_legal_seam");
  }
  if (projection.seamT <= 0 || projection.seamT >= 1) {
    return rejectedPrior("projected_seam_t_outside_domain");
  }

  return Object.freeze({
    schemaVersion: AFC_SR1_CROSS_ROOM_PRIOR_VERSION,
    authority: "advisory_only" as const,
    status: "usable" as const,
    truncatedAnchor: evidence.truncatedAnchor,
    adjustableCorner,
    canonicalSeamId: canonicalSeamId(adjustableCorner),
    legalSeam,
    seamT: projection.seamT,
    projectedPoint: projection.point,
    projectionResidualSourceNorm: projection.perpendicularErrorSourceNorm,
  });
}
