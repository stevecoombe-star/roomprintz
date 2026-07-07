import { CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION } from "@/app/admin/3d-room-lab/calibration-image-basis";
import { evaluateCalibrationImageBasisEvidence } from "@/app/admin/3d-room-lab/calibration-image-basis";
import type { CalibrationImageBasis } from "@/app/admin/3d-room-lab/calibration-image-basis";
import { evaluateCalibratedCameraApply } from "@/app/admin/3d-room-lab/calibrated-camera-apply";
import { shouldDiscardAttestedResponse } from "@/app/admin/3d-room-lab/policy-a-containment";
import {
  CALIBRATED_SCENE_STATE_CALIBRATION_VERSION_V2,
  CALIBRATED_SCENE_STATE_SOLVER_V1,
  evaluateCalibrationRestoreCompatibility,
  validateImportedSceneJson,
  type CalibratedSceneStateCalibrationV2,
  type SceneStateValidationConfig,
} from "@/app/admin/3d-room-lab/scene-state";
import { G0_SYNTHETIC_ASSETS } from "./assets-and-lineage";
import {
  observePdimensionMismatchRouteContainment,
  P_DIMENSION_PINNED_SYNTHETIC_DIMENSIONS,
} from "./p-dimension-route-harness";
import {
  observePurlDriftDualRouteMismatchContainment,
  P_URL_DRIFT_PINNED_MATCHING_DIMENSIONS,
  P_URL_DRIFT_PINNED_SOURCE_IMAGE_URL,
  P_URL_DRIFT_SERVED_FILE_NAME,
} from "./p-url-drift-route-harness";
import {
  observeX4ExifOrientationRouteContainment,
  X4_PINNED_MATCHING_DIMENSIONS,
} from "./x4-exif-route-harness";
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

function extractResolverBoundImageMetadata(
  probeId: "P-gen" | "P-dimension-mismatch" | "X4",
  provenance: NonPStaleResolvedProvenance
): {
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
        throw new Error(`malformed_fixture_image_dimensions_reference:${probeId}`);
      }
      const dimensionsMatch = entry.match(dimensionsPattern);
      if (!dimensionsMatch) {
        throw new Error(`malformed_fixture_image_dimensions_reference:${probeId}`);
      }
      if (dimensions !== null) {
        throw new Error(`duplicate_fixture_image_dimensions_reference:${probeId}`);
      }
      const width = Number.parseInt(dimensionsMatch[1], 10);
      const height = Number.parseInt(dimensionsMatch[2], 10);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        throw new Error(`malformed_fixture_image_dimensions_reference:${probeId}`);
      }
      dimensions = { width, height };
    }

    if (entry.includes("fixture_image_orientation:")) {
      if (!entry.startsWith("fixture_image_orientation:")) {
        throw new Error(`malformed_fixture_image_orientation_reference:${probeId}`);
      }
      const orientationMatch = entry.match(orientationPattern);
      if (!orientationMatch) {
        throw new Error(`malformed_fixture_image_orientation_reference:${probeId}`);
      }
      if (orientation !== null) {
        throw new Error(`duplicate_fixture_image_orientation_reference:${probeId}`);
      }
      const parsedOrientation = Number.parseInt(orientationMatch[1], 10);
      if (!Number.isFinite(parsedOrientation) || parsedOrientation <= 0) {
        throw new Error(`malformed_fixture_image_orientation_reference:${probeId}`);
      }
      orientation = parsedOrientation;
    }
  }
  if (!dimensions) {
    throw new Error(`missing_fixture_image_dimensions_reference:${probeId}`);
  }
  if (orientation === null) {
    throw new Error(`missing_fixture_image_orientation_reference:${probeId}`);
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

    const metadata = extractResolverBoundImageMetadata("P-gen", provenance);
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

function runPdimensionMismatchDeterministicChain(
  provenance: NonPStaleResolvedProvenance
): Promise<NonPStaleExecutionEvidence> {
  return (async () => {
    if (provenance.probeId !== "P-dimension-mismatch") {
      throw new Error(`unexpected_provenance_probe:P-dimension-mismatch:${provenance.probeId}`);
    }
    if (provenance.evaluatedImageDigest !== G0_SYNTHETIC_ASSETS["A-parent"].sha256) {
      throw new Error("provenance_digest_drift:P-dimension-mismatch");
    }
    const canonicalAParentPath = provenance.canonicalRepoRelativePaths.find((entry) =>
      entry.endsWith("/A-parent.jpg")
    );
    if (!canonicalAParentPath) {
      throw new Error("canonical_a_parent_path_missing:P-dimension-mismatch");
    }
    if (provenance.payloadIdentity !== null || provenance.payloadDigest !== null) {
      throw new Error("payload_fields_must_be_null:P-dimension-mismatch");
    }
    if (provenance.driftImageDigest !== null) {
      throw new Error("drift_digest_must_be_null:P-dimension-mismatch");
    }
    if (provenance.fixtureReceipt.expectedRefusalOrContainmentResult !== "basis_dimension_mismatch") {
      throw new Error("declaration_expected_result_mismatch:P-dimension-mismatch");
    }
    if (provenance.fixtureReceipt.expectedPipelineStage !== "server basis evidence evaluation") {
      throw new Error("declaration_expected_stage_mismatch:P-dimension-mismatch");
    }

    const resolverBoundAParentMetadata = extractResolverBoundImageMetadata(
      "P-dimension-mismatch",
      provenance
    );
    const expectedMetadata = {
      width: G0_SYNTHETIC_ASSETS["A-parent"].decodedWidth,
      height: G0_SYNTHETIC_ASSETS["A-parent"].decodedHeight,
      orientation: G0_SYNTHETIC_ASSETS["A-parent"].encodedOrientation,
    };
    if (
      resolverBoundAParentMetadata.width !== expectedMetadata.width ||
      resolverBoundAParentMetadata.height !== expectedMetadata.height ||
      resolverBoundAParentMetadata.orientation !== expectedMetadata.orientation
    ) {
      throw new Error("resolver_bound_metadata_mismatch:P-dimension-mismatch");
    }

    const primaryEvidence = evaluateCalibrationImageBasisEvidence({
      metadata: resolverBoundAParentMetadata,
      browserDimensions: P_DIMENSION_PINNED_SYNTHETIC_DIMENSIONS,
      coordinateSpaceVersion: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
      basisKind: "original",
    });
    if (primaryEvidence.ok) {
      throw new Error("unexpected_valid_result:P-dimension-mismatch");
    }
    if (primaryEvidence.reason !== "basis_dimension_mismatch") {
      throw new Error("unexpected_emitted_token:P-dimension-mismatch");
    }

    const routeObservation = await observePdimensionMismatchRouteContainment({
      expectedBasisFingerprint: provenance.evaluatedImageDigest,
      canonicalAParentRepoRelativePath: canonicalAParentPath,
    });
    if (routeObservation.httpStatus !== 200 || routeObservation.responseStatus !== "failed") {
      throw new Error("route_response_unexpected_status:P-dimension-mismatch");
    }
    if (routeObservation.candidatesLength !== 0 || routeObservation.selectedCandidateId !== null) {
      throw new Error("route_response_unexpected_candidates:P-dimension-mismatch");
    }
    if (
      routeObservation.failureReason !==
      "Room image dimensions changed before vision calibration could run."
    ) {
      throw new Error("route_response_unexpected_failure_reason:P-dimension-mismatch");
    }
    if (routeObservation.attestedBasisFingerprint !== provenance.evaluatedImageDigest) {
      throw new Error("route_attested_fingerprint_mismatch:P-dimension-mismatch");
    }
    if (
      routeObservation.servedRequestPaths.length !== 1 ||
      routeObservation.servedRequestPaths[0] !== "GET /A-parent.jpg"
    ) {
      throw new Error("route_response_unexpected_request_log:P-dimension-mismatch");
    }
    if (routeObservation.modelTripwireInvoked !== false) {
      throw new Error("model_tripwire_reached:P-dimension-mismatch");
    }

    const defensiveApply = evaluateCalibratedCameraApply(null, null, {
      basisQualified: false,
      basisUnavailableReason: "basis_dimension_mismatch",
    });
    if (
      defensiveApply.available !== false ||
      defensiveApply.reason !== "basis_dimension_mismatch" ||
      defensiveApply.firstFailingGate !== "basis"
    ) {
      throw new Error("apply_gate_mismatch:P-dimension-mismatch");
    }

    return {
      mode: "deterministic_execution_observed",
      emittedResult: "basis_dimension_mismatch",
      expectedVsObservedComparison: "matches_expected",
      outcome: "pass",
      supportingChecks: [
        {
          checkId: "vision_route_pre_model_dimension_verification",
          status: "passed",
          failureClass: null,
          notes:
            "route_response_result records whether the route response body carried the probe's declared containment token. It remains not_run when a route supporting branch returns prose rather than that declared token.",
        },
        {
          checkId: "apply_gate_defense_in_depth",
          status: "passed",
          failureClass: null,
          notes: `firstFailingGate=${defensiveApply.firstFailingGate}`,
        },
      ],
      pinnedCallInputs: [
        `evaluateCalibrationImageBasisEvidence:basisKind=original,browserDimensions=${P_DIMENSION_PINNED_SYNTHETIC_DIMENSIONS.width}x${P_DIMENSION_PINNED_SYNTHETIC_DIMENSIONS.height},coordinateSpace=${CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION.decoderId},metadata=${resolverBoundAParentMetadata.width}x${resolverBoundAParentMetadata.height}/orientation=${resolverBoundAParentMetadata.orientation}`,
        `route.POST:detect-vision,inProcess=true,imageUrl=loopback:/A-parent.jpg,intrinsicSize=${P_DIMENSION_PINNED_SYNTHETIC_DIMENSIONS.width}x${P_DIMENSION_PINNED_SYNTHETIC_DIMENSIONS.height},expectedBasisFingerprint=${provenance.evaluatedImageDigest}`,
        "evaluateCalibratedCameraApply:basisQualified=false,basisUnavailableReason=basis_dimension_mismatch",
      ],
      artifactReferences: [
        `canonical_image_path:${canonicalAParentPath}`,
        "primary_call_fetch_boundary:none",
        "route_supporting_fetch_boundary:loopback_127.0.0.1_3000_only",
        "route_served_request_path:/A-parent.jpg",
        `route_attested_basis_fingerprint:${routeObservation.attestedBasisFingerprint}`,
        "route_failure_reason_kind:prose_not_containment_token",
        "model_boundary:tripwire_installed_not_reached",
      ],
      manualObservationLog:
        "The committed resolver re-read, hashed, decoded, and provenance-bound A-parent from its canonical committed path.\nThe pure primary call used resolver-bound metadata plus code-pinned synthetic dimensions and did not read image bytes.\nThe supporting route handler fetched controlled loopback bytes, decoded them, performed the dimension comparison before model execution, and returned prose rather than the containment token.\nThe model tripwire was installed and never reached.",
    };
  })();
}

const X4_ROUTE_RESPONSE_CLARIFICATION =
  "route_response_result records whether the route response body carried the probe's declared containment token. It remains not_run when a route supporting branch returns prose rather than that declared token." as const;

function runX4ExifOrientationDeterministicChain(
  provenance: NonPStaleResolvedProvenance
): Promise<NonPStaleExecutionEvidence> {
  return (async () => {
    if (provenance.probeId !== "X4") {
      throw new Error(`unexpected_provenance_probe:X4:${provenance.probeId}`);
    }
    if (provenance.evaluatedImageDigest !== G0_SYNTHETIC_ASSETS["A-exif"].sha256) {
      throw new Error("provenance_digest_drift:X4");
    }
    const canonicalAExifPath = provenance.canonicalRepoRelativePaths.find((entry) =>
      entry.endsWith("/A-exif.jpg")
    );
    if (!canonicalAExifPath) {
      throw new Error("canonical_a_exif_path_missing:X4");
    }
    if (provenance.payloadIdentity !== null || provenance.payloadDigest !== null) {
      throw new Error("payload_fields_must_be_null:X4");
    }
    if (provenance.driftImageDigest !== null) {
      throw new Error("drift_digest_must_be_null:X4");
    }
    if (
      provenance.fixtureReceipt.expectedRefusalOrContainmentResult !==
      "basis_orientation_not_normal"
    ) {
      throw new Error("declaration_expected_result_mismatch:X4");
    }
    if (provenance.fixtureReceipt.expectedPipelineStage !== "server basis evidence evaluation") {
      throw new Error("declaration_expected_stage_mismatch:X4");
    }

    const resolverBoundAExifMetadata = extractResolverBoundImageMetadata("X4", provenance);
    const expectedMetadata = {
      width: G0_SYNTHETIC_ASSETS["A-exif"].decodedWidth,
      height: G0_SYNTHETIC_ASSETS["A-exif"].decodedHeight,
      orientation: G0_SYNTHETIC_ASSETS["A-exif"].encodedOrientation,
    };
    if (
      resolverBoundAExifMetadata.width !== expectedMetadata.width ||
      resolverBoundAExifMetadata.height !== expectedMetadata.height ||
      resolverBoundAExifMetadata.orientation !== expectedMetadata.orientation
    ) {
      throw new Error("resolver_bound_metadata_mismatch:X4");
    }
    if (
      resolverBoundAExifMetadata.width !== X4_PINNED_MATCHING_DIMENSIONS.width ||
      resolverBoundAExifMetadata.height !== X4_PINNED_MATCHING_DIMENSIONS.height
    ) {
      throw new Error("pinned_dimensions_not_matching:X4");
    }
    if (resolverBoundAExifMetadata.orientation === 1) {
      throw new Error("fixture_orientation_unexpectedly_normal:X4");
    }

    const routeObservation = await observeX4ExifOrientationRouteContainment({
      expectedBasisFingerprint: provenance.evaluatedImageDigest,
      canonicalAExifRepoRelativePath: canonicalAExifPath,
    });
    if (routeObservation.httpStatus !== 200 || routeObservation.responseStatus !== "failed") {
      throw new Error("route_response_unexpected_status:X4");
    }
    if (routeObservation.candidatesLength !== 0 || routeObservation.selectedCandidateId !== null) {
      throw new Error("route_response_unexpected_candidates:X4");
    }
    if (routeObservation.notesLength !== 0) {
      throw new Error("route_response_unexpected_notes:X4");
    }
    if (
      routeObservation.failureReason !==
      "This image orientation is not yet supported for vision calibration."
    ) {
      throw new Error("route_response_unexpected_failure_reason:X4");
    }
    if (routeObservation.attestedBasisFingerprint !== provenance.evaluatedImageDigest) {
      throw new Error("route_attested_fingerprint_mismatch:X4");
    }
    if (
      routeObservation.servedRequestPaths.length !== 1 ||
      routeObservation.servedRequestPaths[0] !== "GET /A-exif.jpg"
    ) {
      throw new Error("route_response_unexpected_request_log:X4");
    }
    if (routeObservation.modelTripwireInvoked !== false) {
      throw new Error("model_tripwire_reached:X4");
    }

    const primaryEvidence = evaluateCalibrationImageBasisEvidence({
      basisKind: "original",
      browserDimensions: null,
      coordinateSpaceVersion: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
      metadata: resolverBoundAExifMetadata,
    });
    if (primaryEvidence.ok) {
      throw new Error("unexpected_valid_result:X4");
    }
    if (primaryEvidence.reason !== "basis_orientation_not_normal") {
      throw new Error("unexpected_emitted_token:X4");
    }

    const defensiveApply = evaluateCalibratedCameraApply(null, null, {
      basisQualified: false,
      basisUnavailableReason: "basis_orientation_not_normal",
    });
    if (
      defensiveApply.available !== false ||
      defensiveApply.reason !== "basis_orientation_not_normal" ||
      defensiveApply.firstFailingGate !== "basis"
    ) {
      throw new Error("apply_gate_mismatch:X4");
    }

    return {
      mode: "deterministic_execution_observed",
      emittedResult: "basis_orientation_not_normal",
      expectedVsObservedComparison: "matches_expected",
      outcome: "pass",
      supportingChecks: [
        {
          checkId: "vision_route_pre_model_orientation_refusal",
          status: "passed",
          failureClass: null,
          notes: X4_ROUTE_RESPONSE_CLARIFICATION,
        },
        {
          checkId: "apply_gate_defense_in_depth",
          status: "passed",
          failureClass: null,
          notes: `firstFailingGate=${defensiveApply.firstFailingGate}`,
        },
      ],
      pinnedCallInputs: [
        `evaluateCalibrationImageBasisEvidence:basisKind=original,browserDimensions=null,coordinateSpace=${CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION.decoderId},metadata=${resolverBoundAExifMetadata.width}x${resolverBoundAExifMetadata.height}/orientation=${resolverBoundAExifMetadata.orientation}`,
        `route.POST:detect-vision,inProcess=true,imageUrl=loopback:/A-exif.jpg,frameSize=${X4_PINNED_MATCHING_DIMENSIONS.width}x${X4_PINNED_MATCHING_DIMENSIONS.height},intrinsicSize=${X4_PINNED_MATCHING_DIMENSIONS.width}x${X4_PINNED_MATCHING_DIMENSIONS.height},expectedBasisFingerprint=${provenance.evaluatedImageDigest}`,
        "evaluateCalibratedCameraApply:basisQualified=false,basisUnavailableReason=basis_orientation_not_normal",
      ],
      artifactReferences: [
        `canonical_image_path:${canonicalAExifPath}`,
        "primary_call_fetch_boundary:none",
        "route_supporting_fetch_boundary:loopback_127.0.0.1_3000_only",
        "route_served_request_path:/A-exif.jpg",
        `route_attested_basis_fingerprint:${routeObservation.attestedBasisFingerprint}`,
        "route_failure_reason_kind:prose_not_containment_token",
        "model_boundary:tripwire_installed_not_reached",
      ],
      manualObservationLog:
        "The committed resolver re-read, hashed, decoded, and provenance-bound A-exif from its canonical committed path, including digest, dimensions, EXIF orientation 6, and parent lineage.\nThe pure primary call used resolver-bound metadata with browserDimensions=null and did not read image bytes; it emitted the declared orientation refusal token.\nThe supporting route handler fetched controlled loopback bytes, decoded them, and refused on non-normal EXIF orientation before the dimension comparison and before model execution, returning prose rather than the containment token.\nThe model tripwire was installed and never reached.",
    };
  })();
}

// Pinned, code-constructed restore bases for the P-url-drift pure primary
// call. The fingerprint argument is the ONLY compared basis axis a caller can
// vary; every other axis (URL, dimensions, orientation, transform, dimension
// source, coordinate space, basis kind) is pinned identically for the
// persisted and current sides so the fingerprint comparison is isolated.
export function buildPurlDriftRestoreImageBasis(basisFingerprint: string): CalibrationImageBasis {
  return {
    basisId: "g0-p-url-drift-restore-basis",
    basisFingerprint,
    sourceImageUrl: P_URL_DRIFT_PINNED_SOURCE_IMAGE_URL,
    decodedWidth: P_URL_DRIFT_PINNED_MATCHING_DIMENSIONS.width,
    decodedHeight: P_URL_DRIFT_PINNED_MATCHING_DIMENSIONS.height,
    encodedOrientation: 1,
    decodedOrientationNormal: true,
    orientationTransform: "identity",
    dimensionSource: "server",
    coordinateSpaceVersion: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
    basisKind: "original",
  };
}

export function buildPurlDriftPersistedCalibration(
  persistedBasisFingerprint: string
): CalibratedSceneStateCalibrationV2 {
  return {
    calibrationVersion: CALIBRATED_SCENE_STATE_CALIBRATION_VERSION_V2,
    solver: CALIBRATED_SCENE_STATE_SOLVER_V1,
    intrinsics: { verticalFovDeg: 60 },
    source: {
      imageBasis: buildPurlDriftRestoreImageBasis(persistedBasisFingerprint),
      sourceFloorPolygon: [
        { x: 0.2, y: 0.6 },
        { x: 0.8, y: 0.6 },
        { x: 0.9, y: 0.95 },
        { x: 0.1, y: 0.95 },
      ],
    },
  };
}

function runPurlDriftDeterministicChain(
  provenance: NonPStaleResolvedProvenance
): Promise<NonPStaleExecutionEvidence> {
  return (async () => {
    if (provenance.probeId !== "P-url-drift") {
      throw new Error(`unexpected_provenance_probe:P-url-drift:${provenance.probeId}`);
    }
    if (provenance.evaluatedImageDigest !== G0_SYNTHETIC_ASSETS["A-parent"].sha256) {
      throw new Error("provenance_digest_drift:P-url-drift");
    }
    if (provenance.driftImageDigest !== G0_SYNTHETIC_ASSETS["A-drift-b"].sha256) {
      throw new Error("drift_provenance_digest_drift:P-url-drift");
    }
    if (provenance.evaluatedImageDigest === provenance.driftImageDigest) {
      throw new Error("parent_and_drift_digests_equal:P-url-drift");
    }
    if (provenance.payloadIdentity !== null || provenance.payloadDigest !== null) {
      throw new Error("payload_fields_must_be_null:P-url-drift");
    }
    const canonicalAParentPath = provenance.canonicalRepoRelativePaths.find((entry) =>
      entry.endsWith("/A-parent.jpg")
    );
    if (!canonicalAParentPath) {
      throw new Error("canonical_a_parent_path_missing:P-url-drift");
    }
    const canonicalADriftPath = provenance.canonicalRepoRelativePaths.find((entry) =>
      entry.endsWith("/A-drift-b.jpg")
    );
    if (!canonicalADriftPath) {
      throw new Error("canonical_a_drift_b_path_missing:P-url-drift");
    }
    if (
      provenance.fixtureReceipt.expectedRefusalOrContainmentResult !==
      "basis_fingerprint_mismatch"
    ) {
      throw new Error("declaration_expected_result_mismatch:P-url-drift");
    }
    if (
      provenance.fixtureReceipt.expectedPipelineStage !==
      "restore image-basis receipt comparison"
    ) {
      throw new Error("declaration_expected_stage_mismatch:P-url-drift");
    }
    // The image-with-drift resolver branch does not provide the single-image
    // metadata artifact format, so 320x240/orientation-1 construction uses only
    // resolver-verified registry facts (the resolver already re-decoded both
    // assets against these exact registry values).
    for (const registryAsset of [G0_SYNTHETIC_ASSETS["A-parent"], G0_SYNTHETIC_ASSETS["A-drift-b"]]) {
      if (
        registryAsset.decodedWidth !== P_URL_DRIFT_PINNED_MATCHING_DIMENSIONS.width ||
        registryAsset.decodedHeight !== P_URL_DRIFT_PINNED_MATCHING_DIMENSIONS.height ||
        registryAsset.encodedOrientation !== 1 ||
        !registryAsset.decodedOrientationNormal
      ) {
        throw new Error("pinned_registry_facts_drift:P-url-drift");
      }
    }

    // Pure primary: persisted A-parent basis vs current A-drift-b basis over
    // the same pinned URL/dimensions/orientation/coordinate-space/basis-kind.
    // No fetch, decode, hash, or filesystem access occurs here.
    const persistedCalibration = buildPurlDriftPersistedCalibration(
      provenance.evaluatedImageDigest
    );
    const currentImageBasis = buildPurlDriftRestoreImageBasis(provenance.driftImageDigest);
    const primaryResult = evaluateCalibrationRestoreCompatibility({
      calibration: persistedCalibration,
      currentImageBasis,
    });
    if (primaryResult.ok) {
      throw new Error("unexpected_valid_result:P-url-drift");
    }
    if (primaryResult.reason !== "basis_fingerprint_mismatch") {
      throw new Error("unexpected_emitted_token:P-url-drift");
    }

    const routeObservation = await observePurlDriftDualRouteMismatchContainment({
      expectedParentBasisFingerprint: provenance.evaluatedImageDigest,
      canonicalAParentRepoRelativePath: canonicalAParentPath,
      canonicalADriftRepoRelativePath: canonicalADriftPath,
    });
    if (routeObservation.expectedBasisFingerprintSent !== provenance.evaluatedImageDigest) {
      throw new Error("route_expected_fingerprint_drift:P-url-drift");
    }
    const vision = routeObservation.vision;
    if (
      vision.httpStatus !== 200 ||
      vision.responseStatus !== "failed" ||
      vision.candidatesLength !== 0 ||
      vision.selectedCandidateId !== null ||
      vision.failureReasons.length !== 1 ||
      vision.failureReasons[0] !== "basis_fingerprint_mismatch"
    ) {
      throw new Error("vision_route_response_unexpected:P-url-drift");
    }
    if (vision.attestedBasisFingerprint !== provenance.driftImageDigest) {
      throw new Error("vision_route_attested_fingerprint_mismatch:P-url-drift");
    }
    if (
      vision.servedRequestPaths.length !== 1 ||
      vision.servedRequestPaths[0] !== `GET /${P_URL_DRIFT_SERVED_FILE_NAME}`
    ) {
      throw new Error("vision_route_unexpected_request_log:P-url-drift");
    }
    if (vision.modelTripwireInstalled !== true || vision.modelTripwireInvoked !== false) {
      throw new Error("vision_model_boundary_state_unexpected:P-url-drift");
    }
    const emptyRoom = routeObservation.emptyRoom;
    if (
      emptyRoom.httpStatus !== 200 ||
      emptyRoom.emptyRoomAssistStatus !== "blocked" ||
      emptyRoom.failureReason !== "basis_fingerprint_mismatch" ||
      emptyRoom.policyReasons.length !== 1 ||
      emptyRoom.policyReasons[0] !== "basis_fingerprint_mismatch" ||
      emptyRoom.calibratedCameraEligible !== false ||
      emptyRoom.surfacedResult !== null ||
      emptyRoom.originalResult !== null ||
      emptyRoom.emptyResult !== null
    ) {
      throw new Error("empty_room_route_response_unexpected:P-url-drift");
    }
    if (emptyRoom.attestedOriginalBasisFingerprint !== provenance.driftImageDigest) {
      throw new Error("empty_room_route_attested_fingerprint_mismatch:P-url-drift");
    }
    if (
      emptyRoom.servedRequestPaths.length !== 1 ||
      emptyRoom.servedRequestPaths[0] !== `GET /${P_URL_DRIFT_SERVED_FILE_NAME}`
    ) {
      throw new Error("empty_room_route_unexpected_request_log:P-url-drift");
    }
    if (
      emptyRoom.generationTripwireInstalled !== true ||
      emptyRoom.generationTripwireInvoked !== false ||
      emptyRoom.detectionTripwireInstalled !== true ||
      emptyRoom.detectionTripwireInvoked !== false
    ) {
      throw new Error("empty_room_boundary_state_unexpected:P-url-drift");
    }

    // Client discard predicate against ACTUAL route-attested drift fingerprints.
    if (
      shouldDiscardAttestedResponse(
        provenance.evaluatedImageDigest,
        vision.attestedBasisFingerprint
      ) !== true ||
      shouldDiscardAttestedResponse(
        provenance.evaluatedImageDigest,
        emptyRoom.attestedOriginalBasisFingerprint
      ) !== true
    ) {
      throw new Error("client_discard_predicate_failed:P-url-drift");
    }
    if (
      shouldDiscardAttestedResponse(null, vision.attestedBasisFingerprint) !== false ||
      shouldDiscardAttestedResponse(provenance.evaluatedImageDigest, null) !== false
    ) {
      throw new Error("client_discard_null_control_failed:P-url-drift");
    }

    const defensiveApply = evaluateCalibratedCameraApply(null, null, {
      basisQualified: false,
      basisUnavailableReason: "basis_fingerprint_mismatch",
    });
    if (
      defensiveApply.available !== false ||
      defensiveApply.reason !== "basis_fingerprint_mismatch" ||
      defensiveApply.firstFailingGate !== "basis"
    ) {
      throw new Error("apply_gate_mismatch:P-url-drift");
    }

    return {
      mode: "deterministic_execution_observed",
      emittedResult: "basis_fingerprint_mismatch",
      expectedVsObservedComparison: "matches_expected",
      outcome: "pass",
      supportingChecks: [
        {
          checkId: "vision_route_mismatch_discard",
          status: "passed",
          failureClass: null,
          notes:
            "The controlled detect-vision route response body carried the literal declared token basis_fingerprint_mismatch and attested the served A-drift-b digest. The expected parent fingerprint deliberately mismatched the served drift bytes, and the mismatch returned before the vision model boundary; the model tripwire was installed and never reached.",
        },
        {
          checkId: "empty_room_route_mismatch_discard",
          status: "passed",
          failureClass: null,
          notes:
            "The controlled empty-room route response body carried the literal declared token basis_fingerprint_mismatch in a blocked result state and attested the served A-drift-b digest. The expected parent fingerprint deliberately mismatched the served drift bytes, and the mismatch returned before generation, detection, structural-preservation work, and persistence; the generation and detection tripwires were installed and never reached.",
        },
        {
          checkId: "client_discard_predicate",
          status: "passed",
          failureClass: null,
          notes:
            "shouldDiscardAttestedResponse returned true for the persisted parent fingerprint against the actual route-attested A-drift-b fingerprints from both successful route observations, and returned false for both null-input controls.",
        },
        {
          checkId: "apply_gate_defense_in_depth",
          status: "passed",
          failureClass: null,
          notes: `firstFailingGate=${defensiveApply.firstFailingGate}`,
        },
      ],
      pinnedCallInputs: [
        `evaluateCalibrationRestoreCompatibility:persistedFingerprint=${provenance.evaluatedImageDigest},currentFingerprint=${provenance.driftImageDigest},dimensions=${P_URL_DRIFT_PINNED_MATCHING_DIMENSIONS.width}x${P_URL_DRIFT_PINNED_MATCHING_DIMENSIONS.height},orientation=1,basisKind=original,coordinateSpace=${CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION.decoderId},sourceImageUrl=${P_URL_DRIFT_PINNED_SOURCE_IMAGE_URL}`,
        `route.POST:detect-vision,inProcess=true,imageUrl=loopback:/${P_URL_DRIFT_SERVED_FILE_NAME},frameSize=${P_URL_DRIFT_PINNED_MATCHING_DIMENSIONS.width}x${P_URL_DRIFT_PINNED_MATCHING_DIMENSIONS.height},intrinsicSize=${P_URL_DRIFT_PINNED_MATCHING_DIMENSIONS.width}x${P_URL_DRIFT_PINNED_MATCHING_DIMENSIONS.height},expectedBasisFingerprint=${provenance.evaluatedImageDigest}`,
        `route.POST:empty-room-assist/run,inProcess=true,imageUrl=loopback:/${P_URL_DRIFT_SERVED_FILE_NAME},frameSize=${P_URL_DRIFT_PINNED_MATCHING_DIMENSIONS.width}x${P_URL_DRIFT_PINNED_MATCHING_DIMENSIONS.height},intrinsicSize=${P_URL_DRIFT_PINNED_MATCHING_DIMENSIONS.width}x${P_URL_DRIFT_PINNED_MATCHING_DIMENSIONS.height},expectedBasisFingerprint=${provenance.evaluatedImageDigest}`,
        `shouldDiscardAttestedResponse:currentBasisFingerprint=${provenance.evaluatedImageDigest},attestedBasisFingerprint=${provenance.driftImageDigest}`,
        "evaluateCalibratedCameraApply:basisQualified=false,basisUnavailableReason=basis_fingerprint_mismatch",
      ],
      artifactReferences: [
        `canonical_image_path:${canonicalAParentPath}`,
        `canonical_drift_image_path:${canonicalADriftPath}`,
        "primary_call_fetch_boundary:none",
        "route_supporting_fetch_boundary:loopback_127.0.0.1_3000_only",
        `vision_route_served_request_path:/${P_URL_DRIFT_SERVED_FILE_NAME}`,
        `empty_room_route_served_request_path:/${P_URL_DRIFT_SERVED_FILE_NAME}`,
        `expected_basis_fingerprint_sent:${provenance.evaluatedImageDigest}`,
        `vision_route_attested_basis_fingerprint:${vision.attestedBasisFingerprint}`,
        `empty_room_route_attested_basis_fingerprint:${emptyRoom.attestedOriginalBasisFingerprint}`,
        "route_failure_reason_kind:declared_containment_token",
        "model_boundary:tripwires_installed_not_reached",
      ],
      manualObservationLog:
        "The committed resolver re-read, hashed, decoded, and provenance-bound both A-parent and A-drift-b from their canonical committed paths, confirming distinct digests and the A-drift-b parent lineage to A-parent.\nThe pure restore-comparison primary call compared a persisted A-parent-fingerprint image basis against a current A-drift-b-fingerprint image basis over the same pinned source URL, dimensions, orientation, coordinate-space version, and basis kind; the declared token was obtained only from result.reason and the call performed no fetch, decode, hash, fingerprint computation, or filesystem access.\nThe controlled loopback detect-vision observation served digest-verified A-drift-b bytes while sending the expected A-parent fingerprint and returned the declared token with the served drift digest attested; this production mismatch branch emits a console warning and performs no persistent write.\nThe controlled loopback empty-room observation served the same digest-verified A-drift-b bytes while sending the expected A-parent fingerprint and returned a blocked result carrying the declared token with the served drift digest attested.\nThe expected fingerprint sent to both routes was the A-parent digest while both route responses attested the A-drift-b digest, recording the actual expected-versus-attested drift.\nThe client discard predicate consumed the actual route-attested drift fingerprints from both route observations and returned true, while both null-input controls returned false.\nThe apply gate refused with the declared token at the basis gate.\nThe vision model tripwire and the empty-room generation and detection tripwires were installed and never reached during the mismatch observations.",
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
  if (input.probeId === "P-dimension-mismatch") {
    return runPdimensionMismatchDeterministicChain(input.provenance);
  }
  if (input.probeId === "X4") {
    return runX4ExifOrientationDeterministicChain(input.provenance);
  }
  if (input.probeId === "P-url-drift") {
    return runPurlDriftDeterministicChain(input.provenance);
  }
  if (input.probeId === "P-legacy") {
    return runPlegacyDeterministicChain(input.provenance);
  }
  if (input.probeId === "P-coordinate-space-drift") {
    return runCoordinateSpaceDriftDeterministicChain(input.provenance);
  }
  throw new Error(`no_execution_adapter_yet:${input.probeId}`);
}
