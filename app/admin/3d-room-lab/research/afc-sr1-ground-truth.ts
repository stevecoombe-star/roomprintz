import { validateOrderedFloorCorners } from "../perspective-solve";
import {
  validateFloorSourcePointExtent,
  validateFloorSourcePolygonExtent,
} from "../floor-coordinate-extent";
import { canonicalStringify, sha256Hex, type Json } from "@/lib/sceneHash";
import { getCoverCrop } from "../image-space";
import { evaluateRatioFovCell } from "./ratio-fov-harness";
import { createHash } from "crypto";

export type GroundTruthProvenance =
  | "repository_fixture"
  | "repository_test"
  | "receipt_replay"
  | "scene_state_export"
  | "live_ui_diagnostics"
  | "manual_observation"
  | "user_recollection"
  | "derived_from_recorded_values"
  | "unknown";

export type Point = Readonly<{ x: number; y: number }>;
export type FloorPolygon = readonly [Point, Point, Point, Point];

export type AfcSr1RawToOriginalPlacementV1 =
  | Readonly<{ status: "not_projected" }>
  | Readonly<{
      status: "same_basis";
      method:
        | "receipt_already_on_original_basis"
        | "documented_source_normalized_transfer"
        | "explicit_projected_capture";
      originalBasisFingerprint: string;
      sourcePolygonFingerprint: string;
      provenance: GroundTruthProvenance;
      evidenceReference: string;
    }>;

export type AfcSr1UncertifiedReceiptSeamEvidenceV1 =
  | Readonly<{ status: "none" }>
  | Readonly<{
      status: "cross_basis_unprojected";
      usableAsGroundTruth: false;
      projectedToImageBasis: false;
      side: "left" | "right";
      adjustableCorner: "NL" | "NR";
      direction: "near_to_far";
      emptyBasisFingerprint: string;
      emptyDecodedWidth: number;
      emptyDecodedHeight: number;
      originalBasisFingerprint: string;
      originalDecodedWidth: number;
      originalDecodedHeight: number;
      seamStartOnEmptyBasis: Point;
      seamEndOnEmptyBasis: Point;
      acceptedCornerOnOriginalBasis: Point;
      unprojectedReceiptSeamT: number;
      perpendicularErrorSourceNormResearchOnly: number;
      toleranceSourceNormResearchOnly: number;
      collinearWithinResearchTolerance: boolean;
      provenance: GroundTruthProvenance;
      notes: readonly string[];
    }>;

export type AfcSr1CameraApplyEvidenceV1 = Readonly<{
  status:
    | "not_applied"
    | "ordinary_calibrated_camera_applied"
    | "afc_bound_cp2b_applied";
  provenance: readonly GroundTruthProvenance[];
  notes: readonly string[];
}>;

export type AfcSr1AuthorityPathStatus =
  | "not_tested"
  | "not_yet_exercisable"
  | "ordinary_only"
  | "cp2b_applied";

export type AfcSr1CameraDiagnosticsContextV1 = Readonly<{
  intrinsicWidth: number;
  intrinsicHeight: number;
  frameWidth: number;
  frameHeight: number;
  sourceToFramePolicy: "cover_crop";
  derivationVersion: "ratio-fov-harness/v1";
  provenance: GroundTruthProvenance;
}>;

export type AfcSr1DerivedCameraDiagnostics = Readonly<{
  frameFloorPolygonPx: FloorPolygon;
  cvAveragePx: number;
  cvMaximumPx: number;
  displayAveragePx: number;
  displayMaximumPx: number;
  scaleRatio: number;
}>;

export type AfcSr1GroundTruthFixtureV1 = Readonly<{
  schemaVersion: "afc-sr1-ground-truth/v1";
  roomId: "room-a" | "room-b" | "room-c";
  photoClass: Readonly<{
    classification: "supported_full_back_wall" | "unsupported" | "unknown";
    provenance: GroundTruthProvenance;
    notes: readonly string[];
  }>;
  imageBasis: Readonly<{
    fingerprint: string | null;
    decodedWidth: number | null;
    decodedHeight: number | null;
    orientation: 1 | null;
    provenance: GroundTruthProvenance;
  }>;
  rawFloor: Readonly<{
    polygon: FloorPolygon | null;
    source: "empty_receipt" | "test_fixture" | "scene_export" | "unknown";
    receiptFileName: string | null;
    receiptSha256: string | null;
    requestId: string | null;
    r3bCandidateId: string | null;
    r3cCandidateId: string | null;
    sourceBasisFingerprint: string | null;
    sourceDecodedWidth: number | null;
    sourceDecodedHeight: number | null;
    sourceOrientation: 1 | null;
    projectedToImageBasis: boolean | null;
    provenance: GroundTruthProvenance;
    notes: readonly string[];
  }>;
  rawToOriginalPlacement: AfcSr1RawToOriginalPlacementV1;
  acceptedFloor: Readonly<{
    polygon: FloorPolygon | null;
    source: "manual_calibration" | "control_fixture" | "scene_export" | "unknown";
    provenance: GroundTruthProvenance;
  }>;
  seamRefinement: Readonly<{
    adjustableCorner: "NL" | "NR" | "none" | "unknown";
    side: "left" | "right" | "none" | "unknown";
    direction: "near_to_far" | null;
    seamStart: Point | null;
    seamEnd: Point | null;
    rawCorner: Point | null;
    acceptedCorner: Point | null;
    seamT: number | null;
    perpendicularErrorSourceNormResearchOnly: number | null;
    collinearWithinTolerance: boolean | null;
    toleranceSourceNormResearchOnly: number | null;
    provenance: GroundTruthProvenance;
    notes: readonly string[];
  }>;
  uncertifiedReceiptSeamEvidence: AfcSr1UncertifiedReceiptSeamEvidenceV1;
  afcAuthorityPathStatus: AfcSr1AuthorityPathStatus;
  calibration: Readonly<{
    worldWidthMeters: number | null;
    worldDepthMeters: number | null;
    widthDepthRatio: number | null;
    depthWidthAspect: number | null;
    verticalFovDeg: number | null;
    dimensionsTruth: "accepted_calibration_values" | "physical_measurement" | "synthetic_test_values" | "unknown";
    cvAveragePx: number | null;
    cvMaximumPx: number | null;
    displayAveragePx: number | null;
    displayMaximumPx: number | null;
    scaleRatio: number | null;
    scaleRatioProvenance: GroundTruthProvenance | null;
    cameraDiagnosticsContext: AfcSr1CameraDiagnosticsContextV1 | null;
    cameraApplySafe: boolean | null;
    cameraAppliedSuccessfully: boolean | null;
    cameraApplyEvidence: AfcSr1CameraApplyEvidenceV1;
    provenance: GroundTruthProvenance;
  }>;
  manualProcess: Readonly<{
    widthFovIterationCount: number | null;
    visuallyAccepted: boolean | null;
    notes: readonly string[];
    provenance: GroundTruthProvenance;
  }>;
  completeness: Readonly<{
    status: "certified" | "partial" | "requires_recapture";
    missingFields: readonly string[];
  }>;
}>;

export type GroundTruthFixtureParseResult =
  | Readonly<{ ok: true; value: AfcSr1GroundTruthFixtureV1 }>
  | Readonly<{ ok: false; reason: string }>;

export type SeamProjection = Readonly<{
  t: number;
  point: Point;
  /**
   * Isotropic distance in source-normalized x/y space. This is not a uniform
   * intrinsic-pixel distance on non-square images and is research-only.
   */
  perpendicularErrorSourceNorm: number;
}>;

const PROVENANCE = new Set<GroundTruthProvenance>([
  "repository_fixture",
  "repository_test",
  "receipt_replay",
  "scene_state_export",
  "live_ui_diagnostics",
  "manual_observation",
  "user_recollection",
  "derived_from_recorded_values",
  "unknown",
]);

const EPSILON = 1e-12;
const DERIVATION_TOLERANCE = 1e-9;
export const RECORDED_CAMERA_SCALE_RATIO_TOLERANCE = 1e-12;
export const RECORDED_CAMERA_REPROJECTION_TOLERANCE_PX = 0.01;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

function isNullableText(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length > 0);
}

function hasNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(item => typeof item === "string");
}

function isProvenance(value: unknown): value is GroundTruthProvenance {
  return typeof value === "string" && PROVENANCE.has(value as GroundTruthProvenance);
}

function isPoint(value: unknown): value is Point {
  return isRecord(value) && hasExactKeys(value, ["x", "y"]) && isFiniteNumber(value.x) && isFiniteNumber(value.y);
}

function isSourcePoint(value: unknown): value is Point {
  return isPoint(value) && validateFloorSourcePointExtent(value).ok;
}

function isNullablePoint(value: unknown): value is Point | null {
  return value === null || isSourcePoint(value);
}

function isFloorPolygon(value: unknown): value is FloorPolygon {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(isPoint)) return false;
  if (!validateFloorSourcePolygonExtent(value).ok) return false;
  if (!validateOrderedFloorCorners(value.map(point => ({ x: point.x, y: point.y }))).ok) return false;
  const [nearLeft, nearRight, farRight, farLeft] = value;
  // This is semantic validation, never a screen-space reordering operation.
  // Room C demonstrates why individual NR/FL y ordering cannot be required.
  return (
    (nearLeft.y + nearRight.y) / 2 > (farRight.y + farLeft.y) / 2 &&
    nearLeft.x < nearRight.x &&
    farLeft.x < farRight.x
  );
}

function isNullableFloorPolygon(value: unknown): value is FloorPolygon | null {
  return value === null || isFloorPolygon(value);
}

/**
 * Stable SHA-256 over the canonical JSON representation of the semantic
 * `[NL, NR, FR, FL]` source-normalized polygon. This is evidence identity,
 * not a geometry transform or authority key.
 */
export async function fingerprintSourceNormalizedPolygon(
  polygon: FloorPolygon
): Promise<string | null> {
  if (!isFloorPolygon(polygon)) return null;
  return sha256Hex(canonicalStringify(polygon as unknown as Json));
}

function fingerprintSourceNormalizedPolygonSync(polygon: FloorPolygon): string | null {
  if (!isFloorPolygon(polygon)) return null;
  return createHash("sha256")
    .update(canonicalStringify(polygon as unknown as Json), "utf8")
    .digest("hex");
}

/**
 * Replays the production/research calibration evaluation path for recorded
 * source-normalized evidence: centered object-cover frame conversion followed
 * by the ratio/FOV harness's homography decomposition and camera diagnostics.
 * It only derives diagnostics; it never applies or persists a camera.
 */
export function deriveRecordedCameraDiagnostics(input: Readonly<{
  polygon: FloorPolygon;
  worldWidthMeters: number;
  worldDepthMeters: number;
  verticalFovDeg: number;
  context: AfcSr1CameraDiagnosticsContextV1;
}>): AfcSr1DerivedCameraDiagnostics | null {
  if (
    !isFloorPolygon(input.polygon) ||
    !Number.isFinite(input.worldWidthMeters) || input.worldWidthMeters <= 0 ||
    !Number.isFinite(input.worldDepthMeters) || input.worldDepthMeters <= 0 ||
    !Number.isFinite(input.verticalFovDeg)
  ) return null;
  const frameSize = { width: input.context.frameWidth, height: input.context.frameHeight };
  const crop = getCoverCrop(
    { width: input.context.intrinsicWidth, height: input.context.intrinsicHeight },
    frameSize
  );
  if (!crop || input.context.sourceToFramePolicy !== "cover_crop") return null;
  const frameFloorPolygonPx = input.polygon.map(point => ({
    x: point.x * input.context.intrinsicWidth * crop.scale + crop.offsetX,
    y: point.y * input.context.intrinsicHeight * crop.scale + crop.offsetY,
  })) as [Point, Point, Point, Point];
  const result = evaluateRatioFovCell({
    frameSize,
    frameFloorPolygonPx,
    ratio: input.worldWidthMeters / input.worldDepthMeters,
    fovDeg: input.verticalFovDeg,
    referenceDepth: input.worldDepthMeters,
  });
  if (result.status !== "success") return null;
  return Object.freeze({
    frameFloorPolygonPx: Object.freeze(frameFloorPolygonPx.map(point => Object.freeze({ ...point })) as [Point, Point, Point, Point]),
    cvAveragePx: result.cvAvgPx,
    cvMaximumPx: result.cvMaxPx,
    displayAveragePx: result.applyObservability.displayAvgPx,
    displayMaximumPx: result.applyObservability.displayMaxPx,
    scaleRatio: result.columnScaleRatio,
  });
}

function samePoint(left: Point | null, right: Point | null): boolean {
  return left !== null && right !== null && left.x === right.x && left.y === right.y;
}

function closeEnough(left: number, right: number): boolean {
  return Math.abs(left - right) <= DERIVATION_TOLERANCE;
}

function error(reason: string): GroundTruthFixtureParseResult {
  return Object.freeze({ ok: false as const, reason });
}

function parsePhotoClass(value: unknown): string | null {
  if (!isRecord(value) || !hasExactKeys(value, ["classification", "provenance", "notes"])) return "photoClass shape is invalid.";
  if (!["supported_full_back_wall", "unsupported", "unknown"].includes(value.classification as string)) return "photoClass classification is invalid.";
  if (!isProvenance(value.provenance) || !isStringArray(value.notes)) return "photoClass values are invalid.";
  return null;
}

function parseImageBasis(value: unknown): string | null {
  if (!isRecord(value) || !hasExactKeys(value, ["fingerprint", "decodedWidth", "decodedHeight", "orientation", "provenance"])) {
    return "imageBasis shape is invalid.";
  }
  if (!isNullableText(value.fingerprint) || !isNullableFiniteNumber(value.decodedWidth) || !isNullableFiniteNumber(value.decodedHeight)) {
    return "imageBasis values are invalid.";
  }
  if ((value.decodedWidth === null) !== (value.decodedHeight === null)) return "imageBasis dimensions must be both present or both absent.";
  if ((value.decodedWidth !== null && value.decodedWidth <= 0) || (value.decodedHeight !== null && value.decodedHeight <= 0)) {
    return "imageBasis dimensions must be positive.";
  }
  if (value.orientation !== null && value.orientation !== 1) return "imageBasis orientation must be 1 or null.";
  return isProvenance(value.provenance) ? null : "imageBasis provenance is invalid.";
}

function parseRawFloor(value: unknown): string | null {
  if (!isRecord(value) || !hasExactKeys(value, ["polygon", "source", "receiptFileName", "receiptSha256", "requestId", "r3bCandidateId", "r3cCandidateId", "sourceBasisFingerprint", "sourceDecodedWidth", "sourceDecodedHeight", "sourceOrientation", "projectedToImageBasis", "provenance", "notes"])) {
    return "rawFloor shape is invalid.";
  }
  if (!isNullableFloorPolygon(value.polygon) || !["empty_receipt", "test_fixture", "scene_export", "unknown"].includes(value.source as string)) {
    return "rawFloor polygon or source is invalid.";
  }
  if (![value.receiptFileName, value.receiptSha256, value.requestId, value.r3bCandidateId, value.r3cCandidateId].every(isNullableText)) {
    return "rawFloor receipt identity is invalid.";
  }
  if (!isNullableText(value.sourceBasisFingerprint) || !isNullableFiniteNumber(value.sourceDecodedWidth) || !isNullableFiniteNumber(value.sourceDecodedHeight) ||
    (value.sourceOrientation !== null && value.sourceOrientation !== 1) ||
    !(typeof value.projectedToImageBasis === "boolean" || value.projectedToImageBasis === null)) {
    return "rawFloor source basis is invalid.";
  }
  if ((value.sourceDecodedWidth === null) !== (value.sourceDecodedHeight === null) ||
    (value.sourceDecodedWidth !== null && value.sourceDecodedWidth <= 0) ||
    (value.sourceDecodedHeight !== null && value.sourceDecodedHeight <= 0)) {
    return "rawFloor source basis dimensions must be both present positive values or both absent.";
  }
  if (value.source === "empty_receipt" && (!value.polygon || !value.receiptFileName || !value.receiptSha256 || !value.requestId || !value.sourceBasisFingerprint || value.sourceDecodedWidth === null || value.sourceDecodedHeight === null || value.sourceOrientation !== 1 || value.projectedToImageBasis === null)) {
    return "empty_receipt rawFloor requires a polygon and replay receipt identity.";
  }
  if (value.source === "unknown" && value.polygon !== null) return "unknown rawFloor source cannot carry a polygon.";
  return isProvenance(value.provenance) && isStringArray(value.notes) ? null : "rawFloor provenance or notes are invalid.";
}

function parseRawToOriginalPlacement(
  value: unknown,
  rawFloor: Record<string, unknown>,
  imageBasis: Record<string, unknown>
): string | null {
  if (!isRecord(value) || typeof value.status !== "string") return "rawToOriginalPlacement shape is invalid.";
  if (value.status === "not_projected") {
    if (!hasExactKeys(value, ["status"]) || rawFloor.projectedToImageBasis === true) {
      return "not_projected placement cannot claim projected raw geometry.";
    }
    return null;
  }
  const keys = ["status", "method", "originalBasisFingerprint", "sourcePolygonFingerprint", "provenance", "evidenceReference"];
  if (value.status !== "same_basis" || !hasExactKeys(value, keys) ||
    !["receipt_already_on_original_basis", "documented_source_normalized_transfer", "explicit_projected_capture"].includes(value.method as string) ||
    !hasNonEmptyText(value.originalBasisFingerprint) || !hasNonEmptyText(value.sourcePolygonFingerprint) ||
    !hasNonEmptyText(value.evidenceReference) || !isProvenance(value.provenance)) {
    return "same_basis placement is invalid.";
  }
  if (
    rawFloor.projectedToImageBasis !== true ||
    value.originalBasisFingerprint !== imageBasis.fingerprint ||
    rawFloor.sourceBasisFingerprint !== imageBasis.fingerprint ||
    rawFloor.sourceDecodedWidth !== imageBasis.decodedWidth ||
    rawFloor.sourceDecodedHeight !== imageBasis.decodedHeight ||
    rawFloor.sourceOrientation !== imageBasis.orientation ||
    !rawFloor.polygon
  ) {
    return "same_basis placement does not match the declared Original basis.";
  }
  const fingerprint = fingerprintSourceNormalizedPolygonSync(rawFloor.polygon as FloorPolygon);
  if (!fingerprint || value.sourcePolygonFingerprint !== fingerprint) {
    return "raw_polygon_fingerprint_mismatch";
  }
  return null;
}

function parseUncertifiedReceiptSeamEvidence(
  value: unknown,
  imageBasis: Record<string, unknown>
): string | null {
  if (!isRecord(value) || typeof value.status !== "string") return "uncertifiedReceiptSeamEvidence shape is invalid.";
  if (value.status === "none") return hasExactKeys(value, ["status"]) ? null : "empty uncertified seam evidence must not carry fields.";
  const keys = [
    "status", "usableAsGroundTruth", "projectedToImageBasis", "side", "adjustableCorner", "direction",
    "emptyBasisFingerprint", "emptyDecodedWidth", "emptyDecodedHeight",
    "originalBasisFingerprint", "originalDecodedWidth", "originalDecodedHeight",
    "seamStartOnEmptyBasis", "seamEndOnEmptyBasis", "acceptedCornerOnOriginalBasis",
    "unprojectedReceiptSeamT", "perpendicularErrorSourceNormResearchOnly", "toleranceSourceNormResearchOnly",
    "collinearWithinResearchTolerance", "provenance", "notes",
  ];
  if (
    value.status !== "cross_basis_unprojected" ||
    !hasExactKeys(value, keys) ||
    value.usableAsGroundTruth !== false ||
    value.projectedToImageBasis !== false ||
    !["left", "right"].includes(value.side as string) ||
    !["NL", "NR"].includes(value.adjustableCorner as string) ||
    value.direction !== "near_to_far" ||
    ![value.emptyBasisFingerprint, value.originalBasisFingerprint].every(hasNonEmptyText) ||
    ![value.emptyDecodedWidth, value.emptyDecodedHeight, value.originalDecodedWidth, value.originalDecodedHeight, value.unprojectedReceiptSeamT, value.perpendicularErrorSourceNormResearchOnly, value.toleranceSourceNormResearchOnly].every(isFiniteNumber) ||
    ![value.seamStartOnEmptyBasis, value.seamEndOnEmptyBasis, value.acceptedCornerOnOriginalBasis].every(isSourcePoint) ||
    typeof value.collinearWithinResearchTolerance !== "boolean" ||
    !isProvenance(value.provenance) ||
    !isStringArray(value.notes)
  ) {
    return "cross-basis uncertified seam evidence is invalid.";
  }
  const emptyDecodedWidth = value.emptyDecodedWidth as number;
  const emptyDecodedHeight = value.emptyDecodedHeight as number;
  const originalDecodedWidth = value.originalDecodedWidth as number;
  const originalDecodedHeight = value.originalDecodedHeight as number;
  const seamStartOnEmptyBasis = value.seamStartOnEmptyBasis as Point;
  const seamEndOnEmptyBasis = value.seamEndOnEmptyBasis as Point;
  const acceptedCornerOnOriginalBasis = value.acceptedCornerOnOriginalBasis as Point;
  const unprojectedReceiptSeamT = value.unprojectedReceiptSeamT as number;
  const perpendicularErrorSourceNormResearchOnly = value.perpendicularErrorSourceNormResearchOnly as number;
  const toleranceSourceNormResearchOnly = value.toleranceSourceNormResearchOnly as number;
  if (
    emptyDecodedWidth <= 0 || emptyDecodedHeight <= 0 ||
    originalDecodedWidth <= 0 || originalDecodedHeight <= 0 ||
    toleranceSourceNormResearchOnly < 0 ||
    value.originalBasisFingerprint !== imageBasis.fingerprint
  ) {
    return "cross-basis uncertified seam evidence basis identity is inconsistent.";
  }
  const projection = projectPointOntoNearToFarSeam(
    seamStartOnEmptyBasis,
    seamEndOnEmptyBasis,
    acceptedCornerOnOriginalBasis
  );
  if (
    !projection ||
    !closeEnough(unprojectedReceiptSeamT, projection.t) ||
    !closeEnough(perpendicularErrorSourceNormResearchOnly, projection.perpendicularErrorSourceNorm) ||
    value.collinearWithinResearchTolerance !== (projection.perpendicularErrorSourceNorm <= toleranceSourceNormResearchOnly)
  ) {
    return "cross-basis uncertified seam derivation is inconsistent.";
  }
  return null;
}

function parseAcceptedFloor(value: unknown): string | null {
  if (!isRecord(value) || !hasExactKeys(value, ["polygon", "source", "provenance"])) return "acceptedFloor shape is invalid.";
  if (!isNullableFloorPolygon(value.polygon) || !["manual_calibration", "control_fixture", "scene_export", "unknown"].includes(value.source as string)) {
    return "acceptedFloor polygon or source is invalid.";
  }
  if (value.source === "unknown" && value.polygon !== null) return "unknown acceptedFloor source cannot carry a polygon.";
  return isProvenance(value.provenance) ? null : "acceptedFloor provenance is invalid.";
}

/**
 * Source-normalized finite-segment convention:
 * - right seam: `seamStart = raw NR`, `seamEnd = raw FR`
 * - left seam: `seamStart = raw NL`, `seamEnd = raw FL`
 * `t=0` is the raw near corner and increasing `t` moves toward the far corner.
 * This helper deliberately does not clamp `t`.
 */
export function projectPointOntoNearToFarSeam(
  seamStart: Point,
  seamEnd: Point,
  point: Point
): SeamProjection | null {
  if (![seamStart, seamEnd, point].every(isPoint)) return null;
  const dx = seamEnd.x - seamStart.x;
  const dy = seamEnd.y - seamStart.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!Number.isFinite(lengthSquared) || lengthSquared <= EPSILON) return null;
  const t = ((point.x - seamStart.x) * dx + (point.y - seamStart.y) * dy) / lengthSquared;
  const projected = { x: seamStart.x + t * dx, y: seamStart.y + t * dy };
  return Object.freeze({
    t,
    point: Object.freeze(projected),
    perpendicularErrorSourceNorm: Math.hypot(point.x - projected.x, point.y - projected.y),
  });
}

export function pointOnNearToFarSeam(seamStart: Point, seamEnd: Point, t: number): Point | null {
  if (![seamStart, seamEnd].every(isPoint) || !Number.isFinite(t)) return null;
  const projection = projectPointOntoNearToFarSeam(seamStart, seamEnd, seamStart);
  if (!projection) return null;
  return Object.freeze({
    x: seamStart.x + t * (seamEnd.x - seamStart.x),
    y: seamStart.y + t * (seamEnd.y - seamStart.y),
  });
}

export function isCollinearWithinSourceNormTolerance(
  seamStart: Point,
  seamEnd: Point,
  point: Point,
  toleranceSourceNorm: number
): boolean | null {
  if (!Number.isFinite(toleranceSourceNorm) || toleranceSourceNorm < 0) return null;
  const projection = projectPointOntoNearToFarSeam(seamStart, seamEnd, point);
  return projection ? projection.perpendicularErrorSourceNorm <= toleranceSourceNorm : null;
}

function parseSeamRefinement(
  value: unknown,
  rawFloor: Record<string, unknown>,
  acceptedFloor: Record<string, unknown>,
  placement: Record<string, unknown>
): string | null {
  const keys = [
    "adjustableCorner", "side", "direction", "seamStart", "seamEnd", "rawCorner", "acceptedCorner",
    "seamT", "perpendicularErrorSourceNormResearchOnly", "collinearWithinTolerance", "toleranceSourceNormResearchOnly", "provenance", "notes",
  ];
  if (!isRecord(value) || !hasExactKeys(value, keys)) return "seamRefinement shape is invalid.";
  if (!["NL", "NR", "none", "unknown"].includes(value.adjustableCorner as string) ||
    !["left", "right", "none", "unknown"].includes(value.side as string) ||
    !(value.direction === "near_to_far" || value.direction === null) ||
    ![value.seamStart, value.seamEnd, value.rawCorner, value.acceptedCorner].every(isNullablePoint) ||
    ![value.seamT, value.perpendicularErrorSourceNormResearchOnly, value.toleranceSourceNormResearchOnly].every(isNullableFiniteNumber) ||
    !(typeof value.collinearWithinTolerance === "boolean" || value.collinearWithinTolerance === null) ||
    !isProvenance(value.provenance) || !isStringArray(value.notes)) {
    return "seamRefinement values are invalid.";
  }
  const seamStart = value.seamStart as Point | null;
  const seamEnd = value.seamEnd as Point | null;
  const rawCorner = value.rawCorner as Point | null;
  const acceptedCorner = value.acceptedCorner as Point | null;
  const seamT = value.seamT as number | null;
  const perpendicularErrorSourceNormResearchOnly = value.perpendicularErrorSourceNormResearchOnly as number | null;
  const collinearWithinTolerance = value.collinearWithinTolerance as boolean | null;
  const toleranceSourceNormResearchOnly = value.toleranceSourceNormResearchOnly as number | null;
  const unknown = value.adjustableCorner === "none" || value.adjustableCorner === "unknown";
  if (unknown) {
    if (value.side !== (value.adjustableCorner === "none" ? "none" : "unknown") ||
      [value.direction, value.seamStart, value.seamEnd, value.rawCorner, value.acceptedCorner, value.seamT, value.perpendicularErrorSourceNormResearchOnly, value.collinearWithinTolerance, value.toleranceSourceNormResearchOnly].some(item => item !== null)) {
      return "unknown or none seamRefinement must not invent seam evidence.";
    }
    if (value.adjustableCorner === "none") {
      const rawPolygon = rawFloor.polygon as FloorPolygon | null;
      const acceptedPolygon = acceptedFloor.polygon as FloorPolygon | null;
      if (rawPolygon && acceptedPolygon && (!isFloorPolygon(rawPolygon) || !isFloorPolygon(acceptedPolygon))) {
        return "canonical seam floor polygon is invalid.";
      }
      if (rawPolygon && acceptedPolygon && !rawPolygon.every((point, index) => samePoint(point, acceptedPolygon[index]))) {
        return "non_adjusted_corner_changed";
      }
    }
    return null;
  }
  if (rawFloor.projectedToImageBasis !== true || placement.status !== "same_basis") {
    return "canonical seam evidence requires an explicit same-basis placement record.";
  }
  const expectedSide = value.adjustableCorner === "NR" ? "right" : "left";
  if (value.side !== expectedSide || value.direction !== "near_to_far" || !seamStart || !seamEnd || !rawCorner || !acceptedCorner ||
    seamT === null || perpendicularErrorSourceNormResearchOnly === null || collinearWithinTolerance === null || toleranceSourceNormResearchOnly === null || toleranceSourceNormResearchOnly < 0) {
    return "seamRefinement corner fields are contradictory or incomplete.";
  }
  if (!samePoint(seamStart, rawCorner)) return "seamRefinement seamStart must equal raw near corner.";
  const rawPolygon = rawFloor.polygon as FloorPolygon | null;
  const acceptedPolygon = acceptedFloor.polygon as FloorPolygon | null;
  if (!isFloorPolygon(rawPolygon) || !isFloorPolygon(acceptedPolygon)) {
    return "canonical seam floor polygon is invalid.";
  }
  const cornerIndex = value.adjustableCorner === "NR" ? 1 : 0;
  const farCornerIndex = value.adjustableCorner === "NR" ? 2 : 3;
  if (rawPolygon && !samePoint(rawPolygon[cornerIndex], rawCorner)) return "seamRefinement raw corner does not match rawFloor semantic corner.";
  if (rawPolygon && !samePoint(rawPolygon[farCornerIndex], seamEnd)) return "seam_end_raw_corner_mismatch";
  if (acceptedPolygon && !samePoint(acceptedPolygon[cornerIndex], acceptedCorner)) return "seamRefinement accepted corner does not match acceptedFloor semantic corner.";
  if (rawPolygon && acceptedPolygon) {
    const requiredUnchanged = value.adjustableCorner === "NR" ? [0, 2, 3] : [1, 2, 3];
    if (requiredUnchanged.some(index => !samePoint(rawPolygon[index], acceptedPolygon[index]))) {
      return "non_adjusted_corner_changed";
    }
  }
  const projection = projectPointOntoNearToFarSeam(seamStart, seamEnd, acceptedCorner);
  if (!projection || !closeEnough(seamT, projection.t) || !closeEnough(perpendicularErrorSourceNormResearchOnly, projection.perpendicularErrorSourceNorm)) {
    return "seamRefinement derived t or perpendicular error is inconsistent.";
  }
  if (collinearWithinTolerance !== (projection.perpendicularErrorSourceNorm <= toleranceSourceNormResearchOnly)) {
    return "seamRefinement collinearity result is inconsistent with declared tolerance.";
  }
  return null;
}

function parseCameraApplyEvidence(
  value: unknown,
  cameraAppliedSuccessfully: unknown,
  cameraApplySafe: unknown
): string | null {
  if (!isRecord(value) || !hasExactKeys(value, ["status", "provenance", "notes"]) ||
    !["not_applied", "ordinary_calibrated_camera_applied", "afc_bound_cp2b_applied"].includes(value.status as string) ||
    !Array.isArray(value.provenance) || !value.provenance.every(isProvenance) ||
    !isStringArray(value.notes)) {
    return "cameraApplyEvidence is invalid.";
  }
  const provenance = value.provenance as GroundTruthProvenance[];
  if (new Set(provenance).size !== provenance.length) return "cameraApplyEvidence provenance must not contain duplicates.";
  if (value.status === "not_applied" && cameraAppliedSuccessfully === true) return "not_applied camera evidence contradicts Apply success.";
  if (value.status !== "not_applied") {
    if (cameraAppliedSuccessfully !== true || cameraApplySafe !== true) return "camera Apply evidence requires successful Apply-safe calibration.";
    const requiredCapturedProvenance: readonly GroundTruthProvenance[] = [
      "manual_observation",
      "live_ui_diagnostics",
      "scene_state_export",
    ];
    if (!requiredCapturedProvenance.every(source => provenance.includes(source))) {
      return "camera Apply evidence lacks required captured provenance.";
    }
  }
  return null;
}

function parseCameraDiagnosticsContext(value: unknown): string | null {
  const keys = ["intrinsicWidth", "intrinsicHeight", "frameWidth", "frameHeight", "sourceToFramePolicy", "derivationVersion", "provenance"];
  if (!isRecord(value) || !hasExactKeys(value, keys) ||
    ![value.intrinsicWidth, value.intrinsicHeight, value.frameWidth, value.frameHeight].every(isFiniteNumber) ||
    value.sourceToFramePolicy !== "cover_crop" ||
    value.derivationVersion !== "ratio-fov-harness/v1" ||
    !isProvenance(value.provenance)) {
    return "cameraDiagnosticsContext is invalid.";
  }
  const intrinsicWidth = value.intrinsicWidth as number;
  const intrinsicHeight = value.intrinsicHeight as number;
  const frameWidth = value.frameWidth as number;
  const frameHeight = value.frameHeight as number;
  if (intrinsicWidth <= 0 || intrinsicHeight <= 0 || frameWidth <= 0 || frameHeight <= 0) {
    return "cameraDiagnosticsContext dimensions must be positive.";
  }
  return null;
}

function parseAfcAuthorityPathStatus(value: unknown, calibration: Record<string, unknown>): string | null {
  if (!["not_tested", "not_yet_exercisable", "ordinary_only", "cp2b_applied"].includes(value as string)) {
    return "afcAuthorityPathStatus is invalid.";
  }
  const evidence = calibration.cameraApplyEvidence as Record<string, unknown>;
  if (value === "not_tested") {
    return calibration.cameraAppliedSuccessfully === true ? "not_tested authority path contradicts camera Apply success." : null;
  }
  if (value === "cp2b_applied") {
    return evidence.status === "afc_bound_cp2b_applied" ? null : "cp2b_applied authority path requires CP2B Apply evidence.";
  }
  if (evidence.status !== "ordinary_calibrated_camera_applied" || calibration.cameraAppliedSuccessfully !== true) {
    return "ordinary AFC authority-path status requires ordinary camera Apply evidence.";
  }
  if (value === "not_yet_exercisable" && !((evidence.notes as unknown[]).some(note => typeof note === "string" && /binding|handoff/i.test(note)))) {
    return "not_yet_exercisable authority path requires a binding or handoff explanation.";
  }
  return null;
}

function parseCalibration(value: unknown, acceptedFloor: Record<string, unknown> | null): string | null {
  const keys = [
    "worldWidthMeters", "worldDepthMeters", "widthDepthRatio", "depthWidthAspect", "verticalFovDeg", "dimensionsTruth",
    "cvAveragePx", "cvMaximumPx", "displayAveragePx", "displayMaximumPx", "scaleRatio", "scaleRatioProvenance", "cameraDiagnosticsContext", "cameraApplySafe", "cameraAppliedSuccessfully", "cameraApplyEvidence", "provenance",
  ];
  if (!isRecord(value) || !hasExactKeys(value, keys)) return "calibration shape is invalid.";
  const numeric = ["worldWidthMeters", "worldDepthMeters", "widthDepthRatio", "depthWidthAspect", "verticalFovDeg", "cvAveragePx", "cvMaximumPx", "displayAveragePx", "displayMaximumPx", "scaleRatio"] as const;
  if (!numeric.every(key => isNullableFiniteNumber(value[key])) ||
    !["accepted_calibration_values", "physical_measurement", "synthetic_test_values", "unknown"].includes(value.dimensionsTruth as string) ||
    !(typeof value.cameraApplySafe === "boolean" || value.cameraApplySafe === null) ||
    !(typeof value.cameraAppliedSuccessfully === "boolean" || value.cameraAppliedSuccessfully === null) ||
    !(value.scaleRatioProvenance === null || isProvenance(value.scaleRatioProvenance)) ||
    !(value.cameraDiagnosticsContext === null || parseCameraDiagnosticsContext(value.cameraDiagnosticsContext) === null) ||
    !isProvenance(value.provenance) ||
    parseCameraApplyEvidence(value.cameraApplyEvidence, value.cameraAppliedSuccessfully, value.cameraApplySafe) !== null) {
    return "calibration values are invalid.";
  }
  const width = value.worldWidthMeters as number | null;
  const depth = value.worldDepthMeters as number | null;
  const widthDepthRatio = value.widthDepthRatio as number | null;
  const depthWidthAspect = value.depthWidthAspect as number | null;
  if ((width === null) !== (depth === null)) return "calibration dimensions must be both present or both absent.";
  if ((width !== null && width <= 0) || (depth !== null && depth <= 0) ||
    (widthDepthRatio !== null && widthDepthRatio <= 0) || (depthWidthAspect !== null && depthWidthAspect <= 0)) {
    return "calibration dimensions and ratios must be positive.";
  }
  if ((widthDepthRatio === null) !== (depthWidthAspect === null)) return "calibration ratios must be both present or both absent.";
  if (width !== null && depth !== null && (!widthDepthRatio || !depthWidthAspect || !closeEnough(widthDepthRatio, width / depth) || !closeEnough(depthWidthAspect, depth / width))) {
    return "calibration ratios are inconsistent with world dimensions.";
  }
  if (widthDepthRatio !== null && !closeEnough(depthWidthAspect!, 1 / widthDepthRatio)) return "depthWidthAspect must be the inverse of widthDepthRatio.";
  if ((value.scaleRatio === null) !== (value.scaleRatioProvenance === null)) return "scaleRatio and scaleRatioProvenance must be both present or both absent.";
  if (value.scaleRatio !== null && value.scaleRatioProvenance !== "derived_from_recorded_values") {
    return "scaleRatio must be derived from recorded values.";
  }
  if (value.scaleRatio !== null && value.cameraDiagnosticsContext === null) {
    return "derived scaleRatio requires cameraDiagnosticsContext.";
  }
  const fov = value.verticalFovDeg as number | null;
  if (fov !== null && (fov < 20 || fov > 90)) return "verticalFovDeg is outside the supported 20°–90° range.";
  const acceptedPolygon = acceptedFloor?.polygon;
  const canDeriveDiagnostics =
    value.cameraDiagnosticsContext !== null &&
    isFloorPolygon(acceptedPolygon) &&
    width !== null &&
    depth !== null &&
    fov !== null &&
    value.scaleRatio !== null &&
    isFiniteNumber(value.cvAveragePx) &&
    isFiniteNumber(value.cvMaximumPx) &&
    isFiniteNumber(value.displayAveragePx) &&
    isFiniteNumber(value.displayMaximumPx);
  if (canDeriveDiagnostics) {
    const derived = deriveRecordedCameraDiagnostics({
      polygon: acceptedPolygon,
      worldWidthMeters: width,
      worldDepthMeters: depth,
      verticalFovDeg: fov,
      context: value.cameraDiagnosticsContext as AfcSr1CameraDiagnosticsContextV1,
    });
    if (!derived) return "derived_camera_diagnostics_unavailable";
    if (Math.abs((value.scaleRatio as number) - derived.scaleRatio) > RECORDED_CAMERA_SCALE_RATIO_TOLERANCE) {
      return "derived_scale_ratio_mismatch";
    }
    if (Math.abs((value.cvAveragePx as number) - derived.cvAveragePx) > RECORDED_CAMERA_REPROJECTION_TOLERANCE_PX) {
      return "derived_cv_average_mismatch";
    }
    if (Math.abs((value.cvMaximumPx as number) - derived.cvMaximumPx) > RECORDED_CAMERA_REPROJECTION_TOLERANCE_PX) {
      return "derived_cv_maximum_mismatch";
    }
    if (Math.abs((value.displayAveragePx as number) - derived.displayAveragePx) > RECORDED_CAMERA_REPROJECTION_TOLERANCE_PX) {
      return "derived_display_average_mismatch";
    }
    if (Math.abs((value.displayMaximumPx as number) - derived.displayMaximumPx) > RECORDED_CAMERA_REPROJECTION_TOLERANCE_PX) {
      return "derived_display_maximum_mismatch";
    }
  }
  if (value.cameraAppliedSuccessfully === true && (value.cameraApplySafe !== true || !["live_ui_diagnostics", "manual_observation", "receipt_replay"].includes(value.provenance as string))) {
    return "camera Apply success requires captured Apply-safe evidence.";
  }
  return null;
}

function parseManualProcess(value: unknown): string | null {
  if (!isRecord(value) || !hasExactKeys(value, ["widthFovIterationCount", "visuallyAccepted", "notes", "provenance"])) {
    return "manualProcess shape is invalid.";
  }
  if ((value.widthFovIterationCount !== null && (!isFiniteNumber(value.widthFovIterationCount) || !Number.isInteger(value.widthFovIterationCount) || value.widthFovIterationCount < 0)) ||
    !(typeof value.visuallyAccepted === "boolean" || value.visuallyAccepted === null) ||
    !isStringArray(value.notes) || !isProvenance(value.provenance)) {
    return "manualProcess values are invalid.";
  }
  return null;
}

function requiredCertificationFields(value: Record<string, unknown>): readonly string[] {
  const imageBasis = value.imageBasis as Record<string, unknown>;
  const rawFloor = value.rawFloor as Record<string, unknown>;
  const acceptedFloor = value.acceptedFloor as Record<string, unknown>;
  const placement = value.rawToOriginalPlacement as Record<string, unknown>;
  const seam = value.seamRefinement as Record<string, unknown>;
  const calibration = value.calibration as Record<string, unknown>;
  const manualProcess = value.manualProcess as Record<string, unknown>;
  const missing: string[] = [];
  if (value.photoClass && (value.photoClass as Record<string, unknown>).classification !== "supported_full_back_wall") missing.push("photoClass.classification");
  for (const key of ["fingerprint", "decodedWidth", "decodedHeight", "orientation"]) if (imageBasis[key] === null) missing.push(`imageBasis.${key}`);
  if (rawFloor.source !== "empty_receipt" || rawFloor.polygon === null) missing.push("rawFloor.emptyReceiptPolygon");
  if ([rawFloor.receiptFileName, rawFloor.receiptSha256, rawFloor.requestId].some(item => item === null)) missing.push("rawFloor.receiptIdentity");
  if ([rawFloor.sourceBasisFingerprint, rawFloor.sourceDecodedWidth, rawFloor.sourceDecodedHeight, rawFloor.sourceOrientation].some(item => item === null)) missing.push("rawFloor.sourceBasis");
  if (placement.status !== "same_basis" || rawFloor.projectedToImageBasis !== true || rawFloor.sourceBasisFingerprint !== imageBasis.fingerprint) {
    missing.push("rawToOriginalPlacement");
  }
  if (acceptedFloor.polygon === null) missing.push("acceptedFloor.polygon");
  if (
    placement.status !== "same_basis" ||
    seam.adjustableCorner === "unknown" ||
    seam.adjustableCorner === "none" ||
    ["seamStart", "seamEnd", "rawCorner", "acceptedCorner", "seamT", "perpendicularErrorSourceNormResearchOnly", "collinearWithinTolerance", "toleranceSourceNormResearchOnly"].some(key => seam[key] === null) ||
    seam.collinearWithinTolerance !== true
  ) missing.push("seamRefinement.sameBasisEvidence");
  if ([calibration.worldWidthMeters, calibration.worldDepthMeters].some(item => item === null)) missing.push("calibration.worldDimensions");
  if ([calibration.cvAveragePx, calibration.cvMaximumPx].some(item => item === null)) missing.push("calibration.cvDiagnostics");
  if ([calibration.displayAveragePx, calibration.displayMaximumPx].some(item => item === null)) missing.push("calibration.displayDiagnostics");
  if (calibration.scaleRatio === null) missing.push("calibration.scaleRatio");
  if (calibration.cameraApplySafe !== true) missing.push("calibration.cameraApplySafe");
  if (calibration.cameraAppliedSuccessfully !== true) missing.push("calibration.cameraAppliedSuccessfully");
  if (manualProcess.visuallyAccepted !== true) missing.push("manualProcess.visualAcceptance");
  return missing;
}

function parseCompleteness(value: unknown, fixture: Record<string, unknown>): string | null {
  if (!isRecord(value) || !hasExactKeys(value, ["status", "missingFields"]) ||
    !["certified", "partial", "requires_recapture"].includes(value.status as string) || !isStringArray(value.missingFields)) {
    return "completeness shape is invalid.";
  }
  const requiredMissing = requiredCertificationFields(fixture);
  const declaredMissing = value.missingFields as readonly string[];
  if (value.status === "certified" && (requiredMissing.length > 0 || value.missingFields.length > 0)) {
    return "certified fixtures cannot have missing required evidence.";
  }
  if (value.status !== "certified" && !requiredMissing.every(field => declaredMissing.includes(field))) {
    return `completeness missingFields omits computed certification gaps: ${requiredMissing.filter(field => !declaredMissing.includes(field)).join(", ")}.`;
  }
  if (new Set(declaredMissing).size !== declaredMissing.length) return "completeness missingFields must not contain duplicates.";
  return null;
}

export function parseAfcSr1GroundTruthFixtureV1(value: unknown): GroundTruthFixtureParseResult {
  const keys = ["schemaVersion", "roomId", "photoClass", "imageBasis", "rawFloor", "rawToOriginalPlacement", "acceptedFloor", "seamRefinement", "uncertifiedReceiptSeamEvidence", "afcAuthorityPathStatus", "calibration", "manualProcess", "completeness"];
  if (!isRecord(value) || !hasExactKeys(value, keys)) return error("fixture shape is invalid.");
  if (value.schemaVersion !== "afc-sr1-ground-truth/v1") return error("unsupported ground-truth schema version.");
  if (!["room-a", "room-b", "room-c"].includes(value.roomId as string)) return error("roomId is invalid.");
  const rawFloor = value.rawFloor;
  const imageBasis = value.imageBasis;
  const placement = value.rawToOriginalPlacement;
  const acceptedFloor = value.acceptedFloor;
  const validators = [
    parsePhotoClass(value.photoClass),
    parseImageBasis(value.imageBasis),
    parseRawFloor(rawFloor),
    isRecord(rawFloor) && isRecord(imageBasis) ? parseRawToOriginalPlacement(placement, rawFloor, imageBasis) : "rawToOriginalPlacement dependencies are invalid.",
    parseAcceptedFloor(acceptedFloor),
    isRecord(imageBasis) ? parseUncertifiedReceiptSeamEvidence(value.uncertifiedReceiptSeamEvidence, imageBasis) : "uncertifiedReceiptSeamEvidence dependencies are invalid.",
    isRecord(rawFloor) && isRecord(acceptedFloor) && isRecord(placement) ? parseSeamRefinement(value.seamRefinement, rawFloor, acceptedFloor, placement) : "seamRefinement dependencies are invalid.",
    parseCalibration(value.calibration, isRecord(acceptedFloor) ? acceptedFloor : null),
    isRecord(value.calibration) ? parseAfcAuthorityPathStatus(value.afcAuthorityPathStatus, value.calibration) : "afcAuthorityPathStatus dependencies are invalid.",
    parseManualProcess(value.manualProcess),
    parseCompleteness(value.completeness, value),
  ];
  const reason = validators.find((result): result is string => result !== null);
  return reason ? error(reason) : Object.freeze({ ok: true as const, value: value as AfcSr1GroundTruthFixtureV1 });
}
