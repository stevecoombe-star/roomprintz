import {
  BENCHMARK_CAPABILITY_SCOPE,
  BENCHMARK_P_STALE_CONTAINMENT_RESULT,
  type BenchmarkFixtureReceipt,
  type BenchmarkFixtureValidationErrorReason,
  validateBenchmarkFixtureReceipt,
} from "@/app/admin/3d-room-lab/benchmark-fixture-intake-contract";
import { CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION } from "@/app/admin/3d-room-lab/calibration-image-basis";
import { G0_PAYLOAD_FIXTURES, G0_PARENT_FIXTURE_LINEAGE, G0_SYNTHETIC_ASSETS } from "./assets-and-lineage";
import { type G0ProbeId, G0_PROBE_IDS } from "./package";

const G0_COMMITMENT_HELD_OUT_SHA = "1".repeat(64);
const G0_COMMITMENT_EXTERNAL_SHA = "2".repeat(64);

function makeSealedCommitments() {
  return {
    heldOutObservations: {
      partitionKind: "held_out_observations" as const,
      sha256: G0_COMMITMENT_HELD_OUT_SHA,
      bundleVersion: "g0-held-out/v1",
      committedAt: "2026-07-04T00:00:00.000Z",
    },
    externalReferenceRecords: {
      partitionKind: "external_reference_records" as const,
      sha256: G0_COMMITMENT_EXTERNAL_SHA,
      bundleVersion: "g0-external/v1",
      committedAt: "2026-07-04T00:00:00.000Z",
    },
  };
}

function makeBaseSafetyReceipt(probeId: G0ProbeId): Omit<BenchmarkFixtureReceipt, "basisBinding"> {
  return {
    fixtureId: `g0-${probeId}-fixture-v1`,
    fixtureVersion: `g0/${probeId}/v1`,
    fixtureClass: "expected_basis_refusal_fixture",
    roomCategory: "lab_synthetic",
    sourceAssetIdentity: { kind: "source_asset", sourceAssetId: `g0-source-${probeId}` },
    provenanceQuality: "lab_synthetic",
    referenceDataTier: "none",
    expectedDeclaration: {
      terminalDisposition: "not_assessable",
      evidenceAttributes: [],
      operationalState: "calibration_not_attempted",
      capabilityScope: BENCHMARK_CAPABILITY_SCOPE,
    },
    mismatchClass: "safety",
    intakeTimestamp: "2026-07-04T00:00:00.000Z",
    ownerIdentity: "g0-lab",
    declaredProbeId: probeId,
    sealedCommitments: makeSealedCommitments(),
    expectedRefusalOrContainmentResult: "",
    expectedPipelineStage: "",
  };
}

export function buildG0ProbeDeclarations(): Record<G0ProbeId, BenchmarkFixtureReceipt> {
  const parentBasis = {
    basisId: G0_PARENT_FIXTURE_LINEAGE.basisId,
    basisFingerprint: G0_SYNTHETIC_ASSETS["A-parent"].sha256,
    decodedWidth: G0_SYNTHETIC_ASSETS["A-parent"].decodedWidth,
    decodedHeight: G0_SYNTHETIC_ASSETS["A-parent"].decodedHeight,
    encodedOrientation: 1,
    decodedOrientationNormal: true as const,
    orientationTransform: "identity" as const,
    dimensionSource: "server" as const,
    coordinateSpaceVersion: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
    basisKind: "original" as const,
  };

  return {
    "P-crop": {
      ...makeBaseSafetyReceipt("P-crop"),
      fixtureClass: "derivative_containment_probe",
      sourceAssetIdentity: { kind: "source_asset", sourceAssetId: "A-crop-asset" },
      expectedRefusalOrContainmentResult: "basis_derivative_not_authority_eligible",
      expectedPipelineStage: "server basis evidence evaluation",
      basisBinding: {
        kind: "derivative_basis_probe",
        expectedContainmentReason: "basis_derivative_not_authority_eligible",
        expectedPipelineStage: "server basis evidence evaluation",
        sourceAssetIdentity: { kind: "source_asset", sourceAssetId: "A-crop-asset" },
        parentFixtureId: G0_PARENT_FIXTURE_LINEAGE.fixtureId,
        parentBasisId: G0_PARENT_FIXTURE_LINEAGE.basisId,
      },
    },
    "P-empty": {
      ...makeBaseSafetyReceipt("P-empty"),
      fixtureClass: "derivative_containment_probe",
      sourceAssetIdentity: { kind: "source_asset", sourceAssetId: "A-empty-asset" },
      expectedRefusalOrContainmentResult: "basis_derivative_not_authority_eligible",
      expectedPipelineStage: "server basis evidence evaluation",
      basisBinding: {
        kind: "derivative_basis_probe",
        expectedContainmentReason: "basis_derivative_not_authority_eligible",
        expectedPipelineStage: "server basis evidence evaluation",
        sourceAssetIdentity: { kind: "source_asset", sourceAssetId: "A-empty-asset" },
        parentFixtureId: G0_PARENT_FIXTURE_LINEAGE.fixtureId,
        parentBasisId: G0_PARENT_FIXTURE_LINEAGE.basisId,
      },
    },
    "P-gen": {
      ...makeBaseSafetyReceipt("P-gen"),
      fixtureClass: "derivative_containment_probe",
      sourceAssetIdentity: { kind: "source_asset", sourceAssetId: "A-gen-asset" },
      expectedRefusalOrContainmentResult: "basis_derivative_not_authority_eligible",
      expectedPipelineStage: "server basis evidence evaluation",
      basisBinding: {
        kind: "derivative_basis_probe",
        expectedContainmentReason: "basis_derivative_not_authority_eligible",
        expectedPipelineStage: "server basis evidence evaluation",
        sourceAssetIdentity: { kind: "source_asset", sourceAssetId: "A-gen-asset" },
        parentFixtureId: G0_PARENT_FIXTURE_LINEAGE.fixtureId,
        parentBasisId: G0_PARENT_FIXTURE_LINEAGE.basisId,
      },
    },
    "P-stale": {
      ...makeBaseSafetyReceipt("P-stale"),
      fixtureClass: "derivative_containment_probe",
      sourceAssetIdentity: { kind: "source_asset", sourceAssetId: "P-stale-precondition-asset" },
      expectedRefusalOrContainmentResult: BENCHMARK_P_STALE_CONTAINMENT_RESULT,
      expectedPipelineStage: "live frame-state transition",
      basisBinding: {
        kind: "qualified_original_basis",
        basis: parentBasis,
      },
    },
    "P-url-drift": {
      ...makeBaseSafetyReceipt("P-url-drift"),
      expectedRefusalOrContainmentResult: "basis_fingerprint_mismatch",
      expectedPipelineStage: "restore image-basis receipt comparison",
      basisBinding: {
        kind: "expected_basis_refusal",
        expectedRefusalReason: "basis_fingerprint_mismatch",
        expectedPipelineStage: "restore image-basis receipt comparison",
        sourceAssetIdentity: { kind: "source_asset", sourceAssetId: "A-parent-asset" },
      },
    },
    "P-dimension-mismatch": {
      ...makeBaseSafetyReceipt("P-dimension-mismatch"),
      expectedRefusalOrContainmentResult: "basis_dimension_mismatch",
      expectedPipelineStage: "server basis evidence evaluation",
      basisBinding: {
        kind: "expected_basis_refusal",
        expectedRefusalReason: "basis_dimension_mismatch",
        expectedPipelineStage: "server basis evidence evaluation",
        sourceAssetIdentity: { kind: "source_asset", sourceAssetId: "A-parent-asset" },
      },
    },
    "P-coordinate-space-drift": {
      ...makeBaseSafetyReceipt("P-coordinate-space-drift"),
      fixtureClass: "payload_only_containment_probe",
      sourceAssetIdentity: {
        kind: "payload_identity",
        payloadId: G0_PAYLOAD_FIXTURES["P-coordinate-space-drift"].payloadIdentity,
      },
      expectedRefusalOrContainmentResult: "basis_coordinate_space_mismatch",
      expectedPipelineStage: "restore image-basis receipt comparison",
      basisBinding: {
        kind: "payload_only_probe",
        expectedContainmentReason: "basis_coordinate_space_mismatch",
        expectedPipelineStage: "restore image-basis receipt comparison",
        payloadIdentity: {
          kind: "payload_identity",
          payloadId: G0_PAYLOAD_FIXTURES["P-coordinate-space-drift"].payloadIdentity,
        },
        parentFixtureId: null,
        parentBasisId: null,
      },
    },
    "P-legacy": {
      ...makeBaseSafetyReceipt("P-legacy"),
      fixtureClass: "payload_only_containment_probe",
      sourceAssetIdentity: {
        kind: "payload_identity",
        payloadId: G0_PAYLOAD_FIXTURES["P-legacy"].payloadIdentity,
      },
      expectedRefusalOrContainmentResult: "basis_legacy_receipt_missing",
      expectedPipelineStage: "scene-import calibration-block validation",
      basisBinding: {
        kind: "payload_only_probe",
        expectedContainmentReason: "basis_legacy_receipt_missing",
        expectedPipelineStage: "scene-import calibration-block validation",
        payloadIdentity: {
          kind: "payload_identity",
          payloadId: G0_PAYLOAD_FIXTURES["P-legacy"].payloadIdentity,
        },
        parentFixtureId: null,
        parentBasisId: null,
      },
    },
    X4: {
      ...makeBaseSafetyReceipt("X4"),
      sourceAssetIdentity: { kind: "source_asset", sourceAssetId: "A-exif-asset" },
      expectedRefusalOrContainmentResult: "basis_orientation_not_normal",
      expectedPipelineStage: "server basis evidence evaluation",
      basisBinding: {
        kind: "expected_basis_refusal",
        expectedRefusalReason: "basis_orientation_not_normal",
        expectedPipelineStage: "server basis evidence evaluation",
        sourceAssetIdentity: { kind: "source_asset", sourceAssetId: "A-exif-asset" },
      },
    },
  };
}

export function validateG0ProbeDeclarations(
  declarations: Record<G0ProbeId, BenchmarkFixtureReceipt>
): Record<G0ProbeId, { ok: true } | { ok: false; reason: BenchmarkFixtureValidationErrorReason }> {
  return G0_PROBE_IDS.reduce(
    (acc, probeId) => {
      acc[probeId] = validateBenchmarkFixtureReceipt(declarations[probeId]);
      return acc;
    },
    {} as Record<
      G0ProbeId,
      { ok: true } | { ok: false; reason: BenchmarkFixtureValidationErrorReason }
    >
  );
}
