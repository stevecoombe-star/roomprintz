import { CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION } from "@/app/admin/3d-room-lab/calibration-image-basis";
import { evaluateCalibratedCameraApply } from "@/app/admin/3d-room-lab/calibrated-camera-apply";
import {
  evaluateCalibrationRestoreCompatibility,
  validateImportedSceneJson,
  type SceneStateValidationConfig,
} from "@/app/admin/3d-room-lab/scene-state";
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
  if (input.probeId === "P-legacy") {
    return runPlegacyDeterministicChain(input.provenance);
  }
  if (input.probeId === "P-coordinate-space-drift") {
    return runCoordinateSpaceDriftDeterministicChain(input.provenance);
  }
  throw new Error(`no_execution_adapter_yet:${input.probeId}`);
}
