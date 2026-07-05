import assert from "node:assert/strict";
import test from "node:test";

import {
  BENCHMARK_CAPABILITY_SCOPE,
  BENCHMARK_P_STALE_CONTAINMENT_RESULT,
  buildBenchmarkRunId,
  buildBenchmarkRunIdentityFingerprint,
  createSealedPartitionCommitment,
  validateBenchmarkFixtureReceipt,
  validateBenchmarkRunIdentity,
  validateBenchmarkRunReceiptMetadata,
  validateExternalReferenceRecord,
  validateHeldOutObservationRecord,
  type BenchmarkEvidenceAttribute,
  type BenchmarkFixtureReceipt,
  type BenchmarkRunIdentity,
} from "./benchmark-fixture-intake-contract";
import { CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION } from "./calibration-image-basis";

const FIXTURE_FINGERPRINT_A = "a".repeat(64);
const FIXTURE_FINGERPRINT_B = "b".repeat(64);

async function makeCommitments() {
  return {
    heldOutObservations: await createSealedPartitionCommitment({
      partitionKind: "held_out_observations",
      bundleVersion: "held-out/v1",
      committedAt: "2026-07-04T20:00:00.000Z",
      records: [],
    }),
    externalReferenceRecords: await createSealedPartitionCommitment({
      partitionKind: "external_reference_records",
      bundleVersion: "external/v1",
      committedAt: "2026-07-04T20:00:00.000Z",
      records: [],
    }),
  };
}

async function makeBaseReceipt(
  overrides: Partial<BenchmarkFixtureReceipt> = {}
): Promise<BenchmarkFixtureReceipt> {
  const commitments = await makeCommitments();
  return {
    fixtureId: "fixture-001",
    fixtureVersion: "fixture/v1",
    fixtureClass: "authority_eligible_original_fixture",
    roomCategory: "living_room",
    sourceAssetIdentity: { kind: "source_asset", sourceAssetId: "room-asset-1" },
    provenanceQuality: "lab_collected",
    referenceDataTier: "none",
    expectedDeclaration: {
      terminalDisposition: "resolved",
      evidenceAttributes: [{ kind: "projection_consistent" }],
      operationalState: "calibration_activation_achieved",
      capabilityScope: BENCHMARK_CAPABILITY_SCOPE,
    },
    mismatchClass: "capability",
    intakeTimestamp: "2026-07-04T20:00:00.000Z",
    ownerIdentity: "lab-user",
    basisBinding: {
      kind: "qualified_original_basis",
      basis: {
        basisId: "basis-1",
        basisFingerprint: FIXTURE_FINGERPRINT_A,
        decodedWidth: 1920,
        decodedHeight: 1080,
        encodedOrientation: 1,
        decodedOrientationNormal: true,
        orientationTransform: "identity",
        dimensionSource: "server",
        coordinateSpaceVersion: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
        basisKind: "original",
      },
    },
    sealedCommitments: commitments,
    ...overrides,
  };
}

test("1) accepts a valid qualified-original positive fixture receipt", async () => {
  const receipt = await makeBaseReceipt();
  assert.deepEqual(validateBenchmarkFixtureReceipt(receipt), { ok: true });
});

test("2) accepts an X4-style expected orientation-refusal safety receipt", async () => {
  const receipt = await makeBaseReceipt({
    fixtureClass: "expected_basis_refusal_fixture",
    mismatchClass: "safety",
    declaredProbeId: "X4",
    expectedDeclaration: {
      terminalDisposition: "contradicted",
      operationalState: "calibration_activation_refused",
      capabilityScope: BENCHMARK_CAPABILITY_SCOPE,
      evidenceAttributes: [],
    },
    expectedRefusalOrContainmentResult: "basis_orientation_not_normal",
    expectedPipelineStage: "basis qualification evaluator",
    basisBinding: {
      kind: "expected_basis_refusal",
      expectedRefusalReason: "basis_orientation_not_normal",
      expectedPipelineStage: "basis qualification evaluator",
      sourceAssetIdentity: { kind: "source_asset", sourceAssetId: "room-asset-1" },
    },
  });
  assert.deepEqual(validateBenchmarkFixtureReceipt(receipt), { ok: true });
});

test("3) accepts a valid P-stale receipt with exact authority-drop semantics", async () => {
  const receipt = await makeBaseReceipt({
    fixtureClass: "derivative_containment_probe",
    mismatchClass: "safety",
    declaredProbeId: "P-stale",
    expectedDeclaration: {
      terminalDisposition: "not_assessable",
      operationalState: "calibration_not_attempted",
      capabilityScope: BENCHMARK_CAPABILITY_SCOPE,
      evidenceAttributes: [{ kind: "metric_reference_present" }],
    },
    expectedPipelineStage: "live frame-state transition",
    expectedRefusalOrContainmentResult: BENCHMARK_P_STALE_CONTAINMENT_RESULT,
    basisBinding: {
      kind: "derivative_basis_probe",
      expectedContainmentReason: "basis_derivative_not_authority_eligible",
      expectedPipelineStage: "live frame-state transition",
      sourceAssetIdentity: { kind: "source_asset", sourceAssetId: "stale-probe" },
      parentFixtureId: "fixture-parent",
      parentBasisId: "basis-parent",
    },
  });
  assert.deepEqual(validateBenchmarkFixtureReceipt(receipt), { ok: true });
});

test("4) rejects ambiguous/non-enum Axis-C values and duplicate evidence", async () => {
  const receipt = await makeBaseReceipt({
    expectedDeclaration: {
      terminalDisposition: "resolved",
      operationalState: "observed" as never,
      capabilityScope: BENCHMARK_CAPABILITY_SCOPE,
      evidenceAttributes: [
        { kind: "projection_consistent" },
        { kind: "projection_consistent" },
      ],
    },
  });
  assert.deepEqual(validateBenchmarkFixtureReceipt(receipt), {
    ok: false,
    reason: "invalid_operational_state",
  });
});

test("5) rejects any non-fixed capability scope value", async () => {
  const receipt = await makeBaseReceipt({
    expectedDeclaration: {
      terminalDisposition: "resolved",
      operationalState: "calibration_activation_achieved",
      capabilityScope: "selectable_scope" as never,
      evidenceAttributes: [],
    },
  });
  assert.deepEqual(validateBenchmarkFixtureReceipt(receipt), {
    ok: false,
    reason: "invalid_capability_scope",
  });
});

test("6) rejects safety receipts without exact reason/stage", async () => {
  const missingResult = await makeBaseReceipt({
    mismatchClass: "safety",
    expectedPipelineStage: "containment gate",
  });
  assert.deepEqual(validateBenchmarkFixtureReceipt(missingResult), {
    ok: false,
    reason: "safety_missing_exact_refusal_or_containment_result",
  });

  const ambiguous = await makeBaseReceipt({
    mismatchClass: "safety",
    expectedRefusalOrContainmentResult: "refused or unreachable",
    expectedPipelineStage: "containment gate",
  });
  assert.deepEqual(validateBenchmarkFixtureReceipt(ambiguous), {
    ok: false,
    reason: "ambiguous_safety_expectation_value",
  });
});

test("7) rejects a derivative basis probe without parent lineage", async () => {
  const receipt = await makeBaseReceipt({
    fixtureClass: "derivative_containment_probe",
    basisBinding: {
      kind: "derivative_basis_probe",
      expectedContainmentReason: "basis_dimension_mismatch",
      expectedPipelineStage: "basis ingest gate",
      sourceAssetIdentity: { kind: "source_asset", sourceAssetId: "derived-probe-1" },
      parentFixtureId: "",
      parentBasisId: "",
    },
  });
  assert.deepEqual(validateBenchmarkFixtureReceipt(receipt), {
    ok: false,
    reason: "derivative_probe_missing_parent_lineage_reference",
  });
});

test("8) held-out observation cannot emit external-reference consistency", () => {
  const record = {
    recordId: "heldout-1",
    featureDisjointness: "disjoint",
    errorBasisDisjointness: "disjoint",
    externalIndependence: "independent_physical_acquisition",
    sharedAssumptionFlags: {
      sameLens: false,
      sameOrientationBasis: false,
      sameCrop: false,
      sameRoomModelAssumption: false,
      sameHumanAnnotator: false,
      samePhysicalSeam: false,
    },
    evidenceAttributes: [{ kind: "feature_disjoint_image_consistent" }],
  } as const;
  const declaredAttributes: BenchmarkEvidenceAttribute[] = [
    {
      kind: "external_reference_consistent_at_feature",
      correspondenceId: "feature-seam-A",
    },
  ];
  assert.deepEqual(validateHeldOutObservationRecord(record, declaredAttributes), {
    ok: false,
    reason: "held_out_observation_external_reference_not_allowed",
  });
});

test("9) external-reference record allows shared feature identity with required independence fields", () => {
  const externalRecord = {
    recordId: "external-1",
    physicalQuantity: "wall_length_cm",
    instrument: "laser_distance_meter",
    method: "direct wall measurement",
    uncertainty: "+/- 0.5cm",
    date: "2026-07-04",
    operatorIdentity: "operator-A",
    featureReidentification: {
      namedImageFeatureId: "rear-wall-seam-midpoint",
      correspondenceId: "rear-wall-seam-midpoint",
    },
    basisBinding: {
      basisId: "basis-1",
      basisFingerprint: FIXTURE_FINGERPRINT_A,
      coordinateSpaceVersion: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
    },
    acquisitionIndependence: {
      notDerivedFromImagePixels: true,
      notDerivedFromSolverOutput: true,
      notDerivedFromExif: true,
      notDerivedFromNominalLensData: true,
      notDerivedFromFamiliarObjectAssumptions: true,
    },
  } as const;
  assert.deepEqual(validateExternalReferenceRecord(externalRecord), { ok: true });
});

test("10) commitment digest is insertion-order stable", async () => {
  const recordsA = [
    { id: "a", value: 1 },
    { id: "b", value: 2 },
  ];
  const recordsB = [...recordsA].reverse();
  const a = await createSealedPartitionCommitment({
    partitionKind: "held_out_observations",
    bundleVersion: "v1",
    committedAt: "2026-07-04T20:00:00.000Z",
    records: recordsA,
  });
  const b = await createSealedPartitionCommitment({
    partitionKind: "held_out_observations",
    bundleVersion: "v1",
    committedAt: "2026-07-04T20:00:00.000Z",
    records: recordsB,
  });
  assert.equal(a.sha256, b.sha256);
});

test("11) commitment digest changes when sealed content changes", async () => {
  const a = await createSealedPartitionCommitment({
    partitionKind: "external_reference_records",
    bundleVersion: "v1",
    committedAt: "2026-07-04T20:00:00.000Z",
    records: [{ id: "a", value: 1 }],
  });
  const b = await createSealedPartitionCommitment({
    partitionKind: "external_reference_records",
    bundleVersion: "v1",
    committedAt: "2026-07-04T20:00:00.000Z",
    records: [{ id: "a", value: 2 }],
  });
  assert.notEqual(a.sha256, b.sha256);
});

test("12) both commitment partitions are required, even when logical bundles are empty", async () => {
  const receipt = await makeBaseReceipt({
    sealedCommitments: {
      heldOutObservations: (await makeCommitments()).heldOutObservations,
      externalReferenceRecords: null as never,
    },
  });
  assert.deepEqual(validateBenchmarkFixtureReceipt(receipt), {
    ok: false,
    reason: "missing_external_reference_commitment",
  });
});

test("13) validates deterministic run identity and append-only supersession metadata", async () => {
  const identity: BenchmarkRunIdentity = {
    fixtureVersion: "fixture/v1",
    basisFingerprint: FIXTURE_FINGERPRINT_A,
    coordinateSpaceVersion: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
    solverGeneratorVersion: "type-a-solver/v1",
    evaluationVersion: "benchmark-eval/v1",
    evidenceBundleVersion: "bundle/v1",
  };
  assert.deepEqual(validateBenchmarkRunIdentity(identity), { ok: true });

  const runIdentityFingerprintA = await buildBenchmarkRunIdentityFingerprint(identity);
  const runIdentityFingerprintB = await buildBenchmarkRunIdentityFingerprint(identity);
  assert.equal(runIdentityFingerprintA, runIdentityFingerprintB);

  const runId = await buildBenchmarkRunId({
    runIdentity: identity,
    executionNonce: "exec-0001",
  });
  const rerunId = await buildBenchmarkRunId({
    runIdentity: identity,
    executionNonce: "exec-0002",
  });
  assert.ok(runId);
  assert.ok(rerunId);
  assert.notEqual(runId, rerunId);

  const metadata = {
    runId: rerunId!,
    runIdentityFingerprint: runIdentityFingerprintA,
    runIdentity: identity,
    createdAt: "2026-07-04T20:00:00.000Z",
    supersedesRunId: runId!,
    rerunReason: "annotations_changed",
  } as const;
  assert.deepEqual(await validateBenchmarkRunReceiptMetadata(metadata), { ok: true });

  const selfSupersession = {
    ...metadata,
    supersedesRunId: metadata.runId,
  } as const;
  assert.deepEqual(await validateBenchmarkRunReceiptMetadata(selfSupersession), {
    ok: false,
    reason: "invalid_run_identity",
  });
});

test("14) rejects malformed SHA / invalid coordinate-space / invalid rerun reason / invalid execution nonce", async () => {
  const badIdentity = {
    fixtureVersion: "fixture/v1",
    basisFingerprint: "xyz",
    coordinateSpaceVersion: {
      ...CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
      decoderId: "different-decoder",
    },
    solverGeneratorVersion: "solver/v1",
    evaluationVersion: "eval/v1",
    evidenceBundleVersion: "bundle/v1",
  } as const;
  assert.deepEqual(validateBenchmarkRunIdentity(badIdentity), {
    ok: false,
    reason: "invalid_run_identity",
  });
  assert.equal(
    await buildBenchmarkRunId({
      runIdentity: {
        fixtureVersion: "fixture/v1",
        basisFingerprint: FIXTURE_FINGERPRINT_A,
        coordinateSpaceVersion: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
        solverGeneratorVersion: "type-a-solver/v1",
        evaluationVersion: "benchmark-eval/v1",
        evidenceBundleVersion: "bundle/v1",
      },
      executionNonce: "   ",
    }),
    null
  );

  const receipt = await makeBaseReceipt({
    sealedCommitments: {
      heldOutObservations: {
        partitionKind: "held_out_observations",
        sha256: "not-a-sha",
        bundleVersion: "v1",
        committedAt: "2026-07-04T20:00:00.000Z",
      },
      externalReferenceRecords: (await makeCommitments()).externalReferenceRecords,
    },
  });
  assert.deepEqual(validateBenchmarkFixtureReceipt(receipt), {
    ok: false,
    reason: "malformed_sha256_digest",
  });

  const validIdentity: BenchmarkRunIdentity = {
    fixtureVersion: "fixture/v1",
    basisFingerprint: FIXTURE_FINGERPRINT_B,
    coordinateSpaceVersion: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
    solverGeneratorVersion: "type-a-solver/v1",
    evaluationVersion: "benchmark-eval/v1",
    evidenceBundleVersion: "bundle/v1",
  };
  const runId = await buildBenchmarkRunId({
    runIdentity: validIdentity,
    executionNonce: "exec-1000",
  });
  const runIdentityFingerprint = await buildBenchmarkRunIdentityFingerprint(
    validIdentity
  );
  assert.ok(runId);
  const badMetadata = {
    runId: runId!,
    runIdentityFingerprint,
    runIdentity: validIdentity,
    createdAt: "2026-07-04T20:00:00.000Z",
    supersedesRunId: null,
    rerunReason: "mystery_change",
  } as const;
  assert.deepEqual(await validateBenchmarkRunReceiptMetadata(badMetadata as never), {
    ok: false,
    reason: "invalid_rerun_reason",
  });

  const fingerprintMismatchMetadata = {
    ...badMetadata,
    rerunReason: "incident_correction",
    runIdentityFingerprint: "benchmark-run-identity:".concat("f".repeat(64)),
  } as const;
  assert.deepEqual(
    await validateBenchmarkRunReceiptMetadata(fingerprintMismatchMetadata),
    {
      ok: false,
      reason: "invalid_run_identity_fingerprint",
    }
  );
});
