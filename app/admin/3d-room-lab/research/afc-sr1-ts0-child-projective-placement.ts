import { createHash } from "node:crypto";

import {
  canonicalizeRfc8785Jcs,
  sha256HexUtf8,
} from "../gemini-evidence-contract";
import type { AfcSr1PixelLineV1 } from "./afc-sr1-floor-vanishing-line-cross-room";
import { normalizeCanonicalLine } from "./afc-sr1-homogeneous-geometry";
import {
  isAfcSr1ValidatedTs0ParentChildLineageAuthority,
  type AfcSr1ValidatedTs0ParentChildLineageAuthorityV1,
} from "./afc-sr1-ts0-parent-child-lineage-authority";

export const AFC_SR1_TS0_CHILD_PROJECTIVE_PLACEMENT_VERSION =
  "afc-sr1-ts0-child-projective-placement/v1" as const;
export const AFC_SR1_TS0_CHILD_PROJECTIVE_PLACEMENT_POLICY_VERSION =
  "afc-sr1-ts0-child-projective-placement-policy/v1" as const;
export const AFC_SR1_TS0_PLACEMENT_ORIENTATION = 1 as const;
export const AFC_SR1_TS0_PLACEMENT_COORDINATE_SPACE =
  "source-normalized/v1" as const;
export const AFC_SR1_TS0_PLACEMENT_MASK_ROLE =
  "registration_exclusion_support_only_not_placement_authority" as const;

export type AfcSr1Ts0PlacementImageBasisV1 = Readonly<{
  sha256: string;
  byteCount: number;
  decodedWidth: number | null;
  decodedHeight: number | null;
  orientation: typeof AFC_SR1_TS0_PLACEMENT_ORIENTATION;
}>;

export type AfcSr1Ts0PlacementDecodedImageBasisV1 = Readonly<{
  sha256: string;
  byteCount: number;
  decodedWidth: number;
  decodedHeight: number;
  orientation: typeof AFC_SR1_TS0_PLACEMENT_ORIENTATION;
}>;

export type AfcSr1Ts0LineageIdentityV1 = Readonly<{
  parent: AfcSr1Ts0PlacementImageBasisV1;
  child: AfcSr1Ts0PlacementImageBasisV1;
}>;

export type AfcSr1Ts0PlacementMaskEvidenceLabelV1 =
  | "STRICT_EMPTY_POLYGON_USED_AS_REGISTRATION_EXCLUSION_MASK_ONLY"
  | "NON_AUTHORITATIVE_RESEARCH_MASK_ONLY";

export type AfcSr1Ts0PlacementRegistrationMaskIdentityV1 = Readonly<{
  coordinateSpace: typeof AFC_SR1_TS0_PLACEMENT_COORDINATE_SPACE;
  role: typeof AFC_SR1_TS0_PLACEMENT_MASK_ROLE;
  evidenceLabel: AfcSr1Ts0PlacementMaskEvidenceLabelV1;
  polygon: readonly (readonly [number, number])[];
  rasterization: Readonly<{
    pixelConversion: "int(round(norm * dimension))";
    dilationKernel: readonly [9, 9];
    dilationIterations: 2;
    usableMaskConvention: "inverse_uint8_255";
  }>;
  parentUsableMaskSha256: string;
  childUsableMaskSha256: string;
  maskDigest: string;
}>;

export type AfcSr1Ts0PlacementRuntimeIdentityV1 = Readonly<{
  placementModuleVersion: typeof AFC_SR1_TS0_CHILD_PROJECTIVE_PLACEMENT_VERSION;
  opencvVersion: "4.11.0";
  numpyVersion: "2.4.6";
  cvRngSeed: 0;
  cvNumThreads: 1;
}>;

export type AfcSr1Ts0PlacementTranslationPxV1 = Readonly<{
  tx: number;
  ty: number;
}>;

export type AfcSr1Ts0PlacementHNormV1 = readonly [
  readonly [number, 0, number],
  readonly [0, number, number],
  readonly [0, 0, 1],
];

export const AFC_SR1_TS0_PLACEMENT_THRESHOLDS_V1 = Object.freeze({
  minimumSiftMatches: 12,
  minimumFinalInliers: 40,
  maximumFitP90Px: 2,
  maximumValidationP90Px: 3.5,
  maximumCellP90Px: 5,
  minimumOccupiedCells: 4,
  minimumQuadrants: 2,
  minimumXExtentFraction: 0.25,
  minimumYExtentFraction: 0.2,
  maximumCollinearityScore: 0.85,
  minimumAkazeMatches: 20,
  maximumAkazeTransferP90Px: 3.5,
  minimumEdgeSupport: 2000,
  minimumEdgeHitRate: 0.55,
  percentileMethod: "linear" as const,
});

export type AfcSr1Ts0PlacementDiagnosticsV1 = Readonly<{
  sift: Readonly<{
    parentKeypoints: number | null;
    childKeypoints: number | null;
    goodMatches: number | null;
    finalInliers: number | null;
    inlierRule: "residual_px < 3.0";
    fitP90Px: number | null;
  }>;
  holdout: Readonly<{
    partition: "4x4_even_odd" | "median_x_fallback" | null;
    fitCount: number | null;
    validationCount: number | null;
    fitTranslationPx: AfcSr1Ts0PlacementTranslationPxV1 | null;
    validationP90Px: number | null;
  }>;
  coverage: Readonly<{
    occupiedCells: number | null;
    quadrants: number | null;
    xExtentFraction: number | null;
    yExtentFraction: number | null;
    collinearityScore: number | null;
    maxCellP90Px: number | null;
  }>;
  akaze: Readonly<{
    parentKeypoints: number | null;
    childKeypoints: number | null;
    goodMatches: number | null;
    transferP90Px: number | null;
    refitApplied: false;
  }>;
  canny: Readonly<{
    supportCount: number | null;
    hitCount: number | null;
    hitRate: number | null;
    refitApplied: false;
  }>;
  thresholds: typeof AFC_SR1_TS0_PLACEMENT_THRESHOLDS_V1;
}>;

export type AfcSr1Ts0PlacementRejectionReasonV1 =
  | "invalid_source_image"
  | "invalid_target_image"
  | "registration_mask_missing"
  | "lineage_mismatch"
  | "insufficient_correspondence"
  | "degenerate_correspondence_geometry"
  | "insufficient_spatial_coverage"
  | "fit_residual_exceeds_limit"
  | "validation_residual_exceeds_limit"
  | "nonprojective_drift_detected"
  | "translation_not_finite"
  | "deterministic_replay_failed";

export type AfcSr1Ts0ChildProjectivePlacementReceiptV1 = Readonly<{
  schemaVersion: typeof AFC_SR1_TS0_CHILD_PROJECTIVE_PLACEMENT_VERSION;
  policyVersion: typeof AFC_SR1_TS0_CHILD_PROJECTIVE_PLACEMENT_POLICY_VERSION;
  sourceImageBasis: AfcSr1Ts0PlacementImageBasisV1;
  targetImageBasis: AfcSr1Ts0PlacementImageBasisV1;
  ts0Lineage: AfcSr1Ts0LineageIdentityV1;
  registrationMaskIdentity: AfcSr1Ts0PlacementRegistrationMaskIdentityV1 | null;
  transformType: "translation";
  transformDirection: "parent_to_child";
  translationPx: AfcSr1Ts0PlacementTranslationPxV1 | null;
  H_norm: AfcSr1Ts0PlacementHNormV1 | null;
  diagnostics: AfcSr1Ts0PlacementDiagnosticsV1;
  runtimeIdentity: AfcSr1Ts0PlacementRuntimeIdentityV1;
  status: "usable" | "rejected";
  reason: AfcSr1Ts0PlacementRejectionReasonV1 | null;
  evidenceCanonicalJson: string;
  evidenceDigest: Readonly<{
    algorithm: "sha256";
    encoding: "hex";
    value: string;
  }>;
  elapsedMs: number;
}>;

export type AfcSr1Ts0PlacementExpectedIdentityV1 = Readonly<{
  sourceImageBasis: AfcSr1Ts0PlacementImageBasisV1;
  targetImageBasis: AfcSr1Ts0PlacementImageBasisV1;
  ts0Lineage: AfcSr1Ts0LineageIdentityV1;
  registrationMaskIdentity: AfcSr1Ts0PlacementRegistrationMaskIdentityV1 | null;
}>;

export type AfcSr1Ts0PlacementUsableValidationInputV1 = Readonly<{
  parentBytes: Uint8Array;
  childBytes: Uint8Array;
  lineageAuthority: AfcSr1ValidatedTs0ParentChildLineageAuthorityV1;
}>;

export type AfcSr1Ts0PlacementValidationContextV1 =
  | AfcSr1Ts0PlacementUsableValidationInputV1
  | Readonly<{
      expectedRejectedIdentity: AfcSr1Ts0PlacementExpectedIdentityV1;
    }>;

declare const AFC_SR1_VALIDATED_TS0_PLACEMENT_AUTHORITY: unique symbol;

export type AfcSr1ValidatedTs0ChildProjectivePlacementAuthorityV1 = Readonly<{
  schemaVersion: typeof AFC_SR1_TS0_CHILD_PROJECTIVE_PLACEMENT_VERSION;
  policyVersion: typeof AFC_SR1_TS0_CHILD_PROJECTIVE_PLACEMENT_POLICY_VERSION;
  sourceImageBasis: AfcSr1Ts0PlacementDecodedImageBasisV1;
  targetImageBasis: AfcSr1Ts0PlacementDecodedImageBasisV1;
  ts0Lineage: Readonly<{
    parent: AfcSr1Ts0PlacementDecodedImageBasisV1;
    child: AfcSr1Ts0PlacementDecodedImageBasisV1;
  }>;
  registrationMaskIdentity: AfcSr1Ts0PlacementRegistrationMaskIdentityV1;
  transformType: "translation";
  transformDirection: "parent_to_child";
  translationPx: AfcSr1Ts0PlacementTranslationPxV1;
  H_norm: AfcSr1Ts0PlacementHNormV1;
  receiptEvidenceDigest: string;
  readonly [AFC_SR1_VALIDATED_TS0_PLACEMENT_AUTHORITY]:
    "afc-sr1-validated-ts0-child-projective-placement-authority/v1";
}>;

const SHA256_HEX = /^[0-9a-f]{64}$/;
const REJECTION_REASONS = new Set<AfcSr1Ts0PlacementRejectionReasonV1>([
  "invalid_source_image",
  "invalid_target_image",
  "registration_mask_missing",
  "lineage_mismatch",
  "insufficient_correspondence",
  "degenerate_correspondence_geometry",
  "insufficient_spatial_coverage",
  "fit_residual_exceeds_limit",
  "validation_residual_exceeds_limit",
  "nonprojective_drift_detected",
  "translation_not_finite",
  "deterministic_replay_failed",
]);
const MASK_LABELS = new Set<AfcSr1Ts0PlacementMaskEvidenceLabelV1>([
  "STRICT_EMPTY_POLYGON_USED_AS_REGISTRATION_EXCLUSION_MASK_ONLY",
  "NON_AUTHORITATIVE_RESEARCH_MASK_ONLY",
]);
const placementAuthorities = new WeakSet<object>();
const authorityByReceipt =
  new WeakMap<object, AfcSr1ValidatedTs0ChildProjectivePlacementAuthorityV1>();

function fail(reason: string): never {
  throw new Error(`AFC-SR1 TS0 child projective placement: ${reason}`);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function finiteOrNull(value: unknown): value is number | null {
  return value === null || finite(value);
}

function nonNegativeIntegerOrNull(value: unknown): value is number | null {
  return value === null ||
    (typeof value === "number" && Number.isInteger(value) && value >= 0);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_HEX.test(value);
}

function equalJson(left: unknown, right: unknown): boolean {
  return canonicalizeRfc8785Jcs(left) === canonicalizeRfc8785Jcs(right);
}

function validateImageBasis(
  value: unknown
): asserts value is AfcSr1Ts0PlacementImageBasisV1 {
  if (!isPlainRecord(value) ||
      !hasExactKeys(value, [
        "sha256", "byteCount", "decodedWidth", "decodedHeight", "orientation",
      ]) ||
      !isSha256(value.sha256) ||
      typeof value.byteCount !== "number" ||
      !Number.isInteger(value.byteCount) ||
      value.byteCount < 0 ||
      (value.decodedWidth !== null && !positiveInteger(value.decodedWidth)) ||
      (value.decodedHeight !== null && !positiveInteger(value.decodedHeight)) ||
      ((value.decodedWidth === null) !== (value.decodedHeight === null)) ||
      value.orientation !== AFC_SR1_TS0_PLACEMENT_ORIENTATION) {
    fail("image_basis_invalid");
  }
}

function isDecodedBasis(
  value: AfcSr1Ts0PlacementImageBasisV1
): value is AfcSr1Ts0PlacementDecodedImageBasisV1 {
  return value.decodedWidth !== null && value.decodedHeight !== null;
}

function validateLineage(
  value: unknown
): asserts value is AfcSr1Ts0LineageIdentityV1 {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["parent", "child"])) {
    fail("lineage_invalid");
  }
  validateImageBasis(value.parent);
  validateImageBasis(value.child);
}

function validateTranslation(
  value: unknown
): asserts value is AfcSr1Ts0PlacementTranslationPxV1 {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["tx", "ty"]) ||
      !finite(value.tx) || !finite(value.ty)) {
    fail("translation_not_finite");
  }
}

export function deriveAfcSr1Ts0ChildProjectivePlacementHNorm(
  source: AfcSr1Ts0PlacementDecodedImageBasisV1,
  target: AfcSr1Ts0PlacementDecodedImageBasisV1,
  translation: AfcSr1Ts0PlacementTranslationPxV1
): AfcSr1Ts0PlacementHNormV1 {
  validateImageBasis(source);
  validateImageBasis(target);
  validateTranslation(translation);
  const first: readonly [number, 0, number] = Object.freeze([
    source.decodedWidth / target.decodedWidth,
    0,
    translation.tx / target.decodedWidth,
  ]);
  const second: readonly [0, number, number] = Object.freeze([
    0,
    source.decodedHeight / target.decodedHeight,
    translation.ty / target.decodedHeight,
  ]);
  const third: readonly [0, 0, 1] = Object.freeze([0, 0, 1]);
  return Object.freeze([first, second, third]);
}

function validateHNorm(
  value: unknown,
  expected: AfcSr1Ts0PlacementHNormV1
): asserts value is AfcSr1Ts0PlacementHNormV1 {
  if (!Array.isArray(value) || value.length !== 3 ||
      !value.every((row) => Array.isArray(row) && row.length === 3) ||
      !(value as unknown[][]).flat().every(finite) ||
      !equalJson(value, expected)) {
    fail("derived_h_norm_mismatch");
  }
}

function validateMask(
  value: unknown
): asserts value is AfcSr1Ts0PlacementRegistrationMaskIdentityV1 {
  if (!isPlainRecord(value) ||
      !hasExactKeys(value, [
        "coordinateSpace", "role", "evidenceLabel", "polygon", "rasterization",
        "parentUsableMaskSha256", "childUsableMaskSha256", "maskDigest",
      ]) ||
      value.coordinateSpace !== AFC_SR1_TS0_PLACEMENT_COORDINATE_SPACE ||
      value.role !== AFC_SR1_TS0_PLACEMENT_MASK_ROLE ||
      typeof value.evidenceLabel !== "string" ||
      !MASK_LABELS.has(value.evidenceLabel as AfcSr1Ts0PlacementMaskEvidenceLabelV1) ||
      !Array.isArray(value.polygon) ||
      value.polygon.length < 3 ||
      !value.polygon.every((point) =>
        Array.isArray(point) && point.length === 2 && point.every(finite)) ||
      !isPlainRecord(value.rasterization) ||
      !hasExactKeys(value.rasterization, [
        "pixelConversion", "dilationKernel", "dilationIterations",
        "usableMaskConvention",
      ]) ||
      value.rasterization.pixelConversion !== "int(round(norm * dimension))" ||
      !equalJson(value.rasterization.dilationKernel, [9, 9]) ||
      value.rasterization.dilationIterations !== 2 ||
      value.rasterization.usableMaskConvention !== "inverse_uint8_255" ||
      !isSha256(value.parentUsableMaskSha256) ||
      !isSha256(value.childUsableMaskSha256) ||
      !isSha256(value.maskDigest)) {
    fail("registration_mask_invalid");
  }
  const { maskDigest, ...preimage } = value;
  if (maskDigest !== sha256HexUtf8(canonicalizeRfc8785Jcs(preimage))) {
    fail("registration_mask_digest_mismatch");
  }
}

function validateRuntime(
  value: unknown
): asserts value is AfcSr1Ts0PlacementRuntimeIdentityV1 {
  if (!isPlainRecord(value) ||
      !hasExactKeys(value, [
        "placementModuleVersion", "opencvVersion", "numpyVersion",
        "cvRngSeed", "cvNumThreads",
      ]) ||
      value.placementModuleVersion !== AFC_SR1_TS0_CHILD_PROJECTIVE_PLACEMENT_VERSION ||
      value.opencvVersion !== "4.11.0" ||
      value.numpyVersion !== "2.4.6" ||
      value.cvRngSeed !== 0 ||
      value.cvNumThreads !== 1) {
    fail("runtime_identity_unsupported");
  }
}

function validateDiagnostics(
  value: unknown
): asserts value is AfcSr1Ts0PlacementDiagnosticsV1 {
  if (!isPlainRecord(value) ||
      !hasExactKeys(value, [
        "sift", "holdout", "coverage", "akaze", "canny", "thresholds",
      ]) ||
      !isPlainRecord(value.sift) ||
      !hasExactKeys(value.sift, [
        "parentKeypoints", "childKeypoints", "goodMatches", "finalInliers",
        "inlierRule", "fitP90Px",
      ]) ||
      !nonNegativeIntegerOrNull(value.sift.parentKeypoints) ||
      !nonNegativeIntegerOrNull(value.sift.childKeypoints) ||
      !nonNegativeIntegerOrNull(value.sift.goodMatches) ||
      !nonNegativeIntegerOrNull(value.sift.finalInliers) ||
      value.sift.inlierRule !== "residual_px < 3.0" ||
      !finiteOrNull(value.sift.fitP90Px) ||
      (finite(value.sift.fitP90Px) && value.sift.fitP90Px < 0) ||
      !isPlainRecord(value.holdout) ||
      !hasExactKeys(value.holdout, [
        "partition", "fitCount", "validationCount", "fitTranslationPx",
        "validationP90Px",
      ]) ||
      (value.holdout.partition !== null &&
       value.holdout.partition !== "4x4_even_odd" &&
       value.holdout.partition !== "median_x_fallback") ||
      !nonNegativeIntegerOrNull(value.holdout.fitCount) ||
      !nonNegativeIntegerOrNull(value.holdout.validationCount) ||
      (value.holdout.fitTranslationPx !== null &&
       (!isPlainRecord(value.holdout.fitTranslationPx) ||
        !hasExactKeys(value.holdout.fitTranslationPx, ["tx", "ty"]) ||
        !finite(value.holdout.fitTranslationPx.tx) ||
        !finite(value.holdout.fitTranslationPx.ty))) ||
      !finiteOrNull(value.holdout.validationP90Px) ||
      (finite(value.holdout.validationP90Px) && value.holdout.validationP90Px < 0) ||
      !isPlainRecord(value.coverage) ||
      !hasExactKeys(value.coverage, [
        "occupiedCells", "quadrants", "xExtentFraction", "yExtentFraction",
        "collinearityScore", "maxCellP90Px",
      ]) ||
      !nonNegativeIntegerOrNull(value.coverage.occupiedCells) ||
      !nonNegativeIntegerOrNull(value.coverage.quadrants) ||
      !finiteOrNull(value.coverage.xExtentFraction) ||
      !finiteOrNull(value.coverage.yExtentFraction) ||
      !finiteOrNull(value.coverage.collinearityScore) ||
      !finiteOrNull(value.coverage.maxCellP90Px) ||
      (typeof value.coverage.occupiedCells === "number" &&
       value.coverage.occupiedCells > 16) ||
      (typeof value.coverage.quadrants === "number" &&
       value.coverage.quadrants > 4) ||
      (finite(value.coverage.xExtentFraction) &&
       (value.coverage.xExtentFraction < 0 ||
        value.coverage.xExtentFraction > 1)) ||
      (finite(value.coverage.yExtentFraction) &&
       (value.coverage.yExtentFraction < 0 ||
        value.coverage.yExtentFraction > 1)) ||
      (finite(value.coverage.collinearityScore) &&
       (value.coverage.collinearityScore < 0 ||
        value.coverage.collinearityScore > 1)) ||
      (finite(value.coverage.maxCellP90Px) &&
       value.coverage.maxCellP90Px < 0) ||
      !isPlainRecord(value.akaze) ||
      !hasExactKeys(value.akaze, [
        "parentKeypoints", "childKeypoints", "goodMatches", "transferP90Px",
        "refitApplied",
      ]) ||
      !nonNegativeIntegerOrNull(value.akaze.parentKeypoints) ||
      !nonNegativeIntegerOrNull(value.akaze.childKeypoints) ||
      !nonNegativeIntegerOrNull(value.akaze.goodMatches) ||
      !finiteOrNull(value.akaze.transferP90Px) ||
      (finite(value.akaze.transferP90Px) && value.akaze.transferP90Px < 0) ||
      value.akaze.refitApplied !== false ||
      !isPlainRecord(value.canny) ||
      !hasExactKeys(value.canny, [
        "supportCount", "hitCount", "hitRate", "refitApplied",
      ]) ||
      !nonNegativeIntegerOrNull(value.canny.supportCount) ||
      !nonNegativeIntegerOrNull(value.canny.hitCount) ||
      !finiteOrNull(value.canny.hitRate) ||
      (finite(value.canny.hitRate) &&
       (value.canny.hitRate < 0 || value.canny.hitRate > 1)) ||
      value.canny.refitApplied !== false ||
      !isPlainRecord(value.thresholds) ||
      !hasExactKeys(value.thresholds, Object.keys(AFC_SR1_TS0_PLACEMENT_THRESHOLDS_V1)) ||
      !equalJson(value.thresholds, AFC_SR1_TS0_PLACEMENT_THRESHOLDS_V1)) {
    fail("diagnostics_invalid");
  }
}

function validateUsableDiagnostics(
  diagnostics: AfcSr1Ts0PlacementDiagnosticsV1
): void {
  const { sift, holdout, coverage, akaze, canny } = diagnostics;
  if (sift.parentKeypoints === null || sift.parentKeypoints < 8 ||
      sift.childKeypoints === null || sift.childKeypoints < 8 ||
      sift.goodMatches === null ||
      sift.goodMatches < AFC_SR1_TS0_PLACEMENT_THRESHOLDS_V1.minimumSiftMatches ||
      sift.goodMatches > sift.parentKeypoints ||
      sift.finalInliers === null ||
      sift.finalInliers < AFC_SR1_TS0_PLACEMENT_THRESHOLDS_V1.minimumFinalInliers ||
      sift.finalInliers > sift.goodMatches ||
      sift.fitP90Px === null ||
      sift.fitP90Px > AFC_SR1_TS0_PLACEMENT_THRESHOLDS_V1.maximumFitP90Px ||
      holdout.partition === null ||
      holdout.fitCount === null || holdout.fitCount < 8 ||
      holdout.validationCount === null || holdout.validationCount < 4 ||
      holdout.fitCount + holdout.validationCount !== sift.goodMatches ||
      holdout.fitTranslationPx === null ||
      holdout.validationP90Px === null ||
      holdout.validationP90Px >
        AFC_SR1_TS0_PLACEMENT_THRESHOLDS_V1.maximumValidationP90Px ||
      coverage.occupiedCells === null ||
      coverage.occupiedCells <
        AFC_SR1_TS0_PLACEMENT_THRESHOLDS_V1.minimumOccupiedCells ||
      coverage.quadrants === null ||
      coverage.quadrants < AFC_SR1_TS0_PLACEMENT_THRESHOLDS_V1.minimumQuadrants ||
      coverage.xExtentFraction === null ||
      coverage.xExtentFraction <
        AFC_SR1_TS0_PLACEMENT_THRESHOLDS_V1.minimumXExtentFraction ||
      coverage.yExtentFraction === null ||
      coverage.yExtentFraction <
        AFC_SR1_TS0_PLACEMENT_THRESHOLDS_V1.minimumYExtentFraction ||
      coverage.collinearityScore === null ||
      coverage.collinearityScore >
        AFC_SR1_TS0_PLACEMENT_THRESHOLDS_V1.maximumCollinearityScore ||
      coverage.maxCellP90Px === null ||
      coverage.maxCellP90Px >
        AFC_SR1_TS0_PLACEMENT_THRESHOLDS_V1.maximumCellP90Px ||
      akaze.parentKeypoints === null || akaze.parentKeypoints < 8 ||
      akaze.childKeypoints === null || akaze.childKeypoints < 8 ||
      akaze.goodMatches === null ||
      akaze.goodMatches <
        AFC_SR1_TS0_PLACEMENT_THRESHOLDS_V1.minimumAkazeMatches ||
      akaze.goodMatches > akaze.parentKeypoints ||
      akaze.transferP90Px === null ||
      akaze.transferP90Px >
        AFC_SR1_TS0_PLACEMENT_THRESHOLDS_V1.maximumAkazeTransferP90Px ||
      canny.supportCount === null ||
      canny.supportCount < AFC_SR1_TS0_PLACEMENT_THRESHOLDS_V1.minimumEdgeSupport ||
      canny.hitCount === null || canny.hitCount > canny.supportCount ||
      canny.hitRate === null ||
      canny.hitRate < AFC_SR1_TS0_PLACEMENT_THRESHOLDS_V1.minimumEdgeHitRate ||
      !Object.is(canny.hitRate, canny.hitCount / canny.supportCount)) {
    fail("usable_diagnostics_threshold_mismatch");
  }
}

function freezeDecodedBasis(
  value: AfcSr1Ts0PlacementDecodedImageBasisV1
): AfcSr1Ts0PlacementDecodedImageBasisV1 {
  return Object.freeze({ ...value });
}

function freezeHNorm(value: AfcSr1Ts0PlacementHNormV1): AfcSr1Ts0PlacementHNormV1 {
  return Object.freeze(value.map((row) => Object.freeze([...row])) as unknown as
    AfcSr1Ts0PlacementHNormV1);
}

function freezeMask(
  value: AfcSr1Ts0PlacementRegistrationMaskIdentityV1
): AfcSr1Ts0PlacementRegistrationMaskIdentityV1 {
  return Object.freeze({
    ...value,
    polygon: Object.freeze(value.polygon.map((point) => Object.freeze([...point]) as
      readonly [number, number])),
    rasterization: Object.freeze({
      ...value.rasterization,
      dilationKernel: Object.freeze([9, 9] as const),
    }),
  });
}

function registerAuthority(receipt: AfcSr1Ts0ChildProjectivePlacementReceiptV1): void {
  if (receipt.status !== "usable" ||
      !isDecodedBasis(receipt.sourceImageBasis) ||
      !isDecodedBasis(receipt.targetImageBasis) ||
      !isDecodedBasis(receipt.ts0Lineage.parent) ||
      !isDecodedBasis(receipt.ts0Lineage.child) ||
      receipt.registrationMaskIdentity === null ||
      receipt.translationPx === null ||
      receipt.H_norm === null) {
    return;
  }
  const source = freezeDecodedBasis(receipt.sourceImageBasis);
  const target = freezeDecodedBasis(receipt.targetImageBasis);
  const authority = Object.freeze({
    schemaVersion: receipt.schemaVersion,
    policyVersion: receipt.policyVersion,
    sourceImageBasis: source,
    targetImageBasis: target,
    ts0Lineage: Object.freeze({
      parent: freezeDecodedBasis(receipt.ts0Lineage.parent),
      child: freezeDecodedBasis(receipt.ts0Lineage.child),
    }),
    registrationMaskIdentity: freezeMask(receipt.registrationMaskIdentity),
    transformType: receipt.transformType,
    transformDirection: receipt.transformDirection,
    translationPx: Object.freeze({ ...receipt.translationPx }),
    H_norm: freezeHNorm(receipt.H_norm),
    receiptEvidenceDigest: receipt.evidenceDigest.value,
  }) as AfcSr1ValidatedTs0ChildProjectivePlacementAuthorityV1;
  placementAuthorities.add(authority);
  authorityByReceipt.set(receipt, authority);
}

export function validateAfcSr1Ts0ChildProjectivePlacementReceipt(
  value: unknown,
  context: AfcSr1Ts0PlacementValidationContextV1
): AfcSr1Ts0ChildProjectivePlacementReceiptV1 {
  if (!isPlainRecord(value) ||
      !hasExactKeys(value, [
        "schemaVersion", "policyVersion", "sourceImageBasis", "targetImageBasis",
        "ts0Lineage", "registrationMaskIdentity", "transformType",
        "transformDirection", "translationPx", "H_norm", "diagnostics",
        "runtimeIdentity", "status", "reason", "evidenceCanonicalJson",
        "evidenceDigest", "elapsedMs",
      ]) ||
      value.schemaVersion !== AFC_SR1_TS0_CHILD_PROJECTIVE_PLACEMENT_VERSION ||
      value.policyVersion !== AFC_SR1_TS0_CHILD_PROJECTIVE_PLACEMENT_POLICY_VERSION ||
      value.transformType !== "translation" ||
      value.transformDirection !== "parent_to_child" ||
      (value.status !== "usable" && value.status !== "rejected")) {
    fail("shape_invalid");
  }
  validateImageBasis(value.sourceImageBasis);
  validateImageBasis(value.targetImageBasis);
  validateLineage(value.ts0Lineage);
  if (value.registrationMaskIdentity !== null) {
    validateMask(value.registrationMaskIdentity);
  }
  validateDiagnostics(value.diagnostics);
  validateRuntime(value.runtimeIdentity);

  if (!equalJson(value.sourceImageBasis, value.ts0Lineage.parent) ||
      !equalJson(value.targetImageBasis, value.ts0Lineage.child)) {
    fail("lineage_binding_mismatch");
  }

  if (value.status === "usable") {
    if (!isPlainRecord(context)) fail("usable_validation_context_invalid");
    const usableContext =
      context as unknown as AfcSr1Ts0PlacementUsableValidationInputV1;
    if (!hasExactKeys(context, [
          "parentBytes", "childBytes", "lineageAuthority",
        ]) ||
        !(usableContext.parentBytes instanceof Uint8Array) ||
        !(usableContext.childBytes instanceof Uint8Array) ||
        !isAfcSr1ValidatedTs0ParentChildLineageAuthority(
          usableContext.lineageAuthority
        )) {
      fail("usable_validation_context_invalid");
    }
    const lineage = usableContext.lineageAuthority.evidence;
    const parentBasis = {
      sha256: lineage.parent.sha256,
      byteCount: lineage.parent.byteCount,
      decodedWidth: lineage.parent.decodedWidth,
      decodedHeight: lineage.parent.decodedHeight,
      orientation: lineage.parent.orientation,
    };
    const childBasis = {
      sha256: lineage.child.sha256,
      byteCount: lineage.child.byteCount,
      decodedWidth: lineage.child.decodedWidth,
      decodedHeight: lineage.child.decodedHeight,
      orientation: lineage.child.orientation,
    };
    if (usableContext.parentBytes.byteLength !== parentBasis.byteCount ||
        usableContext.childBytes.byteLength !== childBasis.byteCount ||
        createHash("sha256").update(usableContext.parentBytes).digest("hex") !==
          parentBasis.sha256 ||
        createHash("sha256").update(usableContext.childBytes).digest("hex") !==
          childBasis.sha256 ||
        !equalJson(value.sourceImageBasis, parentBasis) ||
        !equalJson(value.targetImageBasis, childBasis) ||
        !equalJson(value.ts0Lineage, {
          parent: parentBasis,
          child: childBasis,
        })) {
      fail("exact_bytes_or_lineage_authority_mismatch");
    }
    if (value.reason !== null ||
        value.registrationMaskIdentity === null ||
        !isDecodedBasis(value.sourceImageBasis) ||
        !isDecodedBasis(value.targetImageBasis) ||
        value.translationPx === null ||
        value.H_norm === null) {
      fail("usable_envelope_invalid");
    }
    validateTranslation(value.translationPx);
    validateHNorm(value.H_norm, deriveAfcSr1Ts0ChildProjectivePlacementHNorm(
      value.sourceImageBasis,
      value.targetImageBasis,
      value.translationPx
    ));
    validateUsableDiagnostics(value.diagnostics);
  } else {
    if (!isPlainRecord(context)) fail("expected_rejected_identity_invalid");
    const rejectedContext = context as unknown as Readonly<{
      expectedRejectedIdentity: AfcSr1Ts0PlacementExpectedIdentityV1;
    }>;
    if (!hasExactKeys(context, ["expectedRejectedIdentity"]) ||
        !isPlainRecord(rejectedContext.expectedRejectedIdentity) ||
        !hasExactKeys(rejectedContext.expectedRejectedIdentity, [
          "sourceImageBasis", "targetImageBasis", "ts0Lineage",
          "registrationMaskIdentity",
        ])) {
      fail("expected_rejected_identity_invalid");
    }
    const expected = rejectedContext.expectedRejectedIdentity;
    validateImageBasis(expected.sourceImageBasis);
    validateImageBasis(expected.targetImageBasis);
    validateLineage(expected.ts0Lineage);
    if (expected.registrationMaskIdentity !== null) {
      validateMask(expected.registrationMaskIdentity);
    }
    if (!equalJson(value.sourceImageBasis, expected.sourceImageBasis) ||
        !equalJson(value.targetImageBasis, expected.targetImageBasis) ||
        !equalJson(value.ts0Lineage, expected.ts0Lineage) ||
        !equalJson(
          value.registrationMaskIdentity,
          expected.registrationMaskIdentity
        )) {
      fail("expected_identity_mismatch");
    }
    if (typeof value.reason !== "string" ||
        !REJECTION_REASONS.has(value.reason as AfcSr1Ts0PlacementRejectionReasonV1) ||
        value.translationPx !== null ||
        value.H_norm !== null) {
      fail("rejected_envelope_invalid");
    }
    if ((value.reason === "invalid_source_image" &&
         value.sourceImageBasis.decodedWidth !== null) ||
        (value.reason === "invalid_target_image" &&
         value.targetImageBasis.decodedWidth !== null) ||
        (value.reason === "registration_mask_missing" &&
         value.registrationMaskIdentity !== null) ||
        (value.reason !== "registration_mask_missing" &&
         value.reason !== "invalid_source_image" &&
         value.reason !== "invalid_target_image" &&
         value.registrationMaskIdentity === null)) {
      fail("rejection_stage_mismatch");
    }
  }

  if (typeof value.evidenceCanonicalJson !== "string" ||
      !isPlainRecord(value.evidenceDigest) ||
      !hasExactKeys(value.evidenceDigest, ["algorithm", "encoding", "value"]) ||
      value.evidenceDigest.algorithm !== "sha256" ||
      value.evidenceDigest.encoding !== "hex" ||
      !isSha256(value.evidenceDigest.value) ||
      !finite(value.elapsedMs) ||
      value.elapsedMs < 0) {
    fail("evidence_envelope_invalid");
  }
  const {
    evidenceCanonicalJson,
    evidenceDigest,
    elapsedMs: _elapsedMs,
    ...preimage
  } = value;
  void _elapsedMs;
  const canonical = canonicalizeRfc8785Jcs(preimage);
  if (evidenceCanonicalJson !== canonical ||
      evidenceDigest.value !== sha256HexUtf8(canonical)) {
    fail("evidence_invalid");
  }
  const receipt = value as AfcSr1Ts0ChildProjectivePlacementReceiptV1;
  registerAuthority(receipt);
  return receipt;
}

export function getAfcSr1ValidatedTs0ChildProjectivePlacementAuthority(
  receipt: AfcSr1Ts0ChildProjectivePlacementReceiptV1
): AfcSr1ValidatedTs0ChildProjectivePlacementAuthorityV1 | null {
  return authorityByReceipt.get(receipt) ?? null;
}

export function isAfcSr1ValidatedTs0ChildProjectivePlacementAuthority(
  value: unknown
): value is AfcSr1ValidatedTs0ChildProjectivePlacementAuthorityV1 {
  return typeof value === "object" && value !== null &&
    placementAuthorities.has(value);
}

/**
 * Architecture L:
 * l_child_norm=D_child*l_child_pixel;
 * l_parent_norm=H_norm^T*l_child_norm;
 * l_parent_pixel=D_parent^-1*l_parent_norm.
 */
export function transferAfcSr1ChildPixelLineToParentPixel(
  childLine: AfcSr1PixelLineV1,
  authority: AfcSr1ValidatedTs0ChildProjectivePlacementAuthorityV1
): AfcSr1PixelLineV1 | null {
  if (!isAfcSr1ValidatedTs0ChildProjectivePlacementAuthority(authority) ||
      !isPlainRecord(childLine) ||
      !hasExactKeys(childLine, ["a", "b", "c"]) ||
      !finite(childLine.a) || !finite(childLine.b) || !finite(childLine.c)) {
    return null;
  }
  const Wp = authority.sourceImageBasis.decodedWidth;
  const Hp = authority.sourceImageBasis.decodedHeight;
  const Wc = authority.targetImageBasis.decodedWidth;
  const Hc = authority.targetImageBasis.decodedHeight;
  const H = authority.H_norm;
  const lcn = [childLine.a * Wc, childLine.b * Hc, childLine.c] as const;
  const lpn = [
    H[0][0] * lcn[0] + H[1][0] * lcn[1] + H[2][0] * lcn[2],
    H[0][1] * lcn[0] + H[1][1] * lcn[1] + H[2][1] * lcn[2],
    H[0][2] * lcn[0] + H[1][2] * lcn[1] + H[2][2] * lcn[2],
  ] as const;
  return normalizeCanonicalLine({
    a: lpn[0] / Wp,
    b: lpn[1] / Hp,
    c: lpn[2],
  });
}
