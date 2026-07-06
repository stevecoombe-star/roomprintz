import { CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION } from "@/app/admin/3d-room-lab/calibration-image-basis";
import { evaluateCalibrationImageBasisEvidence } from "@/app/admin/3d-room-lab/calibration-image-basis";
import { evaluateCalibratedCameraApply } from "@/app/admin/3d-room-lab/calibrated-camera-apply";
import {
  evaluateCalibrationRestoreCompatibility,
  validateImportedSceneJson,
  type SceneStateValidationConfig,
} from "@/app/admin/3d-room-lab/scene-state";
import { G0_SYNTHETIC_ASSETS } from "./assets-and-lineage";
import type { NonPStaleExecutionEvidence } from "./non-p-stale-observed-run-builder";
import type { NonPStaleProbeId, NonPStaleResolvedProvenance } from "./non-p-stale-provenance-resolver";
import { loadPayloadFixture } from "./payload-fixtures";

const SCENE_STATE_VALIDATION_CONFIG: SceneStateValidationConfig = {
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
  defaultModelNormalization: {
    modelYOffset: 0,
    modelYawOffsetDeg: 0,
    modelScaleMultiplier: 1,
  },
  defaultFloorMapping: {
    worldWidth: 4,
    worldDepth: 4,
    depthCenterY: 0.5,
  },
  defaultPerspectiveDepthScaling: {
    enabled: false,
    nearScaleMultiplier: 1,
    farScaleMultiplier: 1,
    nearFloorY: 0.3,
    farFloorY: 0.7,
  },
};

function assertPayloadProvenance(
  probeId: NonPStaleProbeId,
  provenance: NonPStaleResolvedProvenance
): { payloadIdentity: string; payloadDigest: string } {
  if (!provenance.payloadIdentity || !provenance.payloadDigest) {
    throw new Error(`payload_provenance_required:${probeId}`);
  }
  return {
    payloadIdentity: provenance.payloadIdentity,
    payloadDigest: provenance.payloadDigest,
  };
}

function extractResolverBoundImageMetadata(provenance: NonPStaleResolvedProvenance): {
  width: number;
  height: number;
  orientation: number;
} {
  let dimensions: { width: number; height: number } | null = null;
  let orientation: number | null = null;

  const dimensionsPattern = /^fixture_image_dimensions:([1-9]\d*)x([1-9]\d*)$/;
  const orientationPattern = /^fixture_image_orientation:([1-9]\d*)$/;

  for (const entry of provenance.artifactReferences) {
    if (entry.includes("fixture_image_dimensions:")) {
      if (!entry.startsWith("fixture_image_dimensions:")) {
        throw new Error("malformed_fixture_image_dimensions_reference:P-gen");
      }
      const dimensionsMatch = entry.match(dimensionsPattern);
      if (!dimensionsMatch) {
        throw new Error("malformed_fixture_image_dimensions_reference:P-gen");
      }
      if (dimensions !== null) {
        throw new Error("duplicate_fixture_image_dimensions_reference:P-gen");
      }
      const width = Number.parseInt(dimensionsMatch[1], 10);
      const height = Number.parseInt(dimensionsMatch[2], 10);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        throw new Error("malformed_fixture_image_dimensions_reference:P-gen");
      }
      dimensions = { width, height };
    }

    if (entry.includes("fixture_image_orientation:")) {
      if (!entry.startsWith("fixture_image_orientation:")) {
        throw new Error("malformed_fixture_image_orientation_reference:P-gen");
      }
      const orientationMatch = entry.match(orientationPattern);
      if (!orientationMatch) {
        throw new Error("malformed_fixture_image_orientation_reference:P-gen");
      }
      if (orientation !== null) {
        throw new Error("duplicate_fixture_image_orientation_reference:P-gen");
      }
      const parsedOrientation = Number.parseInt(orientationMatch[1], 10);
      if (!Number.isFinite(parsedOrientation) || parsedOrientation <= 0) {
        throw new Error("malformed_fixture_image_orientation_reference:P-gen");
      }
      orientation = parsedOrientation;
    }
  }
  if (!dimensions) {
    throw new Error("missing_fixture_image_dimensions_reference:P-gen");
  }
  if (orientation === null) {
    throw new Error("missing_fixture_image_orientation_reference:P-gen");
  }
  return {
    width: dimensions.width,
    height: dimensions.height,
    orientation,
  };
}

function runPgenDeterministicChain(
  provenance: NonPStaleResolvedProvenance
): Promise<NonPStaleExecutionEvidence> {
  return (async () => {
    if (provenance.probeId !== "P-gen") {
      throw new Error(`unexpected_provenance_probe:P-gen:${provenance.probeId}`);
    }
    if (provenance.evaluatedImageDigest !== G0_SYNTHETIC_ASSETS["A-gen"].sha256) {
      throw new Error("provenance_digest_drift:P-gen");
    }
    if (provenance.payloadIdentity !== null || provenance.payloadDigest !== null) {
      throw new Error("payload_fields_must_be_null:P-gen");
    }
    if (provenance.driftImageDigest !== null) {
      throw new Error("drift_digest_must_be_null:P-gen");
    }
    const canonicalAgenPath = provenance.canonicalRepoRelativePaths.find((entry) =>
      entry.endsWith("/A-gen.jpg")
    );
    if (!canonicalAgenPath) {
      throw new Error("canonical_a_gen_path_missing:P-gen");
    }

    const expectedResult = provenance.fixtureReceipt.expectedRefusalOrContainmentResult;
    if (expectedResult !== "basis_derivative_not_authority_eligible") {
      throw new Error("declaration_expected_result_mismatch:P-gen");
    }
    const expectedStage = provenance.fixtureReceipt.expectedPipelineStage;
    if (expectedStage !== "server basis evidence evaluation") {
      throw new Error("declaration_expected_stage_mismatch:P-gen");
    }

    const metadata = extractResolverBoundImageMetadata(provenance);
    const expectedMetadata = {
      width: G0_SYNTHETIC_ASSETS["A-gen"].decodedWidth,
      height: G0_SYNTHETIC_ASSETS["A-gen"].decodedHeight,
      orientation: G0_SYNTHETIC_ASSETS["A-gen"].encodedOrientation,
    };
    if (
      metadata.width !== expectedMetadata.width ||
      metadata.height !== expectedMetadata.height ||
      metadata.orientation !== expectedMetadata.orientation
    ) {
      throw new Error("resolver_bound_metadata_mismatch:P-gen");
    }

    const evidence = evaluateCalibrationImageBasisEvidence({
      basisKind: "derivative",
      browserDimensions: null,
      coordinateSpaceVersion: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
      metadata,
    });
    if (evidence.ok) {
      throw new Error("unexpected_valid_result:P-gen");
    }
    if (evidence.reason !== "basis_derivative_not_authority_eligible") {
      throw new Error("unexpected_emitted_token:P-gen");
    }

    const defensiveApply = evaluateCalibratedCameraApply(null, null, {
      basisQualified: false,
      basisUnavailableReason: "basis_derivative_not_authority_eligible",
    });
    if (
      defensiveApply.available !== false ||
      defensiveApply.reason !== "basis_derivative_not_authority_eligible" ||
      defensiveApply.firstFailingGate !== "basis"
    ) {
      throw new Error("apply_gate_mismatch:P-gen");
    }

    return {
      mode: "deterministic_execution_observed",
      emittedResult: "basis_derivative_not_authority_eligible",
      expectedVsObservedComparison: "matches_expected",
      outcome: "pass",
      supportingChecks: [
        {
          checkId: "apply_gate_defense_in_depth",
          status: "passed",
          failureClass: null,
          notes: `firstFailingGate=${defensiveApply.firstFailingGate}`,
        },
      ],
      pinnedCallInputs: [
        `evaluateCalibrationImageBasisEvidence:basisKind=derivative,browserDimensions=null,coordinateSpace=${CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION.decoderId},metadata=${metadata.width}x${metadata.height}/orientation=${metadata.orientation}`,
        "evaluateCalibratedCameraApply:basisQualified=false,basisUnavailableReason=basis_derivative_not_authority_eligible",
      ],
      artifactReferences: [`canonical_image_path:${canonicalAgenPath}`, "primary_call_fetch_boundary:none"],
      manualObservationLog:
        "The committed resolver re-hashed and provenance-bound A-gen from its canonical committed path, including digest, dimensions, orientation, and parent lineage.\nThe primary emission was a derivative-basis refusal produced by the pure basis-evidence function and did not itself fetch, decode, hash, or read A-gen bytes. All byte access occurred solely in resolver provenance verification.",
    };
  })();
}

function runPlegacyDeterministicChain(
  provenance: NonPStaleResolvedProvenance
): Promise<NonPStaleExecutionEvidence> {
  return (async () => {
    const { payloadIdentity, payloadDigest } = assertPayloadProvenance("P-legacy", provenance);
    const loaded = await loadPayloadFixture("P-legacy");
    if (loaded.payloadIdentity !== payloadIdentity || loaded.payloadDigest !== payloadDigest) {
      throw new Error("payload_identity_or_digest_drift:P-legacy");
    }
    const imported = validateImportedSceneJson(loaded.payload, SCENE_STATE_VALIDATION_CONFIG);
    if (typeof imported === "string") {
      throw new Error(`unexpected_import_shape:P-legacy:${imported}`);
    }
    if (imported.calibration.kind !== "ignored") {
      throw new Error("unexpected_valid_result:P-legacy:calibration_not_ignored");
    }
    if (imported.calibration.reason !== "basis_legacy_receipt_missing") {
      throw new Error("unexpected_emitted_token:P-legacy");
    }

    const defensiveApply = evaluateCalibratedCameraApply(null, null, {
      basisQualified: false,
      basisUnavailableReason: "basis_legacy_receipt_missing",
    });
    if (defensiveApply.available || defensiveApply.reason !== "basis_legacy_receipt_missing") {
      throw new Error("defensive_apply_gate_check_failed:P-legacy");
    }

    return {
      mode: "deterministic_execution_observed",
      emittedResult: "basis_legacy_receipt_missing",
      expectedVsObservedComparison: "matches_expected",
      outcome: "pass",
      supportingChecks: [
        {
          checkId: "defensive_apply_gate_check",
          status: "passed",
          failureClass: null,
          notes: `firstFailingGate=${defensiveApply.firstFailingGate}`,
        },
      ],
      pinnedCallInputs: [
        `loadPayloadFixture:P-legacy payloadIdentity=${payloadIdentity}`,
        `validateImportedSceneJson:config=scene-state-defaults-v1`,
        "evaluateCalibratedCameraApply:basisQualified=false,basisUnavailableReason=basis_legacy_receipt_missing",
      ],
      artifactReferences: [
        `payload_identity:${payloadIdentity}`,
        `payload_digest:${payloadDigest}`,
      ],
      manualObservationLog:
        "Deterministic execution observed via committed payload fixture and committed pure validation chain.",
    };
  })();
}

function isCoordinateSpaceEqualToCurrent(value: {
  decoderId: string;
  normalizationPolicyVersion: string;
  orientationApplied: boolean;
}): boolean {
  return (
    value.decoderId === CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION.decoderId &&
    value.normalizationPolicyVersion ===
      CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION.normalizationPolicyVersion &&
    value.orientationApplied === CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION.orientationApplied
  );
}

function runCoordinateSpaceDriftDeterministicChain(
  provenance: NonPStaleResolvedProvenance
): Promise<NonPStaleExecutionEvidence> {
  return (async () => {
    const { payloadIdentity, payloadDigest } = assertPayloadProvenance(
      "P-coordinate-space-drift",
      provenance
    );
    const loaded = await loadPayloadFixture("P-coordinate-space-drift");
    if (loaded.payloadIdentity !== payloadIdentity || loaded.payloadDigest !== payloadDigest) {
      throw new Error("payload_identity_or_digest_drift:P-coordinate-space-drift");
    }
    const imported = validateImportedSceneJson(loaded.payload, SCENE_STATE_VALIDATION_CONFIG);
    if (typeof imported === "string") {
      throw new Error(`unexpected_import_shape:P-coordinate-space-drift:${imported}`);
    }
    if (imported.calibration.kind !== "valid") {
      throw new Error("validator_failure:P-coordinate-space-drift:expected_valid_calibration");
    }

    const persistedCoordinateSpace = imported.calibration.value.source.imageBasis.coordinateSpaceVersion;
    const currentImageBasis = {
      ...imported.calibration.value.source.imageBasis,
      coordinateSpaceVersion: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
    };
    const restoreCheck = evaluateCalibrationRestoreCompatibility({
      calibration: imported.calibration.value,
      currentImageBasis,
    });
    if (restoreCheck.ok) {
      throw new Error("unexpected_valid_ok_result:P-coordinate-space-drift");
    }
    if (restoreCheck.reason !== "basis_coordinate_space_mismatch") {
      throw new Error("unexpected_emitted_token:P-coordinate-space-drift");
    }

    const strictEqualityDetectedMismatch = !isCoordinateSpaceEqualToCurrent(persistedCoordinateSpace);
    if (!strictEqualityDetectedMismatch) {
      throw new Error("qualification_equality_key_check_failed:P-coordinate-space-drift");
    }

    const defensiveApply = evaluateCalibratedCameraApply(null, null, {
      basisQualified: false,
      basisUnavailableReason: "basis_coordinate_space_mismatch",
    });
    if (defensiveApply.available || defensiveApply.reason !== "basis_coordinate_space_mismatch") {
      throw new Error("apply_gate_defense_in_depth_failed:P-coordinate-space-drift");
    }

    return {
      mode: "deterministic_execution_observed",
      emittedResult: "basis_coordinate_space_mismatch",
      expectedVsObservedComparison: "matches_expected",
      outcome: "pass",
      supportingChecks: [
        {
          checkId: "qualification_equality_key_check",
          status: "passed",
          failureClass: null,
          notes:
            "Persisted coordinate-space key differs from current committed coordinate-space version.",
        },
        {
          checkId: "apply_gate_defense_in_depth",
          status: "passed",
          failureClass: null,
          notes: `firstFailingGate=${defensiveApply.firstFailingGate}`,
        },
      ],
      pinnedCallInputs: [
        `loadPayloadFixture:P-coordinate-space-drift payloadIdentity=${payloadIdentity}`,
        `validateImportedSceneJson:config=scene-state-defaults-v1`,
        `evaluateCalibrationRestoreCompatibility:currentCoordinateSpace=${CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION.decoderId}`,
        "evaluateCalibratedCameraApply:basisQualified=false,basisUnavailableReason=basis_coordinate_space_mismatch",
      ],
      artifactReferences: [
        `payload_identity:${payloadIdentity}`,
        `payload_digest:${payloadDigest}`,
        `persisted_coordinate_space_decoder:${persistedCoordinateSpace.decoderId}`,
        `current_coordinate_space_decoder:${CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION.decoderId}`,
      ],
      manualObservationLog:
        "Deterministic execution observed via committed payload fixture, import validation, and restore compatibility mismatch check.",
    };
  })();
}

export async function runDeterministicFirstSliceExecution(input: {
  probeId: NonPStaleProbeId;
  provenance: NonPStaleResolvedProvenance;
}): Promise<NonPStaleExecutionEvidence> {
  if (input.probeId === "P-gen") {
    return runPgenDeterministicChain(input.provenance);
  }
  if (input.probeId === "P-legacy") {
    return runPlegacyDeterministicChain(input.provenance);
  }
  if (input.probeId === "P-coordinate-space-drift") {
    return runCoordinateSpaceDriftDeterministicChain(input.provenance);
  }
  throw new Error(`no_execution_adapter_yet:${input.probeId}`);
}
