import {
  canonicalizeRfc8785Jcs,
  sha256HexUtf8,
} from "../gemini-evidence-contract";
import {
  validateFloorSourcePointExtent,
  validateFloorSourcePolygonExtent,
} from "../floor-coordinate-extent";

export const AFC_SR1_SEMANTIC_PRIOR_BINDING_VERSION =
  "afc-sr1-semantic-prior-binding/v1" as const;
export const AFC_SR1_ORIGINAL_BASIS_PLACEMENT_VERSION =
  "afc-sr1-original-basis-placement/v1" as const;
export const AFC_SR1_REPLAY_EVIDENCE_IDENTITY_VERSION =
  "afc-sr1-replay-evidence-identity/v1" as const;
export const AFC_SR1_OVERLAY_DESCRIPTOR_VERSION =
  "afc-sr1-overlay-descriptor/v1" as const;
export const AFC_SR1_SEAM_BINDING_TOKEN_VERSION =
  "afc-sr1-seam-binding-token/v1" as const;
export const AFC_SR1_SEMANTIC_PRIOR_REQUEST_VERSION =
  "afc-sr1-semantic-prior-request/v1" as const;
export const AFC_SR1_SEMANTIC_PRIOR_RESPONSE_VERSION =
  "afc-sr1-semantic-prior-response/v1" as const;
export const AFC_SR1_VALIDATED_ADVISORY_VERSION =
  "afc-sr1-validated-advisory/v1" as const;
export const AFC_SR1_SEMANTIC_PRIOR_REPLAY_VERSION =
  "afc-sr1-semantic-prior-replay/v1" as const;
export const AFC_SR1_SOLVER_HANDOFF_VERSION =
  "afc-sr1-solver-handoff/v1" as const;

export const AFC_SR1_COORDINATE_SPACE = "source-normalized/v1" as const;
export const AFC_SR1_SEMANTIC_ORDER = ["NL", "NR", "FR", "FL"] as const;
export const AFC_SR1_HYPOTHESES = ["none", "NL", "NR"] as const;
export const AFC_SR1_ALLOWED_DECISIONS = [
  "no_adjustment",
  "adjust_nl",
  "adjust_nr",
  "abstain",
  "unsupported_image_class",
  "insufficient_evidence",
] as const;
export const AFC_SR1_SCORE_TOTAL_TOLERANCE = 1e-9;
/**
 * Exact R3C image-pair admission boundary, applied to the unrounded relative
 * aspect error. The denominator is the target Original aspect so this remains
 * formula-compatible with the established transfer classifier.
 */
export const AFC_SR1_ASPECT_RELATIVE_ERROR_TOLERANCE = 0.015;
export const AFC_SR1_VALIDATED_ADVISORY_PARSER_VERSION =
  "afc-sr1-semantic-prior-parser/v1" as const;

export type AfcSr1SemanticCorner = "NL" | "NR" | "FR" | "FL";
export type AfcSr1AdjustableCorner = "NL" | "NR";
export type AfcSr1Hypothesis = "none" | AfcSr1AdjustableCorner;
export type AfcSr1Point = Readonly<{ x: number; y: number }>;
export type AfcSr1SourcePolygon = readonly [
  AfcSr1Point,
  AfcSr1Point,
  AfcSr1Point,
  AfcSr1Point,
];

export type AfcSr1ImageBasisV1 = Readonly<{
  fingerprint: string;
  decodedWidth: number;
  decodedHeight: number;
  orientation: 1;
}>;

export type AfcSr1OriginalBasisPlacementV1 = Readonly<{
  schemaVersion: typeof AFC_SR1_ORIGINAL_BASIS_PLACEMENT_VERSION;
  status: "placed_on_original_basis";
  method: "already_original_basis" | "verified_source_normalized_transfer";
  sourceEmptyBasis: AfcSr1ImageBasisV1;
  targetOriginalBasis: AfcSr1ImageBasisV1;
  compatibilityTier: "exact_grid_compatible" | "aspect_compatible_rescaled";
  transferRecordFingerprint: string;
}>;

export type AfcSr1ReplayVerifiedEmptyCandidateIdentityV1 = Readonly<{
  schemaVersion: typeof AFC_SR1_REPLAY_EVIDENCE_IDENTITY_VERSION;
  receiptContractVersion: "afc-r3c-proposal-run-receipt/v1";
  receiptFileName: string;
  receiptSha256: string;
  requestId: string;
  imageRole: "empty_room_boundary_specialist";
  r3bCandidateId: string;
  r3cCandidateId: string;
  inputImageFingerprint: string;
  originalImageFingerprint: string;
  emptyRoomAssistFingerprint: string;
  replayVerificationVersion: string;
  replayEvidenceFingerprint: string;
}>;

export type AfcSr1CanonicalNearToFarSeamV1 = Readonly<{
  direction: "near_to_far";
  adjustableCorner: AfcSr1AdjustableCorner;
  seamStartNear: AfcSr1Point;
  seamEndFar: AfcSr1Point;
}>;

export type AfcSr1SemanticHypothesisSetV1 = Readonly<{
  none: true;
  NL: AfcSr1CanonicalNearToFarSeamV1;
  NR: AfcSr1CanonicalNearToFarSeamV1;
}>;

export type AfcSr1OverlayDescriptorV1 = Readonly<{
  schemaVersion: typeof AFC_SR1_OVERLAY_DESCRIPTOR_VERSION;
  originalTargetBasis: AfcSr1ImageBasisV1;
  coordinateSpace: typeof AFC_SR1_COORDINATE_SPACE;
  rawSourcePolygon: AfcSr1SourcePolygon;
  semanticCornerLabels: typeof AFC_SR1_SEMANTIC_ORDER;
  hypotheses: AfcSr1SemanticHypothesisSetV1;
  visualInstructions: Readonly<{
    showFullPolygon: true;
    showCornerLabels: true;
    showNlCandidateSeam: true;
    showNrCandidateSeam: true;
    showNearToFarDirection: true;
    showReplacementPolygon: false;
    showCameraGeometry: false;
  }>;
  overlayGenerationId: string;
}>;

export type AfcSr1SemanticPriorBindingV1 = Readonly<{
  schemaVersion: typeof AFC_SR1_SEMANTIC_PRIOR_BINDING_VERSION;
  replayEvidence: AfcSr1ReplayVerifiedEmptyCandidateIdentityV1;
  placement: AfcSr1OriginalBasisPlacementV1;
  coordinateSpace: typeof AFC_SR1_COORDINATE_SPACE;
  semanticOrder: typeof AFC_SR1_SEMANTIC_ORDER;
  rawSourcePolygon: AfcSr1SourcePolygon;
  rawSourcePolygonFingerprint: string;
  hypotheses: AfcSr1SemanticHypothesisSetV1;
  overlayGenerationId: string;
  requestGenerationId: string;
}>;

export type AfcSr1SeamBindingTokenPreimageV1 = Readonly<{
  tokenSchemaVersion: typeof AFC_SR1_SEAM_BINDING_TOKEN_VERSION;
  semanticPriorBinding: AfcSr1SemanticPriorBindingV1;
  overlayFingerprint: string;
  requestGenerationId: string;
}>;

export type AfcSr1SemanticPriorDecisionV1 =
  (typeof AFC_SR1_ALLOWED_DECISIONS)[number];
export type AfcSr1SemanticReasonLabelV1 =
  | "left_side_appears_nearer"
  | "right_side_appears_nearer"
  | "side_depth_ambiguous"
  | "back_wall_visible"
  | "both_side_walls_visible"
  | "floor_wall_edges_partially_off_frame"
  | "perspective_supports_opposite_near_corner_refinement"
  | "no_refinement_evidence"
  | "insufficient_side_wall_comparison"
  | "unsupported_room_structure";
export type AfcSr1RankedHypothesisV1 = Readonly<{
  hypothesis: AfcSr1Hypothesis;
  score: number;
}>;
export type AfcSr1SeamTPriorV1 = Readonly<{
  adjustableCorner: AfcSr1AdjustableCorner;
  preferredSeamT: number | null;
  minSeamT: number;
  maxSeamT: number;
}>;

export type AfcSr1SemanticPriorRequestV1 = Readonly<{
  schemaVersion: typeof AFC_SR1_SEMANTIC_PRIOR_REQUEST_VERSION;
  taskMode: "sr1_near_corner_semantic_prior/v1";
  seamBindingToken: string;
  requestGenerationId: string;
  originalImageEvidence: AfcSr1ImageBasisV1;
  overlayFingerprint: string;
  supportedImageClass: "visible_back_wall_with_both_side_walls/v1";
  hypotheses: typeof AFC_SR1_HYPOTHESES;
  geometryAuthority: "server_fixed_empty_candidate_geometry";
  advisoryOnly: true;
  allowedDecisions: typeof AFC_SR1_ALLOWED_DECISIONS;
}>;

export type AfcSr1SemanticPriorResponseV1 = Readonly<{
  schemaVersion: typeof AFC_SR1_SEMANTIC_PRIOR_RESPONSE_VERSION;
  bindingEcho: string;
  decision: AfcSr1SemanticPriorDecisionV1;
  rankedHypotheses: readonly [
    AfcSr1RankedHypothesisV1,
    AfcSr1RankedHypothesisV1,
    AfcSr1RankedHypothesisV1,
  ] | null;
  seamTPrior: AfcSr1SeamTPriorV1 | null;
  semanticLabels: readonly AfcSr1SemanticReasonLabelV1[];
}>;

export type AfcSr1ValidatedAdvisoryStatusV1 =
  | "usable"
  | "safe_abstention"
  | "unsupported";
export type AfcSr1ValidatedAdvisoryV1 = Readonly<{
  schemaVersion: typeof AFC_SR1_VALIDATED_ADVISORY_VERSION;
  status: AfcSr1ValidatedAdvisoryStatusV1;
  bindingToken: string;
  decision: AfcSr1SemanticPriorDecisionV1;
  rankedHypotheses: readonly AfcSr1RankedHypothesisV1[] | null;
  seamTPrior: AfcSr1SeamTPriorV1 | null;
  semanticLabels: readonly AfcSr1SemanticReasonLabelV1[];
  parserVersion: typeof AFC_SR1_VALIDATED_ADVISORY_PARSER_VERSION;
}>;

export type AfcSr1SemanticPriorFailureClassV1 =
  | "hard_invalid"
  | "stale"
  | "retryable_provider_failure"
  | "unsupported"
  | "safe_abstention";
export type AfcSr1ParseResult =
  | Readonly<{ ok: true; value: AfcSr1SemanticPriorResponseV1 }>
  | Readonly<{ ok: false; failureClass: "hard_invalid"; reasonCode: string }>;
export type AfcSr1ValidationResult =
  | Readonly<{ ok: true; value: AfcSr1ValidatedAdvisoryV1 }>
  | Readonly<{
      ok: false;
      failureClass: "hard_invalid" | "stale";
      reasonCode: string;
    }>;

export type AfcSr1SemanticPriorReplayV1 = Readonly<{
  schemaVersion: typeof AFC_SR1_SEMANTIC_PRIOR_REPLAY_VERSION;
  bindingToken: string;
  semanticPriorBinding: AfcSr1SemanticPriorBindingV1;
  overlayDescriptor: AfcSr1OverlayDescriptorV1;
  overlayFingerprint: string;
  request: AfcSr1SemanticPriorRequestV1;
  requestDigest: string;
  executionProvenance: Readonly<{
    providerId: string | null;
    modelId: string | null;
    providerModelVersion: string | null;
    attempt: number;
    requestedAt: string | null;
    receivedAt: string | null;
  }>;
  rawProviderResponse: string | null;
  parsedResponse: AfcSr1SemanticPriorResponseV1 | null;
  validation:
    | AfcSr1ValidatedAdvisoryV1
    | Readonly<{
        status: "hard_invalid" | "stale" | "retryable_provider_failure";
        reasonCode: string;
      }>;
}>;

export type AfcSr1SolverHandoffV1 = Readonly<{
  schemaVersion: typeof AFC_SR1_SOLVER_HANDOFF_VERSION;
  bindingToken: string;
  replayEvidence: AfcSr1ReplayVerifiedEmptyCandidateIdentityV1;
  originalBasisPlacement: AfcSr1OriginalBasisPlacementV1;
  originalTargetBasis: AfcSr1ImageBasisV1;
  coordinateSpace: typeof AFC_SR1_COORDINATE_SPACE;
  semanticOrder: typeof AFC_SR1_SEMANTIC_ORDER;
  rawSourcePolygon: AfcSr1SourcePolygon;
  rawSourcePolygonFingerprint: string;
  allowedHypotheses: typeof AFC_SR1_HYPOTHESES;
  canonicalSeams: Readonly<{
    NL: AfcSr1CanonicalNearToFarSeamV1;
    NR: AfcSr1CanonicalNearToFarSeamV1;
  }>;
  advisory: AfcSr1ValidatedAdvisoryV1;
}>;

const SHA256_HEX = /^[0-9a-f]{64}$/;
const REASON_LABELS = new Set<AfcSr1SemanticReasonLabelV1>([
  "left_side_appears_nearer",
  "right_side_appears_nearer",
  "side_depth_ambiguous",
  "back_wall_visible",
  "both_side_walls_visible",
  "floor_wall_edges_partially_off_frame",
  "perspective_supports_opposite_near_corner_refinement",
  "no_refinement_evidence",
  "insufficient_side_wall_comparison",
  "unsupported_room_structure",
]);

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

function fail(message: string): never {
  throw new Error(`AFC-SR1 semantic-prior contract: ${message}`);
}

function text(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) fail(`${field}_invalid`);
}

function sha256(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !SHA256_HEX.test(value)) fail(`${field}_invalid`);
}

function finite(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${field}_invalid`);
}

function sameTextTuple(
  value: unknown,
  expected: readonly string[],
  field: string
): boolean {
  return Array.isArray(value) && value.length === expected.length &&
    value.every((item, index) => item === expected[index]) || (fail(`${field}_invalid`), false);
}

function clonePoint(point: AfcSr1Point): AfcSr1Point {
  return Object.freeze({ x: point.x, y: point.y });
}

function clonePolygon(polygon: AfcSr1SourcePolygon): AfcSr1SourcePolygon {
  return Object.freeze(polygon.map(clonePoint) as unknown as AfcSr1SourcePolygon);
}

function cloneBasis(basis: AfcSr1ImageBasisV1): AfcSr1ImageBasisV1 {
  return Object.freeze({ ...basis });
}

function equalPoint(left: AfcSr1Point, right: AfcSr1Point): boolean {
  return left.x === right.x && left.y === right.y;
}

function equalBasis(left: AfcSr1ImageBasisV1, right: AfcSr1ImageBasisV1): boolean {
  return left.fingerprint === right.fingerprint &&
    left.decodedWidth === right.decodedWidth &&
    left.decodedHeight === right.decodedHeight &&
    left.orientation === right.orientation;
}

export function validateAfcSr1ImageBasis(value: unknown): asserts value is AfcSr1ImageBasisV1 {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["fingerprint", "decodedWidth", "decodedHeight", "orientation"])) {
    fail("image_basis_shape_invalid");
  }
  sha256(value.fingerprint, "image_basis_fingerprint");
  finite(value.decodedWidth, "image_basis_width");
  finite(value.decodedHeight, "image_basis_height");
  if (!Number.isInteger(value.decodedWidth) || value.decodedWidth <= 0 ||
      !Number.isInteger(value.decodedHeight) || value.decodedHeight <= 0 ||
      value.orientation !== 1) {
    fail("image_basis_values_invalid");
  }
}

export function validateAfcSr1SourcePolygon(value: unknown): asserts value is AfcSr1SourcePolygon {
  if (!Array.isArray(value) || value.length !== 4) fail("source_polygon_tuple_invalid");
  if (!value.every(point => isPlainRecord(point) && hasExactKeys(point, ["x", "y"]))) {
    fail("source_polygon_point_shape_invalid");
  }
  if (!validateFloorSourcePolygonExtent(value as AfcSr1Point[]).ok) fail("source_polygon_extent_invalid");
  const [nl, nr, fr, fl] = value as unknown as AfcSr1SourcePolygon;
  if ((nl.y + nr.y) / 2 <= (fr.y + fl.y) / 2 || nl.x >= nr.x || fl.x >= fr.x) {
    fail("source_polygon_semantic_order_invalid");
  }
  if ((nl.x === fl.x && nl.y === fl.y) || (nr.x === fr.x && nr.y === fr.y)) {
    fail("source_polygon_collapsed_seam");
  }
}

export function fingerprintAfcSr1SourcePolygon(polygon: AfcSr1SourcePolygon): string {
  validateAfcSr1SourcePolygon(polygon);
  return sha256HexUtf8(canonicalizeRfc8785Jcs(polygon));
}

export function validateAfcSr1ReplayEvidenceIdentity(
  value: unknown
): asserts value is AfcSr1ReplayVerifiedEmptyCandidateIdentityV1 {
  const keys = [
    "schemaVersion", "receiptContractVersion", "receiptFileName", "receiptSha256",
    "requestId", "imageRole", "r3bCandidateId", "r3cCandidateId",
    "inputImageFingerprint", "originalImageFingerprint", "emptyRoomAssistFingerprint",
    "replayVerificationVersion", "replayEvidenceFingerprint",
  ];
  if (!isPlainRecord(value) || !hasExactKeys(value, keys) ||
      value.schemaVersion !== AFC_SR1_REPLAY_EVIDENCE_IDENTITY_VERSION ||
      value.receiptContractVersion !== "afc-r3c-proposal-run-receipt/v1" ||
      value.imageRole !== "empty_room_boundary_specialist") {
    fail("replay_evidence_shape_invalid");
  }
  for (const field of ["receiptFileName", "requestId", "r3bCandidateId", "r3cCandidateId", "replayVerificationVersion"] as const) {
    text(value[field], `replay_evidence_${field}`);
  }
  sha256(value.receiptSha256, "replay_evidence_receipt_sha256");
  for (const field of ["inputImageFingerprint", "originalImageFingerprint", "emptyRoomAssistFingerprint", "replayEvidenceFingerprint"] as const) {
    sha256(value[field], `replay_evidence_${field}`);
  }
  const r3bCandidateId = value.r3bCandidateId as string;
  const r3cCandidateId = value.r3cCandidateId as string;
  if (!r3bCandidateId.startsWith("afc-r3:") ||
      !r3cCandidateId.startsWith("afc-r3c:empty:") ||
      !r3cCandidateId.endsWith(r3bCandidateId)) {
    fail("replay_evidence_candidate_identity_invalid");
  }
  if (value.inputImageFingerprint !== value.emptyRoomAssistFingerprint) {
    fail("replay_empty_role_input_image_mismatch");
  }
}

/**
 * Formula parity with R3C image-pair compatibility:
 * `abs(inputAspect - originalAspect) / originalAspect`.
 *
 * `first` is the source Empty/input basis; `second` is the target Original
 * basis. Both are already validated image bases, so this is finite and
 * intentionally uses decoded dimensions only.
 */
export function computeAfcSr1RelativeAspectError(
  first: AfcSr1ImageBasisV1,
  second: AfcSr1ImageBasisV1
): number {
  validateAfcSr1ImageBasis(first);
  validateAfcSr1ImageBasis(second);
  const firstAspect = first.decodedWidth / first.decodedHeight;
  const secondAspect = second.decodedWidth / second.decodedHeight;
  const error = Math.abs(firstAspect - secondAspect) / secondAspect;
  if (!Number.isFinite(error)) fail("placement_aspect_error_invalid");
  return error;
}

export function buildAfcSr1OriginalBasisPlacement(
  input: AfcSr1OriginalBasisPlacementV1
): AfcSr1OriginalBasisPlacementV1 {
  const keys = [
    "schemaVersion", "status", "method", "sourceEmptyBasis", "targetOriginalBasis",
    "compatibilityTier", "transferRecordFingerprint",
  ];
  if (!isPlainRecord(input) || !hasExactKeys(input, keys) ||
      input.schemaVersion !== AFC_SR1_ORIGINAL_BASIS_PLACEMENT_VERSION ||
      input.status !== "placed_on_original_basis" ||
      !["already_original_basis", "verified_source_normalized_transfer"].includes(input.method) ||
      !["exact_grid_compatible", "aspect_compatible_rescaled"].includes(input.compatibilityTier)) {
    fail("original_basis_placement_shape_invalid");
  }
  validateAfcSr1ImageBasis(input.sourceEmptyBasis);
  validateAfcSr1ImageBasis(input.targetOriginalBasis);
  sha256(input.transferRecordFingerprint, "transfer_record_fingerprint");
  const sameGrid = input.sourceEmptyBasis.decodedWidth === input.targetOriginalBasis.decodedWidth &&
    input.sourceEmptyBasis.decodedHeight === input.targetOriginalBasis.decodedHeight;
  const relativeAspectError = computeAfcSr1RelativeAspectError(
    input.sourceEmptyBasis,
    input.targetOriginalBasis
  );
  if (input.compatibilityTier === "exact_grid_compatible" && !sameGrid) fail("placement_exact_grid_mismatch");
  if (input.compatibilityTier === "aspect_compatible_rescaled" &&
      relativeAspectError > AFC_SR1_ASPECT_RELATIVE_ERROR_TOLERANCE) {
    fail("placement_aspect_mismatch");
  }
  if (input.method === "already_original_basis" &&
      (!equalBasis(input.sourceEmptyBasis, input.targetOriginalBasis) ||
       input.compatibilityTier !== "exact_grid_compatible")) {
    fail("placement_already_original_inconsistent");
  }
  return Object.freeze({
    schemaVersion: AFC_SR1_ORIGINAL_BASIS_PLACEMENT_VERSION,
    status: "placed_on_original_basis",
    method: input.method,
    sourceEmptyBasis: cloneBasis(input.sourceEmptyBasis),
    targetOriginalBasis: cloneBasis(input.targetOriginalBasis),
    compatibilityTier: input.compatibilityTier,
    transferRecordFingerprint: input.transferRecordFingerprint,
  });
}

function validateSeam(
  value: unknown,
  corner: AfcSr1AdjustableCorner,
  polygon?: AfcSr1SourcePolygon
): asserts value is AfcSr1CanonicalNearToFarSeamV1 {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["direction", "adjustableCorner", "seamStartNear", "seamEndFar"]) ||
      value.direction !== "near_to_far" || value.adjustableCorner !== corner) {
    fail("canonical_seam_shape_invalid");
  }
  const points = [value.seamStartNear, value.seamEndFar];
  if (!points.every(point => isPlainRecord(point) && hasExactKeys(point, ["x", "y"]))) fail("canonical_seam_point_invalid");
  for (const point of points) {
    finite((point as AfcSr1Point).x, "canonical_seam_x");
    finite((point as AfcSr1Point).y, "canonical_seam_y");
    if (!validateFloorSourcePointExtent(point as AfcSr1Point).ok) {
      fail("canonical_seam_extent_invalid");
    }
  }
  if (equalPoint(value.seamStartNear as AfcSr1Point, value.seamEndFar as AfcSr1Point)) fail("canonical_seam_collapsed");
  if (polygon) {
    const start = corner === "NL" ? polygon[0] : polygon[1];
    const end = corner === "NL" ? polygon[3] : polygon[2];
    if (!equalPoint(value.seamStartNear as AfcSr1Point, start) ||
        !equalPoint(value.seamEndFar as AfcSr1Point, end)) {
      fail("canonical_seam_reversed_or_not_derived");
    }
  }
}

export function validateAfcSr1CanonicalNearToFarSeam(
  seam: AfcSr1CanonicalNearToFarSeamV1,
  polygon?: AfcSr1SourcePolygon
): void {
  validateSeam(seam, seam.adjustableCorner, polygon);
}

export function deriveAfcSr1CanonicalNearToFarSeams(
  polygon: AfcSr1SourcePolygon
): Readonly<{ NL: AfcSr1CanonicalNearToFarSeamV1; NR: AfcSr1CanonicalNearToFarSeamV1 }> {
  validateAfcSr1SourcePolygon(polygon);
  return Object.freeze({
    NL: Object.freeze({
      direction: "near_to_far" as const,
      adjustableCorner: "NL" as const,
      seamStartNear: clonePoint(polygon[0]),
      seamEndFar: clonePoint(polygon[3]),
    }),
    NR: Object.freeze({
      direction: "near_to_far" as const,
      adjustableCorner: "NR" as const,
      seamStartNear: clonePoint(polygon[1]),
      seamEndFar: clonePoint(polygon[2]),
    }),
  });
}

export function pointOnAfcSr1NearToFarSeam(
  seam: AfcSr1CanonicalNearToFarSeamV1,
  seamT: number
): AfcSr1Point {
  validateAfcSr1CanonicalNearToFarSeam(seam);
  finite(seamT, "seam_t");
  return Object.freeze({
    x: seam.seamStartNear.x + seamT * (seam.seamEndFar.x - seam.seamStartNear.x),
    y: seam.seamStartNear.y + seamT * (seam.seamEndFar.y - seam.seamStartNear.y),
  });
}

export function projectPointOntoAfcSr1NearToFarSeam(
  seam: AfcSr1CanonicalNearToFarSeamV1,
  point: AfcSr1Point
): Readonly<{ seamT: number; point: AfcSr1Point; perpendicularErrorSourceNorm: number }> {
  validateAfcSr1CanonicalNearToFarSeam(seam);
  if (!isPlainRecord(point) || !hasExactKeys(point, ["x", "y"])) fail("projection_point_shape_invalid");
  finite(point.x, "projection_point_x");
  finite(point.y, "projection_point_y");
  const dx = seam.seamEndFar.x - seam.seamStartNear.x;
  const dy = seam.seamEndFar.y - seam.seamStartNear.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!Number.isFinite(lengthSquared) || lengthSquared === 0) fail("canonical_seam_collapsed");
  const seamT = ((point.x - seam.seamStartNear.x) * dx + (point.y - seam.seamStartNear.y) * dy) / lengthSquared;
  const projected = pointOnAfcSr1NearToFarSeam(seam, seamT);
  return Object.freeze({
    seamT,
    point: projected,
    perpendicularErrorSourceNorm: Math.hypot(point.x - projected.x, point.y - projected.y),
  });
}

function hypothesesFromPolygon(polygon: AfcSr1SourcePolygon): AfcSr1SemanticHypothesisSetV1 {
  const seams = deriveAfcSr1CanonicalNearToFarSeams(polygon);
  return Object.freeze({ none: true as const, NL: seams.NL, NR: seams.NR });
}

function validateHypotheses(value: unknown, polygon: AfcSr1SourcePolygon): asserts value is AfcSr1SemanticHypothesisSetV1 {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["none", "NL", "NR"]) || value.none !== true) {
    fail("complete_hypothesis_set_invalid");
  }
  validateSeam(value.NL, "NL", polygon);
  validateSeam(value.NR, "NR", polygon);
}

export function buildAfcSr1OverlayDescriptor(input: Readonly<{
  originalTargetBasis: AfcSr1ImageBasisV1;
  rawSourcePolygon: AfcSr1SourcePolygon;
  overlayGenerationId: string;
}>): AfcSr1OverlayDescriptorV1 {
  validateAfcSr1ImageBasis(input.originalTargetBasis);
  validateAfcSr1SourcePolygon(input.rawSourcePolygon);
  text(input.overlayGenerationId, "overlay_generation_id");
  return Object.freeze({
    schemaVersion: AFC_SR1_OVERLAY_DESCRIPTOR_VERSION,
    originalTargetBasis: cloneBasis(input.originalTargetBasis),
    coordinateSpace: AFC_SR1_COORDINATE_SPACE,
    rawSourcePolygon: clonePolygon(input.rawSourcePolygon),
    semanticCornerLabels: AFC_SR1_SEMANTIC_ORDER,
    hypotheses: hypothesesFromPolygon(input.rawSourcePolygon),
    visualInstructions: Object.freeze({
      showFullPolygon: true,
      showCornerLabels: true,
      showNlCandidateSeam: true,
      showNrCandidateSeam: true,
      showNearToFarDirection: true,
      showReplacementPolygon: false,
      showCameraGeometry: false,
    }),
    overlayGenerationId: input.overlayGenerationId,
  });
}

export function fingerprintAfcSr1OverlayDescriptor(descriptor: AfcSr1OverlayDescriptorV1): string {
  validateAfcSr1OverlayDescriptor(descriptor);
  return sha256HexUtf8(canonicalizeRfc8785Jcs(descriptor));
}

export function validateAfcSr1OverlayDescriptor(value: unknown): asserts value is AfcSr1OverlayDescriptorV1 {
  const keys = [
    "schemaVersion", "originalTargetBasis", "coordinateSpace", "rawSourcePolygon",
    "semanticCornerLabels", "hypotheses", "visualInstructions", "overlayGenerationId",
  ];
  if (!isPlainRecord(value) || !hasExactKeys(value, keys) ||
      value.schemaVersion !== AFC_SR1_OVERLAY_DESCRIPTOR_VERSION ||
      value.coordinateSpace !== AFC_SR1_COORDINATE_SPACE) fail("overlay_descriptor_shape_invalid");
  validateAfcSr1ImageBasis(value.originalTargetBasis);
  validateAfcSr1SourcePolygon(value.rawSourcePolygon);
  sameTextTuple(value.semanticCornerLabels, AFC_SR1_SEMANTIC_ORDER, "overlay_semantic_order");
  validateHypotheses(value.hypotheses, value.rawSourcePolygon);
  if (!isPlainRecord(value.visualInstructions) || !hasExactKeys(value.visualInstructions, [
    "showFullPolygon", "showCornerLabels", "showNlCandidateSeam", "showNrCandidateSeam",
    "showNearToFarDirection", "showReplacementPolygon", "showCameraGeometry",
  ]) ||
    value.visualInstructions.showFullPolygon !== true ||
    value.visualInstructions.showCornerLabels !== true ||
    value.visualInstructions.showNlCandidateSeam !== true ||
    value.visualInstructions.showNrCandidateSeam !== true ||
    value.visualInstructions.showNearToFarDirection !== true ||
    value.visualInstructions.showReplacementPolygon !== false ||
    value.visualInstructions.showCameraGeometry !== false) {
    fail("overlay_visual_instructions_invalid");
  }
  text(value.overlayGenerationId, "overlay_generation_id");
}

export function buildAfcSr1SemanticPriorBinding(input: Readonly<{
  replayEvidence: AfcSr1ReplayVerifiedEmptyCandidateIdentityV1;
  placement: AfcSr1OriginalBasisPlacementV1;
  rawSourcePolygon: AfcSr1SourcePolygon;
  overlayGenerationId: string;
  requestGenerationId: string;
}>): AfcSr1SemanticPriorBindingV1 {
  validateAfcSr1ReplayEvidenceIdentity(input.replayEvidence);
  const placement = buildAfcSr1OriginalBasisPlacement(input.placement);
  validateAfcSr1SourcePolygon(input.rawSourcePolygon);
  text(input.overlayGenerationId, "overlay_generation_id");
  text(input.requestGenerationId, "request_generation_id");
  if (input.replayEvidence.originalImageFingerprint !== placement.targetOriginalBasis.fingerprint) {
    fail("binding_original_target_basis_mismatch");
  }
  if (placement.method === "verified_source_normalized_transfer" &&
      input.replayEvidence.emptyRoomAssistFingerprint !== placement.sourceEmptyBasis.fingerprint) {
    fail("binding_empty_source_basis_mismatch");
  }
  return Object.freeze({
    schemaVersion: AFC_SR1_SEMANTIC_PRIOR_BINDING_VERSION,
    replayEvidence: Object.freeze({ ...input.replayEvidence }),
    placement,
    coordinateSpace: AFC_SR1_COORDINATE_SPACE,
    semanticOrder: AFC_SR1_SEMANTIC_ORDER,
    rawSourcePolygon: clonePolygon(input.rawSourcePolygon),
    rawSourcePolygonFingerprint: fingerprintAfcSr1SourcePolygon(input.rawSourcePolygon),
    hypotheses: hypothesesFromPolygon(input.rawSourcePolygon),
    overlayGenerationId: input.overlayGenerationId,
    requestGenerationId: input.requestGenerationId,
  });
}

export function validateAfcSr1SemanticPriorBinding(value: unknown): asserts value is AfcSr1SemanticPriorBindingV1 {
  const keys = [
    "schemaVersion", "replayEvidence", "placement", "coordinateSpace", "semanticOrder",
    "rawSourcePolygon", "rawSourcePolygonFingerprint", "hypotheses",
    "overlayGenerationId", "requestGenerationId",
  ];
  if (!isPlainRecord(value) || !hasExactKeys(value, keys) ||
      value.schemaVersion !== AFC_SR1_SEMANTIC_PRIOR_BINDING_VERSION ||
      value.coordinateSpace !== AFC_SR1_COORDINATE_SPACE) fail("semantic_prior_binding_shape_invalid");
  validateAfcSr1ReplayEvidenceIdentity(value.replayEvidence);
  const placement = buildAfcSr1OriginalBasisPlacement(value.placement as AfcSr1OriginalBasisPlacementV1);
  validateAfcSr1SourcePolygon(value.rawSourcePolygon);
  sameTextTuple(value.semanticOrder, AFC_SR1_SEMANTIC_ORDER, "semantic_order");
  sha256(value.rawSourcePolygonFingerprint, "raw_source_polygon_fingerprint");
  if (value.rawSourcePolygonFingerprint !== fingerprintAfcSr1SourcePolygon(value.rawSourcePolygon)) {
    fail("raw_source_polygon_fingerprint_mismatch");
  }
  validateHypotheses(value.hypotheses, value.rawSourcePolygon);
  text(value.overlayGenerationId, "overlay_generation_id");
  text(value.requestGenerationId, "request_generation_id");
  if (value.replayEvidence.originalImageFingerprint !== placement.targetOriginalBasis.fingerprint) {
    fail("binding_original_target_basis_mismatch");
  }
  if (placement.method === "verified_source_normalized_transfer" &&
      value.replayEvidence.emptyRoomAssistFingerprint !== placement.sourceEmptyBasis.fingerprint) {
    fail("binding_empty_source_basis_mismatch");
  }
}

export function buildAfcSr1SeamBindingToken(input: Readonly<{
  semanticPriorBinding: AfcSr1SemanticPriorBindingV1;
  overlayFingerprint: string;
}>): string {
  validateAfcSr1SemanticPriorBinding(input.semanticPriorBinding);
  sha256(input.overlayFingerprint, "overlay_fingerprint");
  const preimage: AfcSr1SeamBindingTokenPreimageV1 = {
    tokenSchemaVersion: AFC_SR1_SEAM_BINDING_TOKEN_VERSION,
    semanticPriorBinding: input.semanticPriorBinding,
    overlayFingerprint: input.overlayFingerprint,
    requestGenerationId: input.semanticPriorBinding.requestGenerationId,
  };
  return `sr1sbt1:${sha256HexUtf8(canonicalizeRfc8785Jcs(preimage))}`;
}

export function buildAfcSr1SemanticPriorRequest(input: Readonly<{
  semanticPriorBinding: AfcSr1SemanticPriorBindingV1;
  overlayDescriptor: AfcSr1OverlayDescriptorV1;
}>): AfcSr1SemanticPriorRequestV1 {
  validateAfcSr1SemanticPriorBinding(input.semanticPriorBinding);
  validateAfcSr1OverlayDescriptor(input.overlayDescriptor);
  if (!equalBasis(input.semanticPriorBinding.placement.targetOriginalBasis, input.overlayDescriptor.originalTargetBasis) ||
      input.semanticPriorBinding.overlayGenerationId !== input.overlayDescriptor.overlayGenerationId ||
      fingerprintAfcSr1SourcePolygon(input.semanticPriorBinding.rawSourcePolygon) !==
        fingerprintAfcSr1SourcePolygon(input.overlayDescriptor.rawSourcePolygon)) {
    fail("binding_overlay_mismatch");
  }
  const overlayFingerprint = fingerprintAfcSr1OverlayDescriptor(input.overlayDescriptor);
  const seamBindingToken = buildAfcSr1SeamBindingToken({
    semanticPriorBinding: input.semanticPriorBinding,
    overlayFingerprint,
  });
  return Object.freeze({
    schemaVersion: AFC_SR1_SEMANTIC_PRIOR_REQUEST_VERSION,
    taskMode: "sr1_near_corner_semantic_prior/v1",
    seamBindingToken,
    requestGenerationId: input.semanticPriorBinding.requestGenerationId,
    originalImageEvidence: cloneBasis(input.semanticPriorBinding.placement.targetOriginalBasis),
    overlayFingerprint,
    supportedImageClass: "visible_back_wall_with_both_side_walls/v1",
    hypotheses: AFC_SR1_HYPOTHESES,
    geometryAuthority: "server_fixed_empty_candidate_geometry",
    advisoryOnly: true,
    allowedDecisions: AFC_SR1_ALLOWED_DECISIONS,
  });
}

export function fingerprintAfcSr1SemanticPriorRequest(request: AfcSr1SemanticPriorRequestV1): string {
  validateAfcSr1SemanticPriorRequest(request);
  return sha256HexUtf8(canonicalizeRfc8785Jcs(request));
}

export function validateAfcSr1SemanticPriorRequest(value: unknown): asserts value is AfcSr1SemanticPriorRequestV1 {
  const keys = [
    "schemaVersion", "taskMode", "seamBindingToken", "requestGenerationId",
    "originalImageEvidence", "overlayFingerprint", "supportedImageClass",
    "hypotheses", "geometryAuthority", "advisoryOnly", "allowedDecisions",
  ];
  if (!isPlainRecord(value) || !hasExactKeys(value, keys) ||
    value.schemaVersion !== AFC_SR1_SEMANTIC_PRIOR_REQUEST_VERSION ||
    value.taskMode !== "sr1_near_corner_semantic_prior/v1" ||
    value.geometryAuthority !== "server_fixed_empty_candidate_geometry" ||
    value.advisoryOnly !== true ||
    value.supportedImageClass !== "visible_back_wall_with_both_side_walls/v1" ||
    typeof value.seamBindingToken !== "string" || !/^sr1sbt1:[0-9a-f]{64}$/.test(value.seamBindingToken)) {
    fail("semantic_prior_request_shape_invalid");
  }
  text(value.requestGenerationId, "request_generation_id");
  validateAfcSr1ImageBasis(value.originalImageEvidence);
  sha256(value.overlayFingerprint, "overlay_fingerprint");
  sameTextTuple(value.hypotheses, AFC_SR1_HYPOTHESES, "request_hypotheses");
  sameTextTuple(value.allowedDecisions, AFC_SR1_ALLOWED_DECISIONS, "allowed_decisions");
}

function responseFailure(reasonCode: string): AfcSr1ParseResult {
  return Object.freeze({ ok: false, failureClass: "hard_invalid", reasonCode });
}

function parseRankedHypotheses(value: unknown): readonly [
  AfcSr1RankedHypothesisV1,
  AfcSr1RankedHypothesisV1,
  AfcSr1RankedHypothesisV1,
] | null {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length !== 3) return null;
  const ranks: AfcSr1RankedHypothesisV1[] = [];
  for (const item of value) {
    if (!isPlainRecord(item) || !hasExactKeys(item, ["hypothesis", "score"]) ||
        !AFC_SR1_HYPOTHESES.includes(item.hypothesis as AfcSr1Hypothesis) ||
        typeof item.score !== "number" || !Number.isFinite(item.score)) return null;
    ranks.push(Object.freeze({ hypothesis: item.hypothesis as AfcSr1Hypothesis, score: item.score }));
  }
  return ranks as unknown as readonly [
    AfcSr1RankedHypothesisV1,
    AfcSr1RankedHypothesisV1,
    AfcSr1RankedHypothesisV1,
  ];
}

function parseSeamTPrior(value: unknown): AfcSr1SeamTPriorV1 | null | undefined {
  if (value === null) return null;
  if (!isPlainRecord(value) || !hasExactKeys(value, ["adjustableCorner", "preferredSeamT", "minSeamT", "maxSeamT"]) ||
      !["NL", "NR"].includes(value.adjustableCorner as string) ||
      !(value.preferredSeamT === null || (typeof value.preferredSeamT === "number" && Number.isFinite(value.preferredSeamT))) ||
      ![value.minSeamT, value.maxSeamT].every(item => typeof item === "number" && Number.isFinite(item))) {
    return undefined;
  }
  return Object.freeze({
    adjustableCorner: value.adjustableCorner as AfcSr1AdjustableCorner,
    preferredSeamT: value.preferredSeamT as number | null,
    minSeamT: value.minSeamT as number,
    maxSeamT: value.maxSeamT as number,
  });
}

export function parseAfcSr1SemanticPriorResponse(value: unknown): AfcSr1ParseResult {
  const keys = ["schemaVersion", "bindingEcho", "decision", "rankedHypotheses", "seamTPrior", "semanticLabels"];
  if (!isPlainRecord(value) || !hasExactKeys(value, keys) ||
      value.schemaVersion !== AFC_SR1_SEMANTIC_PRIOR_RESPONSE_VERSION ||
      typeof value.bindingEcho !== "string" || !/^sr1sbt1:[0-9a-f]{64}$/.test(value.bindingEcho) ||
      !AFC_SR1_ALLOWED_DECISIONS.includes(value.decision as AfcSr1SemanticPriorDecisionV1) ||
      !Array.isArray(value.semanticLabels) ||
      !value.semanticLabels.every(label => REASON_LABELS.has(label as AfcSr1SemanticReasonLabelV1)) ||
      new Set(value.semanticLabels).size !== value.semanticLabels.length) {
    return responseFailure("response_schema_invalid");
  }
  const rankedHypotheses = parseRankedHypotheses(value.rankedHypotheses);
  const seamTPrior = parseSeamTPrior(value.seamTPrior);
  if (rankedHypotheses === null && value.rankedHypotheses !== null) return responseFailure("ranked_hypotheses_invalid");
  if (seamTPrior === undefined) return responseFailure("seam_t_prior_invalid");
  const decision = value.decision as AfcSr1SemanticPriorDecisionV1;
  const nonGeometric = ["abstain", "unsupported_image_class", "insufficient_evidence"].includes(decision);
  if (nonGeometric && (rankedHypotheses !== null || seamTPrior !== null)) return responseFailure("non_geometric_response_contains_geometry");
  if (!nonGeometric) {
    if (rankedHypotheses === null) return responseFailure("geometric_response_missing_ranking");
    const hypotheses = rankedHypotheses.map(rank => rank.hypothesis);
    if (new Set(hypotheses).size !== 3 || !AFC_SR1_HYPOTHESES.every(hypothesis => hypotheses.includes(hypothesis))) {
      return responseFailure("ranked_hypotheses_not_complete");
    }
    if (rankedHypotheses.some(rank => rank.score < 0 || rank.score > 1) ||
        rankedHypotheses[0].score < rankedHypotheses[1].score ||
        rankedHypotheses[1].score < rankedHypotheses[2].score ||
        Math.abs(rankedHypotheses.reduce((sum, rank) => sum + rank.score, 0) - 1) > AFC_SR1_SCORE_TOTAL_TOLERANCE) {
      return responseFailure("ranked_hypotheses_scores_invalid");
    }
    const expected = decision === "no_adjustment" ? "none" : decision === "adjust_nl" ? "NL" : "NR";
    if (rankedHypotheses[0].hypothesis !== expected) return responseFailure("decision_rank_conflict");
    if (decision === "no_adjustment" && seamTPrior !== null) return responseFailure("no_adjustment_contains_seam_prior");
    if (seamTPrior !== null) {
      if (seamTPrior.minSeamT < 0 || seamTPrior.maxSeamT > 1 ||
          seamTPrior.minSeamT > seamTPrior.maxSeamT ||
          (seamTPrior.preferredSeamT !== null &&
            (seamTPrior.preferredSeamT < seamTPrior.minSeamT || seamTPrior.preferredSeamT > seamTPrior.maxSeamT)) ||
          seamTPrior.adjustableCorner !== expected) {
        return responseFailure("seam_t_prior_constraint_invalid");
      }
    }
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      schemaVersion: AFC_SR1_SEMANTIC_PRIOR_RESPONSE_VERSION,
      bindingEcho: value.bindingEcho,
      decision,
      rankedHypotheses: rankedHypotheses === null ? null : Object.freeze([...rankedHypotheses]) as AfcSr1SemanticPriorResponseV1["rankedHypotheses"],
      seamTPrior,
      semanticLabels: Object.freeze([...value.semanticLabels]) as readonly AfcSr1SemanticReasonLabelV1[],
    }),
  });
}

export function validateAfcSr1SemanticPriorResponse(input: Readonly<{
  response: unknown;
  semanticPriorBinding: AfcSr1SemanticPriorBindingV1;
  overlayDescriptor: AfcSr1OverlayDescriptorV1;
  request: AfcSr1SemanticPriorRequestV1;
}>): AfcSr1ValidationResult {
  const parsed = parseAfcSr1SemanticPriorResponse(input.response);
  if (!parsed.ok) return parsed;
  try {
    validateAfcSr1SemanticPriorBinding(input.semanticPriorBinding);
    validateAfcSr1OverlayDescriptor(input.overlayDescriptor);
    validateAfcSr1SemanticPriorRequest(input.request);
  } catch (error) {
    return Object.freeze({ ok: false, failureClass: "hard_invalid", reasonCode: (error as Error).message });
  }
  const expectedRequest = buildAfcSr1SemanticPriorRequest({
    semanticPriorBinding: input.semanticPriorBinding,
    overlayDescriptor: input.overlayDescriptor,
  });
  if (input.request.seamBindingToken !== expectedRequest.seamBindingToken ||
      input.request.overlayFingerprint !== expectedRequest.overlayFingerprint ||
      input.request.requestGenerationId !== expectedRequest.requestGenerationId ||
      !equalBasis(input.request.originalImageEvidence, expectedRequest.originalImageEvidence) ||
      parsed.value.bindingEcho !== expectedRequest.seamBindingToken) {
    return Object.freeze({ ok: false, failureClass: "stale", reasonCode: "binding_or_request_mismatch" });
  }
  const status: AfcSr1ValidatedAdvisoryStatusV1 =
    parsed.value.decision === "unsupported_image_class" ? "unsupported" :
    ["abstain", "insufficient_evidence"].includes(parsed.value.decision) ? "safe_abstention" :
    "usable";
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      schemaVersion: AFC_SR1_VALIDATED_ADVISORY_VERSION,
      status,
      bindingToken: expectedRequest.seamBindingToken,
      decision: parsed.value.decision,
      rankedHypotheses: parsed.value.rankedHypotheses,
      seamTPrior: parsed.value.seamTPrior,
      semanticLabels: parsed.value.semanticLabels,
      parserVersion: AFC_SR1_VALIDATED_ADVISORY_PARSER_VERSION,
    }),
  });
}

function validateAfcSr1ValidatedAdvisory(value: unknown): asserts value is AfcSr1ValidatedAdvisoryV1 {
  const keys = [
    "schemaVersion", "status", "bindingToken", "decision", "rankedHypotheses",
    "seamTPrior", "semanticLabels", "parserVersion",
  ];
  if (!isPlainRecord(value) || !hasExactKeys(value, keys) ||
      value.schemaVersion !== AFC_SR1_VALIDATED_ADVISORY_VERSION ||
      value.parserVersion !== AFC_SR1_VALIDATED_ADVISORY_PARSER_VERSION ||
      !["usable", "safe_abstention", "unsupported"].includes(value.status as string)) {
    fail("validated_advisory_shape_invalid");
  }
  const parsed = parseAfcSr1SemanticPriorResponse({
    schemaVersion: AFC_SR1_SEMANTIC_PRIOR_RESPONSE_VERSION,
    bindingEcho: value.bindingToken,
    decision: value.decision,
    rankedHypotheses: value.rankedHypotheses,
    seamTPrior: value.seamTPrior,
    semanticLabels: value.semanticLabels,
  });
  if (!parsed.ok) fail(`validated_advisory_${parsed.reasonCode}`);
  const expectedStatus =
    parsed.value.decision === "unsupported_image_class" ? "unsupported" :
    ["abstain", "insufficient_evidence"].includes(parsed.value.decision) ? "safe_abstention" :
    "usable";
  if (value.status !== expectedStatus) fail("validated_advisory_status_invalid");
}

export function buildAfcSr1SemanticPriorReplay(input: Omit<AfcSr1SemanticPriorReplayV1, "schemaVersion" | "requestDigest">): AfcSr1SemanticPriorReplayV1 {
  validateAfcSr1SemanticPriorBinding(input.semanticPriorBinding);
  validateAfcSr1OverlayDescriptor(input.overlayDescriptor);
  validateAfcSr1SemanticPriorRequest(input.request);
  if (input.bindingToken !== input.request.seamBindingToken ||
      input.overlayFingerprint !== fingerprintAfcSr1OverlayDescriptor(input.overlayDescriptor) ||
      input.request.overlayFingerprint !== input.overlayFingerprint ||
      input.request.requestGenerationId !== input.semanticPriorBinding.requestGenerationId) {
    fail("replay_binding_mismatch");
  }
  if (!isPlainRecord(input.executionProvenance) || !hasExactKeys(input.executionProvenance, [
    "providerId", "modelId", "providerModelVersion", "attempt", "requestedAt", "receivedAt",
  ]) || !Number.isInteger(input.executionProvenance.attempt) || input.executionProvenance.attempt < 0 ||
    ![input.executionProvenance.providerId, input.executionProvenance.modelId, input.executionProvenance.providerModelVersion,
      input.executionProvenance.requestedAt, input.executionProvenance.receivedAt].every(item => item === null || (typeof item === "string" && item.length > 0)) ||
    !(input.rawProviderResponse === null || typeof input.rawProviderResponse === "string")) {
    fail("replay_execution_provenance_invalid");
  }
  if (input.parsedResponse !== null && !parseAfcSr1SemanticPriorResponse(input.parsedResponse).ok) {
    fail("replay_parsed_response_invalid");
  }
  const validation = input.validation as unknown;
  if (isPlainRecord(validation) && validation.schemaVersion === AFC_SR1_VALIDATED_ADVISORY_VERSION) {
    validateAfcSr1ValidatedAdvisory(validation);
    if (validation.bindingToken !== input.bindingToken) fail("replay_validation_binding_mismatch");
  } else if (!isPlainRecord(validation) ||
      !hasExactKeys(validation, ["status", "reasonCode"]) ||
      !["hard_invalid", "stale", "retryable_provider_failure"].includes(validation.status as string) ||
      typeof validation.reasonCode !== "string" || validation.reasonCode.length === 0) {
    fail("replay_validation_invalid");
  }
  return Object.freeze({
    schemaVersion: AFC_SR1_SEMANTIC_PRIOR_REPLAY_VERSION,
    ...input,
    requestDigest: fingerprintAfcSr1SemanticPriorRequest(input.request),
  });
}

export function buildAfcSr1SolverHandoff(input: Readonly<{
  semanticPriorBinding: AfcSr1SemanticPriorBindingV1;
  bindingToken: string;
  advisory: AfcSr1ValidatedAdvisoryV1;
}>): AfcSr1SolverHandoffV1 {
  validateAfcSr1SemanticPriorBinding(input.semanticPriorBinding);
  validateAfcSr1ValidatedAdvisory(input.advisory);
  if (!/^sr1sbt1:[0-9a-f]{64}$/.test(input.bindingToken) ||
      input.advisory.bindingToken !== input.bindingToken) {
    fail("solver_handoff_binding_invalid");
  }
  return Object.freeze({
    schemaVersion: AFC_SR1_SOLVER_HANDOFF_VERSION,
    bindingToken: input.bindingToken,
    replayEvidence: input.semanticPriorBinding.replayEvidence,
    originalBasisPlacement: input.semanticPriorBinding.placement,
    originalTargetBasis: input.semanticPriorBinding.placement.targetOriginalBasis,
    coordinateSpace: AFC_SR1_COORDINATE_SPACE,
    semanticOrder: AFC_SR1_SEMANTIC_ORDER,
    rawSourcePolygon: input.semanticPriorBinding.rawSourcePolygon,
    rawSourcePolygonFingerprint: input.semanticPriorBinding.rawSourcePolygonFingerprint,
    allowedHypotheses: AFC_SR1_HYPOTHESES,
    canonicalSeams: Object.freeze({
      NL: input.semanticPriorBinding.hypotheses.NL,
      NR: input.semanticPriorBinding.hypotheses.NR,
    }),
    advisory: input.advisory,
  });
}
