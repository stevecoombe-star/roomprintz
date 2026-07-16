import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  BENCHMARK_P_STALE_CONTAINMENT_RESULT,
  buildBenchmarkRunId,
  buildBenchmarkRunIdentityFingerprint,
  type BenchmarkFixtureReceipt,
  type BenchmarkRunIdentity,
  type BenchmarkRunReceiptMetadata,
} from "@/app/admin/3d-room-lab/benchmark-fixture-intake-contract";
import {
  CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
  evaluateCalibrationImageBasisEvidence,
} from "@/app/admin/3d-room-lab/calibration-image-basis";
import { shouldDiscardAttestedResponse, shouldDropAuthorityOnFrameChange } from "@/app/admin/3d-room-lab/policy-a-containment";
import {
  CALIBRATED_SCENE_STATE_CALIBRATION_VERSION_V2,
  CALIBRATED_SCENE_STATE_SOLVER_V1,
  evaluateCalibrationRestoreCompatibility,
  validateImportedSceneJson,
  type SceneStateValidationConfig,
} from "@/app/admin/3d-room-lab/scene-state";
import { inspectImageMetadata } from "@/lib/vibodeAutoFloorImageFetch";
import { computeCalibrationImageFingerprint, qualifyCalibrationImageBasis } from "@/lib/vibodeCalibrationImageBasis";
import { G0_PAYLOAD_FIXTURES, G0_SYNTHETIC_ASSETS } from "../assets-and-lineage";
import { startG0LoopbackAssetServer } from "../harness";
import { validateG0ObservedRunRecord, type G0ObservedRunRecord } from "../observed-run-record";
import { buildG0ObservedRunRecordPath, writeG0ObservedRunRecordImmutable } from "../observed-run-writer";
import { loadPayloadFixture } from "../payload-fixtures";
import {
  P_STALE_PRECONDITION_V2_CANONICAL_RELATIVE_PATH,
  P_STALE_PRECONDITION_V2_PUBLIC_MIRROR_RELATIVE_PATH,
  P_STALE_PRECONDITION_V2_PUBLIC_URL_PATH,
} from "../p-stale-precondition-v2-spec";
import { buildG0ProbeDeclarations, validateG0ProbeDeclarations } from "../probe-declarations";
import { G0_PROBE_PACKAGE_VERSION } from "../package";
import { G0_SUPPORTING_CHECKS } from "../supporting-checks";

const P_STALE_PRECONDITION_PUBLIC_URL_PATH = "/3d-lab/room-images/P-stale-precondition.jpg";
const P_STALE_PRECONDITION_CANONICAL_PATH = path.join(
  process.cwd(),
  "app/admin/3d-room-lab/g0-containment/synthetic-assets/P-stale-precondition.jpg"
);
const P_STALE_PRECONDITION_PUBLIC_MIRROR_PATH = path.join(
  process.cwd(),
  "public/3d-lab/room-images/P-stale-precondition.jpg"
);
const P_STALE_PRECONDITION_V2_CANONICAL_PATH = path.join(process.cwd(), P_STALE_PRECONDITION_V2_CANONICAL_RELATIVE_PATH);
const P_STALE_PRECONDITION_V2_PUBLIC_MIRROR_PATH = path.join(process.cwd(), P_STALE_PRECONDITION_V2_PUBLIC_MIRROR_RELATIVE_PATH);

function publicUrlPathToPublicFilesystemPath(publicUrlPath: string): string {
  const url = new URL(`http://localhost${publicUrlPath}`);
  return path.join(process.cwd(), "public", url.pathname.replace(/^\/+/, ""));
}

const VALIDATION_CONFIG: SceneStateValidationConfig = {
  transformLimits: {
    positionX: { min: -10, max: 10 },
    positionY: { min: -10, max: 10 },
    positionZ: { min: -10, max: 10 },
    rotationYDeg: { min: -180, max: 180 },
    uniformScale: { min: 0.1, max: 10 },
  },
  modelNormalizationLimits: {
    modelYOffset: { min: -10, max: 10 },
    modelYawOffsetDeg: { min: -180, max: 180 },
    modelScaleMultiplier: { min: 0.1, max: 10 },
  },
  floorMappingLimits: {
    worldWidth: { min: 0.1, max: 20 },
    worldDepth: { min: 0.1, max: 20 },
    depthCenterY: { min: 0, max: 1 },
  },
  perspectiveDepthScalingLimits: {
    nearScaleMultiplier: { min: 0.1, max: 5 },
    farScaleMultiplier: { min: 0.1, max: 5 },
    nearFloorY: { min: 0, max: 1 },
    farFloorY: { min: 0, max: 1 },
  },
  defaultModelNormalization: { modelYOffset: 0, modelYawOffsetDeg: 0, modelScaleMultiplier: 1 },
  defaultFloorMapping: { worldWidth: 4, worldDepth: 4, depthCenterY: 0.5 },
  defaultPerspectiveDepthScaling: {
    enabled: false,
    nearScaleMultiplier: 1,
    farScaleMultiplier: 1,
    nearFloorY: 0.3,
    farFloorY: 0.7,
  },
};

async function makeRunMetadata(executionNonce: string): Promise<BenchmarkRunReceiptMetadata> {
  const runIdentity: BenchmarkRunIdentity = {
    fixtureVersion: "g0/P-crop/v1",
    basisFingerprint: G0_SYNTHETIC_ASSETS["A-parent"].sha256,
    coordinateSpaceVersion: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
    solverGeneratorVersion: "g0-harness/v1",
    evaluationVersion: "g0-eval/v1",
    evidenceBundleVersion: "g0-bundle/v1",
  };
  const runId = await buildBenchmarkRunId({ runIdentity, executionNonce });
  assert.ok(runId);
  return {
    runId: runId!,
    runIdentityFingerprint: await buildBenchmarkRunIdentityFingerprint(runIdentity),
    runIdentity,
    createdAt: "2026-07-04T20:26:00.000Z",
    supersedesRunId: null,
    rerunReason: "evaluation_changed",
  };
}

function makeObservedRecord(
  fixtureReceipt: BenchmarkFixtureReceipt,
  runMetadata: BenchmarkRunReceiptMetadata
): G0ObservedRunRecord {
  return {
    probeId: fixtureReceipt.declaredProbeId!,
    probePackageVersion: G0_PROBE_PACKAGE_VERSION,
    fixtureReceiptReference: {
      fixtureId: fixtureReceipt.fixtureId,
      fixtureVersion: fixtureReceipt.fixtureVersion,
      expectedRefusalOrContainmentResult: fixtureReceipt.expectedRefusalOrContainmentResult,
      expectedPipelineStage: fixtureReceipt.expectedPipelineStage,
    },
    runMetadata,
    primaryObservation: {
      observationKind: "emitted_application_result",
      observedPipelineStage: fixtureReceipt.expectedPipelineStage!,
      observedOperationalState: "calibration_not_attempted",
      outcome: "pass",
      expectedVsObservedComparison: "matches_expected",
      emittedResult: fixtureReceipt.expectedRefusalOrContainmentResult!,
      derivedContainmentConclusion: null,
      rawObservationReferences: [],
    },
    noAuthorityChecks: [
      { checkId: "qualification_refusal_result", status: "pass" },
      { checkId: "restore_or_import_result", status: "pass" },
      { checkId: "route_response_result", status: "pass" },
      { checkId: "apply_gate_defense_in_depth", status: "pass" },
      { checkId: "client_discard_predicate", status: "pass" },
      { checkId: "live_snapshot_state_observation", status: "not_run" },
      { checkId: "state_transition_predicate", status: "not_run" },
    ],
    supportingHarnessChecks: [{ checkId: "apply_gate_defense_in_depth", required: true, status: "passed", failureClass: null }],
    artifactReferences: ["artifact://g0/lab-evidence"],
    manualObservationLog: null,
    incidentReference: null,
  };
}

test("1) all nine G0 declarations validate against B1", () => {
  const declarations = buildG0ProbeDeclarations();
  const validations = validateG0ProbeDeclarations(declarations);
  for (const result of Object.values(validations)) {
    assert.deepEqual(result, { ok: true });
  }
});

test("2) synthetic assets and payload digests match declared metadata", async () => {
  for (const asset of Object.values(G0_SYNTHETIC_ASSETS)) {
    const bytes = await readFile(path.join(process.cwd(), "app/admin/3d-room-lab/g0-containment/synthetic-assets", asset.fileName));
    const digest = computeCalibrationImageFingerprint(bytes);
    assert.equal(digest, asset.sha256);
    const metadata = await inspectImageMetadata(bytes);
    assert.equal(metadata.ok, true);
    if (metadata.ok) {
      assert.equal(metadata.width, asset.decodedWidth);
      assert.equal(metadata.height, asset.decodedHeight);
      assert.equal(metadata.orientation, asset.encodedOrientation);
      assert.equal(asset.decodedOrientationNormal, metadata.orientation === 1);
    }
  }

  for (const fixtureId of Object.keys(G0_PAYLOAD_FIXTURES) as Array<keyof typeof G0_PAYLOAD_FIXTURES>) {
    const loaded = await loadPayloadFixture(fixtureId);
    assert.equal(loaded.payloadDigest, G0_PAYLOAD_FIXTURES[fixtureId].payloadDigest);
  }
});

test("2b) P-stale precondition public mirror stays byte-identical to canonical source", async () => {
  const asset = G0_SYNTHETIC_ASSETS["P-stale-precondition"];
  const mirrorPath = publicUrlPathToPublicFilesystemPath(P_STALE_PRECONDITION_PUBLIC_URL_PATH);
  const canonicalBytes = await readFile(P_STALE_PRECONDITION_CANONICAL_PATH);
  const mirrorBytes = await readFile(mirrorPath);

  assert.ok(canonicalBytes.byteLength > 0);
  assert.ok(mirrorBytes.byteLength > 0);
  assert.deepEqual(mirrorBytes, canonicalBytes);

  const canonicalDigest = computeCalibrationImageFingerprint(canonicalBytes);
  const mirrorDigest = computeCalibrationImageFingerprint(mirrorBytes);
  assert.equal(canonicalDigest, asset.sha256);
  assert.equal(mirrorDigest, asset.sha256);

  const canonicalMetadata = await inspectImageMetadata(canonicalBytes);
  const mirrorMetadata = await inspectImageMetadata(mirrorBytes);
  assert.equal(canonicalMetadata.ok, true);
  assert.equal(mirrorMetadata.ok, true);
  if (canonicalMetadata.ok && mirrorMetadata.ok) {
    assert.equal(canonicalMetadata.width, mirrorMetadata.width);
    assert.equal(canonicalMetadata.height, mirrorMetadata.height);
    assert.equal(canonicalMetadata.orientation, mirrorMetadata.orientation);

    assert.equal(canonicalMetadata.width, asset.decodedWidth);
    assert.equal(canonicalMetadata.height, asset.decodedHeight);
    assert.equal(canonicalMetadata.orientation, asset.encodedOrientation);
    assert.equal(asset.decodedOrientationNormal, canonicalMetadata.orientation === 1);
  }

  assert.equal(mirrorPath, P_STALE_PRECONDITION_PUBLIC_MIRROR_PATH);
});

test("2c) P-stale precondition v2 public mirror stays byte-identical to canonical source", async () => {
  const asset = G0_SYNTHETIC_ASSETS["P-stale-precondition-v2"];
  const mirrorPath = publicUrlPathToPublicFilesystemPath(P_STALE_PRECONDITION_V2_PUBLIC_URL_PATH);
  const canonicalBytes = await readFile(P_STALE_PRECONDITION_V2_CANONICAL_PATH);
  const mirrorBytes = await readFile(mirrorPath);

  assert.ok(canonicalBytes.byteLength > 0);
  assert.ok(mirrorBytes.byteLength > 0);
  assert.deepEqual(mirrorBytes, canonicalBytes);

  const canonicalDigest = computeCalibrationImageFingerprint(canonicalBytes);
  const mirrorDigest = computeCalibrationImageFingerprint(mirrorBytes);
  assert.equal(canonicalDigest, asset.sha256);
  assert.equal(mirrorDigest, asset.sha256);

  const canonicalMetadata = await inspectImageMetadata(canonicalBytes);
  const mirrorMetadata = await inspectImageMetadata(mirrorBytes);
  assert.equal(canonicalMetadata.ok, true);
  assert.equal(mirrorMetadata.ok, true);
  if (canonicalMetadata.ok && mirrorMetadata.ok) {
    assert.equal(canonicalMetadata.width, mirrorMetadata.width);
    assert.equal(canonicalMetadata.height, mirrorMetadata.height);
    assert.equal(canonicalMetadata.orientation, mirrorMetadata.orientation);

    assert.equal(canonicalMetadata.width, asset.decodedWidth);
    assert.equal(canonicalMetadata.height, asset.decodedHeight);
    assert.equal(canonicalMetadata.orientation, asset.encodedOrientation);
    assert.equal(asset.decodedOrientationNormal, canonicalMetadata.orientation === 1);
  }

  assert.equal(mirrorPath, P_STALE_PRECONDITION_V2_PUBLIC_MIRROR_PATH);
});

test("3/4/5) qualification refusals for derivative, orientation, and dimension mismatch", async () => {
  const server = await startG0LoopbackAssetServer();
  try {
    const parentUrl = `${server.origin}/A-parent.jpg`;
    const exifUrl = `${server.origin}/A-exif.jpg`;

    for (const url of [`${server.origin}/A-crop.jpg`, `${server.origin}/A-empty.jpg`, `${server.origin}/A-gen.jpg`]) {
      const refusal = await qualifyCalibrationImageBasis({
        imageUrl: url,
        browserDimensions: null,
        coordinateSpaceVersion: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
        basisKind: "derivative",
        fetch: {
          allowedHosts: ["example.invalid"],
          maxBytes: 10 * 1024 * 1024,
          timeoutMs: 5000,
          allowLocalhostHttp: true,
        },
      });
      assert.equal(refusal.ok, false);
      if (!refusal.ok) assert.equal(refusal.reason, "basis_derivative_not_authority_eligible");
    }

    const x4Refusal = await qualifyCalibrationImageBasis({
      imageUrl: exifUrl,
      browserDimensions: { width: 320, height: 240 },
      coordinateSpaceVersion: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
      basisKind: "original",
      fetch: {
        allowedHosts: ["example.invalid"],
        maxBytes: 10 * 1024 * 1024,
        timeoutMs: 5000,
        allowLocalhostHttp: true,
      },
    });
    assert.equal(x4Refusal.ok, false);
    if (!x4Refusal.ok) assert.equal(x4Refusal.reason, "basis_orientation_not_normal");

    const dimensionRefusal = await qualifyCalibrationImageBasis({
      imageUrl: parentUrl,
      browserDimensions: { width: 319, height: 240 },
      coordinateSpaceVersion: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
      basisKind: "original",
      fetch: {
        allowedHosts: ["example.invalid"],
        maxBytes: 10 * 1024 * 1024,
        timeoutMs: 5000,
        allowLocalhostHttp: true,
      },
    });
    assert.equal(dimensionRefusal.ok, false);
    if (!dimensionRefusal.ok) assert.equal(dimensionRefusal.reason, "basis_dimension_mismatch");

    assert.deepEqual(
      evaluateCalibrationImageBasisEvidence({
        metadata: { width: 320, height: 240, orientation: 1 },
        browserDimensions: { width: 319, height: 240 },
        coordinateSpaceVersion: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
        basisKind: "original",
      }),
      {
        ok: false,
        reason: "basis_dimension_mismatch",
        message: "Browser/server intrinsic dimensions do not match current fetched bytes.",
      }
    );
  } finally {
    await server.close();
  }
});

test("6) P-url-drift emits basis_fingerprint_mismatch on same URL changed bytes", async () => {
  const server = await startG0LoopbackAssetServer();
  try {
    const sourceUrl = `${server.origin}/same-url-simulated.jpg`;
    const first = await qualifyCalibrationImageBasis({
      imageUrl: `${server.origin}/A-parent.jpg`,
      browserDimensions: { width: 320, height: 240 },
      coordinateSpaceVersion: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
      basisKind: "original",
      fetch: {
        allowedHosts: [],
        maxBytes: 10 * 1024 * 1024,
        timeoutMs: 5000,
        allowLocalhostHttp: true,
      },
    });
    assert.equal(first.ok, true);
    const second = await qualifyCalibrationImageBasis({
      imageUrl: `${server.origin}/A-drift-b.jpg`,
      browserDimensions: { width: 320, height: 240 },
      coordinateSpaceVersion: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
      basisKind: "original",
      fetch: {
        allowedHosts: [],
        maxBytes: 10 * 1024 * 1024,
        timeoutMs: 5000,
        allowLocalhostHttp: true,
      },
    });
    assert.equal(second.ok, true);
    if (first.ok && second.ok) {
      const secondAtSameUrl = {
        ...second.basis,
        sourceImageUrl: sourceUrl,
      };
      const restore = evaluateCalibrationRestoreCompatibility({
        calibration: {
          calibrationVersion: CALIBRATED_SCENE_STATE_CALIBRATION_VERSION_V2,
          solver: CALIBRATED_SCENE_STATE_SOLVER_V1,
          intrinsics: { verticalFovDeg: 50 },
          source: {
            imageBasis: first.basis,
            sourceFloorPolygon: [
              { x: 0.2, y: 0.8 },
              { x: 0.8, y: 0.8 },
              { x: 0.7, y: 0.95 },
              { x: 0.3, y: 0.95 },
            ],
          },
        },
        currentImageBasis: secondAtSameUrl,
      });
      assert.equal(restore.ok, false);
      if (!restore.ok) assert.equal(restore.reason, "basis_fingerprint_mismatch");
    }
  } finally {
    await server.close();
  }
});

test("7/8/11) payload restore mismatch, legacy import, and client discard predicate", async () => {
  const coordinate = await loadPayloadFixture("P-coordinate-space-drift");
  const legacy = await loadPayloadFixture("P-legacy");
  assert.equal(coordinate.payloadDigest, G0_PAYLOAD_FIXTURES["P-coordinate-space-drift"].payloadDigest);
  assert.equal(legacy.payloadDigest, G0_PAYLOAD_FIXTURES["P-legacy"].payloadDigest);

  const importedCoordinate = validateImportedSceneJson(coordinate.payload, VALIDATION_CONFIG);
  assert.equal(typeof importedCoordinate, "object");
  if (typeof importedCoordinate !== "string" && importedCoordinate.calibration.kind === "valid") {
    const restore = evaluateCalibrationRestoreCompatibility({
      calibration: importedCoordinate.calibration.value,
      currentImageBasis: {
        ...importedCoordinate.calibration.value.source.imageBasis,
        coordinateSpaceVersion: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
      },
    });
    assert.equal(restore.ok, false);
    if (!restore.ok) assert.equal(restore.reason, "basis_coordinate_space_mismatch");
  }
  assert.ok(
    G0_SUPPORTING_CHECKS["P-coordinate-space-drift"].some(
      (check) => check.checkId === "qualification_equality_key_check"
    )
  );

  const importedLegacy = validateImportedSceneJson(legacy.payload, VALIDATION_CONFIG);
  assert.equal(typeof importedLegacy, "object");
  if (typeof importedLegacy !== "string") {
    assert.equal(importedLegacy.calibration.kind, "ignored");
    if (importedLegacy.calibration.kind === "ignored") {
      assert.equal(importedLegacy.calibration.reason, "basis_legacy_receipt_missing");
    }
  }

  assert.equal(shouldDiscardAttestedResponse(null, "abc"), false);
  assert.equal(shouldDiscardAttestedResponse("abc", null), false);
  assert.equal(shouldDiscardAttestedResponse("abc", "abc"), false);
  assert.equal(shouldDiscardAttestedResponse("abc", "def"), true);
});

test("12/13/14/15) P-stale observation honesty and record invariants", async () => {
  assert.equal(shouldDropAuthorityOnFrameChange({ width: 320, height: 240 }, { width: 320, height: 241 }), true);
  const declarations = buildG0ProbeDeclarations();
  const runMetadata = await makeRunMetadata("stale-honesty");
  const staleRecord: G0ObservedRunRecord = {
    ...makeObservedRecord(declarations["P-stale"], runMetadata),
    supportingHarnessChecks: [
      {
        checkId: "shouldDropAuthorityOnFrameChange_predicate",
        required: true,
        status: "passed",
        failureClass: null,
      },
      {
        checkId: "precondition_artifact_readouts",
        required: true,
        status: "passed",
        failureClass: null,
      },
    ],
    primaryObservation: {
      observationKind: "derived_containment_conclusion",
      observedPipelineStage: "live frame-state transition",
      observedOperationalState: "calibration_not_attempted",
      outcome: "pass",
      expectedVsObservedComparison: "matches_expected",
      emittedResult: null,
      derivedContainmentConclusion: BENCHMARK_P_STALE_CONTAINMENT_RESULT,
      rawObservationReferences: ["artifact://pre-change-frame", "artifact://post-change-frame"],
    },
    manualObservationLog: "Observed active snapshot cleared after controlled frame-size transition.",
  };
  assert.equal(staleRecord.primaryObservation.emittedResult, null);
  assert.equal(
    staleRecord.primaryObservation.derivedContainmentConclusion,
    BENCHMARK_P_STALE_CONTAINMENT_RESULT
  );
  const staleValidation = await validateG0ObservedRunRecord({
    fixtureReceipt: declarations["P-stale"],
    record: staleRecord,
  });
  assert.deepEqual(staleValidation, { ok: true });

  const staleAsEmitted = {
    ...staleRecord,
    primaryObservation: {
      ...staleRecord.primaryObservation,
      observationKind: "emitted_application_result" as const,
      emittedResult: BENCHMARK_P_STALE_CONTAINMENT_RESULT,
      derivedContainmentConclusion: null,
    },
  };
  const staleAsEmittedValidation = await validateG0ObservedRunRecord({
    fixtureReceipt: declarations["P-stale"],
    record: staleAsEmitted,
  });
  assert.deepEqual(staleAsEmittedValidation, {
    ok: false,
    reason: "probe_observation_kind_mismatch",
  });

  const staleNoRawReferences = {
    ...staleRecord,
    supportingHarnessChecks: [
      {
        checkId: "shouldDropAuthorityOnFrameChange_predicate",
        required: true,
        status: "passed" as const,
        failureClass: null,
      },
      {
        checkId: "precondition_artifact_readouts",
        required: true,
        status: "passed" as const,
        failureClass: null,
      },
    ],
    primaryObservation: {
      ...staleRecord.primaryObservation,
      rawObservationReferences: [],
    },
  };
  const staleNoRawValidation = await validateG0ObservedRunRecord({
    fixtureReceipt: declarations["P-stale"],
    record: staleNoRawReferences,
  });
  assert.deepEqual(staleNoRawValidation, {
    ok: false,
    reason: "raw_observation_references_required",
  });

  const emittedMissing = {
    ...makeObservedRecord(declarations["P-crop"], runMetadata),
    primaryObservation: {
      ...makeObservedRecord(declarations["P-crop"], runMetadata).primaryObservation,
      emittedResult: null,
    },
  };
  const emittedValidation = await validateG0ObservedRunRecord({
    fixtureReceipt: declarations["P-crop"],
    record: emittedMissing,
  });
  assert.equal(emittedValidation.ok, false);

  const nonStaleAsDerived: G0ObservedRunRecord = {
    ...makeObservedRecord(declarations["P-crop"], runMetadata),
    supportingHarnessChecks: [
      {
        checkId: "restore_comparison_changed_byte_crop",
        required: true,
        status: "passed",
        failureClass: null,
      },
      {
        checkId: "apply_gate_defense_in_depth",
        required: true,
        status: "passed",
        failureClass: null,
      },
    ],
    primaryObservation: {
      observationKind: "derived_containment_conclusion",
      observedPipelineStage: "server basis evidence evaluation",
      observedOperationalState: "calibration_not_attempted",
      outcome: "pass",
      expectedVsObservedComparison: "mismatch",
      emittedResult: null,
      derivedContainmentConclusion: "derived-not-allowed-for-crop",
      rawObservationReferences: ["artifact://derived"],
    },
  };
  const nonStaleAsDerivedValidation = await validateG0ObservedRunRecord({
    fixtureReceipt: declarations["P-crop"],
    record: nonStaleAsDerived,
  });
  assert.deepEqual(nonStaleAsDerivedValidation, {
    ok: false,
    reason: "probe_observation_kind_mismatch",
  });

  const badAxis = {
    ...makeObservedRecord(declarations["P-crop"], runMetadata),
    primaryObservation: {
      ...makeObservedRecord(declarations["P-crop"], runMetadata).primaryObservation,
      observedOperationalState: "calibration_activation_refused",
    },
  } as G0ObservedRunRecord;
  const axisValidation = await validateG0ObservedRunRecord({
    fixtureReceipt: declarations["P-crop"],
    record: badAxis,
  });
  assert.deepEqual(axisValidation, { ok: false, reason: "invalid_operational_state" });

  const forbidden: G0ObservedRunRecord = {
    ...makeObservedRecord(declarations["P-crop"], runMetadata),
    supportingHarnessChecks: [
      {
        checkId: "apply_gate_defense_in_depth",
        required: true,
        status: "passed" as const,
        failureClass: null,
        notes: "capability metric summary",
      },
    ],
  };
  const forbiddenValidation = await validateG0ObservedRunRecord({
    fixtureReceipt: declarations["P-crop"],
    record: forbidden,
  });
  assert.deepEqual(forbiddenValidation, { ok: false, reason: "forbidden_field_present" });
});

test("supporting check pass-gate enforcement", async () => {
  const declarations = buildG0ProbeDeclarations();
  const runMetadata = await makeRunMetadata("supporting-check-gates");
  const base = makeObservedRecord(declarations["P-crop"], runMetadata);

  const passMissingRequired: G0ObservedRunRecord = {
    ...base,
    supportingHarnessChecks: [
      {
        checkId: "apply_gate_defense_in_depth",
        required: true,
        status: "passed",
        failureClass: null,
      },
    ],
  };
  assert.deepEqual(
    await validateG0ObservedRunRecord({
      fixtureReceipt: declarations["P-crop"],
      record: passMissingRequired,
    }),
    {
      ok: false,
      reason: "missing_required_supporting_check:restore_comparison_changed_byte_crop",
    }
  );

  const passNotRunRequired: G0ObservedRunRecord = {
    ...base,
    supportingHarnessChecks: [
      {
        checkId: "restore_comparison_changed_byte_crop",
        required: true,
        status: "not_run",
        failureClass: null,
      },
      {
        checkId: "apply_gate_defense_in_depth",
        required: true,
        status: "passed",
        failureClass: null,
      },
    ],
  };
  assert.deepEqual(
    await validateG0ObservedRunRecord({
      fixtureReceipt: declarations["P-crop"],
      record: passNotRunRequired,
    }),
    {
      ok: false,
      reason: "required_supporting_check_not_passed:restore_comparison_changed_byte_crop",
    }
  );

  const passFailedRequired: G0ObservedRunRecord = {
    ...base,
    primaryObservation: {
      ...base.primaryObservation,
      outcome: "pass",
    },
    supportingHarnessChecks: [
      {
        checkId: "restore_comparison_changed_byte_crop",
        required: true,
        status: "failed",
        failureClass: "safety_mismatch",
      },
      {
        checkId: "apply_gate_defense_in_depth",
        required: true,
        status: "passed",
        failureClass: null,
      },
    ],
  };
  assert.deepEqual(
    await validateG0ObservedRunRecord({
      fixtureReceipt: declarations["P-crop"],
      record: passFailedRequired,
    }),
    {
      ok: false,
      reason: "required_supporting_failure_not_reflected_in_outcome",
    }
  );

  const nonPassWithNotRunRequired: G0ObservedRunRecord = {
    ...base,
    primaryObservation: {
      ...base.primaryObservation,
      outcome: "inconclusive",
    },
    manualObservationLog: "Harness interrupted while collecting restore check.",
    supportingHarnessChecks: [
      {
        checkId: "restore_comparison_changed_byte_crop",
        required: true,
        status: "not_run",
        failureClass: null,
      },
      {
        checkId: "apply_gate_defense_in_depth",
        required: true,
        status: "passed",
        failureClass: null,
      },
    ],
  };
  assert.deepEqual(
    await validateG0ObservedRunRecord({
      fixtureReceipt: declarations["P-crop"],
      record: nonPassWithNotRunRequired,
    }),
    { ok: true }
  );

  const unknownSupportingCheck: G0ObservedRunRecord = {
    ...base,
    supportingHarnessChecks: [
      {
        checkId: "unknown-check-id",
        required: true,
        status: "passed",
        failureClass: null,
      },
    ],
  };
  assert.deepEqual(
    await validateG0ObservedRunRecord({
      fixtureReceipt: declarations["P-crop"],
      record: unknownSupportingCheck,
    }),
    {
      ok: false,
      reason: "unknown_supporting_check:unknown-check-id",
    }
  );
});

test("16/17) immutable writer path and exclusive create behavior", async () => {
  const declarations = buildG0ProbeDeclarations();
  const runMetadataA = await makeRunMetadata("nonce-A");
  const runMetadataB = await makeRunMetadata("nonce-B");
  const recordA: G0ObservedRunRecord = {
    ...makeObservedRecord(declarations["P-crop"], runMetadataA),
    supportingHarnessChecks: [
      {
        checkId: "restore_comparison_changed_byte_crop",
        required: true,
        status: "passed",
        failureClass: null,
      },
      {
        checkId: "apply_gate_defense_in_depth",
        required: true,
        status: "passed",
        failureClass: null,
      },
    ],
  };
  const recordB: G0ObservedRunRecord = {
    ...makeObservedRecord(declarations["P-crop"], runMetadataB),
    supportingHarnessChecks: [
      {
        checkId: "restore_comparison_changed_byte_crop",
        required: true,
        status: "passed",
        failureClass: null,
      },
      {
        checkId: "apply_gate_defense_in_depth",
        required: true,
        status: "passed",
        failureClass: null,
      },
    ],
  };
  const tempRoot = await mkdtemp(path.join(tmpdir(), "g0-writer-"));

  try {
    const pathA = buildG0ObservedRunRecordPath({
      rootDir: tempRoot,
      probePackageVersion: recordA.probePackageVersion,
      probeId: recordA.probeId,
      runId: recordA.runMetadata.runId,
    });
    const pathB = buildG0ObservedRunRecordPath({
      rootDir: tempRoot,
      probePackageVersion: recordB.probePackageVersion,
      probeId: recordB.probeId,
      runId: recordB.runMetadata.runId,
    });
    assert.notEqual(pathA, pathB);

    await writeG0ObservedRunRecordImmutable({
      rootDir: tempRoot,
      fixtureReceipt: declarations["P-crop"],
      record: recordA,
    });

    const persisted = JSON.parse(await readFile(pathA, "utf8")) as G0ObservedRunRecord;
    assert.equal(persisted.runMetadata.runId, runMetadataA.runId);

    await assert.rejects(
      writeG0ObservedRunRecordImmutable({
        rootDir: tempRoot,
        fixtureReceipt: declarations["P-crop"],
        record: recordA,
      })
    );

    assert.throws(() =>
      buildG0ObservedRunRecordPath({
        rootDir: tempRoot,
        probePackageVersion: "v1",
        probeId: "P-crop",
        runId: "benchmark-run:unsafe",
      })
    );

    assert.throws(() =>
      buildG0ObservedRunRecordPath({
        rootDir: tempRoot,
        probePackageVersion: "v1",
        probeId: "../P-crop",
        runId: runMetadataA.runId,
      })
    );
    assert.throws(() =>
      buildG0ObservedRunRecordPath({
        rootDir: tempRoot,
        probePackageVersion: "v1",
        probeId: "P-crop/sub",
        runId: runMetadataA.runId,
      })
    );
    assert.throws(() =>
      buildG0ObservedRunRecordPath({
        rootDir: tempRoot,
        probePackageVersion: "..",
        probeId: "P-crop",
        runId: runMetadataA.runId,
      })
    );
    assert.throws(() =>
      buildG0ObservedRunRecordPath({
        rootDir: tempRoot,
        probePackageVersion: "v1/../escape",
        probeId: "P-crop",
        runId: runMetadataA.runId,
      })
    );
    assert.throws(() =>
      buildG0ObservedRunRecordPath({
        rootDir: tempRoot,
        probePackageVersion: "v1\\escape",
        probeId: "P-crop",
        runId: runMetadataA.runId,
      })
    );

    const safePath = buildG0ObservedRunRecordPath({
      rootDir: tempRoot,
      probePackageVersion: "b3h-b2i-g0-v1",
      probeId: "P-crop",
      runId: runMetadataA.runId,
    });
    const receiptsRoot = path.resolve(tempRoot, "g0-containment", "receipts");
    const relative = path.relative(receiptsRoot, safePath);
    assert.equal(relative.startsWith(".."), false);
    assert.equal(path.isAbsolute(relative), false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
