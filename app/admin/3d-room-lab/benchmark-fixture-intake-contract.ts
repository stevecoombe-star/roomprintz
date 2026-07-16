import {
  isCalibrationImageBasisCoordinateSpaceVersion,
  type CalibrationImageBasisCoordinateSpaceVersion,
  type CalibrationImageBasisRefusalReason,
} from "./calibration-image-basis";
import { canonicalStringify, sha256Hex, type Json } from "@/lib/sceneHash";

export const BENCHMARK_CAPABILITY_SCOPE =
  "no_benchmark_authority_scope_assigned" as const;

export const BENCHMARK_P_STALE_CONTAINMENT_RESULT =
  "active authority receipt drops; fresh projection, re-solve, and requalification are required before any later activation attempt";

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
const AMBIGUOUS_EXPECTATION_VALUES = new Set([
  "refused or unreachable",
  "observed",
  "as applicable",
]);

export type BenchmarkTerminalDisposition =
  | "resolved"
  | "still_ambiguous"
  | "not_assessable"
  | "contradicted"
  | "guided_recapture"
  | "manual_visual_adjustment";

export type BenchmarkOperationalState =
  | "calibration_not_attempted"
  | "calibration_activation_refused"
  | "calibration_activation_achieved";

export type BenchmarkMismatchClass = "safety" | "capability";

export type BenchmarkContainmentProbeId =
  | "P-crop"
  | "P-empty"
  | "P-gen"
  | "P-stale"
  | "P-url-drift"
  | "P-dimension-mismatch"
  | "P-coordinate-space-drift"
  | "P-legacy"
  | "X4";

export type BenchmarkFixtureClass =
  | "authority_eligible_original_fixture"
  | "expected_basis_refusal_fixture"
  | "derivative_containment_probe"
  | "payload_only_containment_probe"
  | "manual_visual_fixture";

export type BenchmarkSourceAssetIdentity =
  | {
      readonly kind: "source_asset";
      readonly sourceAssetId: string;
    }
  | {
      readonly kind: "payload_identity";
      readonly payloadId: string;
    };

export type BenchmarkEvidenceAttribute =
  | { readonly kind: "projection_consistent" }
  | { readonly kind: "feature_disjoint_image_consistent" }
  | {
      readonly kind: "external_reference_consistent_at_feature";
      readonly correspondenceId: string;
    }
  | { readonly kind: "metric_reference_present" };

export type BenchmarkExpectedDeclaration = {
  readonly terminalDisposition: BenchmarkTerminalDisposition;
  readonly evidenceAttributes: readonly BenchmarkEvidenceAttribute[];
  readonly operationalState: BenchmarkOperationalState;
  readonly capabilityScope: typeof BENCHMARK_CAPABILITY_SCOPE;
};

export type BenchmarkQualifiedOriginalBasisReceipt = {
  readonly basisId: string;
  readonly basisFingerprint: string;
  readonly decodedWidth: number;
  readonly decodedHeight: number;
  readonly encodedOrientation: number;
  readonly decodedOrientationNormal: true;
  readonly orientationTransform: "identity";
  readonly dimensionSource: "server";
  readonly coordinateSpaceVersion: CalibrationImageBasisCoordinateSpaceVersion;
  readonly basisKind: "original";
};

export type BenchmarkFixtureBasisBinding =
  | {
      readonly kind: "qualified_original_basis";
      readonly basis: BenchmarkQualifiedOriginalBasisReceipt;
    }
  | {
      readonly kind: "expected_basis_refusal";
      readonly expectedRefusalReason: CalibrationImageBasisRefusalReason;
      readonly expectedPipelineStage: string;
      readonly sourceAssetIdentity: BenchmarkSourceAssetIdentity;
    }
  | {
      readonly kind: "derivative_basis_probe";
      readonly expectedContainmentReason: CalibrationImageBasisRefusalReason;
      readonly expectedPipelineStage: string;
      readonly sourceAssetIdentity: BenchmarkSourceAssetIdentity;
      readonly parentFixtureId: string;
      readonly parentBasisId: string;
    }
  | {
      readonly kind: "payload_only_probe";
      readonly expectedContainmentReason: CalibrationImageBasisRefusalReason;
      readonly expectedPipelineStage: string;
      readonly payloadIdentity: BenchmarkSourceAssetIdentity;
      readonly parentFixtureId: string | null;
      readonly parentBasisId: string | null;
    };

export type BenchmarkCommitmentPartitionKind =
  | "held_out_observations"
  | "external_reference_records";

export type BenchmarkSealedPartitionCommitment = {
  readonly partitionKind: BenchmarkCommitmentPartitionKind;
  readonly sha256: string;
  readonly bundleVersion: string;
  readonly committedAt: string;
};

export type BenchmarkSealedCommitmentOpeningEvent = {
  readonly partitionKind: BenchmarkCommitmentPartitionKind;
  readonly openedAt: string;
  readonly openingReason: string;
  readonly openingActor: string;
};

export type BenchmarkFixtureReceipt = {
  readonly fixtureId: string;
  readonly fixtureVersion: string;
  readonly fixtureClass: BenchmarkFixtureClass;
  readonly roomCategory: string;
  readonly sourceAssetIdentity: BenchmarkSourceAssetIdentity;
  readonly provenanceQuality: string;
  readonly referenceDataTier: string;
  readonly expectedDeclaration: BenchmarkExpectedDeclaration;
  readonly mismatchClass: BenchmarkMismatchClass;
  readonly intakeTimestamp: string;
  readonly ownerIdentity: string;
  readonly basisBinding: BenchmarkFixtureBasisBinding;
  readonly declaredProbeId?: BenchmarkContainmentProbeId;
  readonly expectedRefusalOrContainmentResult?: string;
  readonly expectedPipelineStage?: string;
  readonly sealedCommitments: {
    readonly heldOutObservations: BenchmarkSealedPartitionCommitment;
    readonly externalReferenceRecords: BenchmarkSealedPartitionCommitment;
  };
};

export type BenchmarkSharedAssumptionFlags = {
  readonly sameLens: boolean;
  readonly sameOrientationBasis: boolean;
  readonly sameCrop: boolean;
  readonly sameRoomModelAssumption: boolean;
  readonly sameHumanAnnotator: boolean;
  readonly samePhysicalSeam: boolean;
};

export type BenchmarkHeldOutObservationRecord = {
  readonly recordId: string;
  readonly featureDisjointness: "disjoint" | "not_disjoint" | "undetermined";
  readonly errorBasisDisjointness: "disjoint" | "not_disjoint" | "undetermined";
  readonly externalIndependence:
    | "independent_physical_acquisition"
    | "not_independent"
    | "undetermined";
  readonly sharedAssumptionFlags: BenchmarkSharedAssumptionFlags;
  readonly evidenceAttributes: ReadonlyArray<{
    readonly kind: "feature_disjoint_image_consistent";
  }>;
};

export type BenchmarkExternalReferenceRecord = {
  readonly recordId: string;
  readonly physicalQuantity: string;
  readonly instrument: string;
  readonly method: string;
  readonly uncertainty: string;
  readonly date: string;
  readonly operatorIdentity: string;
  readonly featureReidentification: {
    readonly namedImageFeatureId: string;
    readonly correspondenceId: string;
  };
  readonly basisBinding: {
    readonly basisId: string;
    readonly basisFingerprint: string;
    readonly coordinateSpaceVersion: CalibrationImageBasisCoordinateSpaceVersion;
  };
  readonly acquisitionIndependence: {
    readonly notDerivedFromImagePixels: true;
    readonly notDerivedFromSolverOutput: true;
    readonly notDerivedFromExif: true;
    readonly notDerivedFromNominalLensData: true;
    readonly notDerivedFromFamiliarObjectAssumptions: true;
  };
};

export type BenchmarkRerunReason =
  | "basis_changed"
  | "coordinate_space_changed"
  | "annotations_changed"
  | "solver_generator_changed"
  | "evaluation_changed"
  | "evidence_bundle_changed"
  | "incident_correction";

export type BenchmarkRunIdentity = {
  readonly fixtureVersion: string;
  readonly basisFingerprint: string;
  readonly coordinateSpaceVersion: CalibrationImageBasisCoordinateSpaceVersion;
  readonly solverGeneratorVersion: string;
  readonly evaluationVersion: string;
  readonly evidenceBundleVersion: string;
};

export type BenchmarkRunReceiptMetadata = {
  readonly runId: string;
  readonly runIdentityFingerprint: string;
  readonly runIdentity: BenchmarkRunIdentity;
  readonly createdAt: string;
  readonly supersedesRunId: string | null;
  readonly rerunReason: BenchmarkRerunReason;
};

export type BenchmarkFixtureValidationErrorReason =
  | "invalid_terminal_disposition"
  | "invalid_operational_state"
  | "invalid_capability_scope"
  | "invalid_evidence_attribute"
  | "duplicate_evidence_attribute"
  | "safety_missing_exact_refusal_or_containment_result"
  | "safety_missing_exact_pipeline_stage"
  | "ambiguous_safety_expectation_value"
  | "qualified_original_requires_original_basis_kind"
  | "derivative_probe_missing_parent_lineage_reference"
  | "missing_held_out_commitment"
  | "missing_external_reference_commitment"
  | "malformed_sha256_digest"
  | "invalid_coordinate_space_version"
  | "stale_probe_contract_mismatch"
  | "stale_probe_forbidden_fingerprint_or_restore_claim";

export type BenchmarkValidationResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: BenchmarkFixtureValidationErrorReason;
    };

export type BenchmarkRecordValidationErrorReason =
  | "held_out_observation_external_reference_not_allowed"
  | "external_reference_missing_acquisition_independence"
  | "invalid_coordinate_space_version";

export type BenchmarkRunValidationErrorReason =
  | "invalid_run_identity"
  | "invalid_run_id"
  | "invalid_run_identity_fingerprint"
  | "invalid_execution_nonce"
  | "invalid_coordinate_space_version"
  | "invalid_rerun_reason"
  | "malformed_sha256_digest";

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isAmbiguousExpectationValue(value: string | undefined): boolean {
  if (!value) return false;
  return AMBIGUOUS_EXPECTATION_VALUES.has(value.trim().toLowerCase());
}

function makeEvidenceAttributeKey(attribute: BenchmarkEvidenceAttribute): string {
  if (attribute.kind === "external_reference_consistent_at_feature") {
    return `${attribute.kind}:${attribute.correspondenceId}`;
  }
  return attribute.kind;
}

function isValidTerminalDisposition(
  value: string
): value is BenchmarkTerminalDisposition {
  return (
    value === "resolved" ||
    value === "still_ambiguous" ||
    value === "not_assessable" ||
    value === "contradicted" ||
    value === "guided_recapture" ||
    value === "manual_visual_adjustment"
  );
}

function isValidOperationalState(value: string): value is BenchmarkOperationalState {
  return (
    value === "calibration_not_attempted" ||
    value === "calibration_activation_refused" ||
    value === "calibration_activation_achieved"
  );
}

function isValidRerunReason(value: string): value is BenchmarkRerunReason {
  return (
    value === "basis_changed" ||
    value === "coordinate_space_changed" ||
    value === "annotations_changed" ||
    value === "solver_generator_changed" ||
    value === "evaluation_changed" ||
    value === "evidence_bundle_changed" ||
    value === "incident_correction"
  );
}

function isValidEvidenceAttribute(
  attribute: BenchmarkEvidenceAttribute
): boolean {
  if (
    attribute.kind === "projection_consistent" ||
    attribute.kind === "feature_disjoint_image_consistent" ||
    attribute.kind === "metric_reference_present"
  ) {
    return true;
  }
  return (
    attribute.kind === "external_reference_consistent_at_feature" &&
    isNonBlankString(attribute.correspondenceId)
  );
}

export function isValidSha256Digest(value: string): boolean {
  return SHA256_HEX_PATTERN.test(value);
}

export function validateBenchmarkSealedPartitionCommitment(
  commitment: BenchmarkSealedPartitionCommitment | null | undefined,
  expectedPartitionKind: BenchmarkCommitmentPartitionKind
): BenchmarkValidationResult {
  if (!commitment || commitment.partitionKind !== expectedPartitionKind) {
    return {
      ok: false,
      reason:
        expectedPartitionKind === "held_out_observations"
          ? "missing_held_out_commitment"
          : "missing_external_reference_commitment",
    };
  }
  if (!isValidSha256Digest(commitment.sha256)) {
    return { ok: false, reason: "malformed_sha256_digest" };
  }
  return { ok: true };
}

export function validateBenchmarkFixtureReceipt(
  receipt: BenchmarkFixtureReceipt
): BenchmarkValidationResult {
  if (!isValidTerminalDisposition(receipt.expectedDeclaration.terminalDisposition)) {
    return { ok: false, reason: "invalid_terminal_disposition" };
  }
  if (!isValidOperationalState(receipt.expectedDeclaration.operationalState)) {
    return { ok: false, reason: "invalid_operational_state" };
  }
  if (receipt.expectedDeclaration.capabilityScope !== BENCHMARK_CAPABILITY_SCOPE) {
    return { ok: false, reason: "invalid_capability_scope" };
  }

  const evidenceKeys = new Set<string>();
  for (const attribute of receipt.expectedDeclaration.evidenceAttributes) {
    if (!isValidEvidenceAttribute(attribute)) {
      return { ok: false, reason: "invalid_evidence_attribute" };
    }
    const key = makeEvidenceAttributeKey(attribute);
    if (evidenceKeys.has(key)) {
      return { ok: false, reason: "duplicate_evidence_attribute" };
    }
    evidenceKeys.add(key);
  }

  if (receipt.mismatchClass === "safety") {
    if (!isNonBlankString(receipt.expectedRefusalOrContainmentResult)) {
      return {
        ok: false,
        reason: "safety_missing_exact_refusal_or_containment_result",
      };
    }
    if (!isNonBlankString(receipt.expectedPipelineStage)) {
      return { ok: false, reason: "safety_missing_exact_pipeline_stage" };
    }
    if (
      isAmbiguousExpectationValue(receipt.expectedRefusalOrContainmentResult) ||
      isAmbiguousExpectationValue(receipt.expectedPipelineStage)
    ) {
      return { ok: false, reason: "ambiguous_safety_expectation_value" };
    }
  }

  if (
    receipt.basisBinding.kind === "qualified_original_basis" &&
    receipt.basisBinding.basis.basisKind !== "original"
  ) {
    return {
      ok: false,
      reason: "qualified_original_requires_original_basis_kind",
    };
  }

  if (receipt.basisBinding.kind === "qualified_original_basis") {
    if (
      !isCalibrationImageBasisCoordinateSpaceVersion(
        receipt.basisBinding.basis.coordinateSpaceVersion
      )
    ) {
      return { ok: false, reason: "invalid_coordinate_space_version" };
    }
  }

  if (
    receipt.basisBinding.kind === "derivative_basis_probe" &&
    (!isNonBlankString(receipt.basisBinding.parentFixtureId) ||
      !isNonBlankString(receipt.basisBinding.parentBasisId))
  ) {
    return {
      ok: false,
      reason: "derivative_probe_missing_parent_lineage_reference",
    };
  }

  const heldOutCommitment = validateBenchmarkSealedPartitionCommitment(
    receipt.sealedCommitments.heldOutObservations,
    "held_out_observations"
  );
  if (!heldOutCommitment.ok) return heldOutCommitment;
  const externalCommitment = validateBenchmarkSealedPartitionCommitment(
    receipt.sealedCommitments.externalReferenceRecords,
    "external_reference_records"
  );
  if (!externalCommitment.ok) return externalCommitment;

  if (receipt.declaredProbeId === "P-stale") {
    if (
      receipt.expectedDeclaration.terminalDisposition !== "not_assessable" ||
      receipt.expectedDeclaration.operationalState !== "calibration_not_attempted" ||
      receipt.expectedPipelineStage !== "live frame-state transition" ||
      receipt.expectedRefusalOrContainmentResult !==
        BENCHMARK_P_STALE_CONTAINMENT_RESULT
    ) {
      return { ok: false, reason: "stale_probe_contract_mismatch" };
    }
    const staleResult = receipt.expectedRefusalOrContainmentResult.toLowerCase();
    if (
      staleResult.includes("fingerprint mismatch") ||
      staleResult.includes("changed bytes") ||
      staleResult.includes("restore failure")
    ) {
      return {
        ok: false,
        reason: "stale_probe_forbidden_fingerprint_or_restore_claim",
      };
    }
  }

  return { ok: true };
}

export function validateHeldOutObservationRecord(
  record: BenchmarkHeldOutObservationRecord,
  declaredAttributes: readonly BenchmarkEvidenceAttribute[]
):
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: BenchmarkRecordValidationErrorReason } {
  for (const attribute of declaredAttributes) {
    if (attribute.kind === "external_reference_consistent_at_feature") {
      return {
        ok: false,
        reason: "held_out_observation_external_reference_not_allowed",
      };
    }
  }
  for (const attribute of record.evidenceAttributes) {
    if (attribute.kind !== "feature_disjoint_image_consistent") {
      return {
        ok: false,
        reason: "held_out_observation_external_reference_not_allowed",
      };
    }
  }
  return { ok: true };
}

export function validateExternalReferenceRecord(
  record: BenchmarkExternalReferenceRecord
):
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: BenchmarkRecordValidationErrorReason } {
  if (
    !record.acquisitionIndependence.notDerivedFromImagePixels ||
    !record.acquisitionIndependence.notDerivedFromSolverOutput ||
    !record.acquisitionIndependence.notDerivedFromExif ||
    !record.acquisitionIndependence.notDerivedFromNominalLensData ||
    !record.acquisitionIndependence.notDerivedFromFamiliarObjectAssumptions
  ) {
    return {
      ok: false,
      reason: "external_reference_missing_acquisition_independence",
    };
  }
  if (
    !isCalibrationImageBasisCoordinateSpaceVersion(
      record.basisBinding.coordinateSpaceVersion
    )
  ) {
    return { ok: false, reason: "invalid_coordinate_space_version" };
  }
  return { ok: true };
}

function toCanonicalJson(value: unknown): Json {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => toCanonicalJson(entry));
  }
  if (typeof value === "object") {
    const output: { [k: string]: Json } = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (typeof item === "undefined") continue;
      output[key] = toCanonicalJson(item);
    }
    return output;
  }
  return String(value);
}

export function canonicalizeCommitmentBundleRecords(
  records: readonly unknown[]
): readonly string[] {
  return records
    .map((record) => canonicalStringify(toCanonicalJson(record)))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export async function createSealedPartitionCommitment(input: {
  readonly partitionKind: BenchmarkCommitmentPartitionKind;
  readonly bundleVersion: string;
  readonly committedAt: string;
  readonly records: readonly unknown[];
}): Promise<BenchmarkSealedPartitionCommitment> {
  const orderedRecords = canonicalizeCommitmentBundleRecords(input.records);
  const payload = canonicalStringify(
    toCanonicalJson({
      partitionKind: input.partitionKind,
      bundleVersion: input.bundleVersion,
      records: orderedRecords,
    })
  );
  return {
    partitionKind: input.partitionKind,
    sha256: await sha256Hex(payload),
    bundleVersion: input.bundleVersion,
    committedAt: input.committedAt,
  };
}

export function validateBenchmarkRunIdentity(
  runIdentity: BenchmarkRunIdentity
):
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: BenchmarkRunValidationErrorReason } {
  if (
    !isNonBlankString(runIdentity.fixtureVersion) ||
    !isValidSha256Digest(runIdentity.basisFingerprint) ||
    !isNonBlankString(runIdentity.solverGeneratorVersion) ||
    !isNonBlankString(runIdentity.evaluationVersion) ||
    !isNonBlankString(runIdentity.evidenceBundleVersion)
  ) {
    return { ok: false, reason: "invalid_run_identity" };
  }
  if (
    !isCalibrationImageBasisCoordinateSpaceVersion(
      runIdentity.coordinateSpaceVersion
    )
  ) {
    return { ok: false, reason: "invalid_coordinate_space_version" };
  }
  return { ok: true };
}

export async function buildBenchmarkRunIdentityFingerprint(
  runIdentity: BenchmarkRunIdentity
): Promise<string> {
  const canonicalIdentity = canonicalStringify(
    toCanonicalJson({
      fixtureVersion: runIdentity.fixtureVersion,
      basisFingerprint: runIdentity.basisFingerprint,
      coordinateSpaceVersion: runIdentity.coordinateSpaceVersion,
      solverGeneratorVersion: runIdentity.solverGeneratorVersion,
      evaluationVersion: runIdentity.evaluationVersion,
      evidenceBundleVersion: runIdentity.evidenceBundleVersion,
    })
  );
  const digest = await sha256Hex(canonicalIdentity);
  return `benchmark-run-identity:${digest}`;
}

export async function buildBenchmarkRunId(input: {
  readonly runIdentity: BenchmarkRunIdentity;
  readonly executionNonce: string;
}): Promise<string | null> {
  const identityValidation = validateBenchmarkRunIdentity(input.runIdentity);
  if (!identityValidation.ok) return null;
  const executionNonce = input.executionNonce.trim();
  if (!executionNonce) return null;

  const runIdentityFingerprint = await buildBenchmarkRunIdentityFingerprint(
    input.runIdentity
  );
  const runSeed = canonicalStringify(
    toCanonicalJson({
      runIdentityFingerprint,
      executionNonce,
    })
  );
  const digest = await sha256Hex(runSeed);
  return `benchmark-run:${digest}`;
}

function isValidBenchmarkRunId(value: string): boolean {
  return /^benchmark-run:[0-9a-f]{64}$/.test(value);
}

function isValidBenchmarkRunIdentityFingerprint(value: string): boolean {
  return /^benchmark-run-identity:[0-9a-f]{64}$/.test(value);
}

export async function validateBenchmarkRunReceiptMetadata(
  metadata: BenchmarkRunReceiptMetadata
): Promise<
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: BenchmarkRunValidationErrorReason }
> {
  if (!isNonBlankString(metadata.createdAt)) {
    return { ok: false, reason: "invalid_run_identity" };
  }
  if (!isValidBenchmarkRunId(metadata.runId)) {
    return { ok: false, reason: "invalid_run_id" };
  }
  if (!isValidBenchmarkRunIdentityFingerprint(metadata.runIdentityFingerprint)) {
    return { ok: false, reason: "invalid_run_identity_fingerprint" };
  }
  if (metadata.supersedesRunId !== null && !isNonBlankString(metadata.supersedesRunId)) {
    return { ok: false, reason: "invalid_run_identity" };
  }
  if (
    metadata.supersedesRunId !== null &&
    !isValidBenchmarkRunId(metadata.supersedesRunId)
  ) {
    return { ok: false, reason: "invalid_run_id" };
  }
  if (metadata.supersedesRunId === metadata.runId) {
    return { ok: false, reason: "invalid_run_identity" };
  }
  const runIdentityResult = validateBenchmarkRunIdentity(metadata.runIdentity);
  if (!runIdentityResult.ok) return runIdentityResult;
  const computedFingerprint = await buildBenchmarkRunIdentityFingerprint(
    metadata.runIdentity
  );
  if (metadata.runIdentityFingerprint !== computedFingerprint) {
    return { ok: false, reason: "invalid_run_identity_fingerprint" };
  }
  if (!isValidRerunReason(metadata.rerunReason)) {
    return { ok: false, reason: "invalid_rerun_reason" };
  }
  return { ok: true };
}
